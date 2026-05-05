# debounce

Delays calling `fn` by `ms` milliseconds. If the upstream changes again before the timer fires, the pending call is cancelled and the timer restarts — so a burst of N updates collapses to a single trailing call with the final state.

## Signature

```ts
proxy.debounce(fn: (value, prevOutput?) => any, ms?: number)
// → ViewProxy<fn's return type>
// ms defaults to 1000
```

## Example

```js
const search = $('')
const results = search.debounce(query => fetchResults(query), 300)

results.connect(document.querySelector('#results'), 'innerHTML')

// User types "react" character by character; only the final
// fetchResults('react') call fires, 300ms after they stop typing.
```

## Behavior

- Same change-gate as [`to`](../to/) — only emits when the result differs from the previous output.
- The timer uses `setTimeout`. When upstream fires while a timer is pending, the existing timer is **not** cancelled — instead, when it fires, `calc` re-reads the current value, so you always get the latest state. (See `bulk()` in [index.ts:20-23](index.ts#L20-L23).)
- No dedup. No reactive args.
- Default delay is 1000 ms — usually too long for typing UIs; pass a shorter `ms` for interactive use.
