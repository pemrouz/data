# data v3 — concept "columnar-ir"

**Design stance: raise the performance ceiling.** The audit quantified 63–500× headroom between the
row-object engine and a plain-JS columnar backend on the library's own flagship workloads
(`experiments/wasm/results-altbackend.md`: gte→js-columnar 63.49× per tick at N=10k, 219.75× at
N=100k, 84–500× on batch, 48–74× on threshold change, and setup 10–28× *faster* — the one scenario
v2 loses today becomes a win). This concept makes that headroom the design center instead of a
bolted-on fast path: **columnar typed-array storage with validity bitmasks as the native store for
tabular sources**, **the serializable ExprNode IR as the primary operator-argument representation**,
**Layer-1 monomorphic codegen on by default with a CSP-safe interpreted fallback**, **WASM SIMD as an
opt-in tier**, **Arrow as the interop format**, and **batch-first mutation with one settle per
flush** — while keeping, verbatim where consumers observe it, the two pillars: beat every peer on
incremental-update workloads, and ship the integrated no-vdom renderer.

Everything below is written to be executable by a senior engineer on Monday. Where a judgment call
is made, the rejected alternative is named. All file references to v2 are to
`/mnt/c/Users/pemrouz/cloud/data`; fero references are to `/mnt/c/Users/pemrouz/cloud/fero-v2`.

---

## 1. Thesis and positioning

**The bet.** The 2026 competitive landscape closed both of data's pillars taken separately:
TanStack DB ships incremental live queries (joins, sub-ms over 100k rows, optimistic mutations,
Electric sync) with TanStack distribution; Vue Vapor / Solid 2.0 / Svelte 5 commoditized the
no-vdom surgical renderer with compiler backing; DuckDB-WASM + Mosaic own the large-N analytics
niche with data cubes and Arrow transport. What **nobody** ships is the vertical: *a columnar
delta engine whose deltas flow, in O(Δ), all the way into per-binding DOM writes*. TanStack DB's
IVM is row-object JS feeding React re-renders at the component boundary; Mosaic doesn't do live DOM
at all; the signals renderers have no collection algebra. data v3's defensible position is that
vertical, and the columnar kernel is what makes it not just defensible but *unmatchable on the
benchmark page*: the 63–500× headroom is against v2's own best path, and v2 already beats the peer
set on those workloads. A v3 that captures even a third of that headroom is not incrementally
faster than TanStack DB's ~0.7ms sorted-100k update — it is playing a different sport
(js-columnar's measured tick was 0.19–0.30µs).

**How it answers each threat, concretely:**

- **TanStack DB** — we do not chase its breadth (sync engine, query builder, framework adapters) in
  3.0. We beat it where our identity lives: single-row and batch incremental cost over tabular
  collections (columns + bitsets vs row objects + generic IVM), and we ship the thing it
  structurally cannot: the delta stream terminating in per-binding DOM writes with keyed element
  identity, no framework in between. Its two genuinely table-stakes features — first-class async
  sources and optimistic-friendly batching — are in scope (§7); joins are a reserved v3.1 operator
  over the same keyed algebra (§4), not a 3.0 gate. TanStack DB enters the benchmark peer set (§12)
  so the claim is published, not implied.
- **DuckDB-WASM / Mosaic / Arrow** — we refuse the fight we lose (raw scan/aggregate throughput at
  10M rows against a SQL engine with data cubes) and adopt their transport: Arrow
  Table/RecordBatch/IPC is v3's columnar interop format, so a DuckDB-WASM result set or an Electric
  shape stream is a *first-class source* that zero-copy-adopts into the native store (§7). Mosaic
  computes the cube; data owns the last mile — reactive maintenance of the brushed view and the
  live DOM. This converts the strongest large-N competitor into an upstream.
- **Signals-consensus renderers** — the scalar layer adopts the consensus semantics it is currently
  off-consensus on (equality cut-off, batched effect delivery, explicit ownership, a
  Signal.State/Computed-shaped bridge for the eventual TC39 standard), but the collection layer
  stays push-based delta propagation — that is how IVM works and it is the pillar. The renderer's
  answer to Vapor/Solid is not a compiler; it is that our renderer consumes *collection deltas
  natively* (a keyed row enters → one subtree materializes; one cell dirties → one text write),
  which compiled-signals renderers still route through per-component reactive scopes.

**What this stance deliberately does NOT do:** it does not turn data into a database (no
persistence engine, no sync protocol — hooks only, §7), does not chase SSR in 3.0 (§5), and does
not bet the API on the Stage-1 signals proposal. The two pillars stay load-bearing: every design
decision below is scored first against "does the flagship incremental workload stay won" and
"does the renderer stay integrated and surgical."

**Honesty ledger up front** (the audit demands the rewrite case not be padded): the patchable lists
in the audit digest are accepted as patchable and are *not* spent here. The rewrite case for this
concept rests on exactly five things no patch reaches: (1) the row-object storage ceiling
(quantified 63–500×), (2) array-positional identity baked into the 13-verb protocol (~20%
permanent reconciliation tax, foreclosed incrementality P3/P7, the C14/C16 residual trade), (3)
closure-primary argument slots (dedup/serialization/columnar-lowering foreclosed by construction),
(4) per-write synchronous settle as the only mutation entry (the patch()/toggle-boilerplate tax and
fero's timing-contract fragility), and (5) GC-timing-dependent lifetime/dedup semantics. Additive
seam items (data/ir, descriptors, public ingress, non-cloning sink) ship regardless and are not
counted as justification — they are simply *cheaper to build right* inside v3 than to retrofit.

---

## 2. Kernel architecture

### 2.1 Storage model

The kernel's semantic model is a **rid-keyed row store with a separate order channel**. Columnar
storage is not a competing model — it is the high-performance *implementation* of that model for
tabular sources. This is the designed hybrid the audit said was "asserted in both directions but
designed in neither":

```
                    ┌───────────────────────────────────────────┐
   $(value) ───────▶│  Source node                              │
                    │   schema inference → picks a RidStore:    │
                    │                                           │
                    │   ColumnStore (tabular)   CellStore (any) │
                    │   typed-array columns     keyed JS values │
                    │   validity bitmasks       (todo/kanban/   │
                    │   dictionary strings       chat shape)    │
                    │   ref-columns for opaque                  │
                    └───────────────┬───────────────────────────┘
                                    │  ONE delta algebra, ONE operator contract
                                    ▼
                     operators (bitset membership, order indexes, bucket tables)
                                    ▼
                     sinks (DOM, connect, compat ChangeRecord, Arrow egress)
```

**`RidStore` — the kernel boundary both backings implement** (this is also the SourceBacking seam,
§7):

```ts
type Rid = number        // u32; per-source; minted at ingestion; NEVER reused
type Key = string        // user-visible stable key (object key, or minted for array rows)
type ColId = number      // small int; per-source column registry (path → ColId)

interface RidStore {
  readonly kind: 'columns' | 'cells'
  readonly liveCount: number
  has(rid: Rid): boolean
  key(rid: Rid): Key                     // stable, serializable
  ridOf(key: Key): Rid | -1
  seq(rid: Rid): number                  // insertion sequence — deterministic-order substrate
  cell(rid: Rid, col: ColId): unknown    // O(1); the renderer/aggregate read path
  row(rid: Rid): unknown                 // lazy row materialization (flyweight; see 2.1.3)
  forEach(fn: (rid: Rid) => void): void  // live rows in insertion order

  // writes arrive ONLY from the Scheduler (single writer):
  applyInsert(key: Key | null, value: unknown, at?: number): Rid
  applyUpdate(rid: Rid, path: readonly string[], value: unknown):
    { old: unknown; colset: number } | null     // null = value-equal no-op (no-phantom-events
                                                 // enforced HERE, once, at the source)
  applyRemove(rid: Rid): unknown                 // returns the removed row (the oldValue)
}
```

**ColumnStore internals (algorithm sketch).** Slot space == rid space (rids are dense u32s;
removal tombstones the slot in a `live` bitset; compaction runs when live/capacity < 0.5 and is a
*local* event — downstream state is keyed by rid, so compaction moves storage, not identity).
Columns are chunked (`CHUNK = 65536` entries) so appends never realloc-copy the whole column.
Column types: `f64`, `i32`, `bool` (bitset), `dict` (u32 codes + a per-column string dictionary
with refcounts), `ref` (a plain JS array of references — the escape hatch for nested objects,
Dates-as-objects, Maps, class instances). Every column carries a validity bitset (1 bit/row:
present vs absent). Schema is inferred from the first ingestion batch; a new field seen later adds
a column lazily (validity = absent for prior rows); a type conflict **demotes** the column to
`ref` in one O(N-column) pass (a counted, dev-warned event — see the marshalling-tax answer below).
Nested paths flatten to path columns (`'user.name'` is a column) up to depth 3 by default; deeper
or polymorphic subtrees demote that subtree to a `ref` column.

**CellStore** is the v2-shaped keyed store: `Map<Rid, value>` + key maps + insertion seq. It exists
because the honest answer to "what about todo/kanban/chat?" is: **those shapes gain little from
columns and must not pay for them.** They get the keyed identity, the closed delta algebra, the
scheduler, dedup, ownership, and the keyed renderer — which between them delete the C-series bug
class and the kanban-pileup class — and they skip the columnar machinery entirely. The two backings
are selected automatically (schema inference: ≥8 rows, ≥80% shared scalar fields → columns) and
overridable explicitly: `$(rows)` auto-detects; `$.table(rows, schema?)` forces columns;
`$.keyed(obj)` forces cells. Auto-detection failing soft (falling back to cells) is a correctness
non-event — only a perf difference, and a counted one (§12).

**The marshalling tax — when columns are (re)built, exactly:**

1. **Ingestion (once, O(N))** — and this is a *win*, not a tax: js-columnar setup measured 10–28×
   faster than v2's row-graph build (results-altbackend.md setup rows). The deleted ticker
   example's insert-rate crossover inverts.
2. **Appends** — O(1) amortized into the current chunk; no rebuild.
3. **Schema drift** — new column: O(1) (lazy, validity-backed). Type demotion to `ref`: one
   O(N) column copy, counted and dev-warned (`data: column 'price' demoted to ref (string seen at
   row 41213)`), never silent.
4. **Row materialization at the API edge** — lazy, per-read (see below); no eager row array is ever
   built.
5. **Arrow ingestion** — zero-copy adoption where physical types match (Float64/Int32/Bool/dict
   utf8); one decode pass otherwise. Arrow egress materializes column slices (the columns *are*
   Arrow-shaped by construction).
6. **compileJS / WASM lowering** — reads columns in place; no marshalling ever happens per query
   (the 6–15× cold-marshal loss in RESULTS.md is designed out by making columns the store, which
   was the whole point).

**Lazy row materialization.** `store.row(rid)` on a ColumnStore returns a **RowCursor**: a
`Proxy`-backed flyweight whose property reads are `cell(rid, colId)` lookups, with
`Symbol.toPrimitive`/`toJSON` producing the plain object on demand and a `materialize()` that
builds and caches the plain object for consumers that need a real object (the compat ChangeRecord
profile, `structuredClone`-needing sinks). Row functions in templates and IR predicates run against
cursors; compiled IR predicates skip the cursor entirely and read columns directly (the
monomorphic path). *Rejected alternative:* eager row-object shadow array (defeats the memory win
and reintroduces the dual-representation sync bugs).

**Memory profile vs row objects (honest accounting).** Per row: ColumnStore ≈ Σ(8B per f64 col +
4B per dict col + bits) + ~4.5B of identity overhead (rid maps, seq, live bits) — flights (4
numeric dims + 2 dict) ≈ 45B/row ≈ 10.4MB at 231k rows, vs v2's row object + per-row child Views +
2 proxy wrappers per property access (measured in §12's memory bench before P1 locks the design;
estimated 10–20× more). Overheads the columnar design *adds* and must budget: per-operator
membership bitsets (N/8 bytes each — 29KB per operator at 231k rows, trivial), sort indexes
(4B/row per sorted column), dictionaries (bounded: a dict column whose cardinality exceeds 50% of
rows demotes to ref — high-cardinality strings must not bloat), and the rid→DOM-node maps in the
renderer (only for rendered rows). CellStore memory ≈ v2's minus the per-row View/proxy churn.
Budgets and the harness are in §12 — the store decision is not locked until the P1 memory bench
exists, per the audit's "cannot be made on CPU numbers alone."

### 2.2 Row identity — exact answer

- **Where stable keys come from:** every row gets a `Rid` (u32) minted by the store at ingestion.
  Object sources: the object key ↔ rid bidirectionally (the key IS the user-visible identity, as
  in v2 — object sources were "correct throughout the entire saga" and this preserves why). Array
  sources: each element gets a rid at ingestion and a **minted stable key** `key(rid) = 'r' + seq`
  (seq = insertion sequence; stable for the row's lifetime, never reused, string-typed so the
  numeric-string `'1'`-vs-`1` bug family is unrepresentable). The array's initial element order
  seeds the source's order channel; **index is a projection, never identity**. `$.random` survives
  as the key-minting seam for object-source auto-keys (`insert(value)` with no key), preserving
  the deterministic-test injection point (HARD invariant).
- **Do they survive the wire?** Rids do **not** — they are process-local u32s. **Keys do.** The v3
  wire profile carries `key: string[]` paths built from stable keys (object keys or minted `rN`
  keys), plus `at` for the current position where order matters. The v2 **compat profile**
  projects array rows to *positional* keys via the order channel — bit-compatible with today's
  records (fero requirement, §7/§13). fero's LWW/log operates over keys and is unaffected;
  a remote consumer that folds the v3 profile gets stable identity for free (closing the
  proto/dir README "two wire profiles" gap — hole-vs-splice no longer exists to reconstruct).
- **Consequence:** splice-vs-hole, BR1A/BI0A/BH1/BF0/BMV1, the `owns` guards, V1's off-by-one,
  RowOperator's four array handlers, C1–C16, and P7's forced O(N) rebuilds all cease to exist *as
  concepts*. Sparse views are unrepresentable at the value surface: **derived views are dense**;
  membership travels as deltas; `dense()` and the defensive-binding gotcha class die (a
  version-visible behavior change, documented in §13 — the audit calls it "probably welcome").

### 2.3 The delta algebra — exact canonical types

Two layers, one source of truth: a **kernel batch** (columnar-friendly, allocation-disciplined,
what operators and the DOM sink consume) and the **logical record** (what `connect`/wire/devtools
see), derived mechanically from the batch.

```ts
// ── kernel layer (v3/kernel/delta.ts) ─────────────────────────────────────────
const enum DK { Insert = 1, Remove = 2, Update = 3 }

interface DeltaBatch {
  readonly epoch: number          // per-graph monotonic flush counter — the causality id
                                  // (devtools cascade id, fero echo-suppression token carrier)
  readonly node: NodeId           // emitting graph node (multi-source attribution; replaces
                                  //   v2's unused-looking `src` param — same purpose, typed)
  readonly n: number              // entry count
  readonly kind: Uint8Array       // DK per entry            ┐ parallel arrays, scratch-pooled
  readonly rid: Uint32Array       // row identity per entry  │ per scheduler; a batch-of-one
  readonly colset: Float64Array   // Update: dirty-column    │ reuses a preallocated scratch
                                  //   bitset (53 usable     │ (§2.5 fast path)
                                  //   bits; 0 = whole row)  ┘
  readonly old: readonly unknown[]  // per entry: prior cell/row value (Remove: removed row;
                                    //   Insert: undefined). CAPTURED, NOT CLONED — a column
                                    //   read or the old reference. This is what closes P3/C5/C7.
  readonly neu: readonly unknown[]  // per entry: new value (Remove: undefined)
  readonly order: OrderPatch | null // the SEPARATE order channel (ordered views only)
}

interface OrderPatch {
  readonly moves: ReadonlyArray<{ rid: Rid; from: number; to: number }>
}
```

```ts
// ── logical layer (data/ir — SCHEMA_VERSION = 3; engine-free entry) ──────────
type ChangeRecord =
  | { type: 'insert'; key: string[]; value: unknown; at?: number }
  | { type: 'update'; key: string[]; value: unknown; old?: unknown }
  | { type: 'remove'; key: string[]; value: unknown; old?: unknown }  // value kept = v2 compat
  | { type: 'move';   key: string[]; from: number; to: number; value?: unknown }

// fero provenance rides as the sanctioned extension (never core fields):
type WireRecord = ChangeRecord & { origin?: string; seq?: number; epoch?: number }
```

**Decisions, with rejected alternatives:**

- **Update is FIRST-CLASS and carries `old`.** Z-set retract+insert (the DBSP/TanStack model) is
  **rejected** as the canonical form for three load-bearing reasons: (1) "window rotation emits
  updates, never remove+insert" is a HARD consumer invariant (index.test.ts, fero's log, no
  undefined-flash on rotated child views); (2) the O(1) in-place update path is the flagship
  single-tick benchmark story — retract+insert doubles entry count and forces old-row
  materialization on every touch; (3) with columns, capturing `old` is a register read, so the
  one real advantage of retract+insert (mechanical invertibility) is had natively: every
  invertible fold gets `remove(old); add(new)` in O(Δ) on all paths including nested in-place
  edits — **P3, C5, C7 close by construction**. Weighted multiplicities are also rejected
  (duplicate-row semantics via weights buys nothing here; identity is rid, not value).
- **`move` is first-class but lives in the order channel** (`OrderPatch` in the kernel;
  `{type:'move'}` at the edge). Membership and content deltas never encode position; ordered
  consumers subscribe to the order channel, position-agnostic consumers (aggregates, counts)
  never see it — the fallback-lattice *idea* from v2 (aggregates were correct because they fell
  back) is re-expressed as a closed, declared capability instead of prototype forensics.
- **No hole/splice/shift verbs exist.** There is nothing for them to describe.
- **No-phantom-events is enforced once, in `applyUpdate`** (value-equality for scalar cells,
  `Object.is` for ref cells), not re-verified per operator — the v2 discipline (DECISIONS C8),
  relocated to the single write chokepoint. The legality checker (§11) asserts it mechanically:
  no update for a never-inserted rid, no double-insert, no remove-after-remove, old must equal
  the last-known value in dev mode.
- **`old` capture cost:** for ColumnStore scalar cells, a primitive copy (free). For `ref` cells
  and CellStore rows, `old` is the **prior reference** — explicitly *not* a deep snapshot. A
  consumer that mutates a row in place and needs a pre-image (v2's reduce wall) is served
  correctly because in v3 in-place mutation routes through `applyUpdate(path)` which captures the
  old *cell* value along the path; whole-row `old` on a nested edit is the same reference with
  the edited cell's old value carried per-entry. The compat sink `structuredClone`s per v2
  contract; native profiles do not (fero's ~30–40% clone tax recovered — §7).

### 2.4 Ordering / top-k over the algebra

Ordering is the acknowledged hard spot of any keyed algebra, and it is where v2's hardest-won IP
lives — so it is a **dedicated kernel structure, not an operator convention**:

```ts
interface OrderIndex {                    // one per (source-node, comparator)
  rank(rid: Rid): number                  // O(1): Int32Array over slot space, -1 = not ranked
  ridAt(rank: number): Rid                // O(1): packed Uint32Array
  insert(rid: Rid): number                // O(log n) find + gap-buffer shift (amortized)
  remove(rid: Rid): number
  reorder(rid: Rid): { from: number; to: number } | null   // key changed: rotate in place
  window(lo: number, hi: number): OrderWindow               // top-k / pagination views share it
}
```

Implementation: a packed rid array maintained by binary search over a comparator that reads
columns directly (`cmp(a, b) = col[a] - col[b]` — monomorphic, no property access), with a
gap-buffer layout so mid-array inserts are amortized O(√n) worst-case rather than O(n) memmove
(rejected alternative: an order-statistics tree — better asymptotics, ~3× constant-factor loss and
allocation churn at the N≤1M range this library actually serves; revisit behind the same interface
if 10M-row sorted views become real). **Ported v2 algorithms, translated to rank space:**

- **between's brush walk** — per-column shared sort index + lo/hi cursors; a bounds move walks
  only the delta ranks (O(Δ)), flipping membership bits. The lazily-resorted `sortedDirty`
  amortization and the full-domain alias fast path port directly (they are rank-space ideas
  already).
- **bounded-window reconcile** — v2's `_batchRemove`/`_batchInsert`/`_window` content-stable
  reconcile (431ms → 2ms library-brush fix) becomes the *only* window path: a window over an
  OrderIndex reconciles membership once per flush, ≤n positional updates; rotations are
  content-stable updates in the compat projection and `move`s in the native profile. The
  chained-windowed-sort bug family (C3/C10/C11) is unrepresentable because windows share the
  parent index instead of re-deriving positions from emission choreography.
- **Deterministic ties** — the comparator is always `(column, …, seq)` — insertion sequence as the
  final tiebreak. Sort ties, `limit(n)` over objects, and `distinct` representatives become
  **totally specified** (§11 removes the differential harness's unique-v fence and two of its
  three normalizers).

### 2.5 Scheduling and consistency contract — pick one, precisely

**Chosen model: eager store, deferred delivery, pull-forces-flush, auto-flush per top-level
write.** ("Split model" in the digest's taxonomy, specified to be indistinguishable from v2's
sync-settle at every point v2 consumers observe.)

1. **Writes apply to the store immediately** (`applyUpdate` etc. run inline — the store is always
   current) and stage their delta entries into the scheduler's pending batch.
2. **A top-level write outside `batch()` flushes synchronously before the write call returns** — a
   batch of one. `store` reads, derived-view reads, connect records, DOM state: all settled when
   the statement after the write runs. **Every committed benchmark tick, every example, and
   fero's write-capture observe exactly v2's write-then-read semantics.** No re-baselining of the
   corpus is forced by the scheduler (re-baselining happens once anyway for the engine swap, §12).
3. **`batch(fn)`** (the generalization of v2's `patch()`, which remains as sugar) stages all
   writes in `fn` and flushes once at the end — one delivery pass per sink, exactly the swarm
   discipline promoted to a first-class primitive.
4. **Read-your-writes inside a batch, precisely:** source reads see the store (already written).
   A derived-view read (`view[value]`, an aggregate read) inside a batch **pulls**: it forces
   delivery of the pending deltas *along that view's ancestry only* (topological partial flush),
   then reads. So reads are never stale and never glitchy; the cost of mid-batch reads is paid
   only by the reader. (Rejected: Solid 2.0's observable-staleness — it breaks the benchmark
   corpus and the mental model v2 sold; rejected: full sync per write inside batches — that's
   just v2, and it forfeits the batch win that patch() proved.)
5. **Flush = two-phase delivery.** Phase A is already done (store writes). Phase B walks the
   operator DAG in topological order, delivering each node ONE immutable, deduplicated
   `DeltaBatch` (per-node dedup: last-write-wins per (rid, colset) within the batch; insert+remove
   within one batch annihilates). Intra-batch emission-order theorems (removes-before-fills C9,
   limit's C11 collision, union's re-rank-before-insert) are **unrepresentable**: every consumer
   sees one settled batch against a settled snapshot, with canonical internal order
   removes → updates → inserts → order-patch.
6. **Effects and re-entrancy (versioned as `SCHEDULE_VERSION = 1`, contract-tested):** user
   effects (tap fns, connect callbacks, DOM sink) run in phase B, in topological order, never
   mid-application. A write issued *by* an effect during flush is staged into a **next** batch,
   drained FIFO in submission order after the current flush completes — v2's transact discipline
   kept exactly, with per-effect exception isolation and an `AggregateError` (all errors, fixing
   v2's first-error-only drop) thrown after settle. `_DRAIN_CAP` equivalent kept, configurable.
   This is the versioned re-entrancy/timing contract fero's M0 demands (the c870bde lost-write
   class becomes a spec with cross-repo contract tests, not folklore) — plus deltas carry `epoch`
   and writes accept an `origin` token so fero's echo suppression is declarative
   (`if (rec.origin === me) return`) instead of drain-order-timed boolean flags.
7. **DOM commit timing:** synchronous at flush in v3.0 (parity with v2; protects the e2e corpus
   and the "surgical update" demos), with `mount({ schedule: 'frame' })` opt-in coalescing. The
   default flips to frame-coalesced only if/when a v3.1 measurement shows it wins real workloads
   — the race/multidim engines already settle once per frame at the app layer, so the library
   default stays honest.
8. **Scalar derivations (`to`, aggregates read as scalars) get consensus semantics**: equality
   cut-off on delivery (a recomputed scalar that `Object.is`-equals its previous value emits
   nothing) and lazy pull when unobserved (§2.6). Glitch-freedom needs no graph coloring: the DAG
   is topologically ordered by construction (operators know their inputs; no dynamic dependency
   discovery in the collection layer), so phase B's order is a static toposort maintained
   incrementally on node creation. (Rejected: height/coloring machinery — needed only when
   dependencies are discovered dynamically, which only the small scalar layer does, and it
   reuses the same node-order integer.)

**Concurrency/multi-context:** all cascade state (pending batch, FIFO queue, epoch counter,
scratch buffers) lives on a per-graph `Scheduler` instance created by `$` and shared by derivation
— no module-global mutable state (v2's module-global transact state, core.ts:63-66, is retired).
Two independent graphs on one page never interleave state; cross-graph reactive args are detected
and bridged through an explicit boundary sink (dev-warned).

### 2.6 Ownership / lifecycle model

**Primary: explicit owners and handles. Deterministic. WeakRef demoted to a dev-mode leak
detector.** The v2 property worth its weight — "drop the subtree, leak nothing, zero teardown
code" — is preserved by a different mechanism: **unobserved views are passive specs.**

- **Spec vs live.** Chaining operators (`src.filter(f).za('col', 50)`) creates **spec nodes**:
  tiny, stateless descriptors (op id + normalized IR args + parent edge) cached on the parent
  (§4 dedup). A spec node materializes **live state** (membership bitsets, order indexes, bucket
  tables) only when *observed* — connected, rendered, pinned, or pulled. An unobserved chain costs
  ~nothing and cannot leak per-row state because it has none. A **pull** (`view[value]` with no
  subscribers) computes through the spec against the store (columns make this a fast scan),
  memoized per epoch. Repeated pulls at the same epoch are free; a pull after mutations
  recomputes only if an ancestor changed (epoch stamps).
- **Handles.** `connect(...)` returns a `Handle { dispose(): void; [Symbol.dispose](): void }`
  that *strongly retains* the chain and detaches synchronously on dispose (fero M0 item 3;
  `using h = view.connect(anchor, fn)` works). `connect([])`'s array-return convenience remains —
  the array is the anchor, and the handle is reachable as `arr[Symbol.dispose]`-style via the
  returned handle from the two-arg form; tests migrate to holding handles (§13).
- **Owners.** `$.root(fn)` / `mount()` (render) create owner scopes; every live view, handle,
  effect, and event listener created inside is registered on the owner and disposed with it
  (removeEventListener becomes possible; per-row cleanup hooks get a home; H5-class bugs die).
  `mount()` returns `{ el, dispose }`. Owners nest; disposing a parent disposes children
  depth-first.
- **Live-state teardown is refcounted:** a live node detaches its operator state when its last
  observer (handle, owner, downstream live node) disposes — deterministic, enumerable
  (`owner.subscriptions` — leak detection becomes assertable, deleting the perf-suite keep-bundle
  footgun class).
- **The safety net:** a dev-mode `FinalizationRegistry` warns when a handle is GC'd undisposed
  (`data: a connect() handle was garbage-collected without dispose()`), and in production the
  same registry detaches the orphaned sink so v2-idiom code (fire-and-forget connect in a script
  tag) degrades to exactly v2's behavior instead of leaking. This is the loud version-break the
  audit demands: *semantics no longer depend on GC; GC only mops up after documented misuse.*

---

## 3. Public API and types

### 3.1 Read surface

`$` stays; the proxy stays; the callable/thenable magic goes. The three colliding namespaces are
separated by a real prototype:

```ts
const src = $({ a: { done: false }, b: { done: true } })   // Coll<Row, ObjectKeyed>
const rows = $.table(trades)                                // Coll<Trade, RidKeyed> — forced columnar

src.a            // child view — property reads that DON'T collide with the method surface
src.get('filter')// child view for colliding/dynamic keys (the ONLY correct form for them)
src[value]       // raw snapshot read — unchanged
src.a.done[value]
for (const row of rows) …   // finite iterator over the live snapshot (honest reflection traps:
                            // has/ownKeys/getOwnPropertyDescriptor implemented from the store)
```

- **Operators and built-ins live on a real prototype** generated from the operator registry —
  `proxy.filter` resolves by prototype lookup *before* the get trap mints anything. No ghost
  'filter' child views, no 87-line precedence chain, no thenable/toJSON armor. A data key that
  shadows a method name is reachable only via `.get(k)` — the collision is now *defined* instead
  of ambient (dev-mode warns when a store key shadows a method name).
- **`await proxy` is version-broken.** Proxies are not thenables in v3 (the trap class the
  incumbents engineered away). `proxy[value]` is the snapshot read; `$.snapshot(proxy)` is the
  explicit form. The compat entry (§13) restores the thenable for migration with a dev warning.
- **`first()/last()/get(k)/keys()/raf()`** built-ins survive with v2 semantics; `raf()` remains
  (it composes with the scheduler: a raf writer stages a batch and flushes on frame).
- **Scalar bridge:** `view.signal()` returns a `{ get(): T }` Signal.Computed-shaped adapter and
  `$.fromSignal(s)` ingests one — semantic alignment with TC39 without API dependence on Stage 1.

### 3.2 Write surface

Methods-primary, exactly where v2's Option B already landed (the migration is largely done in the
example corpus):

```ts
src.a.done.update(true)        // typed write
src.a.done[value] = true       // typed write (symbol hatch, unchanged)
src.insert(row)                // mints a key via $.random (object) / rid (table)
src.insert(row, at)            // positional insert for ordered sources
src.a.remove()
src.patch([k1, v1, k2, v2])    // kept as sugar over batch()
$.batch(() => { …writes… })    // the generalized primitive (one flush)
src.apply(records)             // PUBLIC record-apply ingress (ChangeRecord[]) — fero M0 item 1;
                               // replaces the [VIEWSYM].res reach-through
```

Runtime assignment (`proxy.k = v`, `delete proxy.k`) **stays accepted at runtime** for one major
(set/deleteProperty traps route to the same applyUpdate; pre-v2-idiom JS and the noCheck examples
keep working) but is dev-warned and documented as the untyped compat path; `__proto__`/
`constructor`/`prototype` writes are rejected at the trap (the unaudited prototype-pollution
surface, closed).

### 3.3 Core generic types (v3 equivalents of Data/DataOps/ChangeRecord)

Read/write split; kind split; covariant reads. Designed FIRST (they are the spec the runtime is
checked against, not an annotation over it):

```ts
// v3/api/surface.ts (sketch — the real file is the single source of truth)
interface View<out T> {
  readonly [value]: T
  connect(anchor: object, fn: (rec: ChangeRecord) => void): Handle
  connect<A extends unknown[]>(arr: A): A          // records pushed; handle via .handleOf(arr)
  to<R>(fn: (v: T) => R): View<R>
  signal(): { get(): T }
}
interface Writable<T> extends View<T> {
  update(v: T): void
  remove(): void
}
// Collections: one ops surface, two key regimes
interface Coll<R, K extends KeyKind = KeyKind> extends View<CollValue<R, K>>, CollOps<R, K> {
  get(key: string): Child<R>
  insert(row: R, at?: number): string
  patch(pairs: unknown[]): void
  apply(recs: ChangeRecord[]): void
}
// CollOps<R, K> is EMPTY here — each operator module MERGES its own typed signature:
interface CollOps<R, K> {}      // ← declaration-merge target

// ops/filter.ts:
declare module '../api/surface.ts' {
  interface CollOps<R, K> {
    filter(pred: Pred<R>): Coll<R, K>
    filter<C extends ColOf<R>>(col: C, v: Reactive<R[C]>): Coll<R, K>
    filter(shape: Partial<{ [C in ColOf<R>]: Reactive<R[C]> }>): Coll<R, K>
  }
}
export const filterOp = defineOp('filter', { /* impl + descriptor + IR shape */ })
```

- **Pred<R> = ExprNode<R> | ((row: R) => unknown)** — the IR is the typed-primary argument; the
  closure overload is the sugar (§4.2). `Reactive<T> = T | View<T>` with the covariant
  `readonly [value]` marker the types audit proved expressible — reactive value slots are honestly
  `View<number>`, not AnyData.
- **`defineOp` is the single registration point**: it takes the impl, the capability descriptor
  (§7), the IR arg schema, and (via the declaration merge above, co-located in the same file) the
  type surface. The runtime method installed on the prototype is *derived from the same entry* —
  a `keyof CollOps`-vs-registry-keys mutual-exhaustiveness test makes drift a compile error in
  both directions, replacing the `as Dollar` single-point-of-trust and the 4-parallel-places
  maintenance. There is no registration side effect: the `data` entry statically imports every
  operator module (tree-shakable via `splitting: true` + a shared core chunk; `data/lean` is
  retired — subset builds are `import { core } from 'data/core'` + explicit `use(filterOp, …)`).
  The exported `Operators` plain object remains, **generated** from the registry (fero probes its
  own keys — HARD), alongside the exported `Builtins` set and `descriptors` (killing fero's
  hardcoded name lists).
- **The negative-fixture gate discipline carries over wholesale** (types/check.negative.ts's
  TS2578 trick), co-located per operator; the export gate pins `View/Writable/Coll/ChangeRecord/
  ExprNode/Handle` nameable from every entry.

### 3.4 JSX / builder typing

Both authoring surfaces compile to the same ordered-children AST (§5) and are typed off the one
`intrinsics.ts` v2 already proved out. The builder drops the untypeable string DSL forms as the
*typed* surface: `HTML.div({ class: 'x', id: 'y' }, …children)` is the typed form (props as an
object keyed off intrinsics); the `.class`-chaining and `'k=v'` shorthands remain as untyped
runtime conveniences for one major (used heavily by examples; codemod offered, §13). `render` is
typed `mount(el: Element, tpl: Template): Mount`.

---

## 4. Operator model

### 4.1 Family-by-family mapping onto the kernel

| v2 family | v3 kernel realization | ported v2 IP |
|---|---|---|
| `filter` / `gt`/`lt`/`gte`/`lte` / `between` | **membership bitset** over the parent's rid space; predicate evaluates via compiled IR directly on columns (or on cursors for CellStore). A predicate flip = bit write + one Update/Insert/Remove delta entry. `between` additionally owns a per-column **shared sort index** and moves bounds by cursor walk, O(Δranks). | between's brush walk + sortedDirty amortization + full-domain alias; compare's RowOperator O(1)-per-edit shape (now just "re-evaluate one row's bit") |
| `az`/`za`/`top`/`limit` (windows) | **OrderIndex** (§2.4) + window views. `limit(n)` = window `[0,n)` over the source's insertion-seq order (objects: now deterministic) or over an explicit sort. Pagination = `window(lo, hi)` — a NEW cheap operator (`slice(offset, n)`) falls out. | bounded-window content-stable reconcile; BMV1→move; AZ/ZA-as-distinct-dedup-identity (direction is part of the dedup key) |
| `group(fn/expr)` / `length(fn/expr)` | one **GroupIndex** kernel structure: group-key column (dict-encoded when columnar) → bucket id; per-bucket rid bitsets + Uint32Array counts. `length` mode: zero-buckets persist as `{value: 0}` (HARD contract); `group` mode: prune on empty (HARD contract) — the divergence is an explicit option of one structure, no longer two implementations. Key moves are O(1) rebuckets with `old` native. | length(fn)'s `{value: count}` VP-identity bucket shape; group's BU2 rebucket semantics |
| aggregates `sum/avg/max/min/some/every` | running scalars over a column + membership bitset; O(Δ) with `old` native on **all** paths — P7 dies (array-source aggregates were O(N) only because positions couldn't be trusted). max/min keep O(n)-on-evict recompute (or a monotonic heap later — same interface). Full recompute (threshold change over large N) is the **SIMD frontier** (§4.5). Empty-set semantics preserved exactly (avg/max/min → undefined, sum → 0, some → false, every → true) and NaN-poisoning of sum kept under SCHEMA_VERSION (fero replicates it bit-for-bit). | aggregate Float64Array fast path (generalized from bolt-on to native) |
| set algebra `intersect/union/except` | word-wise bitset ops over sibling membership bitsets sharing one rid space: `all = a & b & c`, `any = a \| b`, `diff = a & ~b` — 64 rows per CPU op, order-independent, no echo choreography, no primary/secondary distinction. **C12–C16 are unrepresentable**; C14/C16's "independent arrays" case becomes well-defined (independent sources are first re-keyed into a shared rid space by an explicit `keyBy` — see NEW ops). | intersect's per-instance bitmask design (measured 16% faster than shared membership — now the native representation everywhere); leave-one-out dims form |
| `map` / `to` | IR-projection `map` → **computed columns** (per-output-column expressions; a dirty input colset recomputes only affected outputs, O(Δcells)); opaque-closure `map` → a ref column of computed rows (recompute per touched rid). `to` stays a whole-value scalar derivation with equality cut-off (its `===` short-circuit preserved). | map's RowOperator few-lines shape (now `defineRowOp`) |
| `reduce` | 2-arg general fold: pull-recompute (memoized per epoch) — honest about being O(N), now lazily so. 3-arg incremental: `add`/`remove` threaded with native `old` — **O(Δ) on every path including nested in-place edits (P3 closed)**; `$.debug` re-fold audit kept as the dev-mode drift check for asymmetric removers. | reduce's thunk-init, assertPlainInit fail-fast |
| `tap` | an effect subscription in phase B: record-profile (lazy-clone: `rec.value` is a getter that clones on first read — the eager-clone tax gone) and bare-profile (0-arg fn, one call per flush) both kept; `tapHasParam` source-inspection dispatch ported verbatim. | the dual clone/no-clone paths |
| `keys` / `values` / `reverse` | trivial projections of the keyed store / order channel; `reverse` is an order transform (no state); `values` incremental (a keyed pass-through) — the 135ms/92ms batch stragglers die with the O(N) rebuild family. | — |
| `distinct` | value dictionary with per-value refcount + representative = min insertion-seq live rid — **fully specified, deterministic, incremental on all verbs** (P5 closed; the history-dependence gotcha deleted). | first-seen semantics (now specified, not history-dependent) |

**NEW operators and their cost:** `slice(offset, n)` (pagination — free over OrderIndex);
`keyBy(col | expr)` (re-key any collection into a keyed collection — the sanctioned bridge for
independent-source set algebra and the join substrate; O(N) build, O(Δ) maintain);
**`join(other, onLeft, onRight)` — reserved for v3.1**, designed now: a standard delta hash-join
over two rid spaces (per-side key → rid-set maps; a delta on either side probes the other's map,
O(Δ × match fanout)); it is *deliberately not a 3.0 gate* (scope guard, §15) but the algebra it
needs (stable keys, `old` on updates, batch delivery) is exactly what 3.0 builds, so it lands as
an operator, not a kernel change. `flatMap` is rejected for 3.0 (unbounded fan-out identity
questions; `map` + `keyBy` covers the known workloads).

### 4.2 IR vs closure policy for argument slots (CSP answer)

The **ExprNode IR is the primary representation** for every declarative slot (predicates,
projections, group keys, sort comparators-by-column, thresholds, bounds). Grammar: the proto's
one-key-object JSONLogic shape (`{eq}`, `{gt}`, `{all}`, `{field}`, `{lit}`, `{key}`, `{row}`,
`{prev}`, `{param}` — a NEW leaf for late-bound parameters, replacing capture-by-closure), with
`{fn: registryKey}` as the opaque escape hatch. Three tiers:

- **Tier 1 — interpreter (always shipped, the semantic reference).** The proto's `compile()` tree
  walk, hardened. This is the **CSP answer**: environments without `'unsafe-eval'` run Tier 1
  with zero feature loss — a documented, perf-tracked mode (§12 gates run both tiers), not a
  degraded afterthought. Feature detection is one `try { new Function('') } catch` at module init.
- **Tier 2 — `compileJS` codegen (default when permitted).** Monomorphic source-text generation
  (RESULTS.md: matches a hand closure exactly; ~5× over Tier 1 in hot scans). Hardened per the
  proto's own caveats: row-null guard emitted, the supported-op whitelist is closed, and a
  dev-mode differential (interpreter vs codegen on sampled rows) guards semantic identity.
  Columnar lowering: for ColumnStore parents the generated function reads
  `col_region[i]`/`col_value[i]` directly — no cursor, no property access (this is the 63×
  measured shape).
- **Tier 3 — opaque closures (accepted sugar, two paths).** (a) **Closure→IR lift:** a small
  CSP-safe *source-text parser* (parsing is not eval) handles the restricted subset — a
  single-expression arrow over the row parameter using member access, literals, comparisons,
  `&&/||/!`, arithmetic, and `.includes/.startsWith` — and lifts it to IR
  (`d => d.active` ⇒ `{field:'active'}`; the crossfilter/kanban/demos predicates all fit).
  A closure with **free variables does not lift** (captured bindings can't be resolved from
  source text) and stays opaque — the docs steer captures to `{param}` +
  `filter(pred, params)`. Lifting is validated in dev mode by running both forms on sampled rows;
  any divergence falls back to opaque with a warning — **never silently wrong**. (b) Genuinely
  opaque fns run as-is against row cursors: full compatibility, no dedup, no columnar lowering,
  no serialization — exactly the proto's documented Tier-3 scoping. `to`/2-arg `reduce`/`tap`
  bodies are never lifted (the proto's own exclusions, kept).

### 4.3 Dedup policy — the contradiction resolved

One rule, stated once: **arguments with value identity dedup by value; arguments without it don't.**

- IR-argued operators (including lifted closures and reactive-view args) dedup **by value**:
  cache key = `(opId, canonicalized IR JSON, bound-view node ids)` on the parent node — reactive
  args keep v2's bound-source-identity semantics (`arg[view]` → node id), now uniform across all
  operators. Because unobserved cache entries are passive specs (§2.6), the cache is strong,
  deterministic, and leak-free — **dedup is a semantic guarantee, not a GC coincidence**, and the
  kanban ~5× re-point pileup is fixed at the kernel without rAF workarounds.
- Opaque-closure arguments create a **fresh operator per call** (v2's documented rule, kept — two
  taps with distinct side-effect closures must not share state), with `view.share()` as the
  explicit opt-in to reuse a specific chain.
- `tap` never dedups regardless of argument form (side effects are not values).
- Direction/window/column are part of the dedup key (`az` vs `za`, `za('c',10)` vs `za('c',20)`),
  preserving the AZ/ZA-distinct lesson.

### 4.4 Which tuned v2 algorithms get PORTED

Named explicitly so they are work items, not rediscoveries: between's incremental sort-index brush
walk + dirty amortization + full-domain alias; the bounded-window content-stable reconcile
(including the "tail-splices-and-updates compose; mid-window splices don't" theorem, now enforced
structurally); bitmask membership (intersect's per-instance design, promoted to the universal
membership representation); the aggregate typed-array fast path; `tapHasParam`; the
no-phantom-events write filtering (relocated to `applyUpdate`); FIFO re-entrancy with exception
isolation; the `$(view)`-swap relink idiom (LinkedView semantics including the cycle-check-before-
mutate and both asymmetric throws); monomorphism discipline (declare-fields/full-constructor-init/
constant call-site shapes — now applied to `DeltaBatch` scratch reuse and the per-op `step()`
signatures).

### 4.5 WASM SIMD — the opt-in tier, scoped by the evidence

The two experiments converged and v3 treats the verdict as settled: columnar **JS** captures
roughly all of the 63–500×; WASM adds 0.5–2× scalar and ~2–4× SIMD only at N ≥ ~1M **with
maintained columns**. Therefore: WASM kernels live in an optional `data/wasm` entry, attach only
to ColumnStore-backed nodes, only on the **batch-recompute frontier** (threshold-change re-scan,
full aggregate recompute, cold filter build), gated behind a row-count threshold (default 10⁶,
measured per kernel), with the incremental O(Δ) path staying JS forever. Safari's still-flagged
relaxed-SIMD means the SIMD variant feature-detects and falls back to the scalar WASM or JS path.
Never on the seam, never marshalled per query, never the headline — the headline is columnar JS.

---

## 5. Render layer

**Keyed reconciliation.** The DOM sink subscribes to a collection view in the batch profile and
maintains `nodes: Map<Rid, RowBinding>`. Delta consumption: `Insert` → materialize the row
template once (cloneNode of a compiled template), register per-binding readers, insert at the
order-channel position; `Remove` → `nodes.get(rid).dispose()` (owner-scoped: listeners, nested
mounts, per-row effects all torn down deterministically) + `el.remove()`; `Update` → the entry's
`colset` indexes an inverted map `colId → bindings[]` so **only the touched bindings re-read**
(`binding.write(store.cell(rid, colId))`) — one dirty cell, one DOM write, no diff pass (v2's
structure/content split, kept and sharpened); `OrderPatch.move` → a real `insertBefore` —
**element identity survives reorders**: focus, selection, CSS transitions, and scroll state are
preserved, the kanban/chat `data-id` workaround dies, and JSX `key` (parsed-and-discarded in v2)
becomes meaningful as an explicit re-key for row templates whose identity isn't the source key.
Sparse producers no longer exist; binding a filtered/between view renders exactly the member rows
by construction (the C4 capability preserved with no hole protocol behind it).

**Ownership integration.** `mount(el, template): { el, dispose }` creates the root owner. Every
RowBinding is a child owner. `Event.create` registers `removeEventListener` on its owner. The
detached-parent bail becomes an assertion. "Holding the DOM keeps bindings alive" remains true
mechanically — the owner is retained by the mounted subtree — while `dispose()` is the
deterministic path. The element→binding back-channel survives as `__data_binding`
(non-enumerable, with a `__ripple_sink`-shaped compat alias for one major) so devtools
`fromDOM`/picker/alt-hover keep working.

**Children/AST model — killing the single-static-slot trap.** Templates compile (at builder/JSX
call time — no build step) to an ordered children list of explicit kinds:

```ts
type Child =
  | { k: 'static'; s: string }                          // ordered static text — '# {cur}' renders correctly
  | { k: 'text'; v: View<unknown>; f?: (v: unknown) => unknown }
  | { k: 'el'; node: ElTemplate }
  | { k: 'when'; cond: View<unknown>; then: Child[]; else?: Child[] }   // the {cond && 'x'} idiom, explicit
  | { k: 'list'; src: Coll<any>; row: RowFn; key?: (row: any) => string }
```

Props are a typed object channel (class/style/attrs/events/ref/key) — no shape-sniffing; the
`on[A-Z]`-and-not-a-VP heuristic and the hasRowFn child-sniffing become direct mappings (their
regression tests port as trace-equivalence cases). Multiple statics, static+reactive interleaving,
and conditional children are all just ordered entries. Builder and JSX are two front-ends to this
one AST; the byte-identical trace-equivalence test technique from jsx.test.ts is the parity gate.

**Component model.** Components stay plain functions, now invoked under an owner with `onCleanup`
/ `onMount` hooks and an error boundary child kind (`{ k: 'boundary', try, catch }`) — the minimum
2026 table stakes without inventing a framework (no context API in 3.0; a `provide/inject` pair
rides the owner tree in 3.1 if examples demand it).

**SSR stance: OUT for 3.0, seam reserved.** The audit is blunt that demand is unproven (no example
or issue asks for it) and the scope threat (§15) is real. But instantiation is written as the
two-phase `materialize(target) + bind` pass over the AST anyway — the DOM target creates, and the
AST is inert data — so `renderToString` and hydrate targets are v3.x work behind an existing seam,
not a rewrite. This is the cheap half of the SSR decision; the expensive half (a hydration
protocol) is explicitly deferred until a consumer exists.

**A11y/focus policy under reorder:** element identity preservation makes focus/selection survival
the default; the sink additionally guarantees it never moves the node containing
`document.activeElement` *during* a flush except via `insertBefore` (which preserves focus), and
documents ARIA-live guidance (surgical text updates into `aria-live` regions announce correctly
because the node identity is stable — a v2 weakness silently fixed). Reduced-motion is an app
concern; the sink adds no animation.

---

## 6. Devtools contract

The core ships, natively (this is the devtools audit's two rewrite-only items, nothing more):

1. **Creation-time graph registry.** Every node (source, spec, live operator, sink, mount) gets
   `{ id: number, kind, op?: string, args?: string /* summarized, pre-stringified cheap */,
   parents: number[], owner?: number }` recorded at `defineOp` dispatch time — the chokepoint has
   the method name and args in hand. Registry entries are plain serializable data (postMessage-able
   → remote/extension frontends become possible); nodes are WeakRef'd from the registry with
   FinalizationRegistry pruning (the one legitimate WeakRef use left). Minification-safe by
   construction — no ctor-name archaeology, no METHOD_OF table, and walk.ts + walkGraph +
   classify/summarize duplication (~1,000 lines) never get rebuilt.
2. **One dispatch observation hook.** `scheduler.observe(listener)` — the single flush chokepoint
   emits `{ epoch, entries: [{ nodeId, batch, tStart, tEnd }] }` per flush. The verb-list drift
   class is impossible (there is one verb surface: the batch). Causality is the epoch (one user
   batch = one epoch = one cascade — no microtask coalescing heuristic); self-time vs inclusive
   time falls out of per-node t-spans; trace/profile/cascade scoping unify on ancestry over the
   registry's parent edges (operator nodes have real parents now, fixing the structurally-empty
   Profile tab class). Off-state cost: one nullable-listener check per flush (not per row) —
   cheaper than v2's per-verb patched-wrapper bar, perf-gated the same way.

**What survives of the panel:** the seven-helper `$` surface keeps its shapes where they are
graph-derivable (`$.inspect`, `$.graph`, `$.fromDOM`, `$.highlight` port directly over the
registry; `$.trace`/`$.profile`/`$.cascades` re-implement over `observe` with the same reported
shapes). The 2,523-line panel is rebuilt subsystem-locally *after* P4 (it dogfoods v3 via an
internal-root mechanism the registry supports natively), reusing its hard-won UX (ring
absolute-index contract, closed shadow root + shell escape hatch, esc() XSS discipline, the
Playwright suite as the spec). The panel is explicitly NOT on the v3.0 critical path; `?nopanel`,
`?devtools`, and the localStorage dock-width key are preserved verbatim to keep the e2e corpus
meaningful.

---

## 7. Seam and sources

### 7.1 The kernel boundary below the proxy

`RidStore` (§2.1) **is** the SourceBacking seam — PLAN.md's interface, made the day-0 kernel
boundary rather than a retrofit: `snapshot()` ≡ store read, `read(key)` ≡ `ridOf`+`row`,
`write(record)` ≡ the Scheduler's apply path, `subscribe(sink)` ≡ a handle-returning observation.
The default in-memory backings are ColumnStore/CellStore; fero's distributed backing implements
the same interface (log-replay snapshot, DHT-routed writes, replicated-stream subscribe) and the
operator pipeline sits above it unchanged. A DuckDB/Arrow adapter is "a backing that ingests
RecordBatches"; an Electric shape stream is "a backing that applies upstream ChangeRecords."

### 7.2 fero M0 contract items — answered one-to-one

| fero plan-v3 §10 demand | v3 delivery |
|---|---|
| public record-apply ingress (v2: 5 `[VIEWSYM].res` reach-through sites) | `coll.apply(records: WireRecord[])` — first-class, batch-shaped, origin-tagged |
| non-cloning sink mode (~30–40% of fero's write budget) | connect profiles: `'records'` (v2-compat, cloning), `'records-raw'` (no clone, documented aliasing), `'batch'` (kernel DeltaBatch), `'bare'` (zero-allocation notify) |
| subscription handles, synchronous detach, strong retention | `Handle` (§2.6) — dispose is synchronous; retention is strong; enumerable per owner |
| versioned re-entrancy/timing contract | `SCHEDULE_VERSION` + the §2.5 spec + a cross-repo contract-test suite (`data/contract-tests` export) fero runs against data HEAD in its CI — the c870bde class becomes a versioned spec |

Plus the standing HARD invariants: `Operators` as a plain own-keys object (generated), `$`/`value`/
`view` named exports (view now reaches the node handle, not a mutable internal), builtins/
descriptors exported (fero deletes its BUILTIN/DECOMPOSABLE/HOLISTIC hand-sets), and aggregate edge
semantics (NaN-poisoning, empty-set values) frozen under SCHEMA_VERSION.

### 7.3 The versioned machine-readable package contract

`data/ir` ships engine-free (no symbols, no proxies): `SCHEMA_VERSION`, the `ChangeRecord`/
`WireRecord` types, the ExprNode grammar + `validate()` (fail-closed on embedded functions —
the security contract kept), `foldSnapshot()` (the no-library remote fold), operator
**descriptors** `{ name, category: 'rowop'|'aggregate-decomposable'|'holistic'|'iter'|'order',
declarative: boolean, argSchema }`, and the serialized-plan `rehydrate` spec. An `api-manifest.json`
(operators, signatures, dispatch shapes, gotchas) is generated from the registry at build time and
is the single source the AI-guidance layer (llms.txt, AGENTS.md, context7, cli GUIDANCE) is
generated from, with a CI drift check — the packaging audit's hand-copy drift class closed. Global
registry keys, where any survive for cross-bundle devtools identity, are versioned `data.v3.*` so
a mixed v2+v3 tree fails safe instead of silently corrupting (packaging HARD invariant).

### 7.4 Async / streaming sources

First-class source adapters (2026 table stakes; each returns a `Coll` plus a status scalar):

```ts
const flights = $.from(fetchArrowIPC(url))         // Promise<Table | rows> → Coll
flights.status   // View<'pending' | 'ready' | 'error'>; .error carries the reason
const trades = $.stream(ws, { coalesce: 'frame' }) // AsyncIterable/callback feed → Coll
const shape  = $.applyStream(electricShape)        // ChangeRecord-stream ingestion (Electric/fero)
```

Coalescing policy: a faster-than-frame feed stages into the scheduler and flushes per frame by
default (`coalesce: 'sync' | 'frame' | ms`), replacing every example's hand-rolled raf/settle
loop; backpressure is bounded-buffer with a declared drop-oldest/latest policy and a counted
overflow event (fero rule 4's discipline, adopted). Pending/error states are ordinary scalar views
so templates bind them declaratively. Cancellation: disposing the source's handle/owner aborts the
underlying fetch/iterator.

### 7.5 Persistence / local-first stance

**Hook, not engine.** The duality dividend the flow essay markets is delivered as primitives, not
a database: `coll.changes()` (a replayable record stream from a point-in-time snapshot),
`foldSnapshot` (data/ir), and `coll.apply()` are sufficient for undo (fold inverse using `old` —
now trivial since updates carry it), audit logs, and external persistence adapters
(IndexedDB/OPFS adapters ship as *examples*, not core). Sync engines (Electric, fero) are
backings/streams per §7.1/§7.4. Anything more (compaction, conflict resolution) is fero's lane —
the PLAN.md seam-split verdict is honored.

---

## 8. The five open questions — explicit answers

**Q1 — Storage & row identity.** A designed hybrid with the keyed model as semantics and columns
as the tabular implementation: the kernel abstraction is a rid-keyed store + separate order
channel behind one `RidStore` interface; **ColumnStore** (chunked typed-array columns, validity
bitmasks, dictionary strings, ref-columns for opaque cells) implements it for tabular sources and
captures the 63–500× headroom; **CellStore** implements it for nested/heterogeneous data
(todo/kanban/chat) which honestly gains identity/scheduling/renderer benefits, not columnar ones.
Synthetic keys are minted at ingestion (u32 rids locally; stable string keys `'r'+seq` for array
rows); **rids do not survive the wire, keys do** — the v3 wire profile carries stable keys + `at`
positions, the compat profile projects positional keys bit-compatible with v2. Ordering/top-k is a
dedicated `OrderIndex` kernel structure (packed rid array + rank map, comparator over columns,
insertion-seq tiebreak) — the Z-set hard spot answered by porting v2's bounded-window reconcile
and between's brush walk into rank space. Transparent nested-mutation DX survives: deep writes
route through `applyUpdate(path)` against path-flattened columns (≤3 deep) or ref-cells, and row
reads are lazy flyweight cursors, so the DX is preserved without an eager row-object shadow.

**Q2 — Delta algebra & the compatibility line.** One closed algebra: `{Insert, Remove, Update}`
entries keyed by rid with **update first-class and carrying `old` natively** (captured from the
column/cell at write time — no clone), plus a separate order channel carrying `move`.
Retract+insert is rejected (breaks rotation-emits-updates, doubles flagship-path entry count);
weights are rejected (identity is rid, not value). Emission invariants preserved verbatim:
no-phantom-events (enforced once at `applyUpdate`), snapshot-then-deltas on connect,
rotation-emits-updates (in the compat projection where consumers observe it; native profile
carries the more faithful membership+move). Version-broken loudly: sparse-hole value shapes
(derived views are dense), removes-before-fills ordering (dissolved into atomic per-sink batches
with canonical internal order). fero's wire shape is a **lossless compat profile**: the v2
`{type, key: string[], value, at?}` + `{move, from, to}` records are derived mechanically from
batches (positional keys for array sources via the order channel, structuredClone per v2
contract), with `old` and provenance `{origin, seq, epoch}` as additive optional fields under
`SCHEMA_VERSION = 3` in the engine-free `data/ir` entry — no breaking shim, no sunset required;
fero migrates to the richer profile at its own pace.

**Q3 — Scheduling & consistency.** Eager-store / deferred-delivery / pull-forces-flush, with
**auto-flush per top-level write**: a bare write settles synchronously before it returns (bitwise
parity with v2's write-then-read everywhere v2 consumers and the entire committed benchmark corpus
observe it), `batch(fn)` stages and flushes once (patch() generalized), and reads inside a batch
are read-your-writes precisely — source reads hit the already-written store, derived reads force a
topological partial flush of their ancestry, so no read is ever stale or glitchy. Delivery is
two-phase: one immutable deduplicated batch per sink per flush in static toposort order (the DAG
is statically known, so no coloring machinery); effects never run mid-application; effect-issued
writes stage into a FIFO next batch with per-effect exception isolation and AggregateError after
settle — v2's transact discipline kept exactly and published as `SCHEDULE_VERSION = 1` with a
cross-repo contract-test suite (fero's M0 timing-contract demand; the c870bde lost-write class
becomes spec + CI). DOM commits synchronously at flush in 3.0 (opt-in frame coalescing);
unobserved scalar derivations are lazy pull with equality cut-off (2026 consensus adopted where it
doesn't touch the pillar).

**Q4 — Public API & lifecycle.** The proxy read DX stays; the callable/thenable magic goes:
operators/built-ins resolve from a real generated prototype (no ghost child views, no precedence
chain), colliding/dynamic keys use `.get(k)`, reflection traps are honest, `await proxy` is
version-broken (compat shim restores it with a warning). Writes are methods-primary
(`.update/.insert/.remove/.patch/.apply/[value]=`) — the Option B endpoint — with runtime
assignment kept accepted-and-dev-warned for one major and proto-pollution keys rejected. Types are
designed first: each operator's `defineOp` entry co-locates impl, descriptor, IR schema, and a
declaration-merged typed signature, from which both the prototype and the exported `Operators`
table are generated — registry↔type mutual-exhaustiveness makes drift a compile error. Lifecycle:
explicit owners (`$.root`, `mount`) and strongly-retaining `Handle`s with synchronous
`dispose()`/`Symbol.dispose` are primary; unobserved chains are passive specs (near-zero cost, no
per-row state), which is how leak-free-by-default survives determinism; dedup becomes a semantic
guarantee (value-keyed IR cache on the parent, refcounted live state); WeakRef/FinalizationRegistry
are demoted to a dev-mode undisposed-handle warning plus a production mop-up so v2-idiom
fire-and-forget code degrades to v2 behavior instead of leaking.

**Q5 — Seam as design center & competitive scope.** Yes on both halves, with scope discipline:
the `RidStore` interface IS PLAN.md's SourceBacking made the day-0 kernel boundary, and fero's
four M0 items (public `apply()` ingress, non-cloning sink profiles, handles with sync detach,
versioned timing contract) plus `data/ir` (SCHEMA_VERSION, ChangeRecord, ExprNode, descriptors,
generated api-manifest) are P4 deliverables gated in CI against fero's contract tests — the
flagship consumer is designed for, not adapted to. The ExprNode IR is the primary argument
representation (typed-first in the signatures), closures are sugar (restricted-subset source-text
lift, validated in dev, opaque fallback never-silently-wrong), and CSP is answered by the
always-shipped Tier-1 interpreter with codegen as a feature-detected default. Competitively, v3
answers TanStack DB with the vertical (columnar delta engine → keyed surgical DOM) plus
first-class async/stream sources and batch/optimistic-friendly mutation in 3.0, **joins reserved
as a designed v3.1 operator** over the same algebra; it answers DuckDB/Mosaic by adopting Arrow
and taking their results as sources rather than competing on scan; it answers the signals
consensus by adopting its scalar semantics and shipping a Signal-shaped bridge while keeping the
collection layer push-delta. It stays an operator engine + renderer — not a framework, not a
database (§15 guards).

---

## 9. Contradiction resolutions (the load-bearing ones from the digest)

1. **Sync-settle vs batch-first** — *Resolved: both, by construction.* Auto-flush per top-level
   write preserves observable sync read-after-write (benchmarks, examples, fero unchanged);
   `batch()` is the batch-first primitive; internally everything is a batch (a bare write is a
   batch of one on a preallocated scratch). The benchmark corpus is re-baselined once for the
   engine swap, not for a semantics change.
2. **Update vs retract+insert** — *Resolved: first-class update carrying `old`.* Rotation-emits-
   updates and the O(1) in-place path are kept (HARD invariants + flagship); Z-set invertibility
   is obtained via native `old` instead of retraction. The compat profile emits v2-shaped streams.
3. **Columnar vs keyed store** — *Resolved: keyed semantics, columnar implementation.* One
   `RidStore` interface; ColumnStore for tabular, CellStore for nested/heterogeneous; one delta
   algebra over both. The hybrid is designed (§2.1), not asserted: the interface, backing
   selection rule, demotion rules, and the memory bench that validates the fork are all specified.
4. **WeakRef vs scopes** — *Resolved: owners/handles primary, WeakRef demoted.* Deterministic
   dispose, enumerable subscriptions, refcounted live state; leak-free-by-default preserved via
   passive specs + a production GC mop-up for undisposed handles (dev-warned). This is the loud
   version-break the audit demands, with the zero-ceremony DX story intact.
5. **Dedup policy** — *Resolved: value-identity args dedup by value; opaque closures stay fresh.*
   IR args (and lifted closures, and reactive views by bound-node identity) dedup
   deterministically; raw fns are fresh per call with `share()` opt-in; `tap` never dedups. Both
   audit positions were right about different argument kinds; the rule keys off the kind.
6. **SSR scope** — *Resolved: out for 3.0.* Demand unproven; the two-phase materialize/bind
   instantiation seam is built anyway (cheap), so renderToString/hydrate are v3.x options, not
   rewrites. Decided before the render architecture per the digest's instruction.
7. **Perf-gate slack numbers** — the crit's ~6×–480× calibration is adopted; v3 gates are
   count-based and ratio-based (§12), not absolute-ms catastrophe detectors, so the slack
   question dissolves.
8. **Reactive value-slot typing** — the crit is right that it's patchable in v2 (covariant
   readonly-[value] marker); v3 doesn't spend it as justification and uses exactly that marker
   type (`Reactive<T> = T | View<T>`).
9. **Render dense/sparse dual model** — not counted as rewrite evidence (the crit showed
   unification largely done in v2); only keyed identity is claimed, and that is a core+render
   co-design item here (rid in the protocol → keyed sink).
10. **sideEffects './register.ts'** — moot in v3 (no registration side effect exists; static
    imports + splitting:true); the v2 entry stays untouched during the window per the crit.
11. **Oracle independence** — the tests-crit's correction is adopted wholesale: §11's oracle is
    independent plain JS, not the library folded twice; the proto fuzz methodology (seeds,
    negative controls, per-step parity) is adopted, its implementation-as-oracle flaw is not.
12. **Devtools scope** — only the two core-level items (creation-time registry, single observe
    hook) are in the kernel; the panel rebuild is subsystem-local and off the critical path.
13. **C14/C16 framing** — adopted per the protocol-crit's calibration: the rewrite case is the
    ~20% permanent reconciliation tax and foreclosed incrementality (P3/P7), not ongoing fires;
    C14/C16 dissolve as a *consequence* (rid-space set algebra + explicit `keyBy` for independent
    sources), and the plan does not overstate the residuals.
14. **Additive seam items** — explicitly not spent as rewrite justification (§1 honesty ledger);
    data/ir, descriptors, ingress, and non-cloning sinks are acknowledged as v2-shippable and are
    simply built once, in v3, where they're cheaper.
15. **CLAUDE.md cross-entry-identity contradiction** — resolved on the code's side (Symbol.for
    sharing IS the v2 reality); v3 makes it moot via module identity + versioned `data.v3.*` keys
    for the devtools registry only, and the v2 doc line gets fixed during the window (a v2 patch,
    tracked in §13).

---

## 10. Cross-cutting policies

**CSP / codegen.** Tier-1 interpreter always shipped and always the semantic reference; Tier-2
`new Function` codegen feature-detected once at init, on by default where permitted; closure→IR
lifting is source-text parsing (CSP-safe); WASM tier requires explicit import (`data/wasm`) and
degrades to Tier-2/Tier-1. Perf CI runs the interpreter tier on a pinned subset so CSP-mode
regressions are visible, not theoretical. `validate()` fail-closed on embedded functions is the
wire security contract (kept from the proto).

**Memory budget + measurement.** New harness `perf/mem.ts`: `--expose-gc` heap-delta sampling
around (a) ingestion of the 231k-flight corpus, (b) the 4-dim crossfilter graph steady state,
(c) 10k-tick churn (steady-state allocation rate — target ~0 allocations per tick on the
batch-of-one path, counted via allocation sampling), (d) mount/dispose cycles (leak assertion:
heap returns to baseline ± noise after dispose, enumerable subscriptions == 0). Budgets (validated
at P1, enforced from P2): flights ingestion ≤ 15MB retained for ColumnStore (vs v2 measured
first — the bench establishes v2's number before v3 claims a ratio); CellStore ≤ 1.2× v2
equivalent; per-operator live state ≤ 8B/row for membership ops, ≤ 12B/row for ordered views.

**Error handling + dev/prod split.** v3 ships `development` and `production` conditions in the
exports map (the ecosystem-standard mechanism; no NODE_ENV sniffing in browser bundles). Dev-only:
delta legality checker on every flush, closure-lift differential validation, undisposed-handle
warnings, schema-demotion warnings, key-shadows-method warnings, asymmetric-reduce re-fold audit,
cross-graph binding warnings. Typed error taxonomy (`DataError` subclasses: `WriteError`,
`ScheduleReentrancyError`, `IRValidationError`, `SourceError`), AggregateError from flush (all
effect errors, not first-only), and render boundaries (§5). Production strips all of it
(size-gated).

**Value-domain contract (specified before the harness asserts exact equality).** *Absent* (no
key/validity 0) ≠ *null* (present null) ≠ *undefined*: in ColumnStore, `undefined` as a written
cell value normalizes to absent (validity clear) with a dev note; in CellStore it is preserved;
derived views never expose absence as enumerable `undefined` (dense outputs). NaN/±Infinity flow
through f64 columns natively; `sum` keeps NaN-poisoning and aggregates keep empty-set semantics
bit-for-bit under SCHEMA_VERSION (fero replicates them). `Date` → f64 epoch-millis column with a
type tag (revived on read); `Map`/`Set`/class instances/functions-as-values → ref cells (opaque,
identity-compared, excluded from IR predicates except via `{fn}`). Keys are always strings at
every public surface; rid internals never leak; the `'1'`-vs-`1` coercion bug family is
unrepresentable. Unicode keys pass through; key ordering guarantees are insertion-seq, stated.

**Runtime support matrix + bundle budgets.** ES2022 baseline (Proxy, WeakRef/FinalizationRegistry
for the dev net, structuredClone for the compat profile); Node ≥ 20, Deno, Bun, workers (no DOM
dependency outside `data/render`; `raf` falls back as today). WASM relaxed-SIMD feature-detected
(Safari fallback). Bundle budgets, CI-gated by a size check: core kernel + scheduler + proxy ≤
14KB min+gz; each operator 1–3KB; default `data` entry (all operators, no render) ≤ 40KB; render ≤
10KB; `data/ir` ≤ 4KB; `data/wasm` lazy. Packaging: `splitting: true` with one shared core chunk
(safe now — no side-effect registration), 4-row exports map, per-entry d.ts, ESM-only.

**Concurrency / multi-context.** Per-graph Scheduler (no module-global cascade state — the v2
module-global FIFO retired); multiple graphs per page supported and tested; cross-realm proxies
unsupported-and-detected. Worker offload is design-reserved: ColumnStore chunks are
transferable/SAB-compatible by construction, and the batch-recompute frontier (the WASM tier's
home) is the natural offload unit — shipped v3.x, not 3.0.

---

## 11. Test strategy

**Order inverted: the conformance kit exists before the first operator** (the audit's one
unretrofittable benefit — taken).

1. **P0 delta-legality state machine** (`v3/kernel/legality.ts`, dev-mode + test-mode): per view,
   folds every delivered batch and asserts — no update/remove for a never-inserted rid, no
   double-insert, `old` equals last-known value, order-patch moves within bounds, membership ∩
   order consistency, equality cut-off (no value-equal update delivered), snapshot-then-deltas on
   attach. Every operator test runs wrapped in it by default.
2. **Replay sink**: folds the emitted stream into a fresh value and asserts replay ≡ the view's
   snapshot after EVERY event (the flow essay's duality as an executable law). Catches the C8
   class (value-right/stream-wrong) on the introducing commit.
3. **Independent plain-JS oracle** per operator (`tests/oracle.ts`): `Array.prototype.filter`,
   sort-with-specified-ties (comparator + seq), plain-object group/count/fold — never the library.
   The differential harness compares v3 live vs oracle-rebuild **exactly** (zero normalizers):
   deterministic ties, specified distinct/limit semantics, and dense outputs make the v2
   harness's unique-v fence, gKeyset, and multiset normalizers unnecessary; dropZeroBuckets
   survives only as the *stated contract* difference between length-mode and group-mode buckets.
4. **The 63-scenario differential harness ports as the parity gate** — run three-way during the
   window: v2 engine, v3 native, v3-through-compat. v3-compat must match v2's *records* (the
   ChangeRecord battery) on the documented-stable subset; divergences are enumerated version
   breaks (dense views, deterministic ties/distinct/limit — each with a migration note), asserted
   as such rather than normalized away. Generated composition grid (ops × depth-3 chains ×
   {cells, columns} × full mutation vocabulary incl. patch-batch/mid-insert/slot-clear), seeded
   fresh-seed budgets (small per-commit, large nightly), failure shrinking to a minimal committed
   repro, negative controls (proto fuzz methodology, independent oracle).
5. **Scheduler contract tests** (SCHEDULE_VERSION): re-entrancy FIFO order, exception isolation,
   read-your-writes matrix (source/derived × inside/outside batch), origin-token echo suppression
   — exported as `data/contract-tests` so fero runs them against data HEAD (M0 item 4).
6. **Render differential**: fake-DOM child order ≡ oracle order under the same mutation
   vocabulary; trace-equivalence between builder and JSX (v2's byte-identical technique); keyed
   identity assertions (same element object across reorder; focus survival).
7. **Playwright corpus reused as-is**: at the P4 gate, all 11 example specs + landing specs run
   against examples importing `data/compat` (importmap swap only); at P6 they run against migrated
   examples. e2e made hermetic (prebuilt, `--workers=1`, small flight fixture) per the tests
   audit's patchable list.
8. **Mutation testing of the kit itself**: seeded mutants (a dropped delta, a stale old, a
   phantom update) must fail legality/replay — proving the monitors can see (fero plan's
   discipline, adopted).

---

## 12. Performance strategy

**Protect the flagship wins — named workloads at risk, each with a gate:**

| At-risk workload | Risk | Gate (machine-checked) |
|---|---|---|
| single-tick write-then-read (order-book race; every BENCHMARK.md "Single" column) | batch machinery overhead per bare write | interleaved same-process A/B v3-vs-v2 ≥ 1.0× on every per-op single-tick row; batch-of-one path allocation count == 0 |
| swarm `patch()` (12k agents/frame) | staging/delivery overhead vs v2's one-walk BU1 | A/B ≥ 1.0× on the swarm bridge workload; ops-per-flush count gate (H1 successor) |
| crossfilter 231k brush (between chain) | brush walk port fidelity | A/B ≥ 1.0× per brush step p50; ≥ 5× target from bitset membership (headroom claim, tracked not gated at P2, gated ≥ 2× at P5) |
| kanban re-point churn | dedup regression | operator-instance count == deduped expectation; A/B ≥ 1.0× |
| windowed-sort rotation (za stream) | rank-space reconcile constants | A/B ≥ 1.0×; content-stable update emission asserted (compat) |
| CellStore apps (todo/chat) | kernel generality tax on non-columnar shapes | A/B ≥ 0.9× at P2, ≥ 1.0× at P5 (honest interim floor, must close) |
| CSP / interpreter tier | Tier-1 predicate cost | tracked ratio Tier1/Tier2 ≤ 6×; no gate below v2 (v2 closures ≈ Tier-2) |

**Methodology carried over:** Mode A single-source-of-truth (workloads.ts pattern — no report row
a gate didn't assert), two calibrated presets, H1-style deterministic op-counts promoted to
**blocking** CI (counts are machine-independent; the WSL2 slack problem dissolves), ratio gates
(interleaved A/B in one process — fero plan-v3's `utils/ratio` pattern) for hot paths, absolute ms
only as catastrophe rails. The toggle/keep-bundle boilerplate is deleted *when* its causes
(same-value dedup at the store is kept — toggle stays; WeakRef sinks are gone — keep-bundles go).

**New peer set:** existing eight + **TanStack DB** (the canonical `map→filter→topK` workload plus
its own sorted-100k-update headline shape, published honestly with idiom notes) + **krausest
js-framework-benchmark** run locally for the renderer (create/replace/partial-update/select/swap/
remove rows — keyed identity makes swap-rows finally fair) with results published on the perf
page; participation upstream once v3.0 tags. Arrow ingestion benchmarked against arquero/DuckDB
hand-off latency (positioning, not victory claims).

**Memory benchmarks** per §10 budgets, run in the same sweep, trended in perf.json (schema gets a
`mem` harness section; dashboard tile added).

**Go/no-go perf gates per phase are listed in §14** — the headline rule: **no phase advances while
a flagship A/B gate is red**, and if P5's columnar wins don't materialize ≥ 2× on the crossfilter
brush and ≥ 10× on batch aggregates, the concept's premise is falsified and the fallback is the
keyed CellStore engine alone (which still deletes the C-series and the lifecycle class) — a stated
retreat, not a quiet one.

---

## 13. Migration and compatibility

**Compat surface (`data/compat` entry, plus behaviors in the main entry for one major):**
v2-shaped ChangeRecord profile on `connect` (default profile in compat, opt-in in main),
thenable-proxy shim (dev-warned), runtime assignment writes (dev-warned, main entry too),
`patch()` (permanent sugar), `Operators` table + `$`/`value`/`view` named exports (permanent),
`__ripple_sink` alias (one major), `length(fn)` `{value: count}` buckets + zero-persistence and
`group` pruning (permanent contracts). **Lifetime:** compat entry `data/compat` is supported for
the v3.0 → v3.1 cycle minimum, removal only with a major and a migration doc; dev warnings link to
per-item codemod notes.

**Version-broken loudly (each with a written migration note):** sparse-hole value shapes (views
are dense — `dense()` helpers delete; defensive bindings become optional), `await proxy`,
single-static-slot text semantics (ordered children — the `'# {cur}'` gotcha becomes correct
code), WeakRef-only sink lifetime (handles/owners; fire-and-forget degrades via the GC net),
deterministic ties/distinct/limit (documented-loose in v2 → specified), `data/lean` (replaced by
`data/core` + `use()`), `render()` return (`Mount` object), registry symbol keys (`data.v3.*`).

**Codemod inventory — the 11 examples:** all already use the Option B write idiom (v2 migration
done), so the mechanical passes are: (1) `render(el, tpl)` → `mount(el, tpl)` destructure
(11 examples + landing assets); (2) hold `connect` handles where fire-and-forget (flow, demos,
perf apps — grep `connect(` ≈ 30 sites outside tests); (3) delete `dense()` and
possibly-undefined defensive bindings (library, chat, demos — now optional, kept where
semantically meaningful); (4) delete `data-id` reorder workarounds and adopt keyed rows
(kanban, chat); (5) `$(view)`-swap idiom unchanged (LinkedView semantics ported); (6) rAF
coalescing in kanban/chat search **retirable** (dedup fixes the pileup) but harmless; (7) builder
string-shorthand → typed props where the typed surface is wanted (optional, not required —
runtime keeps shorthands). Examples migrate per phase (§14); until migrated they run on
`data/compat` via importmap — **the corpus is never dark**. The landing race re-baselines its
numbers at P5 with a published before/after; the flow essay gains an `old`-field beat (undo
falls out) and its records stay v2-shaped through compat until its own migration.

**fero:** imports move from the source path `../../data/index.ts` to the published package (or a
pinned workspace path) — ~40 sites, one find-replace; `BUILTIN`/`DECOMPOSABLE`/`HOLISTIC`
hand-sets → imported `Builtins`/`descriptors` (fixing the already-stale `get` omission class);
~5 `[VIEWSYM].res` reach-throughs → `coll.apply(records)`; `message.ts`'s hand-declared
ChangeRecord → `import { WireRecord } from 'data/ir'`; the `applying`/`discarding` timing flags →
origin tokens under SCHEDULE_VERSION. fero's M0 go/no-go is co-scheduled with P4 (§14) so the
contract lands upstream on fero's clock; the fallback in fero's plan (thin measured wrapper) stays
available but should be unnecessary since the contract items are v3 deliverables, not favors.

**Wire/versioning:** SCHEMA_VERSION 3 in data/ir; v2 records are version-inferable (no
`old`/`schema` field) so fero's codec can dual-read during transition. npm: v3.0.0 on the kept
name `data` (major on the existing package); publish remains token-blocked, so releases stage as
git tags + the committed-dist Pages fallback until the token is renewed — no plan step assumes
instant publishability.

---

## 14. Phasing

**Model: big-bang greenfield kernel, strangler at the consumer boundary.** The kernel inversions
(identity, algebra, scheduling, ownership) are not stranglable per-operator inside v2's engine —
that was the audit's verified lesson (every cross-cutting fix "touches every implementer"). But
consumers never big-bang: `data/compat` + the parity harness make v2's surface the strangler
seam. v3 grows in-repo under `v3/` (new tsconfig project, own CI lane) and swaps into the entry
points at P6. **v2 ownership during the window:** the maintainer, patch-only policy — crash and
correctness fixes and the CLAUDE.md/doc-drift fixes only; no new operators, no perf work except
regressions; the panel and examples frozen. Every phase gate is machine-checkable and blocks the
next phase.

| Phase | Weeks | Contents | Go/no-go gate (machine-checkable) |
|---|---|---|---|
| **P0 — contracts first** | 2 | delta algebra + legality checker + replay sink + independent oracle + scheduler skeleton + SCHEDULE/SCHEMA docs; proto/ committed | mutation tests: seeded protocol mutants fail the kit; scheduler contract tests green; `data/ir` round-trips |
| **P1 — kernel + first ops** | 3 | RidStore (CellStore + ColumnStore), write surface, proxy, owners/handles, filter/compare/between/aggregates/length; memory harness | differential (ported subset) green under legality; single-tick A/B ≥ 0.8× v2 (interim floor); memory budgets recorded (v2 baseline measured); ingestion ≥ 5× v2 setup |
| **P2 — full operator set** | 3 | OrderIndex + sort/windows/limit/slice, GroupIndex, set algebra, map/to/reduce/tap/keys/values/reverse/distinct, keyBy; IR lift parser; dedup | full 63-scenario three-way parity green; 20k-step fuzz green; flagship A/B gates ≥ 1.0× (single-tick, swarm, brush, rotation); CellStore A/B ≥ 0.9× |
| **P3 — render + JSX** | 3 | children AST, keyed DOMSink, mount/owners, builder + JSX front-ends, intrinsics port | trace-equivalence green; render differential green; keyed-identity/focus tests green; todo+kanban+chat run migrated; krausest local run recorded |
| **P4 — seam + compat** | 2 | `data/compat` entry, v2-record profile, `apply()` ingress, sink profiles, descriptors/Builtins, contract-tests export; fero M0 co-scheduled | all 11 example Playwright specs green on compat (importmap swap only); fero contract tests green against v3 HEAD; flow essay records byte-match v2 on the stable subset |
| **P5 — performance + acceleration** | 3 | columnar hot paths tuned, Tier-2 default, `data/wasm`, Arrow adapters, devtools registry/observe + $ helpers; TanStack/krausest peer benches | every BENCHMARK.md workload A/B ≥ 1.0× single AND columnar targets hit (brush ≥ 2×, batch aggregate ≥ 10×) — **else fall back to CellStore-only per §12**; bundle-size gates; memory budgets enforced; TanStack DB numbers published |
| **P6 — migration + release** | 2 | examples migrated native, landing re-baselined, docs regenerated from api-manifest, panel port started (off-critical-path), v3.0.0 tagged | full e2e on migrated examples; doc drift check green; dist/Pages rebuilt; v2 branch cut with patch policy |

Total ≈ 18 working weeks single-senior-engineer pace, with P0's kit and P2's parity gate as the
two points where the plan is falsifiable early (fero plan-v3's "riskiest hypothesis dies in week
one" discipline).

---

## 15. Risks and mitigations

1. **v3 is slower than v2 on advertised workloads** (the reputational kill-shot). Mitigations:
   batch-of-one preallocated fast path designed in §2.5; interleaved A/B ratio gates on the named
   flagship workloads at every phase (not once at the end); the P2 gate blocks the render phase
   until single-tick parity holds; the P5 falsification clause (columnar wins don't materialize →
   ship the keyed CellStore engine, which still buys the correctness/lifecycle case, and say so).
   The committed benchmark corpus re-baselines once, with before/after published — never silently.
2. **Scope balloons into a framework.** Guards: joins/context/SSR/persistence/sync all explicitly
   out of 3.0 with named revisit points; a concept budget in the spirit of fero's rule (every new
   named mechanism must delete one); the operator registry means new surface area has one shape;
   the phase table has no "and also" rows. The renderer adds owners/boundaries only — no compiler,
   no router, no state-management dogma.
3. **The marshalling tax bites object-heavy apps** (the stance's honest weak flank). Mitigations:
   CellStore is a first-class backing, auto-selected, with its own A/B floor gate; demotion is
   counted and warned, never silent; `$.table()` is explicit opt-in when inference declines. The
   todo/kanban/chat corpus gates it.
4. **Closure-lift produces silently wrong predicates.** Mitigations: strict whitelist parser;
   dev-mode differential validation against the original closure on sampled rows; any doubt →
   opaque Tier-3 (correct, just unoptimized); the fuzz harness runs lifted-vs-closure parity.
5. **CSP environments become second-class.** Mitigation: Tier-1 interpreter is the semantic
   reference and perf-tracked in CI; the gap is documented (~≤6× on predicate-heavy scans, nil on
   membership/order/aggregate paths which dominate real workloads).
6. **fero timing regressions recur (c870bde class).** Mitigation: SCHEDULE_VERSION + the exported
   contract-test suite run in both repos' CI; origin tokens replace drain-order-timed flags;
   fero's M0 go/no-go is co-scheduled so a contract miss surfaces in weeks, not after the fact.
7. **Compat profile drift** (v2-shaped records subtly wrong). Mitigation: the three-way
   differential (v2 vs v3-compat records) is a standing gate, not a one-shot; the flow essay's
   literal-records rendering doubles as a human-visible canary.
8. **The window starves v2 users** (bugs during ~18 weeks). Mitigation: explicit patch-only
   policy with an owner; the frozen surface is the currently-green one (KNOWN_FAILURES empty,
   residuals documented) — historically v2's quietest state.
9. **Ordering constants disappoint** (gap-buffer OrderIndex vs v2's tuned windows). Mitigation:
   the rotation/brush A/B gates target v2's *post-fix* numbers (431ms→2ms era); the OrderIndex
   interface hides the structure so an order-statistics tree can replace the gap buffer without
   touching operators.
10. **Team-of-one bus factor / estimate risk.** The phase gates are all executable by CI, the
    conformance kit is the spec, and DECISIONS.md discipline continues — the plan is written so a
    fresh session can pick up any phase from the gates and this document.

---

*End of concept. Companion inputs: audit digest (ground truth), PROTOCOL.md (v2 verb reference),
proto/dir (IR + WASM evidence — commit it in P0), results-altbackend.md (the ceiling numbers),
fero plan-v3 §10 (the M0 contract), ISSUES.md (C14/C16/P3/P5/P7 — all addressed by construction
above).*
