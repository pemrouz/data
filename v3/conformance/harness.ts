// v3/conformance/harness.ts — wrap any node in the conformance kit.
//
// conform(node): every emitted batch is legality-checked, folded by the
// replay sink, and asserted ≡ the node's materialized state — any protocol
// bug fails on the INTRODUCING commit. Every operator's test suite wraps its
// nodes with these; an operator that passes its tests has, by construction,
// also proven its change-stream legal and replayable.

import { LegalityChecker } from './legality.ts'
import { ReplaySink } from './replay.ts'
import type { CommitBatch, RowKey } from '../contract/delta.ts'
import type { DataNode } from '../kernel/node.ts'

export function conform<T>(node: DataNode<T>): void {
  const checker = new LegalityChecker<T>(node.opName)
  const replay = new ReplaySink<T>(node.opName)
  const order = node.currentOrder()
  checker.init(node.snapshot(), order ?? undefined)
  replay.init(node.snapshot(), order ?? undefined)
  node.connect({
    wantsOrder: true,
    origin: null,
    apply(batch: CommitBatch<T>) {
      checker.apply(batch)
      replay.apply(batch)
      replay.assertMatches(node.snapshot(), node.currentOrder() ?? undefined, batch.seq)
    },
  })
}

// Scalar nodes: value-shaped replay (node must expose value()).
export function conformScalar(node: DataNode<never> & { value(): unknown }): void {
  const checker = new LegalityChecker(node.opName)
  const replay = new ReplaySink(node.opName)
  checker.init(new Map())
  replay.initScalar(node.value())
  node.connect({
    wantsOrder: false,
    origin: null,
    apply(batch: CommitBatch<never>) {
      checker.apply(batch)
      replay.apply(batch)
      replay.assertScalar(node.value(), batch.seq)
    },
  })
}

// Deep-equality oracle check: assert a node's materialized state equals a
// naive plain-JS recompute (the independent per-operator oracle).
export function assertOracle<T>(
  node: DataNode<T>,
  oracle: () => Map<RowKey, T>,
  msg = 'oracle mismatch',
): void {
  const actual = node.snapshot()
  const expected = oracle()
  if (actual.size !== expected.size)
    throw new Error(`${msg}: size actual ${actual.size} != oracle ${expected.size}`)
  for (const [k, v] of expected) {
    if (!actual.has(k)) throw new Error(`${msg}: missing key ${String(k)}`)
    if (JSON.stringify(actual.get(k)) !== JSON.stringify(v))
      throw new Error(`${msg}: value at ${String(k)}: ${JSON.stringify(actual.get(k))} != ${JSON.stringify(v)}`)
  }
}
