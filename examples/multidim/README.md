# multidim — interaction-driven cross-library comparison

**The crossfilter brushable-charts demo, rebuilt once per reactive library — `data`, crossfilter, MobX, RxJS, React, Solid, Preact-signals, Vue-reactivity, Svelte/store — all running the same 4-dimension brush over the same 231,083 flight records.** Chart *drawing* is shared, so the only thing that differs between rows is how each library propagates a filter change to its derived histograms; a per-row latency tracker measures pointermove → next paint so the cost is visible, not asserted.

```js
const source = $(rawFlights).za('delay', Infinity)         // pre-sort once — source never mutates
const dims = { delay: source.between('delay', filters.delay), /* …4 dims, reactive bounds */ }
const histogram = source.intersect(dims, def.name).length(def.group) // dim's view w/ OTHER filters applied
const top5  = source.intersect(dims).limit(5)              // top-K survivors off the pre-sorted front
const active = source.intersect(dims).length()             // selected count — shared intersect dedups
```

That five-line shape is the whole `data` row ([lib-data.js](lib-data.js)); the eight peers ([lib-crossfilter.js](lib-crossfilter.js), [lib-mobx.js](lib-mobx.js), [lib-rxjs.js](lib-rxjs.js), [lib-react.js](lib-react.js), [lib-solid.js](lib-solid.js), [lib-preact.js](lib-preact.js), [lib-vue.js](lib-vue.js), [lib-svelte.js](lib-svelte.js)) each re-implement it in their own primitives.

## What it exercises

- **`between(col, bounds)` with reactive bounds** — each dimension is `source.between(col, filters[col])` where `filters[col]` is a `ViewProxy`; brushing writes `filters[col][value] = range`, and `between` walks only the rows entering/leaving the window (O(Δ)), not the 231k source.
- **`intersect(dims, name)` — the crossfilter idiom** — a dimension's histogram is fed by `source.intersect(dims, def.name)`, i.e. the source with *every other* filter applied but not its own, so a chart shows the distribution under the rest of the selection. `matches()` dedups the `dims` arg, so `intersect(dims).length()` (count) and `intersect(dims).limit(5)` (top-K) share one membership cascade.
- **`length(fn)` incremental histograms** — each chart's bars are `intersect(...).length(group)` where `group` buckets the dimension (`byHour`, `byTenMins`, `byFiftyMiles`, `byDay`); each delta adds/removes one bucket count. `max('value')` over the bucket map drives the y-scale and republishes on any bucket change.
- **`za('delay', Infinity)` then `intersect(dims).limit(5)` for top-K** — the source is sorted by delay once at mount (pure setup cost, never re-sorted because the source never mutates), so `limit(5)` reads the highest-delay survivors off the front. The note in [lib-data.js](lib-data.js) records why `intersect(dims).za('delay', 5)` was rejected — its per-row sorted-index splice was O(active-set) per delta and froze the page.
- **`tap(fn)` (0-arg, bare path) for paint** — every view's render is a 0-arity `view.tap(() => …)` that re-reads `view[value]` (`maxV.tap(update)` covers both bars and y-scale; `active.tap(renderCount)`). The tap chains are stashed on `chartsRoot._chains` so they live as long as the mounted row — drop the chain and `tap` unsubscribes (`WeakRef` sink).
- **`filters[col][value] = range` sync writes** — unlike the crossfilter example's rAF-coalesced brush, the `data` row writes on every pointermove; the cascade (`between` + `intersect` + `length(fn)` + `max` + bare `tap`) is ~2-5ms, so an extra cascade between vsyncs is cheaper than a per-input rAF wait that would inflate the latency reading.

## Architecture notes

- **[chart.js](chart.js)** is a library-agnostic brushable SVG histogram — pure DOM, no reactivity. Each row creates four, drives them imperatively (`setBars`, `setRange`), and the library wires its reactive state through the `onMarkInput` / `onRangeChange` / `onUpdate` callbacks. Keeping the DOM layer identical isolates *reactive* update cost.
- **[latency.js](latency.js)** measures latest-pointermove → end-of-task via a `queueMicrotask` scheduled on the first `markUpdate` of a cascade — so it captures the *full* per-filter-change cost even for libs that re-walk the 231k source once per histogram (mobx / rxjs / preact / vue do 6 sequential passes), not just the first `setBars`. It credits only the most recent pending input (older pointermoves were superseded before any paint), rolling p50 / p95 over the last 100 samples.
- **[main.js](main.js)** is refactored into reusable exports: `loadFlights({onProgress,onStatus})` stream-fetches the ~36 MB dataset once with a determinate progress bar (resolved relative to `import.meta.url` so the path works from either page); `mountLibRow({rowsEl,src,flights})` builds one library's row over already-loaded flights; `mountMultidim()` mounts all nine. The landing-page race ([../../assets/race.js](../../assets/race.js)) reuses `loadFlights` + `mountLibRow` to show one engine at a time. The standalone page bootstraps only when `#rows` / `#loader` are present.
- Peer libraries load from esm.sh via the importmap in [index.html](index.html) — keep versions in sync there and in the landing page's importmap when bumping.

## Run

```
npm run serve
```

Then open `http://localhost:3000/examples/multidim/`. Wait for the dataset to stream (231k records, ~36 MB, lazy with a determinate bar), then **drag on any chart in any row** to brush a range — the other three charts in that row re-aggregate, the selected count + top-5 update, and the right strip shows that row's live p50 / p95 brush latency. Compare rows to feel the per-library propagation cost. Smoke test: [../../tests/multidim.spec.ts](../../tests/multidim.spec.ts) (run `serial` — four parallel browsers each fetching 36 MB + building a 231k-row graph make the brush→paint window non-deterministic).
