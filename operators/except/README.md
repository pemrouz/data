# except

Outputs rows in the source but **not** in `other` — set difference, keyed by name. Mirrors `intersect`'s bitmask machinery for the negative case: keeps the source's rows whose key is absent from `other`, dropping a row the moment `other` admits it and re-admitting it when `other` drops it.

## Signatures

```ts
proxy.except(other: ViewProxy): ViewProxy   // ExceptValue
```

`other` is another `ViewProxy`; membership is tested by key (`other.value[key] === undefined` ⇒ the row passes). Only one secondary source — for chained differences, chain: `a.except(b).except(c)`.

Dispatch lives in [../../register.ts:100](../../register.ts#L100).

## Examples

```js
const a = $({ 1: 'a', 2: 'b', 3: 'c' })
const b = $({ 2: 'b' })

a.except(b)                      // { 1: 'a', 3: 'c' }

// reactive: adding a key to `other` drops that row from the output
const out = a.except(b)
b[1] = 'a'                       // out → { 3: 'c' }

// reactive: removing from `other` re-admits the row
delete b[2]                      // out → { 1: 'a', 2: 'b', 3: 'c' }

// reactive: source mutations propagate too
a[4] = 'd'                       // out gains 4: 'd' (not in `other`)
delete a[3]                      // out drops 3
```

## Behavior

- **Set difference, by key.** A source row survives iff its key is `undefined` in `other`. Both an object and an array source are supported; the output is the same container shape as the source.
- **Incremental, both sides.** Built on `Operator` (it subscribes to `other` via `connect`), so it threads upstream verbs without re-snapshotting:
  - From the **primary** — `BI0` admits a new row if `other` lacks it; `BR1` drops it from the output if it was there; `BU1` re-emits when the value changes (skipped if `other` has the key). `XU0`/`XR0` (whole-source swap/empty) rebuild from scratch.
  - From **`other`** — `BI0` (a key appeared in `other`) drops that row from the output; `BR1` (a key left `other`) re-admits it if the primary still has it; `BU1` is a no-op (an in-place edit in `other` doesn't change *membership*, only value); `XU0`/`XR0` re-evaluate every primary row (`_rebuild`).
- **No dedup.** `except` does **not** implement `matches()` — every `proxy.except(...)` call constructs a fresh derived view (unlike the deduped `intersect`, the scalar aggregates, `distinct`, and `reduce`). Repeated identical calls each allocate.
- **Non-object source.** If `p.value` isn't an object (a scalar), the view collapses via `XU0()` (empty) — `except` is a collection operator.
- **Sparse-`undefined` slots.** Like `intersect`/`union`/`between`, an array-backed `except` leaves excluded indices as **explicit `undefined`** rather than holes — well, more precisely it builds a fresh container and skips excluded keys, but its own output uses `delete` on incremental removes while the *upstream* sparse producers it commonly chains after (`between`/`intersect`/`union`) feed it explicit-`undefined` slots, which the constructor's `iter` guards with `if (v === undefined) return`. Still, if you render an `except(...)` view that derives from one of those sparse producers, bind defensively or densify (`vp.to(arr => arr.filter(r => r !== undefined))`) — a momentarily-`undefined` slot surfaced during a multi-source re-point cascade resolves to `NaN`/`undefined` in a row template. See the sparse-view gotcha in [CLAUDE.md](../../CLAUDE.md) and the `except(intersect(…))` chain in [../../examples/library/](../../examples/library/).
- **Array-source composition caveat.** Chaining a row op (`filter`/`map`) or an `iter()`-based op (a second set op, `group`, `sort`) *after* an `except` over an **array** source can keep ghost rows or throw on a hole — the positional-vs-splice contract gap documented in CLAUDE.md. Key sources by id with `$({})` (stable keys, `delete`-based removal), as every shipped example does.
- **Perf.** O(Δ) per tick on both sides — only the affected keys are reclassified; empty `U1`/`I0`/`R1` batches short-circuit. Fastest peer on the canonical `filter(active).except(filter(val>50))` workload (single and 1000-tick batch) — see [BENCHMARK.md](BENCHMARK.md).
