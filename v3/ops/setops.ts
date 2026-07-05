// v3/ops/setops.ts — set algebra over the KEY domain: intersect / union /
// except. Multi-parent nodes (primary = first parent).
//
// Liveness and exposure are DIRECT PARENT QUERIES per touched key (the
// hasRow/rowAt protocol on DataNode — O(1) on every in-tree node once the
// parent has settled, which height order guarantees whenever this node
// settles). The first cut instead ported v2's per-row membership BITMASK
// (operators/intersect/index.ts) plus a full per-parent row MIRROR for value
// resolution — on the crossfilter graph (5 set-op nodes over 4–5 parents
// each at 231k rows) those mirrors were ~21 Maps of 231k entries: the
// dominant retained memory in the whole app, and two Map writes per parent-
// batch row to maintain. Querying the parents keeps the same O(touched)
// settle complexity with ZERO retained per-parent state. What is
// deliberately NOT ported from v2 is everything that compensated for its
// positional value domain — the echo-ordering split (primary splices last),
// pendingShift, BH1/BF0 holes, sparse explicit-undefined arrays, the
// C12–C16 machinery. In v3 membership is BY KEY, a membership flip is an
// honest add/remove, and ordering is a separate channel this node never
// emits (set ops are unordered).
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
  declare othersMask: number // except only: OR of the *others* args' bits (bit i = parents[i])
  declare sharedProvenance: boolean // parents share ≥1 root source

  constructor(runtime: Runtime, variant: SetVariant, primary: DataNode<T>, others: readonly DataNode<T>[]) {
    // Dedup parents by identity, primary first (the v2 a.intersect(a) fix).
    // For except the ORIGINAL others list still contributes to othersMask, so
    // except(a, a) maps the primary bit into othersMask → honestly empty.
    const unique: DataNode<T>[] = [primary]
    for (const o of others) if (unique.indexOf(o) < 0) unique.push(o)
    super(runtime, 'operator', variant, unique)
    this.variant = variant
    this.othersMask = 0
    for (const o of others) this.othersMask |= 1 << unique.indexOf(o)

    let common = [...rootsOf(unique[0])]
    for (let i = 1; i < unique.length && common.length > 0; i++) {
      const ri = rootsOf(unique[i])
      common = common.filter((r) => ri.has(r))
    }
    this.sharedProvenance = common.length > 0

    // Seed the view by DIRECT PARENT QUERIES (no retained mirrors): liveness
    // for intersect/except is a subset of the primary's keyspace; union walks
    // every parent's keys once.
    this.view = new Map()
    if (variant === 'union') {
      const seen = new Set<RowKey>()
      for (const p of unique) {
        for (const k of p.snapshot().keys()) {
          if (seen.has(k)) continue
          seen.add(k)
          if (this.live(k)) this.view.set(k, this.exposed(k) as T)
        }
      }
    } else {
      for (const k of unique[0].snapshot().keys()) {
        if (this.live(k)) this.view.set(k, this.exposed(k) as T)
      }
    }
  }

  // Liveness by direct parent membership queries (hasRow is O(1) on every
  // in-tree node once the parent has settled — height order guarantees that
  // whenever WE settle). Cross-domain numeric keys (independent array-born
  // stores) never co-match: minted-int equality across unrelated stores is
  // positional coincidence, not identity — see the key-domain header note.
  private live(key: RowKey): boolean {
    const parents = this.parents as readonly DataNode<T>[]
    const numericForeign =
      typeof key === 'number' && !this.sharedProvenance && parents.length > 1
    switch (this.variant) {
      case 'intersect': {
        if (numericForeign) return false
        for (let i = 0; i < parents.length; i++) if (!parents[i].hasRow(key)) return false
        return true
      }
      case 'union': {
        for (let i = 0; i < parents.length; i++) if (parents[i].hasRow(key)) return true
        return false
      }
      case 'except': {
        if (!parents[0].hasRow(key)) return false // not in primary
        if (numericForeign) return true // unrelated others cannot exclude
        for (let i = 0; i < parents.length; i++)
          if ((this.othersMask & (1 << i)) !== 0 && parents[i].hasRow(key)) return false
        return true
      }
    }
  }

  // The exposed row for a live key. intersect/except: the primary's row.
  // union: first parent (in parent order) HOLDING the key — primary wins
  // (hasRow, not a rowAt !== undefined check: undefined rows are first-class).
  private exposed(key: RowKey): T | undefined {
    const parents = this.parents as readonly DataNode<T>[]
    if (this.variant === 'union') {
      for (let i = 0; i < parents.length; i++)
        if (parents[i].hasRow(key)) return parents[i].rowAt(key)
      return undefined
    }
    return parents[0].rowAt(key)
  }

  snapshot(): Map<RowKey, T> {
    if (this.runtime.midBatch) return this.recomputePure()
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

  // Flush-on-read: recompute PURE from parents (whose snapshots are
  // themselves mid-batch-consistent), touching none of this node's state.
  private recomputePure(): Map<RowKey, T> {
    const snaps: Map<RowKey, T>[] = []
    for (const p of this.parents) snaps.push(p.snapshot() as Map<RowKey, T>)
    const fullMask = (1 << snaps.length) - 1
    const masks = new Map<RowKey, number>()
    for (let i = 0; i < snaps.length; i++)
      for (const k of snaps[i].keys()) masks.set(k, (masks.get(k) ?? 0) | (1 << i))
    const out = new Map<RowKey, T>()
    for (const [k, m] of masks) {
      const numericForeign =
        typeof k === 'number' && !this.sharedProvenance && snaps.length > 1
      let liveNow: boolean
      switch (this.variant) {
        case 'intersect':
          liveNow = numericForeign ? false : m === fullMask
          break
        case 'union':
          liveNow = m !== 0
          break
        case 'except':
          liveNow = (m & 1) !== 0 && (numericForeign || (m & this.othersMask) === 0)
          break
      }
      if (!liveNow) continue
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

    // Phase 1: collect the touched keys across every parent batch — no state
    // folding: liveness/exposure in phase 2 query the (already-settled)
    // parents directly. `touched` also carries the update-path candidate: the
    // path if every delta seen for the key this commit was an update with
    // the SAME path (two derived parents echoing one source write), else
    // null (→ whole-row path []).
    const touched = new Map<RowKey, Path | null>()
    this.fold(this.in0 as CommitBatch<T>, touched)
    if (this.inMore !== null)
      for (const { batch } of this.inMore) this.fold(batch as CommitBatch<T>, touched)

    // Phase 2: one pass over touched keys against the view. Pre-state is
    // read from the view before mutation, so consolidation + prev-discipline
    // + add/remove legality hold by construction.
    const out: RowDelta<T>[] = []
    for (const [k, cand] of touched) {
      const preLive = this.view.has(k)
      const preRow = this.view.get(k) as T
      const postLive = this.live(k)
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

  private fold(batch: CommitBatch<T>, touched: Map<RowKey, Path | null>): void {
    for (const d of batch.rows) {
      if (!touched.has(d.key)) {
        touched.set(d.key, d.op === 'update' ? d.path : null)
      } else {
        const prior = touched.get(d.key)
        if (!(d.op === 'update' && prior !== null && pathEq(prior as Path, d.path)))
          touched.set(d.key, null)
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
