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

  connect(entry: EffectEntry<Out>): SubscriptionHandle {
    this.effects.push(entry)
    const self = this
    const handle: SubscriptionHandle = {
      dispose() {
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
    this.effects.length = 0
    this.scope?.delete(this)
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function shallowCopy(v: any): any {
  return Array.isArray(v) ? v.slice() : { ...v }
}

export function leafAt(v: unknown, path: Path): unknown {
  let cur: any = v
  for (const p of path) {
    if (cur == null) return undefined
    cur = cur[p]
  }
  return cur
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
export function diffOrder(pre: readonly RowKey[], post: readonly RowKey[]): OrderDelta[] {
  const postSet = new Set(post)
  const preSet = new Set(pre)
  const out: OrderDelta[] = []
  for (let i = pre.length - 1; i >= 0; i--) {
    if (!postSet.has(pre[i])) out.push({ op: 'orderRemove', key: pre[i], index: i })
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
  declare order: RowKey[] | null // array-born sources only
  declare pending: Map<RowKey, RowDelta<T>>
  declare preBatchOrder: RowKey[] | null
  declare inDirty: boolean // runtime dirty-list membership flag

  constructor(runtime: Runtime, value: Record<string, T> | T[], name = 'source') {
    super(runtime, 'source', name, [])
    this.store = new Store<T>()
    this.pending = new Map()
    this.preBatchOrder = null
    this.inDirty = false
    if (Array.isArray(value)) {
      this.order = []
      for (const row of value) {
        const k = this.store.mintKey()
        this.store.set(k, row)
        this.order.push(k)
      }
    } else {
      this.order = null
      for (const k of Object.keys(value)) this.store.set(k, value[k])
    }
  }

  currentOrder(): readonly RowKey[] | null {
    return this.order
  }

  snapshot(): Map<RowKey, T> {
    return this.store.snapshot()
  }

  get(key: RowKey): T | undefined {
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
    const slot = this.store.slotOf(key)
    if (slot === undefined) {
      if (path.length > 0)
        throw new Error(`data: deep write at [${String(key)}.${path.join('.')}] — key ${String(key)} is not live`)
      this.applyAdd(key, value as T, at)
      rt.written(this)
      return
    }
    const prev = this.store.rowAt(slot)
    const before = leafAt(prev, path)
    if (Object.is(before, value)) return // no-phantom-events, enforced once
    const next = pathCopy(prev, path, value)
    this.store.writeSlot(slot, next)
    this.recordUpdate(key, next, prev, path)
    rt.written(this)
  }

  insert(row: T, at?: number): RowKey {
    const rt = this.runtime
    if (!rt.canWriteNow()) {
      rt.queueWrite(() => void this.insert(row, at))
      return -1
    }
    const key = this.order !== null ? this.store.mintKey() : this.autoObjectKey()
    this.applyAdd(key, row, at)
    rt.written(this)
    return key
  }

  remove(key: RowKey): void {
    const rt = this.runtime
    if (!rt.canWriteNow()) {
      rt.queueWrite(() => this.remove(key))
      return
    }
    if (!this.store.has(key)) return
    this.applyRemove(key)
    rt.written(this)
  }

  private autoObjectKey(): string {
    let n = this.store.size
    while (this.store.has(String(n))) n++
    return String(n)
  }

  // ── consolidation (delta.ts rules, implemented once) ───────────────────────

  private applyAdd(key: RowKey, row: T, at?: number): void {
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
    if (this.order !== null) {
      this.snapPreOrder()
      const i = at === undefined || at < 0 || at > this.order.length ? this.order.length : at
      this.order.splice(i, 0, key)
    }
  }

  private applyRemove(key: RowKey): void {
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

  private recordUpdate(key: RowKey, row: T, prev: T, path: Path): void {
    const prior = this.pending.get(key)
    if (prior === undefined) {
      this.pending.set(key, { op: 'update', key, row, prev, path })
    } else if (prior.op === 'add') {
      this.pending.set(key, { op: 'add', key, row })
    } else if (prior.op === 'update') {
      const samePath =
        prior.path.length === path.length && prior.path.every((p, i) => p === path[i])
      if (samePath && Object.is(leafAt(prior.prev, path), leafAt(row, path))) {
        // The batch's net effect at this leaf is zero (e.g. a flip A→B→A):
        // annihilate — emitting it would be a phantom update (clause 8).
        // Same-path merges structurally share every other field with prev,
        // so a leaf-equal merge means the whole row is content-identical.
        this.pending.delete(key)
        return
      }
      this.pending.set(key, {
        op: 'update', key, row, prev: prior.prev, path: samePath ? path : [],
      })
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
    }
    if (rows.length === 0 && order === undefined) return null
    // One monomorphic batch shape (order/scalar always present as fields).
    return { seq, origin, rows, order, scalar: undefined }
  }
}
