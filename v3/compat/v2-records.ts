// v3/compat/v2-records.ts — the PERMANENT v2 record profile.
//
// Projects the v3 delta algebra onto v2's ChangeRecord stream shape:
//   { type: 'update'|'insert'|'remove', key: string[], value, at? }
//   { type: 'move', from, to }
// Positional keys for ordered (array-born) nodes are projected through the
// order channel; values are structuredClone'd (v2 behavior); a connect emits
// an initial whole-value update record ({key: [], value: snapshot}) exactly
// like v2's ArrSink constructor did.
//
// This is a documented wire profile under SCHEMA_VERSION — not a shim. It is
// deliberately the ONLY module where order→index math survives. Byte-parity
// against recorded v2 streams is the M2+ gate (see plans/v3/PLAN.md §7.6).

import type { ChangeRecordV2 } from '../contract/index.ts'
import type { CommitBatch, RowDelta, RowKey } from '../contract/delta.ts'
import { leafAt } from '../kernel/node.ts'
import type { DataNode, SubscriptionHandle } from '../kernel/node.ts'

const sclone = (v: unknown) => (v === undefined ? v : structuredClone(v))

export class V2RecordSink<T> {
  readonly wantsOrder = true
  readonly origin = null
  declare out: (r: ChangeRecordV2) => void
  declare order: RowKey[] | null // local mirror of the node's order channel
  declare node: DataNode<T>

  constructor(node: DataNode<T>, out: (r: ChangeRecordV2) => void) {
    this.node = node
    this.out = out
    const snap = node.snapshot()
    const order = node.currentOrder()
    this.order = order ? [...order] : null
    // v2: connect emits the current snapshot as one whole-value update record.
    this.out({ type: 'update', key: [], value: sclone(materialize(snap, this.order)) })
  }

  apply(batch: CommitBatch<T>): void {
    const rowsByKey = new Map<RowKey, RowDelta<T>>()
    for (const d of batch.rows) rowsByKey.set(d.key, d)

    if (this.order !== null && batch.order) {
      // Ordered node: order deltas drive insert/remove records so positional
      // indices are correct at application time (removes descend, inserts ascend).
      for (const od of batch.order) {
        if (od.op === 'orderRemove') {
          const d = rowsByKey.get(od.key)
          this.order.splice(od.index, 1)
          if (d && d.op === 'remove') {
            rowsByKey.delete(od.key)
            if (d.prev !== undefined) // v2: skip undefined-valued removes
              this.out({ type: 'remove', key: [String(od.index)], value: sclone(d.prev) })
          }
        } else if (od.op === 'orderInsert') {
          const d = rowsByKey.get(od.key)
          this.order.splice(od.index, 0, od.key)
          if (d && d.op === 'add') {
            rowsByKey.delete(od.key)
            this.out({ type: 'insert', key: [], value: sclone(d.row), at: od.index })
          }
        } else {
          this.out({ type: 'move', from: od.from!, to: od.index })
          this.order.splice(od.from!, 1)
          this.order.splice(od.index, 0, od.key)
        }
      }
    }

    // Remaining row deltas (all deltas for unordered nodes; updates for ordered).
    for (const d of rowsByKey.values()) {
      const name = this.order !== null ? String(this.order.indexOf(d.key)) : String(d.key)
      switch (d.op) {
        case 'add':
          this.out({ type: 'insert', key: [], value: sclone(d.row), at: this.order !== null ? Number(name) : d.key })
          break
        case 'remove':
          if (d.prev !== undefined)
            this.out({ type: 'remove', key: [name], value: sclone(d.prev) })
          break
        case 'update': {
          const value = d.path.length ? leafAt(d.row, d.path) : d.row
          this.out({ type: 'update', key: [name, ...d.path.map(String)], value: sclone(value) })
          break
        }
      }
    }

    if (batch.scalar) this.out({ type: 'update', key: [], value: sclone(batch.scalar.next) })
  }
}

// v2 value shape: object-born → plain object; array-born → dense array in order.
export function materialize<T>(snap: Map<RowKey, T>, order: readonly RowKey[] | null): unknown {
  if (order) return order.map((k) => snap.get(k))
  const o: Record<string, unknown> = {}
  for (const [k, v] of snap) o[String(k)] = v
  return o
}

// v2's connect([]) shape: push records into the given array; the returned
// handle disposes the subscription (the v2 WeakRef-drop idiom is replaced by
// an explicit handle — scopes own it if one is current).
export function connectRecords<T>(node: DataNode<T>, arr: ChangeRecordV2[]): SubscriptionHandle {
  const sink = new V2RecordSink(node, (r) => arr.push(r))
  return node.connect(sink)
}
