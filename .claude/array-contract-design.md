# Design note: the array positional-hole vs splice-shift contract (C1/C2/C3/C4)

Status: **design only — no production code changed.** This is the "design first"
deliverable for the array-trio issues in [../ISSUES.md](../ISSUES.md). It maps the
real contract, reports a load-bearing constraint the issue write-ups missed,
disentangles four issues that were being treated as one, and recommends a
staged, lowest-risk-first path. Grounded in a read of `core.ts`, `row.ts`,
`render/index.ts`, and every sparse producer, plus two empirical reproductions.

## TL;DR recommendation

1. **Do NOT densify the sparse producers** (the investigation's "Approach 2").
   The explicit-`undefined` holes are **load-bearing**: `intersect` keys its
   membership bitmask by `name` (= array index for array sources) and aligns
   sources *by that key*. Holes keep indices stable so set-ops can correlate
   rows across sources positionally. Splicing on exclusion would desync every
   `intersect`/`union`/`except` over an array source — the crossfilter case
   they exist for. Verified in [operators/intersect/index.ts](../operators/intersect/index.ts) (`filters[name]` bitmask, "`this.p.value[name]` stays the canonical row identity").

2. **C2 is independently and cheaply fixable** — it does *not* need a protocol
   change. It's a missing `RowOperator.BI0A`. Recommend doing it as a real,
   small, tested fix (acceptance test = the C2 repro below).

3. **C1 and C4 are best left to the documented mitigation** (object-keyed
   sources). The only *complete* fix that also preserves intersect alignment is
   the protocol stride-change ("Approach 1"), which is L-effort / high-risk and
   only worth it if a real consumer needs array-source sparse chains — none of
   the shipped examples do. The cheap, honest improvement is to make the silent
   corruption **loud** (a `$.debug` warning, reusing the [C5](../ISSUES.md) flag).

4. **C3 is a separate problem** (sort window re-key, changes `BMV1` move
   semantics) — unrelated to holes. Defer unless a workload needs chained
   windowed sorts.

## The actual contract

For **array** sources the protocol is **splice-shift, consistently, at every
layer except the sparse producers**:

- **core** ([core.ts](../core.ts)) has array-aware variants `BR1A`/`BI0A`/`BMV1`
  that `splice` the owned array (length shrinks/grows, survivors slide) and then
  call `View.V1(offset)` to re-base every child view at index ≥ offset. An
  ownership guard (`owns = this.view.value !== this.p?.value`) avoids double-shift
  in pass-through operators.
- **`RowOperator.BR1`** ([row.ts:74-89](../row.ts#L74-L89)) **always splices for
  arrays**, even for rows its predicate had excluded, and forwards `[name,
  undefined]` so downstream array-aware ops can do their own shift bookkeeping.
  The comment there is the canonical statement of the contract.
- **`DOMSink`** ([render/index.ts](../render/index.ts)) is positional: `create_node`
  tail-appends and binds slot *k* to `data[k]`; `remove_node` pops the **tail**;
  `BMV1` is a no-op because `Value.BMV1` already refreshed each slot's content.

The **only** violators are the four sparse producers — `between`, `intersect`,
`union`, `except` — which on exclusion set `view.value[name] = undefined`
(a **positional hole**, stable length) instead of splicing. That is a deliberate
choice (see point 1: alignment), not an oversight. So the "gap" is not that the
contract is inconsistent everywhere — it's that **two contracts coexist on the
array path with no signal to tell them apart**: splice-shift (everyone) vs
positional-hole (the four producers).

## Why the holes exist (the load-bearing constraint)

`intersect(dims)` builds `filters[name] = bitmask of which sources hold row
name`, and emits a row when `bits === all`. For an **array** source, `name` is
the array index. Multiple sources are correlated **by index**. If a producer
upstream of intersect spliced on exclusion, indices would shift independently per
source and the by-index correlation would break. Holes (stable length,
`undefined` at excluded slots) are what keep the indices aligned. `union`/`except`
share the same key-by-name model.

⇒ **Densify is off the table** as a blanket producer change. Any fix must keep
the holes (stable indices) and instead make *consumers* able to distinguish a
hole from a shift.

## The four issues are related but NOT one root cause

| Issue | Mechanism | Entry point | Independent fix? |
|---|---|---|---|
| **C2** | `RowOperator.loop` reads `view.value[rank]` (the displaced occupant) as the inserted row's "old" value on a windowed-sort array insert → misclassifies insert as update, drops a row | `BI0` (array insert) | **Yes** — add `RowOperator.BI0A` |
| **C1** | A sparse producer nulls a slot; a downstream row-op splices it (or a 2nd iter-op reads the hole) → ghost row / throw | `BR1`/`BU2` incremental | Only via protocol signal OR object keys |
| **C4** | `DOMSink` for-in visits hole slots; array sink can't skip them (positional binding) | render `XU0` | Only via C1's protocol work (object-sink skip is safe but doesn't help the array case) |
| **C3** | Inner windowed sort rotates which upstream key sits at each position without re-keying the outer | sort `BU2`/`BMV1` | Separate (sort re-key, changes `BMV1`) |

Treating these as one "array-positional" bucket overstated the coupling. C2 and
C3 are separable; C1 and C4 are the genuinely protocol-coupled pair.

## Reproductions (verified 2026-06-06)

**C2 — clean, deterministic.** `map`/`filter` after a windowed sort drops a row:

```js
import { $, value } from 'data'
const src = $([{v:5},{v:3},{v:9},{v:1}])
const win = src.za('v', 2)       // top-2 by v desc
const mapped = win.map(r => r.v)
// win    = [{v:9},{v:5}]   mapped = [9,5]
src.insert({v:100})              // {v:100} enters the window at rank 0
// win    = [{v:100},{v:9}]      ← correct
// mapped = [100]                ← BUG: {v:9} dropped (expected [100,9])
```

Root cause: the entering row arrives as a `BI0` with numeric rank `0`;
`RowOperator.loop` reads `view.value[0]` (the current occupant `{v:9}`) as the
"old" value, sees `old && now`, classifies it as an **update** of slot 0, and
never emits the insert for the displaced `{v:9}`.

**C1 — sequence-dependent.** The ghost-row/throw cases depend on the exact order
of a reactive-bound move plus the producer's null-then-shift; a minimal
deterministic repro is finicky because some downstream ops (`sort`, `group`,
`intersect` construction) already carry `value[k] !== undefined` skip guards that
mask the throw into a silently-stale value. The mechanism: `between(arr)` nulls
slot *k* on a bound move (length stable), but `filter`'s `BR1` over an array
*splices* (length shrinks) — the two disagree about whether position *k* still
exists, so a survivor slides into a slot the consumer thinks is gone.

## The three candidate approaches, re-assessed

**Approach 1 — positional-hole signal bit (stride change to `BR1`).** Add an
`isHole` flag so consumers know "position still exists, don't splice." Closes
**C1**, and **C4** (DOMSink skips hole removal), and is compatible with intersect
alignment (holes preserved). Does **not** by itself close C2 (that's a `BI0`
classification issue, not a `BR1` hole issue) or C3.
- Effort **L**, risk **high**: it's a stride change to the `R1` payload — *every*
  sink that parses `R1` (DOMSink, aggregate, custom sinks) must update in lockstep
  or silently misread the flag as a row index. No graceful fallback. This is the
  "protocol-level positional-vs-splice distinction" the docs name as the real fix.

**Approach 2 — producer-side densify.** ❌ **Rejected** — breaks intersect/union/
except cross-source index alignment (see "Why the holes exist"). The investigating
agent rated it M/medium but underweighted the alignment semantics.

**Approach 3 — defensive consumer hole-skip.** Add `!== undefined` guards in
`RowOperator.loop`, `DOMSink.BI0`, and the iter-ops. Closes **C2** (partly) and
**C4** (array-sink: only safe for *object* sinks; array sinks still can't skip
mid-list holes without breaking positional binding) but **not C1** (the
incremental desync persists) and **not C3**. Compounds cognitive load (every
custom sink must now also skip-guard). Effort M, but incomplete.

## Recommended staged path (lowest-risk-first)

1. **C2 → `RowOperator.BI0A` (do this; small, real, tested).** core's
   `View.BI0A` already routes to `sink.BI0A` when a sink defines its own
   (`sink.BI0A !== Value.prototype.BI0A`). `RowOperator` currently defines none,
   so array inserts fall to `BI0`→`loop`→misclassify. Give `RowOperator` a
   splice-aware `BI0A` that mirrors its existing splice-aware `BR1`: splice-insert
   the processed row at the positional `at`, emit a real `BI0`/`BR1` for the
   entering/leaving rows. Acceptance test = the C2 repro above (and a `filter`
   twin). Risk: medium-low, isolated to `RowOperator`; rerun `filter`/`map`/`sort`
   suites. **This is the single highest-ROI item in the trio.**

2. **C1/C4 → make the footgun loud, keep object-keyed as the contract.** Don't
   attempt the array incremental fix. Instead, reuse the new `$.debug` flag (from
   [C5](../ISSUES.md)): when a `RowOperator` (or an iter-op) is asked to consume an
   **array** source that carries explicit-`undefined` holes from a sparse
   producer, `console.warn` once pointing at the object-keyed-source mitigation.
   Turns today's silent corruption into a guided error for ~10 lines, zero
   hot-path cost, zero protocol risk. Update the docs to state object-keyed
   sources are *the* supported shape for sparse chains.

3. **C3 → defer.** It's a sort window re-key that would change `BMV1` 'move'
   semantics; orthogonal to holes, and no shipped workload chains windowed sorts.
   Keep the existing `oidx >= 0` phantom-`-1` guard; revisit only on demand.

4. **Full Approach 1 — only on real demand.** If a consumer genuinely needs
   array-source sparse chains to be incrementally correct (not just object-keyed),
   schedule Approach 1 as its own project with the staged plan the investigation
   produced (single-operator prototype → extend `BR1A` → `View.BR1` propagation →
   `DOMSink` → `BR2` → full-suite stride audit). Budget it as L/high-risk.

## Effort / risk / payoff

| Step | Closes | Effort | Risk | Recommend |
|---|---|---|---|---|
| 1. `RowOperator.BI0A` | C2 | S–M | low–med | ✅ do now |
| 2. `$.debug` array-hole warning + docs | C1/C4 (mitigate) | S | low | ✅ do now |
| 3. Defer C3 | — | — | — | ✅ leave |
| 4. Protocol stride-change (Approach 1) | C1, C4 (full) | L | high | ⏸ only on demand |

## Decision needed

- **Proceed with steps 1+2** (C2 real fix + C1/C4 loud-failure mitigation)? That
  closes C2 outright and de-fangs C1/C4 without touching the protocol.
- Or **schedule the full Approach 1** protocol surgery now (accepting L/high-risk)
  because array-source sparse chains must be incrementally correct?

My recommendation: **steps 1+2 now, Approach 1 only if a concrete consumer needs
it.** The shipped examples are all object-keyed; the trio is a footgun to
illuminate, not (yet) a protocol to rebuild.
