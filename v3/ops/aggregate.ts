// v3/ops/aggregate.ts — scalar nodes: sum, avg, length.
//
// v2 semantics ported verbatim (fero replicates them bit-for-bit):
// - the aggregate tracks a PROJECTION per row; rows whose projection is
//   undefined OR null are excluded from the tracked set entirely
// - sum: running total via unary plus — NaN poisons and removal cannot
//   un-poison (total -= NaN stays NaN); empty set → 0
// - avg: running total + count; empty set → undefined (never 0/0 = NaN)
// - length(): live-key count; a nested field edit cannot change it (inert on
//   pure updates by construction — the update verb doesn't touch the count)
// P7 is closed by construction: keys are stable, so these are O(Δ) for
// array-born sources too — no O(N) rebuild fallback exists.

import type { CommitBatch, OriginToken, RowDelta, RowKey } from '../contract/delta.ts'
import { DataNode } from '../kernel/node.ts'
import type { Runtime } from '../kernel/runtime.ts'
import { defineOperator } from './registry.ts'

export abstract class ScalarNode<In> extends DataNode<never> {
  declare cur: unknown

  constructor(runtime: Runtime, parent: DataNode<In>, name: string) {
    super(runtime, 'scalar', name, [parent])
  }

  snapshot(): Map<RowKey, never> {
    throw new Error(`data: ${this.opName} is a scalar node — read value(), not snapshot()`)
  }

  value(): unknown {
    if (this.runtime.midBatch) return this.recompute(this.parents[0].snapshot())
    return this.cur
  }

  protected abstract recompute(snap: Map<RowKey, unknown>): unknown
  protected abstract applyDelta(d: RowDelta<In>): void
  protected abstract read(): unknown

  settle(seq: number, origin: OriginToken): CommitBatch<never> | null {
    const input = this.in0
    if (input === null) return null
    for (const d of input.rows as readonly RowDelta<In>[]) this.applyDelta(d)
    const next = this.read()
    if (Object.is(this.cur, next)) return null // equality cut-off, everywhere
    const prev = this.cur
    this.cur = next
    return { seq, origin, rows: [], order: undefined, scalar: { prev, next } }
  }
}

// Projection normalization: undefined and null are both "not in the set".
function proj(col: string | undefined, row: any): unknown {
  const x = col === undefined ? row : row?.[col]
  return x === undefined || x === null ? undefined : x
}

abstract class ProjectionAggregate<In> extends ScalarNode<In> {
  declare col: string | undefined
  declare tracked: Map<RowKey, unknown>

  constructor(runtime: Runtime, parent: DataNode<In>, name: string, col?: string) {
    super(runtime, parent, name)
    this.col = col
    this.tracked = new Map()
    for (const [k, row] of parent.snapshot()) {
      const x = proj(col, row)
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
        const x = proj(this.col, d.row)
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
        const x = proj(this.col, d.row)
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

  protected abstract delta(o: unknown, n: unknown): void
}

export class SumNode<In> extends ProjectionAggregate<In> {
  declare total: number
  protected delta(o: unknown, n: unknown): void {
    // Class-field init order: total is adjusted before the subclass field
    // initializer would run, so initialize lazily on first touch.
    if (this.total === undefined) this.total = 0
    if (o !== undefined) this.total -= +(o as any)
    if (n !== undefined) this.total += +(n as any)
  }
  protected read(): unknown {
    return this.total === undefined ? 0 : this.total
  }
  protected recompute(snap: Map<RowKey, unknown>): unknown {
    let t = 0
    for (const row of snap.values()) {
      const x = proj(this.col, row)
      if (x !== undefined) t += +(x as any)
    }
    return t
  }
}

export class AvgNode<In> extends ProjectionAggregate<In> {
  declare total: number
  declare count: number
  protected delta(o: unknown, n: unknown): void {
    if (this.total === undefined) {
      this.total = 0
      this.count = 0
    }
    if (o !== undefined) {
      this.total -= +(o as any)
      this.count--
    }
    if (n !== undefined) {
      this.total += +(n as any)
      this.count++
    }
  }
  protected read(): unknown {
    return this.count === undefined || this.count === 0 ? undefined : this.total / this.count
  }
  protected recompute(snap: Map<RowKey, unknown>): unknown {
    let t = 0
    let c = 0
    for (const row of snap.values()) {
      const x = proj(this.col, row)
      if (x !== undefined) {
        t += +(x as any)
        c++
      }
    }
    return c === 0 ? undefined : t / c
  }
}

export class LengthNode<In> extends ScalarNode<In> {
  declare count: number

  constructor(runtime: Runtime, parent: DataNode<In>) {
    super(runtime, parent, 'length')
    this.count = parent.snapshot().size
    this.cur = this.count
  }

  protected applyDelta(d: RowDelta<In>): void {
    if (d.op === 'add') this.count++
    else if (d.op === 'remove') this.count--
    // update: a field edit can't change the row count — inert by construction
  }
  protected read(): unknown {
    return this.count
  }
  protected recompute(snap: Map<RowKey, unknown>): unknown {
    return snap.size
  }
}

export function sum<T>(src: DataNode<T>, col?: string): SumNode<T> {
  return new SumNode(src.runtime, src, 'sum', col)
}
export function avg<T>(src: DataNode<T>, col?: string): AvgNode<T> {
  return new AvgNode(src.runtime, src, 'avg', col)
}
export function length<T>(src: DataNode<T>): LengthNode<T> {
  return new LengthNode(src.runtime, src)
}

defineOperator({
  name: 'sum', kind: 'aggregate', category: 'aggregate-decomposable', declarative: true,
  create: (src, col) => sum(src, col),
  dedupKey: (col) => (typeof col === 'string' || col === undefined ? `sum:${col ?? ''}` : null),
})
defineOperator({
  name: 'avg', kind: 'aggregate', category: 'aggregate-decomposable', declarative: true,
  create: (src, col) => avg(src, col),
  dedupKey: (col) => (typeof col === 'string' || col === undefined ? `avg:${col ?? ''}` : null),
})
defineOperator({
  name: 'length', kind: 'aggregate', category: 'aggregate-decomposable', declarative: true,
  create: (src) => length(src),
  dedupKey: () => 'length',
})
