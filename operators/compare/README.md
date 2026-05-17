# gt / lt / gte / lte

One-sided range filters. Each keeps rows whose `row[column]` satisfies the comparison against a literal threshold. RowOperator-based — every BU1/BU2 reclassifies one row in O(1) and emits the appropriate downstream verb.

Use these when you need a single threshold (`spread > 1.0`, `price >= 100`). Use [between](../between/) when you need a two-sided range or a reactive bound.

## Signatures

```ts
proxy.gt(column: string,  threshold: number | string)
proxy.lt(column: string,  threshold: number | string)
proxy.gte(column: string, threshold: number | string)
proxy.lte(column: string, threshold: number | string)
```

The threshold can be any value JS's `<` / `>` / `<=` / `>=` operators understand — numbers, strings (lexicographic), Dates (via `valueOf`), and so on.

## Examples

```js
const trades = $([...])
const liquid = trades.gt('spread', 1.0)          // strict greater-than
const expensive = trades.gte('price', 100)        // includes 100
const small = trades.lt('volume', 50)
const cheap = trades.lte('price', 9.99)

// Chain like any other view.
const liquidCount = trades.gt('spread', 1.0).length()
const topLiquid = trades.gt('spread', 1.0).za('spread', 10)
```

## Behavior

- **Threshold is captured at creation.** Both args are literal — these operators do *not* track a reactive `ViewProxy` threshold. For a moving threshold either rebuild the view (`src.gt('val', t[value])`) or use `between` with reactive bounds.
- **Source mutations** — `BU1`/`BU2`/`BI0`/`BI2`/`BR1`/`BR2` all flow through `RowOperator`'s standard loop. Each row is classified per `_cmp(row[col])`: in→in emits `BU1`, in→out emits `BR1`, out→in emits `BI0`. Inserts/removes are handled by the base.
- **Missing column** — `row[col]` returning `undefined` causes every comparison to be false (JS `undefined > x === false`, etc.). Such rows never pass.
- **Dedup** — `matches(col, val)` ([index.ts](index.ts)), so repeated calls with identical args return the cached view.
- **Array-source key shift** — handled by `RowOperator.BR1` (the same splice contract as `filter`, `map`).

## vs `between`

`between(col, [T, Infinity])` and `gte(col, T)` describe the same filtered set, but they pay for it very differently:

| | `between` | `gt`/`lt`/`gte`/`lte` |
|---|---|---|
| Storage | Maintains a sorted index of keys keyed by the watched column | None — pure per-row predicate |
| BU2 (col change) | O(1) classify (sort index lazily updated; see [between/index.ts](../between/index.ts)) | O(1) classify |
| Bounds change (`set extent`) | Resorts the index if dirty, then O(log n) bisect for new lo/hi | N/A — bounds are literal; derive a fresh view |
| Setup (N rows) | O(N log N) — sorts the watched column | O(N) — one classify per row |
| Best fit | Two-sided range, reactive bounds, brush-style interactions | Single-threshold filter against a fixed value |

At N=100k on the `experiments/wasm/bench-altbackend` workload: setup is 4–5× faster with `gte`; per-tick is tied (`between`'s sort index is updated lazily); threshold-change (rebuilding the view to swap the bound) is 3× faster with `gte` because there's no resort. See [experiments/wasm/results-altbackend.md](../../experiments/wasm/results-altbackend.md).
