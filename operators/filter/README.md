# filter

Outputs rows that match a predicate. The predicate can be a function, a key/value pair, a key path with value, or a partial-shape object — `filter` dispatches to a different class for each.

## Signatures

```ts
proxy.filter(fn:    (row, key) => boolean)            // FilterValue
proxy.filter(key:   string,    expected: any | Data)  // FilterStringValue
proxy.filter(path:  string[],  expected: any | Data)  // FilterColumnValue
proxy.filter(shape: object)                           // FilterObjectValue  (leaves may be Data)
```

Dispatch lives in [../../register.ts:41](../../register.ts#L41-L44).

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

// Reactive value — re-selects when the bound value changes.
const flag = $(false)
const open = items.filter('done', flag)        // [a, c]; flag[value] = true → [b]
const region = $('hot')
items.filter({ tags: { [region[value]]: true } })  // (static key) — for a reactive *value*:
items.filter('done', flag)                     // value slot is reactive; the KEY/PATH stays static
```

## Behavior

- Built on `RowOperator` ([../../row.ts](../../row.ts)) — processes one row at a time, so insert/update/remove on a row only re-runs the predicate for that row.
- **The predicate function is captured once.** The `filter(fn)` form is not re-evaluated when state the fn closes over changes — only when an upstream row mutates. For a reactive *function* predicate, derive a separate view and chain through `intersect`/`between`.
- **The value slot is reactive.** In `filter('key', v)`, `filter(['path'], v)`, and each leaf of `filter({k: v})`, a `v` that is a reactive `ViewProxy` (`$(...)`) is subscribed: changing it (`v[value] = …`) re-selects the matching rows — the equality counterpart to `between`/`gt`'s reactive bounds. The recompute is a whole-snapshot `XU0` (any row can flip membership when the value changes), so the change stream is coarse `update` records. A plain literal value is captured once, unchanged.
- No dedup. Each call to `proxy.filter(...)` constructs a fresh derived view (a reactive value does not change this — repeated identical reactive filters are independent operators).
