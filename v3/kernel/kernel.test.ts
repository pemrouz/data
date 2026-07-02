// M1 gate tests: kernel + first operators, every collection node wrapped in
// the conformance kit (legality + replay) on every commit — the inverted
// ordering the v2 audit demanded. Plus the SCHEDULE.md clauses as tests.

import { test } from 'node:test'
import assert from 'node:assert'
import { Runtime } from './runtime.ts'
import { SourceNode, DataNode } from './node.ts'
import { scope, runInScope } from './scope.ts'
import { filter, map, compare } from '../ops/rowops.ts'
import { sum, avg, length, ScalarNode } from '../ops/aggregate.ts'
import { conform, conformScalar } from '../conformance/harness.ts'
import { connectRecords } from '../compat/v2-records.ts'
import type { CommitBatch } from '../contract/delta.ts'

const same = assert.deepStrictEqual

type Row = { region: string; val: number; nested?: { deep: number } }
const rows = (): Record<string, Row> => ({
  a: { region: 'north', val: 10 },
  b: { region: 'south', val: 20 },
  c: { region: 'north', val: 30 },
})

test('source: object writes — add, path update, remove; conformant stream', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  conform(src)
  src.write('d', [], { region: 'east', val: 5 })
  src.write('a', ['val'], 11)
  src.remove('b')
  same(src.snapshot().get('a'), { region: 'north', val: 11 })
  same(src.snapshot().has('b'), false)
  same(src.snapshot().size, 3)
})

test('source: path-copy — oldValue is the untouched previous reference, off-path shares structure', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { region: 'north', val: 1, nested: { deep: 1 } } })
  const before = src.get('a')!
  let seen: { prev: Row; row: Row } | null = null
  src.connect({
    wantsOrder: false,
    origin: null,
    apply(b: CommitBatch<Row>) {
      const d = b.rows[0]
      if (d.op === 'update') seen = { prev: d.prev, row: d.row }
    },
  })
  src.write('a', ['nested', 'deep'], 2)
  assert.ok(seen)
  assert.strictEqual(seen!.prev, before) // oldValue = old reference, zero clones
  assert.strictEqual(seen!.prev.nested!.deep, 1)
  assert.strictEqual(seen!.row.nested!.deep, 2)
  assert.notStrictEqual(seen!.row, seen!.prev)
})

test('source: no-op writes are dropped centrally (no-phantom-events)', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  let batches = 0
  src.connect({ wantsOrder: false, origin: null, apply: () => batches++ })
  src.write('a', ['val'], 10) // unchanged leaf
  src.write('a', [], src.get('a')!) // identical row reference
  same(batches, 0)
})

test('batch consolidation: add+remove annihilate; remove+add → update; update+update merges', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  conform(src)
  const batches: CommitBatch<Row>[] = []
  src.connect({ wantsOrder: false, origin: null, apply: (b: CommitBatch<Row>) => batches.push(b) })

  rt.batch(() => {
    src.write('x', [], { region: 'west', val: 1 })
    src.remove('x') // annihilate
    const prevA = src.get('a')!
    src.remove('a')
    src.write('a', [], { region: 'north', val: 99 }) // remove+add → update, prev = pre-batch row
    void prevA
    src.write('b', ['val'], 21)
    src.write('b', ['val'], 22) // update+update → one update, first prev
  })
  same(batches.length, 1)
  const byKey = new Map(batches[0].rows.map((d) => [d.key, d]))
  same(byKey.size, 2)
  const a = byKey.get('a')!
  assert.ok(a.op === 'update' && a.row.val === 99 && a.prev.val === 10)
  const b = byKey.get('b')!
  assert.ok(b.op === 'update' && b.row.val === 22 && b.prev.val === 20)
})

test('array source: minted int keys, order channel, v2 positional record projection', () => {
  const rt = new Runtime()
  const src = new SourceNode<number>(rt, [10, 20, 30])
  conform(src)
  same(src.currentOrder(), [0, 1, 2])

  const recs: any[] = []
  connectRecords(src, recs)
  same(recs, [{ type: 'update', key: [], value: [10, 20, 30] }])

  const k = src.insert(15, 1) // mid-insert: NO survivor is touched
  same(k, 3) // fresh key, never reused
  same(src.currentOrder(), [0, 3, 1, 2])
  same(recs[1], { type: 'insert', key: [], value: 15, at: 1 })

  src.remove(1) // remove the row VALUED 20 (key 1, now at index 2)
  same(recs[2], { type: 'remove', key: ['2'], value: 20 })

  src.write(0, [], 11)
  same(recs[3], { type: 'update', key: ['0'], value: 11 })
})

test('filter: enter/leave/forward classification through updates; conformant', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const north = filter(src, (r) => r.region === 'north')
  conform(north)
  same([...north.snapshot().keys()], ['a', 'c'])

  src.write('b', ['region'], 'north') // enter
  same(north.snapshot().size, 3)
  src.write('a', ['region'], 'west') // leave
  same(north.snapshot().size, 2)
  src.write('c', ['val'], 31) // forward (stays in)
  same(north.snapshot().get('c')!.val, 31)
  src.remove('c')
  same(north.snapshot().size, 1)
})

test('map: prev supplied from cache; equality cut-off suppresses no-ops', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const vals = map(src, (r) => r.val)
  conform(vals)
  same([...vals.snapshot().values()].sort((x, y) => x - y), [10, 20, 30])

  let updates = 0
  vals.connect({
    wantsOrder: false,
    origin: null,
    apply(b: CommitBatch<number>) {
      for (const d of b.rows) if (d.op === 'update') updates++
    },
  })
  src.write('a', ['val'], 99)
  same(updates, 1)
  src.write('a', ['region'], 'east') // val unchanged → mapped value Object.is-equal → cut off
  same(updates, 1)
})

test('compare: gt threshold filter', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const big = compare(src, 'gt', 'val', 15)
  conform(big)
  same([...big.snapshot().keys()].sort(), ['b', 'c'])
  src.write('a', ['val'], 16)
  same(big.snapshot().size, 3)
})

test('aggregates: sum/avg/length with projection exclusion, empty-set semantics, NaN poisoning', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const s = sum(src, 'val')
  const a = avg(src, 'val')
  const n = length(src)
  conformScalar(s)
  conformScalar(a)
  conformScalar(n)
  same(s.value(), 60)
  same(a.value(), 20)
  same(n.value(), 3)

  src.write('a', ['val'], 40) // 60 - 10 + 40
  same(s.value(), 90)
  same(a.value(), 30)

  src.write('d', [], { region: 'x', val: null as any }) // null projection → excluded
  same(s.value(), 90)
  same(a.value(), 30)
  same(n.value(), 4) // length counts rows, not projections

  src.write('a', ['region'], 'east') // field edit: count inert, sum unchanged
  same(n.value(), 4)
  same(s.value(), 90)

  src.remove('b')
  src.remove('c')
  src.remove('a')
  src.remove('d')
  same(s.value(), 0) // empty → 0
  same(a.value(), undefined) // empty → undefined, never NaN
  same(n.value(), 0)

  src.write('z', [], { region: 'q', val: NaN })
  assert.ok(Number.isNaN(s.value() as number)) // NaN poisons (v2 bit-for-bit)
})

test('chain: filter → sum stays consistent through churn (replay-verified)', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const north = filter(src, (r) => r.region === 'north')
  const total = sum(north, 'val')
  conform(north)
  conformScalar(total)
  same(total.value(), 40)

  src.write('b', ['region'], 'north')
  same(total.value(), 60)
  src.write('b', ['val'], 25)
  same(total.value(), 65)
  src.write('b', ['region'], 'south')
  same(total.value(), 40)
  rt.batch(() => {
    src.write('a', ['val'], 100)
    src.remove('c')
    src.write('n1', [], { region: 'north', val: 7 })
  })
  same(total.value(), 107)
})

test('SCHEDULE 2: read-your-writes — source reads mid-batch see post-write; derived reads are consistent (flush-on-read)', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const north = filter(src, (r) => r.region === 'north')
  const total = sum(north, 'val')
  let effects = 0
  north.connect({ wantsOrder: false, origin: null, apply: () => effects++ })

  rt.batch(() => {
    src.write('b', ['region'], 'north')
    same(src.get('b')!.region, 'north') // (a) source read-your-writes
    same(north.snapshot().size, 3) // (b) derived read consistent mid-batch
    same(total.value(), 60)
    same(effects, 0) // ...but NO effect fires mid-batch
  })
  same(effects, 1) // exactly once per commit
})

test('SCHEDULE 4/5: effects run post-settle, exception-isolated into AggregateError; re-entrant writes are next commits FIFO', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const log: string[] = []

  src.connect({
    wantsOrder: false, origin: null,
    apply(b: CommitBatch<Row>) {
      log.push(`A@${b.seq}`)
      if (b.seq === 1) src.write('r1', [], { region: 'r', val: 1 }) // queues as commit 2
    },
  })
  src.connect({
    wantsOrder: false, origin: null,
    apply(b: CommitBatch<Row>) {
      log.push(`B@${b.seq}`)
      if (b.seq === 1) throw new Error('sink B failed')
    },
  })

  assert.throws(
    () => src.write('a', ['val'], 99),
    (e: unknown) =>
      e instanceof AggregateError && e.errors.length === 1 && /sink B failed/.test(String(e.errors[0])),
  )
  // B's throw did not rob A (or B) of commit 2, and the queued write ran FIFO.
  same(log, ['A@1', 'B@1', 'A@2', 'B@2'])
  same(src.get('r1'), { region: 'r', val: 1 })
})

test('SCHEDULE 6: origin tokens — declarative echo suppression', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const mine = Symbol('my-sink')
  let seenOwn = 0
  let seenOther = 0
  src.connect({
    wantsOrder: false, origin: mine,
    apply(b: CommitBatch<Row>) {
      if (b.origin === mine) seenOwn++
      else seenOther++
    },
  })
  src.write('a', ['val'], 1) // default origin → delivered
  rt.withOrigin(mine, () => src.write('a', ['val'], 2)) // own origin → suppressed by runtime
  same(seenOther, 1)
  same(seenOwn, 0)
})

test('scopes: disposing a scope tears down its nodes/subscriptions synchronously', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  let deliveries = 0
  const s = scope(null)
  runInScope(s, () => {
    const north = filter(src, (r) => r.region === 'north')
    north.connect({ wantsOrder: false, origin: null, apply: () => deliveries++ })
  })
  src.write('a', ['val'], 1)
  same(deliveries, 1)
  s.dispose()
  src.write('a', ['val'], 2) // no delivery, no error — deterministic detach
  same(deliveries, 1)
  same(src.children.length, 0) // the filter detached from its parent
})

test('graph reflection: nodes carry id/kind/op/parents; onCommit reports per-node deltas', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const north = filter(src, (r) => r.region === 'north')
  const total = sum(north, 'val')
  const g = rt.graph()
  const byId = new Map(g.map((n) => [n.id, n]))
  same(byId.get(north.id)!.parents, [src.id])
  same(byId.get(total.id)!.parents, [north.id])
  same(byId.get(total.id)!.kind, 'scalar')

  const commits: any[] = []
  rt.onCommit((c) => commits.push(c))
  src.write('a', ['val'], 999)
  same(commits.length, 1)
  assert.ok(commits[0].nodes.length >= 3) // source, filter, sum all emitted
})

test('v2 records: object source — insert/update/remove/nested shapes', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { region: 'north', val: 10, nested: { deep: 1 } } })
  const recs: any[] = []
  connectRecords(src, recs)
  same(recs[0], { type: 'update', key: [], value: { a: { region: 'north', val: 10, nested: { deep: 1 } } } })
  src.write('b', [], { region: 'south', val: 2 })
  same(recs[1], { type: 'insert', key: [], value: { region: 'south', val: 2 }, at: 'b' })
  src.write('a', ['nested', 'deep'], 7)
  same(recs[2], { type: 'update', key: ['a', 'nested', 'deep'], value: 7 })
  src.remove('b')
  same(recs[3], { type: 'remove', key: ['b'], value: { region: 'south', val: 2 } })
})
