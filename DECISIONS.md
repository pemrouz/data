# Decisions & Resolved

Issues that have been **fixed**, **deliberately skipped (won't-fix)**, or **closed out** — moved here from [ISSUES.md](ISSUES.md) so the open register stays actionable. **Don't re-investigate these.** If one regresses, re-open it in ISSUES.md with the regression details and a failing test.

The array-positional correctness family (C1–C3) was closed on branch `fix/open-issues` (2026-06-06) under one **proof gate**: a differential operator-permutation harness ([differential.test.ts](differential.test.ts)) asserts the live incremental view ≡ a from-scratch rebuild across every operator × source-shape × mutation (**84 cases**, wired into `npm test`). Its `KNOWN_FAILURES` registry is now **empty** and **fails if a listed case starts passing**, so every fix had to flip the gate. Full design analysis: [.claude/array-contract-design.md](.claude/array-contract-design.md). Key findings from that doc: the items were **not** one root cause (C2 was an independently-missing `RowOperator.BI0A`, C1 was the protocol-coupled core, C3 a separate sort-window issue); the explicit-`undefined` holes are **load-bearing** for `intersect`'s by-index cross-source alignment, so "densify the producers" was **rejected**; the recommended minimal path (object-keyed sources + `$.debug` warning) was superseded by the full protocol fix once the user opted into it.

---

## Fixed

### C1 — array-positional desync after a sparse producer (the `BH1`/`BF0` hole-vs-splice signal) ✅
`efa74bf`, `9d93dde`, `a0d4712`, `f8f4c46`

`between`/`intersect`/`union`/`except` over an **array** source keep the array length stable and mark excluded slots as **positional holes** (explicit `undefined`); the View / `RowOperator` / DOM layers modelled array removes as **splice-shifts** (length shrinks, survivors slide down). With no signal distinguishing the two contracts, chaining a row/iter op after a sparse producer over an array either kept **ghost rows** (`between(arr).filter(fn)` after a reactive bound moved — `filter` spliced a slot the producer only nulled) or **threw** `Cannot read … (reading 'col')` calling an accessor on a hole (`filter(arr).between(...)`).

A contained length-heuristic was **proven impossible** first (a sparse array's `.length` collapses trailing holes — `between('v',[10,100])` over a length-3 source returns length 2 — so `RowOperator` can't infer hole-vs-splice from length). The fix adds explicit positional-stable verbs `View.BH1` (hole remove) / `View.BF0` (hole fill) that route to `sink.BH1`/`BF0` when present, else fall back to `BR1`/`BI0` (correct for position-agnostic aggregates — they just drop/add the row). `RowOperator`, `between` (producer + consumer), `group`, `length(fn)`, and `sort` implement the positional handling. This closed `between→filter/map/az`, `filter→between`, `group [array]`, `between→group`, and `length-fn [array]` — every realistic array-source sparse chain — with regression tests and zero perf regressions.

- Where: `View.BH1`/`BF0` in [core.ts](core.ts); [row.ts](row.ts); [operators/between/index.ts](operators/between/index.ts); [operators/group/index.ts](operators/group/index.ts); [operators/length/index.ts](operators/length/index.ts); [operators/sort/index.ts](operators/sort/index.ts).

### C2 — `map`/`filter` after a windowed sort dropped a row ✅
`2f171b5`

Same positional-insert root cause as C1. A row entering a windowed sort (`az`/`za`/`top`/`limit`) arrives as a positional `BI0A([rank, row])` (preceded by a `BR1A` evicting the row that fell out). `RowOperator.loop` read `view.value[rank]` (the displaced occupant at that position) as the row's "old" value, misclassified the insert as an *update*, and dropped the displaced row — `map` over a window returned `[1, 20]` where `[1, 10, 20]` was expected after a new element entered at position 0. Fixed by `RowOperator.BI0A`, which splices in lockstep (mirroring its `BR1`).

- Where: [row.ts](row.ts) `BI0A`; test [operators/sort/sort.test.ts](operators/sort/sort.test.ts) ("sort (za window) → map/filter follows window rotation without dropping a row").

### C3 — chained windowed sort surfaced stale content ✅
`ee918f6`

When two windowed sorts are chained (`za(col,n).az(col,n)`), the inner window rotated *which* upstream key sits at each position by emitting a **mid-window** `BR1A`(evict) + `BI0A`(insert) pair. The interior splice — plus the inconsistent intermediate window state *between* the two events — corrupted the outer sort's position→rank map (it keys `sorted` by inner positions), producing ghosts, dupes, and stale order vs a fresh rebuild.

**Fix:** a bounded full-window rotation only ever changes *content* at fixed positions, so `ZAValue._window()` reconciles it as content-stable `BU1`s plus a tail-only `BR1A`/`BI0A` for a genuine size change — the single-row generalisation of the `_batchRemove`/`_batchInsert` reconcile. Tail splices and `BU1`s compose correctly through a downstream sort; mid-window splices don't. The bounded `BU1` boundary-cross, `BI0` full-window insert, and `BR1`/`BR1A` in-window removal all route through `_window()`; unbounded sorts keep genuine mid-array splices; in-window rank shuffles still emit a single `BMV1`. Two latent bugs were fixed alongside: **`AZValue.XU0` never set `isArr`** (ascending sorts over arrays skipped index-shift bookkeeping — surfaced by `za→az` unbounded), and **`filter`'s array predicate-flip path** emitted splice-semantics `BI0`/`BR1` for what is really a hole fill/remove (now `RowOperator.loop` emits `BF0`/`BH1` and `ZAValue` implements them — surfaced by `filter→za-window→az-window`).

- Where: `ZAValue._window`/`BU1`/`BI0`/`BR1`/`BR1A`/`BF0`/`BH1` and `AZValue.XU0` in [operators/sort/index.ts](operators/sort/index.ts); `RowOperator.loop` in [row.ts](row.ts).
- Proof: 10 chained-sort permutations added to [differential.test.ts](differential.test.ts) (now 84 cases, `KNOWN_FAILURES` empty). The phantom-DOM `"-1"`-key symptom stays fixed by the `oidx >= 0` guard.
- Change-stream consequence: a single-row window rotation now emits `update`s, not `remove`+`insert` (no `undefined` flash on a rotated child view) — matching the batch-window path; [index.test.ts](index.test.ts)'s `za` change-stream was updated to match.

### C5 — 3-arg `reduce` symmetry guard ✅
`9187782`

The incremental `reduce(add, remove, init)` form requires `remove` to *exactly* cancel `add`'s contribution for a row; an asymmetric `remove` desyncs the accumulator silently. The fix adds an **opt-in** `$.debug` mode: each incremental `BI0`/`BR1` then re-folds from scratch and `console.warn`s on the first drift. It is O(N) per delta, so it stays a development aid (off in production, by design) — not a runtime guard.

- Where: [operators/reduce/index.ts](operators/reduce/index.ts) (`_verify` gated behind `$.debug`); test [operators/reduce/reduce.test.ts](operators/reduce/reduce.test.ts).
- Residual perf note: the 3-arg form still rebuilds on `BU2` (a nested in-place edit) — that's the narrowed open perf item [ISSUES.md → P3](ISSUES.md#p3), not a correctness gap. The `BU1` half of the original P3 is now resolved (see below).

### P3 (BU1 half) — 3-arg `reduce` `BU1` now incremental via a per-key value cache ✅

The incremental `reduce(add, remove, init)` form used to rebuild O(N) on `BU1` *and* `BU2` because the notification carries only the new value. `BU1` (a whole-slot overwrite, `data[k] = newRow`) is now O(Δ): the operator keeps a `Map` of each key's last-seen row (seeded on rebuild, maintained on `BI0`/`BR1`/`BU1`), and since a whole-slot overwrite changes the row *reference*, the cached old row ≠ the new one — so it does `remove(old)` + `add(new)`. The cache stores **references** (no clones), so it costs O(1) per insert and nothing for immutable-row workloads (crossfilter). The cache key is normalised to a string (`'' + k`) because array sources surface numeric keys on rebuild but string keys on `BU1` — without it the lookup silently misses and only `add` runs (an array-source desync; `$.debug` off wouldn't catch it). `BU2` (a nested in-place edit) stays a rebuild — the row reference is unchanged, so the cache holds the already-mutated row; closing it would need a per-row snapshot (penalising the immutable-row path) or an old-value protocol change. Tracked-onward as the narrowed [ISSUES.md → P3](ISSUES.md#p3).

- Where: [operators/reduce/index.ts](operators/reduce/index.ts) (`_cache`, `BU1`); tests [operators/reduce/reduce.test.ts](operators/reduce/reduce.test.ts) (BU1 incremental, BU2-still-rebuilds, array key-normalization, BI0→BU1→BR1 cascade), perf [operators/reduce/reduce.perf.ts](operators/reduce/reduce.perf.ts) (overwrite 100/10k ≈ 0.2ms).

### C6 — mixing proxies across two `dist/` entries (docs) ✅
README + devtools/README

Each tsup entry (`data`, `data/lean`, `data/full`, `data/devtools`, …) is built self-contained (`splitting: false`), so each bundle defines its **own** `$` and `value` symbol; importing from two entries at once yields different `$` instances and proxies created under one are unrecognised by the other. Resolved at the **docs** level (a prominent note in `README.md` and `devtools/README.md` plus the CLAUDE.md gotcha). The deep fix — parking the symbol on a `Symbol.for('data.value')` global registry, or a fail-fast guard — is a packaging redesign, **deferred** (no consumer has hit it; examples import from a single entry by construction).

- Where: [tsup.config.ts](tsup.config.ts) (`splitting: false`), [core.ts](core.ts) (per-bundle `value` symbol).

### C7 — `distinct` desync when an in-place edit moves a shared bucket's representative ✅
`8fd1574`

When two rows share a projection key and the *representative* (the instance cached in `output`) is mutated in place to a new key, `_update` left the stale reference in `output` and pushed it again — `{a:{k:'x'}, b:{k:'x'}}` then `a.k='y'` produced `[{k:'y'},{k:'y'}]` (bucket `x` lost, `y` duplicated) instead of `[{k:'y'},{k:'x'}]`. Fixed: `_update` detects the representative-leaves-occupied-bucket case (`firstRow.get(oldK) === row`) and falls back to `_rebuild()` from `BU2`; non-representative edits stay on the O(1) incremental path. (Originally mis-filed as a cosmetic identity-reference issue; it was a real output bug.)

- Where: [operators/distinct/index.ts](operators/distinct/index.ts); two regression tests in [operators/distinct/distinct.test.ts](operators/distinct/distinct.test.ts).

### D1 — `connect(fn)` single-arg form unsupported + stale doc line-ref ✅
`68550fb`

`connect` supports `connect(array)`, `connect(obj, 'prop')`, `connect(obj, fn)`; a bare `connect(fn)` has none of the protocol verbs, so it used to bare-attach and throw cryptically (`fn.BI0 is not a function`) on the first event. Three follow-ups closed: (1) the stale CLAUDE.md line-ref (`core.ts:601-622`) now points at the real handler and spells out the no-single-arg rule; (2) a type-level `@deprecated connect(fn): never` overload makes a lone-function call a hard TS error; (3) `connect()` now throws immediately for a bare-function arg with a message naming the supported forms.

- Where: [core.ts](core.ts) (`function connect(p, a, b)`); regression test in [core.test.ts](core.test.ts).

---

## Won't fix / skipped

### P2 — `max`/`min` aggregates recompute O(n) per publish
Evaluated and **skipped** (not a real win). Unlike `sum`/`avg` (O(1) per delta via running totals), `max`/`min` scan all tracked values on every publish, but the peer benchmarks show `data` already fastest on the aggregate workloads and the constant-factor mitigation is already in place — a parallel `Float64Array` indexed by a key→slot map, ~5–6× faster on V8 for 50k+ rows. A sorted multiset / heap would restore O(log n) but is reserved for a real bottleneck; none observed.

- Where: [operators/aggregate/index.ts](operators/aggregate/index.ts) (`MaxValue`/`MinValue` `_publish`), [operators/aggregate/BENCHMARK.md](operators/aggregate/BENCHMARK.md).

### P6 — `keys`/`values`/`reverse` rebuild on remove/update
Evaluated and **skipped** (not a real win). These are incremental on `BI0` (append) but rebuild from scratch on removes/updates. A parallel `name→index` map would make those incremental, but the ops do an O(n) output build anyway, so the map can't beat the array splice — no improvement on the (insert-only) benchmark.

- Where: [operators/keys/index.ts](operators/keys/index.ts), [operators/reverse/index.ts](operators/reverse/index.ts).

---

## Closed out

### T2 — WASM kernel experiment ("not worth pursuing")
Informational / housekeeping. [experiments/wasm/](experiments/wasm/) thoroughly evaluated a WASM backend. The headline ~19× aggregate speedup came entirely from two **JS** fixes (tracked `Map` + `MaxValue` `Float64Array`), both **landed**; WASM's incremental win after those was ~1.0–1.25× (noise), and a follow-up fully-columnar-in-WASM bench found only 0.5–1.6× over optimal-JS columnar — not worth the build/ship/memory surface. Listed so the conclusion isn't relitigated.

- Where: [experiments/wasm/README.md](experiments/wasm/README.md), [experiments/wasm/results-altbackend.md](experiments/wasm/results-altbackend.md).

---

## Earlier fixes (verified in source, pre-`fix/open-issues`)

Surfaced in the sweep but confirmed **already fixed** in current source. Listed so they aren't re-raised:

- **`between` stale-`sorted` after in-place edit, then insert/remove** — `7d6738e`: `BI0`/`BR1` fall back to `XU0` rebuild when `sortedDirty`; test [operators/between/between.test.ts](operators/between/between.test.ts).
- **`group` over sparse array sources throwing** — `972b5d1`: `XU0` skip-guard + graceful degrade; test [operators/group/group.test.ts](operators/group/group.test.ts).
- **`sort` phantom `-1` position key (chained windowed sort)** — the `oidx >= 0 && oidx < this.n` guard in `BR2`/`BU2`; test [operators/sort/sort.test.ts](operators/sort/sort.test.ts). (The *content* staleness behind it is now also fixed — see C3 above.)
- **`tap` desync when upstream mutates in place** — `282e791`: forwards the handed delta instead of re-deriving off the aliased value; tests [operators/tap/tap.test.ts](operators/tap/tap.test.ts).
- **`aggregate` desync downstream of `sort`/`limit` (numeric-key path)** — `'' + key` coercion at all entry points; test [operators/aggregate/aggregate.test.ts](operators/aggregate/aggregate.test.ts).
- **`distinct` non-incremental** — `0a4446b`: incremental `BI0`/`BU2`; the remaining rebuild paths are tracked as [ISSUES.md → P5](ISSUES.md#p5).
- **Render leaving stale DOM rows / `group`-over-array front-removal** — `ddf3a44`: snapshot keys before `remove_node` so the `for-in` loop can't cut short; test `tests/crossfilter.spec.ts`. *(A stale "known pre-existing gap" note for this still lingers in CLAUDE.md — tracked as [ISSUES.md → D2](ISSUES.md#d2).)*
- **Bounded `za` window O(Δ) churn on multi-row brush** — `fc4315a`: `_batchRemove`/`_batchInsert` reconcile the window once; perf test ~30ms vs a 200ms ceiling.
- **`keys`/`values`/`reverse`/`distinct` after a window (positional `BI0`)** — `62b19c4`: rebuild on array-upstream `BI0`. (`map`/`filter` were *excluded* — that became C2, since fixed.)
