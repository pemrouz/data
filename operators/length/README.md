# length

Counts non-undefined entries in the source. With no argument, returns a scalar count. With a function argument, returns `{[bucketKey]: count}` — like a tiny `GROUP BY ... COUNT(*)`.

## Signatures

```ts
proxy.length()                                 // → ViewProxy<number>
proxy.length(fn: (row, key) => string|number)  // → ViewProxy<{[k]: number}>
```

## Examples

### Scalar count

```js
const items = $([
  { task: 'a', done: false },
  { task: 'b', done: true  },
])

items.length()                 // 2
items.filter('done', false).length()   // 1
```

### Bucketed count

```js
const flights = $([
  { airline: 'UA', date: '2024-01-15' },
  { airline: 'DL', date: '2024-01-15' },
  { airline: 'UA', date: '2024-01-16' },
])

flights.length(f => f.airline)
// → { UA: 2, DL: 1 }

flights.length(f => f.date.slice(0, 7))   // group by year-month
// → { '2024-01': 3 }
```

## Behavior

- Incremental: insert/remove updates the count(s) without rescanning the source.
- Empty-batch guard ([index.ts:25](index.ts#L25)) — `BR1` early-returns on empty arrays (perf-sensitive).
- No dedup. No reactive args.
- Note: `length(fn)` returns an object, not a scalar — chain `.za(10)` on it to get the top buckets.
