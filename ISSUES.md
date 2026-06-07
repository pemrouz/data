# Open Issues

A living register of issues that still need attention: correctness limitations, performance debt, and tooling/docs gaps that are open or deliberately deferred-but-live. **Resolved fixes, won't-fix decisions, and closed-out experiments live in [DECISIONS.md](DECISIONS.md)** — check there before re-investigating anything.

Last swept 2026-06-06. Line numbers are approximate and drift with edits — treat the file/function reference as authoritative, not the exact line. Most entries are *documented* limitations the shipped examples already work around by construction (object-keyed sources, defensive bindings, densifying); the handful that fail **silently** are flagged **High**. Severity reflects likelihood-of-biting-a-consumer, not theoretical impact.

## Summary

| # | Issue | Theme | Severity | Status |
|---|---|---|---|---|
| [P1](#p1) | `between` insert/remove is O(N) (key-shift + `sorted.splice`); a deferral was tried (`1d3bc15`) then **reverted** — it desynced `between→length`/`between→filter` | Perf | Medium | Deferred (deferral reverted) |
| [C8](#c8) | `between`'s `set extent` narrow/widen loop can emit a **spurious `BR1`** for an already-excluded row → `between→length`/`sum`/`avg` desyncs (count can go negative) | Correctness | High | Open (pre-existing, newly found) |
| [P3](#p3) | 3-arg `reduce` falls back to O(N) rebuild on `BU2` (nested in-place edit; no old value in protocol) | Perf | Low | Open (BU1 half fixed) |
| [P5](#p5) | `distinct` rebuilds on `BR1`/`BU1`/`XU0` (incremental only on `BI0`/`BU2`) | Perf | Low | Open (by design) |
| [T1](#t1) | `dist/` is committed as a GitHub Pages fallback because Actions billing is locked | Tooling | Medium | Open (external blocker) |

Legend — **Status**: *Open (by design)* = a deliberate trade-off that could still bite a user; *Deferred* = a known optimization awaiting a workload that needs it; *Open (external blocker)* = blocked on something outside the repo.

> Everything previously tracked here as C1/C2/C3/C4/C5/C6/C7/D1/D2 (fixed/verified), P2/P4/P6 (won't-fix), and T2 (closed-out), plus the "Recently resolved" appendix, has moved to [DECISIONS.md](DECISIONS.md). The array-positional correctness family is closed; the differential harness ([differential.test.ts](differential.test.ts)) has an empty `KNOWN_FAILURES`.

---

## Correctness

### C8
**`between`'s `set extent` emits a spurious `BR1` for an already-excluded row → `between→length`/`sum`/`avg` desync** · High · Open (pre-existing, newly found)

The narrow/widen loops in `between`'s `set extent` ([operators/between/index.ts](operators/between/index.ts)) can re-emit a `BR1` (remove) for a row that has *already* left the view (e.g. excluded by a prior brush). `between`'s own `view.value` stays correct (it's recomputed structurally), but a downstream **counting/aggregating** sink (`length()`/`sum()`/`avg()`) decrements on the phantom remove and desyncs — the count can drift to **0 or negative**. An adversarial differential (20k random object sequences) measured ~33.6% desync on *edit+brush* sequences, present in the code **independently of P1** (P1's `XU0` self-heal had been masking it on the insert/remove path; reverting P1 restores that mask but not the underlying fix). Shipped-reachable: the [swarm example](examples/swarm/README.md) does `intersect → length` over a population that mutates in place *and* brushes a cohort.

- Where: [operators/between/index.ts](operators/between/index.ts) (`set extent` narrow/widen loops push `BR1`/`BH1` without checking the slot is currently in view).
- Fix direction: skip a row whose `view.value` slot is already `undefined` before pushing it to `R1`. Add a `between→length`/`sum`/`avg` scenario to [differential.test.ts](differential.test.ts) (the current harness has `between→filter`/`map`/`group`/`distinct`/`az` but **no aggregate**, which is why it slipped through).

---

## Performance debt

### P1
**`between` insert/remove is O(N); a deferral was attempted and reverted** · Medium · Deferred (deferral reverted)

`between`'s sorted-index maintenance splices on insert; the array-source insert path is O(N) per insert (key-shift loop + `sorted.splice`), and object remove is O(N) (`sorted.indexOf` + `splice`). The `BU2` brushing path was already optimised to defer the splice behind a dirty flag (the crossfilter brushing hot path), so this only bites on insert/remove churn. It's why the [swarm example](examples/swarm/README.md) keeps a **fixed population** — births/deaths (`BI0`/`BR1` per agent) would put every operator on the O(N) path.

A deferral (`1d3bc15`: drop incremental `sorted` maintenance from `BI0`/`BR1`, rebuild lazily on the next brush) made object insert/remove O(1) (~100× on remove churn) **but was reverted** — it removed a coarse-`XU0` self-heal that had been masking [C8](#c8) on the insert/remove path, so `between→length`/`sum`/`avg` desynced (counts went negative) and `between→filter` over arrays grew a ghost row. Re-attempt only **after** C8's root-cause (the spurious `BR1`) is fixed and a `between→length` differential scenario exists to guard it.

- Where: [operators/between/index.ts](operators/between/index.ts) (key-shift loop, `sorted.splice`), [examples/swarm/README.md](examples/swarm/README.md), [operators/between/BENCHMARK.md](operators/between/BENCHMARK.md).

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
