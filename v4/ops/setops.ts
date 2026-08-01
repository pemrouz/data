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
import { MembershipView } from './membership.ts'

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

// Fail-fast operand validation, run INSIDE the super() argument expression —
// i.e. BEFORE DataNode's constructor attaches this node to any parent. A bad
// operand that threw mid-attach used to POISON the runtime: the primary's
// children already held a half-constructed SetOpNode (fields uninitialized),
// so every subsequent write to ANY related source crashed at settle until
// reload. The v2 object-map form (intersect({col: extentView})) is exactly
// the operand shape that hit this, so the message is a migration hint.
function validatedOperands<T>(
  variant: SetVariant,
  primary: DataNode<T>,
  others: readonly DataNode<T>[],
): DataNode<T>[] {
  const bad = (o: unknown): string =>
    o !== null && typeof o === 'object' && !Array.isArray(o)
      ? `a plain object — v2's ${variant}({col: view}) object-map form is gone; compose the dims explicitly: src.${variant}(src.between('col', bounds.get('col')), …)`
      : `${typeof o} — pass derived views or sources`
  if (!(primary instanceof DataNode))
    throw new Error(`data: ${variant}() primary operand must be a view, got ${bad(primary)}`)
  for (const o of others)
    if (!(o instanceof DataNode))
      throw new Error(`data: ${variant}() operands must be views, got ${bad(o)}`)
  // Dedup parents by identity, primary first (the v2 a.intersect(a) fix).
  const unique: DataNode<T>[] = [primary]
  for (const o of others) if (unique.indexOf(o) < 0) unique.push(o)
  return unique
}

export class SetOpNode<T> extends DataNode<T> {
  declare variant: SetVariant
  declare view: MembershipView // output MEMBERSHIP (rows resolve via exposed() — M6 P4b)
  declare othersMask: number // except only: OR of the *others* args' bits (bit i = parents[i])
  declare sharedProvenance: boolean // parents share ≥1 root source
  declare touchedScratch: Map<RowKey, Path | null> | undefined // settle scratch — reused per commit
  declare pdScratch: Map<RowKey, RowDelta<T>> | undefined // PRIMARY deltas this commit (pre-state reconstruction)
  declare udScratch: Map<RowKey, (RowDelta<T> | undefined)[]> | undefined // union only: per-parent deltas

  constructor(runtime: Runtime, variant: SetVariant, primary: DataNode<T>, others: readonly DataNode<T>[]) {
    // Operands validate + dedup BEFORE attach (validatedOperands throws on a
    // non-view operand without touching any parent's children — see its
    // header for the poisoning this prevents). For except the ORIGINAL others
    // list still contributes to othersMask, so except(a, a) maps the primary
    // bit into othersMask → honestly empty.
    super(runtime, 'operator', variant, validatedOperands(variant, primary, others))
    const unique = this.parents as readonly DataNode<T>[]
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
    // Membership only — rows resolve through exposed() (the parents). Union
    // pins include mode: its universe spans several parents, so a single-host
    // exclude complement is not well-defined. intersect/except complement
    // against the primary; a full-overlap construction (the crossfilter
    // reset state) lands as an EMPTY exclude set.
    this.view = new MembershipView(unique[0], variant !== 'union')
    if (variant === 'union') {
      const seen = new Set<RowKey>()
      for (const p of unique) {
        p.each((k) => {
          if (seen.has(k)) return
          seen.add(k)
          if (this.live(k)) this.view.add(k)
        })
      }
    } else {
      unique[0].each((k) => {
        if (this.live(k)) this.view.add(k)
      })
      this.view.maybeFlip()
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
    const m = new Map<RowKey, T>()
    this.view.eachKey((k) => m.set(k, this.exposed(k) as T))
    return m
  }

  hasRow(key: RowKey): boolean {
    if (this.runtime.midBatch) return super.hasRow(key)
    return this.view.has(key)
  }

  rowAt(key: RowKey): T | undefined {
    if (this.runtime.midBatch) return super.rowAt(key)
    return this.view.has(key) ? this.exposed(key) : undefined
  }

  each(fn: (key: RowKey, row: T) => void): void {
    if (this.runtime.midBatch) return super.each(fn)
    this.view.eachKey((k) => fn(k, this.exposed(k) as T))
  }

  rowCount(): number {
    if (this.runtime.midBatch) return super.rowCount()
    return this.view.memberCount()
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

    // Single-delta fast path — the bare-write churn shape (one commit per
    // write). Skips the touched-Map fold entirely; a suppressed outcome
    // (the common union-churn case) allocates NOTHING. Gate on inMore
    // LENGTH, not null: clearInputs keeps the array once allocated, so a
    // null-only gate would silently disable this path after the first
    // multi-parent commit.
    const b0 = this.in0 as CommitBatch<T>
    if ((this.inMore === null || this.inMore.length === 0) && b0.rows.length === 1) {
      const d = b0.rows[0]
      const fromPrimary = this.inFrom0 === this.parents[0]
      const ui = this.variant === 'union' ? this.parents.indexOf(this.inFrom0 as DataNode<T>) : 0
      const delta = this.settleKey(d.key, d.op === 'update' ? d.path : null, fromPrimary ? d : undefined, ui, d)
      this.view.maybeFlip()
      return delta === null ? null : { seq, origin, rows: [delta], order: undefined, scalar: undefined }
    }

    // Phase 1: collect the touched keys across every parent batch — no state
    // folding: liveness/exposure in phase 2 query the (already-settled)
    // parents directly. `touched` also carries the update-path candidate: the
    // path if every delta seen for the key this commit was an update with
    // the SAME path (two derived parents echoing one source write), else
    // null (→ whole-row path []). The Map is a persistent scratch (settle
    // runs at most once per commit and never re-enters) — cleared on exit.
    const touched = (this.touchedScratch ??= new Map<RowKey, Path | null>())
    const pds = (this.pdScratch ??= new Map<RowKey, RowDelta<T>>())
    const uds = this.variant === 'union' ? (this.udScratch ??= new Map()) : null
    this.fold(b0, this.inFrom0 as DataNode<T>, touched, pds, uds)
    if (this.inMore !== null)
      for (const { from, batch } of this.inMore)
        this.fold(batch as CommitBatch<T>, from as DataNode<T>, touched, pds, uds)

    // Phase 2: one pass over touched keys against the view. Pre-state is
    // reconstructed from the deltas (pds/uds) + the already-settled parents,
    // and read BEFORE mutation, so consolidation + prev-discipline +
    // add/remove legality hold by construction.
    const out: RowDelta<T>[] = []
    for (const [k, cand] of touched) {
      const delta = this.settleKey(k, cand, pds.get(k), -1, undefined)
      if (delta !== null) out.push(delta)
    }
    touched.clear()
    pds.clear()
    if (uds !== null && uds.size > 0) uds.clear()
    this.view.maybeFlip()
    return out.length ? { seq, origin, rows: out, order: undefined, scalar: undefined } : null
  }

  // ── pre-state reconstruction (M6 P4b) ───────────────────────────────────────
  // The view stores MEMBERSHIP only, so the pre-commit exposure is derived
  // from this commit's deltas: a parent's delta for k carries its own
  // pre-state (add → didn't hold k; remove/update → held k, prev = the old
  // row); a parent without a delta is unchanged, so its CURRENT state is
  // also its pre-state (height order: parents settled before us).

  private preHasParent(i: number, k: RowKey, di: RowDelta<T> | undefined): boolean {
    if (di !== undefined) return di.op !== 'add'
    return (this.parents[i] as DataNode<T>).hasRow(k)
  }

  private preRowParent(i: number, k: RowKey, di: RowDelta<T> | undefined): T | undefined {
    if (di !== undefined) return di.op === 'add' ? undefined : di.prev
    return (this.parents[i] as DataNode<T>).rowAt(k)
  }

  // The row this view exposed for k BEFORE this commit (valid when preLive).
  // intersect/except: the primary's pre-row. union: the first parent (in
  // parent order) that held k pre-commit — the pre-exposer.
  private preExposed(k: RowKey, pd: RowDelta<T> | undefined, ui: number, ud: RowDelta<T> | undefined): T | undefined {
    if (this.variant !== 'union') return this.preRowParent(0, k, pd)
    const uda = this.udScratch?.get(k)
    for (let i = 0; i < this.parents.length; i++) {
      const di = uda !== undefined ? uda[i] : i === ui ? ud : undefined
      if (this.preHasParent(i, k, di)) return this.preRowParent(i, k, di)
    }
    return undefined
  }

  // One key's view transition (shared by the single-delta fast path and the
  // phase-2 loop): returns the delta or null. `pd` = the PRIMARY's delta for
  // k this commit (if any); `ui`/`ud` = the single-delta fast path's parent
  // index + delta for union pre-exposure (the fold path reads udScratch and
  // passes ui = -1).
  private settleKey(
    k: RowKey,
    cand: Path | null,
    pd: RowDelta<T> | undefined,
    ui: number,
    ud: RowDelta<T> | undefined,
  ): RowDelta<T> | null {
    // Pre-liveness: membership polarity alone for union (include-pinned; the
    // set IS the pre-state); intersect/except must also confirm k was in the
    // pre-commit UNIVERSE — a fresh primary add is NOT previously-live even
    // though an exclude set doesn't contain it.
    const preLive =
      this.variant === 'union'
        ? this.view.hasSansHost(k)
        : this.preHasParent(0, k, pd) && this.view.hasSansHost(k)
    const postLive = this.live(k)
    if (!preLive && postLive) {
      const row = this.exposed(k) as T
      this.view.add(k)
      return { op: 'add', key: k, row }
    } else if (preLive && !postLive) {
      const prev = this.preExposed(k, pd, ui, ud) as T
      // A primary REMOVE shrank the universe (purge either polarity); an
      // eviction leaves k live in the host (record per polarity).
      if (pd !== undefined && pd.op === 'remove') this.view.hostRemoved(k)
      else this.view.removeMember(k)
      return { op: 'remove', key: k, prev }
    } else if (preLive && postLive) {
      const preRow = this.preExposed(k, pd, ui, ud) as T
      const row = this.exposed(k) as T
      if (Object.is(preRow, row)) return null // phantom-update suppression
      let path: Path = cand ?? []
      // Keep a forwarded path only if the leaf genuinely changed in OUR
      // exposure (a union exposure switch can change the row while the
      // candidate leaf stays equal — that must degrade to whole-row).
      if (path.length > 0 && Object.is(leafAt(preRow, path), leafAt(row, path))) path = []
      return { op: 'update', key: k, row, prev: preRow, path }
    }
    // !preLive && !postLive: nothing surfaced here — but the UNIVERSE may
    // have changed shape: a primary add that is not a member must be
    // recorded in an exclude set (or it would be silently admitted); a
    // primary remove of a non-member purges its stale exclude entry.
    if (pd !== undefined) {
      if (pd.op === 'add') this.view.hostAddedExcluded(k)
      else if (pd.op === 'remove') this.view.hostRemoved(k)
    }
    return null
  }

  private fold(
    batch: CommitBatch<T>,
    from: DataNode<T>,
    touched: Map<RowKey, Path | null>,
    pds: Map<RowKey, RowDelta<T>>,
    uds: Map<RowKey, (RowDelta<T> | undefined)[]> | null,
  ): void {
    const isPrimary = from === this.parents[0]
    const pi = uds !== null ? this.parents.indexOf(from) : 0
    for (const d of batch.rows) {
      if (!touched.has(d.key)) {
        touched.set(d.key, d.op === 'update' ? d.path : null)
      } else {
        const prior = touched.get(d.key)
        if (!(d.op === 'update' && prior !== null && pathEq(prior as Path, d.path)))
          touched.set(d.key, null)
      }
      if (isPrimary) pds.set(d.key, d)
      if (uds !== null) {
        let arr = uds.get(d.key)
        if (arr === undefined) {
          arr = new Array(this.parents.length)
          uds.set(d.key, arr)
        }
        arr[pi] = d
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
