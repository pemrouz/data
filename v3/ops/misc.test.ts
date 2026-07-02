// v3/ops/misc.test.ts — conformance-first tests for the misc family:
// max/min, some/every, reduce (2-arg + 3-arg), distinct, tap, toValue ('to'),
// keysView/valuesView. Every collection node is wrapped with conform() at
// creation, every scalar with conformScalar() — legality + replay are
// asserted on EVERY commit automatically; oracles are asserted per step.

import { test } from 'node:test'
import assert from 'node:assert'
import { Runtime } from '../kernel/runtime.ts'
import { SourceNode } from '../kernel/node.ts'
import type { DataNode } from '../kernel/node.ts'
import type { CommitBatch, RowKey } from '../contract/delta.ts'
import { filter } from './rowops.ts'
import { registry } from './registry.ts'
import { conform, conformScalar, assertOracle } from '../conformance/harness.ts'
import {
  max, min, some, every, reduce, distinct, tap, toValue, keysView, valuesView,
  tapHasParam,
} from './misc.ts'

const same = assert.deepStrictEqual
const ok = assert.ok

type Row = { region: string; val: number; nested: { deep: number } }

const rows = (): Record<string, Row> => ({
  a: { region: 'north', val: 10, nested: { deep: 1 } },
  b: { region: 'south', val: 20, nested: { deep: 2 } },
  c: { region: 'north', val: 30, nested: { deep: 3 } },
})

// Seeded LCG — deterministic pseudo-random churn (no Math.random anywhere).
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const REGIONS = ['north', 'south', 'east', 'west']

// ── independent oracles ──────────────────────────────────────────────────────

const extremumOracle = (snap: Map<RowKey, any>, col: string | undefined, dir: 1 | -1) => {
  let m: any
  for (const row of snap.values()) {
    const x = col === undefined ? row : row?.[col]
    if (x === undefined || x === null) continue
    if (m === undefined || (dir === 1 ? x > m : x < m)) m = x
  }
  return m
}

const distinctOracle = (parent: DataNode<any>, fn: (r: any) => unknown) => (): Map<RowKey, unknown> => {
  const m = new Map<RowKey, unknown>()
  for (const row of parent.snapshot().values()) {
    const v = fn(row)
    const dk = String(v)
    if (!m.has(dk)) m.set(dk, v)
  }
  return m
}

// Bucketed-sum fold used across the reduce tests: region → Σ nested.deep.
const foldAdd = (acc: any, r: Row) => {
  acc[r.region] = (acc[r.region] ?? 0) + r.nested.deep
  return acc
}
const foldRemove = (acc: any, r: Row) => {
  if ((acc[r.region] -= r.nested.deep) === 0) delete acc[r.region]
  return acc
}
const foldOracle = (parent: DataNode<Row>) => () => {
  const acc: Record<string, number> = {}
  for (const r of parent.snapshot().values()) foldAdd(acc, r)
  return acc
}

// ── max / min ────────────────────────────────────────────────────────────────

test('max/min: object source — incremental improve, evict-recompute, projection exclusion, empty → undefined', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const mx = max(src, 'val')
  const mn = min(src, 'val')
  conformScalar(mx)
  conformScalar(mn)
  same(mx.value(), 30)
  same(mn.value(), 10)

  src.write('d', [], { region: 'east', val: 50, nested: { deep: 4 } }) // improving add
  same(mx.value(), 50)
  src.remove('d') // evict the current max → O(n) recompute from tracked
  same(mx.value(), 30)
  src.write('c', ['val'], 5) // update EVICTS max 30 (and improves min)
  same(mx.value(), 20)
  same(mn.value(), 5)
  src.write('a', ['val'], null as any) // null projection → excluded
  same(mx.value(), 20)
  same(mn.value(), 5)
  src.write('b', ['val'], null as any)
  src.write('c', ['val'], null as any)
  same(mx.value(), undefined) // empty projected set → undefined
  same(mn.value(), undefined)
  src.write('a', ['val'], 7) // re-enter from empty
  same(mx.value(), 7)
  same(mn.value(), 7)
})

test('max/min: array source — no-col projection, mid-insert, evict, seeded churn vs oracle', () => {
  const rt = new Runtime()
  const src = new SourceNode<number>(rt, [3, 9, 4])
  const mx = max(src)
  const mn = min(src)
  conformScalar(mx)
  conformScalar(mn)
  same(mx.value(), 9)
  same(mn.value(), 3)

  src.remove(1) // remove the 9 (current max) → recompute
  same(mx.value(), 4)
  src.insert(7, 0) // mid-insert
  same(mx.value(), 7)
  src.write(0, [], 1) // whole-slot overwrite of the 3 → new min
  same(mn.value(), 1)

  const rnd = lcg(7)
  for (let i = 0; i < 150; i++) {
    const keys = [...src.snapshot().keys()]
    const roll = Math.floor(rnd() * 3)
    if (roll === 0 || keys.length === 0) src.insert(Math.floor(rnd() * 100), Math.floor(rnd() * (keys.length + 1)))
    else if (roll === 1) src.remove(keys[Math.floor(rnd() * keys.length)])
    else src.write(keys[Math.floor(rnd() * keys.length)], [], Math.floor(rnd() * 100))
    same(mx.value(), extremumOracle(src.snapshot(), undefined, 1))
    same(mn.value(), extremumOracle(src.snapshot(), undefined, -1))
  }
})

test('max/min: chained downstream of filter, batch() writes, mid-batch flush-on-read', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const north = filter(src, (r) => r.region === 'north')
  conform(north)
  const mx = max(north, 'val')
  conformScalar(mx)
  same(mx.value(), 30)

  src.write('b', ['region'], 'north') // b enters the filter
  same(mx.value(), 30)
  src.write('b', ['val'], 99)
  same(mx.value(), 99)
  src.write('b', ['region'], 'west') // b leaves — evicts the max through the filter
  same(mx.value(), 30)

  rt.batch(() => {
    src.write('c', ['val'], 1) // evict
    src.write('z', [], { region: 'north', val: 55, nested: { deep: 5 } })
    same(mx.value(), 55) // SCHEDULE 2b: derived read consistent mid-batch
  })
  same(mx.value(), 55)
})

// ── some / every ─────────────────────────────────────────────────────────────

test('some/every: object source — transitions and the v2 empty-set contracts (some→false, every→true)', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const s = some(src, (r) => r.val > 25)
  const e = every(src, (r) => r.val > 5)
  conformScalar(s)
  conformScalar(e)
  same(s.value(), true) // c: 30
  same(e.value(), true)

  src.write('c', ['val'], 12) // last >25 row drops
  same(s.value(), false)
  src.write('a', ['val'], 3) // a fails the every predicate
  same(e.value(), false)
  src.write('a', ['val'], 6)
  same(e.value(), true)

  src.remove('a')
  src.remove('b')
  src.remove('c')
  same(s.value(), false) // empty → false
  same(e.value(), true) // empty → true (vacuous truth)

  src.write('x', [], { region: 'east', val: 100, nested: { deep: 1 } })
  same(s.value(), true)
  same(e.value(), true)
})

test('some/every: array source with churn + batch writes; chained after filter', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, [
    { region: 'north', val: 2, nested: { deep: 1 } },
    { region: 'south', val: 4, nested: { deep: 2 } },
  ])
  const north = filter(src, (r) => r.region === 'north')
  const s = some(north, (r) => r.val > 3)
  const e = every(north, (r) => r.val % 2 === 0)
  conformScalar(s)
  conformScalar(e)
  same(s.value(), false)
  same(e.value(), true)

  rt.batch(() => {
    src.insert({ region: 'north', val: 8, nested: { deep: 3 } }, 1) // mid-insert, passes
    src.write(0, ['val'], 5) // key 0 now odd → every false
  })
  same(s.value(), true)
  same(e.value(), false)

  src.remove(0)
  same(e.value(), true)
  src.write(2, ['region'], 'south') // the val-8 row leaves the filter
  same(s.value(), false)
  same(e.value(), true) // filter view empty → vacuous truth

  const rnd = lcg(11)
  for (let i = 0; i < 100; i++) {
    const keys = [...src.snapshot().keys()]
    const roll = Math.floor(rnd() * 3)
    if (roll === 0 || keys.length === 0)
      src.insert(
        { region: REGIONS[Math.floor(rnd() * 4)], val: Math.floor(rnd() * 10), nested: { deep: 1 } },
        Math.floor(rnd() * (keys.length + 1)),
      )
    else if (roll === 1) src.remove(keys[Math.floor(rnd() * keys.length)])
    else src.write(keys[Math.floor(rnd() * keys.length)], ['val'], Math.floor(rnd() * 10))
    const nrows = [...north.snapshot().values()]
    same(s.value(), nrows.some((r) => r.val > 3))
    same(e.value(), nrows.every((r) => r.val % 2 === 0))
  }
})

// ── reduce ───────────────────────────────────────────────────────────────────

test('reduce 2-arg: numeric fold, ordered (array display-order) string fold, mutable-object init cloned per rebuild', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const total = reduce(src, (a: number, r: Row) => a + r.val, 0)
  conformScalar(total)
  same(total.value(), 60)
  src.write('a', ['val'], 40)
  same(total.value(), 90)
  src.remove('b')
  same(total.value(), 70)

  // Non-commutative fold over an ordered source: folds in DISPLAY order.
  const asrc = new SourceNode<number>(rt, [1, 2, 3])
  const joined = reduce(asrc, (a: string, x: number) => a + x, '')
  conformScalar(joined)
  same(joined.value(), '123')
  asrc.insert(9, 1) // mid-insert → display order [1, 9, 2, 3]
  same(joined.value(), '1923')
  asrc.remove(1) // the row valued 2
  same(joined.value(), '193')

  // Mutable {} init: each rebuild starts from a FRESH clone (v2 parity —
  // reusing one init object compounded contributions across rebuilds).
  const byRegion = reduce(src, (acc: any, r: Row) => { acc[r.region] = (acc[r.region] ?? 0) + r.val; return acc }, {})
  conformScalar(byRegion)
  same(byRegion.value(), { north: 70 })
  src.write('b', [], { region: 'south', val: 5, nested: { deep: 2 } })
  same(byRegion.value(), { north: 70, south: 5 })
  src.write('b', ['val'], 6)
  same(byRegion.value(), { north: 70, south: 6 }) // not 11 — fresh clone per rebuild
})

test('reduce: a DataNode init throws with guidance (assertPlainInit ported)', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const other = new SourceNode<number>(rt, [1])
  assert.throws(() => reduce(src, (a: number, r: Row) => a + r.val, other as any), /identity element/)
  assert.throws(
    () => reduce(src, (a: any) => a, (a: any) => a, other as any),
    /identity element/,
  )
})

test('reduce 3-arg: prev-based remove+add on updates (nested paths, region moves, whole-row overwrites) ≡ 2-arg ≡ fresh fold', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const inc = reduce(src, foldAdd, foldRemove, () => ({}))
  const re = reduce(src, foldAdd, {})
  conformScalar(inc)
  conformScalar(re)
  const oracle = foldOracle(src)
  same(inc.value(), { north: 4, south: 2 })
  same(inc.value(), oracle())

  // Nested-path update: prev carries the pre-write row, so remove(prev)
  // subtracts the OLD nested.deep (v2's P3 rebuild fallback, closed).
  src.write('a', ['nested', 'deep'], 9)
  same(inc.value(), oracle())
  same(inc.value(), re.value())

  // Bucket move: region change relocates the row's contribution.
  src.write('a', ['region'], 'south')
  same(inc.value(), { north: 3, south: 11 })
  same(inc.value(), oracle())

  // Whole-row overwrite (path []): prev is the full old row.
  src.write('b', [], { region: 'east', val: 1, nested: { deep: 7 } })
  same(inc.value(), oracle())

  // add / remove churn + batch consolidation (remove+add → update, etc).
  rt.batch(() => {
    src.remove('c')
    src.write('n1', [], { region: 'north', val: 7, nested: { deep: 5 } })
    src.write('a', ['nested', 'deep'], 2)
    same(inc.value(), oracle()) // mid-batch flush-on-read (fresh fold)
  })
  same(inc.value(), oracle())
  same(inc.value(), re.value())

  // Bucket emptied via subtraction-to-zero is deleted, matching the oracle.
  src.remove('b')
  same(inc.value(), oracle())
  ok(!('east' in (inc.value() as any)))
})

test('reduce 3-arg: unchanged fold result emits no scalar delta (deep cut-off on the cloned accumulator)', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const inc = reduce(src, foldAdd, foldRemove, () => ({}))
  conformScalar(inc)
  let emissions = 0
  inc.connect({ wantsOrder: false, origin: null, apply: () => emissions++ })
  src.write('a', ['val'], 999) // val is not read by the fold → acc deep-equal
  same(emissions, 0)
  src.write('a', ['nested', 'deep'], 8) // read by the fold → emits
  same(emissions, 1)
})

// ── distinct ─────────────────────────────────────────────────────────────────

test('distinct: representative determinism — first key in source insertion order; removal promotes the next holder', () => {
  const rt = new Runtime()
  // 1 (number) and '1' (string) share the distinct key String(v) === "1" but
  // are different VALUES — promotion is observable.
  const src = new SourceNode<any>(rt, { a: { v: 1 }, b: { v: '1' }, c: { v: 2 } })
  const d = distinct(src, (r: any) => r.v)
  conform(d)
  same(d.snapshot(), new Map<RowKey, unknown>([['1', 1], ['2', 2]]))

  const batches: CommitBatch<unknown>[] = []
  d.connect({ wantsOrder: false, origin: null, apply: (b: CommitBatch<unknown>) => batches.push(b) })

  src.remove('a') // representative of "1" leaves → promote b (next in source order)
  same(d.snapshot().get('1'), '1')
  same(batches[0].rows, [{ op: 'update', key: '1', row: '1', prev: 1, path: [] }])

  // Re-added key moves to the END of source insertion order — b stays
  // representative, so re-adding a's value emits NOTHING (no phantom update).
  src.write('a', [], { v: 1 })
  same(batches.length, 1)
  same(d.snapshot().get('1'), '1')

  src.remove('b') // promote a again → exposed flips back to the number 1
  same(batches[2 - 1].rows, [{ op: 'update', key: '1', row: 1, prev: '1', path: [] }])

  src.remove('a') // last holder of "1" leaves → remove delta
  same(batches[2].rows, [{ op: 'remove', key: '1', prev: 1 }])
  same(d.snapshot(), new Map<RowKey, unknown>([['2', 2]]))
})

test('distinct: equal-value promotion is silent; projection moves via update; identity fn over array source', () => {
  const rt = new Runtime()
  const src = new SourceNode<any>(rt, { a: { v: 7 }, b: { v: 7 } })
  const d = distinct(src, (r: any) => r.v)
  conform(d)
  const batches: CommitBatch<unknown>[] = []
  d.connect({ wantsOrder: false, origin: null, apply: (b: CommitBatch<unknown>) => batches.push(b) })
  src.remove('a') // promotion between Object.is-equal values → NO emission
  same(batches.length, 0)
  same(d.snapshot(), new Map<RowKey, unknown>([['7', 7]]))

  // Projection move: b's value leaves bucket "7" (emptying it) and lands in "9".
  src.write('b', ['v'], 9)
  same(batches[0].rows.length, 2)
  same(new Map(batches[0].rows.map((r) => [r.key, r.op])), new Map([['7', 'remove'], ['9', 'add']]))
  same(d.snapshot(), new Map<RowKey, unknown>([['9', 9]]))

  // Identity projection over an array-born source.
  const asrc = new SourceNode<number>(rt, [1, 2, 1, 3, 2])
  const di = distinct(asrc)
  conform(di)
  same(di.snapshot(), new Map<RowKey, unknown>([['1', 1], ['2', 2], ['3', 3]]))
  asrc.remove(0) // key 0 held "1"'s representative; key 2 (also 1) promotes — silent
  same(di.snapshot().size, 3)
  asrc.remove(2) // last 1 leaves
  same(di.snapshot(), new Map<RowKey, unknown>([['2', 2], ['3', 3]]))
  asrc.insert(1, 0) // 1 re-enters (mid-insert)
  same(di.snapshot().size, 3)
})

// ── tap ──────────────────────────────────────────────────────────────────────

test('tapHasParam: source-inspecting arity dispatch (v2 port)', () => {
  same(tapHasParam(() => {}), false)
  same(tapHasParam(function () { return 1 }), false)
  same(tapHasParam((x: any) => x), true)
  same(tapHasParam((c = {}) => c), true) // defaulted param reports length 0
  same(tapHasParam(({ type }: any) => type), true) // destructured param reports length 0
  same(tapHasParam('nope' as any), false)
})

test('tap: param fn gets v2-shaped records — object source (initial whole-value, insert/nested update/remove)', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { region: 'north', val: 10, nested: { deep: 1 } } })
  const recs: any[] = []
  const t = tap(src, (r: any) => recs.push(r))
  conform(t)
  same(recs, [{ type: 'update', key: [], value: { a: { region: 'north', val: 10, nested: { deep: 1 } } } }])

  src.write('b', [], { region: 'south', val: 2, nested: { deep: 2 } })
  same(recs[1], { type: 'insert', key: [], value: { region: 'south', val: 2, nested: { deep: 2 } }, at: 'b' })
  src.write('a', ['nested', 'deep'], 7)
  same(recs[2], { type: 'update', key: ['a', 'nested', 'deep'], value: 7 })
  src.remove('b')
  same(recs[3], { type: 'remove', key: ['b'], value: { region: 'south', val: 2, nested: { deep: 2 } } })
  same(recs.length, 4)

  // Records are structuredClone'd — mutating the source later must not
  // retroactively change an already-delivered record.
  const before = JSON.stringify(recs[2])
  src.write('a', ['nested', 'deep'], 99)
  same(JSON.stringify(recs[2]), before)
})

test('tap: param fn over an array source projects positional keys through the order channel', () => {
  const rt = new Runtime()
  const src = new SourceNode<number>(rt, [10, 20, 30])
  const recs: any[] = []
  const t = tap(src, (r: any) => recs.push(r))
  conform(t)
  same(recs[0], { type: 'update', key: [], value: [10, 20, 30] })
  src.insert(15, 1)
  same(recs[1], { type: 'insert', key: [], value: 15, at: 1 })
  src.remove(1) // the row VALUED 20, now at index 2
  same(recs[2], { type: 'remove', key: ['2'], value: 20 })
  src.write(0, [], 11)
  same(recs[3], { type: 'update', key: ['0'], value: 11 })
})

test('tap: bare (parameterless) fn fires once at construction and once per BATCH, not per row', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  let calls = 0
  const t = tap(src, () => calls++)
  conform(t)
  same(calls, 1) // construction (v2 TapBareValue XU0 parity)
  src.write('a', ['val'], 11)
  same(calls, 2)
  rt.batch(() => {
    src.write('a', ['val'], 12)
    src.write('b', ['val'], 21)
    src.write('z', [], { region: 'west', val: 1, nested: { deep: 1 } })
  })
  same(calls, 3) // ONE call for the whole batch
  src.write('a', ['val'], 12) // no-op write → no commit → no call
  same(calls, 3)
})

test('tap: passthrough view — downstream operators see the parent stream unchanged', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const t = tap(src, () => {})
  conform(t)
  const north = filter(t, (r) => r.region === 'north')
  conform(north)
  const mx = max(north, 'val')
  conformScalar(mx)
  same(mx.value(), 30)
  src.write('b', ['region'], 'north')
  same(north.snapshot().size, 3)
  src.write('b', ['val'], 99)
  same(mx.value(), 99)
  src.remove('b')
  same(mx.value(), 30)
  same(t.snapshot(), src.snapshot())
})

// ── toValue ('to') ───────────────────────────────────────────────────────────

test('toValue: whole-value projection with equality cut-off — object and array (display-order) sources', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const keysOf = toValue(src, (v: any) => Object.keys(v).sort().join(','))
  conformScalar(keysOf)
  same(keysOf.value(), 'a,b,c')

  let emissions = 0
  keysOf.connect({ wantsOrder: false, origin: null, apply: () => emissions++ })
  src.write('a', ['val'], 99) // keys unchanged → Object.is cut-off, no emission
  same(emissions, 0)
  src.write('d', [], { region: 'east', val: 1, nested: { deep: 1 } })
  same(emissions, 1)
  same(keysOf.value(), 'a,b,c,d')
  src.remove('b')
  same(keysOf.value(), 'a,c,d')

  const asrc = new SourceNode<number>(rt, [1, 2, 3])
  const joined = toValue(asrc, (a: any) => (a as number[]).join('-'))
  conformScalar(joined)
  same(joined.value(), '1-2-3')
  asrc.insert(9, 1) // dense array materializes in display order
  same(joined.value(), '1-9-2-3')
  rt.batch(() => {
    asrc.remove(0)
    asrc.write(1, [], 20)
    same(joined.value(), '9-20-3') // mid-batch flush-on-read
  })
  same(joined.value(), '9-20-3')
})

// ── keysView / valuesView ────────────────────────────────────────────────────

test('keys/values: object source — incremental adds/removes, update-inert keys, identity values', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const k = keysView(src)
  const v = valuesView(src)
  conform(k)
  conform(v)
  same(k.snapshot(), new Map<RowKey, string>([['a', 'a'], ['b', 'b'], ['c', 'c']]))
  same(v.snapshot(), src.snapshot())

  let keyBatches = 0
  let valBatches = 0
  k.connect({ wantsOrder: false, origin: null, apply: () => keyBatches++ })
  v.connect({ wantsOrder: false, origin: null, apply: () => valBatches++ })

  src.write('a', ['val'], 99) // update: keys are inert, values forward
  same(keyBatches, 0)
  same(valBatches, 1)

  src.write('d', [], { region: 'east', val: 1, nested: { deep: 1 } })
  same(keyBatches, 1)
  same(k.snapshot().get('d'), 'd')
  src.remove('b')
  same(k.snapshot().has('b'), false)
  same(v.snapshot().has('b'), false)

  rt.batch(() => {
    src.write('e', [], { region: 'west', val: 2, nested: { deep: 2 } })
    src.remove('a')
    same(k.snapshot().has('e'), true) // mid-batch recompute
    same(k.snapshot().has('a'), false)
  })
  same([...k.snapshot().keys()].sort(), ['c', 'd', 'e'])
})

test('keys/values: array source — minted int keys stringify; churn stays conformant', () => {
  const rt = new Runtime()
  const src = new SourceNode<number>(rt, [10, 20, 30])
  const k = keysView(src)
  const v = valuesView(src)
  conform(k)
  conform(v)
  same(k.snapshot(), new Map<RowKey, string>([[0, '0'], [1, '1'], [2, '2']]))

  src.insert(15, 1) // fresh key 3, regardless of position
  same(k.snapshot().get(3), '3')
  src.remove(1)
  same(k.snapshot().has(1), false)
  src.write(0, [], 11) // update — keys silent, values forward
  same(v.snapshot().get(0), 11)

  const rnd = lcg(23)
  for (let i = 0; i < 100; i++) {
    const keys = [...src.snapshot().keys()]
    const roll = Math.floor(rnd() * 3)
    if (roll === 0 || keys.length === 0) src.insert(Math.floor(rnd() * 100), Math.floor(rnd() * (keys.length + 1)))
    else if (roll === 1) src.remove(keys[Math.floor(rnd() * keys.length)])
    else src.write(keys[Math.floor(rnd() * keys.length)], [], Math.floor(rnd() * 100))
    same(new Set(k.snapshot().keys()), new Set(src.snapshot().keys()))
    same(v.snapshot(), src.snapshot())
  }
})

// ── seeded churn loops (conform + oracle at EVERY step) ──────────────────────

function churnLoop(kind: 'object' | 'array', seed: number, steps: number) {
  const rt = new Runtime()
  const src =
    kind === 'object'
      ? new SourceNode<Row>(rt, rows())
      : new SourceNode<Row>(rt, Object.values(rows()))
  const even = filter(src, (r) => r.val % 2 === 0) // compositions are where v2 bugs lived
  conform(even)
  const d = distinct(even, (r) => r.region)
  conform(d)
  const inc = reduce(even, foldAdd, foldRemove, () => ({}))
  const re = reduce(even, foldAdd, {})
  conformScalar(inc)
  conformScalar(re)

  const dOracle = distinctOracle(even, (r) => r.region)
  const fOracle = foldOracle(even as DataNode<Row>)

  const rnd = lcg(seed)
  let nk = 0
  const mkRow = (): Row => ({
    region: REGIONS[Math.floor(rnd() * 4)],
    val: Math.floor(rnd() * 10),
    nested: { deep: 1 + Math.floor(rnd() * 9) },
  })
  const step = () => {
    const keys = [...src.snapshot().keys()]
    const pick = () => keys[Math.floor(rnd() * keys.length)]
    const roll = Math.floor(rnd() * 6)
    if (roll === 0 || keys.length === 0) {
      if (kind === 'object') src.write('k' + nk++, [], mkRow())
      else src.insert(mkRow(), Math.floor(rnd() * (keys.length + 1)))
    } else if (roll === 1) src.remove(pick())
    else if (roll === 2) src.write(pick(), ['nested', 'deep'], 1 + Math.floor(rnd() * 9))
    else if (roll === 3) src.write(pick(), ['region'], REGIONS[Math.floor(rnd() * 4)])
    else if (roll === 4) src.write(pick(), ['val'], Math.floor(rnd() * 10))
    else src.write(pick(), [], mkRow()) // whole-row overwrite
  }

  for (let i = 0; i < steps; i++) {
    if (i % 7 === 6) rt.batch(() => { step(); step(); step() })
    else step()
    // conform() / conformScalar() have already legality+replay-checked the
    // commit; now assert against the independent plain-JS oracles.
    assertOracle(d, dOracle, `distinct oracle (${kind} step ${i})`)
    same(inc.value(), fOracle(), `reduce-3arg vs fresh fold (${kind} step ${i})`)
    same(re.value(), fOracle(), `reduce-2arg vs fresh fold (${kind} step ${i})`)
    same(inc.value(), re.value(), `3-arg ≡ 2-arg (${kind} step ${i})`)
  }
}

test('seeded churn: 400 steps object-born — filter → {distinct, reduce-3arg, reduce-2arg}, conform + oracle every step', () => {
  churnLoop('object', 42, 400)
})

test('seeded churn: 400 steps array-born (mid-inserts) — filter → {distinct, reduce-3arg, reduce-2arg}, conform + oracle every step', () => {
  churnLoop('array', 1337, 400)
})

// ── registry ─────────────────────────────────────────────────────────────────

test('registry: all misc operators registered with value-identity dedup keys', () => {
  for (const n of ['max', 'min', 'some', 'every', 'reduce', 'distinct', 'tap', 'to', 'keys', 'values'])
    ok(registry.has(n), `registry has ${n}`)
  same(registry.get('max')!.dedupKey!('val'), 'max:val')
  same(registry.get('min')!.dedupKey!(undefined), 'min:')
  same(registry.get('max')!.dedupKey!({}), null) // non-string col never dedups
  same(registry.get('some')!.dedupKey!(() => 1), null) // fns never dedup
  same(registry.get('reduce')!.dedupKey!((a: any) => a, 0), null)
  same(registry.get('distinct')!.dedupKey!(undefined), 'distinct')
  same(registry.get('distinct')!.dedupKey!(() => 1), null)
  same(registry.get('keys')!.dedupKey!(), 'keys')
  same(registry.get('values')!.dedupKey!(), 'values')
})
