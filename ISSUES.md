# Open Issues

A living register of issues that still need attention: correctness limitations, performance debt, and tooling/docs gaps that are open or deliberately deferred-but-live. **Resolved fixes, won't-fix decisions, and closed-out experiments live in [DECISIONS.md](DECISIONS.md)** — check there before re-investigating anything.

Last swept 2026-06-08. Line numbers are approximate and drift with edits — treat the file/function reference as authoritative, not the exact line. Most entries are *documented* limitations the shipped examples already work around by construction (object-keyed sources, defensive bindings, densifying); a handful that fail **silently** would be flagged **High** (none open right now). Severity reflects likelihood-of-biting-a-consumer, not theoretical impact.

## Summary

| # | Issue | Theme | Severity | Status |
|---|---|---|---|---|
| [C14](#c14) | `intersect` over INDEPENDENT **array** sources doesn't admit a tail insert (the echoing source's bit never reaches `all` because siblings don't echo that index) | Correctness | Low | Open (not shipped-reachable; use object-keyed/derived sources) |
| [C16](#c16) | `intersect` with a SPARSE producer (`between`) as its PRIMARY drops a survivor on an array remove (a C14-family trade-off) | Correctness | Low | Open (not shipped-reachable; raw-primary intersect / object keys) |
| [P3](#p3) | 3-arg `reduce` falls back to O(N) rebuild on `BU2` (nested in-place edit; no old value in protocol) | Perf | Low | Open (BU1 half fixed) |
| [P5](#p5) | `distinct` rebuilds on `BR1`/`BU1`/`XU0` (incremental only on `BI0`/`BU2`) | Perf | Low | Open (by design) |
| [P7](#p7) | scalar aggregates / `length(fn)` over an **array** source rebuild O(N) on a structural change or a sparse-producer membership flip (no incremental BH1/BF0) | Perf | Low | Open (correctness over speed) |
| [T1](#t1) | `dist/` is committed as a GitHub Pages fallback because Actions billing is locked | Tooling | Medium | Open (external blocker) |

Legend — **Status**: *Open (by design)* = a deliberate trade-off that could still bite a user; *Open (not shipped-reachable)* = real but no shipped example hits it; *Deferred* = a known optimization awaiting a workload that needs it; *Open (external blocker)* = blocked on something outside the repo.

> Everything previously tracked here as C1–C13/D1/D2 (fixed/verified) and P1/P2/P4/P6 (re-landed / won't-fix), plus T2 (closed-out), has moved to [DECISIONS.md](DECISIONS.md). **C13** (RowOperator over an array with trailing-excluded rows being length-misaligned) was closed by the 2026-06-11 re-examination: `RowOperator.XU0` now pads the array output to source length. **C15** (the 9 `between`/set-algebra `KNOWN_FAILURES` over arrays under combined churn) was closed by the 2026-06-13 work — see [DECISIONS.md → C15](DECISIONS.md). The differential harness ([differential.test.ts](differential.test.ts)) runs every scenario (filter/map/sort/between/group/length/aggregate **and** intersect/union/except, plus set-algebra→sort/aggregate compositions), array **and** object, under a widened mutation vocabulary (slot-clear, refill, whole-row overwrite, patch-batch, mid-insert) against a from-scratch rebuild; **`KNOWN_FAILURES` is now EMPTY**, and the two narrow residuals the adversarial probe surfaced after that are tracked as [C16](#c16) (not parked in the harness — one is a false-green on the default seeds; both have the object-keyed workaround).

---

## Correctness

### C16
**`intersect` with a SPARSE producer (`between`) as its PRIMARY drops a survivor on an array remove** · Low · Open (not shipped-reachable; raw-primary intersect / object keys)

C15 (the 9 differential `KNOWN_FAILURES`) is **CLOSED** — see [DECISIONS.md → C15](DECISIONS.md). The 2026-06-13 adversarial probe then drove the producers further and pinned two remaining residuals; one of them — `union→sort` under a facet-MOVING `patch-batch` — is **now also fixed** (`UnionValue._enter` emits its re-rank `BU1`s before its insert `BF0`/`BI0`, keeping a downstream sort's order monotonic for the insert's bisect; verified by 36,000 `union→za` stress runs and the `union→za` harness scenario). The one residual that remains:

**`intersect` with a SPARSE producer (`between`/`intersect`/`except`) as its PRIMARY** (e.g. `s.between(...).intersect(facet)`). `IntersectValue.BR1A` routes a non-primary echo to `_leave` (by-name) — this DELIBERATELY supports the C14 independent-array case (and has a test). When the primary is itself a sparse-array producer, the primary echoes FIRST and splices, so the secondary's `_leave`, post-splice, addresses the survivor that shifted into the freed slot and drops it. No-opping the secondary echo (like `union`/`except` do) would fix this — but break the C14 independent-array remove the original design chose to support, for a case that is itself **not shipped-reachable**: the shipped crossfilter intersects a RAW source with between/filter facets as SECONDARIES (`s.intersect(s.between(...))`), which is correct and harness-covered. between-as-PRIMARY-of-intersect over an array is the only affected shape. So this is left as a deliberate C14-family trade rather than flipped.

**Not shipped-reachable / workaround**: keep the raw source (or a non-sparse view) as intersect's primary with betweens/filters as secondaries — the shipped pattern — or use object-keyed sources (stable keys, no positional shift). Verified narrow by the adversarial probe + 18,600-run stress (every other set-algebra→sort/aggregate composition over arrays is clean).

- Where: [operators/intersect/index.ts](operators/intersect/index.ts) `BR1A` (`_leave` on the non-primary echo — kept for C14).

---

### C14
**`intersect` over INDEPENDENT ARRAY sources doesn't admit a tail insert** · Low · Open (not shipped-reachable; use object-keyed or derived sources)

`intersect(viewA, viewB)` over two **independent arrays** is a POSITIONAL intersect (index `i` visible iff present in every source at `i`). The array `BI0A` handler folds membership only from the ECHOING source's carried bit and deliberately never reads sibling sources — sound for DERIVED facets (every facet echoes the same underlying change, so each bit arrives via its own echo, order-independently) but wrong for independent sources: a tail insert into one array is echoed only by that array, the siblings never echo that index, so its bit never reaches `all` and the row stays excluded forever.

**Not shipped-reachable**: positional intersect of two unrelated arrays is a semantically-narrow operation; the crossfilter example and every shipped use intersect DERIVED facets (all from one source) or **object-keyed** sources. The object form admits a shared new key correctly (verified). Reading siblings on a tail insert would double-handle the derived case and is order-sensitive (an early echo could read a sibling that hasn't processed the insert yet), so it's deliberately not attempted — it would risk the load-bearing C12 derived-facet array path for a narrow case.

- Where: [operators/intersect/index.ts](operators/intersect/index.ts) `BI0A` ("never reads other sources").
- Workaround: use **object-keyed** sources for independent intersect, or derive the facets from one source. This is the same object-keyed-source guidance the rest of the set-algebra docs give.

---

## Performance debt

### P3
**3-arg `reduce` falls back to O(N) rebuild on `BU2` (nested in-place edit)** · Low · Open (BU1 half fixed)

The incremental `reduce(add, remove, init)` form is O(Δ) on `BI0`/`BR1` (insert/remove) and now on `BU1` too — a whole-slot overwrite (`data[k] = newRow`) recovers the old row from a per-key reference cache and does `remove(old)` + `add(new)` (see [DECISIONS.md → P3 (BU1 half)](DECISIONS.md)). What remains is **`BU2`** — a *nested* in-place edit (`data[k].f = x`): the row's reference is unchanged, so the cache holds the already-mutated row and there's no pre-edit value to subtract, so it rebuilds. Workloads that edit fields of existing rows in place directly on a `reduce` source (e.g. kanban's points-by-assignee on a `card.points = …` edit) lose the incremental path there; they're correct (rebuild is exact) but O(N) per edit.

- Where: [operators/reduce/index.ts](operators/reduce/index.ts) (`BU2` rebuilds), [core.ts](core.ts) (protocol carries new value only), [operators/reduce/BENCHMARK.md](operators/reduce/BENCHMARK.md); pinned by the `reduce.incremental - BU2 (nested in-place edit) still rebuilds` test.
- Why not the reference cache: it's useless for `BU2` because the mutated row is the *same object* the cache already holds. Closing `BU2` would need either a per-row **snapshot** cache (a `structuredClone` per insert/edit — that penalises the immutable-row crossfilter path the operator is tuned for, so it's a bad blanket trade) or a protocol change that threads the **old** value through `BU2` (which would also help any operator wanting old-value deltas, but touches every `BU2` implementer). Defer until a workload needs in-place-edit-heavy direct-on-source reduce.

### P5
**`distinct` rebuilds on `BR1`/`BU1`/`XU0`** · Low · Open (by design)

`distinct` is incremental on `BI0` (O(1) admits/bumps) and `BU2` (bucket migrations) but rebuilds on `BR1`/`BU1`/`XU0`, because the test suite encodes a "first-seen order tracks current source iteration order" semantic that isn't expressible as O(1) edits on remove. Common workloads (insert-heavy ingestion, attribute rewrites) stay incremental — this only bites remove-heavy churn.

- Where: [operators/distinct/index.ts](operators/distinct/index.ts), [operators/distinct/BENCHMARK.md](operators/distinct/BENCHMARK.md).

---

### P7
**Scalar aggregates / `length(fn)` over an ARRAY source rebuild O(N) on a structural change or membership flip** · Low · Open (correctness over speed)

`AggregateValue` (sum/avg/max/min/some/every) and `LengthFnValue` key their per-row state by POSITION. Over an ARRAY source a structural insert/remove SHIFTS positions, so `BR1`/`BI0` re-sync via a full `XU0` rebuild (the position→value map can't be trusted incrementally) — correct but O(N). A sparse producer's length-stable membership flip (`BH1`/`BF0` from a `between`/`intersect` brush) is length-stable and *could* be an O(1) delta, but these operators deliberately do NOT implement `BH1`/`BF0`: an incremental delta there desynced the running total on a brush (live 121 vs want 55 in the differential harness), because `between`'s hole-flip emission doesn't map 1:1 onto the aggregate's position-keyed delta. So the flip falls back to `BR1`/`BI0` → the O(N) rebuild.

**Why not fixed**: the rebuild is *correct*; an incremental BH1/BF0 was *wrong*. The shipped crossfilter brush is rAF-coalesced, so it pays the rebuild at most once per frame. A correct incremental path would need the producer to emit a clean per-position membership delta the aggregate can trust — a protocol change not worth the risk for a low-severity perf case. Object-keyed aggregates (stable keys) are already fully incremental.

- Where: [operators/aggregate/index.ts](operators/aggregate/index.ts) (`AggregateValue.BR1`/`BI0` array rebuild; no `BH1`/`BF0`), [operators/length/index.ts](operators/length/index.ts) (`LengthFnValue` same).

---

## Tooling & docs

### T1
**`dist/` committed as a GitHub Pages fallback (Actions billing locked)** · Medium · Open (external blocker)

The Pages site ([index.html](index.html) + `assets/` + `examples/` + operator docs) imports the library from `./dist/*` via an importmap, but `dist/` is normally gitignored — a plain branch-deploy would 404 every `data` import. Because GitHub Actions billing is locked, the proper workflow ([.github/workflows/pages.yml](.github/workflows/pages.yml)) can't run, so `dist/` is **manually rebuilt and committed** each release as a fallback. Tracked working state, not a bug, but it's tooling debt: built output lives in history, and the two paths (committed fallback vs the workflow) must be kept straight.

- Where: [.github/workflows/pages.yml](.github/workflows/pages.yml), [.gitignore](.gitignore).
- Resolution: revert to the Actions workflow and re-ignore `dist/` once billing is restored.

---

### Notes on scope

- This register lists what's *open*; the per-operator `BENCHMARK.md` "How" sections and the CLAUDE.md "Common gotchas" remain the authoritative long-form explanations, and several entries here point back at them.
- The array-positional design analysis (including why densifying was rejected and why the holes are load-bearing) is in [.claude/array-contract-design.md](.claude/array-contract-design.md) and summarised in [DECISIONS.md](DECISIONS.md).
