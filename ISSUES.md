# Open Issues

A living register of issues that still need attention: correctness limitations, performance debt, and tooling/docs gaps that are open or deliberately deferred-but-live. **Resolved fixes, won't-fix decisions, and closed-out experiments live in [DECISIONS.md](DECISIONS.md)** — check there before re-investigating anything.

Last swept 2026-06-08. Line numbers are approximate and drift with edits — treat the file/function reference as authoritative, not the exact line. Most entries are *documented* limitations the shipped examples already work around by construction (object-keyed sources, defensive bindings, densifying); a handful that fail **silently** would be flagged **High** (none open right now). Severity reflects likelihood-of-biting-a-consumer, not theoretical impact.

## Summary

| # | Issue | Theme | Severity | Status |
|---|---|---|---|---|
| [C12](#c12) | `intersect` over an **array** source desyncs on a *remove sequence* (a ghost row accumulates); the differential harness has **no `intersect` coverage** | Correctness | Low | Open (not shipped-reachable) |
| [P3](#p3) | 3-arg `reduce` falls back to O(N) rebuild on `BU2` (nested in-place edit; no old value in protocol) | Perf | Low | Open (BU1 half fixed) |
| [P5](#p5) | `distinct` rebuilds on `BR1`/`BU1`/`XU0` (incremental only on `BI0`/`BU2`) | Perf | Low | Open (by design) |
| [T1](#t1) | `dist/` is committed as a GitHub Pages fallback because Actions billing is locked | Tooling | Medium | Open (external blocker) |

Legend — **Status**: *Open (by design)* = a deliberate trade-off that could still bite a user; *Open (not shipped-reachable)* = real but no shipped example hits it; *Deferred* = a known optimization awaiting a workload that needs it; *Open (external blocker)* = blocked on something outside the repo.

> Everything previously tracked here as C1–C10/D1/D2 (fixed/verified) and P1/P2/P4/P6 (re-landed / won't-fix), plus T2 (closed-out), has moved to [DECISIONS.md](DECISIONS.md). The array-positional correctness family is closed; the differential harness ([differential.test.ts](differential.test.ts)) carries `between→length/sum/avg`, `between→az/za`, and `az/za→limit` scenarios with an empty `KNOWN_FAILURES`.

---

## Correctness

### C12
**`intersect` over an array source desyncs on a remove sequence (ghost row)** · Low · Open (not shipped-reachable)

`intersect(source, …facets)` over an **array** source drifts under a *sequence* of source removes (`delete arr[i]`, which leaves a hole — no splice): a single remove is handled, but repeated remove churn accumulates a **ghost row** in the intersect output (measured ~all of a 25-step random-remove sequence desyncs; e.g. live `[22,33,55,66]` vs a fresh rebuild's `[33,55,66]`). The intersect membership bitmask / row tracking isn't kept consistent as holes accumulate.

Surfaced while resolving the [DECISIONS.md → C11](DECISIONS.md) `limit` investigation — `intersect→limit` "remove array" failures were traced to `intersect` itself (they reproduce with **no `limit`**). The **differential harness has no `intersect` scenarios at all**, which is why this went unseen (it covers `between`-rooted chains, sorts, aggregates, but not `intersect`/`union`/`except` as the head operator).

**Not shipped-reachable**: no example removes rows from an `intersect`'s array source — crossfilter (`flights.intersect(dims)`) and swarm (`pop.intersect(…)`) use **static / fixed-population** sources, and the library's source is a fixed media list. `intersect` over an **object** source under removes is correct.

- Where: [operators/intersect/index.ts](operators/intersect/index.ts) (array-source membership maintenance across hole accumulation).
- Fix direction: add `intersect`/`union`/`except` (head-operator) scenarios to [differential.test.ts](differential.test.ts) — array **and** object, with the standard insert/remove/update/brush mix — to pin the bug and guard the family; then make the array-source membership tracking hole-stable under remove churn. Object-keyed sources are the workaround until fixed.

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
