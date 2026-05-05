# map

Per-row transform. Returns `{[key]: fn(row)}` with the same keys as the source. Built on `RowOperator` so each insert/update/remove only re-runs `fn` for the affected row.

## Signature

```ts
proxy.map(fn: (row, key, oldRow?) => any)
// → ViewProxy<{[key]: fn(row)}>
```

`fn` receives the new row, its key, and (on updates) the previous row.

## Example

```js
const flights = $([
  { delay: 32, distance: 850  },
  { delay: 12, distance: 1200 },
])

const speeds = flights.map(f => f.distance / (f.delay + 60))
// → { 0: ..., 1: ... }

flights[0].delay = 90    // only flights[0] re-runs through `fn`
```

## Behavior

- **RowOperator-based** ([../../row.ts](../../row.ts)) — flat output, one entry per source row.
- Returning `undefined` from `fn` excludes the row from the output (same convention as `filter`).
- No dedup. No reactive args.
- For whole-value transforms (e.g. computing a single derived scalar from the entire source), use [`to`](../to/) instead.
