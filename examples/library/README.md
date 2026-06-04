# library

A faceted media browser where **browsing is set algebra**.

```js
const movies = $({})
genreFacet  = filter(g1).union(filter(g2), …)         // OR within a facet
ratingFacet = movies.between('rating', ratingBounds)  // reactive range
selected    = movies.intersect(genreFacet, decadeFacet, ratingFacet, …)  // AND across
final       = selected.except(excludedFacet)          // minus exclusions
display     = final.za('rating', pageSize)            // bounded top-K (sorted + paged)
```

## What it exercises (the set-algebra operators)

- **`union`** — selecting two genres OR-s their per-genre filtered views.
- **`intersect`** — every facet (genre, decade, rating, runtime, search) is a
  source; a row shows iff it's in all of them.
- **`except`** — the "exclude genre" chips subtract a union of views.
- **`between`** — the rating / runtime sliders mutate reactive bounds.
- **`distinct`** / fixed domains drive the facet value chips.
- **bounded `za('rating', pageSize)`** — a top-K window does the sort *and* the
  paging in one operator; "load more" re-points it to a larger `pageSize`. This
  replaced `za('rating').limit(n)` — the unbounded sort materialized and
  re-spliced the full in-range set (thousands of rows) on every brush tick.

Facet selections re-point the per-facet `$(view)` sources; the chain downstream
recomputes incrementally and the card grid catches up surgically.

## Brushing performance

The rating / runtime sliders write their bounds through a **rAF-coalesced
writer** (`ratingBounds.raf()`), so a fast drag commits one `between → … → za`
cascade per frame instead of one per `input` event. A brush does **not** repage
— the bounded `za` window re-windows itself reactively; `repage()` only runs
when `pageSize` actually changes (load more / facet reset).

This example also drove a library fix (`perf(sort)`): a bounded `za` brushed on
its own sort column used to re-render the whole grid every step, because the
window refilled from the next-ranked row after each in-window eviction — and on
a top-of-order batch (exactly what a rating brush is) that refill row is itself
in the doomed batch, so it was inserted then immediately re-evicted (O(Δ)
churn). `za` now reconciles a multi-row batch once (≤ window positional
updates). Smooth brush step: ~431 ms → ~2 ms; fast coalesced drag: ~4 s → ~40 ms.

## Library bugs it surfaced

Two correctness fixes came out of this example:

1. **`fix(intersect)`** — `intersect`'s constructor seeded its bitmask with
   `i in res.value`, wrongly admitting rows left as explicit `undefined` by a
   `between`/`union`/`except` (e.g. composing the intersection *after*
   tightening a range slider).
2. **`fix(sort)`** — `sort` over a sparse source crashed (`col(undefined)` →
   `undefined[col]`); it now skips excluded slots.

The card bindings are written **defensively** (guarding `undefined`) because
rendering an `except(intersect(…))` chain directly can momentarily surface an
excluded slot during a multi-source re-point cascade — the documented sparse-
view gotcha.

## Run

`npm run serve`, then open `http://localhost:3000/examples/library/`. Combine
genres (OR), add decade / rating / runtime constraints (AND), exclude genres,
search, and load more.
