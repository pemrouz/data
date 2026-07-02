# data v3 — concept "keyed-delta"

**Design stance: correctness by construction, first.** A closed, typed delta algebra over stable keyed rows; the row-object store and the tuned v2 algorithms retained; explicit owner scopes; two-phase batch commit with synchronous read-your-writes; the entire C1–C16 bug class made unrepresentable; the protocol small enough to machine-check from commit zero. Columnar/WASM and IR-first argument slots are opt-in extensions layered on a stable kernel — never kernel preconditions.

Author role: architect of the "keyed-delta" concept. Ground truth: the 22-agent audit digest, PROTOCOL.md, proto/dir/{PLAN,RESULTS}.md, ISSUES.md, fero-v2/plan-v3.md §10, experiments/wasm/results-altbackend.md.

---

## 1. Thesis and positioning

**The bet.** The library's identity — beat every peer on incremental-update workloads AND ship the integrated no-vdom renderer — is not threatened by any single competitor; it is threatened by the cost structure of its own protocol. Sixteen C-series issues, ~506 token-anchored lines of positional reconciliation (~20% of the engine), two permanent paradox residuals (C14/C16 are documented as mutually exclusive fixes), and two foreclosed incrementality wins (P3/P7 blocked on protocol changes) all trace to one decision: **row identity = storage position for arrays**, forcing an open 13-verb protocol where every operator hand-implements splice-shift AND hole-mirror contracts, and every new operator re-derives the contract from prose. The keyed-delta bet is that replacing that one decision — stable keys minted at ingress, ordering as a separate channel, one closed typed delta record — deletes the bug class *by construction*, deletes the ~1,000 lines of shift/hole bookkeeping, makes array-source aggregates O(Δ) (P7), makes invertible folds O(Δ) on nested edits (P3, via oldValue), and does all of this **without gambling the benchmarks**, because the store stays row-objects and the tuned algorithms (between's brush walk, the bounded-window reconcile, bitmask membership) port intact under new plumbing.

What this concept deliberately does **not** bet on: a columnar store as the kernel (the 63–500× headroom is real but it is a *batch-recompute* headroom, orthogonal to the delta pipeline that wins the flagship workloads — it becomes an opt-in `SourceBacking`), a serializable IR as the primary argument surface (CSP and ergonomics make it Tier-2; the arg-slot *shape* is reserved so it layers on without touching operators), or a lazy pull-based scalar graph (2026 consensus, but our aggregates are already O(Δ) incremental, so eagerness is cheap and synchronous read-after-write is a contract the entire benchmark corpus, all 11 examples, and fero's write-capture depend on).

**How it answers the 2026 field:**

- **TanStack DB** ships differential-dataflow live queries (joins, sub-ms over 100k rows, optimistic mutations, Electric sync) with TanStack distribution. We do not beat it as "a client database" — we beat it as the **vertically integrated pipeline**: closed delta engine → per-key surgical DOM sink → O(Δ) all the way to the paint, with no framework re-render boundary in the middle. TanStack DB hands deltas to React and pays the component re-render; we hand keyed deltas to a keyed DOM sink and pay one `insertBefore`/one text write. v3 adds the two features that make the comparison non-embarrassing at the data layer — a keyed equi-`join` operator and first-class async/stream sources — and adds TanStack DB to the benchmark peer set on *their* published workload (sorted 100k-row update). Its IVM core (`@tanstack/db-ivm`, Z-sets, update = retract+insert) also validates our divergence: we keep **update as a first-class verb carrying oldValue**, which preserves the O(1) in-place-update fast path and rotation-emits-updates — the exact places where Z-set purity costs benchmarks (the audit's named regression threat).
- **DuckDB-WASM + Mosaic** owns 10M-row analytics via data cubes + Arrow. We do not compete on scan throughput. v3's answer is the **seam**: Arrow/DuckDB result sets become first-class *sources* feeding the reactive edge (keyed ingress adapter), and the columnar `SourceBacking` extension is where the WASM/SIMD kernels attach later — accelerating our delta pipeline's batch frontier, never posing as a query engine.
- **Signals-consensus renderers** (Vue Vapor, Solid 2.0, Svelte 5) commoditize scalar reactivity and no-vdom rendering — for *scalars and components*. None of them has a collection delta algebra; all of them re-run row templates or diff lists at some boundary. v3 adopts the parts of the consensus that are free wins (explicit owner scopes + dispose, effects never run mid-propagation, equality cut-off everywhere, a `toSignal()/fromSignal()` bridge kept thin against the Stage-1 proposal) and declines the core inversion (lazy pull) with a stated reason: our derivations are incrementally maintained, not recomputed, so laziness buys memo-skips we don't need at the price of a consistency contract we'd have to break.

**The two pillars survive intact and sharpen.** Pillar 1 (incremental-update wins) is protected by porting the algorithmic IP and gating every phase on the flagship workloads. Pillar 2 (the renderer) is *upgraded* from index-keyed to key-keyed reconciliation — element identity survives reorders, `BMV1` becomes a real `insertBefore`, kanban/chat's `data-id` workaround dies — which is precisely the item the render audit called "the single highest-leverage" and which only a core protocol change can deliver.

---

## 2. Kernel architecture

### 2.1 Storage model

**Row-object storage is retained.** The store is keyed, with a packed dense lane so the flat-array hot path that wins H7 benchmarks survives:

```ts
// kernel/store.ts
export type RowKey = number | string
// number  = synthetic key minted at ingress (array-born sources) — monotonic per store
// string  = adopted key (object-born sources) — the property name
// INVARIANT: kernel state is keyed ONLY via Map/Set (never plain-object property tables),
// so 1 and '1' can never collide — the entire string/number coercion bug family
// (sort:521, reduce ''+k, core.ts:930) is unrepresentable. Enforced by a lint rule
// (no computed-property object indexing in kernel/ and ops/).

export class Store<T> {
  declare slots: T[]                 // packed row values (monomorphic array)
  declare slotKey: RowKey[]          // slot → key
  declare keySlot: Map<RowKey, number> // key → slot (identity map skipped while dense)
  declare live: Uint32Array          // validity bitmap over slots (1 bit/row)
  declare nextKey: number            // synthetic key counter
  declare holes: number              // tombstone count → compaction trigger
  get(key: RowKey): T | undefined
  set(key: RowKey, row: T): T | undefined   // returns prev
  del(key: RowKey): T | undefined
  *entries(): IterableIterator<[RowKey, T]> // packed iteration, skips tombstones
  compact(): void                    // repacks slots; keys NEVER change (key→slot remaps)
}
```

- **Removal never shifts survivors.** `del` tombstones the slot (bitmap clear) and unmaps the key. Compaction runs off the hot path (threshold: holes > ½ slots) and remaps `keySlot` — keys are permanent identity, slots are physical detail no operator ever sees.
- **Dense fast lane.** An array-born store starts with `keySlot` as the identity function (elided) and `slots` as the ingested array — setup cost is O(1) adoption, addressing the js-columnar setup finding (v2 setup was 10–28× slower than columnar; adopting the caller's array closes most of that gap).
- **Columnar-ready by accident of layout.** `slots` + `live` is exactly the row-major half of the columnar design; the opt-in columnar `SourceBacking` (§7) replaces `slots: T[]` with per-field typed-array columns behind the *same* `keySlot` map. Nothing above the store changes. This is how the audit's "hybrid asserted in both directions but designed in neither" contradiction gets an actual design: keyed identity is the kernel; column layout is a backing.
- **Derived views do not copy rows.** A filter/between/set-algebra view holds a *membership structure* (a `Set<RowKey>` or per-source bitmask over slots) plus a reference to the upstream store. `view[value]` materializes a **dense** snapshot on read (cached, invalidated per commit). Consequences: the sparse-`undefined` public value shape is gone (versioned break, §13), `dense()` helpers and defensive bindings die, and per-view retained memory drops from O(rows copied) to O(bits).

**Nested writes are path-copied (copy-on-write along the written path).** The kernel applies every write; a write at `key k, path ['a','b']` produces `row' = {...row, a: {...row.a, b: v}}` — O(path) small allocations, structural sharing elsewhere.

- This is what makes **oldValue free**: `prev` is the old row *reference*, untouched, zero clones.
- No-op writes are dropped centrally: `Object.is(leafPrev, next)` at the single write chokepoint — no-phantom-events enforced once, not re-implemented per operator (the v2 discipline at core.ts:670-748, moved to the only place it can't be forgotten).
- Flagship-risk note (this is the one place keyed-delta spends allocation the v2 hot path didn't): v2's `patch` already allocates one fresh object per changed row (CLAUDE.md: dedup-by-reference makes pooled rows a no-op), so the swarm/patch workload is iso-cost. The single-field single-row tick pays one shallow row copy (~O(fields), monomorphic); this is gated in M1 against the per-operator BENCHMARK.md corpus before anything else is built on it (§12, §14). Mitigation if the gate fails: a `wide-row` escape where rows above a field-count threshold store fields in a nested chunk map — decided by measurement, not now.

### 2.2 Row identity — exact answers

- **Where do stable keys come from for array sources?** Minted at ingress by the store: `nextKey++` per inserted row (integers, monotonic per store, never reused). `$([a,b,c])` mints keys 0,1,2 and records the intrinsic **order channel** [0,1,2]. `arr.splice(i,0,v)`-equivalent writes mint a fresh key and emit `add(key)` + `orderInsert(i,key)` — *no survivor is touched*. Object sources adopt property names as string keys. Key minting is injectable per runtime (`runtime.mintKey`, replacing the `$.random` test seam — deterministic tests keep working).
- **Do keys survive the wire?** **Yes, in the native profile; no, in the v2-compat profile.** The native record profile (§7) serializes keys as tagged scalars (`{k: 5}` vs `{k: "5"}` — JSON distinguishes them; the batch header carries the store's `keyDomain`), so fero's log/replay and any remote reconstruction address rows by permanent identity — this is the extension fero's WireRecord already wants. The v2-compat profile re-positionalizes array-source records through the order channel (key path = current index, `at?` for inserts), reproducing v2's exact `{type, key: string[], value, at?}` stream (§13). Synthetic keys are *stable within a store's lifetime and meaningless across stores* — a remote peer adopting a stream re-mints or adopts as instructed by the batch header; identity equality across the wire is by serialized key within one stream, which is all fero's LWW/log needs.
- **Numeric-string collisions:** impossible — keys live only in Maps/Sets, minted in one place, compared by SameValueZero, stringified only at the wire boundary with the domain tag.

### 2.3 The delta algebra — canonical record types

The complete, closed algebra. This is the whole protocol; there is no other verb surface.

```ts
// kernel/delta.ts — SCHEMA_VERSION = 3
export type Path = readonly (string | number)[]

export interface AddDelta<T> {
  readonly op: 'add'
  readonly key: RowKey
  readonly row: T
}
export interface RemoveDelta<T> {
  readonly op: 'remove'
  readonly key: RowKey
  readonly prev: T                    // the removed row — oldValue, always present
}
export interface UpdateDelta<T> {
  readonly op: 'update'               // FIRST-CLASS. Never encoded as remove+add.
  readonly key: RowKey
  readonly row: T                     // post-write row (reference)
  readonly prev: T                    // pre-write row (reference; structurally shared with row)
  readonly path: Path                 // [] = whole-row overwrite; ['f'] = field edit; deeper = nested
}
export type RowDelta<T> = AddDelta<T> | RemoveDelta<T> | UpdateDelta<T>

export interface OrderDelta {                        // the SEPARATE order/rank channel
  readonly op: 'orderInsert' | 'orderRemove' | 'orderMove'
  readonly key: RowKey
  readonly index: number              // position (for move: destination)
  readonly from?: number              // move only
}

export interface ScalarDelta {                       // scalar nodes (aggregates, .to())
  readonly prev: unknown
  readonly next: unknown
}

export interface CommitBatch<T> {
  readonly seq: number                // per-runtime monotonic commit id (causality/devtools)
  readonly origin: OriginToken        // write-origin — fero's echo suppression (§7)
  readonly rows: readonly RowDelta<T>[]      // consolidated: ≤1 delta per key per batch
  readonly order?: readonly OrderDelta[]     // present only if the emitting node is ordered
  readonly scalar?: ScalarDelta              // present only for scalar nodes
}
```

Decisions, with the rejected alternatives:

- **update is first-class and carries `prev` (oldValue).** Rejected: Z-set retract+insert (DBSP/d2mini/TanStack). Reasons: (a) retract+insert forfeits the O(1) in-place-update path and the rotation-emits-updates contract that index.test.ts, fero's log, and the flow essay assert; (b) it forces every counting sink to process two events per edit; (c) the audit names it explicitly as the benchmark-regression threat. What we take *from* Z-sets is the closedness discipline (one delta shape, mechanical composition) — not the weight encoding. `prev` closes P3 (3-arg reduce O(Δ) on nested edits: `remove(prev); add(row)`), C5 (drift becomes mechanically checkable), C7 (distinct's representative desync), and deletes reduce's reference cache and its `''+k` footgun outright.
- **Ordering is a channel, not a verb family.** `BR1A/BI0A/BH1/BF0/BMV1`, the splice-vs-hole duality, `V1` shift-refresh, `owns` guards, and the prototype-vs-presence capability fork all cease to exist as concepts. A membership-only consumer (aggregate, length, filter) subscribes to `rows` only; an ordered consumer (DOM sink, chained sort, positional lens) declares `wantsOrder` and receives both. That declared flag is v2's graceful-degradation fallback lattice re-expressed as a **capability the type system sees** instead of prototype forensics.
- **Holes are gone from the value domain.** Absence = key not live. `undefined` and `null` become first-class row values (§10 value-domain contract). The leave/re-enter `undefined`-write idiom is replaced by honest `remove`/`add` deltas from the producer.
- **Batches are consolidated.** The kernel coalesces per-key within a commit (last-writer-wins within the batch, add+remove annihilate, add+update fuse to add). Sinks never see intra-batch intermediate states — C9 (removes-before-fills ordering), C11 (refill collisions), and union's re-rank-before-insert choreography become unrepresentable because there *is* no intra-batch order to get wrong.

**Sink contract** (closed, exhaustive, typed):

```ts
export interface CollectionSink<T> {
  readonly wantsOrder?: boolean
  init(snapshot: ReadonlyMap<RowKey, T>, order?: readonly RowKey[]): void  // snapshot-then-deltas, verbatim v2 semantics
  apply(batch: CommitBatch<T>): void   // exhaustive switch on delta.op — a missed verb is a compile error
}
```

### 2.4 Ordering and top-k over the algebra

Ordered/windowed views are **one dedicated operator family at the edge** (`ops/ordered.ts`), built on one shared kernel component:

```ts
// kernel/order.ts
export class OrderIndex<T> {
  declare keys: RowKey[]              // rank → key (bisect array now; order-statistic tree later if needed)
  declare rank: Map<RowKey, number>   // key → rank (kills sort's O(N) indexOf — audit's patchable item, done right)
  insert(key: RowKey, cmp: Cmp<T>): number
  remove(key: RowKey): number
  reindexFrom(rank: number): void     // batch rank-map repair after splice
}
```

- `az/za('col')`, `az/za('col', n)`, `top(n)`, `limit(n)` are all configurations of `OrderedView { cmp, window?: n }`. It consumes membership deltas, maintains the OrderIndex, and emits: membership deltas for window enter/leave + order deltas for rank changes. Direction is part of the dedup key (preserving the AZ/ZA-distinct-classes lesson).
- **The bounded-window reconcile ports intact.** v2's `_batchRemove/_batchInsert/_window` insight — "tail splices and content-stable updates compose through a downstream sort; mid-window splices don't" — becomes structural: window changes are computed as an old-window-keyset vs new-window-keyset diff once per batch (the same ≤n reconcile), and because downstream consumers receive *keyed* deltas + order deltas, the chained-windowed-sort corruption (C3) has no representation. The 431ms→2ms library-brush win is preserved because the algorithm is the same; only the emission vocabulary changed.
- **Rotation-emits-updates is preserved where consumers observe positions.** Natively, a full-window rotation is `remove(evictedKey) + add(entrantKey)` + order deltas — honest membership truth. Positional readers (`win[0]`, the v2-compat record sink, the flow essay's stream) read through the **positional lens** (`kernel/lens.ts`): position p's referent changed ⇒ emit `update` at p, never remove+insert, and never a transient `undefined` because membership and order commit atomically in one batch. The v2 contract survives verbatim at the edge that asserted it; the algebra underneath is honest. (This is the resolution of the digest's update-vs-Z-set contradiction: both sides get their invariant, at different layers.)
- **`limit(n)` over objects becomes deterministic.** v3 specifies total iteration order for object stores: key insertion order, re-added keys append. Sort ties are broken by key order (stable, specified). `distinct` representative choice: first-seen by that same order. The differential harness then asserts *exact* equality with zero normalizers (§11) — the audit's "underspecified semantics force fencing" structural item closes.

### 2.5 Scheduling and consistency contract

**Model: two-phase batch commit with synchronous read-your-writes, where a bare write is a batch of one.** Written as `SCHEDULE.md` and versioned (fero M0 item 4).

Precise semantics:

1. **Apply phase.** Every write (method call or `[value]` setter) routes through `runtime.commit`. Inside `batch(fn)` (the generalization of v2's `patch`/`transact`), writes apply to source stores immediately in program order, with path-copy + no-op drop; pending per-node output deltas accumulate consolidated.
2. **Read-your-writes — exact rule.** (a) Source reads (`proxy[value]`, `.get(k)`) always see post-write values, including mid-batch. (b) *Derived* reads mid-batch trigger **flush-on-read**: the kernel incrementally recomputes exactly the ancestor chain of the read view (pull), so the returned value is consistent with all writes so far — but **no effect sink fires** and no record is emitted; pending deltas keep buffering. So: values are always consistent at every read point; observation (records, DOM, taps) happens exactly once per commit.
3. **Flush phase.** At batch close (or immediately, for a bare write), consolidated batches propagate in **topological order by node height** (the graph is an explicit DAG; height = 1 + max(parent heights); no coloring machinery needed). Each node processes each commit exactly once — the diamond problem and every "operators observe half-applied worlds" bug class (sort's stale-rank bisects, echo-order choreography, pendingShift inference) are gone because *there is no mid-mutation observation*.
4. **Effects last, isolated.** `tap`, `connect` fns, and the DOM sink run after all operator state is settled, in topological order, each wrapped; failures collect into one `AggregateError` thrown after the drain (fixing v2's `_errors[0]`-only swallow). The transient-`undefined`-during-repoint gotcha class (chat/library defensive bindings) is deleted — an effect can never observe a half-applied graph.
5. **Re-entrancy.** A write issued inside an effect queues as the *next* commit, drained FIFO after the current flush (v2's transact discipline, kept exactly, now documented + versioned). Every batch carries an `origin` token; a sink that writes marks its writes with its own origin, so echo suppression is `if (batch.origin === myOrigin) return` — declarative, killing the c870bde deterministic-lost-write class (fero DECISIONS Z).
6. **Bare write = batch of one, synchronous settle.** By the time `child.update(v)` returns, the whole graph and all effects have run. **This preserves the exact observable semantics of every committed benchmark tick, every example, and fero's write-capture** — the digest's sync-vs-batch contradiction is resolved by making batching a strict superset, not a replacement. No benchmark re-baseline is forced by semantics (only by implementation speed, which the gates own).
7. **Optional scheduler sugar** (not a semantic change): `runtime.coalesce('frame')` turns implicit batches into per-rAF batches for producers that want it — the `raf()` writer generalized; `raf()` itself is kept as sugar.

Rejected alternative: lazy pull memos + scheduled effects (2026 consensus). Reasons: read-your-writes is a hard contract for the benchmark corpus and fero; our deriveds are O(Δ)-maintained so laziness saves little; and a split lazy/eager model doubles the consistency spec. Equality cut-off — the actually valuable half of the consensus — is adopted everywhere (scalar nodes emit nothing when `Object.is(prev, next)`).

### 2.6 Ownership and lifecycle

**Explicit owner scopes replace WeakRef as the semantic mechanism. WeakRef survives only as a dev-mode leak detector.**

```ts
// kernel/scope.ts
export interface Scope extends Disposable {
  readonly id: number
  add(child: Owned): void
  dispose(): void                     // deterministic, synchronous, idempotent; [Symbol.dispose] alias
  onDispose(fn: () => void): void
}
export function scope(parent?: Scope): Scope
```

- Every source, operator, and sink is created under the **current scope** (an ambient stack, Solid-style, with explicit override). `$()` outside any scope creates an implicit root scope owned by the returned handle.
- **References are strong and flow downward**: a scope strongly holds its nodes; a source strongly holds its subscribed sinks. Delivery is deterministic; nothing silently unsubscribes.
- **Leak-free-by-default is preserved by reachability, not by WeakRef**: root scopes are *not* registered in any global strong registry (the devtools registry holds WeakRefs for enumeration only). Drop every user reference to a graph ⇒ the whole graph (scope → nodes → sinks) is unreachable ⇒ collected. "Holding the tail keeps the chain alive" becomes "holding *anything* in the scope keeps the scope's graph alive; disposing the scope tears it down now." The zero-ceremony script-tag DX survives; what changes is that dropping *one* sink's handle no longer silently kills that sink at GC time — it lives until its scope dies or `handle.dispose()` runs. This is the loud version-break the audits demanded (§13).
- `connect(...)` returns a `SubscriptionHandle { dispose(): void }` — fero M0 item 3 (synchronous detach, strong retention) verbatim. `render()` returns a `RenderHandle` whose scope tears down all Prop sinks and — for the first time — `removeEventListener`s (§5).
- **Deterministic dedup.** The operator cache is scope+source-owned: `Map<dedupKey, OpNode>` on the source node, entries removed on operator dispose. Identical calls deterministically return the cached view — GC timing can never change results (fixing the "identical call returns different results depending on GC" defect for the history-dependent operators, whose semantics are also now specified).
- **Dev backstop:** a `FinalizationRegistry` (dev build only) warns when a scope is collected without `dispose()` — GC powers a *warning*, never semantics.

---

## 3. Public API and types

### 3.1 Design order

Types are written **first**, in M0, as the contract package (`contract/`), with the conformance fixtures (positive + `@ts-expect-error` negative — the v2 fixture-gate discipline carried over verbatim) committed before any operator exists. The runtime is then implemented *against* the typed operator registry, so drift is a compile error, not a fixture-catch. The single `as Dollar` trust-point is gone because dispatch is no longer name-keyed strings — see 3.4.

### 3.2 Read surface

```ts
// The handle. NOT callable. NOT thenable. Honest reflection traps.
export interface Data<T> {
  readonly [value]: T                          // raw snapshot read (dense, always) — kept
  get<K extends keyof T & string>(k: K): Data<T[K]>
  get(k: RowKey): Data<RowOf<T>>               // total, collision-free child read
  // property sugar: proxy.field ≡ get('field') for names NOT in the reserved set
  connect(anchor: object, fn: (r: ChangeRecord) => void): SubscriptionHandle
  connect<A extends unknown[]>(sink: A): A & SubscriptionHandle      // array sink, v2 shape
  connect(obj: object, prop: string): SubscriptionHandle
  // ...operator methods, generated from the registry (3.4)
}
```

- **The three-namespace collision is closed by an explicit, versioned reserved-name set** (exported as `RESERVED: ReadonlySet<string>` from `data/contract` — the same move fero-v3's own plan makes: "operators resolve only from a formally reserved exported name set; `data.get(key)` escape hatch always works"). Property access on a reserved name is the method; `get()` is the total data read. Dev build warns when a source's actual keys shadow a reserved name. Rejected alternative: separate `.q`/pipe namespace for operators (`proxy.q.filter(...)`) — safer but destroys the chainable DX that *is* the brand; the reserved set + `get()` + dev warning is the honest middle.
- **Callable and thenable proxy magic is removed.** `await proxy` no longer snapshots (breaking, loud, shimmed in `data/v2-compat`); `proxy.snapshot()` and `[value]` are the reads. Method-name access no longer mints ghost child views (the get trap consults the real prototype first; child views are cached one-wrapper-per-(node,name)). `Symbol.iterator` is a finite snapshot iterator; `has`/`ownKeys`/`getOwnPropertyDescriptor` are implemented honestly against the snapshot.

### 3.3 Write surface

Methods-only, types and runtime in agreement (closing the Option-B types-reject/runtime-accepts rift):

```ts
export interface Writable<T> {
  update(v: T): void                            // whole-value; child.update(v) for fields
  set<K extends keyof T & string>(k: K, v: T[K]): void
  insert(v: RowOf<T>, at?: number): RowKey      // returns the minted key
  remove(): void                                // remove this child from its parent
  patch(pairs: readonly [RowKey, Partial<RowOf<T>>][]): void
  ingest(records: readonly WireRecord[]): void  // PUBLIC record-apply ingress — fero M0 item 1
  readonly [value]: T                           // symbol setter kept: proxy.field[value] = v
}
export function batch<R>(fn: () => R): R
```

- Bare assignment `proxy.x = v` and `delete proxy.x`: **removed from the native surface** (the set trap throws in dev with a pointer at `.update()`; prod no-op-throws the same). One write idiom; the examples are codemodded (§13); `data/v2-compat` restores the traps for migration. Rejected alternative: keep runtime-accepts/types-reject — it is the documented rift, and a from-scratch v3 is the only moment it can be closed.
- `$(view)` re-pointing (the todo/kanban swap idiom) becomes an explicit built-in: `const slot = mirror(initialView); slot.set(otherView)` — same relink-follows semantics, cycle check kept, but no magic `[value] = proxy` assignment overload.

### 3.4 Operator dispatch — the typed registry

```ts
// ops/registry.ts — the single source of truth
export interface OpDef<Name extends string, A extends unknown[], In, Out> {
  readonly name: Name
  readonly kind: 'row' | 'ordered' | 'bucket' | 'aggregate' | 'set' | 'rebuild' | 'effect'
  readonly category: 'rowop' | 'aggregate-decomposable' | 'holistic' | 'iter'  // fero descriptors, built in
  create(src: ViewNode<In>, ...args: A): OpNode<Out>
  dedupKey?(...args: A): string | null   // null ⇒ fresh per call (opaque closures)
  ir?(...args: A): OpIR | null           // serializable form when args permit (§4.2)
}
export function defineOperator<...>(def: OpDef<...>): OpDef<...>
```

- The runtime prototype method **and** the `DataOps<T>` method type are both derived from the registry entries (a mapped type over the registry object + a small install step that puts real functions on the prototype). One definition; tsc verifies the implementation signature against the public type. `createOperator`'s `any` return, the 4-parallel-places drift, and the `as Dollar` cast are all gone.
- **No registration side effect.** The default `data` entry imports the operator modules and installs statically; `data/kernel` exports the bare kernel + `install(ops)` for tree-shakers. This deletes `register.ts`, `data/lean`'s throw UX, `splitting:false`, the 8× bundle duplication, and — because module identity now works — the `Symbol.for` registry for everything except the deliberately-versioned compat keys (`data.v3.*`, §10).

### 3.5 Core generic types (v3 equivalents of Data/DataOps/ChangeRecord)

```ts
export type Data<T>   = View<T> & Ops<T> & Writable<T> & Children<T>
export interface View<out T> {                 // covariant read side — reactive value-slot args
  readonly [value]: T
  connect(...): SubscriptionHandle
}
export type Reactive<T> = T | View<T>          // every value-slot arg accepts either, honestly typed
export type Children<T> =
  T extends readonly (infer R)[] ? { readonly [i: number]: Data<R> } :
  T extends object ? { readonly [K in Exclude<keyof T, ReservedName>]: Data<T[K]> } :
  {}                                            // scalars carry NO collection ops (kind-split, honest)
export type RowOf<T> / ColOf<T>                // carried over; ColOf keeps the dynamic-source fallback
// ChangeRecord: native + v2 profiles, in contract/ — §7
```

- Read/write split (`View<out T>` covariant vs `Writable<T>`) makes reactive args `View<number>` instead of `AnyData`; kind-split ops give arrays/records/scalars distinct surfaces with honest returns (`map` preserves array-ness; `group` buckets are typed collections whose aggregates key-check — the two documented return-type lies close).
- The negative-fixture gate, the `Data<T>` hover-preservation gymnastics, `length(fn): Record<R,{value:number}>`, and the export-nameability gate all carry over as required patterns.

### 3.6 JSX / builder typing

One intrinsics map (v2's `jsx/intrinsics.ts`, kept as the single source) feeds three consumers: the JSX classic transform, the automatic runtime, and — new — the **builder**, whose tags are now `keyof IntrinsicElements` with a typed optional props-object first argument (`HTML.div({class: 'x', onClick: fn}, ...children)`); the `'.class'`/`'#id'`/`'k=v'` string shorthands remain as documented sugar typed as `string` (they parse into the same AST — §5). JSX `key` is finally consumed (keyed reconciliation). `render(el, template)` is fully typed.

---

## 4. Operator model

### 4.1 Family-by-family mapping onto the kernel

| v2 operator(s) | v3 shape | What ports / what dies |
|---|---|---|
| `filter`, `gt/lt/gte/lte`, `map` | `RowOp` (kind `'row'`): pure `process(row, key, prev) → Out \| SKIP` over membership deltas; update classifies via prev/next in one branch | RowOperator's process-returns-value design ports (the audit's KEEP); the 4 array-only handlers, source-length mirroring, hole emission die. `compare` stays the cheap single-threshold alternative to `between`. |
| `between` | dedicated op: sorted `[colValue,key]` index, lazy `sortedDirty` resort, full-domain alias fast path | **The brush walk ports intact** — walk old→new bounds emitting add/remove membership deltas; O(Δ) per brush unchanged. The 9 alias fork-guards, sparse mirror, hole verbs die. Reactive bounds via the uniform reactive-arg binder. |
| `az/za/top/limit` (all forms) | ONE `OrderedView` (§2.4) over `OrderIndex` | **Bounded-window reconcile ports** (old/new window keyset diff, ≤n emission); content-stable rotation preserved at the positional lens; rank map kills the O(N) `indexOf`. Direction in the dedup key. `limit` = window over source order (now specified/deterministic for objects). |
| `group(fn)`, `length(fn)` | `BucketOp`: `Map<GroupKey, Set<RowKey>>` + per-bucket derived stores; ONE implementation, `prune: boolean` option | Both bucket contracts reproduced: `length(fn)` = `{prune:false}` (zero-buckets persist as `{value:0}`), `group(fn)` = `{prune:true}`. Rebucket-on-update is one branch (prev key vs next key) — the BU2 story is structural, not a patched gap. |
| `sum/avg/max/min/some/every`, `length()` | `AggregateOp` (scalar node): running state + `apply(delta)` | **P7 closes**: array-source aggregates are O(Δ) because keys are stable — the deliberate BH1/BF0 prohibition and the O(N) rebuild fallback die. Empty-set semantics preserved verbatim (avg/max/min→undefined, sum→0, some→false, every→true); NaN-poisoning kept behind SCHEMA_VERSION (fero replicates it bit-for-bit). max/min evict-recompute stays O(n) initially (measured; order-stat tree if a workload demands). |
| `intersect/union/except` | `SetOp` over key domain: `Map<RowKey, sourceBitmask>` | **Bitmask membership ports** (per-instance, NOT shared — the 16%-slower SharedMembership experiment is respected). Echo choreography, pendingShift, primary/secondary asymmetry, C12/C14/C16 machinery all die: multi-source correlation is by key, order-independent, with per-source attribution native in `CommitBatch.origin`+source id. C14 dissolves (independent sources intersect on their common key domain — for independent arrays that is the empty/meaningless domain, so v3 *requires* object keys or an explicit `on:` key selector for independent-source set algebra: a loud, typed answer instead of a silent wrong one). C16 dissolves (no positional splice exists to misaddress). |
| `reduce` (2-arg / 3-arg) | fold ops | 3-arg incremental is O(Δ) on **all** verbs including nested edits — `remove(prev); add(row)` (P3 closed); the per-key reference cache and `assertPlainInit` port trivially; `$.debug` re-fold verifier kept as the dev-mode asymmetric-remover detector. 2-arg stays documented O(N) rebuild. |
| `to`, `keys`, `values`, `reverse` | `RebuildOp` (shared base — the audit's patchable consolidation, done in v3) | `keys/values/reverse` become incremental over keyed deltas (cheap now); `to` stays opaque-closure rebuild with equality cut-off. |
| `distinct` | keyed first-seen with specified order | Deterministic now; incremental on remove (promote next-in-order representative) — P5 improves; if the promote path measures poorly it stays a documented rebuild, but the *semantics* are specified either way. |
| `tap` | `EffectOp` | Param-presence dispatch (`tapHasParam`) and the dual clone/no-clone paths port verbatim; records fire at commit close (never mid-cascade). |
| built-ins `connect/raf/first/last/get/patch` | kept (see §3); `first/last` snapshot-at-call documented; `patch` subsumed by `batch` but kept as sugar | `mirror()` replaces the `$(view)`-swap LinkedView magic. |

### 4.2 IR vs closure policy — the CSP answer

- **Closures remain the primary argument surface.** Every fn-slot operator accepts a plain closure, captured once, non-reactive (v2's documented rule, kept).
- **Every fn-slot ALSO accepts an `Expr`** (the proto/dir ExprNode grammar, shipped as `data/ir`): `filter(E.and(E.eq('region', 0), E.gt('value', 87000)))`. Expr evaluates through the **Layer-0 interpreter by default — zero `new Function`, CSP-safe in every environment with no configuration**. `compileJS` (Layer-1, `new Function`, measured ≈ hand-closure) is an opt-in accelerator: enabled by a one-time capability probe (try/catch a `new Function('')` at runtime init) AND a per-op row-count threshold, silently falling back to the interpreter under CSP. The interpreter's ~12× penalty applies only to Expr-arg users on hot scans, is documented, and is bounded by the threshold policy. No kernel path ever requires codegen. WASM kernels sit even further out (§7).
- The arg-slot shape (`fn | Expr`) is fixed in M0 so IR-first layering later (fero's L3 planner, wire-shippable pipelines) touches zero operator constructors — this is the deliberate answer to the digest's "retrofitting means touching all 16 operators simultaneously": we pay the slot design now, not the inversion.

### 4.3 Dedup policy — the contradiction resolved

**One rule: an operator call dedups iff its arguments have well-defined value identity.**

- Value-slot args (columns, numeric bounds/thresholds/window sizes) → dedup by normalized value.
- Reactive args → dedup by bound *source node identity* (v2's `arg[view]` subtlety, preserved exactly).
- `Expr` args → dedup by canonical serialization (so IR-using apps get the kanban-class pileup fix for filter/map/group/length **for free**).
- Opaque closures → **never dedup** (two taps with distinct side-effect closures stay independent — the operators-crit KEEP is the ruling; the seam/perf "dedup filter by value" claim applies only to the Expr form).
- Dedup is deterministic (scope-owned cache, §2.6) — never a GC coincidence.

### 4.4 Ported v2 algorithmic IP (explicit inventory)

Ports with tests carried: between's lazily-resorted index + brush walk + full-domain alias fast path; OrderedView's content-stable bounded-window reconcile + batch reconcile; intersect's per-instance bitmask; RowOperator's process shape; tap's param-sniffing dual path; reduce's reference-cache→prev simplification; aggregate empty-set semantics; `length(fn)`'s `{value:count}` wrapper + zero-bucket persistence; the monomorphism discipline (declare-fields, constructor-full-init, constant verb strings → now constant delta-op strings and preallocated batch shapes).

### 4.5 New operators and their cost

- **`join(other, onLeft, onRight)`** (keyed equi-join; the TanStack answer): two `Map<JoinKey, Set<RowKey>>` indexes; O(Δ · matches) per delta; inner + left variants; ~300 lines + conformance scenarios. Ships in M5 behind the same conformance kit (an operator written against the kit from day one — the inverted ordering the tests audit wanted).
- **`page(offset, size)`** — trivial over OrderedView (window with offset). Near-free.
- **`flatMap`** — deferred (no example demand; scope control §15).

---

## 5. Render layer

- **Keyed reconciliation.** `DOMSink` holds `Map<RowKey, Element>` and consumes membership + order deltas: `add` → create+`insertBefore` at rank; `remove` → detach + dispose row scope; `update` → per-binding Prop writes only (structure/content split preserved — the subsystem's crown jewel); `orderMove` → **a real `insertBefore` move**. Element identity survives reorders: focus, selection, CSS transitions, scroll anchoring intact; kanban/chat's `data-id` workaround and JSX-`key`-parsed-then-discarded both die. The dense-tail/index-keyed dual model, `_sparse` scans, and the H1/H4/H6 regression axis are deleted rather than guarded. Sparse producers bind directly as before — but now they're just membership views; "renders only in-range rows" is the only possible behavior.
- **Ownership integration.** `render(el, template)` creates a scope; each row gets a child scope owning its Prop sinks and listeners (`removeEventListener` on row removal — first time possible); dispose on the returned handle or on explicit unmount. The `isConnected` bail becomes a dev assertion. The element→binding back-channel is kept for devtools (`__data_sink`, non-enumerable, same descriptor discipline as `__ripple_sink`) so `$.fromDOM`/picker/alt-hover survive.
- **Children AST — the single-static-slot trap dies.** `Node` carries an **ordered children list** of explicit kinds: `{kind:'text', s}` | `{kind:'rtext', view}` | `{kind:'el', node}` | `{kind:'cond', view, whenTrue}` | `{kind:'list', view, rowFn}` | `{kind:'component', fn, props}`. `<span># {cur}</span>` renders `"# general"` because order is preserved; multiple statics coexist; `{cond && 'x'}` is an explicit conditional child, not a magic clear of a shared slot. Props travel in a typed props channel (object arg / JSX props), so `key`, event options (`{capture, passive, once}`), and future options have an unambiguous home — no more dispatch-on-value-shape. JSX becomes a direct mapping; the `hasRowFn`/`on[A-Z]` heuristics shrink to documented sugar with their two regression exclusions kept where the sugar remains. Trace-equivalence testing (byte-identical builder-vs-JSX mutation logs) is carried over to pin parity in the new AST.
- **Component model.** Components stay plain functions, now invoked under an owner scope with `onCleanup(fn)` available (context and error boundaries get a natural home; error boundary = a scope that catches effect-phase errors from its subtree and swaps a fallback child — small, shipped). No lifecycle framework beyond this — scope control.
- **SSR stance: OUT for v3.0, seam kept.** Demand is unproven (render-crit: no example or issue asks). But instantiation is written as the two-phase `materialize(target) + bind` pass over the inert AST, with exactly one target (live DOM) shipped — a string/hydrate target is a later entry, not a rewrite. This resolves the digest's SSR contradiction: decided-out, cheaply reversible.
- **A11y/focus policy under reorder** (stated, tested): element identity preservation means focus/selection are never lost by the library; the library never programmatically moves focus; reorders are plain `insertBefore` (no animation opinions; reduced-motion is app-level); text bindings are single text-node writes (safe for `aria-live` regions — documented pattern); a Playwright a11y case (focused input survives a sort reorder) lands with the DOM sink.

---

## 6. Devtools contract

The core ships two native primitives (the only two things the devtools audit ruled core-level):

```ts
// kernel/graph.ts — creation-time reflection registry, always on, near-zero cost
export interface GraphNode {
  readonly id: number                 // stable, serializable
  readonly kind: 'source' | 'operator' | 'scalar' | 'sink' | 'scope'
  readonly op?: { name: string; args: string }   // stamped at the dispatch chokepoint
  readonly parents: readonly number[]
  readonly scopeId: number
}
runtime.graph(): GraphNode[]           // WeakRef-held enumeration (registry never retains graphs)

// the single dispatch observation hook — one emit chokepoint, verb set = the closed algebra
runtime.onCommit(hook: (c: {seq: number; origin: OriginToken; nodes: readonly {id: number; deltas: number; ms: number}[]}) => void): Dispose
```

- Identity, kind, provenance (operator name + summarized args — both in hand at the one `defineOperator` dispatch point), and edges are recorded at creation: walk.ts, the panel's second walk, METHOD_OF, and ctor-string classification (~1,000 lines of archaeology) are deleted; devtools become minification-safe; nodes are serializable by ID, so `$.graph`/trace/cascades are postMessage-able (remote/extension frontends become possible).
- Causality is free: `seq` **is** the cascade ID (one commit = one user mutation = one cascade — no microtask-coalescing heuristic), `origin` distinguishes user writes from effect re-entrancy; per-node `ms` gives self-time so the profile's per-operator table is populated by construction (the structurally-empty-profile defect cannot recur). Verb drift is impossible: the hook's payload derives from the closed algebra, not a hand-copied VERBS array.
- Cost discipline (a hard perf gate carried over): registry = one small object + one WeakRef per node creation; `onCommit` with no listeners = one nullable check per commit; instrumentation remains perfectly reversible and byte-identical-off.
- **What survives of the panel:** the UI (tree/DAG, inspector tabs, picker, alt-hover, dock) ports as a subsystem-local rebuild over the registry — smaller, dogfooding the library via internal scopes (the `internalRoot` mechanism finally used). `$.inspect/$.graph/$.fromDOM/$.highlight/$.trace/$.profile/$.cascades` keep their output shapes where meaningful (graph node shape gains `id`; profile gains honest per-operator rows). The esc()/XSS test, closed-shadow-root + shell escape hatch, and ring absolute-index contract carry over as requirements.

---

## 7. Seam and sources

### 7.1 The kernel boundary below the proxy

```ts
// contract/backing.ts
export interface SourceBacking<T> {
  load(): { rows: ReadonlyMap<RowKey, T>; order?: readonly RowKey[] }
  apply(writes: WriteBatch): void                      // the local commit path
  subscribe(push: (b: CommitBatch<T>) => void): Dispose // backing-originated changes
}
```

In-memory is the default implementation (the `Store` of §2.1). fero's distributed source, a persistence adapter, an Arrow/DuckDB result reader, and the opt-in **columnar backing** (typed-array columns + validity bitmap behind the same `keySlot`; WASM/SIMD kernels attach here and only here, behind the maintained-columns threshold RESULTS.md proved — never per-query marshalling) are all backings. The operator pipeline above the seam is identical for all of them.

### 7.2 fero M0 contract items — addressed one-for-one

| fero plan-v3 §10 demand | v3 answer |
|---|---|
| public record-apply ingress (v2 reaches `[VIEWSYM].res` at ~5 sites) | `proxy.ingest(records)` + `SourceBacking.apply` — public, typed, day-one |
| non-cloning sink mode (~30–40% of fero's write budget) | the **native profile** hands references (documented not-retained-past-dispatch; `.retain()` = clone helper); the v2-compat profile keeps structuredClone |
| subscription handles: synchronous detach, strong retention | `SubscriptionHandle.dispose()` + scope ownership (§2.6) |
| versioned re-entrancy/timing contract | `SCHEDULE.md` + `SCHEMA_VERSION` + `origin` tokens (§2.5); cross-repo contract tests run in both CIs against data HEAD |

### 7.3 The versioned machine-readable package contract

`data/contract` (engine-free, no symbols, no proxies — the load-bearing property PLAN.md specified):

```ts
export const SCHEMA_VERSION = 3
export type WireRecord =            // native profile
  | { t: 'add'; k: string; v: unknown }
  | { t: 'update'; k: string; v: unknown; prev?: unknown; path?: readonly string[] }
  | { t: 'remove'; k: string; prev?: unknown }
  | { t: 'move'; k: string; from: number; to: number }
export type ChangeRecordV2 = { type: 'update'|'insert'|'remove'; key: string[]; value: unknown; at?: unknown }
                            | { type: 'move'; from: number; to: number }   // v2-compat profile, lossless
export const RESERVED: ReadonlySet<string>          // builtins + operator names — fero deletes its hardcoded BUILTIN set
export const descriptors: Record<string, { category: 'rowop'|'aggregate-decomposable'|'holistic'|'iter'; declarative: boolean }>
export function foldSnapshot(snap: unknown, r: WireRecord): unknown        // the proto/dir snapshot fold, promoted
```

`RESERVED`, `descriptors`, the operator signature manifest, llms.txt, AGENTS.md §2, context7.json, and the CLI guidance are all **generated** from the registry with a CI drift check (the _gen-bench-md.mjs pattern, generalized) — the hand-copy drift class (fero's stale BUILTIN missing `get`; the four contradictory guidance artifacts) is closed at the root.

### 7.4 Async and streaming sources

```ts
$.from(input: Promise<T> | AsyncIterable<RowOf<T>[]> | ReadableStream, opts?: {
  key?: (row) => RowKey               // adopt external ids (Electric/DB rows) — keys survive the wire
  coalesce?: 'sync' | 'microtask' | 'frame'   // default 'microtask' — one commit per drain
}): Data<T> & { readonly status: Data<'pending'|'ready'|'error'>; readonly error: Data<unknown> }
```

Pending/error are sibling reactive views (renderable directly — the loading-bar examples stop hand-rolling stream-fetch). Cancellation ties to scope dispose. Faster-than-frame feeds coalesce by policy — the race.js settle-once-per-frame discipline becomes a library feature. Electric-shape and Arrow adapters ship as separate optional entries in M6 (thin: both are "keyed rows + deltas in" ingestion).

### 7.5 Persistence / local-first stance

**Hook, not core.** The delta stream (now with oldValue) + snapshot-on-connect already constitute a changelog; `data/persist-idb` (snapshot + record log + compaction over `ingest`/`connect`) is a post-3.0 adapter; undo/redo is a ~50-line userland recipe *because prev exists* (inverse deltas) and ships as a documented example — turning the flow essay's "undo falls out of the duality" marketing claim into a demonstrable artifact without dragging sync engines into the kernel. Distribution remains fero's (the PLAN.md seam split verdict is respected).

---

## 8. The five open questions — explicit answers

1. **Storage & row identity.** A keyed row store with a packed dense lane (slots + validity bitmap + key→slot map), keys minted at ingress (monotonic ints for array-born rows, adopted strings for object-born), never reused, never coerced (Map/Set-only keying). Ordering/top-k lives in a separate rank→key channel maintained by one `OrderIndex` component consumed by the single OrderedView family and the DOM sink. Nested-mutation DX is preserved by kernel-applied path-copy writes, which also yield oldValue for free. Columnar is NOT the kernel: it is an opt-in `SourceBacking` behind the same key map — keyed identity is what render, fero, and the operator algebra all need natively; the 63–500× columnar headroom is a batch-frontier win that layers on without re-architecting. Keys survive the wire in the native profile (domain-tagged scalars); the v2-compat profile re-positionalizes arrays losslessly through the order channel.

2. **Delta algebra & the compatibility line.** One closed discriminated union — `add {key,row}` / `remove {key,prev}` / `update {key,row,prev,path}` first-class (never retract+insert) — plus a separate order channel (`orderInsert/orderRemove/orderMove`) and a scalar `{prev,next}` channel, delivered as one consolidated `CommitBatch` per commit per node. No-phantom-events is enforced once at the kernel write chokepoint; rotation-emits-updates survives at the positional lens; removes-before-fills dissolves (batches are atomic); snapshot-then-deltas-on-connect is kept verbatim. fero's wire shape is served by a **lossless v2-compat profile** emitting exactly `{type,key:string[],value,at?}` + `{move,from,to}` (positional keys for arrays, cloned values), while the native SCHEMA_VERSION-3 profile adds stable keys, `prev`, `path`, `move`-with-value, and no-clone — the additive extension fero's WireRecord already sketches. Version-broken loudly: the sparse-undefined public value shape (views are dense) and the leave/re-enter `undefined` idiom.

3. **Scheduling & consistency.** Two-phase batch commit where **a bare write is a synchronous batch of one** — apply (writes hit stores immediately; source reads always read-your-writes; derived reads mid-batch trigger flush-on-read pull recompute with no effect emission), then flush (consolidated batches propagate once, topologically by height; effects run last, exception-isolated into AggregateError; re-entrant writes queue FIFO as the next commit carrying origin tokens). Every existing benchmark tick, example, and fero's write-capture keep their exact observable semantics because sync settle is the degenerate case, not a removed mode; `batch()`/`coalesce('frame')` are strict supersets. Glitch-freedom needs no coloring machinery — the DAG and heights are explicit. The whole contract ships as versioned SCHEDULE.md with cross-repo contract tests (fero M0 item 4), and origin tokens delete the c870bde echo-suppression-by-timing class.

4. **API surface & lifecycle.** The callable/thenable proxy is replaced by a non-callable read proxy with honest reflection traps, property sugar for child reads minus an explicit versioned RESERVED name set, `get()` as the total escape hatch, and a methods-only write surface (`update/set/insert/remove/patch/ingest/batch`; bare assignment throws with guidance; `[value]` read/write kept) — types and runtime finally agree, and the operator surface is generated from a typed registry so drift is a compile error. Lifecycle: explicit owner scopes with deterministic `dispose()` (Symbol.dispose), strong downward references, scope-owned deterministic dedup caches, subscription handles with synchronous detach; leak-free-by-default survives via reachability (dropping a whole graph collects it — no global strong registry), and WeakRef/FinalizationRegistry demote to a dev-mode leak warning. Zero-ceremony DX is preserved; what changes loudly is that GC timing can never again change observable results.

5. **Seam & competitive scope.** The seam is a first-class design center but not the kernel's reason for being: `SourceBacking` is the boundary below the proxy from day one (in-memory default; fero/persistence/Arrow/columnar as backings), all four fero M0 items are contract items in M0 with cross-repo CI, and `data/contract` ships the versioned machine-readable surface (records, RESERVED, descriptors) that guidance files and fero both consume generated. The IR is Tier-2, not primary: every fn slot accepts `fn | Expr`, Expr interprets CSP-safe by default with opt-in codegen, and the slot shape is fixed now so IR-first layering (fero L3, wire pipelines) never touches operator constructors. Competitively, v3 stays an operator engine + renderer — the defensible vertically-integrated combo — and answers TanStack DB with `join`, `page`, first-class async/stream sources, and head-to-head benchmarks, while explicitly not building sync, persistence, or a query planner into the core (adapters and fero own those).

---

## 9. Contradiction resolutions (the load-bearing ones, ruled)

1. **Sync-settle vs batch-first:** Both, by strict superset — two-phase commit engine; bare write = synchronous batch of one (§2.5). No semantic re-baseline of the benchmark corpus; `batch`/frame-coalescing are opt-in supersets. Ruling: preserved + extended, never forked.
2. **Update vs retract+insert:** Update is first-class with `prev`; membership changes are honest add/remove; positional consumers (compat records, `win[0]` children, flow essay) observe rotations as updates through the positional lens. Ruling: the Z-set closedness discipline is adopted; the Z-set encoding is rejected for named benchmark and contract reasons.
3. **Columnar vs keyed store:** Keyed rows are the kernel (identity is what render/fero/algebra need); the store's packed-slots+bitmap layout is columnar-ready; columnar is an opt-in SourceBacking where WASM/SIMD attach. Ruling: keyed native, columnar layered — the hybrid finally designed, in one direction.
4. **WeakRef vs scopes:** Scopes are the semantics; WeakRef is a dev-mode leak detector and the devtools enumeration mechanism only. Loud version break, documented migration (§13). Leak-free-by-default preserved via reachability.
5. **Dedup policy:** One rule — dedup iff args have value identity (values, bound-view identity, canonical Expr); opaque closures never dedup; caches scope-owned and deterministic. Both audit claims satisfied on their own turf.
6. **SSR scope:** Out for 3.0; the materialize/bind two-phase seam is kept so a string/hydrate target is an entry, not a rewrite. Demand-driven.
7. **Perf-gate slack numbers:** The crit's 6×–480× figure is adopted; v3 gates are relative ratios + deterministic op-counts (H1 promoted to CI backbone), absolute ms only as catastrophe rails.
8. **Reactive value-slot typing:** The crit is right — patchable in v2 (covariant marker). Not spent as rewrite justification; v3 gets `View<out T>` natively.
9. **Render dense/sparse dual model:** Not double-counted — v2 converged it; only keyed row identity is rewrite-level, and it is the centerpiece here.
10. **sideEffects './register.ts':** Load-bearing in v2 (keep there); moot in v3 — no registration side effect exists.
11. **Oracle independence:** The conformance kit's oracle is plain-JS, library-free (§11); the proto fuzz's two-library-chains parity is understood as testing rehydration only.
12. **Devtools scope:** Core ships exactly the registry + onCommit hook; the panel is a subsystem-local port. The mapper's wider framing is declined.
13. **CLAUDE.md cross-entry identity misstatement:** A v2 docs fix; v3 makes it moot via module identity (no Symbol.for except versioned `data.v3.*` compat keys).
14. **Additive seam items as rewrite justification:** Not spent. `data/contract`, foldSnapshot, descriptors, public ingress, non-cloning mode are all additive-in-principle; the rewrite case here rests on positional identity, the open verb surface, fused roles, and GC-lifetime — the four provably non-converging decisions.
15. **C14/C16 framing:** The honest calibration is adopted: v2's fixes converged; the rewrite case is the permanent ~20% reconciliation tax, the foreclosed P3/P7 incrementality, the three-times-outrun proof gate, and the unbounded conformance matrix for every future operator — not ongoing fires. The concept doc's own narrative (this document) uses that framing throughout.

---

## 10. Cross-cutting policies

- **CSP/codegen:** No `new Function`/`eval` anywhere in the kernel or default operator paths. Expr interprets by default; `compileJS` is opt-in + capability-probed + threshold-gated with silent fallback (§4.2). WASM kernels are opt-in modules behind the columnar backing; WASM-SIMD availability (Safari still flagged) is feature-detected with scalar fallback. CI runs the test suite once under a simulated no-eval environment.
- **Memory budget & measurement:** New harness (`perf/mem.ts`, --expose-gc): (a) retained bytes/row at 100k rows — budget: ≤ 96 B kernel overhead per row median (key map entry + slot + graph share), derived views ≤ 16 B/row (membership bit + set entry amortized); (b) steady-state allocation per no-op write = 0, per single-row commit ≤ 3 objects (row copy, delta, batch) — counted invariants, CI-gated on any machine (fero's discipline adopted); (c) leak test: mount/dispose 1,000 scopes, heap-snapshot delta ≈ 0. The keyed-vs-columnar memory comparison the audit demanded is produced by this harness in M1, before the columnar backing is scheduled.
- **Error handling & dev/prod split:** Typed error taxonomy (`DataError` subclasses: `WriteOnDisposed`, `CycleError`, `ReservedKeyShadow`, `AsymmetricFold`, `IngestSchemaMismatch`); effect-phase failures aggregate into `AggregateError` post-drain (§2.5). A real dev build (conditional `process.env.NODE_ENV` + a `data/dev` condition export) ships the legality checker on every node, undisposed-scope GC warnings, reserved-name shadow warnings, assignment-write guidance, asymmetric-reduce refolds, and destructuring-loss lint guidance — converting most of CLAUDE.md's gotcha list into runtime warnings. Prod build strips all of it.
- **Value-domain contract (specified before the harness asserts equality):** `null`/`undefined`/`NaN` are first-class row/leaf values (absence = key absence, never a value); aggregates: sum→0/avg,max,min→undefined on empty, NaN-poisoning propagates (bit-for-bit fero compat, versioned under SCHEMA_VERSION); `Date`/`Map`/`Set`/`BigInt`/class instances allowed as leaf values with reference semantics (path-copy never clones leaves; the compat profile's structuredClone documents its throw set); keys: any string (unicode fine) or minted int — never coerced; functions as values rejected at ingest (typed error) matching the wire fail-closed rule.
- **Runtime support matrix & bundle budgets:** ES2022; Node ≥ 20, Deno, Bun, workers (no DOM assumption outside render; `raf` falls back as today); Proxy required; WeakRef/FinalizationRegistry OPTIONAL (dev-only — absence degrades to no leak warnings); structuredClone required only by the compat profile. Bundle budgets (CI size gate): `data/kernel` ≤ 12 KB min+gz; default `data` (kernel + all operators) ≤ 35 KB; `data/render` ≤ 12 KB; splitting:true with one shared chunk (possible now — no side-effect registration), so multi-entry consumers ship ONE copy of the runtime instead of eight.
- **Concurrency/multi-context:** All cascade/commit state lives on a `Runtime` instance (per-graph), not module globals; the default export binds a lazily-created default runtime. Multiple independent graphs per page, per-test isolated runtimes, and worker-hosted graphs (a backing can live in a worker and push CommitBatches over postMessage — the record grammar is transferable) are supported by construction. SharedArrayBuffer/columnar-in-worker is a post-3.0 exploration behind the backing seam.

---

## 11. Test strategy

**The kit exists before the operators (M0). Order is the one benefit that cannot be retrofitted.**

1. **Delta legality checker** (`conformance/legality.ts`, ~150 lines): a state machine per node asserting, per batch: add only for non-live keys; update/remove only for live keys; ≤1 delta/key/batch; order deltas reference live keys and in-bounds indices; no update with `Object.is(prevAtPath, next)`; scalar emits only on inequality. Exhaustive switch on the closed union — TS exhaustiveness makes "sink ignores a verb" a compile error; the checker makes "operator emits an illegal verb" a runtime failure on the introducing commit. Dev build wraps every node with it.
2. **Replay sink** (`conformance/replay.ts`): folds emitted batches into a fresh store and asserts replay ≡ the node's materialized value **after every commit** — the table⟷change-stream duality as an executable law. The C8 class (value right, stream wrong) is caught on commit zero; the P7 class (unverifiable incremental path) becomes attemptable because a wrong incremental delta fails replay immediately.
3. **Independent plain-JS oracle** (`conformance/oracle/`): per-operator naive implementations (Array.filter, sort with the specified tie-break, fold-from-scratch) sharing zero code with the engine — the executable operator spec. Doubles as documentation.
4. **Differential harness, ported and promoted:** the 63-scenario grid + the widened mutation vocabulary (slot-clear→remove, refill, overwrite, patch-batch, mid-insert) re-expressed over the v3 write API, asserting **exact equality with zero normalizers** (semantics are now total: ties, re-entry order, first-n all specified). It runs three-way — v3 vs oracle vs (during the window) v2-with-normalizers — as the parity gate. Composition grid generated to depth 3 over the op catalog; seeded fresh-seed budgets (small per-commit, large nightly) with automatic shrinking to a minimal committed repro; the KNOWN_FAILURES anti-rot registry mechanism carried verbatim.
5. **Change-stream legality in CI, not by hand:** every scenario runs under (1)+(2) automatically — the `emits` field's broken promise is replaced by machinery, and expected-record churn disappears because the contract is closed.
6. **Playwright corpus as parity gate:** the 11 examples' specs run unmodified in intent (selectors/interactions identical) against codemodded examples per migration tranche (§13/§14); the devtools panel specs and XSS test port with the panel. E2E made hermetic (prebuilt, --workers=1, small flight fixture) so it can finally gate CI.
7. **Contract tests, cross-repo:** the fero M0 contract items as executable tests living in `data` (and mirrored in fero's CI against data HEAD) — ingress round-trip, no-clone profile aliasing rules, dispose synchronicity, re-entrancy/origin ordering, v2-record-profile byte-parity against recorded v2 streams.
8. **Kept techniques:** `runtime.mintKey` injection (the `$.random` seam), entry-packaging guard tests, spec() metadata coordinates, mechanism-level why-comments migrating with behaviors, buildless `--experimental-strip-types` execution.

---

## 12. Performance strategy

**Flagship workloads at risk (named, gated):**

| Workload | Risk mechanism | Gate |
|---|---|---|
| Crossfilter 231k brush (between→intersect→length(group)→za→limit) | between walk + bitmask port fidelity; batch machinery overhead per brush step | v3 median brush step ≤ v2 (rAF-coalesced), M3 exit |
| Swarm patch (12k agents/frame) | path-copy alloc per changed row (iso-cost analysis §2.1 must hold) | v3 frame cascade ms ≤ v2, M2 exit |
| Per-operator single-tick microbenches (the H7/BENCHMARK.md corpus) | batch-of-one commit overhead vs v2's direct verb call | per-op single ≤ 1.15× v2 at M2, ≤ 1.0× at M5; batch ≤ 1.0× |
| Library bounded-`za` brush (431ms→2ms history) | window reconcile port | ≤ v2, M3 |
| kanban/chat repoint churn | dedup + scope teardown replacing rAF workaround | no monotonic slowdown over 500 repoints (new churn bench) |

**Mechanics:** monomorphic delta/batch shapes (declare-fields discipline carried over); batch-of-one fast path preallocates nothing user-visible but reuses internal accumulators; commit overhead budget ≤ 1µs (measured M1 before operators are built on it — the single biggest go/no-go). Mode A single-source-of-truth workloads, the two calibrated timing presets, H1 deterministic op-counts promoted to blocking CI, H6 made gating with relative bands — all carried from the v2 harness with its honesty properties intact. The keep-bundle/toggle boilerplate is deleted *only because* the semantics it compensated for (WeakRef, dedup-by-reference) are gone — per the audit's warning, in that order.

**New peer set:** existing nine + **TanStack DB** (their sorted-100k-update and a live-join workload — run on their published terms), and **krausest js-framework-benchmark** locally for the render layer (create/replace/partial-update/select/swap/remove 1k/10k rows — keyed reconciliation finally makes swap-rows honest) with a participation plan post-3.0. Memory benchmarks per §10 join the report. Disclosure: the designed-for-workload bias note ships on the landing page's methodology link (candor norm carried over).

**Gates per phase:** every milestone in §14 has a perf exit criterion; "don't widen thresholds" survives as law; a failed gate stops the phase, not the honesty.

---

## 13. Migration and compatibility

**Versioning:** `data@3.0.0`, name kept. Global registry keys versioned `data.v3.*` (only the compat/devtools bridge uses them; module identity does the rest) — a mixed v2+v3 tree fails safe instead of silently corrupting. npm publish remains blocked on the token; the release plan assumes committed-dist Pages fallback continues (T1) and does not depend on instant publishability.

**Compat entries and their lifetime:**

- `data/v2-compat` (supported through v3.x, removed in v4): assignment/delete write traps → kernel writes (dev-warn); thenable `await proxy`; `$(view)` LinkedView swap → `mirror()` bridge; bare-`connect` v2 record profile as the default for sinks created through it.
- **v2 record profile** (`ChangeRecordV2`, §7.3) is **permanent, not a shim** — it is a documented wire profile under SCHEMA_VERSION, byte-parity-tested against recorded v2 streams. All positional translation complexity is quarantined in ONE module (`compat/v2-records.ts`, ~300 lines, the only place order→index math survives) — the containment answer to "the old complexity re-enters through compat."

**Codemod inventory — the 11 examples + landing (all kept; they remain the showcase and regression corpus):**

| Target | Mechanical changes | Semantic changes |
|---|---|---|
| todo, todo-jsx | assignment→`.update()` (mostly done in v2 Option B), `$(view)` swap→`mirror()` | none |
| crossfilter, crossfilter-jsx | same + delete progress hand-rolls → `$.from(stream)` optional | brush identical; perf gate M3 |
| kanban | swap→`mirror()`; drag writes unchanged (`card.status` → `card.get('status').update`) | `data-id` workaround REMOVABLE (keyed DOM) — kept temporarily for spec parity, then simplified |
| chat | same; defensive `u ? u[0] : ''` bindings REMOVABLE (no transient undefined) | reactions BU2 → nested update, identical DX |
| library | `dense()` calls DELETED (views dense); defensive `r == null` bindings removable; raf writer kept | bounded za unchanged (port) |
| pivot | detached-parent workaround removable (scope-based render) | group semantics identical |
| swarm | `pop.patch` → `batch()`/`patch` sugar (unchanged) | perf gate M2 |
| flow | records read from the **v2 profile** connect (essay's literal records unchanged); `foldPlain` unchanged | §1 duality figure gains an optional oldValue annotation (dividend, not requirement) |
| multidim | peer harness unchanged; data row uses new API | numbers re-measured, methodology note |
| landing (race/demos/feed) | new API; `dense()` deleted; catalogue speedup column regenerated | re-baseline H7 vs v2 AND peers |

**fero codemod inventory (verified sites):** (a) ~40+ source-path imports `../../data/index.ts` → package import pinned to `data@3` + `data/contract` (publish or workspace link); (b) hardcoded `BUILTIN` name set (dispatch.ts:358, already stale re `get`) → `RESERVED`/`descriptors` from `data/contract` (deletes 2 of 3 sets, per its own plan); (c) ~5 `[VIEWSYM].res.update/insert/remove` reach-throughs → `proxy.ingest()`; (d) hand-declared ChangeRecord (message.ts) → `WireRecord`/`ChangeRecordV2` imports; (e) `applying`-boolean echo suppression → `batch.origin`; (f) thenable-handle probing → already replaced by fero-v3's tagged Handles. fero-v2 (if still running) stays on data v2 LTS; fero-v3's M0 go/no-go consumes the v3 contract directly — the M0 items are M0-milestone deliverables here precisely so fero never needs the wrap-or-fork fallback.

**Version-broken loudly (documented in MIGRATION.md with before/after):** sparse-`undefined` public value shape (dense views); leave/re-enter `undefined` idiom (`remove`/`add` instead); `await proxy`; GC-silent unsubscription (scopes/dispose); bare assignment writes (native); object iteration-order looseness (now specified — strictly a tightening); `data/lean` entry (obsolete — tree-shaking works). **Preserved verbatim:** ChangeRecord v2 profile via compat, connect arities incl. bare-`connect(fn)` throw, snapshot-then-deltas, no-phantom-events, rotation-emits-updates (positional lens), aggregate empty-set + NaN semantics, `length(fn)` zero-bucket persistence vs `group` pruning, dist entry file layout (importmaps in 11 examples keep resolving), `Operators`-equivalent introspection (a readonly view of the registry exported under the old name for fero's hasOwnProperty probe during migration).

---

## 14. Phasing

**Model: staged strangler by consumer, big-bang by kernel.** The kernel is greenfield (a `v3/` tree in-repo; no attempt to run the new engine under the old verb protocol — the audits establish the protocol IS the thing being replaced), but consumers (examples, fero, landing) migrate tranche-by-tranche behind the parity gate, and **v2 remains the shipped default until M5 exits**. v2 bugfix ownership during the window: the same maintainer, bugfix-only policy (no new v2 features), every v2 bugfix must add a differential scenario that v3 must also pass — v2 maintenance feeds the v3 gate rather than competing with it.

| Milestone | Contents | Machine-checkable go/no-go gate |
|---|---|---|
| **M0 — contract & kit (wks 1–2)** | `contract/` types + SCHEMA_VERSION + RESERVED/descriptors; delta algebra types; SCHEDULE.md; legality checker + replay sink + oracle skeleton; type fixtures (pos+neg); fero contract review | Kit demonstrably red/green on a toy op; fixtures compile/fail as pinned; fero M0 items signed off in a written decision (their format) |
| **M1 — kernel (wks 3–5)** | Store + keys + path-copy commit + scopes + runtime + registry + graph/onCommit hook; filter/map/compare + sum/avg/length; v2-record compat sink | Legality+replay green on all M1 ops × mutation vocabulary; **commit-overhead budget ≤ 1µs measured**; single-tick ≤ 1.15× v2 on filter/aggregate benches; mem counted-invariants green |
| **M2 — the hard ports (wks 6–9)** | between (brush walk), OrderedView (window reconcile), set algebra (bitmask), group/length(fn), reduce/distinct/tap/rebuild family | Full differential grid (3-way) exact-equal; the 9 old C15 KNOWN_FAILURES scenarios pass trivially; C14/C16 scenario equivalents pass; swarm-shape batch gate ≤ v2; per-op corpus within budget |
| **M3 — render + first examples (wks 10–13)** | Keyed DOMSink + children AST + JSX + ownership; codemod todo/kanban/chat/library | Playwright parity on the 4 examples; crossfilter brush gate ≤ v2; focus-survives-reorder a11y spec green; krausest local suite runs |
| **M4 — devtools + seam (wks 14–16)** | Registry-based devtools + panel port; `ingest`/backing; async sources; fero integration | Devtools Playwright suite green incl. XSS + reversibility; fero contract tests green against v3 HEAD in both CIs |
| **M5 — completion & flip (wks 17–20)** | Remaining examples + landing; `join` + `page`; perf corpus re-baseline; BENCHMARK.md regeneration; TanStack DB + krausest numbers; MIGRATION.md; dist flip | All 11 examples + landing Playwright green; all perf gates ≤ 1.0× v2 (or a written accepted-regression decision per row); size gates; docs generated-and-drift-checked. **Only then does `data` default flip to v3.** |
| **M6 — post-3.0 (unscheduled)** | Columnar backing + WASM kernels; Arrow/Electric adapters; persist-idb; SSR target; krausest submission | Each behind its own gate; none blocks 3.0 |

Any gate failing twice triggers the written-decision protocol: fix, descope the item, or (for the M1 commit-overhead gate specifically) revisit the batch-of-one mechanics before proceeding — that gate is the concept's single point of maximum regret, so it is placed earliest.

---

## 15. Risks and mitigations

1. **v3 is slower than v2 on advertised workloads** (the named existential threat). Exposure points: batch-of-one commit overhead on single-tick benches; path-copy allocation on update-heavy ticks; Map-keyed membership vs v2's raw index arithmetic in between/intersect inner loops. Mitigations: the M1 ≤1µs commit gate *before* operators exist; dense-lane int keys keep inner loops on packed arrays; ported algorithms are benchmarked against their v2 twins per-operator as they land (not at the end); the swarm iso-cost analysis (§2.1) is verified empirically in M2; v2 stays the shipped default until every gate passes, so a miss costs schedule, never the brand. Residual honesty: some single-tick microbenches may land at 1.0–1.15× v2 while batch/brush/churn workloads improve — if so, that trade is published, not hidden (the candor norm).
2. **Scope balloons into a framework.** TanStack comparison pressure (sync! persistence! optimistic transactions!), SSR temptation, signals-bridge creep. Mitigations: a written non-goals list in the README from M0 (no sync engine, no persistence in core, no SSR in 3.0, no query planner, no component framework beyond scopes+cleanup); everything beyond the two pillars ships as adapters behind `SourceBacking`/`contract`; M6 items cannot pull into M0–M5.
3. **The compat profile becomes a second protocol to get wrong.** Positional re-translation is exactly where v2's complexity lived. Mitigations: quarantined in one ~300-line module; byte-parity tests against *recorded v2 streams* from the real examples; the flow essay runs on it as a living fidelity test.
4. **Reserved-name collisions bite real data.** A user's `{filter: ...}` row shape shadows. Mitigations: dev-mode shadow warning at ingress; `get()` total; RESERVED is versioned and frozen for all of v3 (new operators must come with new names only in majors, or namespaced `use()` installs).
5. **fero timing slip.** fero's M0 go/no-go lands before data M4 finishes in the worst case. Mitigations: the contract items are M0 *paper* deliverables here (types + SCHEDULE.md) so fero can build against the contract with the v2-wrapper fallback it already priced; the cross-repo contract tests keep both honest; worst case fero-v3 M0 runs on data-v2 + wrapper and swaps the backing at data M4 with no API change — the seam exists precisely for this.
6. **Path-copy changes aliasing in ways user code notices** (held row references go stale after edits). Mitigations: documented clearly ("read through the proxy, not through captured row objects"); dev-mode can flag long-held row references written-through (heuristic warning); the compat profile's cloned records are unaffected.
7. **The rewrite window starves v2.** Mitigation: bugfix-only v2 policy with the every-fix-adds-a-differential-scenario rule (v2 maintenance strengthens the v3 gate); the window is bounded at ~20 weeks with M5's flip criteria explicit, and the phase plan fails loudly (written decisions), never silently extends.
8. **Ecosystem timing:** TanStack DB 1.0 and Vue Vapor keep moving during the window. Mitigation: the peer benches are refreshed at M5 against then-current versions; the positioning (§1) rests on the integrated pipeline, which no peer's roadmap currently targets, not on a point-in-time speed delta.

---

*File layout summary (real modules named in-text): `kernel/{key,store,delta,commit,scope,graph,order,lens}.ts`, `ops/{registry,filter,compare,between,map,ordered,group,length,aggregate,set,reduce,distinct,tap,to,keys,join,page}.ts`, `api/{proxy,write,dollar}.ts`, `render/{sink,ast,builders,jsx}.ts`, `compat/{v2-records,v2-api}.ts`, `contract/{index,backing,schedule}.ts` (+SCHEDULE.md), `ir/{expr,interp,compile}.ts`, `conformance/{legality,replay,oracle/,differential/,fuzz/}`, `perf/{workloads,mem,gates}.ts`.*
