// v3/ops/misc.ts — the remaining scalar/effect/utility family:
//   max/min          — extremum scalars, projection-excluded like sum/avg
//   some/every       — boolean scalars with counter state (v2 empty-set contracts)
//   reduce           — 2-arg general fold (O(N) rebuild) + 3-arg incremental fold
//   distinct         — keyed first-seen-value view with deterministic representative
//   tap              — effect passthrough with v2 param-presence dispatch
//   toValue ('to')   — whole-value projection scalar (v2's .to())
//   keysView/valuesView ('keys'/'values') — incremental key / identity views
//
// v2 IP carried over (see operators/{aggregate,tap,reduce,distinct,to,keys}):
// projection normalization (undefined/null excluded), max/min evict-recompute,
// some/every truthy counters with vacuous-truth empty set, reduce's
// remove(prev)+add(row) inversion (v2's P3 BU2 fallback is CLOSED here — the
// v3 update delta carries prev), assertPlainInit's fail-fast on a reactive
// fold seed, distinct's first-seen representative + promotion-on-removal, and
// tapHasParam's source-inspecting arity dispatch. The v2 verb machinery
// (BR1A/BH1/BF0/positional rebuild fallbacks) has no v3 equivalent: keys are
// stable, membership changes are honest add/remove, order is its own channel.

import type { CommitBatch, OriginToken, RowDelta, RowKey } from '../contract/delta.ts'
import { DataNode } from '../kernel/node.ts'
import type { Runtime } from '../kernel/runtime.ts'
import { ScalarNode } from './aggregate.ts'
import { defineOperator } from './registry.ts'
import { V2RecordSink, materialize } from '../compat/v2-records.ts'

// ── shared: projection-tracked scalar base ───────────────────────────────────
//
// REPLICATED (not imported) from aggregate.ts's non-exported
// ProjectionAggregate — that file may not be modified, and the pattern is
// small: track a per-row projection in a Map, exclude undefined/null
// projections from the set entirely, and thread (old, new) through a
// subclass `delta`. Kept byte-compatible in behavior so max/min/some/every
// share the sum/avg exclusion semantics exactly.

abstract class TrackedScalarNode<In> extends ScalarNode<In> {
  declare col: string | undefined
  declare projFn: (row: any) => unknown
  declare tracked: Map<RowKey, unknown>

  constructor(
    runtime: Runtime,
    parent: DataNode<In>,
    name: string,
    col?: string,
    read?: (row: any) => unknown,
  ) {
    super(runtime, parent, name)
    this.col = col
    const base = read ?? (col === undefined ? (r: any) => r : (r: any) => r?.[col])
    // Projection normalization: undefined and null are both "not in the set".
    this.projFn = (row: any) => {
      const x = base(row)
      return x === undefined || x === null ? undefined : x
    }
    this.tracked = new Map()
    for (const [k, row] of parent.snapshot()) {
      const x = this.projFn(row)
      if (x !== undefined) {
        this.tracked.set(k, x)
        this.delta(undefined, x)
      }
    }
    this.cur = this.read()
  }

  protected applyDelta(d: RowDelta<In>): void {
    switch (d.op) {
      case 'add': {
        const x = this.projFn(d.row)
        if (x !== undefined) {
          this.tracked.set(d.key, x)
          this.delta(undefined, x)
        }
        break
      }
      case 'remove': {
        const o = this.tracked.get(d.key)
        if (o !== undefined) {
          this.tracked.delete(d.key)
          this.delta(o, undefined)
        }
        break
      }
      case 'update': {
        const o = this.tracked.get(d.key)
        const x = this.projFn(d.row)
        if (x === undefined) {
          if (o !== undefined) {
            this.tracked.delete(d.key)
            this.delta(o, undefined)
          }
        } else {
          this.tracked.set(d.key, x)
          if (!Object.is(o, x)) this.delta(o, x)
        }
        break
      }
    }
  }

  // (old, new): old/new is the row's projection before/after the change;
  // undefined means "not in the set". Called AFTER `tracked` is mutated.
  protected abstract delta(o: unknown, n: unknown): void
}

// ── max / min ────────────────────────────────────────────────────────────────
//
// Incremental on add / improving update (compare against the running
// extremum); evicting the current extremum (a remove or worsening update of
// a row that held it) marks the extremum stale, and the next read() rescans
// `tracked` O(n) — the v2 MaxValue/MinValue recompute-on-publish, made lazy.
// Empty set → undefined. Comparison is the generic `>` / `<` (numbers, Dates,
// strings all work); an incomparable/NaN eviction conservatively rescans.

export class MaxNode<In> extends TrackedScalarNode<In> {
  declare best: unknown
  declare stale: boolean

  constructor(runtime: Runtime, parent: DataNode<In>, col?: string) {
    super(runtime, parent, 'max', col)
  }

  protected delta(o: unknown, n: unknown): void {
    if (o !== undefined) {
      if (this.tracked.size === 0) {
        this.best = undefined
        this.stale = false
      } else if (this.stale !== true && !((o as any) < (this.best as any))) {
        this.stale = true // the leaving value may have supplied the extremum
      }
    }
    if (n !== undefined && this.stale !== true) {
      if (this.best === undefined || (n as any) > (this.best as any)) this.best = n
    }
  }

  protected read(): unknown {
    if (this.stale === true) {
      this.stale = false
      let m: unknown
      for (const v of this.tracked.values()) if (m === undefined || (v as any) > (m as any)) m = v
      this.best = m
    }
    return this.best
  }

  protected recompute(snap: Map<RowKey, unknown>): unknown {
    let m: unknown
    for (const row of snap.values()) {
      const x = this.projFn(row)
      if (x === undefined) continue
      if (m === undefined || (x as any) > (m as any)) m = x
    }
    return m
  }
}

export class MinNode<In> extends TrackedScalarNode<In> {
  declare best: unknown
  declare stale: boolean

  constructor(runtime: Runtime, parent: DataNode<In>, col?: string) {
    super(runtime, parent, 'min', col)
  }

  protected delta(o: unknown, n: unknown): void {
    if (o !== undefined) {
      if (this.tracked.size === 0) {
        this.best = undefined
        this.stale = false
      } else if (this.stale !== true && !((o as any) > (this.best as any))) {
        this.stale = true
      }
    }
    if (n !== undefined && this.stale !== true) {
      if (this.best === undefined || (n as any) < (this.best as any)) this.best = n
    }
  }

  protected read(): unknown {
    if (this.stale === true) {
      this.stale = false
      let m: unknown
      for (const v of this.tracked.values()) if (m === undefined || (v as any) < (m as any)) m = v
      this.best = m
    }
    return this.best
  }

  protected recompute(snap: Map<RowKey, unknown>): unknown {
    let m: unknown
    for (const row of snap.values()) {
      const x = this.projFn(row)
      if (x === undefined) continue
      if (m === undefined || (x as any) < (m as any)) m = x
    }
    return m
  }
}

// ── some / every ─────────────────────────────────────────────────────────────
//
// Boolean scalars with counter state: the projection is `!!fn(row)` (never
// undefined/null, so EVERY row is tracked), `trueCount` counts passing rows.
// some = trueCount > 0; every = trueCount === tracked.size. Empty-set
// semantics match Array.prototype (v2 contract): some → false, every → true
// (vacuous truth). O(1) per delta.

export class SomeNode<In> extends TrackedScalarNode<In> {
  declare trueCount: number | undefined

  constructor(runtime: Runtime, parent: DataNode<In>, fn: (row: In) => unknown) {
    super(runtime, parent, 'some', undefined, (r: any) => !!fn(r))
  }

  protected delta(o: unknown, n: unknown): void {
    let c = this.trueCount ?? 0
    if (o === true) c--
    if (n === true) c++
    this.trueCount = c
  }

  protected read(): unknown {
    return (this.trueCount ?? 0) > 0
  }

  protected recompute(snap: Map<RowKey, unknown>): unknown {
    for (const row of snap.values()) if (this.projFn(row) === true) return true
    return false
  }
}

export class EveryNode<In> extends TrackedScalarNode<In> {
  declare trueCount: number | undefined

  constructor(runtime: Runtime, parent: DataNode<In>, fn: (row: In) => unknown) {
    super(runtime, parent, 'every', undefined, (r: any) => !!fn(r))
  }

  protected delta(o: unknown, n: unknown): void {
    let c = this.trueCount ?? 0
    if (o === true) c--
    if (n === true) c++
    this.trueCount = c
  }

  protected read(): unknown {
    return (this.trueCount ?? 0) === this.tracked.size
  }

  protected recompute(snap: Map<RowKey, unknown>): unknown {
    for (const row of snap.values()) if (this.projFn(row) !== true) return false
    return true
  }
}

// ── reduce ───────────────────────────────────────────────────────────────────

// v2's assertPlainInit, ported in spirit: a fold seed is its identity element
// (0, '', {}), not a reactive input. A DataNode init fails fast with guidance.
function assertPlainInit(init: unknown): void {
  if (init instanceof DataNode)
    throw new Error(
      'data: reduce(): init must be a plain value or a thunk, not a reactive node — ' +
        'a fold seed is its identity element, not a reactive input. For a reactive ' +
        'base, derive it upstream (filter/gt/between) and fold the derived view.',
    )
}

// Small NaN-aware structural equality for the incremental fold's emission
// cut-off (a fold that mutates its accumulator in place keeps the same
// reference, so Object.is alone can never legally emit — we emit a
// structuredClone and cut off on deep equality instead).
function deepEq(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    return a.length === bb.length && a.every((v, i) => deepEq(v, bb[i]))
  }
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  for (const k of ka) if (!deepEq((a as any)[k], (b as any)[k])) return false
  return true
}

// 2-arg general fold: non-commutative-safe, O(N) rebuild per batch over the
// parent snapshot. For an ORDERED parent (array-born) the fold walks the
// order channel so string-concatenation-style folds see display order (v2
// parity — v2's iter() walked the dense array). Object init is
// structuredClone'd per rebuild (the v2 mutable-{} accumulator fix: reusing
// one init object across rebuilds compounds contributions). Equality cut-off
// is the base ScalarNode Object.is (v2 used reference equality — same
// contract: a fresh object result re-emits, an identical primitive doesn't).
export class ReduceNode<In> extends ScalarNode<In> {
  declare fn: (acc: any, row: In, key: RowKey) => any
  declare init: any

  constructor(runtime: Runtime, parent: DataNode<In>, fn: (acc: any, row: In, key: RowKey) => any, init: any) {
    super(runtime, parent, 'reduce')
    assertPlainInit(init)
    this.fn = fn
    this.init = init
    this.cur = this.recompute(parent.snapshot())
  }

  protected applyDelta(): void {}

  protected read(): unknown {
    return this.recompute(this.parents[0].snapshot())
  }

  protected recompute(snap: Map<RowKey, unknown>): unknown {
    let acc = this.init !== null && typeof this.init === 'object' ? structuredClone(this.init) : this.init
    const order = this.parents[0].currentOrder()
    if (order !== null) {
      for (const k of order) if (snap.has(k)) acc = this.fn(acc, snap.get(k) as In, k)
    } else {
      for (const [k, row] of snap) acc = this.fn(acc, row as In, k)
    }
    return acc
  }
}

// 3-arg incremental fold: `add` on an add delta, `remove(prev)` + `add(row)`
// on an update (v2's P3 — the BU2 nested-edit rebuild fallback — is CLOSED:
// the v3 update delta CARRIES prev, so there is no "already-mutated cache"
// problem and no rebuild path at all), `remove` on a remove delta. `init`
// may be a value or a thunk (thunk fires per fresh fold — construction and
// midBatch recompute). The emitted scalar is a structuredClone of the
// accumulator when it's an object (an in-place-mutating fold keeps one
// reference, which could never legally emit under the no-phantom-scalar
// rule), with a deep-equality cut-off so an unchanged fold stays silent.
// The `remove`-must-invert-`add` symmetry contract is unchanged from v2.
export class ReduceIncrementalNode<In> extends ScalarNode<In> {
  declare addFn: (acc: any, row: In, key: RowKey) => any
  declare removeFn: (acc: any, row: In, key: RowKey) => any
  declare init: any
  declare acc: any

  constructor(
    runtime: Runtime,
    parent: DataNode<In>,
    addFn: (acc: any, row: In, key: RowKey) => any,
    removeFn: (acc: any, row: In, key: RowKey) => any,
    init: any,
  ) {
    super(runtime, parent, 'reduce')
    assertPlainInit(init)
    this.addFn = addFn
    this.removeFn = removeFn
    this.init = init
    let acc = this.seed()
    for (const [k, row] of parent.snapshot()) acc = addFn(acc, row as In, k)
    this.acc = acc
    this.cur = this.publishable()
  }

  private seed(): any {
    return typeof this.init === 'function' ? this.init() : this.init
  }

  private publishable(): unknown {
    return this.acc !== null && typeof this.acc === 'object' ? structuredClone(this.acc) : this.acc
  }

  protected applyDelta(d: RowDelta<In>): void {
    switch (d.op) {
      case 'add':
        this.acc = this.addFn(this.acc, d.row, d.key)
        break
      case 'remove':
        this.acc = this.removeFn(this.acc, d.prev, d.key)
        break
      case 'update':
        // prev-based inversion: subtract the row AS IT WAS, add it as it is.
        this.acc = this.addFn(this.removeFn(this.acc, d.prev, d.key), d.row, d.key)
        break
    }
  }

  protected read(): unknown {
    return this.acc
  }

  protected recompute(snap: Map<RowKey, unknown>): unknown {
    let acc = this.seed()
    for (const [k, row] of snap) acc = this.addFn(acc, row as In, k)
    return acc
  }

  settle(seq: number, origin: OriginToken): CommitBatch<never> | null {
    const input = this.in0
    if (input === null) return null
    for (const d of input.rows as readonly RowDelta<In>[]) this.applyDelta(d)
    const next = this.publishable()
    if (deepEq(this.cur, next)) return null // deep cut-off (clone ≠ ref equality)
    const prev = this.cur
    this.cur = next
    return { seq, origin, rows: [], order: undefined, scalar: { prev, next } }
  }
}

// ── distinct ─────────────────────────────────────────────────────────────────
//
// Keyed first-seen-values view: output key = String(projected value); the
// exposed row is the projected value of the distinct key's REPRESENTATIVE —
// deterministically the holder earliest in SOURCE key-insertion order (a
// monotonic per-node arrival counter; an update keeps a key's position, a
// remove + re-add moves it to the end — matching the parent snapshot Map's
// own insertion order). On removal (or projection-move) of the
// representative, the next holder in that order is promoted by rescanning
// the distinct key's holder set (O(holders), the v2 "recompute from tracked"
// discipline). Emits add/remove only on distinct-SET changes and update only
// when the exposed value actually changes (promotion between Object.is-equal
// values is silent — no phantom updates). Per-batch emission is diffed
// against the pre-batch view, so N source deltas touching one distinct key
// consolidate to ≤1 output delta per key.

export class DistinctNode<T> extends DataNode<unknown> {
  declare fn: (row: T) => unknown
  declare pos: Map<RowKey, number> // source key → arrival counter
  declare projOf: Map<RowKey, unknown> // source key → projected value
  declare dkOf: Map<RowKey, string> // source key → distinct key
  declare holders: Map<string, Set<RowKey>> // distinct key → holder source keys
  declare view: Map<string, unknown> // distinct key → exposed value
  declare counter: number

  constructor(runtime: Runtime, parent: DataNode<T>, fn?: (row: T) => unknown) {
    super(runtime, 'operator', 'distinct', [parent])
    this.fn = fn ?? ((r: T) => r as unknown)
    this.pos = new Map()
    this.projOf = new Map()
    this.dkOf = new Map()
    this.holders = new Map()
    this.view = new Map()
    this.counter = 0
    for (const [k, row] of parent.snapshot()) this._admit(k, row)
    for (const dk of this.holders.keys()) this.view.set(dk, this._exposed(dk))
  }

  private _admit(k: RowKey, row: T): string {
    const v = this.fn(row)
    const dk = String(v)
    this.pos.set(k, this.counter++)
    this.projOf.set(k, v)
    this.dkOf.set(k, dk)
    let set = this.holders.get(dk)
    if (set === undefined) this.holders.set(dk, (set = new Set()))
    set.add(k)
    return dk
  }

  private _expel(k: RowKey): string {
    const dk = this.dkOf.get(k)!
    const set = this.holders.get(dk)!
    set.delete(k)
    if (set.size === 0) this.holders.delete(dk)
    this.pos.delete(k)
    this.projOf.delete(k)
    this.dkOf.delete(k)
    return dk
  }

  // The representative's projected value: min arrival position wins.
  private _exposed(dk: string): unknown {
    const set = this.holders.get(dk)!
    let bestK: RowKey | undefined
    let bestP = Infinity
    for (const k of set) {
      const p = this.pos.get(k)!
      if (p < bestP) {
        bestP = p
        bestK = k
      }
    }
    return this.projOf.get(bestK!)
  }

  snapshot(): Map<RowKey, unknown> {
    if (this.runtime.midBatch) {
      // Pure recompute: first-seen per distinct key in parent snapshot order —
      // the parent Map's insertion order coincides with our arrival counters
      // (updates keep a key's slot; remove + re-add appends in both).
      const m = new Map<RowKey, unknown>()
      for (const row of this.parents[0].snapshot().values()) {
        const v = this.fn(row as T)
        const dk = String(v)
        if (!m.has(dk)) m.set(dk, v)
      }
      return m
    }
    return new Map(this.view)
  }

  settle(seq: number, origin: OriginToken): CommitBatch<unknown> | null {
    const input = this.in0
    if (input === null) return null
    // Phase 1: apply every input delta to holder state, recording which
    // distinct keys were touched. `view` stays pre-batch throughout, so the
    // emission diff below reads honest prev values.
    const touched = new Set<string>()
    for (const d of input.rows as readonly RowDelta<T>[]) {
      switch (d.op) {
        case 'add':
          touched.add(this._admit(d.key, d.row))
          break
        case 'remove':
          touched.add(this._expel(d.key))
          break
        case 'update': {
          const oldDk = this.dkOf.get(d.key)!
          const v = this.fn(d.row)
          const dk = String(v)
          touched.add(oldDk)
          if (dk === oldDk) {
            this.projOf.set(d.key, v)
          } else {
            // Projection moved buckets; the key KEEPS its arrival position
            // (source insertion order is a property of the key, not the value).
            touched.add(dk)
            const set = this.holders.get(oldDk)!
            set.delete(d.key)
            if (set.size === 0) this.holders.delete(oldDk)
            this.projOf.set(d.key, v)
            this.dkOf.set(d.key, dk)
            let ns = this.holders.get(dk)
            if (ns === undefined) this.holders.set(dk, (ns = new Set()))
            ns.add(d.key)
          }
          break
        }
      }
    }
    // Phase 2: diff each touched distinct key pre-batch → post-batch. This
    // guarantees ≤1 output delta per key and no phantom updates.
    const out: RowDelta<unknown>[] = []
    for (const dk of touched) {
      const was = this.view.has(dk)
      const prev = this.view.get(dk)
      if (this.holders.has(dk)) {
        const val = this._exposed(dk)
        if (!was) {
          this.view.set(dk, val)
          out.push({ op: 'add', key: dk, row: val })
        } else if (!Object.is(prev, val)) {
          this.view.set(dk, val)
          out.push({ op: 'update', key: dk, row: val, prev, path: [] })
        }
      } else if (was) {
        this.view.delete(dk)
        out.push({ op: 'remove', key: dk, prev })
      }
    }
    return out.length ? { seq, origin, rows: out, order: undefined, scalar: undefined } : null
  }
}

// ── tap ──────────────────────────────────────────────────────────────────────

// v2's param-presence dispatch, ported verbatim from operators/tap/index.ts:
// `fn.length` excludes defaulted/destructured params, so source inspection
// catches `(c = {}) => …` / `({type}) => …` (and is robust to minification —
// a USED param is never dropped).
export function tapHasParam(fn: any): boolean {
  if (typeof fn !== 'function') return false
  if (fn.length > 0) return true
  const s = Function.prototype.toString.call(fn)
  // bare single-identifier arrow: `x => …` / `async x => …`
  if (/^\s*(?:async\s+)?[A-Za-z_$][\w$]*\s*=>/.test(s)) return true
  // first parenthesised parameter list has any content (`(c = {})`, `({k})`, …)
  const m = s.match(/\(([^)]*)\)/)
  return !!(m && m[1].trim() !== '')
}

// Effect operator: forwards its input batch UNCHANGED (view = parent
// passthrough; snapshot/currentOrder delegate) and calls fn as an EFFECT —
// per SCHEDULE clause 4 tap fns run after all operator state settles,
// exception-isolated (the v2 inline-during-propagation timing is gone by
// contract). Dispatch:
//   fn with ANY declared parameter → per-row v2-SHAPED records
//     ({type, key, value, at?}, structuredClone'd) via the permanent
//     V2RecordSink wire profile — one call per row delta, positional keys
//     for ordered parents, plus the v2 initial whole-value update record.
//   genuinely parameterless fn → called ONCE per batch, no allocation
//     (and once at construction, matching v2 TapBareValue's XU0).
export class TapNode<T> extends DataNode<T> {
  constructor(runtime: Runtime, parent: DataNode<T>, fn: (change?: any) => void) {
    super(runtime, 'operator', 'tap', [parent])
    if (typeof fn !== 'function') throw new Error('data: tap(fn) requires a function')
    if (tapHasParam(fn)) {
      // V2RecordSink's constructor emits the initial whole-value update
      // record ({type:'update', key:[], value: snapshot}) exactly like v2.
      this.connect(new V2RecordSink<T>(this, (r) => fn(r)))
    } else {
      fn() // v2 TapBareValue fired on the construction XU0
      this.connect({ wantsOrder: false, origin: null, apply: () => fn() })
    }
  }

  snapshot(): Map<RowKey, T> {
    return this.parents[0].snapshot()
  }

  currentOrder(): readonly RowKey[] | null {
    return this.parents[0].currentOrder()
  }

  settle(): CommitBatch<T> | null {
    return this.in0 as CommitBatch<T> | null // pure passthrough
  }
}

// ── toValue (v2's .to()) ─────────────────────────────────────────────────────
//
// Whole-value projection scalar: every parent batch collapses to
// fn(dense plain snapshot, prevResult) — object-born parents materialize as a
// plain object, array-born as a dense array in display order. O(N) rebuild
// per batch; the base ScalarNode Object.is cut-off preserves v2's
// reference-equality short-circuit contract (an fn returning the same
// instance every time is a no-op subscription).
export class ToValueNode<In> extends ScalarNode<In> {
  declare fn: (plain: any, prev?: unknown) => unknown

  constructor(runtime: Runtime, parent: DataNode<In>, fn: (plain: any, prev?: unknown) => unknown) {
    super(runtime, parent, 'to')
    this.fn = fn
    this.cur = fn(materialize(parent.snapshot(), parent.currentOrder()), undefined)
  }

  protected applyDelta(): void {}

  protected read(): unknown {
    const p = this.parents[0]
    return this.fn(materialize(p.snapshot(), p.currentOrder()), this.cur)
  }

  protected recompute(snap: Map<RowKey, unknown>): unknown {
    return this.fn(materialize(snap, this.parents[0].currentOrder()), this.cur)
  }
}

// ── keysView / valuesView ────────────────────────────────────────────────────

// Incremental keyed view of key → String(key). Adds/removes only — an update
// can't change a key, so update deltas are inert (no phantom emissions).
export class KeysNode<T> extends DataNode<string> {
  declare view: Map<RowKey, string>

  constructor(runtime: Runtime, parent: DataNode<T>) {
    super(runtime, 'operator', 'keys', [parent])
    this.view = new Map()
    for (const k of parent.snapshot().keys()) this.view.set(k, String(k))
  }

  snapshot(): Map<RowKey, string> {
    if (this.runtime.midBatch) {
      const m = new Map<RowKey, string>()
      for (const k of this.parents[0].snapshot().keys()) m.set(k, String(k))
      return m
    }
    return new Map(this.view)
  }

  settle(seq: number, origin: OriginToken): CommitBatch<string> | null {
    const input = this.in0
    if (input === null) return null
    const out: RowDelta<string>[] = []
    for (const d of input.rows as readonly RowDelta<T>[]) {
      if (d.op === 'add') {
        const s = String(d.key)
        this.view.set(d.key, s)
        out.push({ op: 'add', key: d.key, row: s })
      } else if (d.op === 'remove') {
        const s = this.view.get(d.key) as string
        this.view.delete(d.key)
        out.push({ op: 'remove', key: d.key, prev: s })
      }
      // update: the key is unchanged — inert by construction
    }
    return out.length ? { seq, origin, rows: out, order: undefined, scalar: undefined } : null
  }
}

// Identity map view of rows: snapshot delegates to the parent, row deltas
// forward as-is (prev is already correct under identity). Unordered — the
// order channel is not forwarded (v2's values() was a dense array; here
// order-hungry sinks should sit on the parent).
export class ValuesNode<T> extends DataNode<T> {
  constructor(runtime: Runtime, parent: DataNode<T>) {
    super(runtime, 'operator', 'values', [parent])
  }

  snapshot(): Map<RowKey, T> {
    return this.parents[0].snapshot()
  }

  settle(seq: number, origin: OriginToken): CommitBatch<T> | null {
    const input = this.in0
    if (input === null) return null
    const rows = input.rows as readonly RowDelta<T>[]
    return rows.length ? { seq, origin, rows, order: undefined, scalar: undefined } : null
  }
}

// ── factories ────────────────────────────────────────────────────────────────

export function max<T>(src: DataNode<T>, col?: string): MaxNode<T> {
  return new MaxNode(src.runtime, src, col)
}
export function min<T>(src: DataNode<T>, col?: string): MinNode<T> {
  return new MinNode(src.runtime, src, col)
}
export function some<T>(src: DataNode<T>, fn: (row: T) => unknown): SomeNode<T> {
  return new SomeNode(src.runtime, src, fn)
}
export function every<T>(src: DataNode<T>, fn: (row: T) => unknown): EveryNode<T> {
  return new EveryNode(src.runtime, src, fn)
}
// Dispatch mirrors v2: a function-valued second arg selects the 3-arg
// incremental form (add, remove, init); otherwise (fn, init) general fold.
export function reduce<T>(
  src: DataNode<T>,
  fnOrAdd: (acc: any, row: T, key: RowKey) => any,
  removeOrInit: any,
  init?: any,
): ScalarNode<T> {
  return typeof removeOrInit === 'function' && !(removeOrInit instanceof DataNode)
    ? new ReduceIncrementalNode(src.runtime, src, fnOrAdd, removeOrInit, init)
    : new ReduceNode(src.runtime, src, fnOrAdd, removeOrInit)
}
export function distinct<T>(src: DataNode<T>, fn?: (row: T) => unknown): DistinctNode<T> {
  return new DistinctNode(src.runtime, src, fn)
}
export function tap<T>(src: DataNode<T>, fn: (change?: any) => void): TapNode<T> {
  return new TapNode(src.runtime, src, fn)
}
export function toValue<T>(src: DataNode<T>, fn: (plain: any, prev?: unknown) => unknown): ToValueNode<T> {
  return new ToValueNode(src.runtime, src, fn)
}
export function keysView<T>(src: DataNode<T>): KeysNode<T> {
  return new KeysNode(src.runtime, src)
}
export function valuesView<T>(src: DataNode<T>): ValuesNode<T> {
  return new ValuesNode(src.runtime, src)
}

// ── registry entries ─────────────────────────────────────────────────────────
// dedupKey per the value-identity rule: string columns dedup, fns never;
// no-arg forms have trivially well-defined identity.

defineOperator({
  name: 'max', kind: 'aggregate', category: 'holistic', declarative: true,
  create: (src, col) => max(src, col),
  dedupKey: (col) => (typeof col === 'string' || col === undefined ? `max:${col ?? ''}` : null),
})
defineOperator({
  name: 'min', kind: 'aggregate', category: 'holistic', declarative: true,
  create: (src, col) => min(src, col),
  dedupKey: (col) => (typeof col === 'string' || col === undefined ? `min:${col ?? ''}` : null),
})
defineOperator({
  name: 'some', kind: 'aggregate', category: 'aggregate-decomposable', declarative: false,
  create: (src, fn) => some(src, fn),
  dedupKey: () => null,
})
defineOperator({
  name: 'every', kind: 'aggregate', category: 'aggregate-decomposable', declarative: false,
  create: (src, fn) => every(src, fn),
  dedupKey: () => null,
})
defineOperator({
  name: 'reduce', kind: 'aggregate', category: 'holistic', declarative: false,
  create: (src, fnOrAdd, removeOrInit, init) => reduce(src, fnOrAdd, removeOrInit, init),
  dedupKey: () => null,
})
defineOperator({
  name: 'distinct', kind: 'bucket', category: 'holistic', declarative: false,
  create: (src, fn) => distinct(src, fn),
  dedupKey: (fn) => (fn === undefined ? 'distinct' : null),
})
defineOperator({
  name: 'tap', kind: 'effect', category: 'iter', declarative: false,
  create: (src, fn) => tap(src, fn),
  dedupKey: () => null,
})
defineOperator({
  name: 'to', kind: 'rebuild', category: 'holistic', declarative: false,
  create: (src, fn) => toValue(src, fn),
  dedupKey: () => null,
})
defineOperator({
  name: 'keys', kind: 'row', category: 'iter', declarative: true,
  create: (src) => keysView(src),
  dedupKey: () => 'keys',
})
defineOperator({
  name: 'values', kind: 'row', category: 'iter', declarative: true,
  create: (src) => valuesView(src),
  dedupKey: () => 'values',
})
