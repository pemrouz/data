# sort: za / az / top / limit

This folder hosts the sort family — four operators that share an internal sorted index:

- **`za`** — descending (Z → A) by a column or by the value itself
- **`az`** — ascending (A → Z), same overloads as `za`
- **`top`** — alias for `za` over scalar values (no column)
- **`limit`** — first `n` non-undefined entries in source iteration order, **no sort**

## Signatures

```ts
proxy.za(column: string, n?: number)   // sort rows desc by row[column], take first n (default Infinity)
proxy.za(n?: number)                   // sort scalar values desc, take first n

proxy.az(column: string, n?: number)   // ascending column sort
proxy.az(n?: number)                   // ascending scalar sort

proxy.top(n?: number)                  // alias for za(n)

proxy.limit(n: number)                 // first n non-undefined entries, source order, no sort
```

## Examples

```js
const flights = $([...])

flights.za('delay')          // sorted by delay, worst first
flights.za('delay', 10)      // top 10 worst delays
flights.az('delay', 10)      // 10 most on-time

const counts = $({ a: 5, b: 12, c: 3 })
counts.top(2)                // [12, 5]   — top 2 values
counts.az(2)                 // [3, 5]    — bottom 2 values

const items = $([0, 1, 2, 3, 4])
items.limit(3)               // [0, 1, 2] — no sort
```

## Behavior

- **`limit`** has both an incremental path and a large-batch fallback ([index.ts:169](index.ts#L169)). The incremental path keeps the window position O(1) per insert/remove; the fallback rescans on bulk updates.
- **Object vs array sources** — both are supported and chosen automatically (cached in `XU0`). On array sources `BR1` and `BI0` route to a shift-aware `BR1A`/`BI0A` path: every `sorted` key above a removed position is decremented (and incremented for non-end inserts), in-window evictions are remapped for cumulative shrinkage, and the visible window refills from the post-shift keys. Object sources skip all of this — keys are stable.
- **In-window value updates** — when a row's sort-column changes but its rank doesn't, `BU1` emits a single in-place update; out-of-window updates are silently dropped (otherwise they would grow the materialized window past `n`).
- **Bounded-window batch removal / insert** — on a finite `n`, a multi-row `BR1`/`BI0` (e.g. a `between` range brush narrowing/widening past the visible window, which leaves/enters a whole block of top-of-order rows at once) takes a batch path ([`_batchRemove`/`_batchInsert`](index.ts)): drop/splice every key from `sorted` in one pass, then reconcile the window against the new order with one positional `BU1` per slot whose occupant actually changed (plus tail `BR1A`/`BI0A` only when the window can no longer / can now be filled). The naive per-row loop refilled the window from the *next-ranked* row after every eviction — but on a top-of-order batch that refill row is itself in the doomed batch, so it was inserted-then-re-evicted: **O(Δ) churn** (each churned slot = an O(n) content shift + a DOM node create/destroy) **instead of O(window)**. The batch path is observationally identical (same net leave/enter set) but emits ≤ `n` events, not ~`Δ`. Unbounded sorts (`n = Infinity`) and single-row removals keep the per-row path — there is no window to churn. Surfaced by the faceted-library rating brush (`between(...).za('rating', 60)`); see [sort.perf.ts](sort.perf.ts) `bounded batch brush` and [sort.test.ts](sort.test.ts) `bounded window reconciles batch removal/insert without churn`.
- **Dedup** — sort family implements `matches(col, n)` ([index.ts:6](index.ts#L6)). `proxy.za('delay', 10)` twice returns the same instance. A reactive window size dedups by the bound's view identity (like `between`), so `za('delay', n)` twice with the same `n = $(...)` shares one operator.
- **Reactive window size.** `n` may be a plain number (captured once) OR a reactive `ViewProxy` — `za('rating', $(pageSize))`, `top($(k))`, `limit($(n))`. Moving it (`n[value] = …`) re-windows in place: za/az/top route through the incremental `_window` reconcile (tail `BI0A` to grow, tail `BR1A` to shrink, per-slot `BU1` — the rank ORDER is unchanged, only how much is shown), and `limit` grows/shrinks its tail via the same refill its insert/remove paths use. This replaces the "rebuild a fresh deduped sort on page-size change" (`repage`) idiom. Coercing a reactive `n` to a number also fixed a latent bug: `limit($(n))` previously strict-compared the proxy OBJECT against the window length, never capped, and returned the whole source.
- **Sort stability** — entries with equal keys retain source iteration order.
