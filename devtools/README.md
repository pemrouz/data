# devtools

Optional, opt-in inspection helpers for the reactive data library. Importing
`data/devtools` (or, in source form, `./devtools/index.ts`) attaches a handful
of methods to the canonical `$` so they're discoverable from the browser
console: `$.inspect`, `$.graph`, `$.fromDOM`, `$.highlight`, plus (in the
forthcoming layer) `$.trace` and `$.profile`.

## Why opt-in

The core has zero per-notification overhead today. The two tiny passive
hooks needed by devtools (`_devtoolsRoots: WeakSet<View>` in `core.ts` and
the non-enumerable `__ripple_sink` property on bound DOM elements) are
unconditional but free in steady state. Anything that *does* touch the hot
path — trace and profile, which monkey-patch `View.prototype` — only runs
when you explicitly call `$.trace(p)` or `$.profile()`.

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
