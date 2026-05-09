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
- **Dedup** — sort family implements `matches(col, n)` ([index.ts:6](index.ts#L6)). `proxy.za('delay', 10)` twice returns the same instance.
- **No reactive args.** `n` is captured once.
- **Sort stability** — entries with equal keys retain source iteration order.
