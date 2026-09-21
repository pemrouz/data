// ops/aggregate.ts — scalar nodes: sum, avg, length.
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

                                                                                      
import { DataNode } from '../kernel/node.js'
                                                   
import { defineOperator } from './registry.js'

export          class ScalarNode     extends DataNode        {
                      

  constructor(runtime         , parent              , name        ) {
    super(runtime, 'scalar', name, [parent])
  }

  snapshot()                     {
    throw new Error(`data: ${this.opName} is a scalar node — read value(), not snapshot()`)
  }

  value()          {
    if (this.runtime.midBatch) return this.recompute(this.parents[0].snapshot())
    return this.cur
  }

                                                                   
                                                      
                                    

  settle(seq        , origin             )                            {
    const input = this.in0
    if (input === null) return null
    for (const d of input.rows                           ) this.applyDelta(d)
    const next = this.read()
    if (Object.is(this.cur, next)) return null // equality cut-off, everywhere
    const prev = this.cur
    this.cur = next
    return { seq, origin, rows: [], order: undefined, scalar: { prev, next } }
  }
}

// Projection normalization: undefined and null are both "not in the set".
function proj(col                    , row     )          {
  const x = col === undefined ? row : row?.[col]
  return x === undefined || x === null ? undefined : x
}

// Exported for extension: the tracked-projection scalar base (sum/avg here,
// max/min/some/every replicate it in misc.ts) — a custom incremental
// aggregate supplies delta(old, new) over normalized projections.
export          class ProjectionAggregate     extends ScalarNode     {
                                 
                                       

  constructor(runtime         , parent              , name        , col         ) {
    super(runtime, parent, name)
    this.col = col
    this.tracked = new Map()
    parent.each((k, row) => {
      const x = proj(col, row)
      if (x !== undefined) {
        this.tracked.set(k, x)
        this.delta(undefined, x)
      }
    })
    this.cur = this.read()
  }

            applyDelta(d              )       {
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

                                                        
}

export class SumNode     extends ProjectionAggregate     {
                       
            delta(o         , n         )       {
    // Class-field init order: total is adjusted before the subclass field
    // initializer would run, so initialize lazily on first touch.
    if (this.total === undefined) this.total = 0
    if (o !== undefined) this.total -= +(o       )
    if (n !== undefined) this.total += +(n       )
  }
            read()          {
    return this.total === undefined ? 0 : this.total
  }
            recompute(snap                      )          {
    let t = 0
    for (const row of snap.values()) {
      const x = proj(this.col, row)
      if (x !== undefined) t += +(x       )
    }
    return t
  }
}

export class AvgNode     extends ProjectionAggregate     {
                       
                       
            delta(o         , n         )       {
    if (this.total === undefined) {
      this.total = 0
      this.count = 0
    }
    if (o !== undefined) {
      this.total -= +(o       )
      this.count--
    }
    if (n !== undefined) {
      this.total += +(n       )
      this.count++
    }
  }
            read()          {
    return this.count === undefined || this.count === 0 ? undefined : this.total / this.count
  }
            recompute(snap                      )          {
    let t = 0
    let c = 0
    for (const row of snap.values()) {
      const x = proj(this.col, row)
      if (x !== undefined) {
        t += +(x       )
        c++
      }
    }
    return c === 0 ? undefined : t / c
  }
}

export class LengthNode     extends ScalarNode     {
                       

  constructor(runtime         , parent              ) {
    super(runtime, parent, 'length')
    this.count = parent.rowCount()
    this.cur = this.count
  }

            applyDelta(d              )       {
    if (d.op === 'add') this.count++
    else if (d.op === 'remove') this.count--
    // update: a field edit can't change the row count — inert by construction
  }
            read()          {
    return this.count
  }
            recompute(snap                      )          {
    return snap.size
  }
}

export function sum   (src             , col         )             {
  return new SumNode(src.runtime, src, 'sum', col)
}
export function avg   (src             , col         )             {
  return new AvgNode(src.runtime, src, 'avg', col)
}
export function length   (src             )                {
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
