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
// is fixed here: OrderIndex keeps a key → rank Map alongside the rank → key
// array, repaired from the splice point after every splice.
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
// rank → key array + key → rank map, maintained under a STRICT total order
// (the comparator must never return 0 for two distinct keys — OrderedView
// guarantees this with the tie seq). After any splice, ranks are repaired
// from the splice point; lookups are O(1), insertion is O(log N) to find +
// O(N - pos) to splice/repair.

export class OrderIndex {
  declare keys: RowKey[]
  declare rank: Map<RowKey, number>
  declare cmp: (a: RowKey, b: RowKey) => number

  constructor(cmp: (a: RowKey, b: RowKey) => number) {
    this.keys = []
    this.rank = new Map()
    this.cmp = cmp
  }

  get size(): number {
    return this.keys.length
  }

  build(keys: readonly RowKey[]): void {
    this.keys = keys.slice().sort(this.cmp)
    this.rank.clear()
    for (let i = 0; i < this.keys.length; i++) this.rank.set(this.keys[i], i)
  }

  // lower_bound: the unique legal position for `key` under the strict total
  // order. `key` must NOT currently be in the index (remove first — the v2
  // splice-out-before-bisect rule, made structural).
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
    for (let i = at; i < this.keys.length; i++) this.rank.set(this.keys[i], i)
    return at
  }

  remove(key: RowKey): number {
    const at = this.rank.get(key)
    if (at === undefined) return -1
    this.keys.splice(at, 1)
    this.rank.delete(key)
    for (let i = at; i < this.keys.length; i++) this.rank.set(this.keys[i], i)
    return at
  }

  rankOf(key: RowKey): number {
    const r = this.rank.get(key)
    return r === undefined ? -1 : r
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

    // Phase A — apply row-cache mutations and REMOVE every touched key from
    // the index. No bisect happens in this phase, so partially-updated rows
    // can't feed a bisect a non-monotonic array (v2 _batchUpdate discipline).
    for (const d of input.rows as readonly RowDelta<T>[]) {
      dmap.set(d.key, d)
      switch (d.op) {
        case 'add':
          this.rows.set(d.key, d.row)
          this.tie.set(d.key, this.tieSeq++)
          toInsert.push(d.key)
          break
        case 'remove':
          this.index.remove(d.key)
          this.rows.delete(d.key)
          this.tie.delete(d.key)
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
          const old = this.rows.get(d.key) as T
          this.rows.set(d.key, d.row)
          // Reindex only when the comparator can see the change; a rank can't
          // move otherwise (the tie seq — preserved here — is stable).
          if (this.userCmp(old, d.row) !== 0) {
            this.index.remove(d.key)
            toInsert.push(d.key)
          }
          break
        }
      }
    }
    // Phase B — every bisect runs against a monotonic remainder + already-
    // re-inserted current rows.
    for (const k of toInsert) this.index.insert(k)

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
