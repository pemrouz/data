// v3/ops/reactive.ts — the UNIFORM reactive value-slot binder (v3's answer to
// v2's `bindReactive`, generalizing between's hidden-input-SourceNode pattern).
//
// The shape (see v3/ops/between.ts's header — the M2 precedent this module
// makes uniform): every reactive value-slot arg is mirrored into a hidden
// per-operator PARAM SourceNode that is a real SECOND PARENT of the operator
// node. Param changes therefore flow through the normal commit machinery —
// they get a real seq, consolidate to ≤1 delta per key, and inherit the
// re-entrancy discipline — without any kernel change.
//
// The bridge from the user's reactive arg (a v3 handle or raw DataNode) to
// the param source is an EffectEntry subscription (`bindParam`): effects run
// after all operator state is settled (SCHEDULE clause 4), and the write they
// issue is queued as the NEXT commit (clause 5), drained inside the same
// synchronous flush — so a bare write to the arg still settles the whole
// cascade before returning to the caller. Consequence (documented): an arg
// change and a data write issued in one batch() settle as two consecutive
// commits within one flush (data first, then the param re-select), each batch
// individually legal — the v2 contract was equally coarse.
//
// v2 semantics carried over:
// - construction-time seed is NOT emitted (v2's construction-connect-is-noop
//   rule): bindParam only subscribes; the initial value is returned to the
//   caller and baked into the node's constructor state.
// - compare (gt/lt/gte/lte) on a threshold move re-selects membership with an
//   O(N) re-scan emitting one consolidated batch of adds (newly-passing) +
//   removes (newly-failing) — the documented v2 coarse-recompute contract
//   (prefer between for a fast-moving bound over a large source: its walk is
//   O(Δ)).
// - ordered (za/az/top/limit) on a window-size move re-windows IN PLACE via
//   OrderedView's once-per-batch window reconcile — the emitted batch is the
//   window keyset diff (evictions + entrants + a coherent order script).
// - sum/avg on a column move re-aggregate from the parent snapshot and emit
//   ONE scalar delta (or nothing, when the new column happens to produce the
//   same value).
// - reactive n coerces through Number() (the v2 `limit($(n))` lesson — a
//   strict `=== n` cap never fires against a proxy); non-numeric → Infinity
//   (unbounded).
// - dedup: reactive args dedup by the BOUND NODE's identity (plus the
//   handle's key path, read off its toString), never by current value —
//   matching the plan's rule and v2's `arg[view]` identity dedup.
//
// installReactive() re-registers 'gt','lt','gte','lte','za','az','top',
// 'limit','sum','avg','between' by WRAPPING the existing registry defs
// (delegating to the original create/dedupKey whenever the value-slot arg is
// plain), via
// registry.set (defineOperator throws on duplicates). Function-slot args
// (filter(fn), map, group(fn), …) are deliberately NOT reactive — the v2
// "operators react only to args they explicitly subscribe to" rule.
//
// This module must not import v3/api (the api will import installReactive —
// see integration notes); the handle symbols are recovered via Symbol.for.

import type { CommitBatch, OriginToken, RowDelta, RowKey } from '../contract/delta.ts'
import { DataNode, SourceNode } from '../kernel/node.ts'
import type { Runtime } from '../kernel/runtime.ts'
import { registry } from './registry.ts'
import type { OpDef } from './registry.ts'
import { FilterNode } from './rowops.ts'
import { OrderedView, cmpBy } from './ordered.ts'
import type { RowComparator } from './ordered.ts'
import { SumNode, AvgNode } from './aggregate.ts'
import { between, BetweenNode } from './between.ts'

// The api's handle symbols (Symbol.for — global registry, so no api import).
const NODE = Symbol.for('data.v3.node')
const VALUE = Symbol.for('data.v3.value')

const PKEY = 'p' // the single key inside every hidden param SourceNode

// ── 1. reactiveArg — the normalizer ─────────────────────────────────────────

export interface ReactiveArg {
  readonly isReactive: boolean
  readonly node: DataNode<any> | null
  // Dedup identity: node id, plus the handle's key path (its toString embeds
  // `#id .path`, so two child handles of one source never collide). Stable
  // across value changes; null for plain args.
  readonly identity: string | null
  current(): unknown
}

function materializeNode(n: DataNode<any>): unknown {
  const snap = n.snapshot()
  const order = n.currentOrder()
  if (order !== null) return order.map((k) => snap.get(k))
  const out: Record<string, unknown> = {}
  for (const [k, v] of snap) out[String(k)] = v
  return out
}

export function reactiveArg(arg: unknown): ReactiveArg {
  if (arg instanceof DataNode) {
    const n = arg
    return {
      isReactive: true,
      node: n,
      identity: `@${n.id}`,
      // scalar nodes read value(); collection nodes read the materialized
      // whole (a raw-node arg is an internal-composition convenience — the
      // public path is a handle, whose [value] already resolves paths).
      current: () => (n.kind === 'scalar' ? (n as any).value() : materializeNode(n)),
    }
  }
  if (arg !== null && typeof arg === 'object') {
    const n = (arg as any)[NODE]
    if (n instanceof DataNode) {
      return {
        isReactive: true,
        node: n,
        identity: `@${n.id}:${String(arg)}`,
        current: () => (arg as any)[VALUE],
      }
    }
  }
  return { isReactive: false, node: null, identity: null, current: () => arg }
}

// ── 2. bindParam — subscribe a reactive arg to an owner node ────────────────
//
// Subscribes an EffectEntry on the arg's node; every commit of that node
// re-reads the arg's current value and hands it to onChange (a no-op write
// into the param source when the leaf didn't move — SourceNode's central
// Object.is drop). The construction-time seed is NOT emitted: connect only
// subscribes; the initial value is returned. The subscription is owned by the
// owner: disposing the owner (directly or via its scope chain, which disposes
// its nodes) detaches the subscription before the node's own teardown.

export function bindParam<T>(owner: DataNode<any>, arg: unknown, onChange: (v: T) => void): T {
  const ra = reactiveArg(arg)
  if (!ra.isReactive) return arg as T
  const argNode = ra.node as DataNode<any>
  if (argNode.runtime !== owner.runtime)
    throw new Error(
      `data: reactive arg (node #${argNode.id}) belongs to a different runtime than the operator it parameterizes`,
    )
  const current = ra.current
  const handle = argNode.connect({
    wantsOrder: false,
    origin: null,
    apply() {
      onChange(current() as T)
    },
  })
  const ownerDispose = owner.dispose.bind(owner)
  owner.dispose = function () {
    handle.dispose()
    ownerDispose()
  }
  return current() as T
}

// ── shared internals ─────────────────────────────────────────────────────────

// Split this commit's ingested inputs into (data-parent batch, param batch).
function splitInputs(node: DataNode<any>): {
  data: CommitBatch<any> | null
  param: CommitBatch<any> | null
} {
  const dataParent = node.parents[0]
  let data: CommitBatch<any> | null = null
  let param: CommitBatch<any> | null = null
  if (node.in0 !== null) {
    if (node.inFrom0 === dataParent) data = node.in0
    else param = node.in0
  }
  if (node.inMore !== null) {
    for (const m of node.inMore) {
      if (m.from === dataParent) data = m.batch
      else param = m.batch
    }
  }
  return { data, param }
}

function lastParam(batch: CommitBatch<any>, fallback: unknown): unknown {
  let v = fallback
  for (const d of batch.rows) if (d.op !== 'remove') v = (d as any).row
  return v
}

// Adopt the hidden param source as a real second parent (between's shape).
// paramSrc.height is 0, so the operator's height stays topologically valid.
function adoptParam(node: DataNode<any>, paramSrc: SourceNode<any>): void {
  ;(node.parents as DataNode<any>[]).push(paramSrc)
  paramSrc.children.push(node)
}

// Per-batch consolidation for membership re-selects (the delta.ts merge
// rules, local — same as between's pend).
function mergePend<T>(map: Map<RowKey, RowDelta<T>>, d: RowDelta<T>): void {
  const prior = map.get(d.key)
  if (prior === undefined) {
    map.set(d.key, d)
    return
  }
  if (prior.op === 'add') {
    if (d.op === 'update') map.set(d.key, { op: 'add', key: d.key, row: d.row })
    else if (d.op === 'remove') map.delete(d.key) // annihilate
  } else if (prior.op === 'update') {
    if (d.op === 'update') {
      const samePath = prior.path.length === d.path.length && prior.path.every((p, i) => p === d.path[i])
      map.set(d.key, { op: 'update', key: d.key, row: d.row, prev: prior.prev, path: samePath ? d.path : [] })
    } else if (d.op === 'remove') {
      map.set(d.key, { op: 'remove', key: d.key, prev: prior.prev })
    }
  } else {
    // prior remove
    if (d.op === 'add') map.set(d.key, { op: 'update', key: d.key, row: d.row, prev: prior.prev, path: [] })
  }
}

function publishScalar(node: any, seq: number, origin: OriginToken): CommitBatch<never> | null {
  const next = node.read()
  if (Object.is(node.cur, next)) return null
  const prev = node.cur
  node.cur = next
  return { seq, origin, rows: [], order: undefined, scalar: { prev, next } }
}

// Reactive window sizes coerce through Number() (the v2 limit($(n)) lesson);
// non-numeric (undefined, NaN-producing) → Infinity = unbounded.
export function normN(v: unknown): number {
  const num = typeof v === 'number' ? v : Number(v)
  return Number.isNaN(num) ? Infinity : num
}

function normCol(v: unknown): string | undefined {
  return v === undefined || v === null ? undefined : typeof v === 'string' ? v : String(v)
}

// Projection normalization — identical to aggregate.ts's proj (unexported).
function projNorm(col: string | undefined, row: any): unknown {
  const x = col === undefined ? row : row?.[col]
  return x === undefined || x === null ? undefined : x
}

// ── 3a. compareR — gt/lt/gte/lte with a reactive threshold ──────────────────

export type CmpOp = 'gt' | 'lt' | 'gte' | 'lte'
const CMP: Record<CmpOp, (a: any, b: any) => boolean> = {
  gt: (a, b) => a > b,
  lt: (a, b) => a < b,
  gte: (a, b) => a >= b,
  lte: (a, b) => a <= b,
}

export class CompareRNode<T> extends FilterNode<T> {
  declare box: { t: unknown } // APPLIED threshold (as of the last settle)
  declare paramSrc: SourceNode<unknown> // TARGET threshold (post-write)
  declare target: () => unknown // read-your-writes source for mid-batch reads

  constructor(
    runtime: Runtime,
    parent: DataNode<T>,
    paramSrc: SourceNode<unknown>,
    op: CmpOp,
    col: string,
    t0: unknown,
  ) {
    const box = { t: t0 }
    const cmp = CMP[op]
    super(runtime, parent, (row: any) => cmp(row?.[col], box.t), op)
    this.box = box
    this.paramSrc = paramSrc
    this.target = () => paramSrc.get(PKEY)
    adoptParam(this, paramSrc)
  }

  threshold(): unknown {
    return this.target()
  }

  snapshot(): Map<RowKey, T> {
    if (this.runtime.midBatch) {
      // Flush-on-read against the post-write TARGET threshold (clause 2b).
      const saved = this.box.t
      this.box.t = this.target()
      try {
        return super.snapshot()
      } finally {
        this.box.t = saved
      }
    }
    return super.snapshot()
  }

  settle(seq: number, origin: OriginToken): CommitBatch<T> | null {
    const { data, param } = splitInputs(this)
    if (data === null && param === null) return null
    const pending = new Map<RowKey, RowDelta<T>>()
    if (data !== null) {
      // Delegate the data phase to FilterNode (applied against the OLD
      // threshold — the pred closure still reads the pre-param box).
      this.in0 = data
      this.inFrom0 = this.parents[0]
      this.inMore = null
      const b = super.settle(seq, origin)
      if (b !== null) for (const d of b.rows) pending.set(d.key, d)
    }
    if (param !== null) {
      this.box.t = lastParam(param, this.box.t)
      // The documented v2 coarse-recompute contract for compare value-slots:
      // O(N) re-scan, one consolidated batch of adds (newly-passing) +
      // removes (newly-failing). mergePend composes with the data phase
      // (e.g. data-add + param-evict annihilates; data-remove + param-admit
      // becomes an update carrying the pre-batch prev).
      for (const [k, row] of this.parents[0].snapshot() as Map<RowKey, T>) {
        const was = this.view.has(k)
        const now = this.pred(row, k)
        if (was && !now) {
          const prev = this.view.get(k) as T
          this.view.delete(k)
          mergePend(pending, { op: 'remove', key: k, prev })
        } else if (!was && now) {
          this.view.set(k, row)
          mergePend(pending, { op: 'add', key: k, row })
        }
      }
    }
    if (pending.size === 0) return null
    return { seq, origin, rows: [...pending.values()], order: undefined, scalar: undefined }
  }

  dispose(): void {
    super.dispose()
    this.paramSrc.dispose()
  }
}

export function compareR<T>(src: DataNode<T>, op: CmpOp, col: string, threshold: unknown): CompareRNode<T> {
  const ra = reactiveArg(threshold)
  const t0 = ra.current()
  const paramSrc = new SourceNode<unknown>(src.runtime, { [PKEY]: t0 }, `param:${op}`)
  const node = new CompareRNode<T>(src.runtime, src, paramSrc, op, col, t0)
  if (ra.isReactive) {
    node.target = ra.current // mid-batch reads see the arg's post-write value
    bindParam(node, threshold, (v) => paramSrc.write(PKEY, [], v))
  }
  return node
}

// ── 3b. orderedR — za/az/top/limit with a reactive window size ──────────────

export type OrderedName = 'az' | 'za' | 'top' | 'limit'

function cmpFor<T>(name: OrderedName, by: string | RowComparator<T> | undefined): RowComparator<T> {
  if (name === 'limit') return () => 0 // all-ties → pure view-arrival order
  if (name === 'top') return cmpBy<T>((r) => r, -1)
  if (typeof by === 'string') return cmpBy<T>((row: any) => row?.[by], name === 'za' ? -1 : 1)
  const f = by as RowComparator<T>
  return name === 'za' ? (a, b) => f(b, a) : f
}

export class OrderedRNode<T> extends OrderedView<T> {
  declare paramSrc: SourceNode<unknown> // TARGET n (post-write); this.n = APPLIED
  declare target: () => unknown

  constructor(
    runtime: Runtime,
    parent: DataNode<T>,
    paramSrc: SourceNode<unknown>,
    name: OrderedName,
    cmp: RowComparator<T>,
    n0: number,
  ) {
    super(runtime, parent, name, cmp, n0 === Infinity ? undefined : n0)
    this.paramSrc = paramSrc
    this.target = () => paramSrc.get(PKEY)
    adoptParam(this, paramSrc)
  }

  windowSize(): number {
    return normN(this.target())
  }

  currentOrder(): readonly RowKey[] {
    if (this.runtime.midBatch) {
      const saved = this.n
      this.n = normN(this.target())
      try {
        return super.currentOrder()
      } finally {
        this.n = saved
      }
    }
    return super.currentOrder()
  }

  snapshot(): Map<RowKey, T> {
    if (this.runtime.midBatch) {
      const saved = this.n
      this.n = normN(this.target())
      try {
        return super.snapshot()
      } finally {
        this.n = saved
      }
    }
    return super.snapshot()
  }

  settle(seq: number, origin: OriginToken): CommitBatch<T> | null {
    const { data, param } = splitInputs(this)
    if (data === null && param === null) return null
    // Apply the new n FIRST, then run OrderedView's single once-per-batch
    // window reconcile: a pure resize emits exactly the window keyset diff
    // (tail evictions or entrants + a coherent order script); a combined
    // data + resize commit is one legal consolidated batch.
    if (param !== null) this.n = normN(lastParam(param, this.n))
    this.in0 = data ?? { seq, origin, rows: [], order: undefined, scalar: undefined }
    this.inFrom0 = this.parents[0]
    this.inMore = null
    return super.settle(seq, origin)
  }

  dispose(): void {
    super.dispose()
    this.paramSrc.dispose()
  }
}

export function orderedR<T>(
  src: DataNode<T>,
  by: string | RowComparator<T> | undefined,
  n: unknown,
  name: OrderedName = 'az',
): OrderedRNode<T> {
  const ra = reactiveArg(n)
  const n0 = ra.current()
  const paramSrc = new SourceNode<unknown>(src.runtime, { [PKEY]: n0 }, `param:${name}`)
  const node = new OrderedRNode<T>(src.runtime, src, paramSrc, name, cmpFor<T>(name, by), normN(n0))
  if (ra.isReactive) {
    node.target = ra.current
    bindParam(node, n, (v) => paramSrc.write(PKEY, [], v))
  }
  return node
}

// ── 3c. sumR / avgR — aggregates with a reactive column ─────────────────────
//
// On a column move: rebuild the tracked projection set + accumulators from
// the parent's (already-settled, post-batch) snapshot and emit ONE scalar
// delta. A data-only commit delegates to the incremental O(Δ) base path.

export class SumRNode<T> extends SumNode<T> {
  declare paramSrc: SourceNode<unknown>
  declare target: () => unknown

  constructor(runtime: Runtime, parent: DataNode<T>, paramSrc: SourceNode<unknown>, col0: string | undefined) {
    super(runtime, parent, 'sum', col0)
    this.paramSrc = paramSrc
    this.target = () => paramSrc.get(PKEY)
    adoptParam(this, paramSrc)
  }

  column(): string | undefined {
    return normCol(this.target())
  }

  private rebuild(): void {
    this.tracked = new Map()
    this.total = 0
    for (const [k, row] of this.parents[0].snapshot() as Map<RowKey, unknown>) {
      const x = projNorm(this.col, row)
      if (x !== undefined) {
        this.tracked.set(k, x)
        this.total += +(x as any)
      }
    }
  }

  value(): unknown {
    if (!this.runtime.midBatch) return this.cur
    const saved = this.col
    this.col = normCol(this.target())
    try {
      return this.recompute(this.parents[0].snapshot() as Map<RowKey, unknown>)
    } finally {
      this.col = saved
    }
  }

  settle(seq: number, origin: OriginToken): CommitBatch<never> | null {
    const { data, param } = splitInputs(this)
    if (data === null && param === null) return null
    if (param !== null) {
      // The rebuild reads the parent's post-batch snapshot, which already
      // reflects any data deltas from this commit — subsumes the data batch.
      this.col = normCol(lastParam(param, this.col))
      this.rebuild()
      return publishScalar(this, seq, origin)
    }
    this.in0 = data
    this.inFrom0 = this.parents[0]
    this.inMore = null
    return super.settle(seq, origin)
  }

  dispose(): void {
    super.dispose()
    this.paramSrc.dispose()
  }
}

export class AvgRNode<T> extends AvgNode<T> {
  declare paramSrc: SourceNode<unknown>
  declare target: () => unknown

  constructor(runtime: Runtime, parent: DataNode<T>, paramSrc: SourceNode<unknown>, col0: string | undefined) {
    super(runtime, parent, 'avg', col0)
    this.paramSrc = paramSrc
    this.target = () => paramSrc.get(PKEY)
    adoptParam(this, paramSrc)
  }

  column(): string | undefined {
    return normCol(this.target())
  }

  private rebuild(): void {
    this.tracked = new Map()
    this.total = 0
    this.count = 0
    for (const [k, row] of this.parents[0].snapshot() as Map<RowKey, unknown>) {
      const x = projNorm(this.col, row)
      if (x !== undefined) {
        this.tracked.set(k, x)
        this.total += +(x as any)
        this.count++
      }
    }
  }

  value(): unknown {
    if (!this.runtime.midBatch) return this.cur
    const saved = this.col
    this.col = normCol(this.target())
    try {
      return this.recompute(this.parents[0].snapshot() as Map<RowKey, unknown>)
    } finally {
      this.col = saved
    }
  }

  settle(seq: number, origin: OriginToken): CommitBatch<never> | null {
    const { data, param } = splitInputs(this)
    if (data === null && param === null) return null
    if (param !== null) {
      this.col = normCol(lastParam(param, this.col))
      this.rebuild()
      return publishScalar(this, seq, origin)
    }
    this.in0 = data
    this.inFrom0 = this.parents[0]
    this.inMore = null
    return super.settle(seq, origin)
  }

  dispose(): void {
    super.dispose()
    this.paramSrc.dispose()
  }
}

export function sumR<T>(src: DataNode<T>, col: unknown): SumRNode<T> {
  const ra = reactiveArg(col)
  const c0 = normCol(ra.current())
  const paramSrc = new SourceNode<unknown>(src.runtime, { [PKEY]: ra.current() }, 'param:sum')
  const node = new SumRNode<T>(src.runtime, src, paramSrc, c0)
  if (ra.isReactive) {
    node.target = ra.current
    bindParam(node, col, (v) => paramSrc.write(PKEY, [], v))
  }
  return node
}

export function avgR<T>(src: DataNode<T>, col: unknown): AvgRNode<T> {
  const ra = reactiveArg(col)
  const c0 = normCol(ra.current())
  const paramSrc = new SourceNode<unknown>(src.runtime, { [PKEY]: ra.current() }, 'param:avg')
  const node = new AvgRNode<T>(src.runtime, src, paramSrc, c0)
  if (ra.isReactive) {
    node.target = ra.current
    bindParam(node, col, (v) => paramSrc.write(PKEY, [], v))
  }
  return node
}

// ── 4. installReactive — wrap the registry entries ──────────────────────────

// ── betweenR — reactive bounds on between ────────────────────────────────────
//
// The one reactive slot that needs NO hidden param source of its own:
// BetweenNode already routes bounds through an internal SourceNode (the M2
// precedent this module generalized), and setBounds is the O(Δ) brush walk —
// so a reactive bounds arg binds straight onto it. This is the crossfilter
// idiom: `flights.between('date', filters.date)` — every write to the
// filters tuple re-selects only the rows whose col value crossed a boundary.
// An empty/non-array leaf ([] = unfiltered, the v2 contract) opens to ±∞.

const normBounds = (b: unknown): readonly [number?, number?] =>
  Array.isArray(b) ? (b as [number?, number?]) : []

export function betweenR<T>(src: DataNode<T>, col: string, arg: unknown): BetweenNode<T> {
  const ra = reactiveArg(arg)
  const node = between(src, col, normBounds(ra.current()))
  bindParam(node, arg, (b: unknown) => node.setBounds(normBounds(b)))
  return node
}

function wrapDef(
  name: string,
  reactiveCreate: (src: DataNode<any>, args: any[]) => DataNode<any> | null,
  // undefined = arg is plain, delegate to the original dedupKey;
  // string/null = the reactive key (null = never dedup).
  reactiveKey: (args: any[]) => string | null | undefined,
): void {
  const orig = registry.get(name)
  if (orig === undefined) throw new Error(`data: installReactive — operator ${name} is not registered`)
  const def: OpDef = {
    name: orig.name,
    kind: orig.kind,
    category: orig.category,
    declarative: orig.declarative,
    create: (src: DataNode<any>, ...args: any[]) => reactiveCreate(src, args) ?? orig.create(src, ...args),
    dedupKey: (...args: any[]) => {
      const k = reactiveKey(args)
      if (k !== undefined) return k
      return orig.dedupKey ? orig.dedupKey(...args) : null
    },
  }
  registry.set(name, def) // defineOperator throws on duplicates — override directly
}

let installed = false

export function installReactive(): void {
  if (installed) return
  installed = true

  for (const op of ['gt', 'lt', 'gte', 'lte'] as const) {
    wrapDef(
      op,
      (src, [col, threshold]) => (reactiveArg(threshold).isReactive ? compareR(src, op, col, threshold) : null),
      ([col, threshold]) => {
        const ra = reactiveArg(threshold)
        if (!ra.isReactive) return undefined
        return typeof col === 'string' ? `${op}:${col}:${ra.identity}` : null
      },
    )
  }

  for (const name of ['az', 'za'] as const) {
    wrapDef(
      name,
      (src, [by, n]) => (reactiveArg(n).isReactive ? orderedR(src, by, n, name) : null),
      ([by, n]) => {
        const ra = reactiveArg(n)
        if (!ra.isReactive) return undefined
        return typeof by === 'string' ? `${name}:${by}:${ra.identity}` : null // comparator by → never dedup
      },
    )
  }

  for (const name of ['top', 'limit'] as const) {
    wrapDef(
      name,
      (src, [n]) => (reactiveArg(n).isReactive ? orderedR(src, undefined, n, name) : null),
      ([n]) => {
        const ra = reactiveArg(n)
        return ra.isReactive ? `${name}:${ra.identity}` : undefined
      },
    )
  }

  for (const name of ['sum', 'avg'] as const) {
    wrapDef(
      name,
      (src, [col]) =>
        reactiveArg(col).isReactive ? (name === 'sum' ? sumR(src, col) : avgR(src, col)) : null,
      ([col]) => {
        const ra = reactiveArg(col)
        return ra.isReactive ? `${name}:${ra.identity}` : undefined
      },
    )
  }

  wrapDef(
    'between',
    (src, [col, bounds]) => (reactiveArg(bounds).isReactive ? betweenR(src, col, bounds) : null),
    ([col, bounds]) => {
      const ra = reactiveArg(bounds)
      if (!ra.isReactive) return undefined
      return typeof col === 'string' ? `between:${col}:${ra.identity}` : null
    },
  )
}
