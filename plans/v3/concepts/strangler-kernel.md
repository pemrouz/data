# data v3 — concept "strangler-kernel"

**Design stance: de-risk the rewrite itself.** Big-bang rewrites of working, benchmark-winning
engines fail on the long tail, not the headline. This repo's own history is the proof: the v2
engine "worked" long before it was *right* — C1→C16 took months of differential-harness
whack-a-mole to converge *after* the operators shipped, and two residuals (C14/C16) never
converged at all. A greenfield v3 restarts that clock with a bigger surface. This concept
instead rewrites only the thing that generates the bug ledger — the kernel: storage identity,
the delta algebra, scheduling, lifecycle — and **strangles** everything else behind the existing
v2 public API, so that the entire shipped corpus (63 differential scenarios, 26 unit suites,
~210 `connect([])` stream assertions, the Playwright specs over 11 examples, the Mode-A perf
gates, and fero-v2 itself) becomes a machine-checkable parity gate that the new kernel must pass
**before** it earns each subsystem.

Everything below is written to be executable on Monday: exact record shapes, module layout,
per-phase machine-checkable gates, and honest answers to what the facade forecloses and when it
is finally broken.

---

## 1. Thesis and positioning

**The bet.** data's defensible position in 2026 is the vertically-integrated combination the
landscape audit identified: a closed keyed delta engine + a per-key surgical no-vdom DOM sink +
an optional columnar/Arrow acceleration tier — O(Δ) from the write to the paint. Each pillar in
isolation now has a stronger incumbent (TanStack DB at the data layer, Vue Vapor/Solid at the
render layer, DuckDB-WASM/Mosaic at large-N analytics); the combination has none. The rewrite's
job is to keep both existing pillars *winning* while replacing the architecture that caps them
— and the only rewrite strategy that provably cannot lose the pillars mid-flight is one where
the old engine remains shippable and the new one must beat it gate-by-gate.

**How this answers TanStack DB.** TanStack DB ships a generic differential-dataflow IVM with
joins and sync, feeding React re-renders at the component boundary. We do not race it to
feature parity in v3.0. We match its *correctness architecture* (closed keyed delta algebra —
§2 — which deletes our C-series the way d2mini's Z-sets delete theirs), keep our *per-operator
tuned hot paths* (between's brush walk, the bounded-window reconcile, bitmask set algebra —
ported, not rediscovered, §4), and keep the one thing it structurally lacks: the renderer.
TanStack DB's 0.7ms sorted-100k update still becomes a React render; our keyed DOMSink turns
the same delta into one `insertBefore`. Joins, optimistic transactions, and sync sources are
scheduled as **additive 3.x releases on the new kernel** (§4, §7) — they are one operator and
one SourceBacking each on a keyed algebra, and they would be architecture work on the v2
protocol. We add TanStack DB to the benchmark peer set in Phase 0 so the claim is measured, not
asserted (§12).

**How this answers DuckDB-WASM/Mosaic.** We don't compete on raw scan throughput at 10M rows —
a SQL engine with data-cube indexes wins that. The columnar findings (63–500× headroom in
`experiments/wasm/results-altbackend.md`; "columnar JS captures ~all the gain, WASM adds
0.5–2×") are banked as a **tier, not a foundation**: the kernel's storage seam (SourceBacking,
§7) is designed so a maintained-columns backing (typed-array columns + validity bitmask +
key↔slot interning) can be attached per-source in 3.x without touching the delta algebra, and
Arrow tables/DuckDB result sets become *sources feeding the reactive edge* rather than a
territory we contest. Choosing keyed-first storage with a columnar tier — rather than
columnar-first — is the single biggest storage judgment call in this concept, and §2/§9 defend
it.

**How this answers the signals consensus.** The 2026 push-pull/lazy-memo consensus (TC39
Signals, alien-signals, Solid 2.0) standardizes the *scalar* layer. Our collection pipeline is
a push IVM — the same regime as every shipping IVM engine — and stays push. The scalar layer
(aggregates, `.to()`, reactive operator args) gets: equality cut-off at the kernel (no-phantom
discipline, which v2 already has and we keep verbatim), batched post-commit effect delivery
(§2 scheduling — effects never observe mid-cascade state), and a thin `data/signals` bridge
(`toSignal(view)` / `fromSignal(sig)`) as an additive 3.x entry. We deliberately do **not**
adopt lazy pull for collection operators in v3.0: it would break the synchronous
read-after-write contract every committed benchmark, example, and fero's write-capture depend
on (§9, contradiction 1), and push-per-batch is what IVM engines do anyway.

**What the strangler uniquely buys.** (1) The v2 corpus is the spec: every gate is
machine-checkable against a running reference implementation, not prose. (2) There is never a
window where the project has no shippable engine. (3) The long tail is amortized: each operator
family pays its conformance debt *when it ports*, against an oracle built first. (4) fero is
unblocked in weeks, not quarters: its four M0 contract items ship additively on v2 in Phase 0.5
(§7, §14) and survive the engine swap because they are pinned by cross-repo contract tests.
The cost — and this document is honest about it (§14, §15) — is that three structural wins
(namespace separation, non-callable proxy, the v3-native API's honest types) are deferred to a
v4 API break, and the compat facade is a permanent tax until that break lands.

**Both pillars stay load-bearing.** The identity is "beat every peer on incremental-update
workloads AND ship the integrated renderer". Every phase gate (§14) includes named flagship
workloads (crossfilter 231k brush, swarm patch batch, kanban board edit, bounded-za drag) with
a ≤1.10× regression budget against v2's own numbers, and the render phase adds keyed-reorder
identity preservation as a *new* marketable win rather than a parity item.

---

## 2. Kernel architecture

### 2.1 Storage model

**Keyed row store with a separate order channel, plus a dense fast lane.** One storage design
for all three source kinds:

```ts
// kernel/store.ts
class Store<T> implements SourceBacking<T> {
  declare rows: Map<Key, unknown>        // key → row value (the identity substrate)
  declare order: Key[] | null            // ordered sources (arrays, sorted views): position → key
  declare slots: KeyTable                // key → dense int slot (interned, shared down a lineage)
  declare kind: 'array' | 'object' | 'scalar'
  declare scalar: unknown                // scalar sources bypass rows
  // dense lane: when kind === 'array' and keys are all synthetic-sequential,
  // rows is backed by a packed array (values[]) and Map access is bypassed on hot paths.
}
```

- **Object sources**: the key is the property name (normalized string, §10 value-domain).
- **Array sources**: every row gets a **stable synthetic key at ingestion**, minted from a
  per-store monotonic counter through the same injectable seam as today's `$.random`
  (`ctx.mintKey(store)` — tests override it for determinism, preserving the HARD `$.random`
  invariant). `order` holds the key at each position; splice mutates `order` only. **Position
  is never identity.** This deletes, by construction: BR1A/BI0A/BH1/BF0/BMV1, the V1
  shift-refresh, the `owns` guards, RowOperator's four array handlers, the C14/C16 paradox, and
  P7's O(N) aggregate rebuilds (the position→value map that "can't be trusted incrementally"
  no longer exists — the key→value map can).
- **Dense fast lane** (the H7-protecting caveat the audit demands): while an array store's keys
  remain the unbroken synthetic sequence (no mid-removes yet), rows are physically a packed
  `values[]` array indexed by slot, and operators iterate it monomorphically — the flat-array
  hot path that wins the benchmarks. The lane demotes to the Map path on first non-tail
  structural change and can re-densify on rebuild. This is an internal representation switch;
  the delta algebra above it is identical.
- **Nested data**: the store owns the whole tree; child views (`proxy.a.b`) are path lenses
  over the store, not copies. A deep write is one `update` delta with a `path`.
- **Columnar tier (3.x, additive)**: a `ColumnarBacking` implements the same `SourceBacking`
  with Float64Array/dictionary columns + a validity bitmask + the same KeyTable; predicates
  that are IR (§4.3) lower onto columns. It is a backing swap, not an algebra change. Rejected
  alternative: columnar-*first* storage — it makes nested mutation DX (`proxy.a.b.c.update(1)`),
  row identity for the DOM, and the compat facade all materialization problems on day one, and
  the audit's own numbers say columnar-JS-as-a-tier captures ~all the measured gain.

### 2.2 Row identity — exact answers

- **Where stable keys come from for array sources**: minted at the source boundary (first
  `XU0`-equivalent ingestion and every insert), by the store, from `ctx.mintKey` — a
  monotonically increasing integer rendered as a string (`'0','1','2'…` for the dense lane;
  they coincide with initial indices, which makes the facade projection cheap). Keys are never
  re-used within a store's lifetime.
- **Do they survive the wire?** Yes, in the v3 extended record profile (§7): records carry
  `key` (the stable key), and ordered views additionally carry an order channel, so a remote
  consumer can reconstruct both membership and layout losslessly (closing the two documented
  reconstruction gaps in proto/dir). In the **v2 compat profile** they deliberately do NOT:
  fero's shipped ChangeRecord addresses array rows by current index, so the compat projection
  (§13) translates key→current-index through the order channel at emission time. Lossless for
  v2 consumers because it is exactly what v2 emitted; lossy by v2's own design (which is why
  the extended profile exists).
- Keys are interned to dense int slots in a per-lineage `KeyTable` so set-algebra bitmasks and
  columnar masks stay `Uint32Array` operations (porting the measured bitmask win, §4).

### 2.3 The delta algebra — canonical record types

One closed, typed algebra. Update is **first-class and carries oldValue** — not retract+insert.

```ts
// kernel/delta.ts — THE protocol. Everything else is a projection of this.
export type Key = string
export type Path = readonly Key[]            // path *below* the row; [] = whole row

export type Delta =
  | { readonly op: 'add';     readonly key: Key; readonly value: unknown }
  | { readonly op: 'remove';  readonly key: Key; readonly oldValue: unknown }
  | { readonly op: 'update';  readonly key: Key; readonly path: Path;
      readonly value: unknown; readonly oldValue: unknown }
  | { readonly op: 'replace'; readonly value: unknown; readonly oldValue: unknown }   // whole-collection/scalar swap (v2 XU0)
  | { readonly op: 'order';   readonly moves: readonly Move[] }                        // ORDER channel — content untouched
export type Move = { readonly key: Key; readonly from: number; readonly to: number }

export type Batch = {
  readonly src: NodeId          // which upstream emitted — first-class multi-source attribution
                                //   (replaces the optional-`src`-param convention)
  readonly cause: CauseId       // causality id stamped at the root mutation, carried through
                                //   the cascade (devtools one-mutation-one-cascade; fero echo
                                //   suppression: `if (batch.cause.origin === me) return`)
  readonly deltas: readonly Delta[]   // ordered: removes, then adds, then updates, then ≤1 order
  readonly value: () => unknown       // the emitter's SETTLED post-batch snapshot (lazy)
}
```

Design rulings baked into the shape:

- **update carries oldValue** → P3 (reduce BU2 rebuild), C5 (reduce drift auditing), C7
  (distinct representative desync) close by design; every invertible fold is O(Δ) on all paths.
  oldValue is captured at the store (the only writer) — copy-on-write of the touched row for
  nested edits, so the immutable-row crossfilter path pays nothing (its rows are replaced, not
  mutated) and the mutating path pays one shallow row copy per touched row per batch (measured
  in Phase 1's gate; the swarm `patch` workload is the named canary).
- **update is first-class, not retract+insert** → the HARD invariants "rotation emits updates,
  never remove+insert" and "no undefined flash on a rotated child" are representable natively;
  the O(1) in-place edit fast path survives; fero's 4-type record derives losslessly. Z-set
  purity was the rejected alternative: mechanical incrementalization is seductive, but it
  forfeits the flagship mutation benchmarks and forces the compat facade to *reconstruct*
  updates from retract+insert pairs — strictly more risk for zero shipped benefit. We take the
  closed-algebra *discipline* (one shape, exhaustive-switch consumers) without the weight
  semantics.
- **No holes, ever.** Derived views are dense in the kernel; membership travels as add/remove.
  `undefined`-as-excluded-slot, `dense()` helpers, the `i in` bug family, and the
  splice-vs-hole duality are unrepresentable. (The facade re-materializes v2's sparse snapshot
  *shape* for compat consumers — §13 — but no kernel operator ever sees a hole.)
- **No-phantom-events is kernel-enforced at the single emission chokepoint**: the store diffs
  before minting deltas (no-op writes emit nothing; upsert splits add/update by key liveness;
  `value === oldValue` by reference/SameValueZero drops). Sinks never re-derive newness —
  carried verbatim from v2 (HARD, DECISIONS C8).
- **Batch internal encoding**: `deltas` is the *typed view*; internally the hot path builds a
  flat stride-encoded buffer (op-tag + key-slot ints + value refs) per the audit's "type the
  encoding, don't naively objectify" guidance, with the `Delta[]` materialized lazily for
  record sinks and devtools. Operator handlers consume the flat form through generated
  accessors; the conformance kit consumes the typed form. Monomorphic discipline (declare
  fields, all-fields-in-constructor, constant tags) carries over as review rules.

### 2.4 Ordering and top-k over the algebra

Ordering is a **channel, not identity**. Ordered nodes (array sources, `az/za/top/limit`,
`reverse`, `keys/values`) maintain `order: Key[]` plus a `rank: Map<Key, number>` (or a packed
Uint32 in the dense lane); unordered nodes have `order === null` and a documented deterministic
iteration order (insertion order of keys; a removed-then-re-added key appends — this *specifies*
the v2 looseness of `limit`/`distinct`/`keys` over objects so the differential harness asserts
exact equality with zero normalizers, per the tests audit).

Sorted views: a `SortedIndex` — the ported v2 sorted key array, now keyed — maps
column-value→key with binary search; bounded windows keep the ported
`_batchRemove/_batchInsert/_batchUpdate` reconcile: one pass computes the window's new key set,
emits `remove`s for evicted keys, `add`s for entering keys, `update`s for content changes, and
ONE `order` delta for internal rearrangement. Because identity is the key, a window rotation at
the kernel level is honestly a membership change of the *window view*; the **compat projection**
(§13) converts it to v2's content-stable positional `update` records (the C3 contract), and the
v4-native DOM sink consumes the keyed form directly and *moves the element* instead. Chained
windowed sorts compose trivially — a downstream sort consumes keyed membership + content
deltas and ignores upstream order (it imposes its own), deleting the entire
mid-window-splice/tail-splice theorem class.

`between` ports its crown jewel unchanged in spirit: a lazily-resorted `(colValue, key)` index
with dirty amortization and the full-domain alias fast path; a brush walks the index between
old and new bounds and emits O(Δ) membership deltas. No holes, no sort-index renumbering on
splice (keys don't shift).

### 2.5 Scheduling and consistency contract — the pick

**Synchronous two-phase batch commit per outermost write; read-your-writes preserved.**

1. **Commit phase**: the outermost mutation (a single set, a `patch`, or an explicit
   `ctx.batch(fn)`) applies to the store(s) completely; deltas accumulate per node.
2. **Propagate phase**: the scheduler delivers each dirty node ONE immutable `Batch` in
   topological order (graph height, computed incrementally at edge creation; heights are static
   because operator graphs are acyclic by construction and LinkedView re-points recompute the
   affected heights). An operator consumes its batch against *settled* upstream snapshots —
   echo-order choreography, `pendingShift` inference, and mid-cascade sibling reads become
   unrepresentable. Multi-source operators receive one batch per source, tagged by `src`, and
   may consult any source's settled snapshot.
3. **Effect phase**: user-observable sinks (record sinks, tap, DOM, PropSink) run after all
   operator state has settled, in subscription order. A binding can never observe a transient
   mid-cascade `undefined` — the chat/library defensive-binding gotcha class dies.
4. **Re-entrancy**: a write issued from inside phase 2/3 is queued FIFO and drained as its own
   two-phase cycle after the current one completes — v2 `transact` semantics preserved
   verbatim, including per-sink exception isolation, now with `AggregateError` carrying every
   sink failure (§10). The drain queue lives on a per-graph `Context`, not module globals
   (§10 concurrency).

**Read-your-writes, precisely**: when `proxy.x = v` (or `.update(v)`) returns, every derived
view's `[value]` reflects the write — identical to v2, so every committed benchmark tick
(`write; read`) and fero's write-capture semantics are preserved without re-baselining. Inside
a phase-3 sink callback, reads see the fully settled post-commit state (also v2-compatible:
v2's view.value was already written before verbs fired). Inside a `ctx.batch(fn)` body, reads
see the writes applied so far within the batch (the store is mutated eagerly; only
*propagation* is deferred to the batch boundary) — this is documented as the one place batch
semantics are observable. `raf()` remains the opt-in frame coalescer on top.

Rejected alternatives: (a) microtask-deferred flush by default — invalidates the entire
committed benchmark corpus and fero's write-capture, the exact "version-break or re-baseline
everything" the audit warns about; adopt it later, opt-in, per-context (`ctx.scheduler =
'microtask'`) once the kernel is proven. (b) Lazy pull for collections — no IVM engine works
that way and it breaks snapshot-then-deltas connect semantics.

### 2.6 Ownership and lifecycle

**Deterministic owner scopes primary; the v2 GC contract preserved by the facade; finalizers
demoted to a dev-mode leak detector.**

```ts
// kernel/scope.ts
interface Scope extends Disposable {
  readonly id: NodeId
  own(d: Disposable): void
  onDispose(fn: () => void): void
  dispose(): void                     // + [Symbol.dispose] for `using`
}
const root = createRoot()             // per-Context ambient default scope
function scoped<T>(fn: (s: Scope) => T, parent?: Scope): T   // Solid-style owner push/pop
```

- Every derived node and subscription is created under the ambient scope and **strongly held**
  by it; the graph holds sinks strongly. Disposing a scope detaches its subtree synchronously
  (fero M0 item: subscription handles with synchronous detach and strong retention — native).
- `view.connect(...)` returns a `Subscription { dispose(); readonly view }` in addition to
  honoring the v2 arities; operator chaining under a scope is refcounted into the **dedup
  cache** (§4.4), making dedup a deterministic semantic guarantee instead of a GC coincidence.
- **Leak-free-by-default is preserved two ways**: (1) `render()` creates a scope per mount and
  disposes it when the root is disposed/disconnected — the "holding the DOM keeps bindings
  alive" DX survives with the ownership arrow made explicit (the mounted subtree owns the
  scope); (2) for zero-ceremony script consumers on the facade, the compat layer reproduces
  v2's exact WeakRef semantics: a facade sink is pinned to its v2 anchor (the `connect([])`
  array, the PropSink target) via a `FinalizationRegistry` that disposes the underlying kernel
  subscription when the anchor collects. Observable v2 behavior — including every test's
  local-variable discipline — is unchanged; the *kernel* never depends on GC timing.
- Dev build: a `FinalizationRegistry` on kernel nodes warns when a node is collected while
  still subscribed ("undisposed scope leak") — the backstop role the field consensus assigns
  finalizers.

---

## 3. Public API and types

The strangler splits this section in two: the **facade API** (v2's, byte-compatible, the only
public API through v3.x) and the **v3-native API** (shipped as a preview entry `data/next`
during 3.x, becomes primary at v4). Designing the native API now — types first — is what keeps
the kernel honest; shipping it later is what keeps the corpus green.

### 3.1 Facade (v2 API, preserved through v3.x)

Everything in the HARD lists: `$()` callable + `$.random`; ViewProxy with the full dispatch
precedence (built-ins → Operators table → update/insert/remove); `proxy[value]` read/write;
Option B typed writes (`.update/.remove/[value]/.get`); bare assignment accepted at runtime;
three-form `connect` with single-arg throw; `await proxy` snapshot; `toJSON`; `patch`, `raf`,
`first/last/get`; LinkedView `$(view)` swap with the exact throw/cycle semantics; the
`Operators` plain-object table and `Symbol.for('data.*')` registry keys (same keys — safe
because v3.0 *is* the same package presenting the same contracts; §13); `[view].res` exposing
`update/insert/remove` (fero's ingress — backed by `store.apply`). The facade is a thin
translation layer (`compat/`): traps delegate to kernel nodes; kernel batches are projected to
v2 verb calls and ChangeRecords (§13). One deliberate non-goal: fixing v2's API warts through
the facade — the facade's fidelity IS its value.

### 3.2 v3-native API (`data/next`, primary at v4)

- **Reads**: a non-callable, non-thenable proxy. `store.rows`-style child access keeps proxy
  sugar (`s.users`, `s.users[k].name`) through **cached** child handles (one wrapper per
  (node, key)); honest reflection traps (`has`/`ownKeys`/`getOwnPropertyDescriptor` from the
  snapshot; finite `Symbol.iterator`). Raw read: `s()` is gone; `s.get(k)`, `snap(s)` (exported
  function, not a property — nothing collides), and `[value]` retained for continuity.
- **Namespace separation** (the collision fix): operators and built-ins live on a real
  prototype consulted *before* the child-minting get trap, and — the key change — **data keys
  are always reachable** via `s.get(key)`/`s.row(key)`, so a column named `filter` is
  inconvenienced, not unreachable. Method access never mints ghost child views. `await s` is
  removed (loud v4 break; codemod: `await s` → `snap(s)`).
- **Writes**: methods-only, matching Option B — `s.update(v)`, `s.set(k, v)` / child
  `.update(v)`, `.remove()`, `s.insert(v, at?)`, `s.patch(pairs | partial)`, `s.apply(record)`
  (the public ingress). Bare assignment and `delete` are dropped from the native proxy (they
  remain on the facade forever-until-v4), closing the types-accept/runtime-accept rift in the
  only direction the type system can express (the audit's Option B post-mortem: asymmetric
  get/set is inexpressible — so make the runtime match the types instead).

### 3.3 Core generic types (v3 equivalents of Data/DataOps/ChangeRecord)

```ts
// kernel/types.ts — authored FIRST, zero runtime imports, the compile target for everything
export interface View<out T> {                       // covariant READ surface
  readonly [value]: T | undefined
  connect(anchor: object, fn: (r: ChangeRecord) => void): Subscription
  connect(anchor: ChangeRecord[]): ChangeRecord[]
  connect(anchor: object, prop: string): Subscription
  get<K extends RowKey<T>>(k: K): View<RowOf<T, K>>
  // + the operator surface, MERGED per operator module (see 3.4)
}
export interface Source<T> extends View<T> {         // WRITE surface
  update(v: T): void
  insert(v: RowOf<T>, at?: number | Key): Key
  remove(k?: Key): void
  patch(pairs: readonly unknown[]): void
  apply(rec: ChangeRecord): void                     // the public record ingress (fero M0)
}
export type Row<T>   = /* Children<T> successor: object children are View<T[K]>,
                          leaf children are View<T[K]> & Source<T[K]> lenses */
export type ChangeRecord =                            // data/ir — SCHEMA_VERSION'd, §7
  | { type: 'update' | 'insert' | 'remove'; key: string[]; value?: unknown;
      oldValue?: unknown; at?: string | number }
  | { type: 'move'; key: string[]; from: number; to: number }
```

Kind-splitting (arrays/records/scalars get distinct op sets, honest `map`/`group` returns,
scalars lose collection ops) is done in `Row<T>`/per-operator signatures, reusing the v2
lessons the types audit pins (hover-name preservation, `length(fn)` → `Record<R,{value:number}>`,
ColOf fallbacks, the negative-fixture gate — all carried).

### 3.4 Operator dispatch — no more universal-namespace collisions (natively)

Each operator is defined **once** as a typed registry entry; both the runtime dispatch and the
method surface type derive from it:

```ts
// operators/filter/index.ts
export const filter = defineOperator({
  name: 'filter',
  signatures: null as unknown as {           // the TYPE side — merged into View<T>
    <T>(this: View<T>, fn: (row: RowOf<T>, key: string, old?: RowOf<T>) => unknown): View<T>
    <T, K extends ColOf<T>>(this: View<T>, k: K, v?: Reactive<ColValue<T, K>>): View<T>
    <T>(this: View<T>, shape: FilterShape<T>): View<T>
  },
  dispatch(args): OpSpec { /* shape → variant, the register.ts logic, in one place */ },
  create(node, spec): OperatorNode,
  dedupKey(spec): string | null,             // §4.4 — null = never dedup (opaque fn)
  descriptor: { category: 'rowop', declarative: true },   // fero capability descriptor, §7
})
declare module '../kernel/types.ts' { interface View<out T> { filter: typeof filter.signatures } }
```

`tsc` now checks the implementation against the declared signatures (the `create` function is
typed by the same entry), killing the four-parallel-places drift and the single `as Dollar`
trust point. The facade's `Operators` table is *generated* from the registry (same own-keys
shape fero probes). **Static installation**: importing `data` imports the operator modules,
whose `defineOperator` calls install into the registry at module scope — but because the
registry is module-scoped (not globalThis) and entries re-export it, tsup `splitting: true`
with one shared kernel chunk becomes safe, collapsing the 8× bundle duplication (§10). The
`data/lean` entry survives as "core + `use(...)`" for tree-shakers.

### 3.5 Types designed first, verified against the runtime

Phase 0 lands `kernel/types.ts` + `kernel/delta.ts` as pure type/contract modules and the
conformance kit compiles against them with `noCheck: false` before any kernel runtime exists.
The v2 fixture-gate discipline carries over wholesale: positive + `@ts-expect-error` negative
fixtures per entry, colocated per operator; the export gate pins nameability. New: a
**protocol exhaustiveness gate** — every sink in-tree is written as an exhaustive `switch` on
`Delta['op']` (or explicitly declares a capability subset via `interface SinkCaps`), so
"ignored a verb" is a compile error, replacing the prototype-vs-presence fork.

### 3.6 JSX/builder typing

The intrinsics single-source-of-truth (`jsx/intrinsics.ts`) is kept and both transforms stay
aliased to it. The builder gets tag-level typing (`Builder` keyed off `keyof IntrinsicElements`
with the string fallback for class-chains) — the audit's patchable item, done during the render
port. The native ordered-children AST (§5) gives JSX a direct mapping; the facade keeps the
shape-heuristic dispatch (with its regression tests) until v4.

---

## 4. Operator model

### 4.1 Family-by-family mapping onto the kernel

| v2 family | v3 kernel form | ported IP | expected delta |
|---|---|---|---|
| `filter`/`gt/lt/gte/lte` | `RowOp`: per-key membership map; `process(row, key, old) → value \| SKIP`; emits add/remove/update from membership flips | RowOperator's process-returns-undefined shape (renamed SKIP sentinel so `undefined` becomes a legal row value) | one code path replaces object+2 array paths; O(1) per BU2-equivalent unchanged |
| `between` | SortedIndex consumer: `(colValue,key)` index, lazy resort, bounds walk | the entire brush walk + full-domain alias + dirty amortization | index maintenance no longer pays splice renumbering; threshold-change stays O(Δ log n) |
| `az/za/top/limit` (windows) | OrderedView: SortedIndex + window reconcile, emits membership + content + ONE order delta per batch | `_batchRemove/_batchInsert/_batchUpdate`, content-stable rotation (as a compat projection rule), BMV1→`order` moves | key→rank map replaces `sorted.indexOf('' + id)` O(N) lookups for free |
| `group(fn)`/`length(fn)` | key→bucketKey map + bucket stores; update deltas with oldValue rebucket in O(1) | the BU2 rebucket fix semantics; divergent bucket contracts kept: `length(fn)` persists `{value:0}`, `group` prunes (both re-asserted by the oracle) | array-source group/length become fully incremental (P7 closed) |
| `sum/avg/max/min/some/every` | fold nodes; oldValue makes update O(1) for sum/avg/some/every; max/min keep a sorted multiset (or v2's recompute-on-evict — measured in the port gate) | empty-set semantics verbatim (avg/max/min→undefined, sum→0, some→false, every→true); NaN-poisoning verbatim (fero wire contract) | array-source aggregates O(Δ) (P7 closed); the aggregate Float64Array fast lane re-lands on the dense lane |
| `intersect/union/except` | per-source membership bitsets over the shared KeyTable; fold bits by KEY on each source's batch | the per-instance bitmask design (SharedMembership's 16%-slower lesson honored); intersect `matches()` dedup | C12/C13/C14/C15/C16 unrepresentable; independent-array intersect defined via the position-key adapter (§4.2) |
| `map/to/reduce/tap` | map = RowOp; `to` = whole-snapshot recompute (unchanged semantics) with an IR-incremental upgrade path; reduce 3-arg threads oldValue (P3 closed), `assertPlainInit` kept, `$.debug` re-fold kept as dev-mode; tap keeps the dual clone/bare path and `tapHasParam` source inspection verbatim | tapHasParam; reduce reference-cache deleted (obsolete) | reduce O(Δ) on nested edits — new win |
| `keys/values/reverse` | order-channel consumers (trivial: project `order`/`rows` through) | — | incremental for free (the 135ms/92ms batch stragglers die) |
| `distinct` | first-seen representative per value-key, oldValue-driven migration; deterministic order per §2.4 spec | — | P5 narrows (remove-churn now O(Δ) via oldValue) |
| `limit(n)` | first n of the order channel (deterministic for objects now, spec'd) | the incremental array paths' semantics | object-limit history-dependence gotcha deleted (documented tightening) |

### 4.2 Set algebra over independent arrays (the C14/C16 ruling)

Kernel set algebra correlates **by key**. Derived facets share their source's keys — the
shipped crossfilter shape is trivially correct. For *independent array* sources (v2's
positional intersect), v3 defines the semantics explicitly: `intersect(a, b)` over unrelated
arrays routes each source through a `positionKeyed()` adapter (key = current position, derived
from each source's order channel; a structural change re-keys the shifted range, O(shift)).
This makes the v2-ambiguous case *well-defined and documented as positional*, closes C14
(a tail insert re-keys and re-evaluates that position across sources against settled
snapshots) and C16 (no primary/secondary echo distinction exists — every source's batch folds
into by-key membership), at a stated cost: independent-array set algebra is O(shift-range) on
structural changes, same as v2's best case, and the docs keep steering to object-keyed sources.

### 4.3 IR vs closure policy for argument slots — the CSP answer

- **Closures remain a first-class, permanent argument form.** They are the v2 corpus, the
  facade's bread and butter, and the escape hatch for genuinely opaque logic.
- **IR (`ExprNode`) becomes an additive, equal-rank argument form in 3.x** (Phase 6):
  `filter({and: [{eq: ['region', 'EU']}, {gt: ['value', 100]}]})` — the proto/dir grammar,
  promoted. Operators store the IR node when given one (`op.node`), enabling value-keyed dedup,
  wire serialization, and columnar lowering. The closure form is *not* silently compiled to IR
  in v3 (no reliable JS→IR lifting; don't pretend).
- **CSP policy**: the Layer-0 interpreted tree is the *guaranteed* execution tier — pure JS,
  CSP-safe, correct-by-parity (the proto's 20k-step fuzz methodology re-run in-tree). `compileJS`
  (`new Function`) is an opportunistic tier: feature-detected once per Context
  (`try { new Function('') } catch { csp = true }`); under CSP the interpreter runs and a
  dev-mode note explains the ~4–5× predicate gap (12× tree vs 2.5× compiled, from RESULTS.md,
  and the tree tier gets the row-null guard compileJS currently omits — hardening item). WASM
  kernels are CSP-relevant too (`wasm-eval`); they live behind the columnar backing only and
  degrade to the JS columnar loop, which the alt-backend numbers say captures ~all the gain.

### 4.4 Dedup policy — the contradiction resolved

One rule, stated once, enforced by the registry:

> **An operator call dedups iff its arguments have value identity.** Concretely:
> `dedupKey(spec)` returns a canonical string for IR args, literal values, column names, and
> reactive args (keyed by bound *node id* — the `arg[view]` identity semantics, preserved
> exactly); it returns `null` for any spec containing an opaque function, and `null` never
> dedups — fresh per call, preserving the v2 contract that two taps/filters with distinct
> closures (or even the same closure reference) are independent.

The cache is per-source-node, refcounted by owner scopes (§2.6) — deterministic, GC-free.
Under the facade the same v2 `matches()` list holds (between/compare/sort-all-forms/intersect/
aggregates/distinct/reduce dedup; filter/map/length/group/to/tap/union/except/keys/values/
reverse fresh — union/except *gain* dedup only in native mode, since v2 tests pin freshness).
The kanban-class pileup is fixed for closure-heavy code not by breaking freshness but by
deterministic disposal: re-pointing a `$(view)` swap under a scope disposes the abandoned
chain immediately instead of waiting for GC. Explicit opt-in sharing: `shared(fn)` wraps a
closure with a value key for callers who want dedup on a function arg.

### 4.5 New operators and their cost

- **`join` (3.x, the TanStack answer)**: `a.join(b, onA, onB, project?)` — two key→joinKey
  maps + a hash index per side; O(Δ × matching fan-out) per delta; ~500 lines + oracle +
  bench. Only sane on keyed identity — this is the concrete payoff of the kernel.
- **`flatMap` (3.x, cheap)**: RowOp emitting multiple keyed rows per source row (child keys
  suffixed); ~150 lines.
- **`page(size, cursor)` (3.x)**: an order-channel window with a reactive offset — subsumes
  the library example's repage pattern; ~100 lines on OrderedView.
- **Optimistic mutation/transactions**: NOT an operator — `ctx.batch` + the `apply` ingress +
  a cid-overlay is fero's/app-land's (fero plan-v3 §5 already designs it client-side). We ship
  the ingress and the batch primitive; we do not grow a transaction manager (scope guard, §15).

---

## 5. Render layer

**Keyed reconciliation, co-designed with the kernel (it is the reason the protocol carries
keys).**

- **DOMSinkV3**: one `Map<Key, RowBinding>` per list binding. `add` → create row under a fresh
  row scope, insert at the order position; `remove` → dispose row scope (which removes
  listeners — `removeEventListener` exists for the first time — and drops Prop subscriptions),
  remove element; `update` → per-key Prop surgical writes exactly as today (the
  structure/content split — DOMSink does rows, each Attr/Class/Style/Text Prop has its own
  subscription — is the crown jewel and carries over intact); `order` → real `insertBefore`
  moves. **Element identity survives reorders**: focus, selection, CSS transitions, scroll
  anchoring survive; kanban/chat's `data-id` workaround becomes unnecessary (kept working);
  JSX `key` finally means something (it overrides the row key when provided).
- **Ownership integration**: `render(el, template)` returns `Mount { dispose(); el }` (el for
  back-compat: the facade's `render` keeps returning the parent, with the mount scope owned by
  an element expando so the v2 "DOM alive = bindings alive" contract holds; devtools' element→
  sink back-channel — the `__ripple_sink` contract — is preserved as a registry-backed
  equivalent so `$.fromDOM` keeps working). The detached-parent bail becomes a dev-mode
  assertion instead of the teardown mechanism.
- **Children/AST model — killing the single-static-slot trap**: the template node holds an
  **ordered children list** of explicit kinds:
  `type Child = Static(text) | Reactive(view) | Element(node) | Rows(view, rowFn, key?) |
  Conditional(view|fn, child)`; props/options travel in a distinct typed channel (so `key`,
  event options `{passive, capture, once}`, and future args have an unambiguous home).
  `<span># {cur}</span>` renders `"# general"` — positional order preserved; multiple statics
  coexist. The builder maps onto the same AST; the JSX transform becomes a direct mapping.
  The v2 heuristics (`hasRowFn` excluding element siblings, lone-VP→text, on[A-Z]-and-not-VP)
  are preserved *behaviorally* through the facade AST adapter and its trace-equivalence tests,
  and retired at v4.
- **Component model**: components stay plain functions, now invoked under an owner scope with
  `onCleanup(fn)`, `context(key)` (a tiny scope-carried map), and an optional error boundary
  (`boundary(fn, fallback)` — phase-3 effects run inside it). No lifecycle framework beyond
  this — scope guard.
- **SSR stance: OUT of v3.0, seam reserved.** The audit's own render critique flags SSR demand
  as the least-proven structural item (no example or issue asks for it). We design the
  instantiation pass target-agnostic anyway — `materialize(target: DOMTarget | StringTarget |
  HydrateTarget)` is the internal seam the ownership rewrite already forces — but only
  `DOMTarget` ships in 3.0. `renderToString`/hydrate become a 3.x/4.x decision taken with
  demand evidence, not built speculatively. Rejected alternative: shipping SSR to match the
  signals frameworks — it drags a compiler-and-streaming scope war into a rewrite whose thesis
  is de-risking.
- **a11y/focus policy under reorder** (new, explicit): (1) element identity preservation makes
  focus/selection survival the default; (2) if the focused element's row is *removed*, focus
  moves to the nearest surviving sibling row's equivalent element if a `focusPolicy` prop asks
  for it, else browser default; (3) surgical text updates into `aria-live` regions are
  documented (one text-node write per change — polite regions behave correctly); (4) the row
  container sets no ARIA magic — templates own semantics; (5) reduced-motion: `order` moves
  expose a `data-moved` attribute hook rather than built-in animation. These become Playwright
  assertions in the render phase gate.

---

## 6. Devtools contract

The core ships reflection natively; the panel mostly survives as a consumer.

- **Creation-time registry** (`kernel/registry.ts`): every node (store, operator, sink, scope,
  link) registers `{ id: number, kind, method?: string, args?: string /* summarized at the
  dispatch chokepoint, which has them in hand */, parents: number[], scope: number,
  createdAt }`. Held via WeakRef + FinalizationRegistry pruning (observation must not leak),
  keyed by stable numeric id so graphs are serializable/postMessage-able (unlocking the
  remote/extension frontend the current design can't support). Deletes walk.ts, the panel's
  parallel walkGraph, METHOD_OF ctor-archaeology (~1,000 lines), and makes devtools
  minification-safe.
- **One dispatch observation hook**: the scheduler's single delivery chokepoint calls
  `registry.observer?.(nodeId, batch)` — one nullable check when disabled (meeting the v2
  perf-gate bar: off ≈ zero, idle = one boolean). `batch.cause` gives exact one-mutation-one-
  cascade attribution (no microtask coalescing heuristic), uniform scoping semantics for
  trace/profile/cascades (gate by cause origin, reproducing the cascades gate-at-start
  semantics deliberately), and self-time vs inclusive-time from the delivery stack.
- **What survives of the panel**: the seven-helper `$` surface and shapes ($.inspect/graph/
  fromDOM/highlight/trace/profile/cascades) are preserved API — reimplemented over the
  registry (thin adapters; the Playwright panel suite is the gate). The 2,523-line panel itself
  is scheduled as a **subsystem-local rebuild** (dogfooding the library via internalRoot) in
  Phase 4, explicitly *not* on the kernel's critical path — per the devtools critique's ruling.
  `__ripple_sink`-equivalent element back-channel: kept (registry id on the element expando).
  Reversibility/off-state perf specs carry verbatim.

---

## 7. Seam and sources

**The seam is the kernel's skin, not an adapter bolted on later** — but sequenced so fero is
never blocked on the rewrite.

- **SourceBacking** (from proto/dir PLAN.md, now the actual base of `Store`):

```ts
interface SourceBacking<T = unknown> {
  snapshot(): T | undefined
  read(key: Path): unknown                       // local resolution (remote handles are fero's)
  apply(rec: ChangeRecord): void                  // THE public write/record ingress
  subscribe(s: SinkFn, opts?: SinkOpts): Subscription
}
type SinkOpts = { profile?: 'v2' | 'extended'; clone?: boolean }
```

  The in-memory `Store` is the default implementation; fero's distributed backing, a future
  `ColumnarBacking`, `AsyncBacking`, and `PersistBacking` plug in underneath the same operator
  pipeline. The operator pipeline never knows.

- **fero M0 contract items — shipped EARLY, on v2, in Phase 0.5** (this is the strangler's
  killer move; three of the four are additive on v2 per the seam critique, and shipping them
  first means the cross-repo contract tests pin behavior *across* the engine swap):
  1. **Public record-apply ingress**: `proxy.apply(rec)` / exported `applyRecord(proxy, rec)` —
     wraps the existing `res.update/insert/remove`; fero deletes its 5 `[VIEWSYM].res`
     reach-throughs.
  2. **Non-cloning sink mode**: `connect(anchor, fn, {clone: false})` — recovers fero's
     measured 30–40% clone tax now; on the kernel it becomes the `clone` SinkOpt (default
     remains clone-on-emit for v2 profile; extended profile defaults to lazy clone-on-read).
  3. **Subscription handles**: `connect` returns a disposable handle (additive — the return
     already exists for `connect([])`; the handle wraps it) with synchronous detach.
  4. **Versioned re-entrancy/timing contract**: a `TIMING.md` + executable contract test suite
     (write-during-cascade ordering, snapshot-then-deltas, echo timing) committed in data and
     run against data HEAD in fero's CI — the c870bde class becomes a red test, not archaeology.
     The kernel adds `batch.cause` provenance so fero's echo suppression becomes
     `rec.cause !== mine` (declarative), with the boolean-latch pattern still working meanwhile.
- **`data/ir` entry** (Phase 0.5, additive, from PLAN.md Steps A–C): `SCHEMA_VERSION = 3`;
  the freshly-authored `ChangeRecord` (`update|insert|remove|move`, `value?`, `oldValue?`,
  `at?`, extension point `& { origin?, seq?, epoch? }`); `foldSnapshot`
  (the snapshot applier, renamed so it can't be confused with fero's live applier);
  **capability descriptors** generated from the operator registry
  (`{ category: 'rowop'|'aggregate-decomposable'|'holistic'|'iter', declarative }`) — fero
  deletes DECOMPOSABLE/HOLISTIC; an exported **`Builtins`** set — fero deletes its stale
  hardcoded BUILTIN list (which already misses `get`). `data/ir` imports no engine, no
  symbols — pure, wire-safe, cross-version-safe. This is also the **versioned machine-readable
  package contract**: the registry emits `api-manifest.json` (operator names, signatures,
  dispatch shapes, builtins, descriptors, SCHEMA_VERSION) from which llms.txt/AGENTS.md/
  context7.json/cli GUIDANCE/README tables are generated with a CI drift check — closing the
  four-artifact drift the packaging audit documents.
- **Wire profiles**: the **v2 profile** is the shipped 4-type ChangeRecord, emitted by the
  compat projection, lossless for every current consumer. The **extended profile** adds
  `move`, `oldValue`, stable keys, and order — closing proto/dir's two documented
  reconstruction gaps (hole-vs-splice, move-with-value) by *not having holes* and carrying
  moves natively. fero rides `WireRecord = ChangeRecord & {origin, seq, epoch}` per its plan.
- **Async/streaming sources** (3.x, additive, designed now because scheduling interacts):
  `fromAsync(input: Promise<T> | AsyncIterable<Delta[] | T> | ReadableStream, opts)` returns
  `{ data: View<T>, status: View<'pending'|'ready'|'error'>, error: View<unknown>, cancel() }`.
  Status is a *sibling scalar view*, not an in-band sentinel (no undefined-overloading
  regression). **Coalescing policy**: incoming records buffer and commit as ONE kernel batch
  per macrotask by default (`opts.coalesce: 'task' | 'raf' | 'sync' | {ms}`), so a
  faster-than-frame feed costs one cascade per frame — the generalization of what race.js and
  raf() hand-roll today. Electric shapes, WebSocket feeds, and DuckDB-Arrow readers are thin
  adapters over `fromAsync`/`SourceBacking` in separate entries (`data/sources/*`), not core.
- **Persistence/local-first stance: HOOK, not feature.** `SourceBacking.apply` + the extended
  record stream + `foldSnapshot` are exactly a changelog interface; an IndexedDB/OPFS
  `PersistBacking` (snapshot + record log + compaction) is specced as a 3.x entry
  (`data/persist`) with undo/redo as a consumer recipe (the flow essay's marketed dividend gets
  an honest home). Full local-first sync (merge semantics, conflict) is explicitly fero's/
  Electric-adapter territory — decided out of data (§15 scope guard).

---

## 8. The five open questions — explicit answers

**Q1 — Storage & row identity.** Keyed row store (Map + interned KeyTable) with a separate
order channel and a packed dense lane for unbroken synthetic-key arrays; columnar
typed-array storage is a 3.x SourceBacking tier behind the same algebra, not the foundation.
Synthetic keys are minted at the source boundary by the store via the injectable `ctx.mintKey`
(deterministic in tests, monotonic, never reused). Keys survive the wire in the extended
profile; the v2 compat profile projects key→current-index through the order channel (lossless
for v2 consumers by construction). Ordering/top-k live in dedicated order-channel operators
(SortedIndex + window reconcile — the ported v2 algorithms) that emit keyed membership/content
deltas plus one order delta; nested-mutation DX is preserved because the row store owns the
tree and child proxies are path lenses (columnar materialization only ever sits *under* a
backing, where rows are reconstructed on read).

**Q2 — Delta algebra & compat line.** The canonical delta is the closed five-op union in §2.3:
`add | remove | update | replace | order`, where **update is first-class and carries both
value and oldValue** (path-scoped for nested edits) — not retract+insert. Emission invariants
preserved verbatim: no-phantom-events (kernel-enforced at the single chokepoint),
snapshot-then-deltas on connect, removes-before-adds (now structural: batch ordering rule),
rotation-emits-updates (as a compat projection rule for windowed sorts; natively a keyed
membership change + order move that the v4 DOM sink turns into an element move). Explicitly
version-broken: nothing at v3.0 — fero's `{type, key, value, at?}` shape is a **lossless
profile** of the algebra, emitted by `compat/records.ts`, with `oldValue` and `move` as
*additive* fields under `data/ir`'s SCHEMA_VERSION 3; the sparse-undefined public value shape
survives only in facade snapshots and is documented as a facade artifact scheduled to die at
v4 (a welcome, loudly-versioned break).

**Q3 — Scheduling & consistency.** Synchronous two-phase batch commit per outermost write:
commit the whole logical mutation to settled state, then deliver one immutable batch per node
in topological (height) order, then run user effects; re-entrant writes drain FIFO
(v2-transact-compatible), all on a per-graph Context. **Read-your-writes is preserved exactly**
— when the write returns, every view reflects it — so the benchmark corpus, examples, and
fero's write-capture need no re-baselining; what changes (strictly for the better, invisible
to the contract) is that operators and sinks never observe mid-cascade state, deleting the
emission-order theorems and the transient-undefined gotcha class. Glitch-freedom comes from
static heights over an acyclic graph, not graph coloring (collections are push; there is no
lazy memo layer in v3.0 — the signals-style push-pull scalar layer is an additive 3.x bridge).
The timing contract is versioned and executable (TIMING.md + cross-repo contract tests, fero
M0 item 4).

**Q4 — API surface & lifecycle.** Two-stage: through v3.x the public API **is** the v2 surface
(callable/thenable ViewProxy, `Operators` table, `$`, Option B writes) served byte-compatibly
by a compat facade over the kernel — that is the strangler's core trade, and it forecloses the
namespace-collision and callable-proxy fixes until v4 (stated honestly in §14). The v3-native
API ships in parallel as `data/next` during 3.x and becomes primary at v4: a non-callable,
non-thenable cached-child proxy with honest reflection traps, methods-only writes
(update/set/insert/remove/patch/apply) matching Option B so types and runtime finally agree,
operators on a real prototype generated from the typed registry (dispatch and types from one
definition), and `get(key)` as the universal data-key escape hatch. Lifecycle: deterministic
owner scopes are primary in the kernel (subscriptions and operator-cache entries refcounted,
`dispose()`/`Symbol.dispose`, render mounts own a scope); the facade reproduces v2's WeakRef
contract exactly via FinalizationRegistry-pinned anchors so existing tests/examples/fero see
no change; finalizers otherwise serve only as a dev-mode leak detector. Dedup becomes
deterministic (value-keyed via `dedupKey`, reactive args by bound-node identity, opaque
closures always fresh).

**Q5 — Seam as design center & competitive scope.** The seam is the kernel's skin:
`SourceBacking` is Store's own interface from day one, `data/ir` (SCHEMA_VERSION, records,
foldSnapshot, descriptors, Builtins) is the algebra's public projection, and fero's four M0
items ship **early and additively on v2 in Phase 0.5** so the flagship consumer is unblocked
within weeks and its contract tests pin the seam across the engine swap — fero never needs its
wrap-or-fork fallback. The IR argument form is additive-in-3.x and equal-rank (not primary):
closures never dedup or serialize, IR args do both and lower onto columns; CSP is answered by
the interpreted tier as the guaranteed default with `new Function` codegen as opportunistic.
Competitive scope: v3.0 stays an operator engine + renderer at strict parity; joins,
pagination, `fromAsync` sources, the columnar backing, the signals bridge, and persistence
hooks are named additive 3.x releases on the new kernel; optimistic transactions and sync
merge stay out (fero/adapters own them). The renderer's keyed reconciliation is co-designed
with the kernel — the protocol carries stable keys precisely so the DOM sink can be keyed —
which is the vertically-integrated combo neither TanStack DB nor the signals renderers ship.

---

## 9. Contradiction resolutions

Rulings on the digest's fifteen, load-bearing ones in full:

1. **Sync-settle vs batch-first.** Ruled: keep the synchronous read-after-write *contract*;
   adopt batch-first *internally* (two-phase commit per write, §2.5). The observable contract
   every benchmark/example/fero tick depends on is "write returns ⇒ reads settled" — that is
   preserved; the thing the batch-first camp actually needs (sinks never see half-applied
   worlds, one delivery per sink per mutation) is delivered inside the same synchronous frame.
   Microtask/frame coalescing becomes an opt-in per-context scheduler later. No benchmark
   re-baseline required at v3.0.
2. **Update vs retract+insert (Z-set purity).** Ruled: first-class update with oldValue
   (§2.3). The HARD invariants (rotation-emits-updates, no-undefined-flash, O(1) in-place
   edit) and fero's 4-type wire shape are all update-shaped; retract+insert would spend the
   flagship mutation benchmarks to buy a mechanical-incrementalization elegance we can get via
   oldValue. We adopt the closed-algebra discipline, not the weights.
3. **Columnar vs keyed store.** Ruled: keyed is the identity substrate; columnar is a
   SourceBacking tier (§2.1). Render identity, nested DX, the compat facade, and the C-series
   fix all need keys; the 63–500× columnar numbers are real but the same experiments show
   columnar-JS-as-a-layer captures them, and the seam is designed so the tier lands additively.
   The dense fast lane is the down payment that keeps the flat-array hot paths meanwhile.
4. **WeakRef vs scopes.** Ruled: scopes are the kernel's truth; the facade reproduces WeakRef
   semantics bit-for-bit for v2 consumers (FinalizationRegistry-pinned anchors); finalizers
   are otherwise dev-mode leak detection only. "Leak-free-by-default" is preserved in both
   modes (facade: as today; native: mounts/scopes own subtrees and dispose deterministically).
   The loud version-break the audit demands happens at v4, not v3.0.
5. **Dedup policy.** Ruled: one rule — value-identity args dedup deterministically
   (refcounted cache), opaque functions never dedup (§4.4). The seam's "IR dedup for
   filter/map" claim and the operators' "closures must stay fresh" claim were about different
   argument forms; the rule serves both. The kanban pileup is fixed by deterministic disposal,
   not by breaking freshness.
6. **SSR scope.** Ruled: out of v3.0 (demand unproven per the render critique); the
   materialize/bind seam is designed target-agnostic because the ownership rewrite forces
   that shape anyway, so renderToString/hydrate are additive later if demand shows. Scope
   guard over trend-chasing.
7. **Perf-gate slack numbers.** Adopt the crit's verified ~6×–480× range; the 3800× figure is
   excluded from planning. v3 gates move to count-based (H1) primary + relative ratios, §12.
8. **Reactive value-slot typing.** The crit is right — patchable in v2 (covariant readonly-
   [value] marker). Excluded from rewrite justification; ships as a v2-window patch if cheap,
   natively typed in the registry signatures regardless.
9. **Render dense/sparse dual model.** The crit is right: unification is largely done in v2;
   only keyed identity is rewrite-shaped, and it is the render phase's centerpiece. Not
   double-counted.
10. **sideEffects './register.ts'.** Load-bearing for source-path consumers (fero) — kept in
    v2 throughout the window; dissolves at the packaging flip (§10) when registration becomes
    static, with fero moved to the published package first (§13).
11. **Oracle independence.** The crit stands: proto/dir's fuzz compares two library-built
    chains. Phase 0's oracle is genuinely independent plain JS (§11) — written from the docs,
    reviewed against the docs, forbidden (lint-enforced import ban) from importing the
    library.
12. **Devtools rewrite scope.** The crit's ruling adopted: core owes only the registry + one
    observation hook + cause ids (§6); the panel rebuild is subsystem-local Phase 4 work, not
    kernel justification.
13. **CLAUDE.md cross-entry identity sentence.** The code is right, the doc is wrong (C6 fix
    made identity shared via Symbol.for). Fixed in the Phase 0 docs pass; the flow example's
    single-entry rule remains good practice regardless.
14. **Additive seam items spent as rewrite justification.** Honored structurally: data/ir,
    foldSnapshot, descriptors, ingress, non-clone sinks all ship in Phase 0.5 *on v2*,
    which both unblocks fero and removes them from the rewrite ledger. The rewrite case rests
    only on the four cross-cutting inversions (identity, protocol-as-contract, lifecycle,
    scheduling).
15. **C14/C16 framing.** The honest calibration adopted: the residuals are deliberate
    low-severity trades, not fires; the rewrite case is the permanent ~20% reconciliation tax,
    the foreclosed incrementality (P3/P7), and the conformance-matrix growth per new operator.
    Plan narrative and marketing must not overstate the residuals — §15 keeps this as a
    review rule for release notes.

---

## 10. Cross-cutting policies

- **CSP/codegen**: §4.3 — interpreter tier is the CSP-safe guaranteed default; `new Function`
  codegen and WASM kernels are feature-detected opportunistic tiers; no core path requires
  eval. Prototype-pollution: the store's key normalizer rejects `__proto__`/`constructor`/
  `prototype` as own keys at the single ingestion chokepoint (dev throw, prod skip+warn);
  facade set traps route through it. Render layer threat model: text via `textContent`
  (safe), attr/class names validated against `[A-Za-z_:][\w:.-]*` at Prop creation; a
  SECURITY.md + disclosure policy lands in Phase 0 docs; npm provenance/attestation once the
  token is renewed; esm.sh peer loads stay confined to the landing/comparison surfaces with
  pinned versions.
- **Memory budget + measurement**: budgets — ≤96 bytes/row kernel overhead steady-state in the
  dense lane (key string interned + slot + packed value ref), ≤160 via the Map path; ≤1KB per
  operator node + O(rows) state as per-op documented complexity; **zero allocations on a
  no-op write; ≤4 allocations per delivered batch on the hot path** (flat buffer + batch
  object + lazy views). Measured by a new `perf/memory.ts` harness: `--expose-gc` heap-delta
  per 10k writes, retained-size per 1k-row chain snapshot (`process.memoryUsage` +
  heap-snapshot diff in CI-nightly), leak assertions (dispose a scope, assert registry count
  returns to baseline). These run from Phase 1 so the keyed-vs-v2 memory question is data
  before operators port.
- **Error handling + dev/prod split**: typed error taxonomy (`DataError` subclasses: 
  `DispatchError`, `LinkCycleError`, `LegalityError` (dev), `SinkError` wrapper). Phase-3
  delivery isolates per sink and rethrows an `AggregateError` after settle (upgrading v2's
  first-error-only). Dev/prod: `process.env.NODE_ENV !== 'production'`-guarded blocks
  (droppable by every bundler) plus a `data/dev` conditional export; dev-only diagnostics
  convert the gotcha list to warnings — undisposed-node finalizer warning, asymmetric reduce
  remover audit ($.debug promoted), transient-undefined binding deref (impossible natively,
  warned on facade), sparse-read densify hint, key-collision-with-operator-name warning on the
  facade, `LegalityError` from the in-dev legality checker (§11) running on every batch.
- **Value-domain contract** (spec'd in Phase 0, asserted by the oracle): keys are strings;
  numeric keys normalize at the single ingestion point (`1` ≡ `'1'`, killing the four-bug
  coercion family); unicode keys pass through. `null` is an ordinary value everywhere.
  `undefined` written to a row = remove (the v2 leave idiom, preserved and now *specified*);
  kernel stores never contain undefined values; SKIP is an internal sentinel distinct from
  undefined so filter/map can pass through legitimate falsy values. NaN: permitted;
  sum NaN-poisons and avg/max/min follow v2 exactly (fero wire contract, bit-for-bit).
  Date/Map/Set/TypedArray: legal row values (structuredClone-able); functions/symbols as
  values: legal locally, rejected by serialize/wire (fail-closed, from proto/dir). Aggregate
  empty-set semantics verbatim (§4.1).
- **Runtime support matrix + bundle budgets**: ES2022 baseline; Node ≥ 20, evergreen
  Chrome/Firefox/Safari (WeakRef/FinalizationRegistry/structuredClone all in-baseline);
  Deno/Bun best-effort CI smoke; workers first-class (kernel has zero DOM deps; Context
  per realm); SharedArrayBuffer not required (columnar tier works on plain ArrayBuffer;
  worker offload ships copy-based first). Bundle budgets (min+gz, CI-gated size-limit):
  kernel ≤ 12KB, kernel+all operators ≤ 30KB, render ≤ 12KB, full ≤ 48KB, data/ir ≤ 3KB —
  versus v2's 57–190KB per self-contained entry; the win comes from `splitting: true` with a
  shared kernel chunk, enabled by static registration (§3.4). Facade-era packaging keeps the
  current 8-entry map and Symbol.for('data.*') keys; v4 versions registry keys to
  'data.v4.*' when the facade moves to `data/compat`.
- **Concurrency/multi-context**: all cascade state (drain queue, height dirty sets, cause
  counter, registry) lives on a `Context`; `$` binds the default ambient context;
  `createContext()` gives isolated graphs (SSR-someday, workers, tests). Cross-context linking
  throws (a typed error). Module-global today→per-context is a kernel-native property; the
  facade maps the global `$` to the default context so nothing observable changes.

---

## 11. Test strategy

**The kit ships before the kernel. Phase 0 has no engine code at all.**

1. **Change-stream legality checker** (`conformance/legality.ts`): a state machine per
   collection fed every `Batch`: asserts add-only-for-dead-keys, remove/update-only-for-live
   keys, `update.oldValue` === last-known value, order moves in-bounds and permutation-valid,
   batch delta-ordering rule, no-phantom (delta implies snapshot change), and — the killer —
   **replay ≡ snapshot**: fold the emitted deltas into a shadow value and assert deep-equality
   with `batch.value()` after EVERY batch. This is the executable form of the flow essay's
   duality and catches the C8 class (value-right/stream-wrong) on the introducing commit. It
   runs (a) inside every conformance/differential test, (b) in dev builds behind
   `ctx.dev.legality = true`.
2. **Independent plain-JS oracle** (`conformance/oracle/*.ts`): one naive implementation per
   operator (Array.prototype.filter, sort with the *specified* tie-break — comparator then key
   order —, object folds), written against the docs, with a lint-enforced import ban on
   library code. Doubles as the executable operator spec; the value-domain contract (§10) is
   its fixture set. This resolves the oracle-independence contradiction — v2's rebuild-oracle
   shares the implementation; this one cannot.
3. **Generated differential grid** (`conformance/differential.ts`): ops × depth-2/3 chains ×
   {array, object, scalar} sources × the full widened mutation vocabulary (set, nested set,
   insert-mid, remove, patch-batch, leave/re-enter, whole-row overwrite, link re-point) ×
   seeded PRNG (mulberry32, seed+step reporting, negative control — the proto fuzz
   methodology, committed this time) with automatic shrinking to a minimal repro. Small budget
   per-commit, large nightly (`FUZZ_BUDGET`). KNOWN_FAILURES registry with the anti-rot
   fail-on-pass check carries over verbatim.
4. **Sink-conformance kit** (`conformance/sink-kit.ts`): a reusable battery any sink
   implementer (DOMSinkV3, record sinks, fero's, community) runs: feed canonical batch
   sequences (from the grid), assert the sink's externally-observable state (DOM order, record
   stream, mirrored prop) against the oracle projection. The render differential (fake-DOM
   child order ≡ oracle order under the same mutation vocabulary) is this kit applied to
   DOMSink.
5. **Dual-run parity harness** (`conformance/dualrun.ts`) — the strangler's spine: one
   mutation script drives v2-engine and v3-kernel-under-facade side by side; asserts (a)
   `[value]` snapshots deep-equal at every step, (b) ChangeRecord streams byte-equal, modulo
   an explicit **waiver file** where each waiver names the decision record for a deliberate
   difference (e.g. object-iteration-order tightening) and must still pass
   replay-equivalence. Phase 0 runs it v2-vs-v2 (calibration: pins v2's actual streams,
   surfaces any latent looseness as a documented waiver *before* the kernel exists).
6. **Reuse of the existing corpus as the parity gate**: the 63 differential scenarios run
   unmodified (they drive the public API — the facade serves them); all 26 unit suites and
   the ~210 connect([]) stream assertions run against the facade per phase; the Playwright
   corpus (11 examples + landing + devtools panel + jsx suites) gates the render/devtools
   phases; `entry.test.ts`-style packaging guards are extended to the new entries. Every v2
   bugfix during the window must add a case here (the fix flows through the gate, §14).
7. **Cross-repo contract tests**: fero's sink-timing/ingress/clone/handle contract suite
   (Phase 0.5 deliverable) runs against data HEAD in CI both directions — fero's M0
   "substrate gating" demand, satisfied.

---

## 12. Performance strategy

- **Named flagship workloads at risk** (each gets a per-phase gate at ≤1.10× v2 median,
  measured by the existing Mode-A machinery): crossfilter 231k `between→intersect→
  length(group)→za→limit` brush step (between port + set-algebra port risk); swarm
  `pop.patch` 12k-agent frame (oldValue copy-on-write cost is the specific threat — the
  per-touched-row shallow copy must stay under the patch dispatch savings); bounded
  `za('rating', n)` drag (~2ms/step — window reconcile port); kanban board edit
  (filter→az chains + aggregate updates); tap bare-path batch (no-clone fast path);
  `length(fn)` histogram churn; H4 interactive tail p95. H1 deterministic op-counts are
  re-derived for the kernel (projector invocations per insert) and become the **primary CI
  gate** (machine-independent); wall-clock gates stay catastrophe-detectors; H6-style
  relative regression vs history becomes gating (1.5×+3σ) on the pinned-runner numbers only.
- **The facade tax is measured explicitly**: a permanent `facade-overhead` ratio bench
  (kernel-native subscription vs facade ChangeRecord path on the same workload) with a ≤1.15×
  budget; if the projection layer exceeds it, the mirror-as-materialized-value design (§13)
  is the first suspect. The kernel writes its facade-shaped snapshot *as* its node value
  during the strangler window — one storage, not a mirror copy — precisely to keep this tax
  near zero on reads.
- **New peer set**: add **TanStack DB** (collections + live query on the same map→filter→topK
  and crossfilter workloads; also its own sorted-100k-update headline scenario, reproduced
  fairly) and keep the existing nine. Render layer: run **js-framework-benchmark (krausest)**
  locally from Phase 3 (create/replace/partial-update/select-row/swap-rows/remove/append/
  clear) — swap-rows is the keyed-identity showcase v2 structurally couldn't win. Publish
  methodology + designed-for-workload disclosure on the landing page (the fairness item).
- **Memory benchmarks**: §10's harness rows become tracked perf.json rows (heap/1k rows,
  retained/chain, alloc/tick, GC pauses under swarm) — the columnar-tier go/no-go in 3.x is
  made on these numbers plus CPU, not CPU alone.
- **Go/no-go perf gates per phase**: G1 kernel micro (keyed write/read/batch ≤1.2× v2
  equivalents; zero-alloc no-op write proven); G2 per-operator (its Mode-A workloads ≤1.10×,
  H1 counts ≤ v2, differential 10k-seed green) — an operator that misses its gate does not
  flip its flag, and the phase proceeds around it; G3 render (Playwright + krausest local
  ≤1.10× v2, keyed-reorder new-win bench recorded); G5 full sweep + H7 refresh + landing race
  regeneration before the v3.0 flip. Never-widen carries over; the escape hatch is a decision
  record, not a threshold edit.

---

## 13. Migration and compatibility

**The compat facade (what it is, exactly).** `compat/` is ~3 modules: `facade.ts` (ViewProxy
traps + apply-chain precedence + built-ins + `$`/symbols + LinkedView semantics over kernel
links), `records.ts` (batch → v2 verb calls and ChangeRecords: key→index projection through
the order channel; windowed-sort rotation → content-stable positional updates; ArrSink's
skip-undefined-removes rule; structuredClone default with the opt-out flag; removes-before-
inserts ordering), `weak.ts` (anchor-pinned lifetime emulation, `lifetimes` behavior,
FinalizationRegistry disposal). During the strangler window each node's materialized snapshot
IS the v2-shaped value (sparse arrays with explicit undefined for the set-algebra family,
delete-holes for RowOperators, dense for sorts) so `proxy[value]` reads are zero-cost and
byte-compatible; the keyed truth lives in the indexes.

**Codemod inventory — 11 examples**: **zero mandatory changes through v3.x** — they run on the
facade and serve as the regression corpus (their Playwright specs are phase gates). At v4:
mechanical codemods per example — `await proxy` → `snap(proxy)` (grep shows near-zero usage;
examples already read `[value]`), bare-assignment writes → `.update()` (already migrated by
Option B), builder static/reactive text mixing (the AST fixes it, no source change needed),
`render()` return usage (facade-compatible). The examples are then *rewritten deliberately*
onto `data/next` one at a time as showcase work, not as a migration cliff — kanban and chat
first (they showcase keyed reorders). The landing race and perf dashboard regenerate at each
phase flip per the update-artifacts-before-commit convention.

**Codemod inventory — fero-v2** (verified coupling): (1) ~30 files import the source path
`../../data/index.ts` — Phase 0.5 publishes data (token renewal permitting; otherwise a
file: pin) and fero moves to the package specifier + version pin once, before any engine work;
(2) the hardcoded BUILTIN name set (dispatch.ts:358, already stale — missing `get`) → import
`Builtins` from `data/ir` (Phase 0.5); (3) DECOMPOSABLE/HOLISTIC sets → `descriptors` from
`data/ir` (Phase 0.5); (4) the ~5 `[VIEWSYM].res.update/insert/remove` reach-throughs (log,
dispatch, fold + readable mirrors) → the public `apply` ingress (Phase 0.5); (5) the
re-declared ChangeRecord (transport/message.ts) → `import { ChangeRecord, SCHEMA_VERSION }
from 'data/ir'` with `WireRecord = ChangeRecord & {origin,seq,epoch}`; (6) echo suppression:
keep the current boolean latch until the kernel lands, then optionally adopt `cause`
provenance. Net: fero's migration is **front-loaded into Phase 0.5 and additive on v2**, so
the engine swap underneath is invisible to it except through green contract tests.

**Compat shims and lifetime**: the facade IS the v3.x public API — not deprecated, the
product. At v4 it moves to a `data/compat` entry (same code, one import change) supported for
one major cycle (v4.x), then removed at v5. The v2 *engine* is deleted at the v3.0 flip
(Phase 5) after one 3.0-rc cycle where `DATA_ENGINE=v2` remains a runtime escape hatch.

**Version-broken loudly vs preserved**: preserved at v3.0 — everything in the HARD lists
(ChangeRecord shape, connect forms, Operators table, symbols, thenable, sparse snapshots,
WeakRef-observable lifetime, dedup matrix, rotation-as-updates, aggregate edges, NaN
semantics, length(fn)/group bucket contracts, $(view) swap, $.random seam). Broken loudly at
v3.0 (the short list, each with a decision record + release note + waiver entry):
object-iteration-order tightening for limit/distinct/keys/values/reverse (documented-loose in
v2 → deterministic; SOFT per the audit, tightening sanctioned); dev-mode additions (warnings
where silence was); `AggregateError` instead of first-error-only from multi-sink failures.
Broken at v4: callable/thenable proxy, bare-assignment writes on the native API, sparse
facade snapshots, registry key versioning ('data.v4.*'), builder static-slot semantics.

---

## 14. Phasing

**Staged strangler, one repo, no fork. v2 stays trunk-shippable until the Phase 5 flip.**
Engine selection during the window is per-subsystem flags (`DATA_KERNEL=ops:filter,sort` env /
build define), collapsing to the default at each gate. Calendar assumes the current
one-maintainer + Claude-sessions cadence; phases overlap where marked.

- **Phase 0 — the kit (weeks 1–3).** Commit proto/ (filing task). Land `kernel/types.ts` +
  `kernel/delta.ts` (types only), the legality checker, the independent oracle, the generated
  differential grid + shrinking, the sink-conformance kit, the dual-run harness running
  v2-vs-v2 (calibration), SECURITY.md, the value-domain spec, TanStack DB added to bench
  peers. **Gate G0 (machine-checkable)**: legality checker green over v2's streams for every
  grid scenario modulo a reviewed waiver file; oracle-vs-v2 differential green; CI wall time
  ≤ +5 min.
- **Phase 0.5 — fero unblocked + contract surface (weeks 2–4, overlaps).** On v2: public
  `apply` ingress, non-clone sink flag, subscription handles, TIMING.md + cross-repo contract
  tests, `data/ir` (SCHEMA_VERSION, records, foldSnapshot, descriptors, Builtins,
  api-manifest.json + guidance-generation with drift check). fero lands its six codemod items.
  **Gate G0.5**: fero's suite + the new contract tests green against data HEAD; guidance
  drift check green. *(This is also the fero M0 go/no-go evidence — delivered, not promised.)*
- **Phase 1 — the kernel (weeks 3–8).** `kernel/` (store, keys, node graph, scheduler,
  scopes, registry, delta encoding) + `compat/` skeleton + built-ins (connect/raf/patch/
  first/last/get, LinkedView). **Gate G1**: core.test.ts + index.test.ts (non-operator parts)
  green under the facade; dual-run parity on the core mutation vocabulary; kernel micro-perf
  ≤1.2× v2; zero-alloc no-op write; memory harness baseline recorded.
- **Phase 2 — operators (weeks 6–14, overlapping waves).** Port order (risk-ascending,
  each op: oracle → kernel impl → facade dispatch → dual-run + Mode-A gate → flag flip):
  filter/compare → map/to/tap → length/group → aggregates/reduce → keys/values/reverse/
  distinct/limit → **between** → sort windows → set algebra. **Gate G2 per op** (§12); phase
  gate: all 63 differential scenarios green on the kernel, KNOWN_FAILURES empty, full unit
  suite green, full Mode-A sweep within budget.
- **Phase 3 — render (weeks 12–18).** Keyed DOMSinkV3 + ownership + ordered-children AST +
  facade AST adapter; builder/JSX over it; a11y policy tests; krausest local. **Gate G3**:
  render unit + trace-equivalence + ALL Playwright example specs green; krausest ≤1.10× v2;
  keyed-reorder bench recorded; examples visually verified (serve + share link per the
  workflow convention).
- **Phase 4 — devtools (weeks 16–20).** Registry-backed helpers behind the same `$` surface;
  panel adapter; panel rebuild starts (subsystem-local, can trail). **Gate G4**: devtools unit
  specs + devtools/panel/jsx Playwright suites green; off-state perf gate green.
- **Phase 5 — flip + v3.0 (weeks 18–24).** Kernel becomes the only engine; v2 engine behind
  `DATA_ENGINE=v2` for one rc cycle, then deleted; packaging flip (static registration,
  splitting:true, size budgets); perf sweep + H7 + landing regeneration; docs pass
  (PROTOCOL.md v3, CLAUDE.md, the C6 sentence fix). **Gate G5**: everything above
  simultaneously green + fero contract tests + size gates; release notes with the loud-break
  shortlist. Ship **data@3.0.0**.
- **Phase 6 — additive releases (3.1+, ongoing).** IR args + value-keyed dedup; `join`;
  `page`; `fromAsync` + source adapters; `data/signals` bridge; `data/persist` hook;
  columnar SourceBacking tier (memory+CPU go/no-go on Phase-1 harness numbers); `data/next`
  native-API preview. Each gated by its own oracle/bench additions; nothing lands before
  parity (the scope rule).
- **v4 (when `data/next` has real consumers + the examples are showcased on it).** Native API
  primary; facade → `data/compat` (one major cycle); registry keys versioned; the foreclosed
  wins (namespaces, non-callable proxy, honest traps, dense-only snapshots) cash out.

**Foreclosed while the facade lives (honest ledger)**: the universal-namespace collision
(`proxy.filter` still shadows a data key named `filter`), the callable/thenable proxy and its
armor, bare-assignment writes, sparse facade snapshots, the eight-entry packaging (until
Phase 5's flip), lazy-pull scalars as default, and WeakRef-observable lifetime as the
documented contract. None of these block the C-series kill, the perf ceiling work, fero's M0,
or keyed rendering — that is why they are the right things to defer.

**Total calendar cost vs big-bang**: strangler ≈ **5–6 months to data@3.0** (engine swapped,
corpus green, fero unblocked at week 4), then additive 3.x, v4 at ~9–12 months. An honest
big-bang estimate is 3–4 months to "feature complete" plus an unbounded convergence tail the
v2 history says is 2+ months *minimum* (C1–C16 took that with a mature harness), with no
shippable engine in between, fero blocked throughout, and the benchmark story dark. The
strangler's premium (~4–6 weeks of facade + dual-run work) is the insurance that converts the
tail from unbounded to per-phase-bounded.

**Who owns v2 bugfixes during the window**: the same maintainer (one repo, one trunk) under a
written policy: v2 engine files are feature-frozen from Phase 2; P0/P1 fixes land on v2 first
(it is the reference), and **every v2 fix must add an oracle/differential/legality case in the
same change** — the fix then flows through the gate to the kernel automatically. Examples and
docs remain live (they're the corpus). Workflow-agent tree contamination rules from project
memory apply (explicit pathspecs, verify diff authorship).

---

## 15. Risks and mitigations

1. **v3 is slower than v2 on advertised workloads** (the flagship threat). Mitigations:
   per-operator ≤1.10× gates on the *named* workloads (§12) enforced before each flag flip —
   a slow port simply doesn't flip; the dense fast lane + flat batch encoding + monomorphic
   review rules preserve the mechanical wins; the tuned algorithms are ported, not
   re-derived (between walk, window reconcile, bitmasks); the oldValue copy-on-write cost is
   isolated to the mutating path and canaried by swarm/patch; the facade-overhead ratio bench
   caps projection tax at 1.15×. Residual: real — some workload may need kernel-level tuning
   weeks; the phase structure absorbs that as schedule, not as a correctness gamble.
2. **The facade is a permanent tax / v4 never ships** (strangler failure mode). Mitigations:
   the facade is deliberately thin (three modules, snapshot-as-materialized-value so reads are
   free); `data/next` ships during 3.x so the native API accrues consumers and feedback
   *before* v4 is scheduled; the foreclosed-wins ledger (§14) is re-reviewed each minor — if
   v4 stalls, the ledger says exactly what is being paid. Accepted residual: the collision
   and proxy warts remain documented gotchas until v4.
3. **Scope balloons into a framework** (the TanStack-envy threat). Mitigations: the scope
   rule — nothing new before parity; joins/async/persist/columnar are single-page specs with
   named phases and their own gates; transactions/sync-merge/SSR are *written out* (§4.5,
   §5, §7) with the decision recorded, so re-opening them costs a decision record, not a
   drive-by PR. The concept-budget discipline from fero's plan (a fix that adds a mechanism
   instead of deleting one triggers review) is adopted for the kernel.
4. **Dual-engine window burns the solo maintainer** (two hats). Mitigations: the window is
   front-loaded to minimize double-ownership (fero decoupled at week 4; v2 feature-frozen at
   Phase 2; per-op flags mean there is never a long-lived divergent branch — everything lands
   on trunk behind flags); the fix-flows-through-the-gate rule makes v2 maintenance *feed*
   the rewrite rather than compete with it.
5. **The parity gate ossifies v2's accidents** (strangler-specific). The waiver-file mechanism
   is the answer: byte-parity is the default, but any v2 behavior the Phase-0 calibration
   reveals as accidental looseness gets a reviewed waiver + decision record + replay-
   equivalence floor — the gate pins *contracts*, not noise. The tests audit's three
   normalizers are the seed waiver list.
6. **Keyed-store memory regression at scale** (231k×many-views). Mitigations: the Phase-1
   memory harness makes this measured before operators port; key interning + dense lane bound
   per-row overhead; the KeyTable is shared per lineage. If numbers miss budget, the columnar
   tier's priority rises in 3.x — the seam means that's a scheduling decision, not a redesign.
7. **TanStack DB wins the narrative during the window** (market risk). Mitigations: each phase
   ships a *visible* win on the existing product (Phase 0.5: fero + non-clone sinks + the
   contract manifest; Phase 2: P3/P5/P7 closed = new BENCHMARK.md wins; Phase 3: keyed DOM
   identity — focus-preserving reorders — a demoable, krausest-benchmarkable feature v2
   couldn't have); the landing page and per-op BENCHMARK.md refresh per phase per the
   existing conventions, so the public story advances continuously rather than going quiet
   for a year.
8. **Cross-version symbol corruption if a consumer mixes data@2 and data@3** in one tree.
   v3.0 keeps the 'data.*' keys *because* it preserves the attached contracts; the remaining
   hazard (mixed 2.x/3.x trees, first-entry-wins `$`) is mitigated by a dev-mode version
   handshake on the shared registry (each entry stamps SCHEMA_VERSION; mismatch warns loudly)
   — and fully closed at v4's key versioning.

---

*File/module layout summary (target tree):*

```
kernel/    delta.ts  key.ts  store.ts  node.ts  scheduler.ts  scope.ts  registry.ts  types.ts
ir/        index.ts  descriptors.ts  fold.ts  expr.ts(3.x)
compat/    facade.ts  records.ts  weak.ts
operators/ <op>/index.ts (defineOperator entry + kernel impl)  <op>/oracle.ts  <op>/*.test.ts  <op>/*.perf.ts
render/    index.ts (AST + materialize)  dom.ts (DOMSinkV3)  compat-ast.ts
devtools/  index.ts (helpers over registry)  panel/ (phase-4 rebuild)
conformance/ legality.ts  oracle/  differential.ts  sink-kit.ts  dualrun.ts  waivers.json
sources/   async.ts  arrow.ts  electric.ts (3.x)
```
