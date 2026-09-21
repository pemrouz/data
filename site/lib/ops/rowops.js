// ops/rowops.ts — row operators: filter, map, and the compare family
// (gt/lt/gte/lte). The v2 RowOperator's process-returns-value insight, ported:
// a subclass supplies one pure per-row function; the base derives membership
// classification from the closed algebra — no verb × source-shape matrix, no
// shift/hole bookkeeping (those concepts no longer exist).

                                                                                      
import { DataNode } from '../kernel/node.js'
                                                   
import { defineOperator } from './registry.js'

// ── filter ───────────────────────────────────────────────────────────────────

export class FilterNode    extends DataNode    {
                                                
                               // materialized, updated at settle

  constructor(
    runtime         ,
    parent             ,
    pred                                  ,
    name = 'filter',
    extraParents                           = [], // W10: rescope deps ride as real parents
  ) {
    super(runtime, 'operator', name, [parent, ...extraParents])
    this.pred = pred
    this.view = new Map()
    parent.each((k, row) => { if (pred(row, k)) this.view.set(k, row) })
  }

  snapshot()                 {
    if (this.runtime.midBatch) {
      const m = new Map           ()
      this.parents[0].each((k, row) => { if (this.pred(row     , k)) m.set(k, row     ) })
      return m
    }
    return new Map(this.view)
  }

  each(fn                               )       {
    if (this.runtime.midBatch) return super.each(fn)
    for (const [k, v] of this.view) fn(k, v)
  }

  rowCount()         {
    if (this.runtime.midBatch) return super.rowCount()
    return this.view.size
  }

  hasRow(key        )          {
    if (this.runtime.midBatch) return super.hasRow(key)
    return this.view.has(key)
  }

  rowAt(key        )                {
    if (this.runtime.midBatch) return super.rowAt(key)
    return this.view.get(key)
  }

  settle(seq        , origin             )                        {
    const input = this.in0
    if (input === null) return null
    const out                = []
    this.applySrcBatch(input, out)
    return out.length ? { seq, origin, rows: out, order: undefined, scalar: undefined } : null
  }

            applySrcBatch(input                  , out               )       {
    for (const d of input.rows                          ) {
      switch (d.op) {
        case 'add':
          if (this.pred(d.row, d.key)) {
            this.view.set(d.key, d.row)
            out.push(d)
          }
          break
        case 'remove':
          if (this.view.has(d.key)) {
            this.view.delete(d.key)
            out.push(d)
          }
          break
        case 'update': {
          const was = this.view.has(d.key)
          const now = this.pred(d.row, d.key)
          if (was && now) {
            this.view.set(d.key, d.row)
            out.push(d)
          } else if (was && !now) {
            this.view.delete(d.key)
            out.push({ op: 'remove', key: d.key, prev: d.prev })
          } else if (!was && now) {
            this.view.set(d.key, d.row)
            out.push({ op: 'add', key: d.key, row: d.row })
          }
          break
        }
      }
    }
  }
}

// ── the re-scopable filter (W10) ─────────────────────────────────────────────
//
// filter(fn, dep): dep is a REAL second parent whose commits re-evaluate the
// predicate over every source row — the answer to predicates over EXTERNAL
// state (fero's owner-scoping: filter((_, k) => owner(k) === me) where owner
// reads the ring; dep = the ring-epoch view). This EXTENDS the deliberate
// function-slot exclusion in ops/reactive.ts rather than reversing it: "an
// operator reacts only to args it explicitly subscribes to" — dep IS the
// explicit subscription; the closure alone still never re-runs.
//
// Emission: source-only commits take FilterNode's per-delta path unchanged.
// Any commit where dep fired takes ONE full-diff sweep (removals via
// hasRow, membership/row changes via each) — a single pass emits ≤1 delta
// per key by construction (clause 8), costs O(N) predicate calls, and emits
// O(moved) deltas. That replaces v2/v3's only alternative — transient
// teardown + rebuild of the whole chain (the ~2× setup-class cost fero paid
// per ring rebind, times every downstream operator's reconstruction).

export class RescopeFilterNode    extends FilterNode    {
  constructor(runtime         , parent             , pred                                  , dep               ) {
    super(runtime, parent, pred, 'filter(rescope)', [dep])
  }

  settle(seq        , origin             )                        {
    // Identify which parents contributed this commit (src is parents[0]).
    const src = this.parents[0]
    let srcBatch                          = null
    let depFired = false
    if (this.in0 !== null) {
      if (this.inFrom0 === src) srcBatch = this.in0
      else depFired = true
    }
    if (this.inMore !== null) {
      for (const m of this.inMore) {
        if (m.from === src) srcBatch = m.batch
        else depFired = true
      }
    }
    const out                = []
    if (!depFired) {
      if (srcBatch === null) return null
      this.applySrcBatch(srcBatch, out)
      return out.length ? { seq, origin, rows: out, order: undefined, scalar: undefined } : null
    }
    // dep fired (possibly alongside a src batch): ONE full-diff sweep against
    // the settled parent (height order guarantees it settled first), so a
    // row touched by both inputs still yields exactly one delta.
    for (const [k, old] of [...this.view]) {
      if (!src.hasRow(k)) {
        this.view.delete(k)
        out.push({ op: 'remove', key: k, prev: old })
      }
    }
    src.each((k, row) => {
      const was = this.view.has(k)
      const old = this.view.get(k)
      const now = this.pred(row, k)
      if (was && !now) {
        this.view.delete(k)
        out.push({ op: 'remove', key: k, prev: old      })
      } else if (!was && now) {
        this.view.set(k, row)
        out.push({ op: 'add', key: k, row })
      } else if (was && now && !Object.is(old, row)) {
        this.view.set(k, row)
        out.push({ op: 'update', key: k, row, prev: old     , path: [] })
      }
    })
    return out.length ? { seq, origin, rows: out, order: undefined, scalar: undefined } : null
  }
}

export function rescopeFilter   (
  src             ,
  pred                                  ,
  dep               ,
)                       {
  if (!(dep instanceof DataNode))
    throw new Error('data: filter(fn, dep) — dep must be a view/scalar node or root handle (the explicit re-scope subscription)')
  return new RescopeFilterNode(src.runtime, src, pred, dep)
}

// ── map ──────────────────────────────────────────────────────────────────────

export class MapNode         extends DataNode      {
                                          
                                 // materialized mapped rows (supplies prev)

  constructor(runtime         , parent             , fn                              ) {
    super(runtime, 'operator', 'map', [parent])
    this.fn = fn
    this.view = new Map()
    parent.each((k, row) => this.view.set(k, fn(row, k)))
  }

  snapshot()                   {
    if (this.runtime.midBatch) {
      const m = new Map             ()
      this.parents[0].each((k, row) => m.set(k, this.fn(row     , k)))
      return m
    }
    return new Map(this.view)
  }

  each(fn                                 )       {
    if (this.runtime.midBatch) return super.each(fn)
    for (const [k, v] of this.view) fn(k, v)
  }

  rowCount()         {
    if (this.runtime.midBatch) return super.rowCount()
    return this.view.size
  }

  hasRow(key        )          {
    if (this.runtime.midBatch) return super.hasRow(key)
    return this.view.has(key)
  }

  rowAt(key        )                  {
    if (this.runtime.midBatch) return super.rowAt(key)
    return this.view.get(key)
  }

  settle(seq        , origin             )                          {
    const input = this.in0
    if (input === null) return null
    const out                  = []
    for (const d of input.rows                          ) {
      switch (d.op) {
        case 'add': {
          const mapped = this.fn(d.row, d.key)
          this.view.set(d.key, mapped)
          out.push({ op: 'add', key: d.key, row: mapped })
          break
        }
        case 'remove': {
          const prev = this.view.get(d.key)       
          this.view.delete(d.key)
          out.push({ op: 'remove', key: d.key, prev })
          break
        }
        case 'update': {
          const prev = this.view.get(d.key)       
          const next = this.fn(d.row, d.key)
          if (Object.is(prev, next)) break // equality cut-off
          this.view.set(d.key, next)
          out.push({ op: 'update', key: d.key, row: next, prev, path: [] })
          break
        }
      }
    }
    return out.length ? { seq, origin, rows: out, order: undefined, scalar: undefined } : null
  }
}

// ── factories + registry entries ─────────────────────────────────────────────

export function filter   (src             , pred                                  )                {
  // Fail fast at construction, not on the first write: v2's non-predicate
  // forms otherwise died LATE with a bare "pred is not a function" — and over
  // an empty source, not until the first row arrived.
  if (typeof pred !== 'function')
    throw new Error(
      "data: filter() takes a predicate fn — v2's filter('key', value) / filter({key: value}) forms are gone: filter(r => r.key === value)",
    )
  return new FilterNode(src.runtime, src, pred)
}

export function map        (src             , fn                              )                  {
  if (typeof fn !== 'function') throw new Error('data: map() takes a fn (row, key) => value')
  return new MapNode(src.runtime, src, fn)
}

                                        
const CMP                                             = {
  gt: (a, b) => a > b,
  lt: (a, b) => a < b,
  gte: (a, b) => a >= b,
  lte: (a, b) => a <= b,
}

export function compare   (src             , op       , col        , threshold         )                {
  // TODO(M2): reactive threshold (View<number>) via the uniform reactive-arg binder.
  const cmp = CMP[op]
  return new FilterNode(src.runtime, src, (row     ) => cmp(row?.[col], threshold), op)
}

defineOperator({
  name: 'filter', kind: 'row', category: 'rowop', declarative: false,
  // W10: filter(fn, dep) — dep (a node; root handles unwrap at the call
  // seam) is the explicit re-scope subscription.
  create: (src, pred, dep) => {
    if (typeof pred !== 'function')
      throw new Error("data: filter() takes a predicate fn — v2's filter('key', value) / filter({key: value}) forms are gone: filter(r => r.key === value)")
    return dep === undefined ? filter(src, pred) : rescopeFilter(src, pred, dep)
  },
  dedupKey: () => null, // opaque closures never dedup
})
defineOperator({
  name: 'map', kind: 'row', category: 'rowop', declarative: false,
  create: (src, fn) => map(src, fn),
  dedupKey: () => null,
})
for (const op of ['gt', 'lt', 'gte', 'lte']         ) {
  defineOperator({
    name: op, kind: 'row', category: 'rowop', declarative: true,
    create: (src, col, threshold) => compare(src, op, col, threshold),
    dedupKey: (col, threshold) =>
      typeof threshold === 'object' && threshold !== null ? null : `${op}:${col}:${String(threshold)}`,
  })
}
