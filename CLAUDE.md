# CLAUDE.md

Guide for Claude sessions working in this repo. Read this before making changes.

## What this is

A small TypeScript reactive data library. `$(value)` wraps a value or array into a `ViewProxy`; chainable operators (`filter`, `between`, `gt`/`lt`/`gte`/`lte`, `sort`, `length`, `sum`/`avg`/`max`/`min`, `some`/`every`, `intersect`/`union`/`except`, `group`/`distinct`, `map`/`to`/`reduce`, `tap`, `keys`/`values`, `reverse`) produce derived reactive views; [render/index.ts](render/index.ts) attaches reactive data to the DOM via `HTML.*`/`SVG.*` builders. JSX authoring is supported via [jsx/index.ts](jsx/index.ts) (`h`, `Fragment`, `For`), re-exported from `data/full`. Inspection helpers live behind the opt-in `data/devtools` entry — see [devtools/README.md](devtools/README.md).

## Source layout and build

`.ts` files at the root and under `operators/`, `render/`, `jsx/`,
`devtools/`, `tests/` are the source of truth. `.gitignore` blanket-ignores
`*.js`; build output goes to `dist/` (gitignored). There are **no committed
`.js` siblings of `.ts` sources** — that scheme was retired. A handful of
hand-written `.js` files remain in tree (e.g.
[render/render.test.js](render/render.test.js),
[assets/landing.js](assets/landing.js), `examples/crossfilter/flights*.js`)
because they have no `.ts` counterpart.

`tsup` produces eight sub-path entries that line up 1:1 with the `"exports"`
map in [package.json](package.json):

| Sub-path                | Source       | What it ships |
|---|---|---|
| `data`                  | [index.ts](index.ts)                          | **Default entry.** Core (`$`, `value`, `render`, `HTML`, `SVG`, `Operators`, `createOperator`) **plus every operator registered** on the dispatch table — `proxy.filter(...)` works the moment you import `$`. This is the entry consumers (and generated code) should reach for. |
| `data/lean`             | [lean.ts](lean.ts)                            | Registration-free core: the same exports as `data` *minus* the operator dispatch side effect. Pick this only to tree-shake operators you don't use (and register a subset onto `Operators` yourself, or call the function-style operator API). Calling `.filter(...)` on a `data/lean` proxy throws, pointing back at `data`. |
| `data/full`             | [full.ts](full.ts)                            | Strict superset of `data` — everything in the default entry plus the JSX helpers (`h`, `Fragment`, `For`, `jsx`, `jsxs`, `jsxDEV`). Import this only when you author views in JSX. |
| `data/render`           | [render/index.ts](render/index.ts)            | Just the DOM render layer (`render`, `HTML`, `SVG`). |
| `data/devtools`         | [devtools/index.ts](devtools/index.ts)        | Opt-in inspection helpers — importing this attaches `$.inspect`, `$.graph`, `$.fromDOM`, `$.highlight`, `$.trace`, `$.profile`, `$.cascades` onto the canonical `$`, AND lazy-loads + auto-mounts a graph-first right-edge overlay panel ([devtools/panel/index.ts](devtools/panel/index.ts)). The panel has a Tree/DAG layout toggle, a slide-in inspector with three tabs (Inspect / Events / Profile), a DOM picker (◎), Alt-hover badges (⊙ or hold Alt), and a draggable left-edge resize handle (width persisted to `localStorage` under `data-devtools-dock-width`). Append `?nopanel` to the URL to suppress the panel; `$.devtools.panel.{open(proxy?), close(), shell}` for explicit control / reaching into the closed shadow root from tests / console. |
| `data/jsx-runtime`      | [jsx-runtime.ts](jsx-runtime.ts)              | Automatic JSX runtime entry — `jsx`, `jsxs`, `Fragment`. Picked up when a consumer sets `"jsxImportSource": "data"` in their tsconfig. Same NodeProxy/DOMSink semantics as the classic `h` transform. |
| `data/jsx-dev-runtime`  | [jsx-dev-runtime.ts](jsx-dev-runtime.ts)      | Dev-mode counterpart — `jsxDEV`, `Fragment`. |

Tests do **not** require a build: `node --experimental-strip-types` reads
`.ts` directly. Run `npm test`. Examples *do* require a build because they
import from `dist/` via an import map; `npm run serve` chains `tsup` (and a
small `tsc` pass for the JSX example projects via `build:examples-jsx`)
before the static server.

JSX projects extend a single shared [tsconfig.jsx.json](tsconfig.jsx.json)
(jsx: react, jsxFactory: h, jsxFragmentFactory: Fragment) — both example
dirs ([examples/todo-jsx/tsconfig.json](examples/todo-jsx/tsconfig.json),
[examples/crossfilter-jsx/tsconfig.json](examples/crossfilter-jsx/tsconfig.json))
and [jsx/tsconfig.json](jsx/tsconfig.json) just `extends` it. New JSX
sub-projects should follow the same pattern rather than duplicating the
compilerOptions.

## Commands

From [package.json](package.json):

| Command | What it does |
|---|---|
| `npm test` | Runs `*.test.ts` via `node --experimental-strip-types --test` |
| `npm run perf` | Runs `*.perf.ts` (median-of-5 timing assertions) |
| `npm run test:render` | Playwright e2e against `examples/` |
| `npm run serve` | `tsup` build + static server on `:3000` for examples |
| `npm run build` | `tsup` → `dist/` (ESM + per-entry `.d.ts`) |
| `npm run test:all` | Both unit and Playwright tests |

Tests run TypeScript directly via `--experimental-strip-types` — no compile step needed for testing.

## Public API

- `$(value)` → `ViewProxy`. Read raw value with `proxy[value]` (the `value` Symbol from [core.ts:4](core.ts#L4)). Mutate via assignment: `proxy.foo = 1`, `proxy[2].completed = true`, `delete proxy[1]`, `proxy[value] = newValue`.
- Operators chain off the proxy: `data.filter(d => d.active).between('val', [0, 100]).length()`. The chainable form requires the dispatch table to be populated, which happens automatically when you import from `data` (the default entry, [index.ts](index.ts)) or `data/full`. The registration-free `data/lean` entry ([lean.ts](lean.ts)) leaves the table empty; calling `.filter(...)` on a proxy sourced from `data/lean` throws an error pointing the user back at `data`. The canonical dispatch list lives at [index.ts:33-108](index.ts#L33-L108). The dispatch picks a class based on argument shape (e.g. `filter(fn)` → `FilterValue`, `filter('key', val)` → `FilterStringValue`, `filter({k:v})` → `FilterObjectValue`).
- `render(el, template)` from [render/index.ts](render/index.ts); `HTML.div(...)`, `SVG.path(...)` builders.
- `h(tag, props, ...children)`, `Fragment`, `For` from [jsx/index.ts](jsx/index.ts) (re-exported by `data/full`) — JSX adapter over the same builders. `<div className="x">{c}</div>` desugars to `h("div", {className:"x"}, c)` which returns the same `NodeProxy` AST `HTML.div.x(c)` produces. Same `render()`, same `DOMSink`, same per-key surgical updates. ViewProxy children with no function sibling route through `.text()` (preserves element identity); with a function sibling they stay on the data path so `[VP, fn]` keeps working as a data-iteration shorthand.
- `connect` is built-in (not an operator): `proxy.connect([])` returns the array and pushes change events into it; `proxy.connect(obj, 'prop')` mirrors the value to `obj.prop`; `proxy.connect(obj, fn)` calls `fn(change)` on each event. See [core.ts:601-622](core.ts#L601-L622).
- `raf` is built-in (not an operator): `const write = proxy.raf()` returns a coalescing writer. `write(v)` schedules one `requestAnimationFrame` that commits the latest pending value to `proxy[value]`; subsequent calls before the frame fires overwrite the pending value. `write.flush()` commits immediately and cancels the pending frame — for `pointerup` handlers that want the final position to land without an extra frame's latency. Falls back to `setTimeout(cb, 16)` outside the browser. See the `raf` helper near the bottom of `core.ts`.
- `first` / `last` are built-ins (not operators): `proxy.first()` / `proxy.last()` return the child ViewProxy at the source's first / last key (snapshot at call time). Arrays use index 0 / `length - 1`; objects use the first / last enumerable key. Empty sources collapse to key `'0'` so the chainable shape is uniform. See `firstKey` / `lastKey` near the `raf` helper.
- Aggregates `sum(col?)`, `avg(col?)`, `max(col?)`, `min(col?)` return scalar ViewProxies. `col` is optional — without it, the aggregate runs over row values directly; with it, over `row[col]`. `sum`/`avg` are O(1) per delta (running total + count); `max`/`min` recompute O(n) per publish. Empty set → `undefined` (rather than `NaN` for avg / `0` for max/min). Implemented in [operators/aggregate/](operators/aggregate/).
- `tap(fn)` has two paths picked by `fn.length`: a **1+-arg** fn (`(change) => ...`) gets full change records — `{ type, key, value, at? }` with `value` `structuredClone`'d, fired once per row in a batched verb. A **0-arg** fn (`() => render()`) routes to `TapBareValue` — no clone, no record allocation, fires fn once *per emit* (one BU1/BU2/BI0 batch = one fn call). The bare path is for hot-path consumers that re-read `proxy[value]` inside their callback (chart redraws, count-textContent updates); 40%+ faster on the [tap.perf.ts](operators/tap/tap.perf.ts) batch case. The 0-arity check is strict — `(c) => doThing()` (length 1) keeps the full path so a minifier-driven param drop can't silently downgrade real consumers. Defined in [operators/tap/index.ts](operators/tap/index.ts); dispatched in [index.ts](index.ts).
- `reduce` has two arities. `reduce(fn, init)` is the general fold — non-commutative, rebuilds on every change. `reduce(add, remove, init)` is incremental: BI0/BR1 thread through `add`/`remove` in O(Δ); BU1/BU2 still fall back to rebuild because the framework doesn't carry the old value at those entry points. Pick the 3-arg form when (i) your fold is invertible per-row (you can write a `remove` that exactly cancels an `add`), and (ii) the workload is insert-/remove-driven — typically downstream of `intersect`/`between` where filter changes manifest as enter/leave events. `init` can be a value or a thunk; thunk fires on each full rebuild for folds that mutate the accumulator in place. Crossfilter-shaped "bucketed sum / running stat / top-K per group" workloads go here; `length(fn)` already handles bucketed counts incrementally so use that when counts are all you need.

## Adding a new operator

The canonical, full checklist lives in [operators/README.md](operators/README.md#adding-an-operator--checklist) — follow it top-to-bottom. This is a summary so you don't miss any step at a glance:

1. **Code:** `operators/<name>/index.ts` (class + factory; extend `Operator` from [core.ts:233](core.ts#L233) or `RowOperator` from [row.ts:5](row.ts#L5)); `matches(...args)` for dedup; `<name>.test.ts`; `<name>.perf.ts`.
2. **Dispatch:** register in [index.ts](index.ts) (the default `data` entry, in the `Operators[...]` block) so `proxy.<yourOp>(...)` works. `data/full` inherits it via `export * from './index.ts'`.
3. **Per-operator docs:** `operators/<name>/README.md` covering signatures, examples, behaviour.
4. **Catalog docs:** add the operator to [operators/README.md](operators/README.md) catalog + dispatch example, [README.md](README.md) operator table + opener blurb, and this file's `## What this is` paragraph and the dedup gotcha (if applicable).
5. **Peer benchmark (optional):** `comparisons/bench/operators/<name>.bench.ts` mirroring [comparisons/bench/operators/filter.bench.ts](comparisons/bench/operators/filter.bench.ts); then regenerate [operators/BENCHMARK.md](operators/BENCHMARK.md) + the per-op BENCHMARK files via `npm run bench:ops > /tmp/bench.md && node comparisons/bench/operators/_gen-bench-md.mjs /tmp/bench.md`.
6. **Verify & commit:** `npm test` + `npm run perf` must pass; commit per the working conventions below.

For deeper internals — the View/Sink contract, when each notification method fires, parent/child propagation — see [.claude/architecture.md](.claude/architecture.md).

> **Keep the two checklists in sync.** When the standard changes (e.g. a new doc location is added, like the recent per-op `BENCHMARK.md`), update both this summary AND the canonical list in [operators/README.md](operators/README.md#adding-an-operator--checklist) in the same change.

## Notification code legend (quick reference)

The terse method names on `Value`/`View`/`Sink` follow this scheme:

- **Prefix**: `X` = root-level (no key context); `B` = branch (operating on a sub-key).
- **Verb**: `U` = update; `I` = insert; `R` = remove.
- **Suffix digit**: depth of the key path: `0` = direct (no key, or insert position), `1` = single name, `2` = full nested path.

The full set actually used: `XU0`, `XR0`, `BU1`, `BU2`, `BI0`, `BI2`, `BR1`, `BR2`. There is no `BU0`/`BR0`/`BI1` — those collapse to `XU0`/`XR0` and `BI0` respectively.

`NU1`/`NI0`/`NR1` you'll see inside `RowOperator.loop` ([row.ts:9](row.ts#L9)) and `Value.BU1` ([core.ts:148](core.ts#L148)) are **local accumulator arrays** ("New U1 list"), not separate notification methods.

For a fuller breakdown see [.claude/architecture.md](.claude/architecture.md).

## Testing patterns

- `node:test` + `node:assert` (`deepStrictEqual` aliased as `same`, `ok`).
- Override `$.random` for deterministic IDs — see [core.test.ts:7](core.test.ts#L7).
- Capture changes with `res.connect([])`, then assert event shape `{ type: 'update'|'insert'|'remove', key, value, at? }`. See [core.test.ts:9-20](core.test.ts#L9-L20).
- Tests assert downstream views *and* their parent in the same case (e.g. [core.test.ts:134-173](core.test.ts#L134-L173) checks `res`, `res.a`, `res.a[0]`, `res.a[1]`, `res.a[2]` simultaneously).

## Performance test patterns

- Median of 5 `performance.now()` runs, threshold via `ok(elapsed < N)`. Reference: [filter.perf.ts](filter.perf.ts).
- Each `*.perf.ts` typically covers: setup cost, single-row incremental update, batch update.
- Don't widen thresholds to make a perf test pass — investigate the regression. Recent commits (`perf: incremental LimitValue with large-batch fallback`, `perf: rAF-coalesce brush input in crossfilter example`) show active perf work; respect it.
- `npm run bench:compare` runs the cross-library comparison harness in [comparisons/bench/](comparisons/bench/) (this lib vs. crossfilter / MobX / RxJS / Solid / Preact / Vue / Svelte / React) on the canonical `map → filter → top-K` workload. `npm run bench:ops` runs the **per-operator** comparison harness in [comparisons/bench/operators/](comparisons/bench/operators/), exercising each operator in isolation against the same peer set and printing one markdown table per operator plus a regressions section flagging cases where `data` isn't fastest. `BENCH_OPS=filter,map npm run bench:ops` runs a subset. Both **report**, they do not gate — peer regressions don't fail this repo's CI. The in-browser comparison demo [examples/multidim/](examples/multidim/) runs the same workload across the same nine libraries with live per-row reactive-cost trackers. The landing page ([index.html](index.html)) is now the comparison surface itself: a **single-card carousel** ([assets/race.js](assets/race.js)) that flips through nine reactive engines on one realistic order-book tick stream (depth-chart-and-ladder viz in [assets/race-views.js](assets/race-views.js)), always running `data` as a baseline so the per-frame cpu gap shows on one card. **The same carousel drives a second co-located workload**: directly below the order-book card, one inline brushing row from `examples/multidim/` for the *same* selected engine (not all nine at once) — `loadFlights()` streams the 231k-row dataset once (lazy, on scroll, determinate bar), then `mountLibRow()` mounts the selected engine's row over the cached flights; both exported from [examples/multidim/main.js](examples/multidim/main.js), styles scoped under `.race-multidim` in [assets/multidim.css](assets/multidim.css). Each engine's brushing row is **mounted once and kept alive** (toggled via `[hidden]`, not destroyed) so switching back to it stays warm — re-mounting cold made the first few brushes slow every time. No iframe, no workload toggle. Each order-book engine is defined inline in `race.js` and **settles once per frame** (not per tick) — that's what lets all nine, including the eager O(N) libs, run live at N=150k; switching engines drops the rate to a per-engine safe default. The standalone `examples/trades/` dashboard the order-book *style* came from was retired once the carousel absorbed it. Peers load from esm.sh via `index.html`'s importmap (all nine: mobx, solid, preact, vue, crossfilter2, rxjs, react/react-dom, svelte/store) — if you bump peer versions, bump them there and in `examples/multidim/`'s importmap. (The standalone `comparisons.html` + `assets/landing.css` + `assets/comparisons.css` were removed once the landing page absorbed them.) Smoke test: [tests/race.spec.ts](tests/race.spec.ts).
- Each operator owns a `BENCHMARK.md` (e.g. [operators/filter/BENCHMARK.md](operators/filter/BENCHMARK.md)) that records the latest `bench:ops` table for that operator plus a "How" section explaining why `data` wins (or what's deferred when it doesn't). **Update the BENCHMARK.md whenever you change the operator's hot path** — the numbers drift, and a stale BENCHMARK.md is worse than no BENCHMARK.md. Workflow: `BENCH_OPS=<op> npm run bench:ops`, copy the table into `operators/<op>/BENCHMARK.md`, commit alongside the code change.

## Examples

- [examples/todo/](examples/todo/) — basic mutation + filter + length.
- [examples/crossfilter/](examples/crossfilter/) — chained `between → intersect → length(group) → za → limit` over ~500 flight records.
- [examples/spreadsheet/](examples/spreadsheet/) — a reactive spreadsheet. The library holds per-cell display values in one `$()` proxy and `render` binds each cell, so a recompute repaints only the cells whose value changed; the formula layer (parser + dependency graph + topological recompute + cycle detection) is hand-rolled on top in [examples/spreadsheet/main.js](examples/spreadsheet/main.js) — the lib is a reactive collection engine, not a formula engine, so the cell→cell DAG lives outside it. `.js` clears the repo's `*.js` ignore via `!examples/spreadsheet/**/*.js` in [.gitignore](.gitignore). Smoke test: [tests/spreadsheet.spec.ts](tests/spreadsheet.spec.ts).
- [examples/datagrid/](examples/datagrid/) — a virtualized grid over 1,000,000 rows. Split by what each tool is good at: plain JS owns filter/sort/virtualization (a linear scan + index sort over 1M is tens of ms; you only ever build ~40 DOM rows), while the library owns the two reactive things — it binds the visible window (`$(windowRows)` → `render`, so scrolling surgically rewrites only changed cells) and maintains GLOBAL aggregates (`sum('value')`, `avg('price')`, `length(fn)` for gainers) that update O(Δ) per tick when the "stream" toggle mutates ~4k rows/frame. NB: wrapping `$(1M array)` is lazy (~0ms) and single-cell mutations are ~µs, but `filter` *setup* over 1M is ~1.8s — hence filtering is done in JS, not via a rebuilt lib filter per interaction. A splash paints before the 1M-row build blocks the thread. `.js` cleared via `!examples/datagrid/**/*.js` in [.gitignore](.gitignore). Smoke test: [tests/datagrid.spec.ts](tests/datagrid.spec.ts).
- [examples/metrics/](examples/metrics/) — a live metrics / observability board. One request firehose streams into a fixed-size ring buffer (last `WINDOW` events overwritten cyclically), so the working set is BOUNDED; the lib keeps every panel incrementally — `length(e=>e.status)` (status codes), `length(e=>e.endpoint)` (endpoint leaderboard), `length(e=>band(e.lat))` (latency bands), `avg('lat')` — each O(Δ) per overwrite. Reactive numbers bind via `render` (surgical text); bar widths + the throughput sparkline paint once per frame reading the already-maintained aggregates (the established settle-once-per-frame cadence). `.js` cleared via `!examples/metrics/**/*.js` in [.gitignore](.gitignore). Smoke test: [tests/metrics.spec.ts](tests/metrics.spec.ts).
- [examples/pivot/](examples/pivot/) — a pivot table over ~50k rows. Every cell is one group's roll-up, computed by a single incremental `reduce(add, remove, () => ({}))` keyed by `rowVal+colVal` and storing `{s,n}` per cell, so a streamed insert/evict moves O(1) cells (probed: insert/delete update exactly the right cell). Sum/avg/count + row/col/grand totals read off that one accumulator. Changing a dimension/measure recompiles the key fn (one-pass O(n) rebuild). Two render gotchas this example documents: (1) `render(target, template)` mounts the template's *children* into `target` (so a `<table>` must be a child of the wrapper builder, not the top-level template, or it's dropped and its rows mount bare); (2) `render` *appends* on each call, so re-rendering on a dimension change must `wrap.replaceChildren()` first or it stacks a second table. Values paint once per frame from the maintained accumulator. `.js` cleared via `!examples/pivot/**/*.js` in [.gitignore](.gitignore). Smoke test: [tests/pivot.spec.ts](tests/pivot.spec.ts).
- [examples/todo-jsx/](examples/todo-jsx/) and [examples/crossfilter-jsx/](examples/crossfilter-jsx/) — same two apps written in JSX rather than the builder DSL. Both `tsconfig.json` files extend the shared [tsconfig.jsx.json](tsconfig.jsx.json) at the repo root; `npm run serve` runs `build:examples-jsx` after `tsup` to produce the sibling `.js`. Playwright tests at [tests/todo-jsx.spec.ts](tests/todo-jsx.spec.ts) and [tests/crossfilter-jsx.spec.ts](tests/crossfilter-jsx.spec.ts) assert DOM-identity preservation across reactive updates and brush-parity with the builder version. [tests/devtools-jsx.spec.ts](tests/devtools-jsx.spec.ts) covers the panel/`$.fromDOM`/`$.inspect`/`$.graph`/`$.highlight` surface against a JSX-built tree to prove the inspection helpers work uniformly across authoring layers. The example sources type-check without `// @ts-nocheck` thanks to the per-tag intrinsic types in [jsx/jsx.d.ts](jsx/jsx.d.ts) — keep new JSX code typed the same way.
- [examples/multidim/](examples/multidim/) — interaction-driven comparison page (linked from the landing footer, and lazy-loaded into the landing hero's race when the "multidim" workload is picked). The crossfilter brushable-charts demo (4 dimensions over 231k flight records) rebuilt once per peer library — data, crossfilter, mobx, rxjs, react, solid, preact-signals, vue-reactivity, svelte/store. Each row ships its own reactive plumbing; chart drawing is shared via [examples/multidim/chart.js](examples/multidim/chart.js) so the comparison stays focused on reactive update cost, not DOM-layer differences. Per-row latency tracker ([examples/multidim/latency.js](examples/multidim/latency.js)) measures pointermove → next paint via end-of-task microtask and displays rolling p50/p95. Peer libs load via esm.sh through the importmap in [examples/multidim/index.html](examples/multidim/index.html). Smoke test at [tests/multidim.spec.ts](tests/multidim.spec.ts) is `serial` (4 parallel browsers each fetching 36MB and building a reactive graph over 231k rows make the brush → paint window non-deterministic). The new `.js` source files clear the repo's `*.js` ignore via the `!examples/multidim/**/*.js` rule in [.gitignore](.gitignore).
- The landing site ([index.html](index.html)) is a from-scratch v2: a single all-monospace editorial page that absorbed the old separate comparisons page. Centrepiece is a live race ([assets/race.js](assets/race.js)): a **single-card carousel** (prev/next + a select cycle through nine engines, one card shown at a time, with `data` always running as the cpu baseline) over an in-page streaming order book at N=150k, and **co-located directly below it, the same carousel drives a second workload**: one inline brushing row from the 231k-row [examples/multidim/](examples/multidim/) for the *same* selected engine. `examples/multidim/main.js` is refactored into reusable exports — `loadFlights({onProgress,onStatus})` streams the dataset once (lazy on scroll, rootMargin 400px, determinate bar) and `mountLibRow({rowsEl,src,flights})` builds one library's `.mdf-row`; `race.js` caches the flights and re-mounts the single row on each carousel change. `mountMultidim()` (all nine) and the standalone page's auto-run loader still use those pieces, so [examples/multidim/](examples/multidim/) works on its own too. No iframe, no workload toggle. Its `.mdf-*` styles are mirrored scoped under `.race-multidim` in [assets/multidim.css](assets/multidim.css) (keep in sync with `examples/multidim/index.css`), and it fetches the flights dataset relative to `import.meta.url` so the path works from either page. All nine order-book engines are defined inline in `race.js` (data via real operators; the eight peers via their real primitives) and settle **once per frame** so even the eager O(N) libs survive N=150k; the order-book depth-chart + ladder viz and the dual-series cpu wave live in [assets/race-views.js](assets/race-views.js). Other page assets: [assets/v2.css](assets/v2.css) (editorial system + the order-book card / carousel styles), [assets/feed.js](assets/feed.js) (one shared `$(trades)` feed + stream), [assets/demos.js](assets/demos.js) (three live operator demos — filter/za/group — off that feed), [assets/landing.js](assets/landing.js) (bootstrap: wires the race, demos, copy, lazy devtools mount, highlighter). Operator perf is inlined as a catalogue table linking each op to its `operators/<op>/BENCHMARK.md`. Retired along the way: the first dot-grid v2 attempt (`hero.js`/`operators.js`), the `examples/ticker/` demo (its insert-rate crossover undersold `data`), the standalone `examples/trades/` dashboard (its lib-*.js order-book idioms now live as once-per-frame engines inside `race.js`), and the standalone `comparisons.html` + `landing.css` + `comparisons.css`.

All runnable via `npm run serve` then opening `http://127.0.0.1:3000/examples/todo/` etc.

## Common gotchas

- Use `proxy[value]` (the `value` symbol), **not** `proxy.value`, to read the raw underlying data. `proxy.value` would create a child view named `"value"`.
- Setting one proxy to another (`a[value] = b`) creates a `LinkedView` ([core.ts:427](core.ts#L427)) — `a` now forwards to `b`'s underlying data. See the `proxy/link` test at [core.test.ts:83-132](core.test.ts#L83-L132) for the full semantics.
- Operator dedup is opt-in via a `matches()` method. `between` ([operators/between/index.ts:6](operators/between/index.ts#L6)), `gt`/`lt`/`gte`/`lte` ([operators/compare/index.ts](operators/compare/index.ts)), `sort`/`za`/`az`/`top` ([operators/sort/index.ts:6](operators/sort/index.ts#L6)), `intersect` ([operators/intersect/index.ts](operators/intersect/index.ts)), the scalar aggregates `sum`/`avg`/`max`/`min`/`some`/`every` ([operators/aggregate/index.ts](operators/aggregate/index.ts)), `distinct` ([operators/distinct/index.ts](operators/distinct/index.ts)), and `reduce` ([operators/reduce/index.ts](operators/reduce/index.ts)) implement it; repeated calls with identical args return the cached view. `filter`, `map`, `length`, `group`, `to`, `tap`, `union`, `except`, `keys`, `values`, `reverse` create a fresh operator on every call.
- Sinks are held via `WeakRef` ([core.ts:421](core.ts#L421)). Dropping the only strong reference unsubscribes silently. Tests keep `connect([])`'s return alive in a local for this reason.
- `between()` and similar range operators with reactive bounds (`ViewProxy` args) track their inputs reactively; with plain values they don't. `gt`/`lt`/`gte`/`lte` only take literal bounds — for a moving threshold, derive a fresh view (`src.gt('val', t[value])`) or use `between` with a reactive lo/hi.
- Pick `gt`/`lt`/`gte`/`lte` over `between(col, [T, Infinity])` when you need a single-threshold filter: same semantics, but RowOperator-based (O(1) per BU2 vs `between`'s sort-index maintenance on setup + threshold change). See [experiments/wasm/results-altbackend.md](experiments/wasm/results-altbackend.md) for the gap.
- Mutations on nested data work transparently: `res.a.b.c = 1` triggers the right notification cascade. No need for immutable updates.
- JSX `<label>{vp}</label>` routes through `.text(vp)` because there's no function sibling — preserves the host element across reactive updates. Adding a function child (`<div>{[vp, fn]}</div>` for a data binding) flips both children to the data path so `node.data = vp` and `node.fn = fn`. See the discriminator at [jsx/index.ts](jsx/index.ts) — `hasRowFn`. Don't author a single-VP child expecting iteration; use `<For>` or the `[vp, fn]` shorthand.
- `node(...)` with a single array arg auto-spreads — see `NodeProxy.apply` in [render/index.ts](render/index.ts). So `node(<Fragment>…</Fragment>)` is equivalent to `node(...children)`. Bare arrays as the only positional arg weren't a documented builder pattern, so this was purely additive.
- A `ViewProxy` is a callable `Proxy`, so `typeof proxy.then === 'function'` — the runtime treats it as a thenable. `await proxy` (and `Promise.resolve(proxy)`, `Promise.all([...,proxy])`, returning one from an `async` fn) resolves to the current snapshot, equivalent to `proxy[value]`. This is handled by a guard in `ViewProxy.apply` ([core.ts:858](core.ts#L858)) that recognises promise assimilation by its call signature (`then` *called* with a leading function arg) and distinguishes it from genuine `.then` data access (which only *reads* the child view, never calls it) — so a key literally named `then` still works as `proxy.then[value]`. Don't rely on awaiting a proxy for async sequencing; it's synchronous snapshot sugar, not a real promise.

## Working conventions in this repo (please follow)

- **Keep docs in sync with code.** When you change behavior, the public API, commands, or conventions, update the relevant docs in the *same* change:
  - `CLAUDE.md` for Claude-facing notes (this file).
  - [.claude/architecture.md](.claude/architecture.md) for internals (notification codes, View/Sink contracts, propagation rules).
  - [README.md](README.md) for human-facing usage and API examples.
  
  If you add or remove an operator, update the dispatch description and gotchas here, the legend (if it touches notification codes) in `architecture.md`, and the examples in `README.md`. Stale docs mislead future sessions — assume someone will trust them.

- **Commit granularly with detailed messages.** One logical change per commit (one bug fix, one perf improvement, one doc update — *not* bundled). Follow the existing style visible in `git log`: Conventional-Commits-ish prefixes like `fix(core): ...`, `perf: ...`, `fix(examples/todo): ...`, `docs: ...`. Each message body should explain *why* the change is needed and *what* its visible or internal effect is — not just restate the diff. Commit immediately after each logical change rather than batching at the end of a session, so a partial revert is always possible.

- **Before committing, present the change for review.** Don't commit silently. For each logical change, surface to the user (in chat):
  1. **What changed** — a brief plain-language summary of the diff: which files, which functions/sections, the user-visible or internal effect. For non-trivial code, include the diff itself or the key hunks.
  2. **Why** — the motivation (bug being fixed, regression being prevented, refactor rationale, perf hypothesis).
  3. **Test results** — the relevant tail of `npm test` output (pass count + any test names you added). For bug fixes, name the regression test you added.
  4. **Perf results** — for code changes, the relevant `npm run perf` numbers, ideally with a before/after comparison if you have it. For doc-only changes, state explicitly that perf is N/A and why.
  5. **Anything else relevant** — e.g. a known limitation, a follow-up TODO, a file you intentionally left out of the commit, an unrelated working-tree change you did *not* stage.

  Then commit. The user should never have to read the diff after the fact to understand what landed. Skipping this step also skips the chance to catch a problem before it's in history.

- **Run tests on every change. Extend them if the existing suite doesn't cover the change.** Before committing any code change, run `npm test` and confirm all 62+ tests pass. If your change adds or modifies behavior that isn't already exercised — a new operator, a new branch in an existing operator, a fixed bug, a new edge case — add a test for it in the corresponding `*.test.ts` file. The recently added `proxy/link - child propagation` test in [core.test.ts](core.test.ts) is a good template: it documents *why* the test exists (which regression it catches) in a comment, and asserts both the data shape *and* the change-event stream. A bug fix without a regression test invites the same bug to come back.

- **Run perf tests on every change. Watch for regressions; extend the suite if the change has a new perf surface.** Before committing, run `npm run perf` and confirm all assertions pass *and* the printed timings haven't drifted upward versus what `git log` and the existing thresholds suggest. The thresholds in `*.perf.ts` are guard rails — a change that only just squeaks under one is suspicious. If your change introduces a new hot path or a new operator, add corresponding setup / single-update / batch-update cases to the relevant `*.perf.ts` (or create a new one), following the median-of-5 + `ok(elapsed < N)` shape from [filter.perf.ts](filter.perf.ts). Don't widen thresholds to make a failing perf test pass — investigate the regression instead.

- **Don't undo recent perf work.** Before refactoring `sort.ts` (`LimitValue`), `core.ts` (`LinkedView` propagation), or the crossfilter example's brush handling, check `git log` for recent `perf:` / `fix(core):` commits and understand what they were optimizing.
