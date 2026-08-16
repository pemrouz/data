// ops/rowops.test.ts — factory-level guards for filter/map. The row-op
// BEHAVIOR (membership, holes, batch legality) is covered by the kernel M1
// suite and every composition test; this file pins the construction-time
// fail-fasts: v2's non-predicate filter forms died LATE with a bare "pred is
// not a function" on the first write — and stayed SILENT over an empty
// source until a row arrived.

import { test } from 'node:test'
import assert from 'node:assert'
import { Runtime } from '../kernel/runtime.ts'
import { SourceNode } from '../kernel/node.ts'
import { filter, map, rescopeFilter, RescopeFilterNode } from './rowops.ts'
import { sum } from './aggregate.ts'
import { conform } from '../conformance/harness.ts'
import { registry } from './registry.ts'

const same = assert.deepStrictEqual
const ok = assert.ok


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

// ── W10: the re-scopable filter ──────────────────────────────────────────────

test('W10 filter(fn, dep): dep commits re-evaluate the predicate — O(moved) deltas, no teardown', () => {
  const rt = new Runtime()
  const src = new SourceNode<any>(rt, { a: { n: 1 }, b: { n: 2 }, c: { n: 3 } })
  // External state a closure reads — the fero owner-scoping shape.
  const owner = new Map([['a', 'me'], ['b', 'other'], ['c', 'me']])
  const epoch = new SourceNode<any>(rt, { e: { v: 0 } }) // the explicit dep/trigger
  const mine = rescopeFilter(src, (_r: any, k: any) => owner.get(String(k)) === 'me', epoch)
  conform(mine)
  const batches: any[] = []
  mine.connect({ wantsOrder: false, origin: null, apply: (b: any) => batches.push(b) })

  same([...mine.snapshot().keys()].sort(), ['a', 'c'])

  // A rebind: ownership flips externally, ONE dep write re-scopes.
  owner.set('a', 'other')
  owner.set('b', 'me')
  epoch.write('e', ['v'], 1)
  same(batches.length, 1)
  const ops = batches[0].rows.map((d: any) => `${d.op}:${d.key}`).sort()
  same(ops, ['add:b', 'remove:a']) // O(moved), not a rebuild; c untouched — no phantom
  same([...mine.snapshot().keys()].sort(), ['b', 'c'])

  // Source-only commits keep the ordinary per-delta path.
  src.write('d', [], { n: 4 })
  same(batches.length, 1) // d is not mine — nothing emitted
  owner.set('d', 'me')
  epoch.write('e', ['v'], 2)
  same(batches[1].rows.map((d: any) => `${d.op}:${d.key}`), ['add:d'])

  // Same-commit src + dep: exactly one delta per key (clause 8).
  owner.set('c', 'other')
  rt.batch(() => {
    src.write('c', ['n'], 30) // src update on a row that ALSO rescopes out
    epoch.write('e', ['v'], 3)
  })
  const last = batches[batches.length - 1]
  same(last.rows.filter((d: any) => d.key === 'c').length, 1)
  same(last.rows.find((d: any) => d.key === 'c').op, 'remove')
})

test('W10: downstream aggregates ride a rescope consistently; registry routes filter(fn, dep)', () => {
  const rt = new Runtime()
  const src = new SourceNode<any>(rt, { a: { n: 1 }, b: { n: 2 }, c: { n: 3 } })
  const allowed = new Set(['a', 'b', 'c'])
  const epoch = new SourceNode<any>(rt, { e: { v: 0 } })
  const mine = rescopeFilter(src, (_r: any, k: any) => allowed.has(String(k)), epoch)
  const total = sum(mine, 'n')
  same((total as any).value(), 6)
  allowed.delete('b')
  epoch.write('e', ['v'], 1)
  same((total as any).value(), 4) // the chain re-scoped without reconstruction
  same(registry.get('filter')!.create(src, (r: any) => r.n > 0, epoch) instanceof RescopeFilterNode, true)
  assert.throws(() => rescopeFilter(src, () => true, {} as any), /explicit re-scope subscription/)
})
