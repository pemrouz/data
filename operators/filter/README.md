# filter

Outputs rows that match a predicate. The predicate can be a function, a key/value pair, a key path with value, or a partial-shape object — `filter` dispatches to a different class for each.

## Signatures

```ts
proxy.filter(fn:    (row, key) => boolean)            // FilterValue
proxy.filter(key:   string,    expected: any)         // FilterStringValue
proxy.filter(path:  string[],  expected: any)         // FilterColumnValue
proxy.filter(shape: object)                           // FilterObjectValue
```

Dispatch lives in [../../index.ts:18](../../index.ts#L18-L21).

## Examples

```js
const items = $([
  { task: 'a', done: false, tags: { hot: true  } },
  { task: 'b', done: true,  tags: { hot: false } },
  { task: 'c', done: false, tags: { hot: true  } },
])

items.filter(item => !item.done)               // [a, c]   — function
items.filter('done', false)                    // [a, c]   — key + value
items.filter(['tags', 'hot'], true)            // [a, c]   — nested path
items.filter({ done: false })                  // [a, c]   — partial shape
```

## Behavior

- Built on `RowOperator` ([../../row.ts](../../row.ts)) — processes one row at a time, so insert/update/remove on a row only re-runs the predicate for that row.
- The predicate is captured once at construction. It is **not** re-evaluated when external state changes — only when an upstream row mutates. If you need a reactive predicate, derive a separate `ViewProxy` and chain through `intersect` or `between`.
- No dedup. Each call to `proxy.filter(...)` constructs a fresh derived view.
