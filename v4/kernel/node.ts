// v3/kernel/node.ts — graph nodes: the DataNode base and SourceNode.
//
// A node is simultaneously a consumer of parent batches and a producer of its
// own (the v2 Operator-extends-Value fusion, split: nodes have exactly one
// role surface — ingest/settle — and mutation entry points exist ONLY on
// SourceNode). References are strong and flow downward: parents hold
// children; scopes hold nodes. Delivery is deterministic.

import type {
  CommitBatch, OrderDelta, OriginToken, Path, RowDelta, RowKey,
} from '../contract/delta.ts'
import { Store } from './store.ts'
import { Scope, currentScope } from './scope.ts'
import type { Runtime } from './runtime.ts'

export interface EffectEntry<T> {
  readonly wantsOrder: boolean
  readonly origin: OriginToken | null // for echo suppression; null = never suppress
  apply(batch: CommitBatch<T>): void
  // Runtime-managed (stamped by connect/dispose — callers never set these):
  // bornSeq — the commit a mid-flush connect was born in. Its init snapshot
  // ALREADY contains that commit (clause 4: effects run after all operator
  // state settles), so the effect loop skips batch.seq === bornSeq or the
  // sink would double-apply (a nested list built during an add duplicated
  // rows). dead — set by dispose(); the effect loop iterates a SNAPSHOT of
  // the effects array, so a disposal mid-phase must tombstone, not just
  // splice, to stop the already-snapshotted entry from firing.
  bornSeq?: number
  dead?: boolean
}

export interface SubscriptionHandle {
  dispose(): void
}

let nextNodeId = 1

export abstract class DataNode<Out> {
  readonly id: number
  readonly kind: 'source' | 'operator' | 'scalar'
  readonly opName: string
  readonly runtime: Runtime
  readonly parents: readonly DataNode<any>[]
  readonly height: number
  // children/effects are arrays, not Sets: fan-out is small, iteration is the
  // per-commit hot path (no iterator allocation), and removal is rare (dispose).
  readonly children: DataNode<any>[] = []
  readonly effects: EffectEntry<Out>[] = []
  readonly scope: Scope | null
  disposed = false

  // per-commit input slots (runtime-managed): in0/inFrom0 cover the
  // single-parent common case with zero allocation; inMore is the rare
  // multi-parent overflow. settledSeq: +seq = settled this commit; -seq =
  // enqueued this commit; 0 = untouched (seq starts at 1).
  in0: CommitBatch<any> | null = null
  inFrom0: DataNode<any> | null = null
  inMore: { from: DataNode<any>; batch: CommitBatch<any> }[] | null = null
  settledSeq = 0

  constructor(runtime: Runtime, kind: DataNode<Out>['kind'], opName: string, parents: readonly DataNode<any>[]) {
    this.id = nextNodeId++
    this.kind = kind
    this.opName = opName
    this.runtime = runtime
    this.parents = parents
    let h = 0
    for (const p of parents) {
      if (p.height + 1 > h) h = p.height + 1
      p.children.push(this)
    }
    this.height = h
    this.scope = currentScope()
    this.scope?.add(this)
    runtime.register(this)
  }

  // Accumulate one parent's batch for this commit (runtime calls this).
  ingest(from: DataNode<any>, batch: CommitBatch<any>): void {
    if (this.in0 === null) {
      this.in0 = batch
      this.inFrom0 = from
    } else {
      ;(this.inMore ??= []).push({ from, batch })
    }
  }

  clearInputs(): void {
    this.in0 = null
    this.inFrom0 = null
    if (this.inMore !== null) this.inMore.length = 0
  }

  // Produce this node's output batch for the commit; null = nothing changed.
  abstract settle(seq: number, origin: OriginToken): CommitBatch<Out> | null

  // Materialized collection state (scalar nodes throw; see ScalarNode).
  abstract snapshot(): Map<RowKey, Out>
  // Current order, if this node is ordered (null otherwise).
  currentOrder(): readonly RowKey[] | null {
    return null
  }

  // Read-only full row pass — the NO-COPY counterpart of snapshot() for
  // one-pass consumers (construction-time seeding, settle-time rebuilds).
  // A callback visitor rather than an iterator: V8 inlines the callback and
  // elides all iterator machinery, ~5× faster than copy-then-iterate at 10k
  // rows (and generators are barely better than the copy). The base
  // delegates to snapshot(), which is midBatch-correct for every node;
  // materialized nodes override with a direct view pass behind the same
  // midBatch fallback, and SourceNode iterates its store (current even
  // mid-batch). Contract: do NOT mutate this node inside fn.
  each(fn: (key: RowKey, row: Out) => void): void {
    for (const [k, v] of this.snapshot()) fn(k, v)
  }

  // Live row count — O(1) on nodes with a materialized view or store,
  // snapshot().size (O(N)) as the universal fallback.
  rowCount(): number {
    return this.snapshot().size
  }

  // ── membership / row lookup protocol ────────────────────────────────────
  // Per-key access for multi-parent operators: set algebra queries its
  // parents per touched key instead of mirroring every parent's rows (the
  // mirrors were the dominant retained memory on wide graphs). Valid
  // whenever the node is settled — during a flush, height order guarantees
  // every parent settled first (and midBatch is false there: the flush runs
  // after batchDepth returns to 0). hasRow is distinct from rowAt because a
  // row's VALUE may legitimately be undefined (v3 has no sparse holes —
  // undefined rows are first-class). These base fallbacks materialize a
  // snapshot per call (O(N), correct for any node, midBatch-safe); every
  // in-tree collection node overrides them with O(1) materialized reads.
  hasRow(key: RowKey): boolean {
    return this.snapshot().has(key)
  }

  rowAt(key: RowKey): Out | undefined {
    return this.snapshot().get(key)
  }

  connect(entry: EffectEntry<Out>): SubscriptionHandle {
    entry.bornSeq = this.runtime.connectSeq()
    this.effects.push(entry)
    const self = this
    const handle: SubscriptionHandle = {
      dispose() {
        entry.dead = true // tombstone: a snapshot iteration mid-phase must skip it
        const i = self.effects.indexOf(entry)
        if (i >= 0) self.effects.splice(i, 1)
      },
    }
    currentScope()?.add(handle as unknown as { dispose(): void })
    return handle
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const p of this.parents) {
      const i = p.children.indexOf(this)
      if (i >= 0) p.children.splice(i, 1)
    }
    this.children.length = 0
    for (const e of this.effects) e.dead = true // see connect() — snapshot iterations
    this.effects.length = 0
    this.scope?.delete(this)
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function shallowCopy(v: any): any {
  return Array.isArray(v) ? v.slice() : { ...v }
}

// Height re-propagation after a REPARENT (today: only MirrorNode.set). A
// node's height must exceed every parent's or the flush agenda settles it
// BEFORE its input arrives: the repro is a mirror repointed at a TALLER view
// while a descendant built pre-repoint keeps its construction-time height —
// one source write then reaches the descendant along two paths, the
// descendant settles first against the mirror's stale materialized view, and
// the mirror's late batch lingers un-folded until the next re-settling
// commit (the library-v3 PROBE A staleness; STATUS gap 5). Heights only ever
// GROW: recompute from parents, and push increases through descendants.
export function reheight(n: DataNode<any>): void {
  let h = 0
  for (const p of n.parents) if (p.height + 1 > h) h = p.height + 1
  if (h <= n.height) return
  ;(n as { height: number }).height = h
  for (const c of n.children) reheight(c)
}

export function leafAt(v: unknown, path: Path): unknown {
  let cur: any = v
  for (const p of path) {
    if (cur == null) return undefined
    cur = cur[p]
  }
  return cur
}

// Copy-on-write field DELETION along the path (W3a). Returns the new root
// with the leaf property removed (structural sharing off-path, like
// pathCopy), or null when the deletion is a NO-OP: any ancestor is
// missing/null/non-object, or the leaf property is not owned. The null
// return is the idempotence law (SCHEDULE clause 10) — a replicated remove
// redelivered or reordered must never throw or write. Deleting an ARRAY
// element is refused loudly: `delete arr[i]` mints a sparse hole (the exact
// value-domain shape v3 version-broke) — the caller writes a spliced array
// instead.
export function pathDelete<T>(row: T, path: Path): T | null {
  let probe: any = row
  for (let i = 0; i < path.length - 1; i++) {
    if (probe === null || typeof probe !== 'object') return null
    probe = probe[path[i]]
  }
  const last = path[path.length - 1]
  if (probe === null || typeof probe !== 'object' || !Object.hasOwn(probe, last)) return null
  // An owned-but-undefined leaf deletes as a no-op: at the deep-write layer
  // leaf-absent ≡ leaf-undefined (the same equivalence the Object.is no-op
  // drop applies to writes), and emitting the delete would be a phantom
  // update under clause 8 (leaf unchanged: undefined → undefined).
  if (probe[last] === undefined) return null
  if (Array.isArray(probe))
    throw new Error(
      `data: remove() of array element [${path.join('.')}] would leave a sparse hole — write the spliced array instead`,
    )
  const root = shallowCopy(row)
  let src: any = row
  let dst: any = root
  for (let i = 0; i < path.length - 1; i++) {
    const p = path[i]
    const next = shallowCopy(src[p])
    dst[p] = next
    src = src[p]
    dst = next
  }
  delete dst[last]
  return root
}

// Copy-on-write along the written path. Returns the new root; prev is the
// untouched old root (structural sharing everywhere off-path) — oldValue for
// free, zero clones.
export function pathCopy<T>(row: T, path: Path, value: unknown): T {
  if (path.length === 0) return value as T
  const root = shallowCopy(row)
  let src: any = row
  let dst: any = root
  for (let i = 0; i < path.length - 1; i++) {
    const p = path[i]
    const next = src == null || src[p] == null ? {} : shallowCopy(src[p])
    dst[p] = next
    src = src == null ? undefined : src[p]
    dst = next
  }
  dst[path[path.length - 1]] = value
  return root
}

// Minimal order-delta script for a source batch (sources insert/remove but
// never reorder survivors): removes at descending pre-batch indices (each
// index is valid at application time), then inserts at ascending final
// indices. TODO(M2): OrderedView emits real orderMove for rank rotations.
// Legal order script pre → post (SCHEDULE clause 8): removes at DESCENDING
// pre indices, then orderMove per SURVIVING key whose relative rank rotated
// (against the survivor array — each move valid at application time), then
// inserts at ASCENDING final indices. The rotation pass was inert until
// SourceNode.move() existed (insert/remove splices never rotate survivors),
// so pre-move consumers see byte-identical scripts.
export function diffOrder(pre: readonly RowKey[], post: readonly RowKey[]): OrderDelta[] {
  const postSet = new Set(post)
  const preSet = new Set(pre)
  const out: OrderDelta[] = []
  for (let i = pre.length - 1; i >= 0; i--) {
    if (!postSet.has(pre[i])) out.push({ op: 'orderRemove', key: pre[i], index: i })
  }
  const cur: RowKey[] = []
  for (const k of pre) if (postSet.has(k)) cur.push(k)
  const surv: RowKey[] = []
  for (const k of post) if (preSet.has(k)) surv.push(k)
  for (let i = 0; i < surv.length; i++) {
    if (cur[i] === surv[i]) continue
    const j = cur.indexOf(surv[i], i)
    out.push({ op: 'orderMove', key: surv[i], index: i, from: j })
    cur.splice(j, 1)
    cur.splice(i, 0, surv[i])
  }
  for (let i = 0; i < post.length; i++) {
    if (!preSet.has(post[i])) out.push({ op: 'orderInsert', key: post[i], index: i })
  }
  return out
}

// ── SourceNode ───────────────────────────────────────────────────────────────
//
// The ONLY node with mutation entry points. Writes apply to the store
// immediately (read-your-writes); consolidated deltas accumulate per commit;
// no-op writes are dropped centrally at the single chokepoint.

export class SourceNode<T> extends DataNode<T> {
  declare store: Store<T>
  declare ordered: boolean // array-born (has an order channel)
  // The order channel. On an array-born source it starts VIRTUAL (null while
  // `ordered`): while the store is in the ident lane and only tail appends
  // have happened, the order IS the identity 0..size-1 — nothing to
  // maintain, and settle synthesizes the tail orderInserts directly (key ≡
  // index). The first remove / move / mid-insert / order READ materializes
  // it via ensureOrder(), after which it is maintained exactly as before.
  declare order: RowKey[] | null
  declare pending: Map<RowKey, RowDelta<T>>
  declare preBatchOrder: RowKey[] | null
  declare inDirty: boolean // runtime dirty-list membership flag

  constructor(runtime: Runtime, value: Record<string, T> | T[], name = 'source') {
    super(runtime, 'source', name, [])
    this.pending = new Map()
    this.preBatchOrder = null
    this.inDirty = false
    if (Array.isArray(value)) {
      // Adopt the caller's array as the slots (M6 P3): key i ≡ slot i, no
      // per-row mintKey/Map.set loop — a 231k-row ingest is O(1). Same
      // take-ownership contract as the object lane.
      this.ordered = true
      this.order = null // virtual identity order
      this.store = Store.adoptArray(value)
    } else {
      // Adopt the caller's object as the row table (M6 P2): O(Object.keys)
      // ingestion, no per-row Map.set loop. Take-ownership contract — out-of-
      // band mutation of the adopted object was already unsupported (v2's
      // proxy wrote through to it the same way).
      this.ordered = false
      this.order = null
      this.store = Store.adoptObject(value)
    }
  }

  // Materialize the virtual identity order. Called by the first
  // order-perturbing write of a batch (BEFORE its store mutation — the
  // reconstruction below relies on pending still holding every append of
  // this batch) and by order reads. Appends that happened earlier in the
  // SAME batch while virtual were never snapshotted, so the pre-batch order
  // is reconstructed by peeling them off the identity tail — they are
  // exactly the pending 'add' entries (removes materialize, so no
  // annihilation can have consumed one).
  private ensureOrder(): void {
    if (!this.ordered || this.order !== null) return
    const len = this.store.slots.length
    const order = new Array<RowKey>(len)
    for (let i = 0; i < len; i++) order[i] = i
    this.order = order
    if (this.preBatchOrder === null) {
      let adds = 0
      for (const d of this.pending.values()) if (d.op === 'add') adds++
      if (adds > 0) this.preBatchOrder = order.slice(0, len - adds)
    }
  }

  currentOrder(): readonly RowKey[] | null {
    if (!this.ordered) return null
    if (this.order === null) this.ensureOrder()
    return this.order
  }

  snapshot(): Map<RowKey, T> {
    return this.store.snapshot()
  }

  // The store applies writes inline (read-your-writes), so these are current
  // even mid-batch — no midBatch fallback needed.
  each(fn: (key: RowKey, row: T) => void): void {
    this.store.each(fn)
  }

  rowCount(): number {
    return this.store.size
  }

  get(key: RowKey): T | undefined {
    return this.store.get(key)
  }

  // The store applies writes inline (read-your-writes), so it is current
  // even mid-batch — no midBatch branch needed.
  hasRow(key: RowKey): boolean {
    return this.store.has(key)
  }

  rowAt(key: RowKey): T | undefined {
    return this.store.get(key)
  }

  // ── mutation entry points (the runtime write protocol) ────────────────────
  // Hot path allocates no closures: canWriteNow() → inline apply → written().
  // The rare re-entrant path (a write inside an effect) queues a thunk.

  // Write at key(+path). Missing key with empty path = add; missing key with
  // a path is an error (no implicit row creation through a deep write).
  write(key: RowKey, path: Path, value: unknown, at?: number): void {
    const rt = this.runtime
    if (!rt.canWriteNow()) {
      rt.queueWrite(() => this.write(key, path, value, at))
      return
    }
    // Mode branch keeps the packed lane at ONE probe (slotOf) and the
    // adopted lane at a guarded hasOwn — a live-key overwrite never
    // promotes; only the add path below (a structural write) does.
    const st = this.store
    let prev: T
    let slot = -1
    if (st.obj !== null) {
      if (typeof key !== 'string' || !Object.hasOwn(st.obj, key)) {
        this.writeAdd(key, path, value, at)
        return
      }
      prev = st.obj[key]
    } else {
      const s = st.slotOf(key)
      if (s === undefined) {
        this.writeAdd(key, path, value, at)
        return
      }
      slot = s
      prev = st.rowAt(s)
    }
    const before = leafAt(prev, path)
    if (Object.is(before, value)) return // no-phantom-events, enforced once
    const next = pathCopy(prev, path, value)
    if (slot >= 0) st.writeSlot(slot, next)
    else (st.obj as Record<string, T>)[key as string] = next
    this.recordUpdate(key, next, prev, path)
    rt.written(this)
  }

  // The write() miss path: a missing key with an empty path is an add; a
  // missing key with a path is an error (no implicit row creation through a
  // deep write).
  private writeAdd(key: RowKey, path: Path, value: unknown, at?: number): void {
    if (path.length > 0)
      throw new Error(`data: deep write at [${String(key)}.${path.join('.')}] — key ${String(key)} is not live`)
    this.applyAdd(key, value as T, at)
    this.runtime.written(this)
  }

  insert(row: T, at?: number): RowKey {
    const rt = this.runtime
    if (!rt.canWriteNow()) {
      rt.queueWrite(() => void this.insert(row, at))
      return -1
    }
    const key = this.ordered ? this.store.mintKey() : this.autoObjectKey()
    this.applyAdd(key, row, at)
    rt.written(this)
    return key
  }

  // Remove a row (no path) or DELETE a nested field (path present — W3a).
  // Both directions are idempotent by law (SCHEDULE clause 10): a non-live
  // key, an absent ancestor, or an un-owned leaf is a silent no-op — fero's
  // at-least-once redelivery and cross-origin reordering land here freely.
  remove(key: RowKey, path?: Path): void {
    const rt = this.runtime
    if (!rt.canWriteNow()) {
      rt.queueWrite(() => this.remove(key, path))
      return
    }
    if (!this.store.has(key)) return
    if (path !== undefined && path.length > 0) {
      const st = this.store
      const prev = st.get(key) as T
      const next = pathDelete(prev, path)
      if (next === null) return // absent ancestor/leaf — idempotent no-op
      const slot = st.obj !== null ? -1 : st.slotOf(key)!
      if (slot >= 0) st.writeSlot(slot, next)
      else (st.obj as Record<string, T>)[key as string] = next
      this.recordUpdate(key, next, prev, path, true)
      rt.written(this)
      return
    }
    this.applyRemove(key)
    rt.written(this)
  }

  // Reposition a live key in the order channel — array-born sources only
  // (object-born sources are unordered; there is no position to move). No
  // row delta is recorded: the change is purely positional, and settle's
  // diffOrder(preBatchOrder, order) synthesizes the legal orderMove. This is
  // the ingress for the seam's 'move' wire records (previously deferred).
  move(key: RowKey, to: number): void {
    const rt = this.runtime
    if (!rt.canWriteNow()) {
      rt.queueWrite(() => this.move(key, to))
      return
    }
    if (!this.ordered)
      throw new Error(
        'data: move() repositions the order channel — this source is object-born (unordered); moves only apply to array-born sources',
      )
    if (!this.store.has(key)) return // idempotent, like remove
    this.ensureOrder()
    const order = this.order as RowKey[]
    const from = order.indexOf(key)
    if (from < 0) return
    const t = to < 0 ? 0 : to >= order.length ? order.length - 1 : to
    if (from === t) return
    this.snapPreOrder()
    order.splice(from, 1)
    order.splice(t, 0, key)
    rt.written(this)
  }

  // W11: finish the deferred adoption bookkeeping NOW, off the serving path.
  // $() adopts containers (M6) and defers keySlot/slots (object lane) or the
  // key/order materialization (ident array lane) to the FIRST structural
  // write — a <5ms-at-10k spike that lands on the first inbound remove after
  // a replica seeds from replay, i.e. exactly on the serving path. A
  // seed-then-serve flow calls promote() at boot instead. Idempotent; a
  // never-promoted source keeps the adoption fast paths.
  promote(): void {
    this.store.promote()
    this.store.materializeKeys()
    if (this.ordered) this.ensureOrder()
  }

  private autoObjectKey(): string {
    let n = this.store.size
    while (this.store.has(String(n))) n++
    return String(n)
  }

  // ── consolidation (delta.ts rules, implemented once) ───────────────────────

  private applyAdd(key: RowKey, row: T, at?: number): void {
    // Virtual-order fast path: a tail append of the identity key onto an
    // ident store keeps both the key channel AND the order channel virtual —
    // settle synthesizes the orderInsert (key ≡ index). Anything else (a
    // mid-insert, a non-identity key, an already-materialized order)
    // materializes the order BEFORE the store mutation so the pre-batch
    // reconstruction in ensureOrder sees the pre-add length.
    let virtualAppend = false
    if (this.ordered) {
      const st = this.store
      const len = st.slots.length
      virtualAppend =
        this.order === null && st.ident && key === len && (at === undefined || at < 0 || at >= len)
      if (!virtualAppend && this.order === null) this.ensureOrder()
    }
    this.store.set(key, row)
    const prior = this.pending.get(key)
    if (prior === undefined) {
      this.pending.set(key, { op: 'add', key, row })
    } else if (prior.op === 'remove') {
      // remove + add within one batch = update (the key was live pre-batch)
      this.pending.set(key, { op: 'update', key, row, prev: prior.prev, path: [] })
    } else {
      throw new Error(`data: add for already-live key ${String(key)}`)
    }
    if (this.ordered && !virtualAppend) {
      const order = this.order as RowKey[]
      this.snapPreOrder()
      const i = at === undefined || at < 0 || at > order.length ? order.length : at
      order.splice(i, 0, key)
    }
  }

  private applyRemove(key: RowKey): void {
    if (this.ordered && this.order === null) this.ensureOrder() // before the pending annihilation below
    const prev = this.store.del(key) as T
    const prior = this.pending.get(key)
    if (prior === undefined) {
      this.pending.set(key, { op: 'remove', key, prev })
    } else if (prior.op === 'add') {
      this.pending.delete(key) // add + remove annihilate
    } else if (prior.op === 'update') {
      this.pending.set(key, { op: 'remove', key, prev: prior.prev })
    } else {
      throw new Error(`data: remove for non-live key ${String(key)}`)
    }
    if (this.order !== null) {
      this.snapPreOrder()
      const i = this.order.indexOf(key) // TODO(M2): OrderIndex rank map
      if (i >= 0) this.order.splice(i, 1)
    }
  }

  private recordUpdate(key: RowKey, row: T, prev: T, path: Path, deleted?: boolean): void {
    const prior = this.pending.get(key)
    if (prior === undefined) {
      this.pending.set(
        key,
        deleted === true
          ? { op: 'update', key, row, prev, path, deleted: true }
          : { op: 'update', key, row, prev, path },
      )
    } else if (prior.op === 'add') {
      this.pending.set(key, { op: 'add', key, row })
    } else if (prior.op === 'update') {
      const samePath =
        prior.path.length === path.length && prior.path.every((p, i) => p === path[i])
      if (samePath && Object.is(leafAt(prior.prev, path), leafAt(row, path))) {
        // The batch's net effect at this leaf is zero (e.g. a flip A→B→A, or
        // set-then-delete of a field the row never owned): annihilate —
        // emitting it would be a phantom update (clause 8). Same-path merges
        // structurally share every other field with prev, so a leaf-equal
        // merge means the whole row is content-identical. (Clause 10 corner:
        // an explicit-undefined leaf deleted in the same batch that set it
        // annihilates too — at the deep-write layer leaf-absent ≡
        // leaf-undefined, the documented value-domain equivalence.)
        this.pending.delete(key)
        return
      }
      // Merged shape: same path keeps the path (and the LAST op's deletion
      // marker — set-then-delete stays a delete, delete-then-set a write);
      // diverged paths collapse to a whole-row update, where the flag is
      // meaningless (the full row already carries the truth).
      this.pending.set(
        key,
        samePath && deleted === true
          ? { op: 'update', key, row, prev: prior.prev, path, deleted: true }
          : { op: 'update', key, row, prev: prior.prev, path: samePath ? path : [] },
      )
    }
  }

  private snapPreOrder(): void {
    if (this.preBatchOrder === null && this.order !== null) this.preBatchOrder = this.order.slice()
  }

  settle(seq: number, origin: OriginToken): CommitBatch<T> | null {
    if (this.pending.size === 0 && this.preBatchOrder === null) return null
    // Fast path for the batch-of-one (single-row commits dominate real ticks).
    let rows: RowDelta<T>[]
    if (this.pending.size === 1) {
      rows = [this.pending.values().next().value as RowDelta<T>]
      this.pending.clear()
    } else {
      rows = [...this.pending.values()]
      this.pending = new Map()
    }
    let order: OrderDelta[] | undefined
    if (this.preBatchOrder !== null) {
      order = diffOrder(this.preBatchOrder, this.order!)
      this.preBatchOrder = null
      if (order.length === 0) order = undefined
    } else if (this.ordered && this.order === null) {
      // Virtual order (M6 P3): every structural change this batch was a tail
      // append of an identity key (anything else would have materialized),
      // so the order delta is one orderInsert per add at index ≡ key —
      // ascending, matching diffOrder's insert convention, because pending
      // preserves write order and later appends mint larger keys.
      for (const d of rows) {
        if (d.op === 'add') (order ??= []).push({ op: 'orderInsert', key: d.key, index: d.key as number })
      }
    }
    if (rows.length === 0 && order === undefined) return null
    // One monomorphic batch shape (order/scalar always present as fields).
    return { seq, origin, rows, order, scalar: undefined }
  }
}
