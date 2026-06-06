# reduce

Folds the source's rows into a single scalar reactive view. The 2-arg form `reduce(fn, init)` is a general fold that rebuilds from scratch on every change; the 3-arg form `reduce(add, remove, init)` opts into an incremental fold where inserts/removes thread through the user's `add`/`remove` in O(Δ).

## Signatures

```ts
proxy.reduce(fn:  (acc, row, key) => acc, init: any)              // ReduceValue
proxy.reduce(add: (acc, row, key) => acc,
             remove: (acc, row, key) => acc,
             init: any | (() => any))                            // ReduceIncrementalValue
```

Dispatch key is `typeof second-arg === 'function'` (a function in slot two means `(add, remove, init)`). Dispatch lives in [../../register.ts:95](../../register.ts#L95).

## Examples

### General fold — `reduce(fn, init)`

```js
$([1, 2, 3, 4]).reduce((a, b) => a + b, 0)              // 10
$({ a: 'X', b: 'Y', c: 'Z' }).reduce((acc, v) => acc + v, '')   // 'XYZ' — iteration order
$({ a: 1, b: 2, c: 3 }).reduce((acc, row, key) => acc + key + row, '')   // 'a1b2c3' — fn gets (acc, row, key)

const r = $([1, 2, 3]).reduce((a, b) => a + b, 0)      // 6
res.insert(4)                                          // 10 — rebuilds
delete res[0]                                          //  9 — rebuilds (2 + 3 + 4)
```

### Incremental fold — `reduce(add, remove, init)`

```js
// running sum: insert calls add for the new row only; remove calls remove for the deleted row only
const total = src.reduce(
  (acc, v) => acc + v,
  (acc, v) => acc - v,
  0,
)

// histogram (mutate-in-place acc) — thunk init gives a fresh object on each full rebuild
const histogram = src.reduce(
  (acc, row) => { acc[row.b] = (acc[row.b] || 0) + 1; return acc },
  (acc, row) => { if (--acc[row.b] === 0) delete acc[row.b]; return acc },
  () => ({}),
)
src.insert({ b: 'x' }); src.insert({ b: 'x' }); src.insert({ b: 'y' })   // { x: 2, y: 1 }
```

## Behavior

- **Two arities, picked by the second arg.** A function in slot two routes to the incremental `ReduceIncrementalValue`; anything else (value or thunk) routes to the general `ReduceValue`.
- **`reduce(fn, init)` rebuilds on every event.** All upstream verbs (`XU0`/`XR0`/`BU1`/`BR1`/`BI0`/`BU2`/`BR2`/`BI2`) trigger a full re-walk of the source through `fn`. This is the safe default because `fn` is assumed non-commutative (string concat, object merge) with no way to "undo" a contribution.
- **`reduce(add, remove, init)` threads deltas in O(Δ).** `BI0` runs `add` for each inserted row; `BR1` runs `remove` for each removed row; `BU1` (a whole-slot overwrite, `data[k] = newRow`) runs `remove(old)` + `add(new)` — only the delta rows hit the user functions, not the whole source. `XU0`/`XR0` (the source replaced wholesale) still do a full rebuild from `init`.
- **`BU1` is incremental via a per-key value cache.** The framework doesn't carry the *old* value in the notification, so the operator keeps a `Map` of each key's last-seen row (seeded on rebuild, maintained on `BI0`/`BR1`/`BU1`). A whole-slot overwrite changes the row reference, so the cached old row ≠ the new one and `remove(old)` subtracts the prior contribution correctly. The cache stores **references** (no clones), so it costs O(1) per insert and nothing for immutable-row workloads. The cache key is normalised to a string because array sources surface numeric keys on rebuild but string keys on `BU1`.
- **`BU2` (nested in-place edit, `data[k].f = x`) still falls back to full rebuild.** The row's reference is unchanged, so the cache holds the already-mutated row — there's no pre-edit value to subtract. Closing this would need either a per-row snapshot (which would penalise the immutable-row crossfilter path the operator is tuned for) or an old-value protocol change. Stick with the 2-arg form, or restructure so changes manifest as enter/leave, if `BU2` dominates.
- **`init` may be a value or a thunk** (incremental form). A thunk is called once per full rebuild (`XU0`/`XR0`/`_seed`), so a fold that mutates its accumulator in place (the histogram case above) starts from a clean object each time the source resets instead of inheriting stale state. Plain-value init is fine for primitives.
- **`remove` must invert `add`** for the row passed to it, using only the row + key — same contract as crossfilter's `group.reduce(add, remove, init)`. Forgetting the symmetry desyncs `acc` silently; round-trip an insert+remove in a test to catch it. Or set **`$.debug = true`** during development: each incremental `BI0`/`BR1` then re-folds the source from scratch and `console.warn`s the moment the running accumulator drifts from the fresh fold, pointing straight at the broken `remove`. It's O(N) per delta, so it's a dev aid gated behind the flag — leave it off in production.
- **Sparse slots are skipped.** Rebuild's `iter` and the `BI0`/`BR1` loops both `continue` past `undefined` rows (explicit-`undefined` holes from `between`/`intersect`/`union`/`except`, or the `[name, undefined]` shift-only events a `RowOperator` over an array emits) — so they contribute nothing in either direction.
- **Dedup.** Both forms implement `matches(...)` keyed on function/init identity (`ReduceValue.matches(fn, init)`; `ReduceIncrementalValue.matches(add, remove, init)`), so repeated calls with the same arguments return the cached view.
- **For commutative numeric aggregates** (`sum`/`count`/`avg`/`min`/`max`) prefer the dedicated operators in [../aggregate/](../aggregate/) — they're O(1) per delta. For count-by-bucket use [`length(fn)`](../length/) (already incremental). Reach for `reduce(add, remove, init)` when you need a bucketed sum / running stat / top-K per group that `length(fn)` can't express.
- **Perf.** On a 10k-row running-sum workload the incremental form is fastest among peers on both single insert (~0.005 ms, ~1.7× over crossfilter) and a 1000-insert batch (~1.4 ms, ~19× over crossfilter); the 2-arg form's per-change cost is O(n) by design. See [BENCHMARK.md](BENCHMARK.md).
