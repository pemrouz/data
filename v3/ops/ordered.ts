// v3/ops/ordered.ts — the ORDERED view family: az/za (column or comparator,
// optionally bounded), top(n), limit(n). One node class (OrderedView) + one
// rank helper (OrderIndex); every public form is a configuration of
// { cmp, window?: n }.
//
// v2 algorithmic IP carried over (operators/sort/index.ts):
// - the full-order + windowed-materialization split (ZAValue's `sorted` vs
//   `view.value`): the index ranks EVERY live parent row, so a window
//   rotation refills from the next-ranked key in O(log N + window) — never a
//   rescan of the source
// - bisect insertion (bisect_left / bisect_right → OrderIndex.bisect over a
//   STRICT total order; ties are broken by a per-key insertion seq, so the
//   left/right distinction collapses into one exact lower_bound)
// - the batch-sound reindex discipline (v2 _batchUpdate): remove every
//   touched key from the index FIRST, then re-bisect each against the
//   monotonic remainder. Bisecting pair-by-pair reads other batch keys at
//   their stale ranks while their rows already hold new values — the
//   non-monotonic-array silent mis-order v2 hit with patch() batches.
// - the once-per-batch window reconcile (v2 _window/_batchRemove/
//   _batchInsert): old-window keyset vs new-window keyset, diffed ONCE. A
//   full-window rotation is remove(evicted) + add(entrant) + coherent order
//   deltas — never a per-row mid-window churn cascade (v2's O(Δ)
//   insert-then-re-evict problem on a brushed boundary).
// - NaN/undefined/null sort keys order LAST, deterministically, in BOTH
//   directions (v2 lesson: an inconsistent comparator scrambles Array.sort
//   for the WHOLE array, not just the bad rows).
//
// v2's known patchable flaw — the O(N) `sorted.indexOf(key)` rank lookup —
// is fixed here WITHOUT an eager rank map: the keys array is sorted under a
// STRICT total order, so a key's rank is one comparator bisect away
// (O(log N)). The first cut of this module kept a key → rank Map "repaired
// from the splice point" after every splice — an O(N) Map-write loop PER
// DELTA that went quadratic the moment an ordered view sat downstream of a
// churning source (the crossfilter-v3 example: za('date', 80) over a 231k-row
// intersect made one brush step cost seconds). Index maintenance is now
// per-settle hybrid: small batches splice per key (O(Δ·(log N + memmove)));
// batches touching > 32 keys reconcile in ONE set-filter + sorted-merge pass
// (O(N + Δ log Δ)) — the same batch discipline the window reconcile below
// already followed.
//
// Documented determinism rules:
// - Ties break by key insertion order into THIS view (initial snapshot
//   iteration order, then arrival order of adds). A re-ranked update keeps
//   its original tie seq (stable under value churn).
// - Rows whose sort projection is undefined, null, or NaN sort LAST, in both
//   az and za (they are still members of the view — v3 has no sparse holes).
// - limit(n) = the first n keys in view-arrival order (for a plain object
//   source: source key-insertion order). A key removed and re-added arrives
//   anew, i.e. moves to the end — the same history-dependence v2 documented.

import type {
  CommitBatch, OrderDelta, OriginToken, RowDelta, RowKey,
} from '../contract/delta.ts'
import { DataNode } from '../kernel/node.ts'
import type { Runtime } from '../kernel/runtime.ts'
import { defineOperator } from './registry.ts'

export type RowComparator<T> = (a: T, b: T) => number

// ── OrderIndex ───────────────────────────────────────────────────────────────
// A rank → key array maintained under a STRICT total order (the comparator
// must never return 0 for two distinct keys — OrderedView guarantees this
// with the tie seq). No eager key → rank map: strictness makes lower_bound
// land EXACTLY on a present key, so rank lookup is a bisect (O(log N)) and a
// splice never triggers a rank-repair loop. Batch churn goes through
// reconcile() — one set-filter + sorted-merge pass, never per-key splices.
//
// Comparator contract for lookups: bisecting a PRESENT key compares it
// against members using the SAME row values it was ranked under — callers
// must remove a key from the index BEFORE updating what its comparator sees
// (OrderedView's settle defers row-cache writes accordingly).

export class OrderIndex {
  declare keys: RowKey[]
  declare cmp: (a: RowKey, b: RowKey) => number

  constructor(cmp: (a: RowKey, b: RowKey) => number) {
    this.keys = []
    this.cmp = cmp
  }

  get size(): number {
    return this.keys.length
  }

  build(keys: readonly RowKey[]): void {
    this.keys = keys.slice().sort(this.cmp)
  }

  // lower_bound: for an absent key, its unique legal insertion position; for
  // a present key, its exact position (strict total order).
  bisect(key: RowKey): number {
    let lo = 0
    let hi = this.keys.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.cmp(this.keys[mid], key) < 0) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  insert(key: RowKey): number {
    const at = this.bisect(key)
    this.keys.splice(at, 0, key)
    return at
  }

  remove(key: RowKey): number {
    const at = this.rankOf(key)
    if (at >= 0) this.keys.splice(at, 1)
    return at
  }

  rankOf(key: RowKey): number {
    const at = this.bisect(key)
    return at < this.keys.length && this.keys[at] === key ? at : -1
  }

  // Batch reconcile — ONE pass over the index: drop every key in `removed`
  // (no comparisons — membership only), then merge the sorted `inserts`.
  // O(N + Δ log Δ), independent of how the removals are distributed. NOTE:
  // sorts `inserts` in place; every insert's row must already be current.
  reconcile(removed: ReadonlySet<RowKey> | null, inserts: RowKey[]): void {
    let base = this.keys
    if (removed !== null && removed.size > 0) {
      const kept: RowKey[] = []
      for (const k of base) if (!removed.has(k)) kept.push(k)
      base = kept
    }
    if (inserts.length > 0) {
      if (inserts.length > 1) inserts.sort(this.cmp)
      const merged: RowKey[] = new Array(base.length + inserts.length)
      let i = 0
      let j = 0
      let o = 0
      while (i < base.length && j < inserts.length)
        merged[o++] = this.cmp(base[i], inserts[j]) < 0 ? base[i++] : inserts[j++]
      while (i < base.length) merged[o++] = base[i++]
      while (j < inserts.length) merged[o++] = inserts[j++]
      base = merged
    }
    this.keys = base
  }
}

// ── OrderedView ──────────────────────────────────────────────────────────────

export class OrderedView<T> extends DataNode<T> {
  declare userCmp: RowComparator<T>
  declare n: number // window size; Infinity = unbounded
  declare rows: Map<RowKey, T> // ALL live parent rows (current references)
  declare tie: Map<RowKey, number> // key → insertion seq (stable tiebreak)
  declare tieSeq: number
  declare index: OrderIndex // full order over ALL parent rows
  declare window: RowKey[] // materialized: first min(n, size) ranked keys
  declare winSet: Set<RowKey> // membership of MY view (the window)

  constructor(runtime: Runtime, parent: DataNode<T>, name: string, cmp: RowComparator<T>, n?: number) {
    super(runtime, 'operator', name, [parent])
    this.userCmp = cmp
    this.n = n === undefined ? Infinity : n
    this.rows = new Map()
    this.tie = new Map()
    this.tieSeq = 0
    for (const [k, row] of parent.snapshot()) {
      this.rows.set(k, row)
      this.tie.set(k, this.tieSeq++)
    }
    this.index = new OrderIndex((a, b) => {
      const c = this.userCmp(this.rows.get(a) as T, this.rows.get(b) as T)
      return c !== 0 ? c : (this.tie.get(a) as number) - (this.tie.get(b) as number)
    })
    this.index.build([...this.rows.keys()])
    this.window = this.index.keys.slice(0, this.winLen(this.index.keys.length))
    this.winSet = new Set(this.window)
  }

  private winLen(size: number): number {
    return this.n === Infinity ? size : this.n < size ? (this.n < 0 ? 0 : this.n) : size
  }

  currentOrder(): readonly RowKey[] {
    if (this.runtime.midBatch) return this.pureOrder().keys
    return this.window
  }

  snapshot(): Map<RowKey, T> {
    if (this.runtime.midBatch) {
      const { keys, rows } = this.pureOrder()
      const m = new Map<RowKey, T>()
      for (const k of keys) m.set(k, rows.get(k) as T)
      return m
    }
    const m = new Map<RowKey, T>()
    for (const k of this.window) m.set(k, this.rows.get(k) as T)
    return m
  }

  hasRow(key: RowKey): boolean {
    if (this.runtime.midBatch) return super.hasRow(key)
    return this.winSet.has(key)
  }

  rowAt(key: RowKey): T | undefined {
    if (this.runtime.midBatch) return super.rowAt(key)
    return this.winSet.has(key) ? this.rows.get(key) : undefined
  }

  // Pure recompute from the parent (flush-on-read, SCHEDULE clause 2b): sort
  // the parent's mid-batch snapshot with the same comparator. Keys this view
  // already knows keep their tie seq; unseen keys tie in snapshot order after
  // every known key (matching what settle will assign).
  private pureOrder(): { keys: RowKey[]; rows: Map<RowKey, T> } {
    const snap = this.parents[0].snapshot() as Map<RowKey, T>
    const tmpTie = new Map<RowKey, number>()
    let next = this.tieSeq
    for (const k of snap.keys()) {
      const t = this.tie.get(k)
      tmpTie.set(k, t === undefined ? next++ : t)
    }
    const keys = [...snap.keys()].sort((a, b) => {
      const c = this.userCmp(snap.get(a) as T, snap.get(b) as T)
      return c !== 0 ? c : (tmpTie.get(a) as number) - (tmpTie.get(b) as number)
    })
    return { keys: keys.slice(0, this.winLen(keys.length)), rows: snap }
  }

  settle(seq: number, origin: OriginToken): CommitBatch<T> | null {
    const input = this.in0
    if (input === null) return null
    const preWindow = this.window
    const preSet = this.winSet
    const dmap = new Map<RowKey, RowDelta<T>>()
    const toInsert: RowKey[] = []
    const removedIdx: RowKey[] = [] // keys leaving the index (removes + re-ranks)
    const pendingRow = new Map<RowKey, T>() // re-ranked updates: applied after index removal
    const pendingDel: RowKey[] = [] // removes: cache deletion deferred past index ops

    // Phase A — classify. Row-cache writes a lookup bisect could observe are
    // DEFERRED: a key's removal bisect must see the row it was ranked under
    // (the bisect-rank contract), and every other indexed key's row must be
    // unchanged-under-cmp (v2 _batchUpdate discipline, made structural).
    for (const d of input.rows as readonly RowDelta<T>[]) {
      dmap.set(d.key, d)
      switch (d.op) {
        case 'add':
          this.rows.set(d.key, d.row) // not yet indexed — no bisect can see it
          this.tie.set(d.key, this.tieSeq++)
          toInsert.push(d.key)
          break
        case 'remove':
          removedIdx.push(d.key)
          pendingDel.push(d.key)
          break
        case 'update': {
          if (!this.rows.has(d.key)) {
            // Defensive: an update for a key we never indexed — treat as an
            // entrance (should be unreachable off a legal parent stream).
            this.rows.set(d.key, d.row)
            this.tie.set(d.key, this.tieSeq++)
            toInsert.push(d.key)
            break
          }
          // Reindex only when the comparator can see the change; a rank can't
          // move otherwise (the tie seq — preserved here — is stable).
          if (this.userCmp(this.rows.get(d.key) as T, d.row) !== 0) {
            removedIdx.push(d.key)
            pendingRow.set(d.key, d.row)
            toInsert.push(d.key)
          } else {
            this.rows.set(d.key, d.row) // cmp-blind: position unaffected
          }
          break
        }
      }
    }

    // Phase B — index maintenance, hybrid by batch size. Small batches splice
    // per key; larger ones reconcile in ONE set-filter + sorted-merge pass
    // (the crossfilter brush shape: thousands of membership flips per commit
    // must never pay per-key O(N) splices). The per-key path removes BEFORE
    // applying pending rows (each removal bisect sees the ranked-under row);
    // the batch path filters by membership (no comparisons), so row currency
    // only matters for the merge — where inserts carry their new rows.
    if (removedIdx.length + toInsert.length > 32) {
      for (const [k, row] of pendingRow) this.rows.set(k, row)
      this.index.reconcile(removedIdx.length > 0 ? new Set(removedIdx) : null, toInsert)
    } else {
      for (const k of removedIdx) this.index.remove(k)
      for (const [k, row] of pendingRow) this.rows.set(k, row)
      for (const k of toInsert) this.index.insert(k)
    }
    for (const k of pendingDel) {
      this.rows.delete(k)
      this.tie.delete(k)
    }

    // The once-per-batch window reconcile (v2 _window, generalized): diff the
    // old window keyset against the new one. Evictions are honest removes
    // (prev = the row as THIS view last had it), entrances are honest adds.
    const newWindow = this.index.keys.slice(0, this.winLen(this.index.keys.length))
    const newSet = new Set(newWindow)

    const out: RowDelta<T>[] = []
    for (const k of preWindow) {
      if (newSet.has(k)) continue
      const d = dmap.get(k)
      // prev as my view knew it: for a touched key the delta's prev IS the
      // pre-batch row (consolidation guarantees it); an untouched rotation
      // evictee still sits unchanged in the row cache.
      const prev = d !== undefined && d.op !== 'add' ? d.prev : (this.rows.get(k) as T)
      out.push({ op: 'remove', key: k, prev })
    }
    for (const k of newWindow) {
      if (!preSet.has(k)) {
        out.push({ op: 'add', key: k, row: this.rows.get(k) as T })
      } else {
        const d = dmap.get(k)
        if (d !== undefined && d.op === 'update') out.push(d) // forward, same prev/path
      }
    }

    // Order script pre → post, legal at application time: removes at
    // DESCENDING pre-batch indices, then orderMove per surviving key whose
    // relative rank rotated, then inserts at ASCENDING final indices.
    const orderOut: OrderDelta[] = []
    for (let i = preWindow.length - 1; i >= 0; i--) {
      if (!newSet.has(preWindow[i])) orderOut.push({ op: 'orderRemove', key: preWindow[i], index: i })
    }
    const cur: RowKey[] = []
    for (const k of preWindow) if (newSet.has(k)) cur.push(k)
    const newSurv: RowKey[] = []
    for (const k of newWindow) if (preSet.has(k)) newSurv.push(k)
    for (let i = 0; i < newSurv.length; i++) {
      if (cur[i] === newSurv[i]) continue
      const j = cur.indexOf(newSurv[i], i)
      orderOut.push({ op: 'orderMove', key: newSurv[i], index: i, from: j })
      cur.splice(j, 1)
      cur.splice(i, 0, newSurv[i])
    }
    for (let i = 0; i < newWindow.length; i++) {
      if (!preSet.has(newWindow[i])) orderOut.push({ op: 'orderInsert', key: newWindow[i], index: i })
    }

    this.window = newWindow
    this.winSet = newSet

    if (out.length === 0 && orderOut.length === 0) return null
    return { seq, origin, rows: out, order: orderOut.length > 0 ? orderOut : undefined, scalar: undefined }
  }
}

// ── comparators ──────────────────────────────────────────────────────────────

// undefined, null, and NaN sort LAST in both directions (deterministic; ties
// among them fall through to the insertion-seq tiebreak).
function isBad(x: unknown): boolean {
  return x === undefined || x === null || x !== x
}

export function cmpBy<T>(proj: (row: T) => unknown, dir: 1 | -1): RowComparator<T> {
  return (a, b) => {
    const va = proj(a) as any
    const vb = proj(b) as any
    const ba = isBad(va)
    const bb = isBad(vb)
    if (ba || bb) return ba === bb ? 0 : ba ? 1 : -1
    return va < vb ? -dir : va > vb ? dir : 0
  }
}

const colProj = (col: string) => (row: any) => row?.[col]

// ── factories ────────────────────────────────────────────────────────────────

export function az<T>(src: DataNode<T>, by: string | RowComparator<T>, n?: number): OrderedView<T> {
  const cmp = typeof by === 'string' ? cmpBy<T>(colProj(by), 1) : by
  return new OrderedView(src.runtime, src, 'az', cmp, n)
}

export function za<T>(src: DataNode<T>, by: string | RowComparator<T>, n?: number): OrderedView<T> {
  const cmp: RowComparator<T> =
    typeof by === 'string' ? cmpBy<T>(colProj(by), -1) : (a, b) => by(b, a)
  return new OrderedView(src.runtime, src, 'za', cmp, n)
}

// top(n): descending over the row value itself (numeric rows), bounded n.
export function top<T>(src: DataNode<T>, n: number): OrderedView<T> {
  return new OrderedView(src.runtime, src, 'top', cmpBy<T>((r) => r, -1), n)
}

// limit(n): NO comparator — the window over view-arrival (source
// key-insertion) order. The all-ties comparator delegates entirely to the
// stable insertion-seq tiebreak.
export function limit<T>(src: DataNode<T>, n: number): OrderedView<T> {
  return new OrderedView(src.runtime, src, 'limit', () => 0, n)
}

// ── registry ─────────────────────────────────────────────────────────────────

const windowKey = (name: string, by: unknown, n: unknown): string | null =>
  typeof by === 'string' && (n === undefined || typeof n === 'number')
    ? `${name}:${by}:${n === undefined ? '' : n}`
    : null // comparator closures never dedup

defineOperator({
  name: 'az', kind: 'ordered', category: 'holistic', declarative: true,
  create: (src, by, n) => az(src, by, n),
  dedupKey: (by, n) => windowKey('az', by, n),
})
defineOperator({
  name: 'za', kind: 'ordered', category: 'holistic', declarative: true,
  create: (src, by, n) => za(src, by, n),
  dedupKey: (by, n) => windowKey('za', by, n),
})
defineOperator({
  name: 'top', kind: 'ordered', category: 'holistic', declarative: true,
  create: (src, n) => top(src, n),
  dedupKey: (n) => (typeof n === 'number' ? `top:${n}` : null),
})
defineOperator({
  name: 'limit', kind: 'ordered', category: 'holistic', declarative: true,
  create: (src, n) => limit(src, n),
  dedupKey: (n) => (typeof n === 'number' ? `limit:${n}` : null),
})
