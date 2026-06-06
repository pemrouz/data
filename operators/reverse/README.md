# reverse

Materializes the source's array (or an object's values, in `Object.keys` iteration order) into a new array with the order flipped. `undefined` slots are dropped, so a sparse source densifies as it reverses.

## Signatures

```ts
proxy.reverse(): Data<RowOf<T>[]>          // ReverseValue
```

Dispatch lives in [../../register.ts:105](../../register.ts#L105).

## Examples

```js
const data = $(['a', 'b', 'c', 'd'])
data.reverse()                  // ['d', 'c', 'b', 'a']

$({ x: 1, y: 2, z: 3 }).reverse()   // [3, 2, 1]   — object values in reverse iteration order

$(['a', undefined, 'c']).reverse()  // ['c', 'a']  — undefined slots filtered out

// Reactive: a new key prepends to the reversed view
const live = $(['a', 'b'])
const r = live.reverse()        // ['b', 'a']
live.insert('c')                // r => ['c', 'b', 'a']
delete live[0]                  // r => ['c', 'b']
```

## Behavior

- Maintains a single cached output array. **Object-source inserts (`BI0` at a fresh key)** are incremental — a new key sits at the end of source iteration, i.e. the front of the reverse, so the new value(s) `unshift` onto the output in O(Δ) with no rebuild. A multi-key `I0` is walked back-to-front so the last-inserted in source becomes `output[0]`.
- **Everything else rebuilds** — `XU0`/`XR0`/`BU1`/`BR1`/`BU2`/`BR2`/`BI2` all re-walk the source. Reverse-mapping a value back to its position is O(N) and ambiguous for duplicate values, so removes and in-place updates take the full-rebuild path; that's the right trade-off for the common streaming-insert workload (see [BENCHMARK.md](BENCHMARK.md), where `data` leads on both single inserts and 1000-row batches).
- **Array-source inserts also rebuild** — an array upstream (a `sort`/`limit` window, or a mid-array insert) delivers `BI0` with a *positional* `at`, which is not an append, so the O(1) front-prepend would land it at the wrong end. The fast prepend path is taken only when the source is an object; array sources fall back to `_rebuild`.
- **Sparse slots are filtered out** — `_rebuild` and the `BI0` prepend both skip `undefined` values, so the output is dense even when the source has holes. (Unlike `between`/`intersect`/`union`/`except`, whose excluded slots stay as explicit `undefined`, a `reverse` view never surfaces a `NaN` row from a hole.)
- **No dedup.** `reverse` does not implement `matches()` — like `keys`/`values`/`tap`/`union`/`except`, every `proxy.reverse()` call constructs a fresh derived view. (The deduping operators are `between`/`gt`/`lt`/`gte`/`lte`/`za`/`az`/`top`/`intersect`/the scalar aggregates/`distinct`/`reduce`.)
- **Empty source** → empty output array (`[]`); `BI0` short-circuits on an empty batch.
- **Gotcha — composing a row op after `reverse` over an array source.** `reverse` is one of the array-positional-vs-splice-limited stages: a `map`/`filter`/second `between`/`group`/`distinct`/`sort` chained after a windowed sort or array-source `reverse` can drop or ghost a row, because the protocol doesn't distinguish a positional hole from a splice-shift. Key your source by id with `$({})` (object sources use stable keys and the incremental prepend path) or densify between stages.
