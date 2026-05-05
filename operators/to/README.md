# to

Whole-value transform. `fn` receives the entire current value (and the previous output). Emits a new output only if it differs from the previous — so `to` is a useful "memoize and re-emit on change" gate.

## Signature

```ts
proxy.to(fn: (value, prevOutput?) => any)
// → ViewProxy<fn's return type>
```

## Example

```js
const items = $([
  { done: false }, { done: true }, { done: false },
])

const allDone = items.to(v => {
  let total = 0, completed = 0
  for (const i in v) { total++; if (v[i].done) completed++ }
  return total > 0 && total === completed
})
// → false

items[0].done = true
items[2].done = true   // → true
```

The TodoMVC example uses `to` for the "all-complete" derived flag and for formatting reactive labels:

```js
span.text(active_count.to(n => `${n} item${n === 1 ? '' : 's'} left`))
```

## Behavior

- Runs on every upstream change, but only **emits** if the new return value differs from the previous (reference equality for objects, value equality for primitives).
- No dedup. No reactive args.
- For row-level transforms (one input row → one output row), use [`map`](../map/) — it reruns only the affected row, whereas `to` reruns over the entire value.
