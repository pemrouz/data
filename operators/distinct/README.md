# distinct

Materializes the source's distinct values as an array, in first-seen iteration order. An optional `fn` projects each row to a comparison key — rows projecting to the same key collapse to the first one seen.

## Signatures

```ts
proxy.distinct<K>(fn?: (row) => K)            // DistinctValue, fn defaults to identity
```

Dispatch lives in [../../register.ts:89](../../register.ts#L89).

## Examples

```js
$([1, 2, 1, 3, 2, 4]).distinct()                  // → [1, 2, 3, 4]

$([
  { airline: 'AA', flight: 1 },
  { airline: 'UA', flight: 2 },
  { airline: 'AA', flight: 3 },
  { airline: 'DL', flight: 4 },
]).distinct(r => r.airline)                        // → [AA·1, UA·2, DL·4]  (first of each)

const res = $(['a', 'b', 'a'])
const d = res.distinct()                           // ['a', 'b']
res.insert('c')                                    // ['a', 'b', 'c']  — new key appends
res.insert('a')                                    // ['a', 'b', 'c']  — existing key: no-op
```

## Behavior

- **Incremental on inserts and deep updates** — `BI0` (insert) and `BU2` (in-place field edit) thread through in O(1): a per-projection-key count plus a `name → projection` map let each delta bump or admit/drop a single bucket. `BI0` of a fresh projection pushes one row to the output; a duplicate just increments the bucket count and emits nothing. `BU2` decrements the row's old bucket and increments the new, editing the output array only when a bucket crosses the 0 / >0 boundary (the row at `name` keeps its name, just re-projects).
- **Removes rebuild** — `BR1`/`BR2`, plus `BU1`/`XU0`/`XR0`/`BI2`, fall back to a full `_rebuild()`. The suite encodes a "first-seen order tracks current source iteration order" semantic, so removing the row that supplied a bucket's first instance can re-order *other* buckets — not expressible as O(1) array edits. Crossfilter-shaped workloads (BI0-heavy ingestion, BU2-heavy attribute rewrites) stay on the incremental path; see [BENCHMARK.md](BENCHMARK.md).
  - Example: `$({ x: 'a', y: 'b', z: 'a' }).distinct()` is `['a','b']`; after `delete res.x` the live iteration order is `y, z`, so first-seen flips to `['b', 'a']` (`'a'` still present via `z`).
- **Dedup** — `distinct` implements `matches(fn)` ([index.ts:36](index.ts#L36)), comparing against `fn || identity`. Calling `proxy.distinct(sameFn)` (or `proxy.distinct()` twice) returns the cached view; a different fn reference builds a fresh one.
- **Array-upstream guard** — when the source is an array, `BI0`/`BU2` rebuild instead of taking the O(1) path: array upstreams (sort/limit windows, mid-array inserts) deliver positional `at`/path indices that collide with the name-keyed `namesProj` map. Object sources keep the incremental path.
- **Edge cases** — empty source → `[]`. Rows projecting to `undefined` (sparse/`undefined` slots left by `between`/`intersect`/`union`/`except`) are skipped, not counted as a distinct value. Empty `I0`/`U2` batches short-circuit (perf-sensitive — preserve when modifying).
- **Output is a snapshot array** — the view holds a plain array of the first-seen rows; downstream consumers read it as a list. Unlike `length(fn)`'s `{ value: count }` buckets, there's no per-key wrapper here — `distinct` exposes the rows themselves, not counts.
