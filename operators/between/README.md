# between

Outputs rows whose value at `column` falls within `[lo, hi]` inclusive. Maintains an O(log n) sorted index so narrowing or widening the range is incremental — only the boundary rows are reclassified — and tracks source mutations row-by-row so live data and brushable bounds compose without re-snapshotting.

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

- **Reactive args** — bounds may be reactive, as shown above. Plain numeric bounds are wrapped internally in `$()` so the connect path is uniform; either bound may be plain or reactive independently. Plain values are captured once.
- **Source mutations** — `BU1`/`BU2`/`BI0`/`BI2`/`BR1`/`BR2` are all implemented. When a row's sort-column changes, `between` re-bisects its position in `sorted` and emits the right `BU1` (still in range), `BI0` (newly in range), or `BR1` (left the range). Inserts and removes update the sorted index and view in lockstep. For array sources, key-shift bookkeeping mirrors the source's splice — see [../sort/](../sort/) for the analogous machinery in `za`.
- **Unfilter fast path** — when the bounds widen to `[-Infinity, Infinity]` the view's value is aliased directly to the source array. All source-mutation handlers detect this and short-circuit (the view already reflects the mutation by reference) — they relay the upstream verb to sinks without forking.
- **Dedup** — `between` implements `matches(col, range)` ([index.ts:6](index.ts#L6)), so calling `proxy.between('delay', [60, 240])` twice with equivalent args returns the cached view.
- **Empty-batch guards** — short-circuits on empty `U1`/`I0`/`R1` arrays (perf-sensitive — preserve when modifying).
