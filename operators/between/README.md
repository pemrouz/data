# between

Outputs rows whose value at `column` falls within `[lo, hi]` inclusive. Maintains an O(log n) sorted index so narrowing or widening the range is incremental — only the boundary rows are reclassified.

## Signatures

```ts
proxy.between(column: string, bounds: [lo: number, hi: number])
proxy.between(column: string, bounds: ViewProxy<[lo: number, hi: number]>)
```

## Examples

### Static bounds

```js
const flights = $([...])
const peak = flights.between('delay', [60, 240])   // 1–4 hour delays
```

### Reactive bounds

```js
const range = $([0, 60])
const visible = flights.between('delay', range)

range[value] = [60, 240]   // visible re-fills incrementally
```

When the second argument is a `ViewProxy`, `between` subscribes to it (via `connect(this, 'extent')`) and re-narrows/widens the view as bounds change. This is what powers brushable histograms in [../../examples/crossfilter/](../../examples/crossfilter/).

## Behavior

- **Reactive args** — bounds may be reactive, as shown above. Plain arrays are captured once.
- **Dedup** — `between` implements `matches(col, range)` ([index.ts:6](index.ts#L6)), so calling `proxy.between('delay', [60, 240])` twice with equivalent args returns the cached view.
- **Empty-batch guards** — short-circuits on empty `U1`/`I0`/`R1` arrays (perf-sensitive — preserve when modifying).
