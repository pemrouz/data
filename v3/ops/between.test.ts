// v3/ops/between.test.ts — between(col, [lo, hi]) conformance suite.
//
// Every collection node is wrapped with conform() at creation (legality +
// replay on every commit); oracle equality (naive range filter over the
// parent) is asserted after every mutation step, including a seeded
// pseudo-random churn loop (LCG, no Math.random) mixing writes, batches and
// setBounds brush steps, for object-born AND array-born sources, chained
// downstream and upstream of filter().

import { test } from 'node:test'
import assert from 'node:assert'
import { Runtime } from '../kernel/runtime.ts'
import { SourceNode, DataNode } from '../kernel/node.ts'
import { between, BetweenNode } from './between.ts'
import { filter } from './rowops.ts'
import { conform, assertOracle } from '../conformance/harness.ts'
import { registry } from './registry.ts'
import type { CommitBatch, RowKey, RowDelta } from '../contract/delta.ts'

const same = assert.deepStrictEqual
const ok = assert.ok

type Row = { val: number; tag: string; meta?: { note: number } }

// Naive independent oracle: rows of `parent` whose col is within the node's
// CURRENT bounds (inclusive both ends) — recomputed from scratch every call.
function rangeOracle<T>(parent: DataNode<T>, node: BetweenNode<T>, col: string) {
  return () => {
    const [lo, hi] = node.bounds()
    const m = new Map<RowKey, T>()
    for (const [k, row] of parent.snapshot()) {
      const x = (row as any)?.[col]
      // null/undefined are never in range (the documented contract — matching
      // the aggregate family's projection normalization); NaN fails naturally.
      if (x != null && x >= lo && x <= hi) m.set(k, row)
    }
    return m
  }
}

const mkRows = (): Record<string, Row> => ({
  a: { val: 10, tag: 'keep' },
  b: { val: 25, tag: 'keep' },
  c: { val: 50, tag: 'keep' },
  d: { val: 75, tag: 'keep' },
  e: { val: 90, tag: 'keep' },
})

// Deterministic LCG (numerical-recipes constants) — no Math.random anywhere.
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

test('object source: construction membership, writes across bounds, oracle at every step', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, mkRows())
  const bt = between(src, 'val', [20, 60])
  conform(src)
  conform(bt)
  const oracle = rangeOracle(src, bt, 'val')

  same([...bt.snapshot().keys()].sort(), ['b', 'c'])
  assertOracle(bt, oracle)

  src.write('a', ['val'], 30) // enters
  same(bt.snapshot().has('a'), true)
  assertOracle(bt, oracle)

  src.write('b', ['val'], 99) // leaves
  same(bt.snapshot().has('b'), false)
  assertOracle(bt, oracle)

  src.write('c', ['tag'], 'edit') // non-col update on in-range row — forwarded
  same(bt.snapshot().get('c')!.tag, 'edit')
  assertOracle(bt, oracle)

  src.write('e', ['tag'], 'edit') // non-col update on out-of-range row — dropped
  same(bt.snapshot().has('e'), false)
  assertOracle(bt, oracle)

  src.write('f', [], { val: 45, tag: 'new' }) // add in range
  same(bt.snapshot().has('f'), true)
  assertOracle(bt, oracle)

  src.write('g', [], { val: 5, tag: 'new' }) // add out of range
  same(bt.snapshot().has('g'), false)
  assertOracle(bt, oracle)

  src.remove('c') // remove in-range
  same(bt.snapshot().has('c'), false)
  assertOracle(bt, oracle)

  src.remove('g') // remove out-of-range — silent
  assertOracle(bt, oracle)
  same([...bt.snapshot().keys()].sort(), ['a', 'f'])
})

test('array source: minted keys, insert/remove churn, membership view (no positions)', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, [
    { val: 10, tag: 'x' },
    { val: 30, tag: 'x' },
    { val: 50, tag: 'x' },
    { val: 70, tag: 'x' },
  ])
  const bt = between(src, 'val', [25, 55])
  conform(src)
  conform(bt)
  const oracle = rangeOracle(src, bt, 'val')

  same([...bt.snapshot().keys()].sort(), [1, 2])
  assertOracle(bt, oracle)

  const k = src.insert({ val: 40, tag: 'mid' }, 1) // mid-array insert, in range
  same(bt.snapshot().has(k), true)
  assertOracle(bt, oracle)

  src.insert({ val: 99, tag: 'tail' }) // out of range
  assertOracle(bt, oracle)

  src.remove(1) // remove an in-range row (key 1, val 30)
  same(bt.snapshot().has(1), false)
  assertOracle(bt, oracle)

  src.write(0, ['val'], 26) // key 0 enters
  same(bt.snapshot().has(0), true)
  assertOracle(bt, oracle)

  src.write(2, ['val'], 100) // key 2 leaves
  same(bt.snapshot().has(2), false)
  assertOracle(bt, oracle)
  same([...bt.snapshot().keys()].sort(), [0, 4])
})

test('brush sweeps: widen, narrow, disjoint jump, point range, full domain — oracle each step', () => {
  const rt = new Runtime()
  const init: Record<string, Row> = {}
  for (let i = 0; i < 100; i++) init[`k${i}`] = { val: i, tag: 't' }
  const src = new SourceNode<Row>(rt, init)
  const bt = between(src, 'val', [10, 20])
  conform(src)
  conform(bt)
  const oracle = rangeOracle(src, bt, 'val')
  same(bt.snapshot().size, 11)

  bt.setBounds([5, 30]) // widen both
  same(bt.snapshot().size, 26)
  assertOracle(bt, oracle)

  bt.setBounds([8, 25]) // narrow both
  same(bt.snapshot().size, 18)
  assertOracle(bt, oracle)

  bt.setBounds([60, 80]) // disjoint jump (lo sweeps past old hi)
  same(bt.snapshot().size, 21)
  assertOracle(bt, oracle)

  bt.setBounds([1, 3]) // disjoint jump the other way (hi sweeps past old lo)
  same(bt.snapshot().size, 3)
  assertOracle(bt, oracle)

  bt.setBounds([42, 42]) // point range — inclusive both ends, keeps col === 42
  same([...bt.snapshot().keys()], ['k42'])
  assertOracle(bt, oracle)

  bt.setBounds([41.5, 41.7]) // empty range between values
  same(bt.snapshot().size, 0)
  assertOracle(bt, oracle)

  bt.setBounds([-Infinity, Infinity]) // full domain
  same(bt.snapshot().size, 100)
  assertOracle(bt, oracle)

  bt.setBounds([90, 95]) // narrow back down from full domain
  same(bt.snapshot().size, 6)
  assertOracle(bt, oracle)
})

test('crossed bounds normalize: setBounds([80, 20]) ≡ setBounds([20, 80]) (documented contract)', () => {
  const rt = new Runtime()
  const init: Record<string, Row> = {}
  for (let i = 0; i < 100; i++) init[`k${i}`] = { val: i, tag: 't' }
  const src = new SourceNode<Row>(rt, init)
  const bt = between(src, 'val', [0, 10])
  conform(bt)
  const oracle = rangeOracle(src, bt, 'val')

  bt.setBounds([80, 20])
  same(bt.bounds(), [20, 80])
  same(bt.snapshot().size, 61)
  assertOracle(bt, oracle)

  // constructor normalizes too
  const bt2 = between(src, 'val', [90, 30])
  conform(bt2)
  same(bt2.bounds(), [30, 90])
  same(bt2.snapshot().size, 61)
  assertOracle(bt2, rangeOracle(src, bt2, 'val'))
})

test('nested path updates: col leaf moves rows across bounds; non-col nested edits forward with path', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, {
    a: { val: 30, tag: 't', meta: { note: 0 } },
    b: { val: 90, tag: 't', meta: { note: 0 } },
  })
  const bt = between(src, 'val', [20, 60])
  conform(src)
  conform(bt)
  const oracle = rangeOracle(src, bt, 'val')
  const batches: CommitBatch<Row>[] = []
  bt.connect({ wantsOrder: false, origin: null, apply: (b: CommitBatch<Row>) => batches.push(b) })

  src.write('a', ['meta', 'note'], 7) // nested non-col edit, in range → forwarded update with path
  assertOracle(bt, oracle)
  same(batches.length, 1)
  const d0 = batches[0].rows[0]
  ok(d0.op === 'update' && d0.path.length === 2 && d0.path[0] === 'meta' && d0.path[1] === 'note')
  same((d0 as any).prev.meta.note, 0)
  same((d0 as any).row.meta.note, 7)

  src.write('b', ['meta', 'note'], 9) // nested edit on out-of-range row → dropped entirely
  assertOracle(bt, oracle)
  same(batches.length, 1)

  src.write('b', ['val'], 55) // col edit moves b in → add
  assertOracle(bt, oracle)
  same(batches.length, 2)
  const d1 = batches[1].rows[0]
  ok(d1.op === 'add' && (d1 as any).row.meta.note === 9)

  src.write('a', ['val'], 61) // col edit moves a out → remove with prev as the view knew it
  assertOracle(bt, oracle)
  const d2 = batches[2].rows[0]
  ok(d2.op === 'remove')
  same((d2 as any).prev, { val: 30, tag: 't', meta: { note: 7 } })
})

test('batch(): mixed writes + setBounds consolidate into ONE batch, ≤1 delta per key', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, mkRows()) // vals 10,25,50,75,90; bounds [20,60] → b,c
  const bt = between(src, 'val', [20, 60])
  conform(src)
  conform(bt)
  const oracle = rangeOracle(src, bt, 'val')
  const batches: CommitBatch<Row>[] = []
  bt.connect({ wantsOrder: false, origin: null, apply: (b: CommitBatch<Row>) => batches.push(b) })

  rt.batch(() => {
    src.write('a', ['val'], 40) // enters old AND new bounds
    src.write('b', ['val'], 5) // leaves old bounds... and stays out of new
    src.write('c', ['val'], 65) // leaves old bounds but new bounds catch it → net update
    src.write('n1', [], { val: 70, tag: 'new' }) // add: out of old, in new
    bt.setBounds([35, 80]) // brush in the same batch
  })
  same(batches.length, 1)
  assertOracle(bt, oracle)
  same([...bt.snapshot().keys()].sort(), ['a', 'c', 'd', 'n1'])

  const byKey = new Map(batches[0].rows.map((d) => [d.key, d]))
  same(byKey.size, batches[0].rows.length) // ≤1 delta per key
  ok(byKey.get('a')!.op === 'add')
  ok(byKey.get('b')!.op === 'remove')
  const c = byKey.get('c')! as any
  ok(c.op === 'update' && c.row.val === 65 && c.prev.val === 50) // remove+add merged, pre-batch prev
  ok(byKey.get('n1')!.op === 'add')
  ok(byKey.get('d')!.op === 'add') // 75 pulled in purely by the brush
})

test('mid-batch snapshot: read-your-writes through data writes AND setBounds; no effect fires', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, mkRows())
  const bt = between(src, 'val', [20, 60])
  conform(bt)
  let effects = 0
  bt.connect({ wantsOrder: false, origin: null, apply: () => effects++ })

  rt.batch(() => {
    src.write('a', ['val'], 30)
    same(bt.snapshot().has('a'), true) // derived read consistent mid-batch
    bt.setBounds([0, 15])
    same([...bt.snapshot().keys()], []) // reflects the pending bounds too... a=30 is out
    src.write('e', ['val'], 12)
    same([...bt.snapshot().keys()].sort(), ['e'])
    same(effects, 0)
  })
  same(effects, 1)
  same([...bt.snapshot().keys()], ['e'])
  assertOracle(bt, rangeOracle(src, bt, 'val'))
})

test('brush walk is O(Δ): a small bounds move on a large source emits exactly the crossing rows', () => {
  const rt = new Runtime()
  const init: Record<string, Row> = {}
  for (let i = 0; i < 5000; i++) init[`k${i}`] = { val: i, tag: 't' }
  const src = new SourceNode<Row>(rt, init)
  const bt = between(src, 'val', [1000, 2000])
  conform(bt)
  const counts: number[] = []
  bt.connect({ wantsOrder: false, origin: null, apply: (b: CommitBatch<Row>) => counts.push(b.rows.length) })

  bt.setBounds([1010, 2010]) // 10 leave low (1000..1009), 10 enter high (2001..2010)
  same(counts, [20])
  assertOracle(bt, rangeOracle(src, bt, 'val'))

  bt.setBounds([1009, 2011]) // second small move: 1 re-enters low, 1 enters high (no resort — index quiet)
  same(counts, [20, 2])
  assertOracle(bt, rangeOracle(src, bt, 'val'))

  // a single data tick then a small brush: still only crossing rows, never O(N)
  src.write('k1500', ['val'], 1500.5)
  bt.setBounds([1009, 2012])
  // the data tick emits its own 1-delta batch (forwarded in-range update);
  // the brush then emits exactly the 1 crossing row (2012 enters)
  same(counts, [20, 2, 1, 1])
  assertOracle(bt, rangeOracle(src, bt, 'val'))
})

test('undefined / null / NaN col values: never in range, never break the index or the walk', () => {
  const rt = new Runtime()
  const src = new SourceNode<any>(rt, {
    a: { val: 10, tag: 't' },
    b: { val: undefined, tag: 't' },
    c: { val: null, tag: 't' },
    d: { val: NaN, tag: 't' },
    e: { val: 50, tag: 't' },
  })
  const bt = between(src, 'val', [0, 100])
  conform(src)
  conform(bt)
  const oracle = rangeOracle(src, bt, 'val')
  same([...bt.snapshot().keys()].sort(), ['a', 'e'])
  assertOracle(bt, oracle)

  src.write('a', ['val'], NaN) // leaves via NaN
  same(bt.snapshot().has('a'), false)
  assertOracle(bt, oracle)

  src.write('b', ['val'], 60) // undefined → defined: enters
  same(bt.snapshot().has('b'), true)
  assertOracle(bt, oracle)

  bt.setBounds([40, 70]) // walk over an index that had NaN/null rows excluded
  same([...bt.snapshot().keys()].sort(), ['b', 'e'])
  assertOracle(bt, oracle)

  bt.setBounds([-Infinity, Infinity])
  same([...bt.snapshot().keys()].sort(), ['b', 'e']) // non-comparable rows stay out even at full domain
  assertOracle(bt, oracle)
})

test('chain: filter → between with churn (composition conformance)', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, mkRows())
  const flt = filter(src, (r) => r.tag !== 'x')
  const bt = between(flt, 'val', [20, 60])
  conform(src)
  conform(flt)
  conform(bt)
  const oracle = rangeOracle(flt, bt, 'val')
  same([...bt.snapshot().keys()].sort(), ['b', 'c'])

  src.write('b', ['tag'], 'x') // leaves the FILTER → between sees a remove
  same(bt.snapshot().has('b'), false)
  assertOracle(bt, oracle)

  src.write('b', ['tag'], 'keep') // re-enters the filter → between sees an add
  same(bt.snapshot().has('b'), true)
  assertOracle(bt, oracle)

  src.write('a', ['tag'], 'x') // out-of-range row leaves the filter — silent for between
  assertOracle(bt, oracle)

  bt.setBounds([0, 100]) // brush over the filtered view: 'a' (val 10, tag x) must NOT appear
  same(bt.snapshot().has('a'), false)
  same([...bt.snapshot().keys()].sort(), ['b', 'c', 'd', 'e'])
  assertOracle(bt, oracle)

  rt.batch(() => {
    src.write('a', ['tag'], 'keep') // re-admitted by filter mid-batch
    src.write('c', ['val'], 999) // leaves between's range
    bt.setBounds([5, 80])
  })
  same([...bt.snapshot().keys()].sort(), ['a', 'b', 'd']) // e (val 90) is outside [5, 80]
  assertOracle(bt, oracle)
})

test('chain: between → filter with churn (between as the upstream producer)', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, mkRows())
  const bt = between(src, 'val', [20, 80])
  const flt = filter(bt, (r) => r.val % 2 === 1)
  conform(src)
  conform(bt)
  conform(flt)
  const fltOracle = () => {
    const m = new Map<RowKey, Row>()
    const [lo, hi] = bt.bounds()
    for (const [k, row] of src.snapshot()) if (row.val >= lo && row.val <= hi && row.val % 2 === 1) m.set(k, row)
    return m
  }
  same([...flt.snapshot().keys()].sort(), ['b', 'd']) // 25, 75
  assertOracle(flt, fltOracle)

  bt.setBounds([20, 60]) // brush evicts d from between → filter must see the remove
  same([...flt.snapshot().keys()], ['b'])
  assertOracle(flt, fltOracle)

  src.write('c', ['val'], 51) // becomes odd, in range → appears in the tail
  same([...flt.snapshot().keys()].sort(), ['b', 'c'])
  assertOracle(flt, fltOracle)

  rt.batch(() => {
    src.write('c', ['val'], 52) // even again → leaves the tail (stays in between)
    bt.setBounds([24, 26]) // and the brush narrows to just b
  })
  same([...flt.snapshot().keys()], ['b'])
  same([...bt.snapshot().keys()], ['b'])
  assertOracle(flt, fltOracle)
})

test('remove prev correctness: prev is the row as THIS view last knew it', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { val: 30, tag: 't' } })
  const bt = between(src, 'val', [0, 100])
  conform(bt)
  const removes: RowDelta<Row>[] = []
  bt.connect({
    wantsOrder: false, origin: null,
    apply(b: CommitBatch<Row>) {
      for (const d of b.rows) if (d.op === 'remove') removes.push(d)
    },
  })
  src.write('a', ['tag'], 'edited') // view tracks the update
  src.remove('a')
  same(removes.length, 1)
  same((removes[0] as any).prev, { val: 30, tag: 'edited' })
})

test('registry: between is defined with a static-numeric dedup key', () => {
  const def = registry.get('between')!
  ok(def)
  same(def.kind, 'row')
  same(def.declarative, true)
  same(def.dedupKey!('val', [10, 20]), 'between:val:10:20')
  same(def.dedupKey!('val', [10, 20]), def.dedupKey!('val', [10, 20]))
  same(def.dedupKey!('val', ['a', 'b']), null) // non-numeric bounds never dedup
  same(def.dedupKey!('val', undefined), null)

  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, mkRows())
  const node = def.create(src, 'val', [20, 60]) as BetweenNode<Row>
  conform(node)
  same([...node.snapshot().keys()].sort(), ['b', 'c'])
})

// ── seeded pseudo-random churn (LCG) ─────────────────────────────────────────

test('churn (object-born): 400 seeded steps of writes/batches/brushes through filter → between → filter', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, {})
  const flt = filter(src, (r) => r.tag !== 'x')
  const bt = between(flt, 'val', [20, 60])
  const tail = filter(bt, (r) => r.tag !== 'y')
  conform(src)
  conform(flt)
  conform(bt)
  conform(tail)
  const btOracle = rangeOracle(flt, bt, 'val')
  const tailOracle = () => {
    const m = new Map<RowKey, Row>()
    for (const [k, row] of btOracle()) if (row.tag !== 'y') m.set(k, row)
    return m
  }

  const rnd = lcg(0xdecafbad)
  const tags = ['keep', 'x', 'y', 'z']
  let nextId = 0
  const liveKeys = () => [...src.snapshot().keys()]
  const randKey = () => {
    const ks = liveKeys()
    return ks.length === 0 ? null : ks[(rnd() * ks.length) | 0]
  }
  const mkRow = (): Row => ({
    val: (rnd() * 120 - 10) | 0,
    tag: tags[(rnd() * tags.length) | 0],
    meta: { note: 0 },
  })
  const oneWrite = () => {
    const r = rnd()
    if (r < 0.3 || src.snapshot().size === 0) {
      src.write(`r${nextId++}`, [], mkRow())
    } else if (r < 0.45) {
      const k = randKey()
      if (k !== null) src.remove(k)
    } else if (r < 0.7) {
      const k = randKey()
      if (k !== null) src.write(k, ['val'], (rnd() * 120 - 10) | 0)
    } else if (r < 0.85) {
      const k = randKey()
      if (k !== null) src.write(k, ['tag'], tags[(rnd() * tags.length) | 0])
    } else {
      const k = randKey()
      if (k !== null) src.write(k, ['meta', 'note'], (rnd() * 1000) | 0)
    }
  }
  const randBounds = (): [number, number] => {
    const r = rnd()
    if (r < 0.1) return [-Infinity, Infinity]
    const a = (rnd() * 120 - 10) | 0
    if (r < 0.2) return [a, a] // point range
    const b = (rnd() * 120 - 10) | 0
    return [a, b] // possibly crossed — setBounds normalizes
  }

  for (let step = 0; step < 400; step++) {
    const r = rnd()
    if (r < 0.55) {
      oneWrite()
    } else if (r < 0.75) {
      bt.setBounds(randBounds())
    } else {
      rt.batch(() => {
        const n = 1 + ((rnd() * 4) | 0)
        for (let i = 0; i < n; i++) oneWrite()
        if (rnd() < 0.5) bt.setBounds(randBounds())
      })
    }
    assertOracle(bt, btOracle, `between oracle @ step ${step}`)
    assertOracle(tail, tailOracle, `tail oracle @ step ${step}`)
  }
  ok(src.snapshot().size > 0)
})

test('churn (array-born): 350 seeded steps of inserts/removes/writes/batches/brushes', () => {
  const rt = new Runtime()
  const initial: Row[] = []
  const rnd = lcg(0xbadc0de)
  for (let i = 0; i < 20; i++) initial.push({ val: (rnd() * 100) | 0, tag: 'seed' })
  const src = new SourceNode<Row>(rt, initial)
  const bt = between(src, 'val', [25, 75])
  const tail = filter(bt, (r) => r.val >= 0)
  conform(src)
  conform(bt)
  conform(tail)
  const btOracle = rangeOracle(src, bt, 'val')
  const tailOracle = () => {
    const m = new Map<RowKey, Row>()
    for (const [k, row] of btOracle()) if (row.val >= 0) m.set(k, row)
    return m
  }

  const randKey = () => {
    const ks = [...src.snapshot().keys()]
    return ks.length === 0 ? null : ks[(rnd() * ks.length) | 0]
  }
  const oneWrite = () => {
    const r = rnd()
    if (r < 0.35 || src.snapshot().size === 0) {
      const at = rnd() < 0.5 ? (rnd() * (src.currentOrder()!.length + 1)) | 0 : undefined
      src.insert({ val: (rnd() * 120 - 10) | 0, tag: 'ins' }, at)
    } else if (r < 0.55) {
      const k = randKey()
      if (k !== null) src.remove(k)
    } else if (r < 0.85) {
      const k = randKey()
      if (k !== null) src.write(k, ['val'], (rnd() * 120 - 10) | 0)
    } else {
      const k = randKey()
      if (k !== null) src.write(k, ['tag'], `t${(rnd() * 5) | 0}`)
    }
  }

  for (let step = 0; step < 350; step++) {
    const r = rnd()
    if (r < 0.55) {
      oneWrite()
    } else if (r < 0.75) {
      const a = (rnd() * 120 - 10) | 0
      const b = (rnd() * 120 - 10) | 0
      bt.setBounds(rnd() < 0.1 ? [-Infinity, Infinity] : [a, b])
    } else {
      rt.batch(() => {
        const n = 1 + ((rnd() * 4) | 0)
        for (let i = 0; i < n; i++) oneWrite()
        if (rnd() < 0.5) bt.setBounds([(rnd() * 120 - 10) | 0, (rnd() * 120 - 10) | 0])
      })
    }
    assertOracle(bt, btOracle, `between oracle @ step ${step}`)
    assertOracle(tail, tailOracle, `tail oracle @ step ${step}`)
  }
  ok(src.snapshot().size > 0)
})

test("between fails fast on v2's two-handle bounds tuple (was: silently empty)", () => {
  // [$(lo), $(hi)] isn't a reactive arg (the TUPLE isn't a handle), so it
  // used to fall through to the static path and compare every row against a
  // proxy — an empty view with no error. Handle-shaped elements now throw
  // the migration hint; other junk throws a typed error.
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { val: 5, cat: 'x' } })
  const fakeHandle = { [Symbol.for('data.v3.node')]: src } // handle shape
  assert.throws(() => between(src, 'val', [fakeHandle, fakeHandle] as any), /ONE bounds child/)
  assert.throws(() => between(src, 'val', ['3' as any, 9]), /must be numbers, got string/)
  const ok5 = between(src, 'val', [1, 9]) // runtime unharmed, op still works
  assert.strictEqual(ok5.hasRow('a'), true)
})
