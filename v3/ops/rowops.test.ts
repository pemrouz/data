// v3/ops/rowops.test.ts — factory-level guards for filter/map. The row-op
// BEHAVIOR (membership, holes, batch legality) is covered by the kernel M1
// suite and every composition test; this file pins the construction-time
// fail-fasts: v2's non-predicate filter forms died LATE with a bare "pred is
// not a function" on the first write — and stayed SILENT over an empty
// source until a row arrived.

import { test } from 'node:test'
import assert from 'node:assert'
import { Runtime } from '../kernel/runtime.ts'
import { SourceNode } from '../kernel/node.ts'
import { filter, map } from './rowops.ts'

type Row = { val: number; cat: string }

test('filter/map fail fast on non-fn args (v2 forms) — even over an EMPTY source', () => {
  const rt = new Runtime()
  const empty = new SourceNode<Row>(rt, {})
  assert.throws(() => filter(empty, 'cat' as any), /forms are gone/)
  assert.throws(() => filter(empty, { cat: 'x' } as any), /forms are gone/)
  assert.throws(() => map(empty, 'cat' as any), /takes a fn/)
  empty.write('a', [], { val: 1, cat: 'x' }) // runtime unharmed by the throws
  const f = filter(empty, (r) => r.cat === 'x')
  assert.strictEqual(f.hasRow('a'), true)
})
