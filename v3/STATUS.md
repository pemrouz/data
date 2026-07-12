# v3 rewrite — status

*Updated 2026-07-12 (ninth block: **THE FLIP, phase 2** — the landing page +
multidim's data row run the v3 engine. Phase 1 (eighth block) re-plumbed the
entries: bare `data` IS v3, v2 frozen at `data/v2`. Phase 3 remains: the
README/llms/AGENTS/CLI docs sweep, the PR to main; the flow essay port is its
own future block).
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
| **M4.5b JSX completion**: automatic runtime (jsx/jsxs/jsxDEV through h) + per-tag intrinsics + classic/automatic fixture gates + the thin `data/v3/jsx-runtime` dist entry | done | `f8f326e` `2811cf5` `d86e014` | 222 tests; 3 tsc gate programs, gate-bite proven; m1 0.740 / m2 0.968·0.791 PASS |
| **M5 (third migration)** examples/chat-v3 in classic JSX + spec | done | `b92b8d0` | spec green (mirror re-point, transient-filter dispose, nested reaction set, one-commit blast) |
| **M5 (migrations 4–6)** kanban-v3 / pivot-v3 / library-v3 + specs, and the two fixes they surfaced (kernel reheight-on-repoint; dedup evicts disposed) | done | `92b920f`…`c18e4a4` | 224 tests; 23 spec cases; m1/m2 PASS |
| **M5 (seventh migration)** examples/swarm-v3 + spec — the patch-throughput showcase | done | `80e9475` | organic frames 0.26 ms median; 2000-row patches 3.39 ms; spec proves one-commit-per-frame bridge |
| **MIGRATION.md** drafted + adversarially verified (~220 executed checks) | done | (uncommitted → this block) | every code claim + error string executed against the runtime |
| **Migration hardening** — the fix series the MIGRATION.md verification surfaced | done | `313e575`…`3f93655` | 233 tests; m1/m2 PASS; see the session section |
| **v2 perf-corpus re-baseline** — corpus.bench.ts (64 paired cases over all 19 workloads.ts exports, checksummed equivalence, adversarial fairness pass) + the full-sweep table | done | `8e0da82` + results commit | geomean 1.569× on UNBATCHED write-for-write micros (see the header's read: setup-dominated; single-writes at parity or v3-faster; realistic batched shapes all favor v3 — m1 0.74×, m2 0.78–0.97×, examples 0.14–0.25×) |
| **M4.5b devtools panel port** — DOM seam (render registry + fromDOM/highlight) + the overlay panel (dock/graph/inspector/picker) + the `data/v3/devtools` entry | done | `688f378` `bbe1138` `0e37da4` `37115d3` | 239 tests; devtools-v3 spec 6/6; zero-subscriber leak audit; single-module-instance bundle proof |
| **M4.5b component scopes** — `onCleanup` + deferred `component()` (JSX function tags defer to mount, invoked once under an owner Scope) + `boundary()`/`<ErrorBoundary>` (microtask-deferred effect-phase swaps) + the 18-finding pre-commit review fix round | done | `55d90f5`…`a8b95aa` | 272 tests (33 new); typecheck ×3; e2e 41/41 twice; m1 0.69/0.85, m2 0.93/0.71 PASS |
| **THE FLIP, phase 1 (re-plumb)** — bare `data`/`dist/index.js` IS v3; v2 shifted whole to `data/v2`/`dist/v2/*`; `data/v3` kept as same-file aliases; every v2 surface pinned (11 importmaps + perf dashboard + 2 spec paths); shipped types = `v3/types/public.d.ts` on `exports["."]`; no v2-compat shim (error text repointed at `data/v2`) | done | `1ed17de`…`ca2b85e` + docs | unit 272+529; typecheck v2×4 + v3×4 (new public gate); FULL e2e suite; MIGRATION §6 flipped |
| **THE FLIP, phase 2 (showcase surfaces)** — the landing page (feed/demos/race + the API-visible HTML) and multidim's `data` row run the v3 engine, importmaps un-pinned; + the nested operator-view child-path fix the port surfaced | done | `70ea8ed`…`fc03b92` + build/docs | 273 v3 tests; typecheck ×8; phase-2 e2e 23/23 (race ×9 engines, demos-tap under GC, v3 devtools mount, multidim ×10 rows) |
| M5 rest / flip phase 3: flow stays pinned (essay port is its own block), README/llms/AGENTS/CLI docs sweep, PR to main | not started | | |

Run everything: `npm run test:v3` (273 tests). Types gate: `npm run typecheck:v3` —
FOUR programs: base (89 positive + 47 @ts-expect-error negative fixtures), classic JSX
([types/tsconfig.jsx.json](types/tsconfig.jsx.json) → check.tsx via jsx-surface.ts
declared facades), automatic JSX ([types/tsconfig.auto.json](types/tsconfig.auto.json) →
check.auto.tsx under `jsxImportSource: "data/v3"` via a paths-mapped decl shim), and
PUBLIC ([types/tsconfig.public.json](types/tsconfig.public.json) → check.public.ts
against the SHIPPED [types/public.d.ts](types/public.d.ts) via the bare `data`
specifier). Perf gates: `npm run perf:v3` (m1 + m2 — LOCAL, not CI; noisy-runner
policy). CI runs test:v3 + typecheck:v3. v2's `npm test` is untouched and green
(v2 sources unmodified; its dist lives at `dist/v2/*` since the flip).

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

Second block (the JSX completion, `f8f326e`…`b92b8d0`):

- **Automatic runtime** (`f8f326e`, [jsx/runtime.ts](jsx/runtime.ts)): jsx/jsxs/jsxDEV
  all peel props.children and normalize through the SAME `h(tag, rest, ...children)`
  path as the classic transform — byte-identical records by construction, drift
  structurally impossible. JSX `key` accepted and IGNORED (v3 keys rows by DATA).
- **Per-tag intrinsics + gates** (`2811cf5`): [jsx/intrinsics.ts](jsx/intrinsics.ts) is
  the zero-import single source of truth both transforms alias ([jsx/jsx.d.ts](jsx/jsx.d.ts)
  global for classic; runtime.ts's exported namespace for automatic) — v3 truths encoded
  as fixtures: literal `class`/`for`, string `style`, no class object-maps, function
  children are a COMPILE error. Two new gate programs (classic + automatic) join the
  base gate under `typecheck:v3`; `<For>` row-type inference is a positive fixture.
- **The thin jsx-runtime entry** (`d86e014`): dist/v3/jsx-runtime.js is emitted as
  `export … from './index.js'` (a tsup rewrite plugin) — ONE module instance across
  entries, closing the v2 "single entry" instanceof trap structurally. package.json
  exports `./v3` + `./v3/jsx-runtime` (no types keys — flip-time decision).
- **chat-v3** (`b92b8d0`): third M5 migration, the JSX layer's first browser consumer.
  Idioms it proves: mirror slot with az/length chained once; TRANSIENT search filter
  dispose()d after re-point (the kanban pileup lesson, answered); path-addressed nested
  reaction writes; one-commit 200-row patch; PLAIN rows — no .to() bindings, no
  transient-undefined guards, no data-id read-back. Spec: 6 scenarios green.

Third block (three more M5 migrations + the two fixes they surfaced,
`92b920f`…`c18e4a4`):

- **kanban-v3** (`613eae8`): per-status filter→mirror→az chains built once; drag-drop
  is ONE batch() commit; the 3-arg INCREMENTAL reduce workload deck (an in-place edit
  = exactly one remove(prev) + add(row) — spy-verified); ordered views keep CARD-ID
  row keys so the v2 data-id read-back is gone. Spec proves the one-commit move and
  transient-dispose non-leak via kernel probes (Symbol.for('data.v3.node')).
- **pivot-v3** (`39905f1`): EVERY cell/total a standing filter()→aggregate scalar off
  one source (bucket children are path addresses — per-cell filters ARE the idiom);
  config churn disposes all transients; +100/shuffle are one-commit batches
  (MutationObserver: exactly 1 characterData write on the grand cell).
- **library-v3** (`c18e4a4`): the set-ops showcase — four mirror slots →
  intersect → except → za('rating', reactive n). Load-more grows the window IN PLACE
  (pageSize.get('n').update) — v2's repage() concept deleted. 282 oracle assertions;
  graph size stable across 50 dispose cycles.
- **fix(v3/kernel) `92b920f`**: mirror repoint now RE-HEIGHTS descendants
  (kernel reheight()) — library's PROBE A showed a pre-repoint descendant settling
  BEFORE the repointed mirror and reading its stale view, with the late batch
  lingering until the next re-settling commit. Regression test bites (fails pre-fix).
- **fix(v3/api) `873111b`**: the operator dedup cache EVICTS DISPOSED views (lazy,
  on hit) — pivot's footgun: dispose a deduped aggregate, re-request it, get the
  detached node frozen at its pre-dispose value.

Fourth block (swarm-v3 + MIGRATION.md + the hardening series it surfaced):

- **swarm-v3** (`80e9475`): the patch-throughput showcase — one `pop.patch(pairs)` per
  frame through the full deck (2 histograms + filter→histogram + some-over-buckets +
  avg + reactive-bounds intersect + limit(120) table). Organic frames 0.26 ms median /
  0.45 p95; heavy 2000-row patches 3.39 ms; worst case (bounds moved every frame while
  churning) 8.15 ms — between's documented lazy-resort amortization, raf-capped.
- **[MIGRATION.md](MIGRATION.md)**: drafted from the seven migrations, then an
  adversarial pass EXECUTED ~220 claims (every code snippet + thrown string) against
  the runtime. It surfaced six real gaps, ALL FIXED same-block:
  - `313e575` set-op operands validate BEFORE attach — v2's `intersect({col: view})`
    used to POISON the runtime (half-attached node crashed every later write).
  - `14028b1` patch() tuple-shape pre-scan (v2's flat form could commit garbage
    char-wise rows SILENTLY); `$(handle)` throws → mirror()/snapshot-fork hints.
  - `3f607c1` construction fail-fasts: filter('k',v)/filter({k:v}), za(5)/az(5),
    between(col, [$(lo), $(hi)]) (was a SILENTLY EMPTY view).
  - `ce6b9d3` reactive max/min columns (MaxRNode/MinRNode — closes the gap-3 sub-item).
  - `8fea5b6` scalar connect([]) / (anchor, fn) — v2's documented testing pattern.
  - `3f93655` JSX `key` stripped (no literal key="…" DOM attribute).

Sixth block (the devtools panel port, `688f378` `bbe1138` `0e37da4` `37115d3`):

- **The DOM↔data seam**: render's zero-cost registry (domLinks WeakMap + liveLists
  set) → [devtools/dom.ts](devtools/dom.ts) fromDOM/rowElements/highlight.
- **The panel** ([devtools/panel/](devtools/panel/)): closed-shadow dock (persisted
  resize), BFS-by-height graph (Tree/DAG, pan+zoom, frame-coalesced live refresh),
  three-tab inspector (Inspect / Events with leave-drop subscriptions / Profile),
  ◎ picker + single Alt-badge (deliberately not v2's all-rows badges — the swarm-
  scale perf trap). Built by four parallel agents on pinned contracts — zero drift;
  leak audit: close() → ZERO onCommit subscribers.
- **The entry**: `data/v3/devtools` — attach + auto-mount (?nopanel opt-out),
  $.devtools.panel.{open, close, shell}; the dist bundle externalizes every
  boundary import to './index.js' (one kernel instance, spec-proven: the injected
  bundle's graph() sees the app's nodes).

Seventh block (component scopes — the LAST M4.5b item, `55d90f5`…`a8b95aa`):

- **`onCleanup(fn)`** ([kernel/scope.ts](kernel/scope.ts)): registers on the
  AMBIENT scope; THROWS outside one (a cleanup that would never run is a leak,
  not a no-op). Exported from `data/v3`.
- **Deferred components** ([render/index.ts](render/index.ts)): `component(fn,
  props)` is a new VNode kind — fn invoked ONCE at MOUNT under its own child
  Scope (owned by the enclosing scope: a row's component dies with the row).
  onCleanup / node creation / raf() inside the fn land on that scope; output
  normalized via the full child vocabulary (arrays expand — multi-root OK; a
  component as a row ROOT must resolve to exactly one element). JSX function
  tags now DEFER here (`h` routes them to `component()`; Fragment / For /
  ErrorBoundary stay eager — structural). Contract change from the old eager
  invocation: invocation moves from h() time to mount; the 4 jsx tests
  asserting eagerness were rewritten to pin deferral. `key` is now stripped
  from component props on BOTH transforms (classic used to leak it).
- **Error boundaries**: `boundary(child, fallback)` /
  `<ErrorBoundary fallback={(err, reset) => …}>` — a BoundarySlot owns its
  subtree's Scope + top-level doms behind a text anchor. MOUNT-phase errors
  are caught synchronously; EFFECT-phase errors (a binding / row fn throwing
  inside a subscription callback) route to the nearest boundary via
  ctx.boundary — bindings take a guarded closure ONLY under a boundary (zero
  cost otherwise) — and the swap is deferred ONE MICROTASK, because
  disposing/connecting mid-effect-iteration would splice the very effects
  array the kernel is walking. The fallback mounts with ctx.boundary = the
  OUTER boundary (a broken fallback escalates outward, never loops); reset()
  re-mounts the try child. Without a boundary the kernel contract is
  unchanged (effect errors → the commit's AggregateError).
- **Row fns are NOT a scope** (they re-run on updates — registrations would
  accumulate): ListBinding invokes them under runInScope(null, …), so
  onCleanup in a bare row fn throws deterministically on BOTH the initial and
  the add path (it used to silently land on the mount scope at init). A row
  needing lifecycle wraps its content in a component; a component child with
  changed props rebuilds the row in place (fresh scope — correct lifecycle,
  not a patch).
- **The pre-commit adversarial review bit hard** — a 5-dimension workflow
  (flush protocol / scope ownership / JSX contract / list sink / surface
  drift; 49 agents, 2 refuters per finding) confirmed 18 findings, all fixed
  same-block with regression tests:
  - **Exception-safe mounts** (4 majors): a throw mid-build used to leak
    already-connected subscriptions + ghost DOM a boundary's teardown could
    not reach — buildRowFrom, the ListBinding constructor, mountComponent,
    and render()'s root loop now tear their partials down before rethrowing.
  - **mountInto runs under runInScope(subtree scope)** — boundary subtrees
    used to double-register every subscription handle on the AMBIENT (mount)
    scope, retaining the whole torn-down try subtree until unmount.
  - **Kernel effect-phase hardening** (2 majors, pre-existing gaps the
    boundary machinery widened): the effect loop now iterates a SNAPSHOT
    (disposing a sibling subscription from inside an effect spliced below the
    live cursor — the next sink silently skipped the commit; entries are
    tombstoned via `dead`), and connect() stamps `bornSeq` so a sink born
    mid-commit skips the batch its init snapshot already contains (a nested
    list built during an add duplicated rows).
  - **Structural patch equality** (vnodeEq/propsEq): component/boundary
    records re-minted per rowFn run compare by SHAPE, not reference — a
    `<Chip>static</Chip>` row child survives updates; one embedding `row.t`
    rebuilds only when it moves (pre-fix: whole-row rebuild EVERY update —
    focus/identity loss). Functions/views compare by reference: hoist
    fallbacks out of row fns.
  - **Scope.dispose completes past a throwing cleanup** (failures aggregate);
    the update-path rowFn runs under runInScope(null) like the build path;
    queueSwap resets `broken` in a finally; a list-as-row-root gets a real
    error instead of the internal one.
- Verified: 30-test [render/component.test.ts](render/component.test.ts) +
  3 kernel review-fix tests (suite 272), types fixtures in all three gate
  programs (facades + negatives for onCleanup/component/boundary/
  ErrorBoundary), e2e 41/41 twice (pre- and post-review-fixes), v2 untouched
  (529), m1/m2 PASS twice.

Eighth block (THE FLIP, phase 1 — the entry re-plumb, `1ed17de`…`ca2b85e` + docs):

- **The renames**: tsup emits v3 at `dist/index.js` / `dist/devtools.js` /
  `dist/jsx-runtime.js` and the WHOLE v2 surface under `dist/v2/*` (entry keys
  carry the prefix, so v2 devtools' relative `./panel/index.js` lazy import
  survives). package.json: `main`/`module`/`exports["."]` → v3;
  `./jsx-runtime` + `./jsx-dev-runtime` → the one thin runtime file;
  `./devtools` → the v3 panel bundle; `./v3/*` kept as SAME-FILE transitional
  aliases (one module instance — never duplicate bundles); `./v2/*` carries
  the old surface with its generated d.ts. sideEffects updated to the new
  paths.
- **Nothing broke at the seams**: the 7 v3 examples' importmaps repointed
  (key `data/v3` kept, value → `../../dist/index.js` — zero source edits);
  the 11 v2 surfaces (gallery examples, flow, multidim, todo-jsx/crossfilter-
  jsx, the landing page, the perf dashboard) pinned to `dist/v2/*` until each
  migrates; 2 spec files' hardcoded dist paths updated.
- **Types ship**: `exports["."].types` → [types/public.d.ts](types/public.d.ts),
  a SELF-CONTAINED declaration mirror of surface.ts (npm `files` carries it),
  gated by a fourth typecheck:v3 program ([types/tsconfig.public.json](types/tsconfig.public.json)
  → check.public.ts fixtures against the `data` specifier).
- **Decided: no v2-compat runtime shim** — the `[value] =` error now says
  "the pre-flip surface lives at data/v2" (MIGRATION §2/§3.12 quotes updated;
  §6 rewritten as the flipped entry table; intro imports say `from 'data'`).

Ninth block (THE FLIP, phase 2 — the showcase surfaces, `70ea8ed`…`fc03b92` + build/docs):

- **The landing page runs v3**: [assets/feed.js](../assets/feed.js) (array-born
  source, path writes, `lastTick` as a scalar-child handle), [assets/demos.js](../assets/demos.js)
  (all 15 operator cards rebuilt in the v3 vocabulary — mirror()-slot chip
  re-pointing with transient-filter dispose, list()/text()/bind() with plain
  rows, the `dense()` helper + every undefined-guard DELETED, the tap WeakRef
  DOM-anchor hack DELETED, `.reverse()` → `.values()`, rank via CSS counter
  since orderMoves don't re-run row fns), [assets/race.js](../assets/race.js)
  (the data engine coalesces each frame's ticks into ONE `patch` commit — the
  swarm-v3 bridge), and [index.html](../index.html) (predicate `filter` sig,
  flip entries block incl. `data/v2` + migration link, both quickstart snippets
  on the v3 write/list forms, gallery retargeted to the -v3 twins with v2
  fallback links, importmap → `dist/index.js` + `dist/devtools.js`).
- **multidim's `data` row runs v3** ([examples/multidim/lib-data.js](../examples/multidim/lib-data.js)):
  reactive `between` bounds off one filters source, explicit leave-one-out
  `intersect`s, `length(fn)` histograms, bounded `za('delay', 5)` (the v2
  pre-sort + `limit(5)` trick is obsolete — noted in its header). Deliberate
  correctness change: bars tap the HISTOGRAM, not `max('value')` — v3 scalars
  cut off no-change emissions, so tapping the max would starve bar redraws
  whose peak didn't move.
- **fix(v3/api) the port surfaced**: nested child reads on an OPERATOR VIEW
  (`counts.get(tn).get('value')` — the length(fn)-bucket idiom) dropped the
  parent path segment and SILENTLY read undefined; childState now extends the
  path (childRead already walked deep paths via leafAt). Regression test in
  api.test.ts.
- **[tests/landing-devtools.spec.ts](../tests/landing-devtools.spec.ts)**
  rewritten for the v3 mount path: the C6 cross-bundle regression it guarded
  is closed STRUCTURALLY by the boundary-externalized devtools bundle (one
  module instance by construction); the spec now asserts that end-to-end.
- flow + the v2 example pages stay PINNED to `dist/v2/*` and green — the flow
  essay port is its own future block.
- Verified: v3 273 (the new api regression), v2 529, typecheck v2×4 + v3×4,
  phase-2 e2e 23/23 (race ×9 engines, demos-tap under forced GC, the v3
  devtools mount, multidim ×10 rows incl. the data-row brush loop).

## Known gaps / next work (M4.5b+)

1. ~~**M4.5b rest**: component scopes (onCleanup / error boundaries)~~ — DONE
  2026-07-12 (`55d90f5`…`a8b95aa`; see the seventh-block section). **M4.5b is COMPLETE.**
  ~~devtools panel port~~ — DONE 2026-07-10 (`688f378`…`37115d3`).
  ~~automatic jsx-runtime, per-tag intrinsic types~~ — DONE 2026-07-06
  (`f8f326e` `2811cf5` `d86e014`).
2. **v2-recorded-stream byte parity** — capture real v2 streams from the examples and
  parity-test compat/v2-records.ts against them (only shape-level tests exist).
3. **Registry-generated types** — replace the hand-mirrored Reserved/Ops in types/surface.ts;
  flip surface.ts's dynamic-import facade to the static import (marked in-file).
  ~~Wrap max/min in installReactive~~ — DONE 2026-07-06 (`ce6b9d3`). Type fixtures
  for `between(col, handle)` + `bind()`/`text(view, fn)` should still follow.
4. ~~Wire the gates into package.json/CI~~ — DONE 2026-07-06 (`9906424`).
5. Kernel niceties flagged by agents: reparent()/adoptParent() helpers (mirror/reactive
  cast into parents today); ~~height re-propagation after repoint~~ — DONE 2026-07-06
  (`92b920f`, kernel reheight() called from MirrorNode.set; regression in api.test.ts);
  a ScalarSource cell primitive; SourceNode.move() for ingest's deferred 'move' records;
  export ProjectionAggregate; deep-scalar emission mode; per-path connect(); positional
  limit(); page().
6. **M5**: remaining example migrations (SEVEN done: crossfilter, todo, chat, kanban,
  pivot, library, swarm; flow/multidim + the landing page remain — all three are
  v2-showcase surfaces, likely flip-time decisions), ~~v2 perf corpus re-baseline~~
  (DONE — [perf/corpus.bench.ts](perf/corpus.bench.ts), table + read in its header),
  ~~MIGRATION.md~~ (drafted + verified; flip-time renames still TODO in its §6), the
  flip. fero Phase 0.5 items on the v2 side remain undone.
8. **Corpus hotspots** (from the re-baseline table — follow-up perf levers, none
  flip-blocking): graph-construction/setup overhead is the systematic slow class
  (tap/setup 13.2×, to/setup 6.5×, filter/setup 5.1× — node + param-source minting);
  group/insert 10.96× and to/* 4.8–6.2× are the named per-write outliers;
  reduce/batch 1.8×, between/remove 3.8×. Single-write parity and the batched
  flagship shapes are already at-or-ahead of v2.
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
