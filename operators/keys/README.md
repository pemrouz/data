# keys / values

Materialize the source's current property names (`keys`) or property values (`values`) as a plain array reactive view. Built on the same `CollectionView` — `keys` projects `Object.keys`, `values` projects `Object.values`.

## Signatures

```ts
proxy.keys()      // KeysValue   — array of the source's property names
proxy.values()    // ValuesValue — array of the source's property values
```

Both take no arguments. Dispatch lives in [../../register.ts:102](../../register.ts#L102-L103).

## Examples

```js
const data = $({ a: 1, b: 2, c: 3 })

data.keys()[value]      // ['a', 'b', 'c']
data.values()[value]    // [1, 2, 3]

// Reactive: inserts append, removes/updates flow through
const k = keys(data)
data.d = 4              // k[value] -> ['a', 'b', 'c', 'd']
delete data.a           // k[value] -> ['b', 'c', 'd']

const v = values(data)
data.b = 99             // v[value] -> tracks the new value

// Arrays return string indices as keys
$(['x', 'y', 'z']).keys()[value]   // ['0', '1', '2']

// "List the categories" — pair with length(fn)/distinct
data.length(d => d.region).keys()  // the bucket labels
```

## Behavior

- **Incremental on object inserts.** A `BI0` from an object (append-at-end) upstream pushes the new name (`keys`) or value (`values`) onto the cached output array in O(1) — no rebuild. This is the hot path the benchmark exercises (~0.02ms/insert; see [BENCHMARK.md](BENCHMARK.md)).
- **Rebuild on everything else.** Removes, updates, and `XU0` rebuild the output from scratch (`Object.keys`/`Object.values` of the current source), because reverse-mapping a name to its output index is O(N) without a parallel `name→index` map. The incremental append is the only fast path today; a remove-heavy workload would justify adding the map.
- **Array-upstream inserts rebuild.** A `BI0` from an **array** upstream (a `sort`/`limit` window, or `arr.insert` at a position) carries a *positional* `at` (a numeric rank), not an append — so appending it would corrupt the output (and for `keys`, push a stray numeric index as a "key"). When the upstream value is an array, `BI0` rebuilds. This is the fix behind the "stay correct over a sort window" regression test — `keys()`/`values()`/`reverse()`/`distinct()` after `az`/`za`/`top`/`limit` now re-derive instead of mis-appending.
- **Empty / non-object source.** A `null`/primitive source projects to `[]`; an empty object/array projects to `[]`.
- **Excluded slots are skipped on BOTH paths.** A sparse pair whose value is `undefined` (the explicit-`undefined` slots `between`/`intersect`/`union`/`except` leave) is skipped by the `BI0` append fast path AND by the full rebuild (the rebuild walks the source skipping `undefined` slots rather than taking raw `Object.keys`/`Object.values`). Previously the two disagreed — the rebuild kept the undefined slot's key, so a row that left then re-entered an object-source sparse view showed up TWICE (`["a","b","c","c"]`); fixed 2026-06-11.
- **No dedup.** `keys`/`values` do **not** implement `matches()` — each call constructs a fresh derived view (like `tap`/`union`/`except`/`reverse`; unlike the scalar aggregates / `distinct` / `reduce` / `between`, which cache).
- **Gotcha — emptied buckets persist.** `length(fn)` keeps emptied buckets as `{ value: 0 }` (fixed-keyspace persistence), so `data.length(fn).keys()` lists *ever-seen* categories, including currently-empty ones. Filter on count (`> 0`) if you need only the live ones, or read by known key. Use `group(fn)` instead when you want enter/leave semantics (it prunes emptied buckets).
