// v3/ops/rowops.ts — row operators: filter, map, and the compare family
// (gt/lt/gte/lte). The v2 RowOperator's process-returns-value insight, ported:
// a subclass supplies one pure per-row function; the base derives membership
// classification from the closed algebra — no verb × source-shape matrix, no
// shift/hole bookkeeping (those concepts no longer exist).

import type { CommitBatch, OriginToken, RowDelta, RowKey } from '../contract/delta.ts'
import { DataNode } from '../kernel/node.ts'
import type { Runtime } from '../kernel/runtime.ts'
import { defineOperator } from './registry.ts'

// ── filter ───────────────────────────────────────────────────────────────────

export class FilterNode<T> extends DataNode<T> {
  declare pred: (row: T, key: RowKey) => boolean
  declare view: Map<RowKey, T> // materialized, updated at settle

  constructor(runtime: Runtime, parent: DataNode<T>, pred: (row: T, key: RowKey) => boolean, name = 'filter') {
    super(runtime, 'operator', name, [parent])
    this.pred = pred
    this.view = new Map()
    for (const [k, row] of parent.snapshot()) if (pred(row, k)) this.view.set(k, row)
  }

  snapshot(): Map<RowKey, T> {
    if (this.runtime.midBatch) {
      const m = new Map<RowKey, T>()
      for (const [k, row] of this.parents[0].snapshot()) if (this.pred(row as T, k)) m.set(k, row as T)
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

  settle(seq: number, origin: OriginToken): CommitBatch<T> | null {
    const input = this.in0
    if (input === null) return null
    const out: RowDelta<T>[] = []
    for (const d of input.rows as readonly RowDelta<T>[]) {
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
    return out.length ? { seq, origin, rows: out, order: undefined, scalar: undefined } : null
  }
}

// ── map ──────────────────────────────────────────────────────────────────────

export class MapNode<T, Out> extends DataNode<Out> {
  declare fn: (row: T, key: RowKey) => Out
  declare view: Map<RowKey, Out> // materialized mapped rows (supplies prev)

  constructor(runtime: Runtime, parent: DataNode<T>, fn: (row: T, key: RowKey) => Out) {
    super(runtime, 'operator', 'map', [parent])
    this.fn = fn
    this.view = new Map()
    for (const [k, row] of parent.snapshot()) this.view.set(k, fn(row, k))
  }

  snapshot(): Map<RowKey, Out> {
    if (this.runtime.midBatch) {
      const m = new Map<RowKey, Out>()
      for (const [k, row] of this.parents[0].snapshot()) m.set(k, this.fn(row as T, k))
      return m
    }
    return new Map(this.view)
  }

  hasRow(key: RowKey): boolean {
    if (this.runtime.midBatch) return super.hasRow(key)
    return this.view.has(key)
  }

  rowAt(key: RowKey): Out | undefined {
    if (this.runtime.midBatch) return super.rowAt(key)
    return this.view.get(key)
  }

  settle(seq: number, origin: OriginToken): CommitBatch<Out> | null {
    const input = this.in0
    if (input === null) return null
    const out: RowDelta<Out>[] = []
    for (const d of input.rows as readonly RowDelta<T>[]) {
      switch (d.op) {
        case 'add': {
          const mapped = this.fn(d.row, d.key)
          this.view.set(d.key, mapped)
          out.push({ op: 'add', key: d.key, row: mapped })
          break
        }
        case 'remove': {
          const prev = this.view.get(d.key) as Out
          this.view.delete(d.key)
          out.push({ op: 'remove', key: d.key, prev })
          break
        }
        case 'update': {
          const prev = this.view.get(d.key) as Out
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

export function filter<T>(src: DataNode<T>, pred: (row: T, key: RowKey) => boolean): FilterNode<T> {
  return new FilterNode(src.runtime, src, pred)
}

export function map<T, Out>(src: DataNode<T>, fn: (row: T, key: RowKey) => Out): MapNode<T, Out> {
  return new MapNode(src.runtime, src, fn)
}

type CmpOp = 'gt' | 'lt' | 'gte' | 'lte'
const CMP: Record<CmpOp, (a: any, b: any) => boolean> = {
  gt: (a, b) => a > b,
  lt: (a, b) => a < b,
  gte: (a, b) => a >= b,
  lte: (a, b) => a <= b,
}

export function compare<T>(src: DataNode<T>, op: CmpOp, col: string, threshold: unknown): FilterNode<T> {
  // TODO(M2): reactive threshold (View<number>) via the uniform reactive-arg binder.
  const cmp = CMP[op]
  return new FilterNode(src.runtime, src, (row: any) => cmp(row?.[col], threshold), op)
}

defineOperator({
  name: 'filter', kind: 'row', category: 'rowop', declarative: false,
  create: (src, pred) => filter(src, pred),
  dedupKey: () => null, // opaque closures never dedup
})
defineOperator({
  name: 'map', kind: 'row', category: 'rowop', declarative: false,
  create: (src, fn) => map(src, fn),
  dedupKey: () => null,
})
for (const op of ['gt', 'lt', 'gte', 'lte'] as const) {
  defineOperator({
    name: op, kind: 'row', category: 'rowop', declarative: true,
    create: (src, col, threshold) => compare(src, op, col, threshold),
    dedupKey: (col, threshold) =>
      typeof threshold === 'object' && threshold !== null ? null : `${op}:${col}:${String(threshold)}`,
  })
}
