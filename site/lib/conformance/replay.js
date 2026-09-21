// conformance/replay.ts — the replay sink.
//
// Folds a node's emitted batches into a fresh independent store and asserts,
// after every commit, that replay ≡ the node's materialized value — the
// table⟷change-stream duality as an executable law. The v2 C8 bug class
// (value right, stream wrong) dies on the commit that introduces it, and
// incremental fast paths become attemptable because a wrong delta fails
// replay immediately.

                                                               

export class ReplayError extends Error {
  constructor(node        , seq        , msg        ) {
    super(`[replay] node=${node} seq=${seq}: ${msg}`)
    this.name = 'ReplayError'
  }
}

export class ReplaySink    {
  rows = new Map           ()
  order                  = null
  scalar          = undefined
  hasScalar = false
           node        
  constructor(node        ) {
    this.node = node
  }

  init(snapshot                        , order                    )       {
    this.rows = new Map(snapshot)
    this.order = order ? [...order] : null
  }

  initScalar(v         )       {
    this.scalar = v
    this.hasScalar = true
  }

  apply(batch                )       {
    for (const d of batch.rows) {
      switch (d.op) {
        case 'add':
          this.rows.set(d.key, d.row)
          break
        case 'update':
          this.rows.set(d.key, d.row)
          break
        case 'remove':
          this.rows.delete(d.key)
          break
      }
    }
    if (batch.order) {
      if (this.order === null) this.order = []
      for (const d of batch.order) {
        if (d.op === 'orderInsert') this.order.splice(d.index, 0, d.key)
        else if (d.op === 'orderRemove') this.order.splice(d.index, 1)
        else {
          this.order.splice(d.from , 1)
          this.order.splice(d.index, 0, d.key)
        }
      }
    }
    if (batch.scalar) {
      this.scalar = batch.scalar.next
      this.hasScalar = true
    }
  }

  // Assert replayed state ≡ the node's actual materialized state. Deep
  // structural equality (JSON-shape values; NaN-aware via Object.is at leaves).
  assertMatches(actualRows                        , actualOrder                    , seq = -1)       {
    if (this.rows.size !== actualRows.size)
      throw new ReplayError(this.node, seq, `size: replay ${this.rows.size} != actual ${actualRows.size}`)
    for (const [k, v] of actualRows) {
      if (!this.rows.has(k)) throw new ReplayError(this.node, seq, `replay missing key ${String(k)}`)
      if (!deepEq(this.rows.get(k), v))
        throw new ReplayError(
          this.node, seq,
          `value mismatch at ${String(k)}: replay ${JSON.stringify(this.rows.get(k))} != actual ${JSON.stringify(v)}`,
        )
    }
    if (actualOrder) {
      const ro = this.order ?? []
      if (ro.length !== actualOrder.length || ro.some((k, i) => k !== actualOrder[i]))
        throw new ReplayError(
          this.node, seq,
          `order mismatch: replay [${ro.map(String).join(',')}] != actual [${actualOrder.map(String).join(',')}]`,
        )
    }
  }

  assertScalar(actual         , seq = -1)       {
    if (!deepEq(this.scalar, actual))
      throw new ReplayError(this.node, seq, `scalar: replay ${String(this.scalar)} != actual ${String(actual)}`)
  }
}

export function deepEq(a         , b         )          {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b             
    return a.length === bb.length && a.every((v, i) => deepEq(v, bb[i]))
  }
  const ka = Object.keys(a          )
  const kb = Object.keys(b          )
  if (ka.length !== kb.length) return false
  for (const k of ka) if (!deepEq((a       )[k], (b       )[k])) return false
  return true
}
