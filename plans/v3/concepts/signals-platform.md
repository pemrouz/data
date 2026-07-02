# data v3 — concept "signals-platform"

**Stance: WIN THE ECOSYSTEM.** The 2026 field converged (TC39 Signals, Solid 2.0, Svelte 5 runes, Vue 3.6/Vapor, alien-signals) on push-dirty/pull-lazy memoized scalars with equality cut-off, glitch-free scheduled effects, explicit owner scopes, and async-first data — while TanStack DB claimed "reactive client DB" with differential-dataflow live queries, joins, optimistic mutations, and Electric sync. This concept makes `data` v3 the library that speaks BOTH dialects natively: push-based **keyed delta pipelines** for collections (the crown jewel, kept and re-founded on stable row identity) feeding **pull-lazy memoized scalars** at the edges, wired to a **keyed no-vdom renderer**, with a **versioned machine-readable contract** at the bottom (fero's seam) and a **TC39 Signal bridge** at the top.

Everything in this document is grounded in the 22-agent audit digest, PROTOCOL.md, proto/dir/{PLAN,RESULTS}.md, ISSUES.md (C14/C16), fero-v2/plan-v3.md §10 (the M0 contract), and experiments/wasm/results-altbackend.md. Where a judgment call is made, the rejected alternative is named.

---

## 1. Thesis and positioning

**The bet.** `data`'s two pillars — beat every peer on incremental-update workloads, and ship the integrated no-vdom renderer — are individually under siege: TanStack DB ships sub-ms live queries with joins over 100k rows; Vue Vapor and Solid commoditize surgical DOM. The audit's landscape verdict is explicit: *"each pillar in isolation now has a stronger incumbent; data's only defensible position is the vertically-integrated combination."* v3's bet is therefore not "a faster v2" and not "a TanStack clone" — it is the only library where **one closed keyed-delta algebra runs unbroken from the write, through incrementally-maintained operators (including joins), through pull-lazy scalar edges, into per-key DOM surgery — and out onto the wire** (fero, Electric, workers) with a versioned record grammar. O(Δ) from keystroke to paint to socket. Nobody else owns that whole vertical: TanStack stops at the framework adapter boundary (it feeds React re-renders); Solid/Vapor stop at scalars (no collection algebra, no wire story); DuckDB-WASM/Mosaic own large-N scan analytics but do not do per-row reactive DOM.

**How it answers each incumbent.**

- **TanStack DB** — v3 matches the table stakes it created (typed collections, live queries with joins, optimistic mutations with rollback, async/sync sources with pending/error states) but wins on three axes TanStack structurally can't reach: (a) the renderer — TanStack's deltas die at the React boundary; v3's deltas drive `insertBefore`-level DOM ops, so the krausest-style and brush-latency numbers compare an O(Δ) pipeline against O(Δ)+VDOM-diff; (b) per-operator tuned hot paths — v2's between brush walk, bounded-window reconcile, and bitmask membership are ported IP that a generic IVM doesn't have (v2 already posts multi-× wins over 8 peers in operators/BENCHMARK.md; TanStack joins that peer set); (c) the wire — v3's delta grammar is a versioned public contract with a distributed consumer (fero) already designed against it; TanStack's IVM is an internal detail.
- **DuckDB-WASM / Mosaic** — do not compete on large-N scan/aggregate throughput; a SQL engine with data-cube indexes wins at 10M rows and that's fine. v3 positions Arrow tables and DuckDB-WASM query results as **sources**: an Arrow adapter ingests columnar results zero-copy into a collection, and v3's edge is what Mosaic doesn't do — maintaining the last mile reactively (per-row DOM, live aggregates, optimistic local writes). The columnar acceleration (per-collection maintained columns, 63–500× measured headroom) accelerates *our* delta pipeline; it is explicitly not a query engine (RESULTS.md's own verdict: WASM only behind maintained columns; per-query marshalling 6–15× loses).
- **The signals consensus (Solid 2.0 / Svelte 5 / Vue Vapor / TC39)** — v3 stops being off-consensus on every scalar axis. Scalars (aggregates, `.to()` derivations, reactive operator args) become genuine lazy memoized computeds with equality cut-off; effects are scheduled, never run mid-propagation (deleting the transient-`undefined` defensive-binding gotcha class the chat/library examples code around); ownership is an explicit scope tree; and a thin bridge exposes/consumes TC39 `Signal.State`/`Signal.Computed` shapes (semantic alignment + bridge, not API bet — the proposal is still Stage 1). The collection layer stays push, because that is how every IVM engine works and it is where v2's identity lives.

**What is deliberately NOT abandoned.** Pillar 1 (incremental-update dominance) is protected by hard perf gates using v2's own medians as floors (§12, §14). Pillar 2 (the integrated renderer) is re-founded on keyed reconciliation — the single change the render audit calls "the highest-leverage item" — and stays a *sink*, not a framework (§5, §15).

**Why a rewrite at all** (spending only the audit's structural items, none of the patchable lists): (1) array-positional row identity — the C-series generator, the 13-verb dual-contract protocol, the mutually-exclusive C14/C16 residuals, P7's permanent O(N) fallback, ~20% of the engine as reconciliation tax; (2) the universal callable-proxy namespace — data keys, operators, built-ins, and JS protocol probes in one string namespace, unverifiable by any type system; (3) new-value-only deltas — P3/C5/C7 all one missing `oldValue` field, unaddable without touching every verb implementer; (4) GC-nondeterministic lifetime/dedup — WeakRef-only sinks, now reputationally radioactive; (5) registration-as-side-effect packaging — the root of 8× bundle duplication and the Symbol.for global registry; (6) no seam below the proxy — fero's facade, `[VIEWSYM].res` reach-ins, and the c870bde lost-write class. Each is cross-cutting; each was adversarially confirmed as not-patchable-in-place.

---

## 2. Kernel architecture

### 2.1 Storage model — keyed row store with a dense lane and opt-in maintained columns

The contradiction to resolve: perf's structural case is columnar typed arrays (63–500× measured); core/protocol/operators/render's structural case is a keyed row store. **Ruling: the keyed row store is the native store; columns are a per-collection accelerator behind the same interface.** Identity, nesting, the renderer, fero's wire, and the delta algebra all need stable keys; the columnar wins concentrate in scan-shaped operators (filter/compare/between/aggregates) that can *lower onto* maintained columns without changing the algebra. A columnar-native store would give back the transparent nested-row DX and force a row-materialization layer everywhere — the hybrid is designed here, not asserted.

```ts
// kernel/table.ts
interface Table<V> {
  rows: Map<Key, V>                      // identity substrate — the one source of truth
  order: DenseLane | null                // insertion-order lane (always present for array-born
                                         // collections; lazily created for object-born on demand)
  columns: ColumnSet | null              // opt-in: maintained typed-array columns + validity bitmask
  version: number                        // bumped once per committed transaction
}
interface DenseLane {
  keys: Key[]                            // rank → key   (packed, splice-free via tombstone + compact)
  rank: Map<Key, number>                 // key → rank
}
interface ColumnSet {
  cols: Record<string, Float64Array | Int32Array | DictColumn>
  valid: Uint32Array                     // 1 bit per slot — membership/validity
  slot: Map<Key, number>; free: number[] // key → column slot (stable; slots recycled, never shifted)
}
```

- **The dense fast lane** answers the audit's caveat that "the flat-array hot path is part of why the H7 benchmarks win": array-born collections with small integer-dense keys keep rows additionally reachable through a packed `keys[]` walk, so whole-table scans (XU0-equivalents, sort builds) run at array speed, not Map-iteration speed. Slots in `ColumnSet` are **stable** — a remove clears a validity bit and recycles the slot later; nothing ever shifts. This is the columnar-bitmask insight from the perf audit (membership flip = 1 bit write) applied *inside* the store where it's safe, instead of in the public value shape where it spawned the sparse-`undefined` gotcha family.
- **Maintained columns** are declared per collection (`store(rows, { columns: { spread: 'f64', region: 'dict' } })`) or auto-promoted by a heuristic (dev-mode suggests it when a scan operator over >N rows runs hot). Operators that can lower (compare, between, sum/avg/max/min, IR-form filter) check `table.columns` and take the typed-array path; everything else uses `rows`. The WASM SIMD kernel slots in behind the columns only, above a row-count threshold (~10⁶ per RESULTS.md finding 4), and is out of scope for 3.0 (the JS columnar path captures ~all the measured gain).
- **Derived views are dense.** No exposed `undefined` holes, ever. `peek()` on a filtered view returns only present rows. The `dense()` helper, the defensive-binding gotcha, and the `i in` bug family cease to exist as user-facing concepts (version-broken loudly; the compat entry can re-expose the sparse shape for v2 code that reads raw values — §13).

**Rejected alternative:** columnar-native store with row views materialized on read — rejected because nested mutation (`row.a.b.c`), per-row child identity, and fero's row-shaped wire all pay a materialization tax on the hot path, and because the audit's own aggregate-Float64Array fast path proves the accelerator pattern works bolted *behind* a row store.

### 2.2 Row identity — where keys come from, and yes, they survive the wire

**Exact answer.** Every row in every collection has a stable opaque string key, fixed at ingestion, never derived from position:

1. **Object-born collections** use their own property names (unchanged from v2 — the audit notes object-keyed sources "were correct throughout the entire saga").
2. **Array-born collections** take a `key` extractor if the rows carry natural identity: `store(rows, { key: r => r.id })`.
3. **Otherwise the kernel mints keys**: `k0, k1, k2 …` from a per-runtime monotonic counter exposed as `runtime.keygen` — the injectable seam that replaces `$.random` (tests override it for determinism; 7 test files + the proto fuzz depend on that seam existing).

Index is a **derived projection** of the DenseLane, not identity. `col.at(3)` resolves rank→key→row; a remove decrements later ranks in the lane bookkeeping but no row's *key* changes — so BR1A/BI0A/BH1/BF0/BMV1, the V1 shift-refresh, the `owns` guards, RowOperator's four array handlers, and the C14/C16 paradox are all unrepresentable, exactly as the core-engine audit's redesign section specifies.

**Wire survival:** minted keys ARE the wire keys. Deltas carry `key`; inserts carry `at` (the insertion rank) when the collection is order-bearing; a remote peer folding the stream reconstructs the identical keyed table *and* the identical dense lane. This closes proto/dir/README's "two wire profiles" gap by construction — there is no hole-vs-splice distinction left to serialize. For the v2-compat ChangeRecord profile, array-born keys are projected back to indices at the sink boundary (§13), which is lossy in exactly the way v2 itself was lossy.

### 2.3 The delta algebra — exact canonical records

**Update is FIRST-CLASS and carries `oldValue`. It is not retract+insert.** This is the ruling on the digest's second contradiction. Rationale: (a) no-phantom-events, "rotation emits updates," and fero's 4-type wire shape are HARD invariants that a retract+insert algebra breaks wholesale; (b) the O(1) in-place nested-edit path (`BU2`-class, the swarm/patch flagship) is a benchmark the landscape audit explicitly warns a Z-set core could regress; (c) the thing Z-sets actually buy — closed composition — comes from having **one delta shape with exhaustive discriminated-union consumers**, not from integer weights; keyed collections are sets (weight ∈ {0,1}), so weights are dead freight; (d) `oldValue` gives us the one thing Z-sets have that v2 lacked (invertibility — retract needs the old row), closing P3/C5/C7 and making optimistic rollback free (§7). d2mini's lesson (drop timestamps/frontiers) is adopted; its update-as-retract-insert is not.

```ts
// contract/types.ts — the versioned public grammar. SCHEMA_VERSION = 3.
export type Key = string

export type Delta<V = unknown> =
  | { readonly kind: 'insert'; readonly key: Key; readonly value: V;
      readonly at?: number }                                   // at = insertion rank, order-bearing collections only
  | { readonly kind: 'update'; readonly key: Key;
      readonly value: V; readonly oldValue: V;
      readonly path?: readonly string[] }                      // path present ⇒ value/oldValue are the values AT
                                                               // that sub-path (the O(Δ) nested-edit channel)
  | { readonly kind: 'remove'; readonly key: Key; readonly oldValue: V }
  | { readonly kind: 'reset'; readonly value: unknown }        // whole-collection replace (XU0 analog); consumers
                                                               // MAY treat as remove-all + insert-all

export type OrderDelta =
  { readonly kind: 'move'; readonly key: Key; readonly from: number; readonly to: number }
  // emitted ONLY by ordered views (sortBy / windows / paginate); plain collections never move

export interface Batch<V = unknown> {
  readonly deltas: readonly Delta<V>[]     // per-key coalesced: AT MOST ONE delta per key per batch
  readonly order?: readonly OrderDelta[]   // applies AFTER deltas; ranks refer to post-delta state
  readonly txn: number                     // monotonic per-runtime transaction id (causality/devtools)
  readonly origin?: unknown                // opaque write token — fero's echo suppression (§7)
}
```

**Emission invariants (the conformance kit enforces these — §11):**

- **No phantom events** — carried forward verbatim (audit: HARD, DECISIONS C8). A no-op write (Object.is-equal leaf, same-reference row) emits nothing; upserts split at the table into insert-vs-update; the kit's legality checker rejects update/remove for absent keys and insert for present keys.
- **Per-key coalescing within a batch** — insert+update ⇒ insert(final); insert+remove ⇒ nothing; update+update ⇒ update(first old, last new); update+remove ⇒ remove(first old). This single rule deletes the entire "removes-before-fills / echo-order / mid-cascade sibling reads" theorem family (C9/C11/union-re-rank): intra-batch ordering cannot matter because there is nothing to order per key. It is the Z-set consolidation step without the weights.
- **Replay ≡ snapshot** — folding a collection's batches from its connect-snapshot must equal `peek()` after every batch. This is the flow essay's duality as an executable law, and the property whose absence hid C8 for months.
- **`oldValue` is mandatory** on update/remove. Cost note: for whole-row `set()` the old row is already in hand (the Map slot); for nested `path` updates the old *leaf* is read before write — O(path), not a clone. No structuredClone anywhere in the kernel; snapshot isolation is a **sink option** (§7), not a tax (fero measured the mandatory clone at 30–40% of its write budget).

### 2.4 Ordering and top-k over the algebra

The acknowledged Z-set hard spot, solved as the audits prescribe: **one dedicated ordered-view structure at the edge**, not ordering in the core algebra.

```ts
// kernel/ordered.ts — backs sortBy/top/limit/paginate
class OrderIndex<V> {
  tree: OrderStatTree<[SortKey, Key]>    // O(log n) insert/remove/rank; total order = (sortKey, key)
  window?: { lo: number; hi: number }    // rank window for top-k / pagination
}
```

- Total order is **(sortKey, key)** — the tie-break is specified (key lexicographic), so the differential harness's "unique-v" fence and the tie-normalizers die; ties become directly testable (tests audit, structural #2).
- A delta on the source is O(log n): remove old rank (via `oldValue` — no more `sorted.indexOf('' + id)` O(N) lookups; the sort audit's patchable item becomes the design), insert new rank, emit `move` if the row stays in-window, membership insert/remove if it crosses the boundary.
- **The bounded-window reconcile is ported as the positional projection rule.** Natively, a window rotation IS remove(evicted)+insert(entrant) — honest keyed semantics. The v2 HARD invariant "rotation emits content-stable updates, never remove+insert" was a *positional* statement (position p's content changed). It survives exactly where positional consumers live: the **positional projection** (compat sink §13, and the DOM sink's index-addressed mode) converts window remove+insert+move batches into content-stable per-position updates plus tail-only splices — the same theorem ZAValue._window encodes, now implemented once in one projection instead of per-operator. Native keyed consumers (the renderer's keyed mode, fero's keyed profile) get the honest stream and never see a flash because they address rows by key.
- `limit(n)` over any collection windows the DenseLane (insertion order) — deterministic "first n by insertion rank," killing the documented object-source `limit` history-dependence (a version-tightening, sanctioned by the audit as SOFT).

### 2.5 Scheduling and consistency contract — the split model, precisely

**Ruling on sync-settle vs batch-first: the split model, with synchronous read-after-write preserved and effects batched.** This is the design stance's central composition question, answered concretely:

1. **Writes commit synchronously.** Every write runs inside a transaction (a bare write is a transaction of one; `transaction(fn)`/`patch()` group writes). **Phase 1 (commit)**: apply writes to source tables; propagate per-source batches through the operator DAG in **height order** (heights assigned at edge creation; a dirty-queue keyed by height — the proven Reactively/alien-signals approach, applied to the collection DAG); every operator receives ONE settled, per-key-coalesced batch per source and emits one batch. When the write call returns, every derived collection is consistent. **Read-your-writes is therefore synchronous and exact**: `col.set(k,v); q.peek()` sees the new state — the contract every committed benchmark tick, example, and fero's write-capture assumes survives verbatim, so the benchmark corpus is not invalidated.
2. **Scalars are pull-lazy at the edges.** Aggregates and computeds carry a version stamp; commit marks them stale (for incremental aggregates, commit also folds the delta into their running state — cheap, O(Δ), no user code); the *user-visible read* happens on `.get()`, with equality cut-off suppressing downstream recomputation. Reads always happen against committed state, so scalars cannot glitch by construction (there is no mid-propagation read window). Diamond dependencies resolve by version comparison, not by delivery order.
3. **Effects and subscribers are scheduled, never mid-cascade.** DOM bindings, `effect()`, and default `subscribe()` callbacks flush once per **microtask** (coalescing all transactions in the task), in dependency order. `subscribe(cb, { sync: true })` and `flushSync()` exist for the two consumers that genuinely need synchronous delivery: benchmarks and fero's write-capture sink. `tap`-class per-delta observation is `q.deltas(cb)` which fires post-commit within the write call (sync) but only ever with settled batches — one call per batch, preserving the bare-tap granularity contract.
4. **Glitch-freedom across the push/pull boundary — the honest answer.** Three rules: (i) a scalar reading collections reads only committed state (rule 3 forbids mid-commit user code), so it can never observe a half-propagated diamond; (ii) a scalar feeding INTO the DAG (a reactive operator argument — a between bound, a sort n, a filter value) is registered as a DAG **input node with a height below its dependents**: writing it enters Phase 1 like a collection write; a `computed` used as an argument is *watched* (eager-on-commit, standard signals semantics for observed computeds), so its recomputation is ordered before the operators that consume it; (iii) effects observe only post-flush state. Push (collections, topologically ordered, eager) and pull (scalars, versioned, lazy) meet only at commit boundaries — there is no interleaving in which a glitch is expressible. This deletes the transient-undefined class: a re-point/facet cascade is one transaction; bindings never see the intermediate world.
5. **Re-entrancy contract (versioned — fero M0 item 4).** A write inside any callback starts a NEW transaction queued FIFO behind the current flush (v2's transact discipline, kept semantically); callbacks are exception-isolated and failures surface as one `AggregateError` after settle (fixing the `_errors[0]` swallow); the `origin` token threads from the initiating write through every resulting batch, so fero's echo suppression becomes `if (batch.origin === me) return` — declarative, deleting the c870bde timing-dependent-boolean failure class. This contract is written down with SCHEMA_VERSION and contract-tested from fero's CI (§7).

**Rejected alternatives:** (a) full batch-first with microtask commit (Solid 2.0-style stale sync reads) — rejected because it version-breaks read-your-writes, invalidating the entire committed benchmark corpus and fero's write pipeline for a benefit (write coalescing) that `transaction()`/`patch()` already deliver opt-in; (b) full sync effects (v2 status quo) — rejected as the documented glitch/gotcha generator and off-consensus with every 2026 peer.

### 2.6 Ownership and lifecycle — owner scopes; WeakRef demoted to a dev-mode leak detector

**Ruling on WeakRef vs scopes: explicit ownership is the semantic model; the zero-ceremony DX is preserved structurally, not by GC.**

```ts
// kernel/graph.ts
interface Owner { parent: Owner | null; children: Set<Owner>; cleanups: (() => void)[] }
function root<T>(fn: (dispose: () => void) => T): T          // explicit scope
function onCleanup(fn: () => void): void
interface Subscription { dispose(): void; [Symbol.dispose](): void }  // `using sub = q.subscribe(...)`
```

- Every derived view, effect, subscription, and DOM binding is created under the **current owner**; disposing an owner synchronously detaches its whole subtree (fero M0 item 3: synchronous detach, strong retention — native now). `render()` creates an owner per mount and returns its disposer; each row instance is a child owner (so `removeEventListener` and per-row cleanup exist for the first time — the render audit's H5 class dies).
- **Deterministic dedup.** Operator views are cached on their source in a registry keyed by (operator, canonical args — §4.2) with **refcounts**; a second identical call returns the same view (a semantic guarantee, not a GC coincidence — the audit's dedup-nondeterminism structural item); disposing the last consumer disposes the operator. History-dependent operators (`distinct`) therefore give reproducible answers.
- **Leak-free-by-default, preserved honestly.** Creations outside any owner attach to the implicit runtime root. Upstream references are strong (a live operator pins its sources); downstream, a source holds its dependents strongly *while they have consumers* and drops them on refcount-zero. The v2 property "drop the tail proxy and the chain is collectable" becomes "dispose the tail (or its owner) and the chain is released deterministically" — plus a **FinalizationRegistry dev-mode backstop** that warns (with the creation stack) when an undisposed subscription is collected, converting the silent-GC-unsubscribe footgun into a diagnosable warning. This is exactly the landscape's prescribed posture (explicit scopes primary; finalizers as leak detectors only).
- **Version-break, loudly:** v2's "dropping the connect([]) return silently unsubscribes" is gone. The compat entry (§13) emulates it (compat sinks register a WeakRef mode) so ported tests keep passing during migration, with a dev warning steering to `Subscription`.

### 2.7 What replaces the 13 verbs — one emit chokepoint

All notification flows through one function: `emit(node, batch)` → height-ordered dirty queue → each dependent's `onBatch(batch, sourceTag)`. Operators implement **one typed method** consuming the closed `Delta` union (exhaustive switch — a missed kind is a compile error, the protocol audit's closed-set redesign); "what does this sink receive" is a declared capability (`orderAware: boolean` — order-agnostic consumers simply never receive `order` arrays, the BH1→BR1 fallback-lattice idea re-expressed as one flag). Multi-source operators receive a `sourceTag` (the typed successor of the undocumented `src` parameter the audit flags as load-bearing). The devtools observation hook wraps this single chokepoint (§6).

---

## 3. Public API and types

### 3.1 Design rules

Kill the callable/thenable proxy and the universal namespace (the incumbents' documented trap class, and the reason the v2 type surface is spec-by-assertion). The read surface is **non-callable objects with real methods**; the write surface is **methods only**; deep reactive reads go through one clearly-marked tracking accessor. Types are authored FIRST in `contract/types.ts`; runtime classes `implements` them, so tsc checks the dispatch — the `as Dollar` single-point-of-trust and the four-parallel-places drift are structurally gone.

### 3.2 The surface

```ts
// —— collections ————————————————————————————————————————————————
function store<V>(init?: V[] | Record<string, V>, opts?: {
  key?: (v: V) => Key                    // natural identity for array-born rows
  equals?: (a: V, b: V) => boolean       // no-op-write cut-off (default Object.is on leaves)
  columns?: ColumnSpec<V>                // opt-in maintained columns (§2.1)
}): Store<V>

interface Query<V> extends Iterable<readonly [Key, V]> {      // READ side — covariant in V
  peek(): ReadonlyMap<Key, V>                                  // raw snapshot (replaces proxy[value])
  values(): readonly V[]                                       // dense, ordered when order-bearing
  get(key: Key): Row<V>                                        // live row handle
  at(rank: number): Row<V>                                     // ordered access (dense-lane projection)
  size: Computed<number>
  status: Computed<'ready' | 'pending' | 'streaming' | 'error'>   // async sources (§7)
  subscribe(cb: (b: Batch<V>) => void, opts?: { sync?: boolean; clone?: boolean }): Subscription
  deltas(cb: (b: Batch<V>) => void): Subscription              // sync, post-commit, no clone (tap-bare successor)
  changes(cb: (r: ChangeRecord) => void): Subscription         // v2-compat record stream (§13)
  // operators — §4; all return owned, deduped, disposable derived queries
  filter(p: Pred<V>): Query<V>
  sortBy(sel: ColOf<V> | ((v: V) => Ord), o?: { dir?: 'asc'|'desc'; limit?: Arg<number> }): OrderedQuery<V>
  /* … map, groupBy, countBy, join, sum, avg, min, max, some, every, distinct, reduce, … */
}

interface Writable<V> {                                        // WRITE side — separate, invariant
  set(key: Key, value: V): void                                // upsert; kernel splits insert/update
  insert(value: V, at?: number): Key                           // mints a key (runtime.keygen)
  update(key: Key, fn: (v: V) => V): void
  merge(key: Key, patch: DeepPartial<V>): void                 // path-addressed nested write (BU2 successor)
  remove(key: Key): void
  patch(entries: Iterable<readonly [Key, V]>): void            // one batch
  reset(next: V[] | Record<string, V>): void                   // whole-value replace ($(view)-swap successor)
  apply(rec: WireRecord<V>): void                              // the PUBLIC record ingress (fero M0 item 1)
  transaction(fn: () => void): void
  optimistic(fn: (draft: Writable<V>) => void): OptimisticTx   // §7
}
interface Store<V> extends Query<V>, Writable<V> {}

// —— row handles & deep reads ————————————————————————————————————
interface Row<V> {
  peek(): V | undefined
  get(): V | undefined                    // TRACKED read (inside computed/effect/binding)
  select<P extends Path<V>>(...p: P): Computed<PathValue<V, P>>   // fine-grained leaf signal
  $: DeepReadable<V>                      // read-only tracking proxy for ergonomic nested reads:
                                          //   row.$.user.name — tracked, non-callable, get-only traps
  set(v: V): void; update(fn: (v: V) => V): void; merge(p: DeepPartial<V>): void; remove(): void
}

// —— scalars (TC39-shaped) ————————————————————————————————————————
interface Signal<T> { get(): T; peek(): T }                    // .get() = tracked, matches Signal.Computed
interface State<T> extends Signal<T> { set(v: T): void; update(fn: (t: T) => T): void }
function signal<T>(v: T, o?: { equals?: (a: T, b: T) => boolean }): State<T>
function computed<T>(fn: () => T): Computed<T>
function effect(fn: () => void | (() => void)): Subscription
// bridge: toTC39Signal(s) / fromTC39Signal(sig) — thin adapters; shapes already align (.get/.set)
```

Notes:

- **No property-name collisions are possible**: data keys live behind `get()`/`$`/iteration; operators and built-ins are ordinary methods on `Query`; `then` is not special (a `Query` is not thenable — `await q.ready` is the explicit async hatch, §7). The thenable/toJSON/`.value` armor and the ghost-child walk are deleted with their cause.
- **The `$` deep-read proxy is the ONLY Proxy in the public API**, it is read-only (get traps only, honest `has`/`ownKeys`, finite iteration), and it exists purely for nested-read ergonomics inside reactive contexts. Writes through it throw with a pointer at `.merge()/.set()` — the types-reject/runtime-accepts rift (Option B's forced compromise) cannot recur because the runtime and the types agree by construction.
- **Reactive operator args** are `Arg<T> = T | Signal<T>` — honestly typed (the covariant Signal read surface the types audit proved expressible), replacing `AnyData`. Function args remain captured-once non-reactive (documented rule, unchanged).

### 3.3 Types designed first, verified against the runtime

- `contract/types.ts` is authored in P0 before any runtime code, with the fixture-gate discipline carried over wholesale (positive fixtures + `@ts-expect-error` negatives failing CI on silent widening — the types audit's "single most valuable piece of type infrastructure").
- Runtime classes `implements Query<V>`/`Writable<V>`; operator modules extend the surface via a **typed registry entry that couples signature and implementation**:

```ts
// operators/define.ts
function defineOperator<Name extends string, Sig>(name: Name, spec: {
  signature: Sig                                   // phantom — checked against the interface merge
  create: (src: TableNode, ...args: never[]) => OperatorNode
  ir?: IRShape                                     // declarative descriptor for the contract manifest (§7)
  dedupKey?: (args: unknown[]) => string | null    // null ⇒ never dedup (closure forms)
})
declare module '../contract/types' { interface Query<V> { myOp(...): ... } }
```

  The method the consumer calls is a real prototype method installed at *class-composition time* (static imports in the entry's module graph — no registration side effect, §7 packaging), so `tsc` sees one definition, drift is a compile error, and `data/lean`'s throw-at-runtime UX is replaced by a functional `pipe(src, filter(p), sortBy(c))` form for tree-shakers.
- Kind-split honesty: `Query<V>` is the collection surface; scalars are `Signal<T>` (no `.filter()` on a sum — the fused-vocabulary lie in v2's `Data<T>` dies); `map` preserves collection-ness; `groupBy` returns typed bucket queries whose aggregates key-check.

### 3.4 JSX / builder typing

Both authoring surfaces key off the ONE shared intrinsics map (carried from v2 — it already proved the pattern):

- **Builders**: `HTML.div(props?, ...children)` where `props` is a typed object (`{ class, id, style, on: { click: fn, opts? }, ...attrs }`); the class-chain sugar (`HTML.div.foo.bar`) survives as a typed Proxy whose tag level is `keyof IntrinsicElements`-checked with a string fallback; the `'k=v'` string and `'#id'` forms are compat-entry only. `render(el, template): Disposer` is fully typed.
- **JSX**: same `jsx-runtime`/`jsx-dev-runtime` entries, per-tag narrowing on both transforms from the shared source, `key` prop now *used* (§5). The `Reactive<T>` widening tightens to `T | Signal<T>`.

---

## 4. Operator model

### 4.1 Family-by-family mapping onto the kernel

| v2 family | v3 form | Kernel mechanics | Ported IP |
|---|---|---|---|
| `filter(fn/'k',v/{shape}/[path])` | `filter(pred)` — pred = IR form or closure | keyed membership map; delta: present×pass matrix → insert/update/remove; O(1)/delta | RowOperator's process-returns-undefined economy (an operator body is ~20 lines again — the 70–90% positional bookkeeping is kernel code now) |
| `gt/lt/gte/lte` | `where(col, op, Arg<number>)` + sugar methods | same as filter; lowers onto columns when maintained | O(1)-per-edit threshold semantics; reactive threshold re-select emits coarse updates only for flipped rows (better than v2's whole-snapshot XU0) |
| `between(col,[lo,hi])` | `between(col, Arg<[number,number]>)` | **the ported brush walk**: sorted key index (now keyed by (val,key) — no positional decrement loops), `sortedDirty` amortization, full-domain alias fast path; bound moves walk only the two brush edges O(Δ) | between/index.ts's entire incremental design, minus its nine alias fork-guards (no shared-reference aliasing exists) |
| `az/za/top/limit` (windows) | `sortBy(col,{dir,limit})`, `top(n)`, `limit(n)` | OrderIndex (§2.4); O(log n)/delta; window boundary cross = membership delta + move; positional projection reproduces content-stable rotations | bounded `_window` reconcile theorem (as the projection rule); `_batchRemove/_batchInsert` one-pass window reconcile; incremental LimitValue |
| `group(fn)` / `length(fn)` | `groupBy(sel)` / `countBy(sel)` | bucket map keyed by group key; a row's key-move is remove-from-old + insert-to-new (O(1), `oldValue` gives the old bucket for free — no rebucket scans) | BOTH bucket policies preserved as options: `countBy` persists `{value:0}` buckets (fixed-keyspace histograms); `groupBy` prunes (enter/leave). The divergence is a documented option (`{ keep: 'zero' | 'prune' }`), not two accidents |
| aggregates `sum/avg/max/min/some/every` | same names → `Computed<…>` | sum/avg/count: O(1) running fold (oldValue subtracts exactly); max/min: order-stat multiset O(log n)/delta (P7 dies — array-source aggregates are incremental for the first time); empty-set semantics preserved verbatim (avg/max/min→undefined, sum→0, some→false, every→true — fero replicates these bit-for-bit) | the Float64Array fast lane (behind maintained columns); NaN-poisoning of sum kept (de-facto wire contract) with a dev-mode warn-once |
| set algebra `intersect/union/except` | same names, n-ary | **per-key bitmask membership** (ported design — the measured-16%-slower SharedMembership rejection is honored): each source delta sets/clears its bit for that KEY; visibility = mask test. No echo choreography, no primary/secondary asymmetry, no pendingShift — C12/C13/C14/C15/C16 are unrepresentable; independent-source intersect just works (keys, not positions) | intersect's bitmask + dedup of duplicate/self sources |
| `map` / `to` / `reduce` | `map(fn)` (keyed, O(1)/delta) / `to(fn)` → `computed(() => fn(q))` (pull-lazy — the 321ms `to/batch` straggler becomes ~0: nothing recomputes unless read, reads happen once per flush) / `reduce(add, remove, init)` | 3-arg reduce is O(Δ) on ALL paths including nested edits (oldValue at the path — P3 closed by design); `$.debug` refold becomes a dev-mode invariant check | assertPlainInit fail-fast; thunk-init semantics |
| `tap` | `deltas(cb)` (bare path: sync, batch-granular, no clone) / `changes(cb)` (record path: per-record, clone opt) | one chokepoint; the tapHasParam source-sniffing hack is deleted — the two paths are two named methods | the bare/clone dual-path *semantics* |
| `keys/values/reverse` | `keysQ()/values()/reverse()` | projections over the store/dense lane; incremental by construction (the name→index deferral gap closes) | — |
| `distinct` | `distinct(sel?)` | refcount multiset per distinct value; deterministic representative = lowest (sortKey,key) — history-dependence tightened away | — |
| built-ins `connect/raf/first/last/get/patch` | `subscribe`/`changes` · `raf()` coalescing writer kept as a util on State/Store · `first()/last()` → `at(0)/at(-1)` (now LIVE row handles — the snapshot-at-call surprise fixed) · `get(k)` kept · `patch` kept (now just sugar over one transaction) | | raf's flush() semantics |

### 4.2 IR vs closures, and the dedup ruling

**Policy (resolving the digest's dedup contradiction):**

- **Declarative argument forms are IR-native.** `filter({ region: 'EU' })`, `where('spread','>=',1)`, `between('col', b)`, `sortBy('col')`, `sum('col')`, `groupBy('col')`, path forms — all construct `ExprNode`s (the proto/dir grammar, promoted). IR args **dedup by canonical serialized key**, with reactive `Signal` args deduped by **signal identity** (the `arg[view]` semantics ported exactly — the audit flags this subtlety as must-keep). Dedup is deterministic because the operator cache is refcounted (§2.6), not GC-scanned.
- **Closure forms never dedup implicitly.** `filter(fn)` with the same fn reference still makes independent views (the operators audit's KEEP: authors mean two taps with distinct side-effect closures to be independent). Opt-in sharing: `filter(fn, { share: 'my-key' })`. The kanban-class pileup is solved differently and better: re-pointing is `reset()`/reactive-arg driven (deduped IR), and undisposed piles are impossible under owners.
- **CSP answer (required):** the IR evaluates through an **interpreted evaluator by default** — no `new Function`, fully CSP-safe. `compileJS` (Layer-1 codegen, proven byte-parity with hand closures at ~2.5× a call vs Layer-0's ~12×) is an accelerator enabled by one startup feature-detect (`try { new Function('') } catch { /* interpreter */ }`), used only above a row-count threshold, with the row-null guard the prototype deliberately omitted added before it defaults on. Under CSP the interpreter's tree-walk cost is mitigated by shape-specialized monomorphic node evaluators (one closure per node *shape*, built once per expression — no eval). Closures (Tier 3) always run natively and are the documented escape hatch for anything the IR can't express (`to`, general `reduce`, `tap` bodies — deliberately excluded from IR, as the proto scoped).
- `validate()/serialize()` stay **fail-closed on any embedded function** (zero executable code on the wire — the security contract, kept verbatim).

### 4.3 New operators and their cost

- **`join`** (the TanStack answer): `a.join(b, { on: [selA, selB], kind: 'inner' | 'left' }, project)`. Equi-join only in 3.0. Mechanics: hash index per side (joinKey → Set<Key>); a delta on either side touches only matching partners — O(Δ × matches) per delta, O(|a|+|b|) memory for the two indexes; output keys are `${ka} ${kb}` composites (stable, wire-safe). Update-with-join-key-change = remove old pairs + insert new pairs (oldValue supplies the old join key — this operator is *impossible to build correctly* on the v2 protocol, which is the crispest demonstration of why oldValue is in the algebra).
- **`flatMap`** — one-to-many with composed child keys (`${parentKey}/${i}` or a child `key` extractor); parent update = child-set diff by key. O(Δ × fanout).
- **`paginate(pageSize)`** over an `OrderedQuery` — rank windows on the OrderIndex; page flips are O(pageSize log n); replaces the library example's repage() idiom with a first-class op.
- **`window`/`throttle` ingestion combinators** on sources (§7) rather than operators — coalescing is a source policy, not a pipeline stage.

Cost policy: every new operator lands with a workloads entry + gate driver (Mode A, carried over), an oracle function in the conformance kit, and a descriptor in the contract manifest — the checklist discipline survives, now partly machine-enforced (a manifest entry without an oracle fails CI).

---

## 5. Render layer

### 5.1 Keyed reconciliation

`DOMSink` v3 consumes `Batch` + `order` directly:

- **One keyed row map** (`Map<Key, RowInstance>`; RowInstance = { el, owner }): insert → instantiate row template under a child owner, `insertBefore` at the rank anchor; remove → dispose owner (tearing down listeners, prop effects, nested sinks), `el.remove()`; update → nothing structural (fine-grained prop bindings already fired); **move → a real `insertBefore`** — element identity survives reorders, so focus/selection/CSS transitions/scroll survive, `key` in JSX is honored (parsed-and-discarded no more), and the kanban/chat `data-id` workaround is deletable. The dual dense-tail/index-keyed model, the O(N) `_sparse` scan, and the H1/H4/H6 regression axis are deleted with their cause.
- The **structure/content split is kept intact** (the render audit's "core value"): DOMSink handles only row create/remove/move; each dynamic prop is its own scoped effect (one field change = one DOM write, no diff pass — Solid-grade granularity, now with deterministic teardown).
- Sparse producers bind directly and render only present rows *by construction* (derived views are dense — the C4 differentiator is preserved without the BH1/BF0 machinery that implemented it).
- **Positional mode** (index-addressed lists with no key, e.g. a raw numeric array) uses the positional projection (§2.4) — the compat behavior, one code path shared with the compat sink.

### 5.2 Children/AST model — killing the single-static-slot

```ts
type Child =
  | { t: 'static'; text: string }            // ordered static text — '# {cur}' renders in order, the trap dies
  | { t: 'text';   sig: Signal<unknown> }    // reactive text (element identity preserved)
  | { t: 'el';     node: NodeAST }
  | { t: 'show';   when: Signal<unknown>; child: Child; else?: Child }   // explicit conditional (replaces
                                             // the undefined/false-clears-static overload)
  | { t: 'each';   q: Query<any>; row: (r: Row<any>, k: Key) => NodeAST; keyed: true }
interface NodeAST { tag: string; ns?: 'svg'; props: TypedProps; children: Child[] }
```

Props are an explicit typed channel (no shape-sniffing; event options `{ on: { click: [fn, { passive: true }] } }` finally have a home). JSX maps 1:1 (`<For each={q}>` → `each`; `{cond && x}` → `show`); the builder maps 1:1; the trace-equivalence test technique (byte-identical instantiation logs between builder and JSX) is carried over to pin parity. SVG namespace derives from tree context at materialization (the in-place fix the audit describes, done natively).

### 5.3 Component model — small on purpose

A component is a function `(props) => NodeAST` invoked once under a child owner. It gets: `onCleanup`, `context(key)` resolved up the owner chain, and `<ErrorBoundary fallback>` (catches instantiation + effect errors in its subtree, reports through the typed error channel). That is the whole model — no lifecycle enum, no hooks, no scheduler API surface. This is the framework-creep fence for the render layer: the renderer is a *sink with an ownership tree*, and anything beyond (routing, data-fetching components, suspense orchestration) is out of scope by list (§15).

### 5.4 SSR stance: OUT of 3.0, seam reserved

Decision: no `renderToString`/hydration in 3.0. The render audit rates SSR demand "the least-proven of the structural items — no example or issue asks for it," and the concept's scope fence matters more. What we DO take from the analysis: instantiation is written as a **two-phase materialize(target)+bind pass over the inert AST** (the AST is already serializable), so a string target is a 3.x addition, not a re-architecture. The decision + trigger (first real consumer ask) is recorded in DECISIONS from day one.

### 5.5 A11y / focus policy under reorder

- Keyed moves preserve focus **by construction** (the focused element physically moves; the sink never rewrites content into a differently-ranked slot, and never programmatically touches focus).
- If the focused row is *removed*, the sink does not steal or restore focus (documented; an opt-in `restoreFocus: 'next-row' | 'container'` helper on `each` for list UIs).
- `each` documents `aria-live` interaction (surgical text updates inside a live region announce correctly because element identity is stable); a dev-mode audit warns when a keyed list under `role="listbox"`-family containers lacks `aria-setsize/posinset` bindings (offered as helpers, not magic).
- Reduced-motion: the core ships no animations; the FLIP-helper util (if any) respects `prefers-reduced-motion` by default.

## 6. Devtools contract

The devtools audit's two core-level requirements become native; everything else is a rebuilt consumer.

### 6.1 Creation-time reflection registry

Every graph node (store, operator, signal, computed, effect, sink, source adapter) is registered at creation with:

```ts
interface NodeMeta {
  id: number                      // stable numeric id — serializable, minification-safe
  kind: 'store'|'operator'|'signal'|'computed'|'effect'|'sink'|'source'
  op?: string                     // the dispatching method name — in hand at defineOperator time,
                                  // no METHOD_OF ctor-string archaeology, no replace(/Value$/) fallback
  args?: string                   // summarized args (IR forms serialize; closures → 'fn')
  parents: number[]               // data edges INCLUDING subscription edges
  owner: number                   // ownership edge
}
```

Cost discipline (carried from v2's perf-gated hooks): always-on cost is one object + registry insert per node creation (creation is cold path); the registry holds nodes weakly with FinalizationRegistry pruning. Because nodes are IDs + plain data, `$.graph()`-equivalents are **postMessage-able** — the browser-extension/remote frontend the current panel documents as impossible becomes possible.

### 6.2 Dispatch observation hook

One hook wraps the single emit chokepoint (§2.7):

```ts
runtime.devtools = {
  onCommit?: (info: { txn: number; origin?: unknown;
                      writes: { nodeId: number; deltaCount: number }[];
                      frames: { nodeId: number; inMs: number; selfMs: number }[] }) => void
}
```

- The verb-list drift class (BH1/BF0 missing from the hand-copied VERBS array) is impossible — there is one emit path and the hook sees all of it.
- `txn` is the runtime-stamped causality id: "one user mutation = one cascade" is a first-class fact, not a microtask-coalescing heuristic; scoping (trace/profile/cascades) gets ONE exact semantics (gate on the write's node subtree, the cascades-style gate-at-start the audit endorses).
- Timing records self-time vs inclusive-time per node (fixing outermost-takes-all attribution) and is captured only when the hook is set — off-state cost is one nullable-field check per commit (meets the pay-only-when-observed bar, perf-gated as before).

### 6.3 What survives from the panel

The panel is rebuilt as a pure consumer of §6.1/§6.2 (subsystem-local work, per the audit's scoping ruling): the dock/shell closed-shadow-root + `shell` escape hatch, the DOM picker and Alt-hover, the `?nopanel`/`?devtools` conventions, the localStorage dock width, the XSS `esc()` + injection Playwright test, and the eventsRing absolute-index contract all carry over as requirements. `walk.ts`, `walkGraph`, `METHOD_OF`, and the PropSink-shape archaeology (~1,000 lines) are deleted. The element→binding back-channel is preserved: bound elements carry a non-enumerable `__data_sink` (renamed from `__ripple_sink`) whose meta id links into the registry — `fromDOM`/picker keep working, and the render layer registers ALL of an element's bindings (the last-bind-wins gap closes). Every devtools change ships with a Playwright regression test (standing project rule).

---

## 7. Seam and sources

The seam audit's verdict — "if v3 makes the seam contract the design center, it wins the flagship consumer" — is adopted: the seam is designed in P0/P1, not bolted on.

### 7.1 SourceBacking — the kernel boundary below the API

```ts
// contract/backing.ts
interface SourceBacking<V> {
  snapshot(): ReadonlyMap<Key, V>                       // late-join / connect
  write(batch: Batch<V>): void                          // apply locally, or route (fero: DHT/log/LWW)
  subscribe(sink: (b: Batch<V>) => void): () => void    // push committed batches
  read?(key: Key): V | RemoteHandle<V>                  // optional: non-local key resolution
}
```

The default in-memory backing IS `Table` (§2.1). `store()` accepts a backing (`store({ backing })`); the operator pipeline sits above the seam and cannot tell local from distributed from persisted — PLAN.md's Seam-2 design, made the day-one boundary instead of a wider-blast-radius retrofit. fero's entire `dispatch.ts` facade collapses into one `SourceBacking` implementation, and its `[VIEWSYM].res` reach-ins die because…

### 7.2 fero M0 contract items — answered one-for-one

From fero-v2/plan-v3.md §10, each demanded item and where it lands:

1. **Public record-apply ingress** → `store.apply(rec: WireRecord)` / `store.applyBatch(recs)` — first-class, typed, no symbols (replaces the 5 `[VIEWSYM].res.update/insert/remove` sites).
2. **Non-cloning sink mode** → v3 inverts the default: batches are delivered **without cloning** (deltas are frozen-by-convention plain data; `oldValue`/`value` are the live references); `subscribe(cb, { clone: true })` opts INTO snapshot isolation for consumers that mutate records. fero's ~30–40% clone tax is recovered by default, and the v2-compat `changes()` stream keeps cloning (its consumers may mutate — HARD invariant there).
3. **Subscription handles with synchronous detach + strong retention** → native (§2.6): `Subscription.dispose()` is synchronous; after it returns, no further callbacks — contract-tested.
4. **Versioned re-entrancy/timing contract** → §2.5 rule 5, published as `contract/TIMING.md` under `SCHEMA_VERSION`, with a cross-repo contract-test suite fero pins in its CI against data HEAD (the c870bde class becomes a red CI light in *both* repos before it ships, not a cluster-wide lost write after).

Plus the namespace demands fero's plan states: operators resolve only from a **formally reserved exported name set** (`contract.builtins`, `contract.operators` — fero's hardcoded BUILTIN list, already stale by missing `get`, is replaced by an import), and `store.get(key)` always means the child/partition (no operator can shadow it — methods and keys are separate namespaces now).

### 7.3 The versioned machine-readable package contract

`data/contract` is a runtime-free entry (no engine imports, no symbols — PLAN.md's load-bearing property):

```ts
export const SCHEMA_VERSION = 3
export type { Delta, OrderDelta, Batch, WireRecord, ChangeRecord /* v2 profile */, Key }
export const builtins: readonly string[]                 // reserved non-operator method names
export const operators: Record<string, OperatorDescriptor>
// OperatorDescriptor = { category: 'rowop'|'aggregate-decomposable'|'holistic'|'iter'|'ordered',
//                        declarative: boolean, forms: ArgShape[] }
export function foldSnapshot(snap, recs): Snapshot        // the no-library remote client fold
export function validate(spec): Diagnostics               // fail-closed on embedded functions
```

The AI-guidance layer (llms.txt, AGENTS.md managed blocks, context7.json, cli.mjs GUIDANCE) and the README operator table are **generated from this manifest** with a CI drift check — the packaging audit's proof-by-triple-drift (fero's stale BUILTIN set, the four mutually-contradicting guidance copies, the shipped stale JSDoc) is answered by construction, using the pattern the repo already proved with `_gen-bench-md.mjs`.

**Packaging consequences:** no registration side effect exists, so `splitting: true` is safe — one shared core chunk instead of ~8 duplicated bundles; module identity replaces the Symbol.for registry for all *functional* purposes. One global key survives with a versioned name — `Symbol.for('data.v3.runtime')` — used ONLY to *detect* double-loading/mixed-version trees and warn loudly (never to share mutable state), answering the admitted cross-version-collision hazard of the `data.*` keys. `data/lean` is retired in favor of the `pipe()` functional form (tree-shaking by imports, not by empty dispatch tables).

### 7.4 Async and streaming sources — pending/error states, coalescing

```ts
const flights = store.from(src, { key: f => f.id, coalesce: 'microtask' | 'frame' | { ms: n } })
// src: Promise<V[]> | AsyncIterable<V[] | Batch<V>> | ReadableStream | SyncAdapter
flights.status   // Computed<'pending' | 'streaming' | 'ready' | 'error'>
flights.error    // Computed<unknown>
flights.ready    // Promise<void> — the explicit await hatch (queries are NOT thenable)
```

- **Pending/error are signals**, so templates bind them like any state (`<Show when={flights.status.get() === 'ready'}>…`); an errored source keeps its last-good data and flags `status` (policy: `{ onError: 'keep' | 'clear' }`).
- **Coalescing policy**: ingestion batches per microtask by default; `'frame'` for faster-than-frame feeds (the race.js/swarm per-frame settle, now a source option instead of hand-rolled rAF plumbing); async iterators are consumed pull-wise — the next chunk is requested after the previous flush completes (natural backpressure).
- **Cancellation** rides ownership: disposing the store's owner aborts in-flight fetch/iterator via AbortSignal.
- **Adapters as separate entries** (`data/arrow`, `data/electric`): the Arrow adapter ingests `Table`/`RecordBatch` zero-copy into maintained columns (the DuckDB-WASM/Mosaic interop posture from the landscape); the Electric adapter maps shape logs onto `apply()` — both are consumers of the public contract, proving the seam with non-fero consumers.

### 7.5 Optimistic mutations and transactions

```ts
const tx = orders.optimistic(draft => { draft.set('o1', {...}) })
// applied locally at once (tagged batches); later:
tx.commit()                       // drop the tag — deltas become canonical
tx.rollback()                     // apply the INVERSE batch — free because every batch is invertible
                                  // (oldValue on update/remove, key on insert)
await api.save(...).then(tx.commit, tx.rollback)
```

Rollback-by-inverse-batch is the concrete payoff of the oldValue decision — no shadow copies, no overlay collection in 3.0 (rebase-on-authoritative-write, TanStack-style, is documented as the 3.x extension if sync adapters need it; the primitive — tagged invertible batches — is designed for it).

### 7.6 Persistence / local-first stance: HOOK, not core

Persistence ships as a backing adapter (`data/persist-idb`: IndexedDB/OPFS wrapper around any backing — snapshot + changelog of WireRecords, compaction policy in the adapter), not as core capability. The flow essay's "undo/sync/audit/local-first fall out of the duality" claim becomes literally true — undo = inverse batches, audit = the batch log, sync = apply() + origin — but the *engines* for each live outside the core (fero for distribution; adapters for storage). This is the framework-creep fence at the data layer.

---

## 8. The five open questions — explicit answers

**Q1 — Storage & row identity.** A keyed row store (Map-backed) is the native store; a dense insertion-order lane gives array-born collections packed-scan speed; maintained typed-array columns + validity bitmask are an opt-in per-collection accelerator that scan-shaped operators lower onto (capturing the measured 63–500× where it lives, without giving up nested-row DX). Stable keys: object keys as-is; array rows via a `key` extractor or kernel-minted `k{n}` from the injectable `runtime.keygen` ($.random's successor). Index is a derived projection; keys survive the wire (deltas carry them; inserts carry rank as `at`; a remote fold reconstructs table + order identically). Ordering/top-k is a dedicated OrderIndex ((sortKey,key) total order, O(log n) maintenance) at the edge of the unordered keyed algebra. Nested-mutation DX survives via path-addressed `merge()` + `Row.select()`; over maintained columns, scalar leaf writes update the column slot in place.

**Q2 — Delta algebra & compat line.** One closed discriminated union: insert{key,value,at?} / update{key,value,oldValue,path?} / remove{key,oldValue} / reset, plus move{key,from,to} on ordered views only; batches are per-key coalesced with txn + origin. Update is first-class AND carries oldValue (not retract+insert) — preserving no-phantom-events, the O(1) nested-edit path, and fero's 4-type wire while gaining invertibility (P3/C5/C7 closed; optimistic rollback free). Invariants surviving verbatim: no-phantom-events, snapshot-then-deltas-on-connect, batch granularity, aggregate empty-set semantics. Version-broken loudly: rotation-emits-updates becomes remove+insert+move natively but is preserved exactly through the positional projection; removes-before-fills is superseded by atomic per-key-coalesced batches; sparse-undefined value shapes die. fero's `{type, key: string[], value, at?}` ChangeRecord is a **lossless compat profile**: a `changes()` sink maps kind→type, [rowKey,…path]→key, rank→at, cloning values — byte-compatible for object sources, index-projected for array sources (exactly v2's own lossiness); the v3-native WireRecord (with oldValue + move + origin/seq/epoch extension point) ships beside it under SCHEMA_VERSION, and fero migrates on its own schedule.

**Q3 — Scheduling & consistency.** The split model: collection deltas propagate push-synchronously within a two-phase commit (apply, then topologically-ordered batch delivery in height order), so **read-your-writes stays synchronous and exact** — the committed benchmark corpus and fero's write-capture survive unchanged; scalars are pull-lazy versioned computeds with equality cut-off, read only against committed state (glitch-free by construction); effects/subscribers flush once per microtask (opt-in sync/flushSync for benchmarks and fero), deleting the mid-cascade transient-undefined gotcha class. Scalars feeding INTO the pipeline (reactive args) are DAG inputs ordered below their dependents, watched-eager on commit. Re-entrant writes queue FIFO as new transactions with exception isolation (AggregateError) — published as a versioned timing contract, contract-tested from fero's CI.

**Q4 — API surface & lifecycle.** The callable/thenable ViewProxy is replaced by non-callable objects: `Query`/`Store` with real typed methods (operators verifiable by tsc — the spec-by-assertion problem closes), a methods-only write surface (set/update/merge/remove/patch/apply), `peek()` for raw reads, and one read-only deep-tracking proxy (`row.$`) as the sole Proxy in the API — collision, thenable, and destructuring traps die with their cause. Scalars are TC39-shaped (get/set) for a near-free Signal bridge. Lifecycle: explicit owner scopes with synchronous disposal are the semantic model; operator caching is refcount-deterministic (dedup becomes a guarantee); render() returns a disposer; WeakRef+FinalizationRegistry are demoted to a dev-mode leak-warning backstop; zero-ceremony DX is preserved structurally (implicit root owner; holding the DOM keeps bindings alive because the mounted subtree holds the owner) and the v2 GC-unsubscribe behavior is a loud, shimmed version-break.

**Q5 — Seam as design center & competitive scope.** The seam IS the design center: `data/contract` (SCHEMA_VERSION, delta grammar, descriptors, builtins, foldSnapshot) is authored in P0 before the kernel; SourceBacking is the P1 kernel boundary; fero's four M0 items are answered natively (public apply ingress; no-clone-by-default subscriptions; owned synchronous-detach handles; versioned timing contract with cross-repo CI tests) so fero's wrap-or-fork fallback is never triggered. IR is the primary representation for declarative arg forms (value-keyed dedup, wire-shippable plans, column lowering) with an interpreted CSP-safe evaluator by default and feature-detected compileJS acceleration; closures remain first-class Tier-3 for the deliberately-excluded ops. Competitive scope: v3 DOES answer TanStack DB with joins, optimistic-invertible transactions, and async/sync sources-with-status — but bounded (equi-joins; rollback-by-inverse; adapters out of core), because the defensible position is the vertically-integrated combo (closed keyed delta engine + surgical keyed DOM sink + Arrow/columnar acceleration + the wire contract), not feature-count parity.

---

## 9. Contradiction resolutions (the digest's ledger, ruled)

1. **Sync-settle vs batch-first** — Split ruling (§2.5): writes commit + propagate synchronously (read-your-writes preserved; benchmarks/fero valid); *effects* batch per microtask with sync opt-in. Neither camp gets everything: the perf audit's per-write cascade tax is mitigated by per-key coalescing + one-batch delivery + a singleton-tx fast path, not by giving up the consistency contract.
2. **Update vs retract+insert (Z-set)** — Update is first-class with mandatory oldValue (§2.3). Z-set closure is achieved by the closed union + per-key coalescing + exhaustive sinks; weights rejected as dead freight; the flagship in-place-edit benchmarks keep their O(1) path. Rotation-emits-updates survives via the positional projection only — natively it is honest remove+insert+move (documented version break for native-stream consumers; fero rides the compat profile).
3. **Columnar vs keyed store** — Keyed store native; columns as per-collection opt-in accelerator with stable slots + validity bitmask; dense lane for packed scans (§2.1). The 63–500× is captured where it lives (scan-shaped ops); identity/renderer/wire keep keys.
4. **WeakRef vs owner scopes** — Owners primary, deterministic dispose, refcounted operator caches; WeakRef/FinalizationRegistry demoted to dev-mode leak detection; the v2 semantics are a loud version-break with a compat-entry emulation (§2.6). Both sides' "leak-free-by-default must survive" is honored structurally.
5. **Dedup policy** — IR/value args dedup by canonical key (+ signal identity for reactive args); closures never dedup implicitly (`share` opt-in); dedup determinism comes from refcounted caches, not GC timing (§4.2). Both audit claims hold, on disjoint domains.
6. **SSR scope** — Out of 3.0 (demand unproven); the materialize/bind two-phase seam is built anyway so renderToString is additive later; decision recorded (§5.4).
7. **Perf-gate slack numbers** — The crit's ~6×–480× range is adopted; the 3800× figure is discarded. v3 gates move to relative/count-based gating (H1-style op counts as the CI backbone; wall-clock as catastrophe detectors only) (§12).
8. **Reactive value-slot typing** — Ruled patchable-in-v2 (covariant readonly-[value] marker) and NOT spent as rewrite justification; v3 gets `Arg<T> = T | Signal<T>` natively (§3.2). Worth back-porting to v2 during the maintenance window if cheap.
9. **Render dense/sparse dual model** — Ruled largely-converged-in-v2 per the crit; only keyed identity is charged to the rewrite (§5.1). Not double-counted.
10. **sideEffects './register.ts'** — Load-bearing in v2 (source-path consumers); kept there. v3 has no registration side effect at all, so the entire question evaporates (§7.3).
11. **Oracle independence** — The proto fuzz's two-library-chains parity is acknowledged as implementation-as-oracle; v3's differential kit uses an independent plain-JS naive oracle per operator, written BEFORE the operators (§11).
12. **Devtools rewrite scope** — Core provides only the creation-time registry + the commit observation hook (§6); the panel is a subsystem-local rebuild, not rewrite evidence.
13. **CLAUDE.md cross-entry identity claim** — The code is right, the doc is stale: Symbol.for makes identity shared across one installed version's entries (C6 fix). v2's CLAUDE.md gets the correction during the maintenance window; v3 removes the mechanism (module identity + a versioned detection-only key).
14. **Additive seam items spent as rewrite justification** — Honored: data/ir types, foldSnapshot, descriptors, public ingress, no-clone mode are all acknowledged as v2-additive; the rewrite case rests only on the four cross-cutting inversions (SourceBacking as day-one boundary, protocol-as-contract, owned lifecycle, IR-native arg slots). Several of those additive items should ship on v2 DURING the window (§14), de-risking fero either way.
15. **C14/C16 framing** — Adopted per ISSUES.md's own calibration: deliberate low-severity trades, not "correctness fires"; the rewrite narrative charges the positional model with the permanent ~20% reconciliation tax + foreclosed incrementality (P3/P7) + the conformance-matrix growth rate — and notes that in the keyed algebra both residuals are simply unrepresentable (independent-source intersect over keys has no echo choreography to get wrong).

---

## 10. Cross-cutting policies

- **CSP / codegen** — No `new Function` in the default path anywhere (IR interpreter default; compileJS behind a one-time feature detect + row-count threshold; WASM behind maintained-columns threshold, 3.x). `validate()` fail-closed on embedded functions on any wire input. Prototype-pollution: all key ingestion passes one `safeKey()` chokepoint rejecting `__proto__`/`constructor`/`prototype` as data keys (v2's unguarded set-trap surface, closed); stores use null-prototype internals. Render layer threat model: text via `textContent` only; attribute names allowlisted against the intrinsics map; no innerHTML path in core; the devtools panel keeps its esc()+XSS test discipline.
- **Memory budget + measurement** — Budgets: ≤ 200 B steady-state overhead per row for a plain collection (Map entry + key + lane slot); ≤ 2 allocations per delta on the hot path (the delta object + batch amortized; no structuredClone, no per-fanout array snapshot, no per-read proxy pair); operator chain ≤ ~1 KB per node. Measured by a new `perf/mem` harness: heap-snapshot diff tests (retained-size per row at 10k/231k rows; steady-state allocation rate per 1k ticks via `--expose-gc` deltas; leak tests asserting zero retained growth after dispose). These run in CI as count-based gates (deterministic), with absolute bytes advisory.
- **Error handling + dev/prod split** — Typed error taxonomy (`ConfigError`, `WriteError`, `DisposedError`, `IRError`, `RenderError`); notification-phase failures aggregate into one `AggregateError` after settle (no `_errors[0]` swallow); "failure is a value" at the seam (typed error frames, never warn+wrong-answer — fero's rule 5 adopted). Dev/prod split via the `development` exports condition: dev build warns on — undisposed-subscription finalization (with creation stack), asymmetric 3-arg-reduce removers (auto refold check, the $.debug successor), NaN entering sum, writes to disposed stores, mixed-version double-load, `row.$` write attempts, un-keyed `each` over an identity-bearing collection. Most of v2's CLAUDE.md gotcha list becomes runtime warnings — the completeness critique's demand.
- **Value-domain contract** (specified BEFORE the differential kit asserts exact equality): keys are strings, normalized at one ingestion chokepoint (the `'1'` vs `1` silent-desync family dies there); `undefined` is not a legal row value (`set(k, undefined)` throws in v3-native; the compat entry maps it to remove, preserving the v2 leave idiom); `null` is a first-class value everywhere including aggregates (`_project` no longer drops it — counted, skipped only by numeric folds with a dev warning); NaN poisons sum (kept — fero bit-parity) with dev warn-once; Date/Map/Set/TypedArray legal as row values (held by reference; the compat clone path uses structuredClone semantics, so functions in rows throw there — documented); row objects are treated as immutable-by-convention between commits (the kernel never mutates user rows; users mutating rows in place must write through `merge/update` — enforced by dev-mode freeze in development builds).
- **Runtime support matrix + bundle budgets** — ES2022 baseline; evergreen browsers, Node ≥ 20, Deno, Bun, workers (kernel has zero DOM dependency; render is a separate entry); no WeakRef/FinalizationRegistry *requirement* (they only power dev warnings — production semantics never depend on GC, so exotic runtimes degrade gracefully). Budgets (min+gz, CI-gated): kernel+signals ≤ 12 KB; + full operator set ≤ 30 KB; render ≤ 12 KB; contract ≤ 2 KB; compat entry excluded from budgets (it may be fat). `splitting: true`, per-entry d.ts, ESM-only (unchanged policy).
- **Concurrency / multi-context** — No module-global cascade state: all scheduler/txn state lives on a `Runtime` instance (default singleton export; `createRuntime()` for isolation — tests, SSR-later, multiple independent graphs per page). Cross-worker: batches are structured-cloneable by construction; a worker adapter pairs `subscribe`⇄`apply` over postMessage (the columnar recompute offload path). SharedArrayBuffer explicitly out of scope for 3.0. Cross-realm: no instanceof across realms (duck-check on a versioned brand property, not Symbol.for identity).

---

## 11. Test strategy — the kit comes first

The tests audit's one unretrofittable insight is inverted into the plan: **the conformance kit and the independent oracle are built in P0, before any operator exists**, so every operator lands machine-checked from its first commit.

1. **Delta legality checker** (a ~150-line state machine, feasible ONLY because the algebra is closed): per collection — no insert for a present key, no update/remove for an absent key, per-key coalescing holds (≤1 delta/key/batch), oldValue must equal the checker's tracked value (catches stale-old bugs), move ranks in bounds and permutation-consistent, order array only on ordered views. Wrapped around EVERY operator in EVERY test via a checking sink.
2. **Replay ≡ snapshot property**: fold the emitted stream into a fresh table after every batch and assert equality with `peek()`. This catches the C8 class (value-right/stream-wrong) on the introducing commit — the property v2's snapshot-only harness structurally could not assert.
3. **Independent plain-JS oracle per operator** — `oracle/filter.ts` = `Array.prototype.filter`; `oracle/sortBy.ts` = sort with the SPECIFIED (sortKey,key) ties; etc. Doubles as the executable operator spec. Explicitly NOT built from the library (the fuzz-parity implementation-as-oracle trap is named and avoided).
4. **Generated differential grid**: operators × depth-2/3 chains × {object-born, array-born, keyed-array} × the full widened mutation vocabulary (set/insert-at/remove/merge-nested/patch-batch/reset/optimistic-rollback), seeded (mulberry32, seed+step reporting, negative control — the proto fuzz methodology adopted), small budget per-commit, large budget nightly, automatic shrinking to a minimal committed repro. `KNOWN_FAILURES` anti-rot registry mechanism carried over verbatim.
5. **v2 parity gate**: the 63-scenario differential harness is ported to run against v3 **through the compat entry**; each v2 normalizer either (a) is deleted because v3's semantics are exact (ties, distinct, limit-over-object), or (b) maps to an entry in the version-break ledger (sparse shapes, rotation stream at native profile) — no silent semantic drift. The Playwright corpus is reused as-is against the ported examples (§13), asserting DOM identity, brush parity, and console-error-free runs; e2e is made hermetic (prebuilt, static flight fixture, --workers=1) per the audit's operational notes.
6. **Contract tests** — the timing/re-entrancy contract (§2.5.5), the WireRecord/ChangeRecord profiles, and foldSnapshot round-trips run in BOTH repos' CI (fero pins data HEAD).
7. **Render trace-equivalence** — builder vs JSX byte-identical instantiation logs (v2's technique) against the new AST; a keyed-reorder focus-preservation test; the sparse-direct-binding scenarios re-expressed over dense views.

---

## 12. Performance strategy

**Protect the flagship (named workloads at risk, each a hard gate with the v2 median as floor):**

| Workload | v2 number (floor) | Risk in v3 | Mitigation |
|---|---|---|---|
| Per-op single-tick (filter/single 0.134 ms; the H7 tables vs 8 peers) | operators/BENCHMARK.md medians | scheduler + Map overhead per write vs tuned monomorphic array paths | singleton-transaction fast path (bare write commits inline, no queue); monomorphic Delta shapes (constructor-initialized, `declare`-field discipline carried over); dense lane for scans |
| Crossfilter 231k brush (H4 drag p50 3.8 ms; example feel) | perf.json H4 | between reimplementation regressing the brush walk | port the sorted-index walk verbatim on (val,key); brush = two-edge walk O(Δ); aggregates now incremental over arrays (P7 closed) makes the same brush CHEAPER than v2 |
| Bounded `za` brush (~2 ms/step, ~40 ms coalesced drag) | perf(sort) history | OrderIndex per-delta log n vs tuned batch reconcile | port `_batchRemove/_batchInsert` as OrderIndex bulk ops; positional projection amortizes per-window |
| swarm `patch` (12k agents, few-ms cascade) | swarm example | per-delta allocation in batches of thousands | patch = one transaction, one batch, per-key coalesced; no clone; budget ≤ 2 allocs/delta |
| tap-bare hot path (40% win) | tap.perf | record allocation on observation | `deltas()` hands the SAME frozen batch object to every subscriber |
| `to`/`values`/`reverse` batch stragglers (321/135/92 ms) | perf.json | — | pull-lazy `to` and incremental projections make these strictly better; gate asserts ≥10× improvement to prove the model's upside |

**Method:** Mode A single-source-of-truth (workloads + gates + report measuring the same closures), two calibrated timing presets, and the H1 deterministic op-count instrument all carry over; H1-style counts become the primary CI gate (machine-independent), wall-clock gates stay catastrophe-detectors; H6 self-regression goes gating at 1.5×+3σ-MAD on the pinned-runner numbers.

**New peer set:** TanStack DB joins bench:ops and the canonical workload (their published ~0.7 ms sorted-100k update is the direct target; v3's OrderIndex must beat it and the gate encodes that); js-framework-benchmark (krausest) is implemented for the render layer (create/replace/partial-update/select/swap/remove/append at 1k/10k rows — swap-rows is exactly the keyed-move case v2 could not win); DuckDB-WASM appears only in the honest "when to use which" doc, not as a peer to beat. The designed-for-workload bias disclosure moves onto the public landing page (methodology note), per the completeness critique.

**Memory benchmarks** (new, §10): retained/row, allocs/tick, dispose-leak — gated by counts.

**Go/no-go per phase:** every phase gate in §14 includes "all prior perf gates still green"; a red flagship gate blocks the phase — the schedule slips, the bar doesn't.

---

## 13. Migration and compatibility

### 13.1 The compat entry

`data/compat` implements the v2 surface over the v3 kernel — the strangler layer:

- `$()` returns a callable ViewProxy facade (get→child/`row.$`, apply→operator dispatch via the v3 methods, set/delete traps→`set`/`remove`, `[value]`→`peek`, thenable guard) — v2 code runs mostly unchanged, at a measured (and gated) overhead, off the golden path.
- `connect([])/connect(obj,'prop')/connect(obj,fn)` → `changes()` sinks emitting the EXACT v2 ChangeRecord stream: `{type:'update'|'insert'|'remove', key: string[], value (structuredCloned), at?}` + `{type:'move',from,to}`; snapshot-then-deltas on attach; array-born keys projected to indices; the positional projection reproduces content-stable window rotations. This is the **lossless compat profile** — v2's own tests are the acceptance suite.
- WeakRef-lifetime emulation for compat sinks (+ dev warning), `az/za/top/length/length(fn)/to` aliases, sparse-view raw-read emulation (compat `[value]` on set-algebra views re-materializes explicit-undefined holes for code that reads raw).
- **Lifetime:** maintained through the whole 3.x line; deprecation warnings from 3.1; removal earliest 4.0. Excluded from bundle budgets.

### 13.2 Codemod inventory — the 11 examples + landing

Mechanical transforms (a jscodeshift pack, `data-codemod-v3`): `$(x)` → `store(x)`; `p[value]` → `p.peek()`; `p.f[value] = v` / `p.f.update(v)` → `p.merge({f: v})` / `p.get(k).set(v)`; `delete p.k` / `.remove()` → `p.remove(k)`; `connect([])` → `changes` capture helper; `az/za('col', n)` → `sortBy('col', {dir, limit: n})`; `length()` → `size` / `count()`; `length(fn)` → `countBy(fn)` (bucket read stays `counts[k].value`-shaped via the descriptor or migrates to `.get(k)`); `$(view)`-swap → `reset()`/reactive-arg re-point; builder `'k=v'` strings → props objects.

Per-example notes: **todo/todo-jsx** — pure codemod. **crossfilter/crossfilter-jsx** — codemod + between/intersect chains unchanged by name; brushes drop their hand-rolled rAF for `coalesce:'frame'` where wanted. **swarm** — `pop.patch` maps directly; the dirty-list bridge simplifies (one transaction/frame). **flow** — the essay renders literal ChangeRecords: it stays on the compat `changes()` stream by design (its prose contract is exactly the compat profile); §6's RxJS contrast and the duality figures port untouched. **kanban** — the fractional-order DnD keeps working; the `data-id` workaround is DELETED (keyed rows — the example gets simpler, which is the marketing point); search re-point → reactive filter arg. **pivot** — nested `groupBy` buckets map to typed bucket queries; the detached-parent gotcha dies (owners). **chat** — `<For>` keyed; the transient-undefined avatar guard becomes unnecessary (batched effects) but stays harmless. **library** — facet algebra unchanged by name; bounded za → `sortBy(…,{limit})`; defensive `–` bindings deletable (dense views). **multidim + landing (race/feed/demos)** — re-pointed to the v3 entry; the per-frame settle loops become `coalesce:'frame'` sources; peer importmaps gain TanStack DB. Each port lands with its existing Playwright spec green — the examples are the regression corpus and the porting order is the strangler schedule (§14). v2 pages remain served under `/v2/` until 3.0 ships.

### 13.3 fero

fero-v2/v3 touches, enumerated: (1) ~40+ source-path imports `../../data/index.ts` → published `data@3` (or workspace pin) — publish unblocks on token renewal, not assumed instant (§ constraint); (2) hardcoded `BUILTIN` name set (already stale re `get`) → `import { builtins } from 'data/contract'`; (3) ~5 `[VIEWSYM].res.update/insert/remove` reach-ins → `store.apply(rec)`; (4) hand-declared ChangeRecord → `import type { WireRecord } from 'data/contract'` (origin/seq/epoch are the standard extension point now); (5) write-capture `connect` → `subscribe(cb, {sync: true})` with `origin` echo suppression replacing the `discarding` partition set; (6) the DECOMPOSABLE/HOLISTIC sets → operator descriptors. Items 2/4/6 are v2-additive (PLAN.md Steps A/C) and should ship during the window so fero de-risks regardless of v3's schedule.

### 13.4 Version-broken loudly (the ledger)

WeakRef auto-unsubscribe (→ owners); mid-cascade synchronous effects (→ scheduled); sparse explicit-undefined view values (→ dense); native window-rotation stream shape (→ remove+insert+move; updates preserved at compat/positional profiles); callable/thenable proxy and bare-assignment writes (→ compat entry only); operator-names-shadow-data-keys (→ separate namespaces); `Symbol.for('data.*')` shared registry (→ module identity + detection-only versioned key); `limit`-over-object and `distinct` history-dependence (→ deterministic, strictly tighter). Each entry names its shim, its detection (dev warning), and its removal horizon.

---

## 14. Phasing — staged strangler with machine-checkable gates

**Model:** greenfield kernel (identity models can't be strangled in place) + **consumer-level strangler**: the compat entry lets v2 code run on the v3 kernel, and the 11 examples + fero port one at a time behind their existing test suites. v2 lives on `main` in bugfix-only maintenance — **owner: the same maintainer; policy: fixes for shipped-reachable bugs + fero-blocking items + the v2-additive seam steps (data/ir types, descriptors, public ingress, no-clone flag); no new v2 features.** v3 develops in-repo under `v3/` (own tsconfig/test globs) until P4, then takes over the package root on the 3.0-alpha branch.

| Phase | Deliverables | Machine-checkable gate |
|---|---|---|
| **P0 — Contract & kit** (~3 wk) | `contract/` (types, SCHEMA_VERSION, descriptors, ChangeRecord profile, foldSnapshot); type fixture gates (positive + negative); conformance kit (legality checker, replay property, oracle skeleton + oracles for filter/sort/group/aggregates); fuzz harness w/ shrinking; commit proto/ into the tree | `npm run test:contract` green; fixtures compile & negatives fail-as-expected; legality checker + replay property proven against hand-written reference streams; fero signs off on WireRecord/TIMING draft (written ack in DECISIONS) |
| **P1 — Kernel** (~4 wk) | table + dense lane + columns; tx/scheduler (two-phase, heights, FIFO re-entrancy, AggregateError); owners/subscriptions; signals (state/computed/effect, TC39 bridge); emit chokepoint + devtools registry/hook; Runtime instances | kernel unit suite + fuzz (10k steps) zero legality violations; H1-style op-count determinism tests; micro-gates: `set` singleton-tx ≤ 1.5× v2 proxy-set median (interim), 0 allocs beyond budget per delta (count-gated); dispose-leak heap test green |
| **P2 — Core operators** (~4 wk) | filter/where/map/sortBy(+window)/groupBy/countBy/aggregates/to/distinct/limit; IR interpreter + compileJS behind detect; dedup registry | ported differential grid (core-op scenarios) green vs oracle AND vs v2 (compat profile); per-op perf gates: single+batch ≤ v2 medians (hard floor); to/values ≥10× v2 batch numbers |
| **P3 — Set algebra, between, join** (~4 wk) | between (ported walk), intersect/union/except (bitmask), join, flatMap, paginate, reduce(3-arg incl. nested), optimistic tx | full 63-scenario parity + set-algebra fuzz (20k steps, incl. the C14/C16 scenarios — now passing, asserted as regression tests); crossfilter-workload gate: brush p50 ≤ v2 H4; TanStack DB head-to-head: sorted-100k single update < 0.7 ms |
| **P4 — Render + first examples** (~4 wk) | AST/materialize+bind, keyed DOMSink, builders+JSX, components/context/ErrorBoundary; port todo, crossfilter, kanban, chat (+ their Playwright specs) | trace-equivalence suite green; the 4 examples' Playwright specs green on v3; keyed-reorder focus test green; krausest local run: swap-rows/partial-update in top tier vs Solid/Vapor baselines (recorded, advisory in P4, gating in P6); render bundle ≤ 12 KB |
| **P5 — Seam & sources** (~3 wk) | SourceBacking final, apply ingress, async sources (promise/stream/iterable, status/error, coalescing), Arrow adapter, persistence hook spec; fero M0 contract tests wired into both CIs | fero's M0 go/no-go checklist executable and green against v3 HEAD (the four items + namespace rules); contract tests green in both repos; async-source Playwright example (streamed flights) green |
| **P6 — Full corpus & devtools** (~4 wk) | remaining examples (swarm, flow, pivot, library, multidim, both -jsx) + landing; devtools panel rebuild; docs generated from manifest; perf dashboard re-baselined (dual-published v2/v3 during transition); memory suite gating | ALL 11 examples + landing green under Playwright; full perf suite ≥ v2 on every flagship row (the §12 table); bundle budgets met; guidance-drift CI check green; krausest gate |
| **P7 — Release** (~2 wk) | 3.0.0-rc on npm (token permitting — Pages fallback path retained otherwise); v2 LTS statement (12-month fixes); migration guide + codemod published | rc published or dist-fallback committed; codemod runs clean on all 11 examples in CI; version-break ledger complete |

Every gate is a command, not a judgment. A failed perf gate blocks the phase (the bar holds, the date moves). Total ~6 months of focused work; fero's M0 window aligns with P5.

---

## 15. Risks and mitigations

1. **v3 is slower than v2 on advertised workloads** (the named threat). Highest-risk rows: single-tick per-op latency (scheduler/Map overhead vs monomorphic arrays) and the crossfilter brush (between reimplementation). Mitigations: v2 medians as hard phase-gate floors from P2 (not a post-hoc audit); the tuned algorithms ported, not reinvented (brush walk, window reconcile, bitmask membership, aggregate fast lane — §4.1's ported-IP column is a checklist); the dense lane + singleton-tx fast path designed specifically for the microbench shape; per-key coalescing making batch workloads strictly cheaper; and an honest kill-switch — if P2/P3 gates cannot be met after tuning, the concept mandates re-scoping (e.g., hybrid store adjustments) BEFORE building the render layer on top, at ~2-phase cost rather than post-launch reputation cost. Note the asymmetric upside already measurable: P3/P7 close, `to` goes lazy, joins exist — several v2 straggler rows improve by construction.
2. **Scope balloons into a framework.** The fence is a list, enforced in review: IN — collections, signals, operators (incl. join/paginate), renderer-as-sink with minimal components, contract/seam, async sources, optimistic primitives, adapters as separate entries. OUT — router, forms, suspense orchestration, CSS, HTTP client, sync engines (adapters only), persistence engines (hook only), SSR (3.x, seam reserved), compilers. Any IN addition requires a named consumer and a gate. The renderer's component model is deliberately minimal (§5.3) — the moment it grows lifecycle vocabulary, we are competing with Solid on Solid's turf instead of winning on the vertical.
3. **TanStack DB ships 1.0 and owns the mindshare window.** Mitigation: don't race feature-count; publish the two things it can't do — end-to-end O(Δ)-to-paint numbers (krausest + brush latency, head-to-head, honest methodology) and the wire contract (fero + Electric + Arrow adapters as proof) — and interop rather than compete at the edges (a TanStack-collection source adapter is cheap and disarming).
4. **fero timing slips / contract mismatch.** The contract types + timing doc freeze in P0 with fero's written sign-off; the M0 items are contract-tested from BOTH CIs starting P5; fero's fallback (thin wrapper, measured cost) is explicitly acceptable interim because the compat profile is lossless — the wrap-or-fork cliff is designed away.
5. **Two-engine maintenance drag.** Bounded by the strangler: v2 is bugfix-only with a published LTS window; the v2-additive seam steps ship early so fero de-risks without waiting; the examples port one at a time so there is never a big-bang cutover day.
6. **TC39 Signals churn.** Semantic alignment + thin bridge only (§3.2); the proposal stalling costs nothing, the proposal landing makes the bridge a one-liner.
7. **Compat-entry fidelity becomes a tar pit.** The compat surface is scoped to what the corpus actually exercises (v2's own tests + examples define it — an executable spec); anything outside that is documented-unsupported. The compat entry is excluded from perf budgets and marked non-goal for optimization.
8. **CSP/interpreter perf cliff.** The interpreter is the default and is gated in P2 like everything else (shape-specialized evaluators); compileJS is a bonus, never a requirement; the docs state the CSP posture plainly.

---

## Appendix A — module layout

```
v3/
  contract/        types.ts  backing.ts  descriptors.ts  changeRecord.ts  fold.ts  TIMING.md   (runtime-free)
  kernel/          table.ts  lane.ts  columns.ts  tx.ts  graph.ts (owners/heights)  signal.ts
                   ordered.ts  ir/ (expr.ts interp.ts compile.ts)  emit.ts  runtime.ts
  operators/       define.ts  filter.ts  compare.ts  between.ts  sort.ts  group.ts  aggregate.ts
                   set.ts (intersect/union/except)  join.ts  flatmap.ts  map.ts  reduce.ts
                   distinct.ts  paginate.ts  project.ts (keys/values/reverse)
  render/          ast.ts  materialize.ts  dom.ts  builders.ts  jsx-runtime.ts  intrinsics.ts
  sources/         async.ts  arrow.ts  electric.ts  persist-idb.ts     (separate entries)
  devtools/        registry.ts  hook.ts  panel/ (rebuilt consumer)
  compat/          proxy.ts  connect.ts  aliases.ts  sparse.ts          (the v2 facade)
  conformance/     legality.ts  replay.ts  oracle/  grid.ts  fuzz.ts
  perf/            workloads.ts  mem/  gates
```

Entries: `data` (kernel+operators+signals), `data/render`, `data/contract`, `data/compat`, `data/devtools`, `data/jsx-runtime`, `data/arrow` … — `splitting: true`, one shared core chunk, no side-effect imports anywhere.

## Appendix B — judgment calls and their rejected alternatives (index)

Z-set weights (rejected: §2.3) · columnar-native store (rejected: §2.1) · batch-first stale reads (rejected: §2.5) · retract+insert updates (rejected: §2.3) · mandatory explicit disposal without implicit root (rejected: §2.6) · callable proxy retained-with-armor (rejected: §3.1) · kernel auto-dedup of closures (rejected: §4.2) · SSR in 3.0 (rejected: §5.4) · WASM in core (rejected/deferred: §2.1, per RESULTS.md) · registration side effect retained (rejected: §7.3) · new package name (rejected: constraint — the name `data` is kept; mixed-tree hazard answered by the detection-only versioned key).

