# v3 rewrite — status

*Updated 2026-07-06 ("continue building v3" session: the DSL, the set-ops rewrite, todo-v3).
Plan: [plans/v3/PLAN.md](../plans/v3/PLAN.md); architecture detail:
[plans/v3/concepts/keyed-delta.md](../plans/v3/concepts/keyed-delta.md).*

## Where things stand

| Milestone | State | Commit | Gate |
|---|---|---|---|
| Plan + audit docs | done | `b963b66` | — |
| **M0** contract + conformance kit | done | `122895c` | kit red/green on toy ops — PASS |
| **M1** kernel + filter/map/compare + sum/avg/length + v2-record sink | done | `219897d` | legality+replay everywhere; single-tick 0.91–1.04× v2 (≤1.15) — PASS |
| **M2** hard ports (ordered/between/setops/bucket/misc) + differential fuzz | done | `ac3b16b` | C-series scenario family exact-equal; brush 0.98–1.04×, batch 0.74–0.86× v2 — PASS |
| **M3** public API (non-callable handle, RESERVED dispatch, methods-only writes) | done | `faac6f8` | 117 tests incl. collision/thenable/dedup semantics |
| **M4** keyed render + reactive args + seam | done | `037c174` | 169 tests; keyed DOM identity, mirror/raf/ingest live |
| **M4.5a** typed surface + devtools consumption | done | `ae0c2d8` | tsc gate clean (89 pos + 47 neg fixtures); 184 tests |
| **M4.5b slice** reactive between bounds; render SVG/bind()/text-fn/row-rebuild; browser bundle | done | `50e8cd7`…`e2818d7` | 191 tests; bundle smoke; two live integration bugs fixed |
| **M5 (first migration)** examples/crossfilter-v3 + spec + example bench + the ordered-quadratic fix it surfaced | done | `693cd0e` `f3ddb0d` | spec green; bench checksums v2 ≡ v3 |
| **perf: set-ops direct parent queries** (hasRow/rowAt protocol; mirrors die) | done | `09adf4a` | RSS 337→218 MB build / 403→186 MB post-brush; brush −18%; m1/m2 PASS |
| **M4.5b DSL**: HTML/SVG builders + classic JSX (h/Fragment/For) + static-prop patching + live form props | done | `4e87200`…`7536e82` `fb7c84a` | 215 tests; DSL smoke through dist |
| **M5 (second migration)** examples/todo-v3 on the builders + spec | done | `db23da9` | spec green (live checked props, mirror routes, edit flow, persistence) |
| M4.5b rest: automatic jsx-runtime, per-tag intrinsic types, component scopes (onCleanup), devtools panel port | not started | | |
| M5 rest: remaining examples, MIGRATION.md, the flip | not started | | |

Run everything: `npm run test:v3` (215 tests). Types gate: `npm run typecheck:v3`
(89 positive + 47 @ts-expect-error negative fixtures). Perf gates: `npm run perf:v3`
(m1 + m2 — LOCAL, not CI; noisy-runner policy). CI runs test:v3 + typecheck:v3.
v2's `npm test` is untouched and green (v2 files unmodified).

## Layout

- `v3/contract/` — the closed delta algebra ([delta.ts](contract/delta.ts)), wire profiles +
  RESERVED + foldSnapshot ([index.ts](contract/index.ts)), the versioned timing contract
  ([SCHEDULE.md](contract/SCHEDULE.md)).
- `v3/conformance/` — legality checker, replay sink, harness (`conform`/`conformScalar`/
  `assertOracle`), the cross-op differential fuzz ([differential.test.ts](conformance/differential.test.ts)).
- `v3/kernel/` — Store, SourceNode (path-copy writes, consolidation, order channel), Scope,
  Runtime (two-phase commit, height-order flush, origin tokens, graph registry + onCommit hook).
- `v3/ops/` — registry + all operator families. Every op conformance-wrapped in its tests.
- `v3/api/` — `$()`, the non-callable handle, RESERVED dispatch, scope-owned dedup.
- `v3/compat/` — the permanent v2 ChangeRecord profile.
- `v3/perf/` — m1/m2 gates (read their METHODOLOGY comments before touching numbers —
  three measurement traps are documented there and each one produced a wrong verdict first).

## Decisions made en route (beyond the plan)

- **Native addressing is by KEY, everywhere** (sugar, `get()`, `patch`). After a mid-insert,
  positions ≠ keys; positional addressing belongs to the v2-compat lens and the DOM sink.
- **Ordered views materialize as arrays in rank order** (the v2 sort shape).
- **Windowed-sort tie order = view-arrival seq** (re-entry appends): deterministic and
  compositional; pinned by a double-run byte-equality test, checked up-to-ties by the oracle.
- **Consolidation annihilates net-zero updates** (flip A→B→A in one batch emits nothing).
- **between's bounds are a hidden input SourceNode** — the reactive-value-arg pattern
  (uniform binder for filter/compare/sort args should reuse this shape).
- **Operator-view children are read-only projections** (writes throw, pointing at the source).

## M4 state (this commit)

- `v3/render/`: ordered-children AST (el/text/rtext/list — the single-static-slot trap is
  structurally dead), render() with per-mount + per-row scopes, the KEYED list sink
  (Map<RowKey, Element>; orderMove = one insertBefore of the EXISTING element — identity
  survives, asserted), MirrorNode (the $(view)-swap replacement: a repoint is one
  consolidated diff commit; overlapping keys emit nothing so DOM survives) and raf().
- `v3/ops/reactive.ts`: the uniform reactive value-slot binder — gt/lt/gte/lte/za/az/top/
  limit/sum/avg accept reactive args (handles or nodes) via registry wrapping; dedup by
  bound-node identity; param subscriptions die with the operator.
- `v3/seam/`: public ingest() (both wire profiles, origin-token echo suppression round-trip
  tested, live-key add tolerance for LWW), fromAsync (pending/ready/error, batch-per-drain,
  dispose-cancels), SourceBacking interface + InMemoryBacking proof, exportContract() (the
  machine-readable manifest — fero deletes its hand-copied BUILTIN set against it).
- Kernel fix (seam agent's find): batch(fn, origin) restored the origin BEFORE flushing —
  batch-level echo suppression was silently dead; queued re-entrant writes now also capture
  their issue-time origin. Regression test in kernel.test.ts.

## M4.5a state (this commit)

- `v3/types/`: the typed public surface (Data/ReadonlyData/DataChild/Scalar/View/Reactive;
  ordered views as arrays; methods-only writes — no index-assignment signatures) with the
  fixture gate: `npx tsc -p v3/types`, 89 positives + 47 negatives, both directions verified.
  Reserved/Ops are hand-mirrors of the runtime registry until registry-generated types land.
- `v3/devtools/`: inspect/graph/trace/profile/cascades over runtime.graph() + onCommit —
  serializable, per-operator profile rows by construction, subscriptions dispose cleanly.
- FIVE bugs found by the types gate + integration, all fixed with regression coverage:
  (1) batch()-inside-an-effect crashed (queue-shape regression); (2) a seam narrowing miss;
  (3) set-op handle args weren't unwrapped to nodes (d.intersect(handle) was broken);
  (4) child-handle operator calls misdispatched to the OWNING view — now throw;
  (5) d.length(fn) silently ignored fn — now routes to the lengthBuckets histogram.

## crossfilter-v3 migration (2026-07-05 session)

The first M5 example migration, plus the M4.5b slice it forced:

- **`between` reactive bounds** ([ops/reactive.ts](ops/reactive.ts) `betweenR`): the
  crossfilter idiom `flights.between('date', filters.get('date'))` — binds straight onto
  `setBounds` (the O(Δ) brush walk; between already had its hidden bounds SourceNode, so
  no new param source). Dedup by bound-node identity + key path; `[]` opens to ±∞.
- **Render slice** ([render/index.ts](render/index.ts)): SVG namespace (children inherit);
  `bind(view, fn?)` reactive attribute props (normalized-string cutoff, row-scoped
  disposal); `text(view, fn?)`; structural row REBUILD in the keyed list sink when a
  rowFn's shape changes (patch keeps identity when shape is stable).
- **Browser bundle**: second tsup config → `dist/v3/index.js` (committed, Pages
  convention). THREE live bugs the example surfaced, all fixed with regression coverage:
  (1) prop dispatch probed `.kind` before checking for a handle — a scalar-handle prop
  (`d: barPath`) threw on the proxy's child-read path (`isView` now checked first);
  (2) tsup treeshake DROPPED the bare side-effect ops imports not also value-imported
  somewhere (`intersect` et al. missing from the bundle) — `./v3/ops/*.ts` added to
  package.json `sideEffects`;
  (3) **the big one — `perf(v3/ordered)` `693cd0e`**: OrderIndex's eager rank map was
  repaired with an O(N) Map-write loop PER DELTA, so an ordered view downstream of a
  churning source went quadratic — `za('date', 80)` over the 231k-row intersect made one
  brush step cost seconds. Ranks are now bisects over the strictly-ordered keys array
  (no rank map at all) and settle reconciles big batches in ONE set-filter +
  sorted-merge pass (hybrid, >32 touched keys). ~25 ms/step median on the 231k synthetic
  after; m1/m2 gates both IMPROVED (0.73/0.79 single-tick, 0.96 brush / 0.68 batch).
- **[examples/crossfilter-v3/](../examples/crossfilter-v3/)**: the full demo (4 brushable
  SVG charts, totals, top-80-by-date flight list grouped by day) on `data/v3` — ~180
  lines of app code vs v2's ~520-line inline script. Structural wins over the v2 example:
  no `za('date', Infinity)` full sort (the list is a bounded `za('date', 80)` window —
  the true top-80, where v2's `limit(80)` was iteration-order-dependent); no
  `groups[i].value` NaN trap (bar-path peak derived inside the `to()` fn, killing the
  max-lag-by-one-commit hazard too); writes are `filters.set(name, [lo, hi])`.
  Playwright spec: [tests/crossfilter-v3.spec.ts](../tests/crossfilter-v3.spec.ts)
  (DOM ≡ data through brush + resize churn; totals track; reset restores).
- **Example-workload bench** ([perf/crossfilter-example.bench.ts](perf/crossfilter-example.bench.ts),
  informational, not a gate): the REAL example graphs over the REAL 231k-row dataset,
  m2-gate methodology (one engine per process, ABAB reps, deep warmup, monotonic brush
  tuples, cross-engine checksum equality). Full-dataset numbers in the module header.

## The 2026-07-06 session ("continue building v3")

- **Set-ops rewrite** (`09adf4a`): new kernel protocol `DataNode.hasRow/rowAt` (O(1)
  materialized overrides everywhere, midBatch-aware) — SetOpNode's per-parent row
  mirrors + masks Map DELETED; liveness/exposure are direct parent queries per touched
  key. On the crossfilter graph: RSS 337→218 MB after build, 403→186 MB after brushing;
  brush −18% (36.4→29.8 ms/step on the chain micro).
- **The DSL** (`4e87200` `b77b1af`, workflow-built): HTML.*/SVG.* immutable Proxy
  builders (dot sugar: class / `'#id'` / `'attr=value'`; `_`→`-` per v2, `fb7c84a`) and
  classic JSX h/Fragment/For — both THIN sugar producing exact el()/list() records via
  the shared `normChildren`. **The v2 child ambiguity is dead**: a bare view child is
  reactive TEXT always; iteration is ONLY `<For>`/list(); a function child under a
  string tag throws (no `[vp, fn]`, no hasRowFn discriminator family).
- **Render prop slice** (`7536e82`): patchRow diffs STATIC props between rowFn outputs
  (class-from-row-data patches surgically); `checked`/`value` write the DOM PROPERTY
  when present (the attribute is only the pre-interaction default). Idiom: listeners
  bind ONCE — handlers read current state through the source (`items.get(id)`), never
  their captured row snapshot.
- **todo-v3** (`db23da9`): the second M5 migration, first DSL browser consumer —
  mirror()-routed filters, data-carried editing state, live checkbox props. Spec green.
- **Gates wired** (`9906424`): `npm run test:v3 / typecheck:v3 / perf:v3`; CI runs the
  first two (perf stays local — noisy-runner policy). Closes old gap 4.
- **Integer keys** (`d63563c`): crossfilter-v3 + its bench use an array-born source
  (minted int keys) — string-key hashing cost ~30% of a brush step, p95 halved.
- Full-dataset bench re-run (post all of the above): brush_date 0.254× / brush_delay
  0.141× of v2 at the median; setup 0.616× (v3 now FASTER than v2); RSS delta down to
  1.40× (was 2.45×). Quiet-box floor: v3 date 25.9 ms/step, delay 10.6 ms/step —
  approaching native crossfilter2's 20.9 ms/step on the same box/data/sweep. Full
  table in [perf/crossfilter-example.bench.ts](perf/crossfilter-example.bench.ts)'s header.

## Known gaps / next work (M4.5b+)

1. **M4.5b rest**: the automatic jsx-runtime (jsx/jsxs/jsxDEV entries), per-tag
  intrinsic JSX types (the jsx/intrinsics.ts port — .tsx authoring is untyped until
  then), component scopes (onCleanup / error boundaries), devtools panel port.
2. **v2-recorded-stream byte parity** — capture real v2 streams from the examples and
  parity-test compat/v2-records.ts against them (only shape-level tests exist).
3. **Registry-generated types** — replace the hand-mirrored Reserved/Ops in types/surface.ts;
  flip surface.ts's dynamic-import facade to the static import (marked in-file). Wrap
  max/min in installReactive (between's reactive bounds landed 2026-07-05; type fixtures
  for `between(col, handle)` + `bind()`/`text(view, fn)` should follow).
4. ~~Wire the gates into package.json/CI~~ — DONE 2026-07-06 (`9906424`).
5. Kernel niceties flagged by agents: reparent()/adoptParent() helpers (mirror/reactive
  cast into parents today); height re-propagation after repoint (stale-height edge — not
  reachable in shipped tests but real); a ScalarSource cell primitive; SourceNode.move()
  for ingest's deferred 'move' records; export ProjectionAggregate; deep-scalar emission
  mode; per-path connect(); positional limit(); page().
6. **M5**: remaining example migrations (todo next), v2 perf corpus re-baseline,
  MIGRATION.md, the flip. fero Phase 0.5 items on the v2 side remain undone.
7. **Memory**: LARGELY FIXED 2026-07-06 — the set-ops rewrite (`09adf4a`) deleted the
  per-parent mirrors that dominated (337→218 MB build / 403→186 MB post-brush on the
  crossfilter-shaped micro). What remains per-node: map's output cache, each between's
  rows mirror + view, ordered's rows cache. The M6 columnar backing
  (plans/v3/concepts/columnar-ir.md) is still the structural answer; a cheaper interim
  is sharing row maps between an operator and its sole parent where identity-forwarding
  allows.

## Standing methodology rules (hard-won; do not regress)

- Perf: monotonic write values (never measure the no-op path); one engine per process;
  deep warmup (10× inner); per-sample `gc()`; median-of-replicate-ratios.
- Every new operator: conformance-wrap every node in its tests + oracle every step + a
  seeded LCG churn ≥300 steps; add a composition case to differential.test.ts.
- v2 stays untouched on this branch until the M5 flip; every v2 bugfix during the window
  must add a differential scenario v3 also passes.
