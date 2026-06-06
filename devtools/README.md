# devtools

Optional, opt-in inspection helpers for the reactive data library. Importing
`data/devtools` (or, in source form, `./devtools/index.ts`) attaches a handful
of methods to the canonical `$` so they're discoverable from the browser
console — `$.inspect`, `$.graph`, `$.fromDOM`, `$.highlight`, `$.trace`,
`$.profile`, `$.cascades` — and lazy-loads a graph-first in-page overlay
panel.

> **⚠ Import devtools from the same entry as your `$`.** Each `dist` sub-path
> (`data`, `data/full`, `data/devtools`, …) is a self-contained bundle with its
> own `$`. `import { $ } from 'data/full'` + `import 'data/devtools'` give you
> **two different `$` objects** — the devtools import attaches its helpers to
> its own `$`, so `$.inspect`/`$.graph`/the panel won't be wired to the proxies
> you created with the other `$`, and helpers fail with a confusing error.
> Either author your whole app against one entry (e.g. only `data/full`), or in
> source builds import `./devtools/index.ts` from the same `core.ts`. Tracked as
> C6 in [../ISSUES.md](../ISSUES.md).

## Why opt-in

The core has zero per-notification overhead today. The structural hooks
needed by devtools (`_devtoolsRoots: Set<WeakRef<View>>` and
`_devtoolsInternalRoots: WeakSet<View>` in `core.ts`, plus the
non-enumerable `__ripple_sink` property on bound DOM elements) are
unconditional but free in steady state. Anything that *does* touch the hot
path — trace and profile, which monkey-patch `View.prototype` — only runs
when you explicitly call `$.trace(p)` or `$.profile()`.

## Panel

`import 'data/devtools'` auto-mounts a right-edge overlay panel into a
closed Shadow DOM root attached to `document.body`. Append `?nopanel` to
the URL to suppress the auto-mount (the console API is still attached);
call `$.devtools.panel.open(proxy?)` / `$.devtools.panel.close()` for
explicit control. `$.devtools.panel.shell` returns the live panel object
(`{ host, root, dock, destroy }`) so tests / advanced scripting can reach
into the closed shadow without going through `host.shadowRoot`.

The panel auto-discovers the first live root via `iterRoots()`. If the
host page imports devtools BEFORE creating its first `$()` (which is the
common case via the example importmaps), `mount()` polls iterRoots every
50ms for ~5 s; the panel appears as soon as the first root materialises.
Pass an explicit `proxy` to `panel.open(proxy)` to root the panel at a
specific view.

### Shell

- Right-edge dock, anchored to `top: 0; right: 0; bottom: 0`. Default
  width 480 px (drag the left-edge handle to resize; width persists to
  `localStorage` under `data-devtools-dock-width`). When the inspector
  is open, the dock auto-widens to 840 px unless the user has set an
  explicit inline width via the resize handle.
- Header carries the brand, the Alt-hover (`⊙`), DOM picker (`◎`) and
  close (`✕`) buttons.
- A "layout:" segment toggles between **Tree** and **DAG** view of the
  reactive graph. DAG is the default — graph-first geometry.

### Graph (Tree or DAG)

Both layouts render the reactive pipeline: chains of operators rooted at
the source view, with terminal sinks (DOMSink / connect / linked-alias)
summarised into a `→N` chip on each node. To see the DOM elements those
chips represent, click the node and look at the **Bound DOM** section of
the inspector.

- **Tree** — indented outline. Click a row to open the inspector.
- **DAG** — BFS-positioned node-link diagram with pan/zoom. The toolbar
  toggles a `sinks` checkbox (off = terminals collapsed into chips,
  on = each terminal is a leaf node) and a `🔥` heatmap (lights up nodes
  by recent trace activity, decaying over 5 s). Shift-click a node to
  focus its ancestor/descendant subtree (siblings dim); empty-canvas
  click clears focus. `⛶` fits to view, `1:1` resets, `+/−` zooms.

### Inspector (slide-in column, three tabs)

- **Inspect** — four cards (IDENTITY, CURRENT VALUE, CONNECTIONS,
  ACTIVITY) plus a **Bound DOM** section listing every DOM element the
  selected view drives, with `flash` / `scroll` buttons per row.
- **Events** — for scalar views (length, sum, aggregates, booleans,
  primitives) renders a 60s step sparkline of the value plus a
  most-recent-transitions list. For collection views (root / filter /
  group / arrays / objects) renders a 60s insert/remove/update rollup,
  a per-row "heat" bar, and the last 20 raw events. Pause/clear in the
  toolbar. The event ring is shared with the Activity card (one global
  `$.trace`, fan-out via subscribers).
- **Profile** — start/stop button drives `$.profile(rootProxy)`; a
  500ms-polled `report()` populates the operator table.

### Interaction

- **DOM picker** (`◎`) — armed; click any page element to walk to its
  `__ripple_sink` and open the inspector at the matching view. Falls
  back to a synthetic node when the picked view isn't in the panel's
  current root's walk (e.g. a separate `$()` ViewProxy used as the source
  of a `<For>`).
- **Alt-hover** (hold `Alt` or click `⊙`) — outlines every reactive
  element, badges each one with key + ctor, and renders a popover near
  the cursor with key / ctor / sink count / value preview. Click an
  outlined element to PIN the popover (click again or Esc to unpin).
- **Esc** closes the inspector and unpins any Alt-hover popover.

The panel ships as a separate chunk (`dist/devtools/panel/index.js`)
lazy-loaded via dynamic import — consumers who only want the console API
don't pay the panel's bytes upfront.

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
//   _devtoolsRoots (a Set<WeakRef<View>>; dead refs are pruned during
//   iteration). Pass { internal: true } to also include any roots a
//   devtools surface has marked via _devtoolsInternalRoots.

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
//   opts.captureState:true populates a `state` field on each cascade —
//   a structuredClone of the source view's value at cascade close (the
//   post-cascade state). Off by default since structuredClone'ing the
//   source value per cascade is meaningfully more expensive than the
//   bare frame-recording path.
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

Open `http://127.0.0.1:3000/examples/todo-jsx/?devtools` after
`npm run serve`, then in the browser console:

1. `$.graph(items)` — tree shows root + the three filter operators + the
   length operators chained off them.
2. `$.inspect(items)` — value is the localStorage object; sinks list the
   filter operators.
3. `$.fromDOM($0)` after picking a `<li>` — returns the proxy for that todo
   item; reading its `[value]` matches the visible text.
4. `$.highlight(items.filter('completed', true))` — outline class briefly
   added to the `<ul>` bound to the active filter.
