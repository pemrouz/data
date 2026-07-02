# data v3 — the rewrite plan

*Synthesized 2026-07-02 from: a 22-agent subsystem audit (map + adversarial critique of every
subsystem, [audit-digest.md](audit-digest.md)), a 2026 competitive-landscape study, a
completeness critique (13 missing dimensions, 15 cross-audit contradictions, 5 open design
questions), and four independently-drafted rewrite architectures
([concepts/](concepts/)) judged on correctness, performance, and adoption lenses.*

---

## 0. Executive summary

**Rewrite the kernel around one inversion — stable keyed row identity under a closed, typed
delta algebra — and port everything of value on top of it.** Four architectures were drafted
from deliberately divergent stances (correctness-first, performance-ceiling-first,
ecosystem-first, delivery-risk-first); all four independently converged on the same kernel:
keys minted at ingress, a discriminated-union delta whose `update` is first-class and carries
`oldValue`, ordering as a separate channel, one consolidated batch per commit, synchronous
read-your-writes preserved as "a bare write is a batch of one", explicit owner scopes replacing
WeakRef lifetime, and a `SourceBacking` seam below the proxy. That convergence is the
strongest possible signal that this is the right kernel.

**The spine is the [keyed-delta concept](concepts/keyed-delta.md)** — read it in full; it is
the detailed architecture this plan adopts — with four grafts from the other concepts:

1. **(strangler) Phase 0.5**: ship fero's four M0 contract items *additively on v2, now*
   (public record ingress, non-cloning sink mode, subscription handles, versioned timing
   contract + `data/ir` entry), pinned by cross-repo contract tests that then survive the
   engine swap. The flagship consumer is unblocked in weeks, not quarters.
2. **(signals-platform) invertible transactions + signal bridge**: `oldValue` makes inverse
   batches free, so an optimistic-apply/rollback `transaction()` primitive and a TC39-shaped
   `data/signals` bridge ship as thin post-3.0 layers (M6), answering the TanStack DB and
   signals-interop table stakes without bending the kernel.
3. **(columnar-ir) the M6 columnar blueprint**: the columnar concept doc becomes the design
   document for the opt-in columnar `SourceBacking` (chunked typed-array columns, validity
   bitmasks, dictionary strings, rank-space OrderIndex) — capturing the measured 63–500×
   batch-recompute headroom later, behind the same key map, without gambling the kernel on it.
4. **(strangler) recorded-stream byte-parity**: the v2-compat record profile is verified
   against *recorded v2 change streams* from the real examples, and every v2 bugfix during the
   window must add a differential scenario v3 must also pass.

**Why rewrite at all** (the honest calibration the critics enforced): v2 is not on fire —
`KNOWN_FAILURES` is empty and an 18,600-run stress is clean. The case is structural: a
permanent ~20% engine tax of positional/sparse reconciliation, an unbounded conformance matrix
for every future operator, two formally-unresolvable residuals (C14/C16), foreclosed
incrementality (P3/P7 blocked on protocol changes), GC-timing-dependent observable semantics,
an unverifiable spec-by-assertion type surface, and a quantified 63–500× performance ceiling —
none of which converged under three years of patching, and all of which trace to five
decisions only a rewrite can change.

**Delivery model**: greenfield kernel, strangler adoption. The kernel is written fresh (no
attempt to run the new engine under the old 13-verb protocol — the protocol *is* the thing
being replaced), but v2 remains the shipped default until every parity gate passes (M5), the
11 examples + landing migrate tranche-by-tranche behind Playwright parity, and fero consumes a
versioned contract from week 1. ~20 weeks to the default flip, with the single
highest-regret gate (commit overhead ≤ 1µs) placed first.

---

## 1. Why rewrite — the structural case

The audit separated patchable complaints (≈ half of every subsystem's list — explicitly *not*
counted here) from five architectural roots that provably did not converge under patching:

| # | Root decision | What it generates | Evidence |
|---|---|---|---|
| R1 | **Row identity = storage position** for arrays | The entire C1–C16 family; two coexisting array contracts (splice-shift vs positional-hole); ~506 lines (~20%) of engine reconciliation; C14/C16 documented as mutually exclusive fixes; keyed DOM reconciliation impossible; P7 (array-source O(Δ) aggregates) foreclosed | DECISIONS.md C-series; ISSUES.md; render + protocol audits |
| R2 | **Protocol-by-convention**: 13 open verbs, untyped packed-pair payloads, no `oldValue`, capability negotiation by reflection, ordering correctness in comments | Every operator hand-implements verb × shape; conformance untestable (stream legality has no spec); P3 (O(Δ) invertible folds on nested edits) foreclosed; tests forced to normalize away behavior instead of pinning it | protocol + operators + tests audits |
| R3 | **GC-nondeterministic lifetime**: WeakRef-held sinks | Observable results depend on collection timing; dedup is a GC coincidence; `removeEventListener` impossible; industry-wide anti-pattern (reputational) | core-engine audit; landscape |
| R4 | **Fused roles, no kernel boundary**: Operator extends Value; mutation + notification on one verb surface; source backing fused into the proxy | fero needs a reflecting facade; devtools is archaeology over privates; non-memory sources (Arrow, workers, persistence) can't plug in | core-engine + seam + devtools audits |
| R5 | **Closures as the only operator-argument primitive**; row-object storage; per-write settle as the only entry | Dedup/serialization/incrementality analysis blocked by construction; the validated IR + columnar path (proto/dir: codegen ≈ free, WASM SIMD ≈ 4× inline; experiments/wasm: 63–500×) can only bolt on | perf + seam audits; proto/dir/RESULTS.md |

What is explicitly **not** rewrite justification (the critics' rulings, kept): the render
sparse/dense dual model (already converged in v2), reactive value-slot typing (patchable with
a covariant marker), the devtools panel's hygiene, perf-gate slack, doc drift, `sideEffects`
cruft, and every additive seam item the dIR prototype already proved ships on v2.

## 2. What must be kept (the crown jewels)

Carried forward as *requirements*, each with a test or gate:

- **No-phantom-events delta discipline** — enforced once at the kernel write chokepoint.
- **Synchronous read-after-write** — a bare write settles the whole graph before returning
  (the entire benchmark corpus, all examples, and fero's write-capture depend on it).
- **Rotation-emits-updates / no `undefined` flash** — preserved at the positional lens for
  every consumer that observes positions.
- **Snapshot-then-deltas on connect** — verbatim.
- **The algorithmic IP**: between's lazily-resorted brush walk, the bounded-window
  content-stable reconcile (431ms→2ms history), per-instance bitmask set-algebra membership
  (the SharedMembership rejection is respected), RowOperator's `process()` shape, tap's
  param-presence dual path, aggregate empty-set + NaN semantics (fero replicates them
  bit-for-bit), `length(fn)` zero-bucket persistence vs `group` pruning.
- **V8 monomorphism engineering** — declare-fields, constructor-full-init, constant op
  strings, flat batch shapes.
- **Surgical per-key DOM updates, no vdom** — upgraded from index-keyed to key-keyed.
- **fero's wire shape** `{ type, key: string[], value, at? }` — served losslessly forever as
  a documented profile (not a temporary shim).
- **Mode A perf honesty** — workload single-source-of-truth, don't-widen-thresholds law,
  self-flagging candor; H1 deterministic op-counts promoted to blocking CI.
- **The test corpus as an asset** — 63 differential scenarios, ~210 stream assertions, 11
  Playwright-tested examples, the fixture-gate type discipline: all become the parity gate.

## 3. Target architecture

Full detail in [concepts/keyed-delta.md](concepts/keyed-delta.md) §2–§7. The load-bearing
decisions:

### 3.1 Kernel

- **Store**: keyed row store with a packed dense lane — `slots: T[]` + validity bitmap +
  `Map<RowKey, slot>` (identity-elided while dense). Array-born rows get monotonic integer
  keys minted at ingress (never reused, never coerced — Map/Set-only keying makes the
  `1`-vs-`'1'` family unrepresentable); object rows adopt property names. Removal tombstones
  (never shifts); compaction off the hot path remaps slots, never keys. Derived views hold
  membership structures (bits/sets), not row copies; `[value]` materializes **dense**
  snapshots — the sparse-`undefined` public shape is version-broken.
- **Writes**: kernel-applied path-copy (copy-on-write along the written path) — `oldValue`
  is the untouched previous reference, zero clones; no-op writes dropped centrally.
- **Delta algebra** (the whole protocol — there is no other verb surface):
  `add {key,row}` | `remove {key,prev}` | `update {key,row,prev,path}` (first-class, never
  retract+insert) on the row channel; `orderInsert/orderRemove/orderMove` on a separate order
  channel consumed only by consumers that declare `wantsOrder`; `{prev,next}` on the scalar
  channel; delivered as one consolidated `CommitBatch` (≤1 delta/key, `seq` + `origin` token)
  per node per commit. Sinks implement one exhaustive-switch `apply(batch)` — a missed verb is
  a compile error; an illegal emission is a runtime conformance failure.
- **Scheduling**: two-phase batch commit; **a bare write is a synchronous batch of one**.
  Source reads always read-your-writes; derived reads mid-batch trigger flush-on-read pull
  recompute (no effect emission); flush propagates once, topologically by height; effects run
  last, exception-isolated into one `AggregateError`; re-entrant writes queue FIFO as the next
  commit. `batch()` generalizes `patch`; `coalesce('microtask'|'frame')` is opt-in sugar.
  All state lives on a per-graph `Runtime` (no module globals) — multi-graph, multi-realm,
  worker-hosted graphs by construction. Published as versioned `SCHEDULE.md` with cross-repo
  contract tests.
- **Lifecycle**: explicit owner scopes (`Symbol.dispose`), strong downward references,
  subscription handles with synchronous detach, scope-owned deterministic dedup caches.
  Leak-free-by-default survives via reachability (no global strong registry). WeakRef /
  FinalizationRegistry demote to a dev-mode leak warning. GC timing can never change
  observable results again — a loud, documented version-break.

### 3.2 API and types

- Non-callable, non-thenable read proxy; property sugar for child reads minus an explicit
  versioned `RESERVED` name set; `get()` as the total collision-free read; methods-only
  writes (`update/set/insert/remove/patch/ingest`; `[value]` kept both ways); bare
  assignment throws with guidance (restored by `data/v2-compat`). `$(view)` swap becomes
  explicit `mirror()`.
- Types first (M0): a typed operator registry generates **both** the runtime prototype and
  the `Ops<T>` method types — drift is a compile error; the `as Dollar` trust point and the
  4-parallel-places drift die. Read/write split (`View<out T>` covariant / `Writable<T>`),
  kind-split children, `Reactive<T> = T | View<T>` for every value slot. The positive +
  `@ts-expect-error` negative fixture gates carry over.
- **No registration side effect**: static installation dissolves `register.ts`, `data/lean`,
  `splitting:false`, the 8× bundle duplication, and the `Symbol.for` identity registry
  (except deliberately-versioned `data.v3.*` compat keys, so a mixed v2+v3 tree fails safe).

### 3.3 Operators

Family-by-family mapping + ported-IP inventory in the spine doc §4. Highlights: one
`OrderedView` family over a shared `OrderIndex` (rank map kills the O(N) `indexOf`); one
`BucketOp` with `prune: boolean` unifying `group(fn)`/`length(fn)`; set algebra by key domain
(C12/C15/C16 machinery has no representation; independent-array set algebra requires an
explicit `on:` key selector — a loud typed answer where v2 had a silent wrong one); 3-arg
`reduce` O(Δ) on nested edits via `prev` (P3 closed); array-source aggregates O(Δ) (P7
closed). New: `join` (keyed equi-join, the TanStack answer) and `page`, written against the
conformance kit from day one. **Arg slots accept `fn | Expr` from M0** — closures stay
primary and never dedup; `Expr` (the proto/dir grammar, shipped as `data/ir`) interprets
CSP-safe by default, `compileJS` is capability-probed opt-in, and Expr args dedup by
canonical serialization. Dedup rule: *dedup iff the argument has well-defined value identity*
(values, bound-view identity, canonical Expr) — deterministic, scope-owned, never GC-shaped.

### 3.4 Render

Keyed reconciliation (`Map<RowKey, Element>`; `orderMove` → real `insertBefore`; element
identity survives reorders — focus/selection/transitions intact; kanban/chat `data-id`
workarounds die). Ordered-children AST kills the single-static-slot trap (`<span># {cur}</span>`
finally renders in order). Per-row scopes make `removeEventListener` possible for the first
time. Components stay plain functions + `onCleanup` + error-boundary scopes. SSR: **out for
3.0**, but instantiation is written as materialize(target)+bind with one target shipped, so a
string/hydrate target is a later entry, not a rewrite.

### 3.5 Devtools

Core natively ships exactly two primitives (the audit's ruling): a creation-time reflection
registry (id/kind/provenance/edges — deleting ~1,000 lines of ctor-string archaeology,
minification-safe, serializable for remote frontends) and one `onCommit` observation hook
(seq *is* the cascade id; per-node delta counts + self-time; verb drift impossible because
the payload derives from the closed algebra). The panel is a subsystem-local port that
dogfoods the library.

### 3.6 Seam and sources

`SourceBacking { load, apply, subscribe }` is the kernel boundary from day one; in-memory is
just the default backing. fero's four M0 items are answered natively (public `ingest`,
no-clone native profile, disposable handles, versioned timing contract). `data/contract` is
engine-free: `SCHEMA_VERSION = 3`, both record profiles, `RESERVED`, capability descriptors,
`foldSnapshot` — and llms.txt/AGENTS.md/context7.json/README tables are **generated** from it
with a CI drift check (the hand-copy drift class closes at the root). Async/streaming sources
(`$.from(promise | asyncIterable | stream, { key?, coalesce? })`) with `status`/`error`
sibling views and scope-tied cancellation. Persistence/local-first: hook, not core —
`data/persist-idb` post-3.0; undo/redo becomes a ~50-line documented recipe *because `prev`
exists*. Distribution stays fero's.

## 4. The five open questions — decided

1. **Storage & identity**: keyed row store + packed dense lane; keys minted at ingress,
   Map/Set-only; order as a separate channel; columnar is an opt-in backing (M6), not the
   kernel. Keys survive the wire in the native profile; the v2 profile re-positionalizes
   losslessly through the order channel.
2. **Delta algebra & compat line**: the closed add/remove/update(+prev)/order/scalar union
   above; update first-class (Z-set closedness adopted, Z-set encoding rejected for named
   benchmark + contract reasons); fero's shape is a permanent lossless profile; version-broken
   loudly: sparse-`undefined` shapes and the leave/re-enter idiom.
3. **Scheduling & consistency**: two-phase commit, bare write = sync batch of one; flush-on-read
   for mid-batch derived reads; effects post-settle; FIFO re-entrancy with origin tokens;
   versioned SCHEDULE.md. Lazy-pull memos declined (deriveds are O(Δ)-maintained); equality
   cut-off adopted everywhere.
4. **API & lifecycle**: non-callable proxy + RESERVED set + `get()`; methods-only writes;
   registry-generated types; owner scopes with deterministic dispose; WeakRef → dev-mode
   leak detector.
5. **Seam & competitive scope**: SourceBacking + `data/contract` from day one; fero M0 items
   are M0 deliverables; IR is tier-2 with the slot shape fixed in M0; v3 stays an operator
   engine + renderer (the vertically-integrated combo) and answers TanStack DB with `join`,
   `page`, async sources, transactions (M6), and head-to-head numbers — not with a sync
   engine, persistence core, or query planner.

## 5. Contradiction rulings

All fifteen are ruled in the spine doc §9; the six load-bearing ones:

| Contradiction | Ruling |
|---|---|
| Sync-settle vs batch-first | Both, by strict superset: two-phase engine, bare write = sync batch of one. No benchmark re-baseline forced by semantics. |
| Update vs retract+insert | Update first-class with `prev`; rotations observed as updates through the positional lens; Z-set *discipline* without Z-set *encoding*. |
| Columnar vs keyed store | Keyed is the kernel (identity is what render/fero/algebra need); the packed-slots layout is columnar-ready; columnar is an M6 backing built to the [columnar-ir blueprint](concepts/columnar-ir.md). |
| WeakRef vs scopes | Scopes are the semantics; WeakRef is dev-mode tooling. Loud version break with migration docs. |
| Dedup policy | Dedup iff args have value identity; opaque closures never dedup; caches deterministic and scope-owned. |
| SSR scope | Out for 3.0; the materialize/bind seam keeps it an entry, not a rewrite. |

## 6. Cross-cutting policies

(Spine doc §10 in full.) CSP: no `new Function` in kernel or default paths — Expr interprets
by default, codegen is probed opt-in, CI runs once under simulated no-eval. Memory: a real
harness (`perf/mem.ts`) with counted allocation invariants (≤3 objects per single-row commit,
0 per no-op), retained-bytes budgets, and a 1,000-scope mount/dispose leak test — the
keyed-vs-columnar memory comparison lands in M1, *before* the columnar backing is scheduled.
Errors: typed `DataError` taxonomy, `AggregateError` for effect-phase failures, and a real
dev/prod build split that turns CLAUDE.md's gotcha list into runtime warnings. Value domain:
specified before the harness asserts equality (`null`/`undefined`/`NaN` first-class; absence =
key absence; NaN-poisoning versioned for fero; leaf reference semantics; unicode keys).
Runtime matrix: ES2022, Node ≥ 20/Deno/Bun/workers, WeakRef optional (dev-only). Bundle
budgets, CI-gated: kernel ≤ 12 KB, default entry ≤ 35 KB min+gz, one shared chunk (the 8×
duplication ends). Concurrency: per-graph `Runtime`, transferable record grammar.

## 7. Test strategy — the kit exists before the operators

The one benefit that cannot be retrofitted is *ordering*: M0 ships, before any operator code —

1. **Delta legality checker** — a per-node state machine asserting batch legality (adds only
   for non-live keys, ≤1 delta/key, no `Object.is` no-op updates, in-bounds order refs);
   dev build wraps every node.
2. **Replay sink** — folds emitted batches into a fresh store and asserts replay ≡
   materialized value after every commit: the table⟷change-stream duality as an executable
   law (the C8 class dies on commit zero).
3. **Independent plain-JS oracle** — naive per-operator implementations sharing zero code
   with the engine (the proto/dir fuzz harness's implementation-as-oracle flaw, fixed).
4. **The ported differential harness** — the 63-scenario grid + widened mutation vocabulary,
   asserting **exact equality with zero normalizers** (ties, iteration order, first-n are now
   specified), running three-way: v3 vs oracle vs v2-with-normalizers.
5. **Playwright corpus as parity gate** — the 11 examples' specs, intent-identical, against
   codemodded examples per tranche; e2e made hermetic so it finally gates CI.
6. **Cross-repo contract tests** — the fero M0 items as executable tests in both CIs;
   v2-record-profile **byte-parity against recorded v2 streams** from the real examples.

## 8. Performance strategy

Named flagship workloads with phase-exit gates (crossfilter 231k brush, swarm 12k patch
frame, per-op single-tick corpus ≤1.15× v2 at M2 and ≤1.0× at M5, library bounded-za drag,
a new 500-repoint churn bench). The M1 **commit-overhead budget ≤ 1µs** is the single
biggest go/no-go and is measured before operators exist. Peer set: the existing nine +
**TanStack DB** (their published workloads, their terms) + **krausest** locally for the
renderer (keyed reconciliation makes swap-rows honest for the first time). Memory benches
join the report. v2 stays the shipped default until every gate passes — a miss costs
schedule, never the brand. The don't-widen-thresholds law survives; so does the candor norm
(a 1.0–1.15× single-tick residual, if it happens, is published, not hidden).

## 9. Migration and compatibility

- **Versioning**: `data@3.0.0`, name kept. `data.v3.*` compat symbol keys so mixed trees
  fail safe. Publishing still token-blocked; the committed-dist Pages fallback continues.
- **Compat surface**: `data/v2-compat` (assignment traps, thenable await, `$(view)` swap →
  `mirror()`), supported through v3.x, removed in v4. The **v2 record profile is permanent**
  (a documented wire profile, not a shim), quarantined in one ~300-line module — the only
  place order→index math survives.
- **Codemods**: full inventory for the 11 examples + landing in the spine doc §13 (mostly
  mechanical: assignment→`.update()`, swap→`mirror()`, `dense()` and defensive bindings
  *deleted* because their causes are gone). fero: ~40 source-path imports → `data@3` +
  `data/contract`; hardcoded BUILTIN set → generated `RESERVED`; 5 `[VIEWSYM].res`
  reach-throughs → `ingest()`; echo boolean → origin tokens.
- **Version-broken loudly** (MIGRATION.md with before/after): sparse-`undefined` shapes,
  `await proxy`, GC-silent unsubscription, bare-assignment writes, `data/lean`.
  **Preserved verbatim**: the v2 record profile, connect arities, snapshot-then-deltas,
  no-phantom-events, rotation-emits-updates (lens), aggregate semantics, bucket persistence
  contracts, dist entry layout (example importmaps keep resolving).

## 10. Phasing and governance

**Greenfield kernel in a `v3/` tree in-repo; strangler adoption by consumer; v2 default
until M5 exits.** v2 policy during the window: bugfix-only, same maintainer, and **every v2
bugfix must add a differential scenario v3 must also pass** — maintenance feeds the gate.

| Milestone | Contents | Machine-checkable gate |
|---|---|---|
| **Ph 0.5 (on v2, immediate)** | fero M0 items additively: `apply()` ingress, `connect(..., {clone:false})`, subscription handles, TIMING.md + contract tests; `data/ir` entry (SCHEMA_VERSION, records, foldSnapshot, descriptors) | fero deletes its reach-throughs/BUILTIN set; contract tests green in both CIs |
| **M0 — contract & kit (wk 1–2)** | `contract/` types, delta algebra, SCHEDULE.md, legality checker + replay sink + oracle skeleton, type fixtures | kit red/green on a toy op; fixtures pin; fero sign-off |
| **M1 — kernel (wk 3–5)** | Store/keys/path-copy/scopes/runtime/registry/graph hook; filter/map/compare/sum/avg/length; v2-record sink | legality+replay green; **commit ≤ 1µs**; single-tick ≤1.15× v2; mem invariants |
| **M2 — hard ports (wk 6–9)** | between, OrderedView, set algebra, buckets, reduce/distinct/tap | 3-way differential exact-equal; old C15 failures pass trivially; swarm gate ≤ v2 |
| **M3 — render + first examples (wk 10–13)** | keyed DOMSink, children AST, JSX, ownership; todo/kanban/chat/library codemods | Playwright parity ×4; crossfilter brush ≤ v2; focus-survives-reorder green |
| **M4 — devtools + seam (wk 14–16)** | registry devtools + panel port; ingest/backing; async sources; fero integration | devtools suite + XSS + reversibility; fero contract green on v3 HEAD |
| **M5 — completion & flip (wk 17–20)** | remaining examples + landing; `join`/`page`; perf re-baseline; TanStack/krausest numbers; MIGRATION.md | all examples green; all perf gates ≤1.0× (or written accepted-regression per row); size gates. **Then the default flips.** |
| **M6 — post-3.0** | columnar backing + WASM (per the columnar-ir blueprint); Arrow/Electric adapters; `transaction()`/optimistic; `data/signals` bridge; persist-idb; SSR target; krausest submission | each behind its own gate; none blocks 3.0 |

Any gate failing twice triggers a written decision: fix, descope, or — for the M1 commit gate
specifically — revisit the batch-of-one mechanics before anything is built on them.

## 11. Risks

(Spine doc §15 in full.) The named existential one: **v3 slower than v2 on advertised
workloads** — mitigated by gate placement (commit overhead first), the dense-lane design,
per-operator benchmark twins as ports land, and v2-stays-default-until-green. Second:
**scope balloons into a framework** — mitigated by a written non-goals list from M0 (no sync
engine, no persistence in core, no SSR in 3.0, no query planner, no component framework
beyond scopes) and the M6 fence. Third: **the compat profile becomes a second protocol to
get wrong** — quarantined, byte-parity-tested against recorded streams, and the flow essay
runs on it as a living fidelity test. Also tracked: reserved-name collisions (dev warnings +
`get()`), fero timing slip (the seam exists precisely so fero can swap backings late),
path-copy aliasing surprises (documented + dev heuristic), v2 starvation (bugfix-feeds-gate
rule), ecosystem drift during the window (peers re-benched at M5; positioning rests on the
integrated pipeline no peer targets).

## 12. Decision log

| Decision | Rationale | Rejected alternative | Driver |
|---|---|---|---|
| Keyed identity kernel | Kills C-series by construction; render/fero/algebra all need keys | Columnar-native (identity/nesting tax); keep positional (unbounded conformance matrix) | protocol/core audits; all 4 concepts |
| Update first-class + `prev` | O(1) in-place path + rotation contract are brand + wire invariants; prev closes P3/C5/C7 | Z-set retract+insert (2-events-per-edit, benchmark regression) | landscape + perf audit |
| Order as separate channel | Position-agnostic consumers never see moves; capability is typed, not reflected | Positional verbs (BR1A/BH1 family) | protocol audit |
| Bare write = sync batch of one | Preserves every consumer's observable semantics; batching is a superset | Batch-only (breaks corpus); lazy pull (consistency fork) | completeness contradiction #1 |
| Owner scopes; WeakRef → dev tool | Deterministic teardown; industry consensus; leak-free via reachability | Keep WeakRef semantics (untestable, reputationally radioactive) | landscape; core audit |
| Non-callable proxy + RESERVED + `get()` | Kills thenable/collision traps while keeping chainable DX | Callable proxy (traps); `.q` namespace (kills the brand DX) | types/core audits |
| Registry-generated types + prototype | Drift = compile error; kills `as Dollar` + 4-place drift | Hand-maintained fixtures-as-spec | types audit |
| Static installation, no side-effect registry | Dissolves 8× bundles, lean entry, Symbol.for identity | Keep register.ts side effect | packaging audit |
| IR tier-2, slot shape fixed at M0 | CSP-safe default; ergonomics; layering never touches constructors | IR-primary (CSP + DX cost); IR-never (forecloses fero L3/wire) | seam audit; CSP finding |
| Dedup iff value identity | Both audit claims satisfied on their own turf; deterministic | Dedup closures by reference (silent sharing) | operators-crit KEEP |
| Columnar as M6 backing | Headroom is batch-frontier, orthogonal to delta pipeline; memory data first (M1 harness) | Columnar kernel (single-tick + nesting + wire risk) | perf audit + judge reasoning |
| Greenfield kernel, strangler adoption, v2 default till M5 | Protocol can't be strangled through itself; corpus still gates | Full byte-compat facade (permanent tax, defers API wins a major); big-bang flip (brand risk) | strangler concept, amended |
| fero items on v2 now (Ph 0.5) | Unblocks flagship consumer in weeks; contract tests pin across the swap | Make fero wait for M4 (wrap-or-fork risk) | strangler graft |
| `join`/`page` in M5; transactions/signals bridge M6 | Answer TanStack without kernel bend; `prev` makes inversion free | Full sync/optimistic story in core (framework creep) | signals graft |
| SSR out, seam kept | Demand unproven; two-phase materialize/bind keeps it an entry | SSR in 3.0 (scope) / no seam (forecloses) | render-crit |
| Name `data`, `data@3.0.0`, versioned compat symbols | Project memory: name kept; mixed trees must fail safe | Rename (discoverability debate deferred) | completeness/versioning |

---

*Supporting documents: [audit-digest.md](audit-digest.md) (the 22-agent audit),
[concepts/keyed-delta.md](concepts/keyed-delta.md) (the adopted spine — authoritative for
kernel/API/operator/render/devtools/seam detail),
[concepts/columnar-ir.md](concepts/columnar-ir.md) (the M6 columnar blueprint),
[concepts/signals-platform.md](concepts/signals-platform.md) (M6 transactions/signals bridge
+ the framework fence), [concepts/strangler-kernel.md](concepts/strangler-kernel.md)
(Phase 0.5 detail + the facade contingency if migration surprises demand it).*
