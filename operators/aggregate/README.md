# aggregate

Scalar reductions over a source. `sum` / `avg` / `max` / `min` collapse the rows to a single number; `some` / `every` collapse them to a single boolean. Each returns a single-value reactive `ViewProxy` (read with `result[value]`) that re-publishes incrementally as the source changes.

## Signatures

```ts
proxy.sum(col?:   string)                          // SumValue   — Σ row[col] (or Σ row)
proxy.avg(col?:   string)                          // AvgValue   — mean
proxy.max(col?:   string)                          // MaxValue   — maximum
proxy.min(col?:   string)                          // MinValue   — minimum
proxy.some(fn:    (row) => boolean)                // SomeValue  — true if ANY row matches
proxy.every(fn:   (row) => boolean)                // EveryValue — true if ALL rows match
```

`col` is optional for `sum`/`avg`/`max`/`min` — omit it to reduce over row values directly, pass a string to reduce over `row[col]`. `some`/`every` take a required predicate.

Dispatch lives in [../../register.ts:70](../../register.ts#L70-L77) (the `Operators['sum'] … Operators['every']` block).

## Examples

```js
// sum / avg — over values, or over a column
sum($([1, 2, 3, 4]))                                  // 10
sum($([{ x: 1 }, { x: 2 }, { x: 3 }]), 'x')           // 6
avg($([2, 4, 6]))                                     // 4
avg($([{ d: 10 }, { d: 20 }, { d: 30 }]), 'd')        // 20

// incremental — the scalar follows source mutations
const res = $([1, 2, 3, 4])
const s = sum(res)                                    // 10
res[1] = 20                                           // s → 28
res.insert(5)                                         // s → 33
delete res[0]                                         // s → 32

// max / min — also work over a column / non-numeric (Date) values
max($([3, 1, 4, 1, 5, 9, 2, 6]))                      // 9
min($([3, 1, 4, 1, 5, 9, 2, 6]))                      // 1
max($([{ date: d1 }, { date: d2 }]), 'date')          // returns the original Date instance

// some / every — scalar booleans
some($([1, 2, 3]), d => d > 5)                        // false → true after .insert(10)
every($([2, 4, 6]), d => d % 2 === 0)                 // true  → false after .insert(3)

// chained downstream of filter/sort: a Kanban column's point total
const col = sort(filter(board, 's', 'todo'), 'o')
const pts = sum(col, 'p')                             // tracks membership flips
```

## Behavior

- **Incremental, O(1) per change for sum/avg/some/every.** Each maintains running state — `sum`/`avg` a running total (and count), `some`/`every` a truthy-row count — and swaps `(old, new)` on it per row change. `max`/`min` recompute O(n) on publish (a removed maximum re-opens the question, so they can't be maintained from `(old, new)` alone); internally they keep a parallel `Float64Array` fast path that flips to a Map scan the first time a non-finite/non-numeric value (Date, string, null, NaN, ±Infinity) is observed. The flip is sticky within a snapshot and re-evaluated on a wholesale data swap (`XU0`/`XR0`).
- **Empty set returns `undefined`** for `avg`/`max`/`min` (not `NaN`/`0`), matching the "no data" idiom used elsewhere. `sum` over empty is `0`. `some` over empty is `false`, `every` over empty is `true` (vacuous truth — matches `Array.prototype`).
- **Reactive column.** `sum`/`avg`/`max`/`min` accept a reactive `ViewProxy` column name — `sum($(currentCol))` — so a runtime column pick re-aggregates when the bound changes (`currentCol[value] = 'dist'`). A column switch re-projects every row, so the recompute is a full `XU0` (O(N), not incremental) — fine for a config-style switch, not a per-tick path. A plain string column is captured once, as before. (`some`/`every` take a fn predicate, not a column, so they have no reactive-column surface; a fn closing over reactive state is captured once like any operator.)
- **Dedup** — all six implement `matches(col)` ([index.ts:47](index.ts#L47)), so `proxy.sum('p')` (or `proxy.some(fn)`) twice with the same argument returns the *cached* view; the dedup key is the `col` string / `fn` reference (a reactive column dedups by the bound's view identity, like `between`). Different column → different view. (`some`/`every` dedup on the *same fn reference* — an inline arrow each call is a fresh predicate and won't hit the cache.)
- **Reacts to nested edits.** `BU2`/`BR2`/`BI2` re-project the affected row from the source and re-run the delta pipe, so `res[0].x = 10` updates `sum(res, 'x')` without re-snapshotting.
- **Array-shaped upstreams (sort/limit/between).** A non-tail insert/remove *shifts* an array source's positions, so the positional `tracked` Map would desync; `BR1`/`BI0` over an array upstream rebuild from the current snapshot (object upstreams keep the O(1) incremental path). This is the fix behind `filter(...).sort(...).sum(col)` tracking card moves in the Kanban example.
- **`undefined`/`null` projections are dropped**, not summed — a row whose `row[col]` is `undefined`/`null` is excluded from the tracked set (so `tracked.values()` never yields `undefined`). Note that `between`/`intersect`/`union`/`except` leave **explicit `undefined`** at excluded slots; aggregates correctly skip those, so `sum`/`avg`/etc. *after* a sparse producer are fine even though a row template rendered over the same view would surface `NaN` cells.
- **Not to be confused with `length(fn)`** — that stores each bucket as `{ value: count }` (read `counts[k].value`); these aggregates publish a bare scalar (read `result[value]`).

See [BENCHMARK.md](./BENCHMARK.md) for the perf characterization (`data` fastest on both single-tick and 1000-tick batch for `sum`; `max`/`min`'s O(n) publish narrows the gap).
