# devtools

Optional, opt-in inspection helpers for the reactive data library. Importing
`data/devtools` (or, in source form, `./devtools/index.ts`) attaches a handful
of methods to the canonical `$` so they're discoverable from the browser
console — `$.inspect`, `$.graph`, `$.fromDOM`, `$.highlight`, `$.trace`,
`$.profile` — and lazy-loads an in-page overlay panel that wraps the same
helpers in a draggable dock with Graph / Events / Profile tabs and a DOM
picker.

## Why opt-in

The core has zero per-notification overhead today. The structural hooks
needed by devtools (`_devtoolsRoots: Set<WeakRef<View>>` and
`_devtoolsInternalRoots: WeakSet<View>` in `core.ts`, plus the
non-enumerable `__ripple_sink` property on bound DOM elements) are
unconditional but free in steady state. Anything that *does* touch the hot
path — trace and profile, which monkey-patch `View.prototype` — only runs
when you explicitly call `$.trace(p)` or `$.profile()`.

## Panel

`import 'data/devtools'` auto-mounts a draggable overlay panel into a
closed Shadow DOM root attached to `document.body`. Append `?nopanel` to
the URL to suppress the auto-mount (the console API is still attached);
call `$.devtools.panel.open()` / `$.devtools.panel.close()` for explicit
control.

Tabs:

- **Graph** — collapsible tree of the View graph for the selected root.
  Toolbar has a root selector populated from `iterRoots()`, a "show
  internal" toggle (reveals `_devtoolsInternalRoots`, useful for debugging
  the panel itself), and a **DAG** toggle that flips the renderer to a
  layered node-link diagram. DAG mode dedupes by view identity (a fan-out
  source appears once with multiple outgoing edges, vs. duplicated subtrees
  in tree mode), uses BFS depth from the root for layering, and renders
  edges as cubic SVG paths in a non-interactive layer below the nodes.
- **Events** — push-driven live tail of `$.trace` events. Pause/resume,
  clear, and a verb/key substring filter. Default ring-buffer size 500.
- **Profile** — start/stop button drives `$.profile(selectedRoot)`; a
  500ms-polled `report()` populates a sortable table (default sort by
  totalMs desc).
- **Flame** — start/stop button drives `$.cascades(selectedRoot)`; a
  500ms-polled `report()` populates a left-rail list of recorded
  cascades, and the right pane renders the picked cascade as a flame
  chart (one bar per patched-verb call, laid out by depth × time).
  Hover a bar for full label + duration. Bar colour reflects verb
  family (blue=update, green=insert, red=remove, amber=move).
- **DOM picker** — toolbar `◎` button arms a crosshair overlay; click any
  page element to walk to its `__ripple_sink` and select the matching root
  in the Graph tab. Excludes the panel's own host so you can't pick into it.
- **Hover inspector** — toolbar `⊙` button arms a sidecar that follows the
  cursor and shows the bound view's chain (root › … › name), the owning
  ctor (operator class or root Value), the value preview, and the live sink
  count for whatever element is under the mouse. Click to pin (sidecar
  freezes; click again to unpin); Esc to disarm. Mutually exclusive with
  the DOM picker — arming one disarms the other.

The panel ships as a separate chunk (`dist/devtools/panel/index.js`,
~30 KB) lazy-loaded via dynamic import — consumers who only want the
console API don't pay the panel's bytes upfront.

## Read-side helpers (always available once imported)

```js
$.inspect(proxy)
//   → { key, value, parent, children: [{name}], sinks: [{kind, ctor}] }
//   Pretty-prints to the console; returns the snapshot.

$.graph(proxy)
//   → { key, kind, value, children, sinks } (recursive)
//   DFS over the View graph from `proxy`. LinkedView nodes show as
//   `kind: 'linked-alias'` and don't recurse into the source.

$.graph(undefined, { internal? })
//   → GraphNode[]
//   With no proxy argument, walks every live root registered in
//   _devtoolsRoots (now a Set<WeakRef<View>>; dead refs are pruned during
//   iteration). Pass { internal: true } to also include devtools-internal
//   roots (e.g. the panel's own state).

$.fromDOM(el)
//   → ViewProxy | null
//   Walks `el.parentElement` chain to the nearest __ripple_sink and
//   returns a proxy for the owning view. Use with $0 in the devtools
//   console: `$.fromDOM($0)`.

$.highlight(proxy, ms = 1000)
//   → number of elements highlighted
//   Adds a `.__ripple_highlight` class to every DOM element bound to
//   `proxy`'s view, removing it after `ms`. Style the class yourself.
```

## Heavyweight helpers (auto-enable instrumentation on first call)

```js
$.trace(proxy, opts?)
//   → dispose(): void
//   Logs every notification (XU0/BU1/BI0/etc.) for the subtree rooted at
//   `proxy`. opts: { verbs?: string[], log?: boolean, onEvent?: fn }.
//   Pass log:false + onEvent to capture programmatically; omit them and
//   trace prints to console.

$.profile(proxy?, opts?)
//   → { stop(): Report, report(): Report }
//   Collects per-operator counts and wall-time. opts: { durationMs }.
//   Report: { totalEvents, totalMs, byOperator: [...], byVerb: {} }.
//   byOperator is sorted by totalMs desc — hottest first.
//   Re-entrancy is handled: a parent BU1 triggering child XU0s doesn't
//   double-count wall time.

$.cascades(proxy?, opts?)
//   → { stop(): Cascade[], report(): Cascade[], clear(): void }
//   Records the synchronous tree of patched-verb calls triggered by
//   each user mutation. Each Cascade carries Frame[] with parent index
//   (forming a forest), op ctor, view key, verb, and start/end ms.
//   With no proxy, captures every cascade in the graph; with a proxy,
//   only cascades whose first frame is at-or-under that root.
//   opts.maxCascades caps the ring buffer (default 200; oldest evicted).
//   Coalescing: sibling top-level patched-verb calls within one task
//   tick merge into a single cascade — Value.BU1 splits into view.BU1 +
//   view.BI0 internally, so without coalescing one user assignment
//   would produce two cascades. flushPendingClose runs in stop/report/
//   clear so callers don't have to await microtasks.

$.devtools.enable() / $.devtools.disable()
//   Pre-warm or fully tear down the View.prototype patches. trace/profile
//   auto-enable; this is for explicit control. disable() restores
//   View.prototype byte-identically and clears all listeners.
```

## Cost

- **Off-state** (devtools never imported): zero — the only structural hooks
  in core (`_devtoolsRoots`, `__ripple_sink`) are constant-time and run
  outside the fan-out path.
- **On-state, no listeners** (devtools imported, no trace/profile active):
  one boolean check + one `apply` per verb. Within noise of off-state.
- **On-state, one trace + one profile attached**: ~3× throughput cost in
  microbenchmarks, dominated by the trace event-record allocation and the
  profile bucket lookup. Tolerable for live inspection.

## Manual smoke tests

After commit 7 wires devtools into the example pages, open
`http://127.0.0.1:3000/examples/todo/?devtools` after `npm run serve`, then
in the browser console:

1. `$.graph(items)` — tree shows root + the three filter operators + the
   length operators chained off them.
2. `$.inspect(items)` — value is the localStorage object; sinks list the
   filter operators.
3. `$.fromDOM($0)` after picking a `<li>` — returns the proxy for that todo
   item; reading its `[value]` matches the visible text.
4. `$.highlight(items.filter('completed', true))` — outline class briefly
   added to the `<ul>` bound to the active filter.
