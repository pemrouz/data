// v3/conformance/legality.ts — the delta legality checker.
//
// A state machine per node asserting SCHEDULE.md clause 8 on every batch:
//   - add only for keys not live before the batch
//   - update/remove only for keys live before the batch
//   - ≤1 row delta per key per batch
//   - no update whose written leaf is Object.is-identical pre/post (no-phantom-events)
//   - scalar deltas only when !Object.is(prev, next)
//   - order deltas reference keys live after the batch's row deltas, in-bounds indices
//   - seq strictly increases per node
//
// The dev build wraps every node's emission path with one of these; in tests
// it wraps nodes under scrutiny. An operator emitting an illegal batch fails
// on the INTRODUCING commit — the C-series class of "stream drifts from
// value" cannot survive a single test run.

import type { CommitBatch, OrderDelta, Path, RowDelta, RowKey } from '../contract/delta.ts'

export class LegalityError extends Error {
  constructor(node: string, seq: number, msg: string) {
    super(`[legality] node=${node} seq=${seq}: ${msg}`)
    this.name = 'LegalityError'
  }
}

function leafAt(v: unknown, path: Path): unknown {
  let cur: any = v
  for (const p of path) {
    if (cur == null) return undefined
    cur = cur[p]
  }
  return cur
}

export class LegalityChecker<T> {
  live = new Set<RowKey>()
  order: RowKey[] | null = null // tracked only if the node emits order deltas
  lastSeq = -1
  readonly node: string
  constructor(node: string) {
    this.node = node
  }

  init(snapshot: ReadonlyMap<RowKey, T>, order?: readonly RowKey[]): void {
    this.live = new Set(snapshot.keys())
    this.order = order ? [...order] : null
    if (order) {
      if (order.length !== snapshot.size)
        throw new LegalityError(this.node, -1, `init order length ${order.length} != snapshot size ${snapshot.size}`)
      for (const k of order)
        if (!this.live.has(k)) throw new LegalityError(this.node, -1, `init order references non-live key ${String(k)}`)
    }
  }

  apply(batch: CommitBatch<T>): void {
    const { seq, rows, order, scalar } = batch
    if (seq <= this.lastSeq)
      throw new LegalityError(this.node, seq, `seq not monotonic (last ${this.lastSeq})`)
    this.lastSeq = seq

    const seen = new Set<RowKey>()
    for (const d of rows) {
      if (seen.has(d.key))
        throw new LegalityError(this.node, seq, `>1 row delta for key ${String(d.key)} in one batch`)
      seen.add(d.key)
      switch (d.op) {
        case 'add':
          if (this.live.has(d.key))
            throw new LegalityError(this.node, seq, `add for already-live key ${String(d.key)}`)
          this.live.add(d.key)
          break
        case 'remove':
          if (!this.live.has(d.key))
            throw new LegalityError(this.node, seq, `remove for non-live key ${String(d.key)}`)
          this.live.delete(d.key)
          break
        case 'update': {
          if (!this.live.has(d.key))
            throw new LegalityError(this.node, seq, `update for non-live key ${String(d.key)}`)
          const before = leafAt(d.prev, d.path)
          const after = leafAt(d.row, d.path)
          if (Object.is(before, after))
            throw new LegalityError(
              this.node, seq,
              `phantom update at key ${String(d.key)} path [${d.path.join('.')}] — leaf unchanged`,
            )
          break
        }
        default: {
          const never: never = d
          throw new LegalityError(this.node, seq, `unknown row op ${(never as RowDelta<T>).op}`)
        }
      }
    }

    if (order) this.applyOrder(seq, order)
    if (scalar && Object.is(scalar.prev, scalar.next))
      throw new LegalityError(this.node, seq, `phantom scalar delta (Object.is(prev, next))`)
  }

  private applyOrder(seq: number, deltas: readonly OrderDelta[]): void {
    if (this.order === null) this.order = [] // node reveals itself as ordered on first order emission
    const ord = this.order
    for (const d of deltas) {
      switch (d.op) {
        case 'orderInsert':
          if (!this.live.has(d.key))
            throw new LegalityError(this.node, seq, `orderInsert for non-live key ${String(d.key)}`)
          if (d.index < 0 || d.index > ord.length)
            throw new LegalityError(this.node, seq, `orderInsert index ${d.index} out of bounds (len ${ord.length})`)
          if (ord.includes(d.key))
            throw new LegalityError(this.node, seq, `orderInsert for already-ordered key ${String(d.key)}`)
          ord.splice(d.index, 0, d.key)
          break
        case 'orderRemove': {
          if (d.index < 0 || d.index >= ord.length)
            throw new LegalityError(this.node, seq, `orderRemove index ${d.index} out of bounds (len ${ord.length})`)
          if (ord[d.index] !== d.key)
            throw new LegalityError(
              this.node, seq,
              `orderRemove key mismatch at ${d.index}: expected ${String(ord[d.index])}, got ${String(d.key)}`,
            )
          ord.splice(d.index, 1)
          break
        }
        case 'orderMove': {
          if (d.from == null || d.from < 0 || d.from >= ord.length)
            throw new LegalityError(this.node, seq, `orderMove from ${d.from} out of bounds (len ${ord.length})`)
          if (d.index < 0 || d.index >= ord.length)
            throw new LegalityError(this.node, seq, `orderMove to ${d.index} out of bounds (len ${ord.length})`)
          if (ord[d.from] !== d.key)
            throw new LegalityError(
              this.node, seq,
              `orderMove key mismatch at ${d.from}: expected ${String(ord[d.from])}, got ${String(d.key)}`,
            )
          ord.splice(d.from, 1)
          ord.splice(d.index, 0, d.key)
          break
        }
        default: {
          const never: never = d.op
          throw new LegalityError(this.node, seq, `unknown order op ${never}`)
        }
      }
    }
    // Post-batch coherence: every ordered key is live; every live key that the
    // node orders is present exactly once. (Ordered nodes must keep the two in
    // lockstep within a single batch.)
    if (ord.length > 0 || deltas.length > 0) {
      const s = new Set(ord)
      if (s.size !== ord.length)
        throw new LegalityError(this.node, seq, `order contains duplicate keys after batch`)
      for (const k of ord)
        if (!this.live.has(k))
          throw new LegalityError(this.node, seq, `order references non-live key ${String(k)} after batch`)
    }
  }
}
