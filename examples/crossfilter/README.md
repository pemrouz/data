# crossfilter — fast multidimensional filtering for coordinated views

**Square's classic Crossfilter demo rebuilt on `data`: brushable histograms over
231k US-domestic flight records, where every chart, the count, and the flight
table are reactive views derived from one `flights` source.** The original ships
a purpose-built multidimensional index; here brushing a chart mutates a filter
range and the dependent views recompute incrementally — no scheduler, no manual
invalidation.

```js
const dims = {                                                  // one bound per dimension
  delay:    flights.between('delay',    filters.delay),
  distance: flights.between('distance', filters.distance),
  date:     flights.between('date',     filters.date),
  time:     flights.between('time',     filters.time),
}
const active = flights.intersect(dims)                          // AND every dimension
charts.time.data = flights.intersect(dims, 'time').length(byHour) // all dims EXCEPT mine
const list      = active.limit(80).group(formatDate)           // top-80, grouped by day
```

## What it exercises

- **`between(col, reactiveBounds)`** — each dimension is `flights` filtered by one
  `[lo, hi]` range read off the shared `filters` proxy. The bounds are
  `ViewProxy`s, so a brush writing `filters.delay = [lo, hi]` re-runs *only* that
  dimension's `between`, not the others.
- **`intersect(dims)` / `intersect(dims, name)`** — `active` ANDs all four
  dimensions for the count and the table. Each chart asks for `intersect(dims,
  'time')` — every dimension *except* its own — so brushing one histogram updates
  the others but not itself (the textbook crossfilter coordination). Naming the
  `dims` set once means adding a dimension is one line, none in the chart code.
- **`length(fn)` bucketed counts** — `length(byHour)` / `length(byTenMins)` /
  `length(byFiftyMiles)` / `length(byDay)` are the histogram bars; each bucket is
  `{ value: count }`, so the SVG path reads `groups[i].value`. `data.max('value')`
  drives the y-scale, also a live view.
- **`za('date', Infinity)`** — `flights` is sorted by date once at construction
  (a full sort, not a window) so the grouped table reads chronologically.
- **`limit(80).group(formatDate)`** — the flight table is the top-80 of the
  intersected set, grouped into day sections; both recompute as the brush moves.
- **`raf()`-coalesced brushing** — every brush/resize/extent-drag handler writes
  bounds through `filter.raf()` and `.flush()`es on `pointerup`, so a fast drag
  commits one cascade per frame instead of one per `pointermove`
  (commit `perf: rAF-coalesce brush input in crossfilter example`).
- **Streaming loader** — `flights.js` (~36 MB / 231,083 rows) is stream-fetched
  with a live bytes/sec progress bar, then dynamic-imported via a Blob URL so the
  first paint isn't blocked by a silent multi-second module load.

## Known gap

`group` over an **array** source can leave a stale DOM row on a front-removal
array shift — the flaky `crossfilter brush leaves no stale DOM rows` spec. This
is a render-layer edge of array-keyed `group` (the data layer is correct), not
unique to this example.

## Run

`npm run serve` (the example imports from `dist/`, so a build is required), then
open `http://localhost:3000/examples/crossfilter/`. Wait for the loader to stream
the dataset, then click-and-drag on any histogram to brush; drag the brush body
to slide it, the handles to resize, or **reset** to clear a dimension. The "N of
231,083 flights selected" counter and the day-grouped table track every brush.
Append `?devtools` to the URL to load the inspection panel. See [index.html](index.html).
