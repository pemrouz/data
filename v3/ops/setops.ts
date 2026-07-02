// v3/ops/setops.ts — set algebra over the KEY domain: intersect / union /
// except. Multi-parent nodes (primary = first parent).
//
// The v2 IP ported here is the per-row membership BITMASK from
// operators/intersect/index.ts: each parent owns one bit; a key's mask says
// which parents currently hold it, so the liveness check is O(1) per key
// regardless of how many sources participate (the 4–8-dimension crossfilter
// case). What is deliberately NOT ported is everything that compensated for
// v2's positional value domain — the echo-ordering split (primary splices
// last), pendingShift, BH1/BF0 holes, sparse explicit-undefined arrays, the
// C12–C16 machinery. In v3 membership is BY KEY (`Map.has`), a membership
// flip is an honest add/remove, and ordering is a separate channel this node
// never emits (set ops are unordered).
//
// Liveness per variant (mask bit i = key live in parents[i]):
//   intersect — mask === fullMask (every parent has the key)
//   union     — mask !== 0       (any parent has the key)
//   except    — in-primary AND not-in-any-other (mask & bit0, no others bit)
//
// Value exposure:
//   intersect/except — the PRIMARY parent's row (canonical row identity,
//     v2's "`this.p.value[name]` stays the canonical row identity"). A
//     secondary update that doesn't change membership emits NOTHING.
//   union — the row from the FIRST parent (in parent order) that holds the
//     key: PRIMARY WINS conflicts; when the primary loses the key the
//     exposure falls through to the next holder and an update is emitted
//     with the view's prev.
//
// KEY-DOMAIN SEMANTICS (the honest v3 answer to v2's C14): sources must
// share a key domain — object-keyed sources (adopted string keys are a
// shared domain by construction) or views derived from one source (minted
// keys flow through derivations unchanged). Two INDEPENDENT array-born
// sources each mint their own numeric keys; those keyspaces are unrelated
// even where the integers collide (both stores mint 0,1,2…), so this node
// refuses to treat cross-domain numeric equality as membership:
//   - intersect over provenance-disjoint parents is EMPTY for numeric keys
//     (v2 silently intersected by position — the wrong answer; empty is the
//     honest one),
//   - except ignores exclusion bits from provenance-disjoint others for
//     numeric keys (an unrelated store's key 3 cannot exclude yours),
//   - union keeps any-bit liveness but a numeric collision exposes the
//     primary's row and shadows the other's — documented hazard; the
//     explicit `on:` key-selector is future work.
// Provenance = the set of root (parentless) nodes reachable upward; parents
// share provenance iff the intersection of their root sets is non-empty.
// String (adopted) keys are always comparable across parents.
//
// Duplicate/self parents are deduped by identity at construction (ports the
// v2 fix where `a.intersect(a)` / `a.intersect(b, b)` keyed the sources map
// by view but OR'd `all` per argument, leaving the view permanently empty).
// After dedup: intersect(a, a) ≡ a; except(a, a) is honestly empty (the
// primary's bit is also an others bit, so no key can qualify).
//
// Emission (SCHEDULE.md clause 8): settle() folds ALL parent batches for the
// commit into per-parent row maps + masks first, then walks the touched-key
// set ONCE against the view — pre-state per key is read from the view before
// it is mutated, so the output is consolidated (≤1 delta/key), adds only for
// keys not live in THIS view, removes/updates carry the view's own prev, and
// Object.is equality on the exposed row suppresses phantom updates. A
// forwarded update keeps its path when exactly one path was seen for the key
// this commit and the leaf genuinely changed; otherwise path = [] (whole-row).

import type { CommitBatch, OriginToken, Path, RowDelta, RowKey } from '../contract/delta.ts'
import { DataNode, leafAt } from '../kernel/node.ts'
import type { Runtime } from '../kernel/runtime.ts'
import { defineOperator } from './registry.ts'

type SetVariant = 'intersect' | 'union' | 'except'

// The set of root (parentless) nodes reachable from n — key-domain provenance.
function rootsOf(n: DataNode<any>, out: Set<DataNode<any>> = new Set()): Set<DataNode<any>> {
  if (n.parents.length === 0) out.add(n)
  else for (const p of n.parents) rootsOf(p, out)
  return out
}

function pathEq(a: Path, b: Path): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export class SetOpNode<T> extends DataNode<T> {
  declare variant: SetVariant
  declare view: Map<RowKey, T> // materialized output, updated at settle
  declare masks: Map<RowKey, number> // bit i = key live in this.parents[i]
  declare prows: Map<RowKey, T>[] // per-parent live rows (value resolution)
  declare parentIndex: Map<DataNode<any>, number>
  declare fullMask: number // all parents' bits set
  declare othersMask: number // except only: OR of the *others* args' bits
  declare sharedProvenance: boolean // parents share ≥1 root source

  constructor(runtime: Runtime, variant: SetVariant, primary: DataNode<T>, others: readonly DataNode<T>[]) {
    // Dedup parents by identity, primary first (the v2 a.intersect(a) fix).
    // For except the ORIGINAL others list still contributes to othersMask, so
    // except(a, a) maps the primary bit into othersMask → honestly empty.
    const unique: DataNode<T>[] = [primary]
    for (const o of others) if (unique.indexOf(o) < 0) unique.push(o)
    super(runtime, 'operator', variant, unique)
    this.variant = variant
    this.parentIndex = new Map()
    for (let i = 0; i < unique.length; i++) this.parentIndex.set(unique[i], i)
    this.fullMask = (1 << unique.length) - 1
    this.othersMask = 0
    for (const o of others) this.othersMask |= 1 << (this.parentIndex.get(o) as number)

    let common = [...rootsOf(unique[0])]
    for (let i = 1; i < unique.length && common.length > 0; i++) {
      const ri = rootsOf(unique[i])
      common = common.filter((r) => ri.has(r))
    }
    this.sharedProvenance = common.length > 0

    this.prows = []
    for (const p of unique) this.prows.push(p.snapshot())
    this.masks = new Map()
    for (let i = 0; i < this.prows.length; i++)
      for (const k of this.prows[i].keys()) this.masks.set(k, (this.masks.get(k) ?? 0) | (1 << i))
    this.view = new Map()
    for (const [k, m] of this.masks) if (this.isLive(k, m)) this.view.set(k, this.exposed(k) as T)
  }

  private isLive(key: RowKey, mask: number): boolean {
    // Cross-domain numeric keys (independent array-born stores) never
    // co-match: minted-int equality across unrelated stores is positional
    // coincidence, not identity. See the key-domain note in the header.
    const numericForeign =
      typeof key === 'number' && !this.sharedProvenance && this.parents.length > 1
    switch (this.variant) {
      case 'intersect':
        return numericForeign ? false : mask === this.fullMask
      case 'union':
        return mask !== 0
      case 'except': {
        if ((mask & 1) === 0) return false // not in primary (bit 0)
        if (numericForeign) return true // unrelated others cannot exclude
        return (mask & this.othersMask) === 0
      }
    }
  }

  // The exposed row for a live key. intersect/except: the primary's row.
  // union: first parent (in parent order) holding the key — primary wins.
  private exposed(key: RowKey): T | undefined {
    if (this.variant === 'union') {
      const prows = this.prows
      for (let i = 0; i < prows.length; i++) if (prows[i].has(key)) return prows[i].get(key)
      return undefined
    }
    return this.prows[0].get(key)
  }

  snapshot(): Map<RowKey, T> {
    if (this.runtime.midBatch) return this.recomputePure()
    return new Map(this.view)
  }

  // Flush-on-read: recompute PURE from parents (whose snapshots are
  // themselves mid-batch-consistent), touching none of this node's state.
  private recomputePure(): Map<RowKey, T> {
    const snaps: Map<RowKey, T>[] = []
    for (const p of this.parents) snaps.push(p.snapshot() as Map<RowKey, T>)
    const masks = new Map<RowKey, number>()
    for (let i = 0; i < snaps.length; i++)
      for (const k of snaps[i].keys()) masks.set(k, (masks.get(k) ?? 0) | (1 << i))
    const out = new Map<RowKey, T>()
    for (const [k, m] of masks) {
      if (!this.isLive(k, m)) continue
      if (this.variant === 'union') {
        for (let i = 0; i < snaps.length; i++)
          if (snaps[i].has(k)) {
            out.set(k, snaps[i].get(k) as T)
            break
          }
      } else {
        out.set(k, snaps[0].get(k) as T)
      }
    }
    return out
  }

  settle(seq: number, origin: OriginToken): CommitBatch<T> | null {
    if (this.in0 === null) return null

    // Phase 1: fold every parent batch into prows/masks, collecting the
    // touched keys. `touched` also carries the update-path candidate: the
    // path if every delta seen for the key this commit was an update with
    // the SAME path (two derived parents echoing one source write), else
    // null (→ whole-row path []).
    const touched = new Map<RowKey, Path | null>()
    this.fold(this.inFrom0 as DataNode<any>, this.in0 as CommitBatch<T>, touched)
    if (this.inMore !== null)
      for (const { from, batch } of this.inMore) this.fold(from, batch as CommitBatch<T>, touched)

    // Phase 2: one pass over touched keys against the view. Pre-state is
    // read from the view before mutation, so consolidation + prev-discipline
    // + add/remove legality hold by construction.
    const out: RowDelta<T>[] = []
    for (const [k, cand] of touched) {
      const preLive = this.view.has(k)
      const preRow = this.view.get(k) as T
      const postLive = this.isLive(k, this.masks.get(k) ?? 0)
      if (!preLive && postLive) {
        const row = this.exposed(k) as T
        this.view.set(k, row)
        out.push({ op: 'add', key: k, row })
      } else if (preLive && !postLive) {
        this.view.delete(k)
        out.push({ op: 'remove', key: k, prev: preRow })
      } else if (preLive && postLive) {
        const row = this.exposed(k) as T
        if (Object.is(preRow, row)) continue // phantom-update suppression
        this.view.set(k, row)
        let path: Path = cand ?? []
        // Keep a forwarded path only if the leaf genuinely changed in OUR
        // exposure (a union exposure switch can change the row while the
        // candidate leaf stays equal — that must degrade to whole-row).
        if (path.length > 0 && Object.is(leafAt(preRow, path), leafAt(row, path))) path = []
        out.push({ op: 'update', key: k, row, prev: preRow, path })
      }
      // !preLive && !postLive: a change in a parent that never surfaced here.
    }
    return out.length ? { seq, origin, rows: out, order: undefined, scalar: undefined } : null
  }

  private fold(from: DataNode<any>, batch: CommitBatch<T>, touched: Map<RowKey, Path | null>): void {
    const idx = this.parentIndex.get(from)
    if (idx === undefined) return
    const bit = 1 << idx
    const rows = this.prows[idx]
    const masks = this.masks
    for (const d of batch.rows) {
      if (!touched.has(d.key)) {
        touched.set(d.key, d.op === 'update' ? d.path : null)
      } else {
        const prior = touched.get(d.key)
        if (!(d.op === 'update' && prior !== null && pathEq(prior as Path, d.path)))
          touched.set(d.key, null)
      }
      switch (d.op) {
        case 'add':
        case 'update':
          rows.set(d.key, d.row)
          masks.set(d.key, (masks.get(d.key) ?? 0) | bit)
          break
        case 'remove': {
          rows.delete(d.key)
          const m = (masks.get(d.key) ?? 0) & ~bit
          if (m === 0) masks.delete(d.key)
          else masks.set(d.key, m)
          break
        }
      }
    }
  }
}

// ── factories + registry entries ─────────────────────────────────────────────

export function intersect<T>(primary: DataNode<T>, ...others: DataNode<T>[]): SetOpNode<T> {
  return new SetOpNode(primary.runtime, 'intersect', primary, others)
}

export function union<T>(primary: DataNode<T>, ...others: DataNode<T>[]): SetOpNode<T> {
  return new SetOpNode(primary.runtime, 'union', primary, others)
}

export function except<T>(primary: DataNode<T>, ...others: DataNode<T>[]): SetOpNode<T> {
  return new SetOpNode(primary.runtime, 'except', primary, others)
}

defineOperator({
  name: 'intersect', kind: 'set', category: 'rowop', declarative: true,
  create: (src, ...others) => intersect(src, ...others),
  dedupKey: () => null, // dedup by source identity is an API-layer concern
})
defineOperator({
  name: 'union', kind: 'set', category: 'rowop', declarative: true,
  create: (src, ...others) => union(src, ...others),
  dedupKey: () => null,
})
defineOperator({
  name: 'except', kind: 'set', category: 'rowop', declarative: true,
  create: (src, ...others) => except(src, ...others),
  dedupKey: () => null,
})
