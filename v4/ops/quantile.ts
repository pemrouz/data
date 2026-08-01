// v4/ops/quantile.ts — W13: median / percentile / quantile.
//
// The operator family v2 and v3 never had (fero IDEAS: "median/percentile/
// quantile — data has no such operator; the user computes over
// methods.read()"). Holistic by nature (the value depends on every member),
// implemented as a ProjectionAggregate over a maintained SORTED array of the
// projected NUMERIC values: delta = one binary search + one splice per
// change (O(log n) locate, O(n) memmove — fine far past the corpus sizes;
// a tree/skip-list is the upgrade path if a workload ever demands it).
//
// Value convention: linear interpolation between closest ranks (R type-7 /
// numpy default): h = (n-1)q, v = vals[⌊h⌋] + (h-⌊h⌋)(vals[⌊h⌋+1]-vals[⌊h⌋]).
// Empty set → undefined (the max/min convention, NOT NaN). Only real
// numbers rank: undefined/null are "not in the set" (proj), and non-number/
// NaN projections are skipped — a NaN cannot be ordered, and poisoning the
// whole quantile on one bad row is the SumValue lesson fero already
// documented (fold.ts avgRule); the honest reading of "quantile of the
// numeric values" is over the values that ARE numeric.
//
// Under fero scoping these are holistic ops (throw with the
// materialize-first hint) until distributed decomposable folds land — a
// t-digest decomposable variant is that workstream's question, not this one.

import { ProjectionAggregate } from './aggregate.ts'
import type { DataNode } from '../kernel/node.ts'
import type { RowKey } from '../contract/delta.ts'
import { defineOperator } from './registry.ts'

function lowerBound(a: number[], x: number): number {
  let lo = 0
  let hi = a.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (a[mid] < x) lo = mid + 1
    else hi = mid
  }
  return lo
}

const rankable = (x: unknown): x is number => typeof x === 'number' && !Number.isNaN(x)

export class QuantileNode<In> extends ProjectionAggregate<In> {
  declare q: number
  declare vals: number[]

  constructor(runtime: any, parent: DataNode<In>, col: string | undefined, q: number, name = 'quantile') {
    // The base ctor seeds via delta() and reads cur BEFORE subclass fields
    // assign (the SumNode lazy-init idiom) — q lands after, so re-read once.
    super(runtime, parent, name, col)
    this.q = q
    this.cur = this.read()
  }

  protected delta(o: unknown, n: unknown): void {
    const vals = (this.vals ??= [])
    if (rankable(o)) {
      const i = lowerBound(vals, o)
      if (vals[i] === o) vals.splice(i, 1)
    }
    if (rankable(n)) vals.splice(lowerBound(vals, n), 0, n)
  }

  protected read(): unknown {
    const vals = this.vals
    const q = this.q
    if (q === undefined || vals === undefined || vals.length === 0) return undefined
    const h = (vals.length - 1) * q
    const lo = Math.floor(h)
    const frac = h - lo
    return frac === 0 ? vals[lo] : vals[lo] + frac * (vals[lo + 1] - vals[lo])
  }

  protected recompute(snap: Map<RowKey, unknown>): unknown {
    const col = this.col
    const vals: number[] = []
    for (const row of snap.values()) {
      const x = col === undefined ? row : (row as any)?.[col]
      if (rankable(x)) vals.push(x)
    }
    if (vals.length === 0 || this.q === undefined) return undefined
    vals.sort((a, b) => a - b)
    const h = (vals.length - 1) * this.q
    const lo = Math.floor(h)
    const frac = h - lo
    return frac === 0 ? vals[lo] : vals[lo] + frac * (vals[lo + 1] - vals[lo])
  }
}

// Arg dispatch shared by the three verbs: (col, q) / (q) — a string first
// arg projects the column, a number first arg ranks the rows themselves.
function args(name: string, a: unknown, b: unknown, scale: number, fixed?: number): { col: string | undefined; q: number } {
  let col: string | undefined
  let raw: unknown
  if (typeof a === 'string') {
    col = a
    raw = fixed ?? b
  } else {
    col = undefined
    raw = fixed ?? a
  }
  const q = Number(raw) / scale
  if (!Number.isFinite(q) || q < 0 || q > 1)
    throw new Error(`data: ${name}() needs a fraction in [0,1]${scale === 100 ? ' (percent in [0,100])' : ''}, got ${String(raw)}`)
  return { col, q }
}

export function quantile<In>(src: DataNode<In>, a: unknown, b?: unknown): QuantileNode<In> {
  const { col, q } = args('quantile', a, b, 1)
  return new QuantileNode(src.runtime, src, col, q, 'quantile')
}
export function percentile<In>(src: DataNode<In>, a: unknown, b?: unknown): QuantileNode<In> {
  const { col, q } = args('percentile', a, b, 100)
  return new QuantileNode(src.runtime, src, col, q, 'percentile')
}
export function median<In>(src: DataNode<In>, col?: unknown): QuantileNode<In> {
  if (col !== undefined && typeof col !== 'string')
    throw new Error(`data: median() takes an optional column name, got ${typeof col}`)
  return new QuantileNode(src.runtime, src, col as string | undefined, 0.5, 'median')
}

defineOperator({
  name: 'quantile', kind: 'aggregate', category: 'holistic', declarative: true,
  create: (src, a, b) => quantile(src, a, b),
  dedupKey: (a, b) =>
    (typeof a === 'string' && typeof b === 'number') || (typeof a === 'number' && b === undefined)
      ? `quantile:${String(a)}:${String(b ?? '')}`
      : null,
})
defineOperator({
  name: 'percentile', kind: 'aggregate', category: 'holistic', declarative: true,
  create: (src, a, b) => percentile(src, a, b),
  dedupKey: (a, b) =>
    (typeof a === 'string' && typeof b === 'number') || (typeof a === 'number' && b === undefined)
      ? `percentile:${String(a)}:${String(b ?? '')}`
      : null,
})
defineOperator({
  name: 'median', kind: 'aggregate', category: 'holistic', declarative: true,
  create: (src, col) => median(src, col),
  dedupKey: (col) => (typeof col === 'string' || col === undefined ? `median:${col ?? ''}` : null),
})
