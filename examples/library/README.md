# library

A faceted media browser where **browsing is set algebra**.

```js
const movies = $({})
genreFacet  = filter(g1).union(filter(g2), …)         // OR within a facet
ratingFacet = movies.between('rating', ratingBounds)  // reactive range
selected    = movies.intersect(genreFacet, decadeFacet, ratingFacet, …)  // AND across
final       = selected.except(excludedFacet)          // minus exclusions
display     = final.za('rating').limit(n)             // sorted, paged
```

## What it exercises (the set-algebra operators)

- **`union`** — selecting two genres OR-s their per-genre filtered views.
- **`intersect`** — every facet (genre, decade, rating, runtime, search) is a
  source; a row shows iff it's in all of them.
- **`except`** — the "exclude genre" chips subtract a union of views.
- **`between`** — the rating / runtime sliders mutate reactive bounds.
- **`distinct`** / fixed domains drive the facet value chips.
- **`za` + `limit`** — sorted, paged display; "load more" re-points the limit.

Facet selections re-point the per-facet `$(view)` sources; the chain downstream
recomputes incrementally and the card grid catches up surgically.

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
