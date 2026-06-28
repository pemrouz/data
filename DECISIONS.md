# Decisions & Resolved

Issues that have been **fixed**, **deliberately skipped (won't-fix)**, or **closed out** — moved here from [ISSUES.md](ISSUES.md) so the open register stays actionable. **Don't re-investigate these.** If one regresses, re-open it in ISSUES.md with the regression details and a failing test.

The array-positional correctness family (C1–C3) was closed on branch `fix/open-issues` (2026-06-06) under one **proof gate**: a differential operator-permutation harness ([differential.test.ts](differential.test.ts)) asserts the live incremental view ≡ a from-scratch rebuild across every operator × source-shape × mutation (**84 cases**, wired into `npm test`). Its `KNOWN_FAILURES` registry is now **empty** and **fails if a listed case starts passing**, so every fix had to flip the gate. Full design analysis: [.claude/array-contract-design.md](.claude/array-contract-design.md). Key findings from that doc: the items were **not** one root cause (C2 was an independently-missing `RowOperator.BI0A`, C1 was the protocol-coupled core, C3 a separate sort-window issue); the explicit-`undefined` holes are **load-bearing** for `intersect`'s by-index cross-source alignment, so "densify the producers" was **rejected**; the recommended minimal path (object-keyed sources + `$.debug` warning) was superseded by the full protocol fix once the user opted into it.

---

## Type-surface design (v2)

### TD1 — object children are bare `Data<T[K]>` (drop the `| T[K]` raw arm); methods are the typed write surface ✅
`faf9b75` (issue #67)

**Decision.** `Children<T>`'s object branch is `{ [K in keyof T]: Data<T[K]> }` — a bare child view, with **no** `| T[K]` raw alternative. The underlying value is read/written through the `[value]` symbol; the *typed* write surface is `child.update(v)` / `child[value] = v` and `child.remove()`; `.get(k)` is the method twin of `proxy[k]` for dynamic/computed keys.

**Why the union existed, and its cost.** v1's branch was `{ [K in keyof T]: Data<T[K]> | T[K] }`. The `| T[K]` arm let `proxy.field = rawValue` (the mutate-by-assignment API) type-check. But a **mapped member has one type for both read and write**, so admitting the raw value on *write* also widened every *read* to `Data<T[K]> | T[K]` — and a union isn't a `Data`, so chaining an operator off a child (`proxy.child.filter(…)`, `to(res.a, …)`) needed an `as Data<…>` cast. That cast was the irreducible tax of the union.

**Why not asymmetric get/set.** TypeScript supports read-type ≠ write-type **only** on an explicit named `get`/`set` accessor pair, never on a mapped/index member — so "read as `Data`, accept raw on write" is inexpressible generically (verified identical across tsc 5.7, tsc 7.0-rc, and native tsgo). The symmetric union was the only fallback; there was no asymmetric escape.

**Options weighed.** (A) keep the union + cast — rejected; the cast sits on the hottest path (child chaining). **(B, chosen)** drop the raw arm — children become bare `Data`, child chaining is cast-free, and the typed write moves to methods/`[value]`. (C) recursive children — doesn't remove the read-side widening. (D) asymmetric accessors — impossible (above). (E) a `raw()` cast helper — write-only-sound and strictly worse than `[value]`, which is sound on read too and built-in. (F) typed methods + loose-`any` navigation — throws away the per-child typing that makes the surface worth having.

**Consequences.**
- Cast-free child chaining is the headline win — the v1 `as Data<…>` cast is gone (`operators/to/to.test.ts` et al.).
- `delete proxy.k` still type-checks (key optionality is preserved); `.remove()` is its typed twin.
- **Backward-compatible at RUNTIME**: the `set` / `deleteProperty` traps are unchanged, so bare `proxy.k = v` / `delete proxy.k` still *run* — they're only no longer type-checked. `.update()` / `.remove()` dispatch to the **same** `res.update` / `res.remove` calls as the traps, so the method idiom is behaviour-identical (the migration of the data apps is provably a no-op at runtime).
- **Breaking change → v2.0.0**: a consumer's bare-`=` object-child write stops type-checking; migrate to `child.update(v)` / `child[value] = v` / `child.remove()`.

**Where:** `Children<T>` + the `get` dispatch in [core.ts](core.ts); fixtures [types/check.ts](types/check.ts) (cast-free-chaining positive) + [types/check.negative.ts](types/check.negative.ts) (bare `= raw` rejected, `.update`/`[value]=` still value-check); `.get()` test in [core.test.ts](core.test.ts). The examples / landing / perf data apps are migrated to the method idiom in companion commits (runtime unaffected; they're `noCheck`, so not gated).

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

### C4 — sparse producer bound straight to the DOM rendered phantom rows ✅

`between`/`intersect`/`union`/`except` build sparse arrays with **explicit `undefined`** at excluded slots (load-bearing for `intersect`'s by-index correlation — not `delete`'d). The DOM layer iterated `for (const i in value)`, walking those holes as enumerable, so a row template bound **directly** to such a view minted a phantom `<li>` per excluded slot (`r.col.to(fmt)` → `fmt(undefined)`). The **object-half** was closed first (`1e0dc00`: object sinks skip explicit-`undefined` keys — safe because object `create_node` is already index-relative). The **array-half** is now closed too: `DOMSink` detects a sparse array (`_sparse`) and reconciles it **index-keyed** (`_reconcile_sparse`/`_create_at`/`_remove_at`, `node[k] ↔ data[k]`), and implements `BH1`/`BF0` so a producer's hole-remove/hole-fill drops/creates the node *at* index k without shifting survivors. This works *because* core's `View.BH1`/`BF0` fire the V1 content refresh on the touched child **before** the sink's `BH1`/`BF0`, and an index-keyed node is not double-applied (the exact hazard that had this deferred). Dense arrays (sort/group/limit) never hole, so they keep the tail-relative `create_node`/`remove_node` path untouched; the initial sparse build appends in index order (O(P), not the naive O(P²) per-create scan).

The DOMSink path alone only fixed `between` — it emits `BH1`/`BF0` on a bound move, but `intersect`/`union`/`except` still emitted plain `BR1`/`BI0`, which core routes to the splice-shift `BR1A`/`BI0A` and **corrupted the index-keyed sink** on an incremental change (wrong rows + phantom trailing `<li>`; init was fine, the *update* regressed). An adversarial sweep caught this; `45fed7f` completed the closure by giving all three operators `BH1`/`BF0` consumer methods (shared `_leave`/`_enter`/`_removeFrom`/`_insertFrom` helpers with a `hole` flag, so the `BR1`/`BI0` paths stay byte-identical), so a membership change over an array emits the hole verbs like `between`. All four sparse producers now bind straight to a row template correctly — init **and** incremental.

The earlier write-up declared this "no clean fix, no shipped consumer" — both premises shifted: the swarm (array `between → intersect` cohort) and crossfilter (array `za → between/intersect → length(fn)`) examples are array-source sparse-chain consumers at the **data** layer, and a row template can now bind a sparse producer directly. (Reading the raw `view[value]` still surfaces `undefined` slots — densify when you iterate it yourself.)

- Where: `DOMSink._sparse`/`_reconcile_sparse`/`_create_at`/`_append_at`/`_remove_at`/`BH1`/`BF0` and the sparse-array branch in `XU0` in [render/index.ts](render/index.ts); `View.BH1`/`BF0` in [core.ts](core.ts); the `BH1`/`BF0` emission in [operators/intersect/index.ts](operators/intersect/index.ts), [operators/union/index.ts](operators/union/index.ts), [operators/except/index.ts](operators/except/index.ts) (`45fed7f`) and [operators/between/index.ts](operators/between/index.ts).
- Proof: `render - array sparse producer (between) …` and `render - intersect/union/except over an ARRAY bound to the DOM track an incremental bound move (C4 array-half, all sparse producers)` in [render/list.test.ts](render/list.test.ts) (init + incremental bound move for all four producers; the object-half test sits beside them). Full `npm test` green, `npm run perf` in-band; library + crossfilter e2e green.
- Two adversarial sweeps verified the closure: the first caught the intersect/union/except gap (only `between` emitted the protocol); the second confirmed the `45fed7f` fix-forward resolved it with no new regression (byte-equivalent `BR1`/`BI0` paths, 12k+ fuzzed steps/operator). A separate **pre-existing** counting-sink desync (`between→length` via a spurious `BR1` on rebrush) was surfaced and is tracked as [ISSUES.md](ISSUES.md) C8 — not part of this closure.

### C5 — 3-arg `reduce` symmetry guard ✅
`9187782`

The incremental `reduce(add, remove, init)` form requires `remove` to *exactly* cancel `add`'s contribution for a row; an asymmetric `remove` desyncs the accumulator silently. The fix adds an **opt-in** `$.debug` mode: each incremental `BI0`/`BR1` then re-folds from scratch and `console.warn`s on the first drift. It is O(N) per delta, so it stays a development aid (off in production, by design) — not a runtime guard.

- Where: [operators/reduce/index.ts](operators/reduce/index.ts) (`_verify` gated behind `$.debug`); test [operators/reduce/reduce.test.ts](operators/reduce/reduce.test.ts).
- Residual perf note: the 3-arg form still rebuilds on `BU2` (a nested in-place edit) — that's the narrowed open perf item [ISSUES.md → P3](ISSUES.md#p3), not a correctness gap. The `BU1` half of the original P3 is now resolved (see below).

### P3 (BU1 half) — 3-arg `reduce` `BU1` now incremental via a per-key value cache ✅

The incremental `reduce(add, remove, init)` form used to rebuild O(N) on `BU1` *and* `BU2` because the notification carries only the new value. `BU1` (a whole-slot overwrite, `data[k] = newRow`) is now O(Δ): the operator keeps a `Map` of each key's last-seen row (seeded on rebuild, maintained on `BI0`/`BR1`/`BU1`), and since a whole-slot overwrite changes the row *reference*, the cached old row ≠ the new one — so it does `remove(old)` + `add(new)`. The cache stores **references** (no clones), so it costs O(1) per insert and nothing for immutable-row workloads (crossfilter). The cache key is normalised to a string (`'' + k`) because array sources surface numeric keys on rebuild but string keys on `BU1` — without it the lookup silently misses and only `add` runs (an array-source desync; `$.debug` off wouldn't catch it). `BU2` (a nested in-place edit) stays a rebuild — the row reference is unchanged, so the cache holds the already-mutated row; closing it would need a per-row snapshot (penalising the immutable-row path) or an old-value protocol change. Tracked-onward as the narrowed [ISSUES.md → P3](ISSUES.md#p3).

- Where: [operators/reduce/index.ts](operators/reduce/index.ts) (`_cache`, `BU1`); tests [operators/reduce/reduce.test.ts](operators/reduce/reduce.test.ts) (BU1 incremental, BU2-still-rebuilds, array key-normalization, BI0→BU1→BR1 cascade), perf [operators/reduce/reduce.perf.ts](operators/reduce/reduce.perf.ts) (overwrite 100/10k ≈ 0.2ms).

### C6 — mixing proxies across two `dist/` entries — now FIXED at the source level ✅
`0dd5ae9` (2026-06-11 re-examination)

Each tsup entry is built self-contained (`splitting: false`), so each bundle USED to define its **own** `$` and `value`/`view` symbols; importing from two entries at once yielded different `$` instances and proxies one entry didn't recognise. Originally resolved at the **docs** level (deferred the deep fix). The re-examination showed it was actually shipped-reachable — every example's `?devtools` flow imports the app from `data/full` then `data/devtools` (a separate bundle), so `$.inspect` never appeared and the panel never mounted; and `jsxImportSource: "data"` always crossed `data/jsx-runtime` ↔ `render`. So the deep fix was applied: the cross-bundle identity is now parked on the **global registry** — `value`/`view`/`NODE` are `Symbol.for('data.*')`, and `$`/`Operators`/`_devtoolsRoots`/`_devtoolsInternalRoots` are `globalThis[Symbol.for('data.*')]` singletons. All entries of one installed version share them, so mixing entries works (verified cross-bundle: `full.$ === devtools.$`, `$.inspect(appProxy)` works, `$.graph()` sees the app's roots, jsx-runtime nodes render via `render`). Trade-off: two DIFFERENT installed versions would now share the symbols too — acceptable. The README/devtools-README/CLAUDE notes are updated to say mixing works.

- Where: [core.ts](core.ts) (`value`/`view`/`Operators`/`$`/`_devtoolsRoots` registry), [render/index.ts](render/index.ts) (`NODE`).

### C7 — `distinct` desync when an in-place edit moves a shared bucket's representative ✅
`8fd1574`

When two rows share a projection key and the *representative* (the instance cached in `output`) is mutated in place to a new key, `_update` left the stale reference in `output` and pushed it again — `{a:{k:'x'}, b:{k:'x'}}` then `a.k='y'` produced `[{k:'y'},{k:'y'}]` (bucket `x` lost, `y` duplicated) instead of `[{k:'y'},{k:'x'}]`. Fixed: `_update` detects the representative-leaves-occupied-bucket case (`firstRow.get(oldK) === row`) and falls back to `_rebuild()` from `BU2`; non-representative edits stay on the O(1) incremental path. (Originally mis-filed as a cosmetic identity-reference issue; it was a real output bug.)

- Where: [operators/distinct/index.ts](operators/distinct/index.ts); two regression tests in [operators/distinct/distinct.test.ts](operators/distinct/distinct.test.ts).

### D1 — `connect(fn)` single-arg form unsupported + stale doc line-ref ✅
`68550fb`

`connect` supports `connect(array)`, `connect(obj, 'prop')`, `connect(obj, fn)`; a bare `connect(fn)` has none of the protocol verbs, so it used to bare-attach and throw cryptically (`fn.BI0 is not a function`) on the first event. Three follow-ups closed: (1) the stale CLAUDE.md line-ref (`core.ts:601-622`) now points at the real handler and spells out the no-single-arg rule; (2) a type-level `@deprecated connect(fn): never` overload makes a lone-function call a hard TS error; (3) `connect()` now throws immediately for a bare-function arg with a message naming the supported forms.

- Where: [core.ts](core.ts) (`function connect(p, a, b)`); regression test in [core.test.ts](core.test.ts).

### B1 — `between` narrowing a reactive bound to a point range `[v, v]` dropped the boundary rows ✅

`between`'s bounds are inclusive on both ends — a fresh `between(col, [v, v])` selects rows with `col === v`, and the incremental narrow loops keep `col === new_hi`/`col === new_lo`. But `set extent` special-cased `new_lo === new_hi` with a collapse-to-empty shortcut (`view.XU0(isArray ? [] : {})`), contradicting the constructor: dragging a reactive bound down to a single value (the swarm gx/gy cohort brush, any zero-width brush) silently emptied the view instead of selecting the equal-valued rows. Removed the shortcut; the (already-correct, inclusive) incremental walk now handles a point range. **Change-stream consequence:** narrowing to a point on an *already-empty* view now emits **nothing** (no row crosses) rather than a spurious `XU0({})` reset — `between - reactive bounds` ([operators/between/between.test.ts](operators/between/between.test.ts)) and its duplicate `between - variable` ([index.test.ts](index.test.ts)) were updated to drop the phantom trailing `update {}`.

- Where: [operators/between/index.ts](operators/between/index.ts) (`set extent`); regression test `between - narrowing a reactive bound to a point range keeps the boundary rows` in [operators/between/between.test.ts](operators/between/between.test.ts). Surfaced while auditing the `BH1`/`BF0` protocol (it reproduces on object *and* array sources, so it is not a hole/splice issue).

### C8 — `between`'s `set extent` emitted a spurious remove for an already-excluded row ✅
`c3130ba`

`between`'s `set extent` narrow/widen loops walk `sorted` bounded **only by the moving bound** (`col > new_hi` for narrow-high, `col < new_lo` for narrow-low). When a brush sweeps one bound **past the opposite boundary** (e.g. narrow the high bound below `lo_val`), the loop steps onto rows that were already out of view — their `view.value` slot is already a hole — and re-emitted a `BR1`/`BH1` (remove) for each. `between`'s own `view.value` stayed correct (recomputed structurally), but a downstream **counting/aggregating** sink (`length`/`sum`/`avg`) decremented on the phantom remove and drifted to **0 or negative** (a reproducer brushing `[20,70]→[90,100]` yielded `length === -2`). This was **pre-existing and independent of [P1](ISSUES.md#p1)** — P1's coarse-`XU0` self-heal on the insert/remove path had been masking it, which is why reverting the P1 deferral re-exposed it. Shipped-reachable via the [swarm example](examples/swarm/README.md) (`intersect → length` over an in-place-mutating, brushed population).

**Fix:** each loop now emits **only when the slot's membership actually transitions** — guard `R1.push` with `view.value[ti] !== undefined` (and the widen `I0.push` with `=== undefined`) — so the emitted `BR1`/`BH1`/`BI0`/`BF0` stream is a faithful delta of `view.value`. The index walk itself is unchanged (it was already correct for between's own value). The differential-harness gap that let it slip through is closed: `between→length`/`sum`/`avg` scenarios added to [differential.test.ts](differential.test.ts), plus a deterministic regression `between → length/sum stays correct when a brush sweeps a bound past the opposite bound (C8)` in [operators/between/between.test.ts](operators/between/between.test.ts). Verified with a 3000-sequence stress (no desync). Clears the blocker on re-landing the P1 deferral.

- Where: [operators/between/index.ts](operators/between/index.ts) (`set extent` four bound-walk loops).

### P1 — `between` insert/remove deferred its sorted-index maintenance (object O(1)) ✅
`1d3bc15` (deferral), `105cfc7` (revert), `d294eee` (re-land)

`between`'s `BI0`/`BR1` maintained the `sorted` index incrementally on every source insert/remove — O(N) per row (object: `sorted.indexOf` + `splice`; array: a key-shift loop plus an O(N²) batch-remove recompute). But `sorted` is read **only** by `set extent` (which already calls `_resort()` when `sortedDirty`), so the per-row bookkeeping was redundant: `BI0`/`BR1` only need the membership decision (`_inRange`, which reads `lo_val`/`hi_val`) and the `view.value` write, then `sortedDirty = true` — the same dirty-flag amortization `_replaceRow` (`BU2`/`BU1`) already used. Deferring makes **object** insert/remove O(1) per row, unblocking the object-keyed births/deaths workload. (**Array** insert/remove stays O(N): the `view.value.splice` that mirrors the source's positional shift is inherent to the array representation, not redundant bookkeeping — object keys are the right choice for high-churn births/deaths, as the [swarm example](examples/swarm/README.md) notes.)

This first landed in `1d3bc15`, then was **reverted** (`105cfc7`) because dropping the deferral's now-vestigial `sortedDirty → coarse XU0` bailout had ALSO been load-bearing as a self-heal masking the **C8** spurious-`BR1` bug — without it, `between→length`/`sum`/`avg` desynced (counts went negative) and `between→filter` over arrays grew a ghost row. Re-landed here once **C8 was fixed at its root** (the heal is no longer needed) and the differential-harness gap was closed. Proven correctness-neutral vs the C8-fixed HEAD by a 9,600-sequence insert/remove-heavy stress over every between-rooted chain (between, →filter/map/az, →length/sum/avg, filter→between): identical desync count with and without the deferral, so it adds no new desync.

- Perf (10k object source): **remove churn 1000 rows 105.87ms → 0.91ms (~116×)**, insert churn 7.54ms → 2.48ms (~3×); the `narrow/widen` brush path is unchanged (does no inserts → never dirties `sorted`). Without the deferral the remove-churn perf case exceeds its 50ms threshold (fails); with it, 0.91ms. Two perf cases re-added to [operators/between/between.perf.ts](operators/between/between.perf.ts).
- Where: [operators/between/index.ts](operators/between/index.ts) (`BI0`/`BR1`), [operators/between/BENCHMARK.md](operators/between/BENCHMARK.md).

### C9 — a sort directly downstream of `between` mis-ordered rows on a sideways brush ✅
`4bc4278`

A sort (`az`/`za`, bounded or unbounded) chained **directly** off `between` mis-ordered rows on a *sideways* brush — one whose `set extent` both removes some rows and admits others in the same call. `set extent` writes `view.value` for BOTH the holes and the fills before emitting, and emitted the **fills (`BF0`/`BI0`) before the holes (`BH1`/`BR1`)**. A sort ranks a fill by bisecting `this.p.value[this.sorted[mid]]` (`bisect_left`/`bisect_right` in [utils.ts](utils.ts)) — it dereferences the between view at every position still in its `sorted`. With fills emitted first, the not-yet-removed positions are already **holes** in `view.value`, so the bisect read `col(undefined)` (which compares false in both directions) and ranked the newcomer at the wrong end — e.g. `between([33,66])→az`, brush `[22,55]` then `[50,70]`, gave `[66,55]` where `[55,66]` is correct.

**Fix:** emit **removes before fills** in `set extent` (swap the two trailing `if` blocks). The sort then drops the holed positions from its `sorted` before it bisects any fill, so every position it dereferences is a live row. Removes-before-inserts is the safe order for any positional consumer anyway; a counting/aggregating sink is order-agnostic, so nothing else is affected.

Pre-existing and **independent of C8/P1** — it reproduces identically on pre-C8 `15e1605` (and the brush path was unchanged by either). **Not shipped-reachable**: `intersect`/`union`/`except` recompute their own membership and re-emit clean `BF0`/`BH1`, so they *launder* the ordering — verified `intersect(between)→za`, `except(intersect(between))→za` (the shipped library chain), and `union(between,filter)→za` all clean (0/300 each), the full library Playwright spec passes 5/5, and no example chains a sort directly off `between`. Surfaced by the P1 re-land stress.

- Verified: `between→az/za` (array+object, bounded+unbounded) clean across an 800-seed brush+churn stress; differential gains a `between→za` scenario alongside the existing `between→az`; deterministic regression `between → az keeps order through a sideways brush` in [operators/between/between.test.ts](operators/between/between.test.ts).
- Where: [operators/between/index.ts](operators/between/index.ts) (`set extent` emission order).
- NB: the same stress surfaced a **separate** pre-existing `limit`-after-a-sort desync, now fixed in C10 below. (`top` over an object source was a **non-bug** — the probe misused `top`, which takes only `n`; `top` is correct on scalar array and object sources.)

### C10 — `limit` after a re-ordering sort dropped the sort's positional verbs ✅
`a2ad08f`

`az('v').limit(k)` / `za('v').limit(k)` desynced when the upstream sort re-ordered: a removal, a window rotation, or a rank shuffle reaches `limit` as the **array-positional verbs `BR1A` / `BI0A` / `BMV1`**, each carrying a SHIFT (every rank after the touched one slides). `LimitValue` tracks `keys` as **stable source positions** and refills by forward-scanning (`nextAfter`/`nextObjectKey`), so it can't follow a re-ranking parent — and it didn't implement those verbs at all, so they were silently dropped, leaving stale/duplicated rows (e.g. a row jumping `v:70→1` left `[5,1,5]` where `[1,5,10]` was correct). Surfaced by the C9 investigation's stress (the bug is independent of C9 — it reproduces on a plain `az(...).limit(...)` with no `between`).

**Fix:** implement `BR1A`/`BI0A`/`BMV1` on `LimitValue` as a window **recompute** from the parent's (already-updated) value. These verbs are emitted **only by sorts** — sparse producers (`between`/`intersect`/`union`/`except`) signal membership with `BR1`/`BF0`/`BH1`, never these — so the fix is surgical to the `sort→limit` chain and leaves the incremental brush path (the one crossfilter relies on) untouched. O(n) per event, n = the small limit size.

- Verified: `az→limit`/`za→limit` (array+object, insert/remove/update, order-sensitive) clean across a 300-seed×4 churn stress and added as differential scenarios; deterministic regression `limit after a sort tracks rank moves and removals (az → limit)` in [operators/sort/sort.test.ts](operators/sort/sort.test.ts). **No regression**: the crossfilter chain (`za→intersect→limit`, brush) is 0/60 in a Node repro and the crossfilter Playwright spec passes; `intersect`→`limit` over an array under a brush (the shipped shape) was and stays correct.
- Where: [operators/sort/index.ts](operators/sort/index.ts) (`LimitValue.BR1A`/`BI0A`/`BMV1`).
- Follow-up: the sparse-producer→`limit` remainder was investigated in C11 below — one genuine `limit` bug (brush-array double-add) fixed; the rest turned out to be an `intersect` bug + inherent object order-looseness.

### C11 — `limit` directly on a sparse producer double-added a row on a sideways brush ✅
`99d8d40`

`between(…).limit(k)` / `intersect(…).limit(k)` over an **array**, brushed *sideways* (a brush whose cascade both removes some rows and admits others), **duplicated** a row — e.g. `between([10,50])→limit(3)` brushed to `[34,85]` gave `[44,55,55]` where `[44,55,66]` is correct. A sparse producer updates its `view.value` for ALL holes+fills, then emits removes (`BH1→BR1`) before fills (`BF0→BI0`). `limit`'s `BR1` batch refills from the parent's already-updated value (`nextAfter`), pulling in a slot the `BF0` batch then re-reports; `limit`'s array `BI0` (the `BF0` fallback — over an array `View.BI0` routes to `BI0A`, so plain `BI0` is reached **only** as the hole-fill fallback) didn't **dedup**, so it re-inserted that slot (a duplicate + an evicted survivor).

**Fix:** dedup `limit`'s array `BI0` against the current window (`if findPos(pos) !== -1 continue`) — a hole-fill of an already-windowed position is a no-op. One bisect per event; the object branch already dedups. **No regression**: `intersect→limit` brush-over-array (crossfilter's shape) stays correct (0/300 stress; crossfilter Playwright spec passes); `az/za/raw limit` unaffected.

- Verified: `between→limit` array (insert/remove/update/brush/mix) clean across a 300-seed×… stress; deterministic regression `limit on a sparse producer survives a sideways brush without duplicating` in [operators/sort/sort.test.ts](operators/sort/sort.test.ts).
- Where: [operators/sort/index.ts](operators/sort/index.ts) (`LimitValue.BI0` array branch).
- **Two non-`limit` findings from the same investigation:** (1) `limit` over an **object** source is **iteration-order-loose** (the parent's object key order is mutation-history-dependent — a brush deletes+re-adds keys, moving them to the end — so "first n in iteration order" drifts vs a fresh rebuild; *not a bug*, the same history-dependence `distinct` has, now noted in [CLAUDE.md](CLAUDE.md)). (2) the set-algebra producers desync over an **array** source under churn — investigated in C12 below.

### C12 (object half) — `except`'s `BU2` ignored exclusion membership ✅
`848131d`

Investigating the C11 `intersect→limit` "remove array" failure led to giving the differential harness its first **set-algebra head-operator coverage** (`intersect`/`union`/`except`, array+object — it had none, which is why the whole family's gaps were invisible). That surfaced one clean **object-shape** bug: `except(p, other)` over an object **re-materialised a row that an in-place edit had pushed INTO the exclusion**. The facet (a filter) correctly emits an insert when its predicate flips, and `except`'s `BI0`-from-other drops the row — but the *same* source edit also fans a `BU2` to `except`'s primary, and `except` had **no `BU2`**, so the base default re-added the row, undoing the drop (`k1.v 11→200` left `k1` stuck in the output at 200).

**Fix:** `except.BU2` now mirrors its (already-correct) `BU1` — from `other` it's a no-op (the row stays excluded regardless of value); from primary it forwards the nested update **only for rows still in the output** (skips excluded ones), so it can't re-add a dropped row. Regression: `except - in-place edit into the exclusion drops the row (BU2)` in [operators/except/except.test.ts](operators/except/except.test.ts). Fixed all OBJECT-shape set-algebra differential scenarios.

- Where: [operators/except/index.ts](operators/except/index.ts) (`ExceptValue.BU2`).
- **Array half** then tracked as [ISSUES.md → C12](ISSUES.md); the `intersect` slice of it is now fixed (next entry); `union`/`except` array remain.

### C12 (array half — intersect) — array-positional `BI0A`/`BR1A` for the bitmask producer ✅

`intersect` over an **ARRAY** source desynced under insert/remove churn. Two root causes, both array-only (the OBJECT path was correct):

1. **Index drift on remove.** An array remove SHIFTS every later index, but `intersect` handled removes with the OBJECT `_leave` path (`delete`/hole, no splice), so its per-index `filters` bitmask and sparse `view.value` never shifted — the index space drifted from the (shifting) source and every later positional event (`BU1`/`BU2`/`BF0`) hit the wrong slot (a ghost row accumulated). 2. **Hole-bit on insert (`intersect2`).** A tail insert excluded by a secondary facet was still admitted: the secondary's positional `BI0A` carries `undefined` for the excluded slot (a hole the array `RowOperator` emits — the `BI0A` protocol *always* carries the positional insert), and the object `_enter` path set the membership bit unconditionally.

**Fix** — array-only `BI0A`/`BR1A` handlers (core's fanout routes an array source's structural events to `*A`, leaving the object `BI0`/`BR1` `_enter`/`_leave` path untouched):
- **`BR1A` (remove):** only the **primary** echo (`v === this.p`, the canonical index identity) splices `filters`+`view.value`; a removal reported by a **secondary** routes to the by-name `_leave` (clear the bit, hole the slot — no shift, the primary's index space didn't move). This is what keeps two INDEPENDENT arrays' intersect correct (only one shifts) while a DERIVED crossfilter-style removal (every facet echoes; primary splices last) reconciles to one clean delete. The primary splice skips emitting for an already-holed slot, so the secondary's real remove isn't doubled.
- **`BI0A` (tail insert):** each source self-reports ITS bit from the carried value — a real row sets it, a hole (`undefined`) **clears** it — accumulating order-independently (we never read other sources mid-cascade, where they may not have shifted yet); the new tail slot grows `filters`/`view.value` naturally and fills + emits when it reaches `all`.

**Why not cross-source length-sync (first attempt, reverted):** a filter facet that excludes the *last* array element has a shorter `.length` (trailing holes don't count), so "splice once when our length differs from the reporting source's" mis-fired (double-splice). Keying the splice to the **primary identity** instead is both order-independent and length-robust. NB the primary echoes LAST for intersect/except but FIRST for union (its `p` is itself a facet) — the handler must not assume an order.

Regression: `intersect - array, derived facets: tail insert + shifting remove stay aligned` in [operators/intersect/intersect.test.ts](operators/intersect/intersect.test.ts); the three `intersect*/array` differential scenarios deleted from `KNOWN_FAILURES`. Gated on `npm test` (414), `npm run perf` (intersect unchanged), and the crossfilter/library/swarm Playwright specs (the shipped object/static paths stay correct — intersect there sees only bound moves, never array structural events).

- Where: [operators/intersect/index.ts](operators/intersect/index.ts) (`IntersectValue.BI0A`/`BR1A`).
- **`union`/`except` array STILL OPEN** — same array-positional rework, with each operator's own primary-echo ordering; two `[array]` scenarios remain parked in `KNOWN_FAILURES`.

### C12 (array half — union) — array-positional `BI0A`/`BR1A` + carried-value pick ✅

`union` over an ARRAY source desynced under the same churn, the same way (index drift: removes never spliced its bitmask/`view.value`). Fixed with the array-only `BI0A`/`BR1A` mirror of intersect, adapted to union's semantics ("any bit set" not "all"; value from the first source holding the row):
- **`BR1A` (remove):** splice only on the PRIMARY echo (`v === this.p`), no-op on a secondary. NB union's primary is itself a derived facet, so it echoes FIRST (intersect/except's primary echoes LAST) — keying the splice to the primary identity is order-independent, so it works for both. (Every facet derives from one underlying array, so a structural delete is gone from all of them; the primary splice handles it. Two genuinely INDEPENDENT array sources, where a secondary remove should re-pick rather than drop, aren't supported for arrays — none shipped; the object path keeps the full `_leave` re-pick.)
- **`BI0A` (tail insert):** each source folds its membership bit in from its carried value (a hole `undefined` clears it). The visible value is the carried row of the FIRST (highest-priority) source holding it — taken from the **carried value, NOT `_pick`**. Why: `_pick` re-reads `source.value[at]` positionally, but a filter facet whose trailing rows are excluded has a `.length` shorter than the underlying array, so its OWN internal positions are index-misaligned (a tail insert `splice`d past its length lands at the wrong slot) and a positional read misses the row. `one === 1 << priority`, so `one - 1` masks every higher-priority source — this source supplies the value iff it has the row and no higher-priority one does; a higher source echoing later overwrites to a BU1. The object path keeps `_pick` (stable keys, aligned reads).

This sidesteps a **separate latent `RowOperator` bug** (a filter/map/compare array with trailing exclusions is internally length-misaligned). A root fix — padding the `RowOperator` array output to source length — was prototyped and reverted: it changes the emitted array shape (the `compare - array source with delete propagates shift` test asserts the un-padded form), so it's a broader, separate change, noted in [ISSUES.md → C12](ISSUES.md). The differential's `union [array]` passed before only by luck (its inserts always hit the trailing-aligned facet); the new `union - array, derived facets …` regression test forces the misaligned-facet case.

Regression: `union - array, derived facets: tail insert + shifting remove stay aligned` in [operators/union/union.test.ts](operators/union/union.test.ts); `union [array]` deleted from `KNOWN_FAILURES`. Tests 416/416; union perf unchanged; library Playwright spec (union within a facet) green.

- Where: [operators/union/index.ts](operators/union/index.ts) (`UnionValue.BI0A`/`BR1A`).
- **`except` array** then the last remaining — fixed in the next entry.

### C12 (array half — except) — array-positional `BR1A`/`BI0A`, the last set-algebra producer ✅

`except` over an ARRAY source (p = the raw source `s`, `other` = a filter facet of it) desynced the same way: an array remove shifted later indices, but `except` dropped/holed by name (object `_removeFrom`, no splice), so removing an EXCLUDED row deleted a DRIFTED visible survivor. Fixed with the array-only handlers, the intersect mirror for the set-difference rule ("in p AND NOT in other"; no bitmask):
- **`BR1A` (remove):** splice `view.value` only on the PRIMARY echo (`v === this.p`, the raw `s`, which echoes LAST as for intersect); a removal echoed by `other` is the same underlying delete (the row is gone from `s`) → no-op. (A row LEAVING `other` while staying in `s` is a membership re-admit — it arrives as BH1, already wired in `_removeFrom`, NOT BR1A.)
- **`BI0A` (tail insert):** visibility decided on `other`'s echo — it carries its membership DIRECTLY (so a then-misaligned filter `other`, C13 — since fixed, see above — couldn't make a positional re-read miss the row) and p (`s`, raw) is already settled, so that echo knows both halves of "in p AND not in other". (As of the 2026-06-11 re-examination `except.BI0A` ALSO admits on the primary echo — finding #23 — so a `between`/`intersect` `other` that doesn't echo an out-of-range insert no longer drops an admissible row.)

Regression: `except - array, derived 'other': tail insert + shifting remove stay aligned` in [operators/except/except.test.ts](operators/except/except.test.ts); `except [array]` deleted from `KNOWN_FAILURES`.

**C12 is now fully closed.** All three set-algebra producers are correct over array sources; the differential harness ([differential.test.ts](differential.test.ts)) runs every scenario, array and object. Tests green; intersect/union/except perf unchanged; crossfilter/library/swarm Playwright specs green.

- Where: [operators/except/index.ts](operators/except/index.ts) (`ExceptValue.BR1A`/`BI0A`).

---

### C13 — `RowOperator` over an array with trailing-excluded rows was length-misaligned ✅

A `filter`/`map`/`compare` over an ARRAY built its snapshot by assigning only passing indices, so a TRAILING-excluded row left `view.value.length < source.length` (a JS array's length is last-assigned-index + 1). That broke the source↔operator index correspondence: a later tail insert spliced at the source index — past the operator's short array — and a downstream positional op re-read a hole (crash on `filter→map`) or mis-sorted (`filter→az` gave `[80,60,70]` for `[60,70,80]`). Originally rated "not shipped-reachable," but the 2026-06-11 re-examination showed any two-operator chain plus one insert hits it.

Fixed in [row.ts](row.ts) `RowOperator.XU0`: `if (arr) n.length = value.length` pads the output to source length (trailing slots stay holes), restoring index correspondence. XU0 also skips explicit-undefined holes so a filter/map *constructed* over an already-brushed sparse producer doesn't hand `undefined` to the user fn. `compare`'s array-shift test was updated (it had asserted the old short-array length as if correct). Closed the `lt→map`/`lt→az` and 12 other differential scenarios.

- Where: [row.ts](row.ts) `RowOperator.XU0`. Commit `c0425a6`.

---

### C15 — `between` / set-algebra over an ARRAY desynced under combined churn (the 9 `KNOWN_FAILURES`) ✅
`7c0b660`, `3432880`, `f4c0814`, `0f67fc3` (2026-06-13)

The deepest array-positional corner: `between→{az,filter,map,za}` and `intersect`/`intersect2`/`intersect-between`/`union`/`except` over ARRAY sources desynced (ghost / dropped / mis-ordered row) under the COMBINED churn of mid-array inserts, `patch()` batches, in-place slot-clears, and a brush — the 9 differential `KNOWN_FAILURES`. One unifying root cause: `between` and the set-algebra producers were never made conformant to the array-positional INSERT half of the contract (C13 had landed only on `RowOperator`). The fixes:

- **`between.XU0`** pads its sparse array to source length (the C13 root, never applied to `between`); **`between.BI0`** always forwards the positional insert — a hole for an out-of-range row — symmetric with `BR1`. Exposed and fixed a latent **`group.BI0A`** gap (`fn(undefined)` on a carried-undefined hole). [`7c0b660`]
- **`intersect`/`union`/`except.BI0A`** splice a fresh cell on a MID-array insert (gated on `pendingShift = p.value.length > filters.length`, so tail inserts and the C12 paths are byte-identical); `except` arrays padded to source length. [`3432880`]
- **`ZAValue.BI0`** (the array sort) guards a carried-undefined hole — shift positions, don't rank the hole — so a sparse producer feeding a sort no longer mis-orders on the next brush. [`f4c0814`]
- **`intersect`/`except.BI0A`** forward the mid-insert hole (not just admitted rows) so a downstream sort shifts in lockstep; **`intersect._enter`** dedups the object double-insert. [`0f67fc3`]

`KNOWN_FAILURES` is now empty; verified by the differential harness (every scenario × {array,object} × widened mutations × 4 seeds) PLUS heavy fresh-seed stress (18,600 runs, 0 failures) on the C15 family + the new set-algebra→sort/aggregate compositions. The adversarial probe that drove those commits surfaced two further residuals; one — **`union→sort` under a facet-moving `patch-batch`** — was then **also fixed** (`c1df82d`'s follow-up: `UnionValue._enter` emits its re-rank `BU1`s BEFORE its insert `BF0`/`BI0`, so a downstream sort's order stays monotonic for the insert bisect; 36,000 `union→za` stress runs clean, `union→za` is now a harness scenario). The one remaining is [ISSUES.md C16](ISSUES.md): `intersect` with a SPARSE producer as its PRIMARY drops a survivor on an array remove — a deliberate C14-family trade (the shipped crossfilter intersects a RAW primary with between/filter SECONDARIES, which is correct; no-opping the secondary echo would break the C14 independent-array remove). Workaround: raw-primary intersect or object keys.

- Where: [operators/between/index.ts](operators/between/index.ts), [operators/group/index.ts](operators/group/index.ts), [operators/intersect/index.ts](operators/intersect/index.ts), [operators/union/index.ts](operators/union/index.ts), [operators/except/index.ts](operators/except/index.ts), [operators/sort/index.ts](operators/sort/index.ts).

---

## Won't fix / skipped

### P2 — `max`/`min` aggregates recompute O(n) per publish
Evaluated and **skipped** (not a real win). Unlike `sum`/`avg` (O(1) per delta via running totals), `max`/`min` scan all tracked values on every publish, but the peer benchmarks show `data` already fastest on the aggregate workloads and the constant-factor mitigation is already in place — a parallel `Float64Array` indexed by a key→slot map, ~5–6× faster on V8 for 50k+ rows. A sorted multiset / heap would restore O(log n) but is reserved for a real bottleneck; none observed.

- Where: [operators/aggregate/index.ts](operators/aggregate/index.ts) (`MaxValue`/`MinValue` `_publish`), [operators/aggregate/BENCHMARK.md](operators/aggregate/BENCHMARK.md).

### P6 — `keys`/`values`/`reverse` rebuild on remove/update
Evaluated and **skipped** (not a real win). These are incremental on `BI0` (append) but rebuild from scratch on removes/updates. A parallel `name→index` map would make those incremental, but the ops do an O(n) output build anyway, so the map can't beat the array splice — no improvement on the (insert-only) benchmark.

- Where: [operators/keys/index.ts](operators/keys/index.ts), [operators/reverse/index.ts](operators/reverse/index.ts).

### P4 — `to()` runs its `fn` on every `BU2`
Accepted limitation, **won't fix** without an API change. `to(fn)`'s `fn` is opaque — the operator can't know which fields it reads, so it must call `fn` on every upstream event; a `===` check on the *output* ([operators/to/index.ts](operators/to/index.ts) `XU0`) then skips the *downstream* notification when the projection is reference-equal, but the `fn` call itself can't be skipped. Both escape hatches cost more than they save: input-snapshot caching can't know what `fn` reads, and a nested `BU2` keeps the parent object reference equal while its contents change — so input-identity caching would *skip real changes* (unsafe); field-granular dependency tracking (mobx/vue style) is a different reactivity model the library deliberately doesn't have. Negligible when `fn` is O(1); shows up only as a small single-tick gap vs dependency-tracking peers, which `operators/to/BENCHMARK.md` already documents. The output `===` short-circuit is the best achievable without a dependency hint.

- Where: [operators/to/index.ts](operators/to/index.ts) (`BU2`/`XU0`), [operators/to/BENCHMARK.md](operators/to/BENCHMARK.md).

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
- **Render leaving stale DOM rows / `group`-over-array front-removal** — `ddf3a44`: snapshot keys before `remove_node` so the `for-in` loop can't cut short; test `tests/crossfilter.spec.ts` (re-verified green; renders 80 flights with `empties === 0` / `domRows === groupedTotal`). The stale "known pre-existing gap" note this once carried in CLAUDE.md has been removed (was [ISSUES.md → D2](ISSUES.md), now closed).
- **Bounded `za` window O(Δ) churn on multi-row brush** — `fc4315a`: `_batchRemove`/`_batchInsert` reconcile the window once; perf test ~30ms vs a 200ms ceiling.
- **`keys`/`values`/`reverse`/`distinct` after a window (positional `BI0`)** — `62b19c4`: rebuild on array-upstream `BI0`. (`map`/`filter` were *excluded* — that became C2, since fixed.)
