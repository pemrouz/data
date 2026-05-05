# intersect

Outputs rows that appear in the source AND in every additional source view passed in. Set intersection by row key.

## Signature

```ts
proxy.intersect(...sources: ViewProxy[])   // → ViewProxy<rows present in all of [proxy, ...sources]>
```

## Example

This is the pattern used in [../../examples/crossfilter/](../../examples/crossfilter/) to combine multiple range filters:

```js
const flights = $([...])

const byDelay    = flights.between('delay',    [60, 240])
const byDistance = flights.between('distance', [500, 1500])
const byHour     = flights.between('hour',     [6, 18])

// rows that satisfy ALL three filters
const visible = flights.intersect(byDelay, byDistance, byHour)

const counts = visible.length()
```

When any of `byDelay`, `byDistance`, or `byHour` updates (e.g. a brush range changes), `visible` reflects the new intersection without rescanning the unchanged dimensions.

## Behavior

- **Reactive sources.** All sources are tracked reactively — a row is included in the output iff it currently appears in every source. Inserts/removes in any source update the output incrementally.
- **Bitmask membership.** Internally, each source gets a bit; a row is in the output when its bitmask equals `all sources`. This means up to ~30 sources before integer-bitmask runs out of room.
- **No dedup.** Each `intersect(...)` call constructs a fresh derived view.
