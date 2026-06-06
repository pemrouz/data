# Open Issues

A living register of known-open issues in this repo: correctness limitations, performance debt, and tooling/docs gaps. Generated 2026-06-06 from a full-repo sweep (in-code markers, the CLAUDE.md "Common gotchas" section, `.claude/architecture.md`, `README.md`, every operator's `BENCHMARK.md`, the example READMEs, the `experiments/` notes, the test suite, and `.github/`). **16 issues are confirmed open and listed below** (C1–C7, P1–P6, T1–T2, D1); several other sweep candidates were set aside as already-fixed — the notable ones are summarised under [Recently resolved](#recently-resolved-verified-fixed-do-not-re-investigate) so they aren't re-investigated.

> **Verified against source on 2026-06-06.** Every issue's core claim was re-checked against current code. The behaviours are all real; **line numbers are approximate** (as-of-generation) and drift with edits — treat the file/function reference as authoritative, not the exact line. D1's stale-line-ref sub-item was fixed this same day (see D1).

Most of these are *documented* limitations the library already works around in shipped code — they are real, but the examples avoid them by construction (object-keyed sources, defensive bindings, densifying). The handful that are genuinely latent traps for a consumer are flagged **High**.

## Progress (2026-06-06, branch `fix/open-issues`)

**Fixed & committed:** C7 (`distinct` representative rebucket), D1 (`connect(fn)` fail-fast), C5 (opt-in `$.debug` reduce-symmetry check), **C2** (`RowOperator.BI0A` — windowed-sort inserts no longer drop a row), and the `group`-over-sparse-object crash (delisting `between→group [object]`).

**Proof gate:** a differential operator-permutation harness ([differential.test.ts](differential.test.ts)) asserts the live incremental view ≡ a from-scratch rebuild across every operator × source-shape × mutation, wired into `npm test`. A `KNOWN_FAILURES` registry xfails the **9 remaining** array-positional permutations (so CI is green and a fix that lands flips the gate). Design analysis in [.claude/array-contract-design.md](.claude/array-contract-design.md).

**Why C1/C3 remain open (proven, not punted):** the 9 are all **array-source** positional desyncs (a "row left position *k*" is a hole on one side, a splice-shift on the other). A contained fix that infers hole-vs-splice from the upstream array's `.length` **cannot work** — a sparse array's length collapses trailing holes (`between('v',[10,100])` over a length-3 source returns length 2) and is inconsistent between the build path and the incremental path. A correct fix needs an **explicit** hole-vs-splice protocol signal threaded through core + RowOperator + DOMSink (the L-effort/high-risk stride-change in the design doc). No shipped example hits these — object-keyed sources are the documented mitigation. **P2/P6 skipped** (not real wins — see below); **C6 → docs-only**.

## Summary

| # | Issue | Theme | Severity | Status |
|---|---|---|---|---|
| [C1](#c1) | Chaining a row op (`filter`/`map`) after a sparse producer over an **array** source desyncs (ghost rows / crashes) | Correctness · array-positional | **High** | ⏳ Open — needs protocol signal (array sources only; see harness) |
| [C2](#c2) | `map`/`filter` after a **windowed** sort (`az`/`za`/`top`/`limit`) can drop a row | Correctness · array-positional | **High** | ✅ Fixed (`2f171b5`, `RowOperator.BI0A`) |
| [C3](#c3) | Chained **windowed** sort (`za(col,n).az(col,n)`) surfaces stale **content** | Correctness · windowed-sort | Medium | ⏳ Open (xfail'd in harness) |
| [C4](#c4) | Sparse producers (`between`/`intersect`/`union`/`except`) emit explicit `undefined` slots → phantom DOM rows | Correctness · render | Medium | Open (mitigated by convention; tied to C1) |
| [C5](#c5) | 3-arg `reduce` silently desyncs if `remove` doesn't exactly invert `add` (no runtime guard) | Correctness · reduce | **High** | ✅ Fixed (`9187782`, opt-in `$.debug`) |
| [C6](#c6) | Mixing proxies across two `dist/` entries (`data/full` + `data/devtools`) silently breaks — not fail-fast | Correctness · tooling | Medium | Open |
| [C7](#c7) | `distinct` mishandles an in-place edit that moves a shared bucket's representative (output desync, not cosmetic) | Correctness · distinct | Medium | ✅ Fixed (`8fd1574`) |
| [P1](#p1) | `between` array-insert path is O(N) (defers swarm births/deaths) | Perf | Medium | Deferred |
| [P2](#p2) | `max`/`min` aggregates recompute O(n) per publish | Perf | Medium | Open |
| [P3](#p3) | 3-arg `reduce` falls back to O(N) rebuild on `BU1`/`BU2` (no old value in protocol) | Perf | Medium | Open |
| [P4](#p4) | `to()` runs its `fn` on every `BU2` even when the result is reference-equal | Perf | Low | Open |
| [P5](#p5) | `distinct` rebuilds on `BR1`/`BU1`/`XU0` (incremental only on `BI0`/`BU2`) | Perf | Low | Open (by design) |
| [P6](#p6) | `keys`/`values`/`reverse` rebuild on remove/update (no `name→index` map) | Perf | Low | Deferred |
| [T1](#t1) | `dist/` is committed as a GitHub Pages fallback because Actions billing is locked | Tooling | Medium | Open (external blocker) |
| [T2](#t2) | WASM kernel experiment concluded "not worth pursuing" | Tooling · informational | Low | Deferred (closed-out) |
| [D1](#d1) | `connect(fn)` single-arg form is unsupported (threw cryptically on first event) + stale doc line-ref | Docs | Low | ✅ Fixed (`68550fb`) |

Legend — **Status**: *Unfixed (protocol-level)* = needs a cross-cutting View+RowOperator+DOMSink change; *Open (by design)* = a deliberate trade-off that could still bite a user; *Deferred* = a known optimization awaiting a workload that needs it; *Open (mitigated by convention)* = every shipped example already avoids it.

---

## Correctness limitations

### C1
**Chaining a row op (`filter`/`map`) after a sparse producer over an array source desyncs** · **High** · Unfixed (protocol-level)

`between`/`intersect`/`union`/`except` over an **array** source keep the array length stable and mark excluded slots as **positional holes** (explicit `undefined`). The View / `RowOperator` / DOM layers, however, model array removes as **splice-shifts** (length shrinks, survivors slide down). No protocol signal distinguishes the two contracts, so when you chain a row op after a sparse producer on an array source:

- (a) `between(arr).filter(fn)` / `.map(fn)` can **silently keep ghost rows** after a reactive bound moves — `filter` splices a slot the producer only nulled, and the survivor it drops becomes a phantom.
- (b) `iter()`-based downstream ops (a second `between`, `group`, `distinct`, `sort`) can throw `Cannot read … (reading 'col')` calling their accessor on a hole.

`sort`, `intersect` (construction), and `group` (`XU0`) carry an explicit `value[k] !== undefined` skip guard, so they degrade gracefully rather than throwing; the **incremental array desync itself is not fixed**. The root cause and a correct fix (a protocol-level positional-vs-splice distinction across View+RowOperator+DOMSink) are spelled out in the docs.

- Where: [CLAUDE.md#L152](CLAUDE.md#L152), [row.ts:23-37](row.ts#L23-L37), [operators/between/index.ts:352](operators/between/index.ts#L352) (`BR1` skips emitting on the `undefined` hole), [.claude/architecture.md](.claude/architecture.md)
- Evidence: *"the incremental array desync is not fixed because a correct fix is a protocol-level positional-vs-splice distinction across View+RowOperator+DOMSink."*
- **Mitigation (what every shipped example does):** key the source by id with `$({})`, not `$([])` — object sources use stable keys and `delete`, sidestepping the whole array-shift contract — or densify between stages.

### C2
**`map`/`filter` after a windowed sort can drop a row** · **High** · Unfixed (protocol-level)

Same positional-insert root cause as [C1](#c1). A row entering a windowed sort (`az`/`za`/`top`/`limit`) arrives as a `BI0` carrying a numeric **rank**, and [`RowOperator.loop`](row.ts#L23) reads `view.value[rank]` (the current occupant at that position) as the row's "old" value — misclassifying the insert as an update and dropping the entering row. A reproduction in verification showed `map` over a window returning `[1, 20]` where `[1, 10, 20]` was expected after a new element entered at position 0.

`keys`/`values`/`reverse`/`distinct` after a window were fixed (they `_rebuild()` on an array-upstream `BI0`); `map`/`filter` were explicitly left out because they share the array contract above.

- Where: [row.ts:23-37](row.ts#L23-L37), [operators/map/index.ts](operators/map/index.ts), [operators/filter/index.ts](operators/filter/index.ts), [CLAUDE.md#L153](CLAUDE.md#L153)
- **Mitigation:** read the window directly, or interpose an object-keyed view between the window and the `map`/`filter`.

### C3
**Chained windowed sort (`za(col,n).az(col,n)`) surfaces stale content** · Medium · Partial

When two windowed sorts are chained, the inner window rotates *which* upstream key sits at each position without re-keying the outer, so the outer's `sorted` (keyed by inner positions) goes stale and can display wrong values vs a fresh rebuild. The phantom-DOM-row symptom (a `"-1"` key forwarded as a deep update) **is fixed** by the `oidx >= 0` guard in `ZAValue.BU2`/`BR2`; the residual **content** staleness is unfixed — a real fix needs a chained-sort re-key path that would change the `BMV1` 'move' semantics. Single windowed sorts and `filter(...).sort(...)` are correct.

- Where: [operators/sort/index.ts:298-306](operators/sort/index.ts#L298-L306), [operators/sort/index.ts:310-324](operators/sort/index.ts#L310-L324), [CLAUDE.md#L154](CLAUDE.md#L154); existing test [operators/sort/sort.test.ts:188-200](operators/sort/sort.test.ts#L188-L200) covers only the `-1`-key symptom, **not** content correctness.
- Note: one verifier could not reproduce content staleness in normal operation (the outer `BU1` rotation handling appears to keep state consistent in practice), but the architectural gap and the missing content-correctness test both stand — worth a targeted reproduction before claiming it closed.

### C4
**Sparse producers emit explicit `undefined` slots → phantom DOM rows** · Medium · Open (mitigated by convention)

`between`/`intersect`/`union`/`except` build sparse arrays where excluded indices are set to explicit `undefined` (e.g. `view.value[name] = undefined`) rather than `delete`'d. The render layer iterates with `for (const i in value)` ([render/index.ts:124-126](render/index.ts#L124-L126)), which walks those slots as enumerable — so a row template creates a DOM node for each excluded slot and a binding like `r.pnl.to(fmtPnl)` resolves to `fmtPnl(undefined) → "NaN"`. RowOperator-based ops (`filter`, `gt`/`lt`/`gte`/`lte`, `map`) use `delete`, leaving true holes that `for-in` skips, so they don't hit this on a clean render.

- Where: [render/index.ts:124-126](render/index.ts#L124-L126), [operators/between/index.ts:123](operators/between/index.ts#L123) / [:135](operators/between/index.ts#L135), [operators/intersect/index.ts:159](operators/intersect/index.ts#L159), [CLAUDE.md#L151](CLAUDE.md#L151)
- **Mitigation:** densify first (`vp.to(arr => arr.filter(r => r !== undefined))` — see the `dense()` helper in [assets/demos.js](assets/demos.js)) or write bindings defensively (handle `r.col === undefined`, as [examples/library/main.js](examples/library/main.js) does).
- ⚠️ **No clean standalone fix — entangled with [C1](#c1).** A naive `if (value[i] === undefined) continue;` in the DOMSink loop is **only safe for object (keyed) sinks**. For an **array** sink — which is exactly what `between`/`intersect`/`union`/`except` produce — `create_node` is *positional* (it tail-appends and binds slot *k* to `data[k]`), so skipping a middle `undefined` would misalign every subsequent slot's binding and drop the real tail row. Making the array sink skip holes correctly is the same positional-vs-splice protocol work as C1. Until then the mitigation (densify / defensive bindings) is the answer.

### C5
**3-arg `reduce` silently desyncs if `remove` doesn't invert `add`** · **High** · Open (by design)

The incremental `reduce(add, remove, init)` form requires `remove` to *exactly* cancel `add`'s contribution for a given row (the same contract as crossfilter's `group.reduce`). There is no runtime validation: an asymmetric `remove` desyncs the accumulator silently, and only a round-trip insert+remove unit test will surface it. Tests cover correct (symmetric) usage; none assert what happens under a violation.

- Where: [operators/reduce/index.ts:78-81](operators/reduce/index.ts#L78-L81) (the comment), `ReduceIncrementalValue` `BI0`/`BR1` handlers at [:121](operators/reduce/index.ts#L121)/[:135](operators/reduce/index.ts#L135) invoke user fns with no check.
- Evidence: *"Forgetting symmetry desyncs `acc` silently; a unit test that round-trips insert+remove catches it."*
- Possible direction: an opt-in debug/assert mode that periodically cross-checks the incremental `acc` against a fresh fold and warns on drift; and/or a doc-level "how to write an invertible reduce" note with a round-trip test template.

### C6
**Mixing proxies across two `dist/` entries silently breaks** · Medium · Open

Each tsup entry (`data`, `data/lean`, `data/full`, `data/devtools`, …) is built self-contained (`splitting: false`), so each bundle defines its **own** `$` and `value` symbol. Importing from two entries at once — e.g. `import {…} from 'data/full'` plus `import 'data/devtools'` — yields **different** `$` instances; proxies created under one are unrecognised by the other, and devtools helpers fail with a confusing error rather than a clear one. This is documented (in CLAUDE.md, inside an example explanation) but **not enforced and not surfaced in README/devtools docs**, so it's a latent trap.

- Where: [tsup.config.ts:12-23](tsup.config.ts#L12-L23) / [:52](tsup.config.ts#L52) (`splitting: false`), [core.ts:4-9](core.ts#L4-L9) (per-bundle `value` symbol), [CLAUDE.md#L127](CLAUDE.md#L127)
- Possible direction: park the `value`/`$` symbol on a `Symbol.for('data.value')` global registry so all entries share identity, **or** add a fail-fast guard + a prominent note in `README.md` / `devtools/README.md`.

### C7 — ✅ Fixed (`8fd1574`)
**`distinct` desyncs when an in-place edit moves a shared bucket's representative** · Medium

Originally filed as a cosmetic "stale `firstRow` identity reference, output unaffected." On closer reading it was a real **output** bug: when two rows share a projection key and the *representative* (the instance cached in `output`) is mutated in place to a new key, `_update` left the stale reference in `output` and pushed it again — e.g. `{a:{k:'x'}, b:{k:'x'}}` then `a.k='y'` produced `[{k:'y'},{k:'y'}]` (bucket `x` lost, `y` duplicated) instead of `[{k:'y'},{k:'x'}]`.

- **Fix:** `_update` now detects the representative-leaves-occupied-bucket case (`firstRow.get(oldK) === row`) and falls back to `_rebuild()` from `BU2`; non-representative edits stay on the O(1) incremental path. Two regression tests added (the first fails before the fix).
- Where: [operators/distinct/index.ts](operators/distinct/index.ts), [operators/distinct/distinct.test.ts](operators/distinct/distinct.test.ts)

---

## Performance debt

### P1
**`between` array-insert path is O(N)** · Medium · Deferred

`between`'s sorted-index maintenance splices on insert; the array-source insert path is O(N) per insert ([operators/between/index.ts:305-308](operators/between/index.ts#L305-L308) key-shift loop, [:321](operators/between/index.ts#L321) `sorted.splice`). The `BU2` brushing path was already optimised to defer the splice behind a dirty flag (the crossfilter brushing hot path), so this only bites on insert/remove churn. It's why the [swarm example](examples/swarm/README.md) keeps a **fixed population** — births/deaths (`BI0`/`BR1` per agent) would put every operator on the O(N) path.

- Where: [operators/between/index.ts:301-326](operators/between/index.ts#L301-L326), [examples/swarm/README.md:65-71](examples/swarm/README.md#L65-L71), [CLAUDE.md#L124](CLAUDE.md#L124), [operators/between/BENCHMARK.md:38-41](operators/between/BENCHMARK.md#L38-L41)

### P2
**`max`/`min` aggregates recompute O(n) per publish** · Medium · Open

Unlike `sum`/`avg` (O(1) per delta via running totals), `max`/`min` scan all tracked values on every publish. A constant-factor optimisation is in place — a parallel `Float64Array` indexed by a key→slot map, ~5–6× faster on V8 for 50k+ rows — but the complexity is still O(n). The code flags a sorted multiset / heap as the real fix if it ever bottlenecks.

- Where: [operators/aggregate/index.ts:272-314](operators/aggregate/index.ts#L272-L314) (`MaxValue`/`MinValue` `_publish`), [register.ts:68-69](register.ts#L68-L69), [operators/aggregate/BENCHMARK.md:29-31](operators/aggregate/BENCHMARK.md#L29-L31)
- Evidence: *"O(n) per change (simple-correct, swap in a sorted multiset if it bottlenecks)."*

### P3
**3-arg `reduce` falls back to O(N) rebuild on `BU1`/`BU2`** · Medium · Open

The incremental `reduce(add, remove, init)` form is O(Δ) on `BI0`/`BR1` (insert/remove at fresh keys) but rebuilds fully on `BU1`/`BU2` (in-place edits to existing keys) because the notification protocol doesn't carry the **old** value at those entry points, so `remove(old)` can't be threaded. Update-heavy workloads that touch existing keys lose the incremental path.

- Where: [operators/reduce/index.ts:140-147](operators/reduce/index.ts#L140-L147), [core.ts:176-177](core.ts#L176-L177) (protocol carries new value only), [operators/reduce/BENCHMARK.md:30-31](operators/reduce/BENCHMARK.md#L30-L31); confirmed by the `reduce.incremental - BU1 falls back to rebuild` test.
- Possible direction: thread the prior value through `BU1`/`BU2` (a protocol change that would also help any operator wanting old-value deltas).

### P4
**`to()` runs its `fn` on every `BU2`** · Low · Open

`to`'s `BU2` calls `fn` unconditionally, then a `===` check skips the *downstream* notification when the result is reference-equal — but the `fn` call itself isn't skipped. A safe skip would need to know `fn` only reads shape (not values), a hint the API doesn't expose. Negligible when `fn` is O(1); shows up as a small single-tick gap vs mobx/vue (dependency-tracking libs can skip re-evaluation).

- Where: [operators/to/index.ts:20-30](operators/to/index.ts#L20-L30), [operators/to/BENCHMARK.md:25-34](operators/to/BENCHMARK.md#L25-L34)

### P5
**`distinct` rebuilds on `BR1`/`BU1`/`XU0`** · Low · Open (by design)

`distinct` is incremental on `BI0` (O(1) admits/bumps) and `BU2` (bucket migrations) but rebuilds on `BR1`/`BU1`/`XU0`, because the test suite encodes a "first-seen order tracks current source iteration order" semantic that isn't expressible as O(1) edits on remove. Common workloads (insert-heavy ingestion, attribute rewrites) stay incremental.

- Where: [operators/distinct/index.ts:165-169](operators/distinct/index.ts#L165-L169), [operators/distinct/BENCHMARK.md:32-37](operators/distinct/BENCHMARK.md#L32-L37)

### P6
**`keys`/`values`/`reverse` rebuild on remove/update** · Low · Deferred

These are incremental on `BI0` (append) but rebuild from scratch on removes/updates, because reverse-mapping a name/value to its output index is O(N) without a parallel `name→index` map. The comment notes adding that map is straightforward once a remove-heavy workload appears.

- Where: [operators/keys/index.ts:5-10](operators/keys/index.ts#L5-L10), [operators/keys/BENCHMARK.md:26-29](operators/keys/BENCHMARK.md#L26-L29), [operators/reverse/index.ts:5-8](operators/reverse/index.ts#L5-L8), [operators/reverse/BENCHMARK.md:26-27](operators/reverse/BENCHMARK.md#L26-L27)

---

## Tooling & docs

### T1
**`dist/` committed as a GitHub Pages fallback (Actions billing locked)** · Medium · Open (external blocker)

The Pages site ([index.html](index.html) + `assets/` + `examples/` + operator docs) imports the library from `./dist/*` via an importmap, but `dist/` is normally gitignored — a plain branch-deploy would 404 every `data` import. Because GitHub Actions billing is locked, the proper workflow ([.github/workflows/pages.yml](.github/workflows/pages.yml)) can't run, so `dist/` is **manually rebuilt and committed** each release as a fallback. This is tracked working state, not a bug, but it's tooling debt: built output lives in history, and the two paths (committed fallback vs the workflow) must be kept straight.

- Where: [.github/workflows/pages.yml](.github/workflows/pages.yml), [.gitignore:20-27](.gitignore#L20-L27); the latest `dist/` commit (`94b3381`, today) is the fallback rebuild.
- Resolution: revert to the Actions workflow and re-ignore `dist/` once billing is restored.

### T2
**WASM kernel experiment concluded "not worth pursuing"** · Low · Deferred (closed-out)

Informational / housekeeping, not an action item. [experiments/wasm/](experiments/wasm/) thoroughly evaluated a WASM backend. The headline ~19× aggregate speedup came entirely from two **JS** fixes (tracked `Map` + `MaxValue` `Float64Array`), both **landed**; WASM's incremental win after those was ~1.0–1.25× (noise), and a follow-up fully-columnar-in-WASM bench found only 0.5–1.6× over optimal-JS columnar — not worth the build/ship/memory surface. Listed so the conclusion isn't relitigated.

- Where: [experiments/wasm/README.md:95-104](experiments/wasm/README.md#L95-L104), [experiments/wasm/results-altbackend.md:23-30](experiments/wasm/results-altbackend.md#L23-L30)

### D1 — ✅ Fixed (`68550fb`)
**`connect(fn)` single-arg form is unsupported + stale doc line-ref** · Low

`connect` only supports `connect(array)`, `connect(obj, 'prop')`, or `connect(obj, fn)`. The bare single-arg `connect(fn)` is **not** supported — a bare function has none of the protocol verbs, so it used to bare-attach and then throw cryptically on the first event. All three follow-ups are now closed:

1. **Stale line reference — FIXED (2026-06-06).** [CLAUDE.md#L68](CLAUDE.md#L68) pointed at `core.ts:601-622` (now `BMV1`); it now points at the real handler ([core.ts:1112](core.ts#L1112)) and spells out the no-single-arg rule inline. The handler line shifts with edits — reference `function connect(p, a, b)`, not the number.
2. **Type-level guard — ADDED (2026-06-06).** The public `Data<T>` type carries a `@deprecated connect(fn): never` overload (in [core.ts](core.ts), `Data<T>`), so a lone-function call is a hard type error in TS that points at `connect(anchor, fn)`.
3. **Runtime guard — ADDED (`68550fb`).** `connect()` now throws immediately for a bare-function arg with a message naming the supported forms, instead of deferring an opaque `fn.BI0 is not a function` to the first event. Regression test in [core.test.ts](core.test.ts).

- Where: [core.ts:1112](core.ts#L1112) (handler), [core.test.ts](core.test.ts) (regression), [CLAUDE.md#L68](CLAUDE.md#L68)

---

## Recently resolved (verified fixed — do not re-investigate)

These came up in the sweep but were confirmed **already fixed** in current source. Listed so they aren't re-raised:

- **`between` stale-`sorted` after in-place edit, then insert/remove** — fixed (commit `7d6738e`): `BI0`/`BR1` fall back to `XU0` rebuild when `sortedDirty`; regression test [operators/between/between.test.ts:137-157](operators/between/between.test.ts#L137-L157).
- **`group` over sparse array sources throwing** — fixed (commit `972b5d1`): `XU0` skip-guard + graceful degrade; test [operators/group/group.test.ts:255-263](operators/group/group.test.ts#L255-L263).
- **`sort` phantom `-1` position key (chained windowed sort)** — fixed: `oidx >= 0 && oidx < this.n` guard in `BR2`/`BU2`; test [operators/sort/sort.test.ts:188-200](operators/sort/sort.test.ts#L188-L200). (The *content* staleness behind it is still [C3](#c3).)
- **`tap` desync when upstream mutates in place** — fixed (commit `282e791`): forwards the handed delta instead of re-deriving off the aliased value; tests [operators/tap/tap.test.ts:101-128](operators/tap/tap.test.ts#L101-L128).
- **`aggregate` desync downstream of `sort`/`limit` (numeric-key path)** — fixed: `'' + key` coercion at all entry points; test [operators/aggregate/aggregate.test.ts:31-47](operators/aggregate/aggregate.test.ts#L31-L47).
- **`distinct` non-incremental** — fixed (commit `0a4446b`): incremental `BI0`/`BU2`; the remaining rebuild paths are [P5](#p5).
- **Render leaving stale DOM rows / `group`-over-array front-removal** — fixed (commit `ddf3a44`): snapshot keys before `remove_node` so the `for-in` loop can't cut short; test `tests/crossfilter.spec.ts`. (CLAUDE.md still describes this as a "known pre-existing gap" — that note is **stale** and should be updated.)
- **Bounded `za` window O(Δ) churn on multi-row brush** — fixed (commit `fc4315a`): `_batchRemove`/`_batchInsert` reconcile the window once; perf test passes ~30ms vs a 200ms ceiling.
- **`keys`/`values`/`reverse`/`distinct` after a window (positional `BI0`)** — fixed (commit `62b19c4`): rebuild on array-upstream `BI0`. (`map`/`filter` were *excluded* — that's [C2](#c2).)

> Doc-hygiene follow-ups surfaced above: (1) the stale `connect` line-ref in [CLAUDE.md#L68](CLAUDE.md#L68) ([D1](#d1)) — **fixed 2026-06-06**; (2) the stale "known pre-existing gap" note for `group`-over-array stale DOM rows in CLAUDE.md (fixed at the render layer in `ddf3a44`) — **still to update in CLAUDE.md**.

---

### Notes on scope

- This register lists what's *open*; the per-operator `BENCHMARK.md` "How" sections and the CLAUDE.md "Common gotchas" remain the authoritative long-form explanations, and several entries here intentionally point back at them.
- The array-positional items have a **full design analysis** in [.claude/array-contract-design.md](.claude/array-contract-design.md) (2026-06-06, design-only). Key findings: (1) they are **not** one root cause — **C2** is independently fixable (a missing `RowOperator.BI0A`), while **C1**/**C4** are the genuinely protocol-coupled pair and **C3** is a separate sort-window re-key; (2) the explicit-`undefined` holes are **load-bearing** for `intersect`'s by-index cross-source alignment, so "densify the producers" is **rejected**; (3) recommended path is the small `RowOperator.BI0A` fix for C2 + a `$.debug` loud-warning for C1/C4 (keeping object-keyed sources as the supported shape), with the full positional-vs-splice protocol stride-change reserved for a real consumer need (L-effort/high-risk). C2 reproduces deterministically; see the doc.
- Severity reflects likelihood-of-biting-a-consumer, not just theoretical impact: the array-positional and `reduce`-symmetry items are **High** because they fail *silently*; the perf items are mostly **Low/Medium** because they only matter at scale or on cold paths and already have constant-factor mitigations.
