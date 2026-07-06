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
  declare rows: Map<RowKey, T> // full mirror of the parent (walk reads rows from here)
  declare view: Map<RowKey, T> // the in-range subset — this node's materialized state
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
    this.rows = parent.snapshot()
    this.view = new Map()
    for (const [k, row] of this.rows) {
      const x = (row as any)?.[col]
      if (x != null && x >= lo && x <= hi) this.view.set(k, row)
    }
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
    return new Map(this.view)
  }

  hasRow(key: RowKey): boolean {
    if (this.runtime.midBatch) return super.hasRow(key)
    return this.view.has(key)
  }

  rowAt(key: RowKey): T | undefined {
    if (this.runtime.midBatch) return super.rowAt(key)
    return this.view.get(key)
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
      return { seq, origin, rows, order: undefined, scalar: undefined }
    }

    const pending = new Map<RowKey, RowDelta<T>>()
    const emit = (d: RowDelta<T>) => this.pend(pending, d)
    if (dataBatch !== null) this.applyData(dataBatch.rows as readonly RowDelta<T>[], pending)
    if (boundsBatch !== null) {
      for (const d of boundsBatch.rows) {
        if (d.op === 'update' || d.op === 'add') this.applyBounds(d.row as Bounds, emit)
      }
    }
    if (pending.size === 0) return null
    const rows = [...pending.values()]
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
          this.rows.set(d.key, d.row)
          this.markDirty() // index contents changed
          if (this.inRange((d.row as any)?.[col])) {
            this.view.set(d.key, d.row)
            this.pend(pending, d)
          }
          break
        }
        case 'remove': {
          this.rows.delete(d.key)
          this.markDirty()
          if (this.view.has(d.key)) {
            const prev = this.view.get(d.key) as T
            this.view.delete(d.key)
            this.pend(pending, { op: 'remove', key: d.key, prev })
          }
          break
        }
        case 'update': {
          this.rows.set(d.key, d.row)
          const oldCol = (d.prev as any)?.[col]
          const newCol = (d.row as any)?.[col]
          // The lazy-resort dirty flag (v2's amortization): only a col-value
          // change invalidates the index — attribute ticks on other fields
          // stay O(1) and never trigger a resort at the next brush.
          if (!Object.is(oldCol, newCol)) this.markDirty()
          const was = this.view.has(d.key)
          const now = this.inRange(newCol)
          if (was && now) {
            this.view.set(d.key, d.row)
            this.pend(pending, d) // forward — prev is what this view knew (same refs)
          } else if (was && !now) {
            this.view.delete(d.key)
            this.pend(pending, { op: 'remove', key: d.key, prev: d.prev })
          } else if (!was && now) {
            this.view.set(d.key, d.row)
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
        const prev = this.view.get(k) // single lookup; rows are objects, never undefined
        if (prev !== undefined) {
          this.view.delete(k)
          emit({ op: 'remove', key: k, prev })
        }
      }
      if (this.loIdx > this.hiIdx) this.loIdx = this.hiIdx
    }

    if (newLo > this.lo) {
      // narrow low: evict rows with col < newLo, walking up from loIdx
      while (this.loIdx < vals.length && (vals[this.loIdx] as any) < (newLo as any)) {
        const k = keys[this.loIdx]
        this.loIdx++
        const prev = this.view.get(k)
        if (prev !== undefined) {
          this.view.delete(k)
          emit({ op: 'remove', key: k, prev })
        }
      }
      if (this.hiIdx < this.loIdx) this.hiIdx = this.loIdx
    }

    if (newHi > this.hi) {
      // widen high: admit rows with col <= newHi (inclusive boundary)
      while (this.hiIdx < vals.length && (vals[this.hiIdx] as any) <= (newHi as any)) {
        const k = keys[this.hiIdx]
        this.hiIdx++
        if (!this.view.has(k)) {
          const row = this.rows.get(k) as T
          this.view.set(k, row)
          emit({ op: 'add', key: k, row })
        }
      }
    }

    if (newLo < this.lo) {
      // widen low: admit rows with col >= newLo (inclusive boundary)
      while (this.loIdx > 0 && (vals[this.loIdx - 1] as any) >= (newLo as any)) {
        this.loIdx--
        const k = keys[this.loIdx]
        if (!this.view.has(k)) {
          const row = this.rows.get(k) as T
          this.view.set(k, row)
          emit({ op: 'add', key: k, row })
        }
      }
    }

    this.lo = newLo
    this.hi = newHi
  }

  // Rebuild the sorted index from the row mirror — called lazily by the walk
  // when the dirty flag is set. Amortizes many data mutations into one
  // O(N log N) sort that fires only when the user actually brushes.
  private resort(): void {
    const col = this.col
    const entries: [unknown, RowKey][] = []
    for (const [k, row] of this.rows) {
      const x = (row as any)?.[col]
      if (x === undefined || x === null || (typeof x === 'number' && x !== x)) continue
      entries.push([x, k])
    }
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
