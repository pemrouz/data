# group

Nests rows under keys returned by a function. The output shape is `{[bucketKey]: {[rowKey]: row}}` — one inner object per bucket, with rows preserved by their original key.

## Signature

```ts
proxy.group(fn: (row, key) => string | number)
// → ViewProxy<{[bucket]: {[rowKey]: row}}>
```

## Example

```js
const flights = $([
  { airline: 'UA', date: '2024-01-15' },
  { airline: 'DL', date: '2024-01-15' },
  { airline: 'UA', date: '2024-01-16' },
])

const byAirline = flights.group(f => f.airline)
// → { UA: { 0: {...}, 2: {...} },
//     DL: { 1: {...} } }

const byDate = flights.group(f => f.date.slice(0, 10))
// → { '2024-01-15': { 0: {...}, 1: {...} },
//     '2024-01-16': { 2: {...} } }
```

Often paired with `length(fn)` to count per-bucket, or with iteration in `render` to draw nested lists. See [../../examples/crossfilter/index.html:116-126](../../examples/crossfilter/index.html#L116-L126) for a `flightsByDate → render` pattern.

## Behavior

- **Incremental.** Inserts/removes hit only the affected bucket; updates that move a row from one bucket to another fire a remove + insert.
- The bucket key is whatever `fn` returns — string, number, or anything that survives object-key coercion.
- No dedup. No reactive args.
