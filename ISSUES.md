# Open Issues

A living register of issues that still need attention: correctness limitations, performance debt, and tooling/docs gaps that are open or deliberately deferred-but-live. **Resolved fixes, won't-fix decisions, and closed-out experiments live in [DECISIONS.md](DECISIONS.md)** — check there before re-investigating anything.

Last swept 2026-06-06. Line numbers are approximate and drift with edits — treat the file/function reference as authoritative, not the exact line. Most entries are *documented* limitations the shipped examples already work around by construction (object-keyed sources, defensive bindings, densifying); the handful that fail **silently** are flagged **High**. Severity reflects likelihood-of-biting-a-consumer, not theoretical impact.

## Summary

| # | Issue | Theme | Severity | Status |
|---|---|---|---|---|
| [C4](#c4) | Sparse producers (`between`/`intersect`/`union`/`except`) emit explicit `undefined` slots → phantom DOM rows when a row template binds them directly | Correctness · render | Medium | Open (mitigated by convention) |
| [P1](#p1) | `between` array-insert path is O(N) (defers swarm births/deaths) | Perf | Medium | Deferred |
| [P3](#p3) | 3-arg `reduce` falls back to O(N) rebuild on `BU2` (nested in-place edit; no old value in protocol) | Perf | Low | Open (BU1 half fixed) |
| [P4](#p4) | `to()` runs its `fn` on every `BU2` even when the result is reference-equal | Perf | Low | Open |
| [P5](#p5) | `distinct` rebuilds on `BR1`/`BU1`/`XU0` (incremental only on `BI0`/`BU2`) | Perf | Low | Open (by design) |
| [T1](#t1) | `dist/` is committed as a GitHub Pages fallback because Actions billing is locked | Tooling | Medium | Open (external blocker) |

Legend — **Status**: *Open (by design)* = a deliberate trade-off that could still bite a user; *Deferred* = a known optimization awaiting a workload that needs it; *Open (mitigated by convention)* = every shipped example already avoids it; *Open (external blocker)* = blocked on something outside the repo.

> Everything previously tracked here as C1/C2/C3/C5/C6/C7/D1/D2 (fixed/verified), P2/P6 (won't-fix), and T2 (closed-out), plus the "Recently resolved" appendix, has moved to [DECISIONS.md](DECISIONS.md). The array-positional correctness family is closed; the differential harness ([differential.test.ts](differential.test.ts)) has an empty `KNOWN_FAILURES`.

---

## Correctness

### C4
**Sparse producers emit explicit `undefined` slots → phantom DOM rows** · Medium · Open (mitigated by convention)

`between`/`intersect`/`union`/`except` build sparse arrays where excluded indices are set to explicit `undefined` (e.g. `view.value[name] = undefined`) rather than `delete`'d. The render layer iterates with `for (const i in value)` ([render/index.ts:124-126](render/index.ts#L124-L126)), which walks those slots as enumerable — so a row template bound **directly** to such a view creates a DOM node for each excluded slot and a binding like `r.pnl.to(fmtPnl)` resolves to `fmtPnl(undefined) → "NaN"`. RowOperator-based ops (`filter`, `gt`/`lt`/`gte`/`lte`, `map`) use `delete`, leaving true holes that `for-in` skips, so they don't hit this on a clean render.

Note this is the **render-layer** residual only — the *data*-layer hole-vs-splice desync (chaining operators after a sparse producer) was closed by the C1 `BH1`/`BF0` work (see [DECISIONS.md](DECISIONS.md)). What remains is the initial-render enumeration.

- Where: [render/index.ts:124-126](render/index.ts#L124-L126), [operators/between/index.ts](operators/between/index.ts), [operators/intersect/index.ts](operators/intersect/index.ts), [CLAUDE.md](CLAUDE.md) (sparse-render gotcha).
- **Mitigation:** densify first (`vp.to(arr => arr.filter(r => r !== undefined))` — see the `dense()` helper in [assets/demos.js](assets/demos.js)) or write bindings defensively (handle `r.col === undefined`, as [examples/library/main.js](examples/library/main.js) does).
- ⚠️ **No clean standalone fix — and the obvious one is *proven* broken.** A naive `if (value[i] === undefined) continue;` in the DOMSink loop is **only safe for object (keyed) sinks**. For an **array** sink — exactly what these producers emit — `create_node` is *positional* (it tail-appends and binds slot *k* to `data[k]`), so skipping a middle `undefined` would misalign every subsequent slot's binding and drop the real tail row. The seemingly-obvious next step — give `DOMSink` its own `BH1`/`BF0` (the protocol `core.ts` even names it as a candidate sink) — was implemented and **empirically refuted**: (1) `create_node`/`remove_node` are *tail-relative* (push/pop the tail, bind `data[tail]`), so a hole-aware init that skips slot *k* still binds node-0 to the hole and drifts `tail` out of alignment — it reproduces the original drop-the-tail/empty-row bug at init; (2) core's `Value.BF0`/`BH1` fire the V1 positional **content refresh** (`get_named(k).XU0()`) on the slot *before* the sink's `BF0`/`BH1` runs, so a manual `insertBefore` in `DOMSink.BF0` *double-applies* the fill → duplicate rows. A genuine fix must rewrite `create_node`/`remove_node` to be array-index-relative (not tail-relative) **and** reconcile with the pre-fired V1 refresh — a large, high-risk change for a path **no shipped consumer reaches** (sort/group/limit re-densify before the DOM sink; the examples densify or bind defensively). Until a real consumer needs a sparse producer bound straight to the DOM, the convention *is* the fix: densify (`vp.to(arr => arr.filter(r => r !== undefined))`) or bind defensively.

---

## Performance debt

### P1
**`between` array-insert path is O(N)** · Medium · Deferred

`between`'s sorted-index maintenance splices on insert; the array-source insert path is O(N) per insert (key-shift loop + `sorted.splice`). The `BU2` brushing path was already optimised to defer the splice behind a dirty flag (the crossfilter brushing hot path), so this only bites on insert/remove churn. It's why the [swarm example](examples/swarm/README.md) keeps a **fixed population** — births/deaths (`BI0`/`BR1` per agent) would put every operator on the O(N) path.

- Where: [operators/between/index.ts](operators/between/index.ts) (key-shift loop, `sorted.splice`), [examples/swarm/README.md](examples/swarm/README.md), [operators/between/BENCHMARK.md](operators/between/BENCHMARK.md).

### P3
**3-arg `reduce` falls back to O(N) rebuild on `BU2` (nested in-place edit)** · Low · Open (BU1 half fixed)

The incremental `reduce(add, remove, init)` form is O(Δ) on `BI0`/`BR1` (insert/remove) and now on `BU1` too — a whole-slot overwrite (`data[k] = newRow`) recovers the old row from a per-key reference cache and does `remove(old)` + `add(new)` (see [DECISIONS.md → P3 (BU1 half)](DECISIONS.md)). What remains is **`BU2`** — a *nested* in-place edit (`data[k].f = x`): the row's reference is unchanged, so the cache holds the already-mutated row and there's no pre-edit value to subtract, so it rebuilds. Workloads that edit fields of existing rows in place directly on a `reduce` source (e.g. kanban's points-by-assignee on a `card.points = …` edit) lose the incremental path there; they're correct (rebuild is exact) but O(N) per edit.

- Where: [operators/reduce/index.ts](operators/reduce/index.ts) (`BU2` rebuilds), [core.ts](core.ts) (protocol carries new value only), [operators/reduce/BENCHMARK.md](operators/reduce/BENCHMARK.md); pinned by the `reduce.incremental - BU2 (nested in-place edit) still rebuilds` test.
- Why not the reference cache: it's useless for `BU2` because the mutated row is the *same object* the cache already holds. Closing `BU2` would need either a per-row **snapshot** cache (a `structuredClone` per insert/edit — that penalises the immutable-row crossfilter path the operator is tuned for, so it's a bad blanket trade) or a protocol change that threads the **old** value through `BU2` (which would also help any operator wanting old-value deltas, but touches every `BU2` implementer). Defer until a workload needs in-place-edit-heavy direct-on-source reduce.

### P4
**`to()` runs its `fn` on every `BU2`** · Low · Open

`to`'s `BU2` calls `fn` unconditionally, then a `===` check skips the *downstream* notification when the result is reference-equal — but the `fn` call itself isn't skipped. A safe skip would need to know `fn` only reads shape (not values), a hint the API doesn't expose. Negligible when `fn` is O(1); shows up as a small single-tick gap vs dependency-tracking libs (mobx/vue) that can skip re-evaluation.

- Where: [operators/to/index.ts](operators/to/index.ts), [operators/to/BENCHMARK.md](operators/to/BENCHMARK.md).

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
