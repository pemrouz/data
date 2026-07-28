// v3/ops/between.ts — the range-membership view (crossfilter's core).
//
// Ported v2 algorithmic IP (operators/between/index.ts), re-expressed in the
// closed delta algebra:
//   - the sorted [colValue, key] index with LAZY re-sort: value mutations set
//     a dirty flag; the index is rebuilt only when the next bounds walk needs
//     it (amortizing many data ticks into one O(N log N) sort per brush)
//   - the BRUSH WALK: on setBounds, bisect the sorted index for the old and
//     new bound positions and walk only the rows whose col value crossed a
//     boundary, emitting add/remove per crossing row — O(Δ) per brush step,
//     never O(N). lo_index/hi_index persist across walks (no bisect at all on
//     consecutive brush steps over quiet data).
//   - membership-transition guards on the walk (v2's C8 fix): a walk loop is
//     bounded only by the MOVING bound, so a sweep past the opposite boundary
//     steps onto rows that were never in view — the view.has() guard
//     suppresses the phantom add/remove.
//   - crossed bounds normalize (setBounds([80, 20]) ≡ setBounds([20, 80])) —
//     v2's single-bound-setter auto-sort, kept as the documented contract.
//   - bounds are INCLUSIVE on both ends; a point range [v, v] selects rows
//     with col === v (v2 parity — never collapses to empty).
//
// v3 simplifications embraced: no sparse arrays, no holes, no positional
// anything — between over an array-born source is a keyed membership view
// like any other. The v2 full-domain alias fast path (share the source value
// when unfiltered) has no Map-world equivalent and buys nothing here: a widen
// to (-∞, ∞) is already O(rows entering) via the walk.
//
// setBounds routes through a hidden internal bounds SourceNode (this node's
// second parent): writes to it flow through the normal commit machinery, so a
// bounds change gets a real seq, consolidates with data writes issued in the
// same batch() (one output batch, ≤1 delta per key), and inherits re-entrancy
// handling (setBounds inside an effect queues as the next commit) — without
// any kernel change.

import type { CommitBatch, OriginToken, Path, RowDelta, RowKey } from '../contract/delta.ts'
import { DataNode, SourceNode } from '../kernel/node.ts'
import type { Runtime } from '../kernel/runtime.ts'
import { defineOperator } from './registry.ts'
import { MembershipView } from './membership.ts'

type Bounds = readonly [number, number]
const BKEY = 'b'

// first index with vals[i] >= x
function lowerBound(vals: readonly unknown[], x: unknown): number {
  let lo = 0
  let hi = vals.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if ((vals[mid] as any) < (x as any)) lo = mid + 1
    else hi = mid
  }
  return lo
}

// first index with vals[i] > x
function upperBound(vals: readonly unknown[], x: unknown): number {
  let lo = 0
  let hi = vals.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if ((vals[mid] as any) <= (x as any)) lo = mid + 1
    else hi = mid
  }
  return lo
}

export class BetweenNode<T> extends DataNode<T> {
  declare col: string
  declare lo: number // APPLIED bounds (as of the last settle)
  declare hi: number
  declare boundsSrc: SourceNode<Bounds> // TARGET bounds (post-write, read-your-writes)
  declare view: MembershipView // in-range MEMBERSHIP (rows delegate to parents[0] — M6 P1/P4)
  // The sorted index: parallel arrays of col values and keys, ascending by
  // value. Excludes rows whose col value is undefined/null/NaN (they can never
  // satisfy an inclusive numeric range, and NaN entries would break both the
  // sort order and the walk's comparison-bounded loops — a latent v2 hazard).
  declare sVals: unknown[]
  declare sKeys: RowKey[]
  declare sortedDirty: boolean
  // Bisect positions of the applied bounds in the index. Convention (v2):
  // loIdx = first position with val >= lo (first in-view row on the low side);
  // hiIdx = first position with val > hi (first out-of-view row past the high
  // side). undefined = recompute lazily at the next walk (??= bisect).
  declare loIdx: number | undefined
  declare hiIdx: number | undefined
  declare pendScratch: Map<RowKey, RowDelta<T>> | undefined // settle scratch — reused per commit

  constructor(
    runtime: Runtime,
    parent: DataNode<T>,
    boundsSrc: SourceNode<Bounds>,
    col: string,
    lo: number,
    hi: number,
  ) {
    super(runtime, 'operator', 'between', [parent, boundsSrc])
    this.col = col
    this.lo = lo
    this.hi = hi
    this.boundsSrc = boundsSrc
    this.view = new MembershipView(parent)
    parent.each((k, row) => {
      const x = (row as any)?.[col]
      if (x != null && x >= lo && x <= hi) this.view.add(k)
    })
    this.view.maybeFlip() // a full-domain construction lands as an EMPTY exclude set
    this.sVals = []
    this.sKeys = []
    this.sortedDirty = true // built lazily by the first bounds walk
    this.loIdx = undefined
    this.hiIdx = undefined
  }

  // ── public surface ──────────────────────────────────────────────────────────

  // Re-select incrementally to new bounds — the hot path. Crossed bounds
  // normalize (lo > hi swaps); a missing bound defaults to ±Infinity.
  setBounds(bounds: readonly [number?, number?]): void {
    let a = (bounds[0] ?? -Infinity) as number
    let b = (bounds[1] ?? Infinity) as number
    if (b < a) {
      const t = a
      a = b
      b = t
    }
    const cur = this.boundsSrc.get(BKEY)
    if (cur !== undefined && Object.is(cur[0], a) && Object.is(cur[1], b)) return
    this.boundsSrc.write(BKEY, [], [a, b])
  }

  bounds(): Bounds {
    return this.boundsSrc.get(BKEY) ?? [this.lo, this.hi]
  }

  snapshot(): Map<RowKey, T> {
    if (this.runtime.midBatch) {
      // Flush-on-read: recompute PURE from parents (SCHEDULE clause 2b) using
      // the post-write TARGET bounds (source reads see post-write values).
      const [lo, hi] = this.boundsSrc.get(BKEY) ?? [this.lo, this.hi]
      const m = new Map<RowKey, T>()
      const col = this.col
      for (const [k, row] of this.parents[0].snapshot()) {
        const x = (row as any)?.[col]
        if (x != null && x >= lo && x <= hi) m.set(k, row as T)
      }
      return m
    }
    const m = new Map<RowKey, T>()
    const p = this.parents[0]
    this.view.eachKey((k) => m.set(k, p.rowAt(k) as T))
    return m
  }

  hasRow(key: RowKey): boolean {
    if (this.runtime.midBatch) return super.hasRow(key)
    return this.view.has(key)
  }

  rowAt(key: RowKey): T | undefined {
    if (this.runtime.midBatch) return super.rowAt(key)
    return this.view.has(key) ? this.parents[0].rowAt(key) : undefined
  }

  each(fn: (key: RowKey, row: T) => void): void {
    if (this.runtime.midBatch) return super.each(fn)
    const p = this.parents[0]
    this.view.eachKey((k) => fn(k, p.rowAt(k) as T))
  }

  rowCount(): number {
    if (this.runtime.midBatch) return super.rowCount()
    return this.view.memberCount()
  }

  dispose(): void {
    super.dispose()
    this.boundsSrc.dispose()
  }

  // ── settle ──────────────────────────────────────────────────────────────────

  settle(seq: number, origin: OriginToken): CommitBatch<T> | null {
    let dataBatch: CommitBatch<T> | null = null
    let boundsBatch: CommitBatch<Bounds> | null = null
    if (this.in0 !== null) {
      if (this.inFrom0 === this.parents[0]) dataBatch = this.in0 as CommitBatch<T>
      else boundsBatch = this.in0 as CommitBatch<Bounds>
    }
    if (this.inMore !== null) {
      for (const m of this.inMore) {
        if (m.from === this.parents[0]) dataBatch = m.batch as CommitBatch<T>
        else boundsBatch = m.batch as CommitBatch<Bounds>
      }
    }
    if (dataBatch === null && boundsBatch === null) return null

    // Consolidation buffer: ≤1 row delta per key per batch. Data deltas are
    // applied first (against the OLD bounds), then the bounds walk (old →
    // new); the merge rules compose the two into one legal delta per key
    // (e.g. data moves a row out [remove] and the new bounds catch it again
    // [add] → one update carrying the pre-batch prev).
    if (dataBatch === null && boundsBatch !== null) {
      // PURE BRUSH fast path (the crossfilter hot loop): within one walk a key
      // crosses at most once (the four direction loops cover disjoint ranges),
      // so consolidation is unnecessary — deltas go straight to the batch.
      const rows: RowDelta<T>[] = []
      const push = (d: RowDelta<T>) => rows.push(d)
      for (const d of boundsBatch.rows) {
        if (d.op === 'update' || d.op === 'add') this.applyBounds(d.row as Bounds, push)
      }
      if (rows.length === 0) return null
      this.view.maybeFlip() // re-polarize once per settle, never per key
      return { seq, origin, rows, order: undefined, scalar: undefined }
    }

    // Persistent scratch (settle runs at most once per node per commit — the
    // settledSeq guard — and rows are copied out before the clear below), so
    // the pure-data path allocates no Map and no closure per commit. A delta
    // left in the scratch would replay next commit: clear on EVERY exit.
    const pending = (this.pendScratch ??= new Map<RowKey, RowDelta<T>>())
    if (dataBatch !== null) this.applyData(dataBatch.rows as readonly RowDelta<T>[], pending)
    if (boundsBatch !== null) {
      const emit = (d: RowDelta<T>) => this.pend(pending, d)
      for (const d of boundsBatch.rows) {
        if (d.op === 'update' || d.op === 'add') this.applyBounds(d.row as Bounds, emit)
      }
    }
    if (pending.size === 0) return null
    const rows =
      pending.size === 1 ? [pending.values().next().value as RowDelta<T>] : [...pending.values()]
    pending.clear()
    this.view.maybeFlip() // re-polarize once per settle, never per key
    return { seq, origin, rows, order: undefined, scalar: undefined }
  }

  // ── data-delta phase (membership semantics identical to filter) ────────────

  // undefined and null are never in range (matching the aggregate family's
  // projection normalization — and keeping membership consistent with the
  // index, which excludes non-comparable values; raw JS comparison would let
  // null coerce to 0 and slip inside bounds bracketing zero). NaN fails the
  // comparisons naturally.
  private inRange(x: unknown): boolean {
    return x != null && (x as any) >= this.lo && (x as any) <= this.hi
  }

  private markDirty(): void {
    this.sortedDirty = true
    this.loIdx = undefined
    this.hiIdx = undefined
  }

  private applyData(deltas: readonly RowDelta<T>[], pending: Map<RowKey, RowDelta<T>>): void {
    const col = this.col
    for (const d of deltas) {
      switch (d.op) {
        case 'add': {
          this.markDirty() // index contents changed
          if (this.inRange((d.row as any)?.[col])) {
            this.view.add(d.key)
            this.pend(pending, d)
          } else {
            this.view.hostAddedExcluded(d.key) // exclude mode must record the new non-member
          }
          break
        }
        case 'remove': {
          this.markDirty()
          // Pre-state via hasSansHost: the host already dropped this key
          // (writes apply before settle), so has() would deny membership.
          // prev is d.prev — between forwards rows unchanged, so the row
          // this view last knew IS the row the parent last knew.
          if (this.view.hasSansHost(d.key)) {
            this.view.hostRemoved(d.key)
            this.pend(pending, { op: 'remove', key: d.key, prev: d.prev })
          } else {
            this.view.hostRemoved(d.key) // purge a stale exclude entry
          }
          break
        }
        case 'update': {
          const oldCol = (d.prev as any)?.[col]
          const newCol = (d.row as any)?.[col]
          // The lazy-resort dirty flag (v2's amortization): only a col-value
          // change invalidates the index — attribute ticks on other fields
          // stay O(1) and never trigger a resort at the next brush.
          if (!Object.is(oldCol, newCol)) this.markDirty()
          const was = this.view.hasSansHost(d.key)
          const now = this.inRange(newCol)
          if (was && now) {
            this.pend(pending, d) // forward — prev is what this view knew (same refs)
          } else if (was && !now) {
            this.view.removeMember(d.key)
            this.pend(pending, { op: 'remove', key: d.key, prev: d.prev })
          } else if (!was && now) {
            this.view.add(d.key)
            this.pend(pending, { op: 'add', key: d.key, row: d.row })
          }
          break
        }
      }
    }
  }

  // ── the brush walk (v2 `set extent`, Map-world) ─────────────────────────────

  private applyBounds(nb: Bounds, emit: (d: RowDelta<T>) => void): void {
    // Normalized at setBounds; normalize again defensively.
    let newLo = nb[0]
    let newHi = nb[1]
    if (newHi < newLo) {
      const t = newLo
      newLo = newHi
      newHi = t
    }
    if (Object.is(newLo, this.lo) && Object.is(newHi, this.hi)) return
    if (this.sortedDirty) this.resort()
    const vals = this.sVals
    const keys = this.sKeys
    const parent = this.parents[0] // hoisted: the widen loops read it per admitted row
    this.loIdx ??= lowerBound(vals, this.lo)
    this.hiIdx ??= upperBound(vals, this.hi)

    // The four directions of bound motion. Each loop walks the index from the
    // current boundary position toward the new one — one step per row crossed,
    // bounded only by the MOVING bound, so a sweep past the opposite boundary
    // steps onto rows that were never in view: the view.has() guard suppresses
    // the phantom event (v2's C8 fix) while the position walk stays exact.
    if (newHi < this.hi) {
      // narrow high: evict rows with col > newHi, walking down from hiIdx
      while (this.hiIdx > 0 && (vals[this.hiIdx - 1] as any) > (newHi as any)) {
        this.hiIdx--
        const k = keys[this.hiIdx]
        if (this.view.hasSansHost(k)) {
          this.view.removeMember(k)
          emit({ op: 'remove', key: k, prev: parent.rowAt(k) })
        }
      }
      if (this.loIdx > this.hiIdx) this.loIdx = this.hiIdx
    }

    if (newLo > this.lo) {
      // narrow low: evict rows with col < newLo, walking up from loIdx
      while (this.loIdx < vals.length && (vals[this.loIdx] as any) < (newLo as any)) {
        const k = keys[this.loIdx]
        this.loIdx++
        if (this.view.hasSansHost(k)) {
          this.view.removeMember(k)
          emit({ op: 'remove', key: k, prev: parent.rowAt(k) })
        }
      }
      if (this.hiIdx < this.loIdx) this.hiIdx = this.loIdx
    }

    if (newHi > this.hi) {
      // widen high: admit rows with col <= newHi (inclusive boundary).
      // Admitted rows come from the PARENT, not a local mirror (M6 P1):
      // height-ordered settle guarantees parents[0] settled this commit
      // before this walk, and a same-commit remove marked sortedDirty so
      // the resort above already dropped dead keys from the index. The
      // walk's O(Δ) claim assumes parents[0].rowAt is an O(1) materialized
      // read (true for SourceNode and every in-tree op).
      while (this.hiIdx < vals.length && (vals[this.hiIdx] as any) <= (newHi as any)) {
        const k = keys[this.hiIdx]
        this.hiIdx++
        if (!this.view.hasSansHost(k)) {
          const row = parent.rowAt(k) as T
          this.view.add(k)
          emit({ op: 'add', key: k, row })
        }
      }
    }

    if (newLo < this.lo) {
      // widen low: admit rows with col >= newLo (inclusive boundary) —
      // same parent-delegation contract as the widen-high loop above.
      while (this.loIdx > 0 && (vals[this.loIdx - 1] as any) >= (newLo as any)) {
        this.loIdx--
        const k = keys[this.loIdx]
        if (!this.view.hasSansHost(k)) {
          const row = parent.rowAt(k) as T
          this.view.add(k)
          emit({ op: 'add', key: k, row })
        }
      }
    }

    this.lo = newLo
    this.hi = newHi
  }

  // Rebuild the sorted index from the PARENT's rows — called lazily by the
  // walk when the dirty flag is set. Amortizes many data mutations into one
  // O(N log N) sort that fires only when the user actually brushes. Reading
  // the parent (no local mirror, M6 P1) is settle-safe: height order means
  // parents[0] already settled this commit, so its materialized state
  // matches what the old mirror held after applyData.
  private resort(): void {
    const col = this.col
    const entries: [unknown, RowKey][] = []
    this.parents[0].each((k, row) => {
      const x = (row as any)?.[col]
      if (x === undefined || x === null || (typeof x === 'number' && x !== x)) return
      entries.push([x, k])
    })
    entries.sort((a, b) => ((a[0] as any) < (b[0] as any) ? -1 : (a[0] as any) > (b[0] as any) ? 1 : 0))
    const n = entries.length
    const vals = new Array<unknown>(n)
    const keys = new Array<RowKey>(n)
    for (let i = 0; i < n; i++) {
      vals[i] = entries[i][0]
      keys[i] = entries[i][1]
    }
    this.sVals = vals
    this.sKeys = keys
    this.sortedDirty = false
    this.loIdx = undefined
    this.hiIdx = undefined
  }

  // ── per-batch consolidation (delta.ts merge rules, local) ───────────────────

  private pend(map: Map<RowKey, RowDelta<T>>, d: RowDelta<T>): void {
    const prior = map.get(d.key)
    if (prior === undefined) {
      map.set(d.key, d)
      return
    }
    if (prior.op === 'add') {
      if (d.op === 'update') map.set(d.key, { op: 'add', key: d.key, row: d.row })
      else if (d.op === 'remove') map.delete(d.key) // annihilate
      // add+add cannot occur (view.has guards)
    } else if (prior.op === 'update') {
      if (d.op === 'update') {
        const samePath = prior.path.length === d.path.length && prior.path.every((p, i) => p === d.path[i])
        map.set(d.key, {
          op: 'update', key: d.key, row: d.row, prev: prior.prev,
          path: (samePath ? d.path : []) as Path,
        })
      } else if (d.op === 'remove') {
        map.set(d.key, { op: 'remove', key: d.key, prev: prior.prev })
      }
    } else {
      // prior remove
      if (d.op === 'add') map.set(d.key, { op: 'update', key: d.key, row: d.row, prev: prior.prev, path: [] })
      // remove+remove / remove+update cannot occur
    }
  }
}

// ── factory + registry entry ──────────────────────────────────────────────────

export function between<T>(
  src: DataNode<T>,
  col: string,
  bounds: readonly [number?, number?] = [],
): BetweenNode<T> {
  // Fail fast on non-numeric bounds ELEMENTS. v2's two-handle tuple
  // ([$(lo), $(hi)]) is the dangerous shape: the tuple itself isn't a
  // reactive arg, so pre-guard it fell through to here and every row was
  // compared against a proxy — a SILENTLY EMPTY view, no error.
  for (const el of bounds) {
    if (el == null || typeof el === 'number') continue
    const handleLike =
      typeof el === 'object' && ((el as any)[Symbol.for('data.v3.node')] !== undefined || el instanceof DataNode)
    throw new Error(
      handleLike
        ? "data: between() bounds must be plain numbers — v2's [$(lo), $(hi)] two-handle tuple is gone: drive both ends from ONE bounds child, between(col, bounds.get('range')) where range holds [lo, hi]"
        : `data: between() bounds must be numbers, got ${typeof el}`,
    )
  }
  let a = (bounds[0] ?? -Infinity) as number
  let b = (bounds[1] ?? Infinity) as number
  if (b < a) {
    const t = a
    a = b
    b = t
  }
  const boundsSrc = new SourceNode<Bounds>(src.runtime, { [BKEY]: [a, b] as Bounds }, 'between:bounds')
  return new BetweenNode<T>(src.runtime, src, boundsSrc, col, a, b)
}

defineOperator({
  name: 'between', kind: 'row', category: 'rowop', declarative: true,
  create: (src, col, bounds) => between(src, col, bounds),
  // Dedup only for static numeric bounds (reactive args key by bound-node
  // identity via the M2 reactive-arg binder; opaque/absent bounds are fresh).
  dedupKey: (col, bounds) => {
    if (typeof col !== 'string' || !Array.isArray(bounds)) return null
    const lo = bounds[0] ?? -Infinity
    const hi = bounds[1] ?? Infinity
    return typeof lo === 'number' && typeof hi === 'number' ? `between:${col}:${lo}:${hi}` : null
  },
})
