// v3/ops/ordered.test.ts — the ORDERED view family under the conformance kit.
// Every collection node is wrapped with conform() (legality + replay on every
// commit); state is additionally asserted against a naive plain-JS oracle.

import { test } from 'node:test'
import assert from 'node:assert'
import { Runtime } from '../kernel/runtime.ts'
import { SourceNode, DataNode } from '../kernel/node.ts'
import { filter } from './rowops.ts'
import { az, za, top, limit, OrderIndex } from './ordered.ts'
import { conform, assertOracle } from '../conformance/harness.ts'
import type { CommitBatch, RowKey } from '../contract/delta.ts'

const same = assert.deepStrictEqual

type Row = { val: number | null | undefined; nested?: { deep: number }; other?: string }
type FRow = { g: string; val: number; meta: { x: number } }

function collect<T>(node: DataNode<T>): CommitBatch<T>[] {
  const batches: CommitBatch<T>[] = []
  node.connect({ wantsOrder: true, origin: null, apply: (b: CommitBatch<T>) => batches.push(b) })
  return batches
}

// ── OrderIndex ────────────────────────────────────────────────────────────────

test('OrderIndex: bisect insertion, rank map repaired from the splice point', () => {
  const vals = new Map<RowKey, number>([['a', 30], ['b', 10], ['c', 20], ['d', 40]])
  const idx = new OrderIndex((x, y) => vals.get(x)! - vals.get(y)!)
  idx.build(['a', 'b', 'c', 'd'])
  same(idx.keys, ['b', 'c', 'a', 'd'])
  const checkRanks = () => {
    same(idx.rank.size, idx.keys.length)
    for (let i = 0; i < idx.keys.length; i++) same(idx.rank.get(idx.keys[i]), i)
  }
  checkRanks()
  vals.set('e', 25)
  same(idx.insert('e'), 2)
  same(idx.keys, ['b', 'c', 'e', 'a', 'd'])
  checkRanks()
  same(idx.remove('b'), 0)
  same(idx.keys, ['c', 'e', 'a', 'd'])
  checkRanks()
  same(idx.rankOf('a'), 2)
  same(idx.rankOf('b'), -1)
  same(idx.remove('b'), -1) // absent key is a no-op
  checkRanks()
})

// ── az / za, object-born ─────────────────────────────────────────────────────

test('az(col) object-born: rank changes, rank-preserving updates, add/remove; conformant', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { val: 30 }, b: { val: 10 }, c: { val: 20 } })
  conform(src)
  const v = az(src, 'val')
  conform(v)
  const batches = collect(v)
  same([...v.currentOrder()], ['b', 'c', 'a'])

  src.write('b', ['val'], 40) // rank change: b → last
  same([...v.currentOrder()], ['c', 'a', 'b'])

  src.write('c', ['val'], 21) // NO rank change: forwarded update, no order delta
  same([...v.currentOrder()], ['c', 'a', 'b'])
  const b1 = batches[batches.length - 1]
  same(b1.rows.length, 1)
  same(b1.rows[0].op, 'update')
  same(b1.order, undefined)

  src.write('d', [], { val: 5 }) // add: bisects to rank 0
  same([...v.currentOrder()], ['d', 'c', 'a', 'b'])
  src.remove('a')
  same([...v.currentOrder()], ['d', 'c', 'b'])
  same([...v.snapshot().keys()], ['d', 'c', 'b']) // snapshot iterates in rank order
  same(v.snapshot().get('c'), { val: 21 })
})

test('unbounded za: in-window rank rotation emits ONE orderMove + the forwarded update', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { val: 50 }, b: { val: 40 }, c: { val: 30 } })
  const v = za(src, 'val')
  conform(v)
  const batches = collect(v)
  same([...v.currentOrder()], ['a', 'b', 'c'])

  src.write('b', ['val'], 60) // b rotates 1 → 0
  same([...v.currentOrder()], ['b', 'a', 'c'])
  const b = batches[batches.length - 1]
  same(b.rows.length, 1)
  same(b.rows[0].op, 'update')
  same(b.rows[0].key, 'b')
  same(b.order, [{ op: 'orderMove', key: 'b', index: 0, from: 1 }])
})

// ── az / za, array-born ──────────────────────────────────────────────────────

test('az(col) array-born: minted keys, mid-insert, update, remove; conformant', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, [{ val: 10 }, { val: 30 }, { val: 20 }]) // keys 0,1,2
  conform(src)
  const v = az(src, 'val')
  conform(v)
  same([...v.currentOrder()], [0, 2, 1])

  const k = src.insert({ val: 15 }, 1) // mid-insert in SOURCE order; sort ranks by value
  same(k, 3)
  same([...v.currentOrder()], [0, 3, 2, 1])

  src.write(2, ['val'], 5)
  same([...v.currentOrder()], [2, 0, 3, 1])
  src.remove(0)
  same([...v.currentOrder()], [2, 3, 1])
})

// ── bounded windows ──────────────────────────────────────────────────────────

test('bounded za(col, 3): boundary rotation both directions — one remove + one add per rotation, coherent order', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, {
    a: { val: 50 }, b: { val: 40 }, c: { val: 30 }, d: { val: 20 }, e: { val: 10 },
  })
  conform(src)
  const v = za(src, 'val', 3)
  conform(v)
  const batches = collect(v)
  same([...v.currentOrder()], ['a', 'b', 'c'])
  same(v.snapshot().size, 3)

  // out → in: d crosses the boundary upward, evicting c
  src.write('d', ['val'], 45)
  same([...v.currentOrder()], ['a', 'd', 'b'])
  let b = batches[batches.length - 1]
  const byOp1 = new Map(b.rows.map((r) => [r.op, r]))
  same(b.rows.length, 2)
  assert.ok(byOp1.get('remove')!.key === 'c')
  same((byOp1.get('remove') as any).prev, { val: 30 }) // prev = the row as THIS view last had it
  assert.ok(byOp1.get('add')!.key === 'd')
  same((byOp1.get('add') as any).row, { val: 45 })

  // in → out: d drops back below the boundary, c re-enters
  src.write('d', ['val'], 5)
  same([...v.currentOrder()], ['a', 'b', 'c'])
  b = batches[batches.length - 1]
  const byOp2 = new Map(b.rows.map((r) => [r.op, r]))
  same(b.rows.length, 2)
  assert.ok(byOp2.get('remove')!.key === 'd')
  same((byOp2.get('remove') as any).prev, { val: 45 }) // pre-batch row, not the new one
  assert.ok(byOp2.get('add')!.key === 'c')

  // in-window row leaves by its own update: prev = its pre-batch row
  src.write('a', ['val'], 1)
  same([...v.currentOrder()], ['b', 'c', 'e'])
  b = batches[batches.length - 1]
  const rem = b.rows.find((r) => r.op === 'remove')!
  same(rem.key, 'a')
  same((rem as any).prev, { val: 50 })

  // removing a windowed row refills from the next rank
  src.remove('b')
  same([...v.currentOrder()], ['c', 'e', 'd'])
})

test('bounded window grows while underfilled, then caps at n', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { val: 2 }, b: { val: 1 } })
  const v = za(src, 'val', 3)
  conform(v)
  same([...v.currentOrder()], ['a', 'b'])
  src.write('c', [], { val: 3 })
  same([...v.currentOrder()], ['c', 'a', 'b'])
  src.write('d', [], { val: 4 }) // window full: d enters, b evicted
  same([...v.currentOrder()], ['d', 'c', 'a'])
  same(v.snapshot().size, 3)
})

// ── top / limit ──────────────────────────────────────────────────────────────

test('top(n): descending over the row value itself, array-born; conformant', () => {
  const rt = new Runtime()
  const src = new SourceNode<number>(rt, [5, 9, 1, 7]) // keys 0..3
  conform(src)
  const t = top(src, 3)
  conform(t)
  same([...t.currentOrder()], [1, 3, 0]) // 9, 7, 5
  src.insert(8) // key 4
  same([...t.currentOrder()], [1, 4, 3]) // 9, 8, 7
  src.write(0, [], 10) // 5 → 10: enters at the top
  same([...t.currentOrder()], [0, 1, 4])
  src.remove(1)
  same([...t.currentOrder()], [0, 4, 3])
  same([...t.snapshot().values()], [10, 8, 7])
})

test('limit(n) object-born: first n keys in source key-insertion order, deterministic; re-added key moves to the end', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, {
    a: { val: 1 }, b: { val: 2 }, c: { val: 3 }, d: { val: 4 },
  })
  conform(src)
  const l = limit(src, 2)
  conform(l)
  same([...l.currentOrder()], ['a', 'b'])

  src.remove('a') // refill from the next insertion-order key
  same([...l.currentOrder()], ['b', 'c'])
  src.write('e', [], { val: 5 }) // window full: no change
  same([...l.currentOrder()], ['b', 'c'])
  src.write('b', ['val'], 99) // update inside the window: content only, no order change
  same([...l.currentOrder()], ['b', 'c'])
  same(l.snapshot().get('b'), { val: 99 })
  src.remove('b')
  same([...l.currentOrder()], ['c', 'd'])
  src.remove('c')
  same([...l.currentOrder()], ['d', 'e'])
  src.write('a', [], { val: 6 }) // re-added: arrives anew, i.e. at the END
  same([...l.currentOrder()], ['d', 'e'])
  src.remove('d')
  same([...l.currentOrder()], ['e', 'a'])
})

// ── determinism rules ────────────────────────────────────────────────────────

test('ties break by key insertion order, stable under value churn (re-ranked update keeps its tie)', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { val: 1 }, b: { val: 1 }, c: { val: 1 } })
  const v = az(src, 'val')
  conform(v)
  same([...v.currentOrder()], ['a', 'b', 'c']) // insertion order

  src.write('b', ['val'], 0)
  same([...v.currentOrder()], ['b', 'a', 'c'])
  src.write('b', ['val'], 1) // back into the tie: b keeps its ORIGINAL tie seq
  same([...v.currentOrder()], ['a', 'b', 'c'])
  src.write('d', [], { val: 1 }) // a new tied key sorts after all existing ties
  same([...v.currentOrder()], ['a', 'b', 'c', 'd'])
})

test('undefined / null / NaN sort keys order LAST in BOTH directions (tie: insertion order)', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, {
    a: { val: undefined }, b: { val: 2 }, c: { val: null }, d: { val: 1 },
  })
  const asc = az(src, 'val')
  const desc = za(src, 'val')
  conform(asc)
  conform(desc)
  same([...asc.currentOrder()], ['d', 'b', 'a', 'c'])
  same([...desc.currentOrder()], ['b', 'd', 'a', 'c'])

  src.write('a', ['val'], 0) // a becomes sortable
  same([...asc.currentOrder()], ['a', 'd', 'b', 'c'])
  same([...desc.currentOrder()], ['b', 'd', 'a', 'c'])

  src.write('d', ['val'], NaN) // d joins the bad set — after c (insertion order among bads)
  same([...asc.currentOrder()], ['a', 'b', 'c', 'd'])
  same([...desc.currentOrder()], ['b', 'a', 'c', 'd'])
})

// ── nested paths + batch() writes ────────────────────────────────────────────

test('nested path update off the sort column: forwarded with its path, no order delta', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, {
    a: { val: 1, nested: { deep: 1 } }, b: { val: 2, nested: { deep: 2 } },
  })
  const v = az(src, 'val')
  conform(v)
  const batches = collect(v)
  src.write('a', ['nested', 'deep'], 9)
  const b = batches[batches.length - 1]
  same(b.rows.length, 1)
  const d = b.rows[0]
  assert.ok(d.op === 'update')
  same(d.path, ['nested', 'deep'])
  same((d.row as Row).nested!.deep, 9)
  same((d.prev as Row).nested!.deep, 1)
  same(b.order, undefined)
})

test('batch(): consolidated multi-key commit (rank moves + add + remove + nested) settles in one legal batch', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, {
    a: { val: 10, nested: { deep: 1 } },
    b: { val: 20, nested: { deep: 2 } },
    c: { val: 30, nested: { deep: 3 } },
  })
  conform(src)
  const v = az(src, 'val')
  conform(v)
  const batches = collect(v)

  rt.batch(() => {
    src.write('a', ['val'], 100) // rank move a → last
    src.write('x', [], { val: 5 }) // add → rank 0
    src.remove('b')
    src.write('c', ['nested', 'deep'], 7) // nested, non-sort-column
    // mid-batch derived reads are consistent (flush-on-read, pure recompute)
    same([...v.currentOrder()], ['x', 'c', 'a'])
    same(v.snapshot().get('a'), { val: 100, nested: { deep: 1 } })
  })
  same([...v.currentOrder()], ['x', 'c', 'a'])
  same(batches.length, 1) // ONE consolidated batch
  same(new Set(batches[0].rows.map((d) => d.key)), new Set(['a', 'x', 'b', 'c']))
  same(v.snapshot().get('c')!.nested!.deep, 7)

  // batch-sound reindex: several sort-column writes in ONE batch (the v2
  // _batchUpdate trap — pair-by-pair bisects against stale ranks mis-order)
  rt.batch(() => {
    src.write('a', ['val'], 1)
    src.write('c', ['val'], 2)
    src.write('x', ['val'], 3)
  })
  same([...v.currentOrder()], ['a', 'c', 'x'])
})

// ── composition: filter → windowed sort ──────────────────────────────────────

test('chain filter → za(col, n): membership flips rotate the window honestly', () => {
  const rt = new Runtime()
  const src = new SourceNode<FRow>(rt, {
    a: { g: 'in', val: 50, meta: { x: 0 } },
    b: { g: 'in', val: 40, meta: { x: 0 } },
    c: { g: 'in', val: 30, meta: { x: 0 } },
    d: { g: 'out', val: 45, meta: { x: 0 } },
    e: { g: 'in', val: 20, meta: { x: 0 } },
  })
  conform(src)
  const north = filter(src, (r) => r.g === 'in')
  conform(north)
  const v = za(north, 'val', 3)
  conform(v)
  same([...v.currentOrder()], ['a', 'b', 'c'])

  src.write('d', ['g'], 'in') // enters the filter → enters the window, evicts c
  same([...v.currentOrder()], ['a', 'd', 'b'])
  src.write('b', ['g'], 'out') // leaves the filter → window refills from c
  same([...v.currentOrder()], ['a', 'd', 'c'])
  src.write('c', ['val'], 60) // in-window rank rotation
  same([...v.currentOrder()], ['c', 'a', 'd'])
  src.remove('a') // removed upstream → refill from e
  same([...v.currentOrder()], ['c', 'd', 'e'])
  src.write('e', ['meta', 'x'], 5) // nested non-sort edit on a windowed row
  same(v.snapshot().get('e')!.meta.x, 5)
  same([...v.currentOrder()], ['c', 'd', 'e'])
})

// ── seeded pseudo-random churn (LCG — no Math.random) ────────────────────────

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

test('LCG churn, object-born: filter → za(val, 8), 400 steps, oracle + conform at every step', () => {
  const rt = new Runtime()
  const rnd = lcg(42)
  let ctr = 0
  const mkVal = () => Math.floor(rnd() * 1000) + ++ctr / 1e6 // unique, interior placements
  const mkRow = (): FRow => ({ g: rnd() < 0.5 ? 'in' : 'out', val: mkVal(), meta: { x: 0 } })

  const seed: Record<string, FRow> = {}
  const live: string[] = []
  let nk = 0
  for (let i = 0; i < 20; i++) {
    const k = `k${nk++}`
    seed[k] = mkRow()
    live.push(k)
  }
  const src = new SourceNode<FRow>(rt, seed)
  const north = filter(src, (r) => r.g === 'in')
  const v = za(north, 'val', 8)
  conform(src)
  conform(north)
  conform(v)

  const pick = () => live[Math.floor(rnd() * live.length)]
  // `flipped` guards a KERNEL consolidation gap, not an ordered-view one: two
  // g-flips on the same key inside one batch() consolidate update+update into
  // an update whose ['g'] leaf is unchanged — a phantom update emitted by the
  // SourceNode itself (fails source legality before our node is even reached).
  const doOne = (c: number, flipped?: Set<string>) => {
    if (live.length === 0) c = 0
    switch (c) {
      case 0: { // add
        const k = `k${nk++}`
        src.write(k, [], mkRow())
        live.push(k)
        break
      }
      case 1: { // remove
        const i = Math.floor(rnd() * live.length)
        src.remove(live[i])
        live.splice(i, 1)
        break
      }
      case 2: // sort-column write
        src.write(pick(), ['val'], mkVal())
        break
      case 3: { // filter-membership flip
        const k = pick()
        if (flipped !== undefined) {
          if (flipped.has(k)) break // avoid the same-leaf self-cancel within one batch
          flipped.add(k)
        }
        src.write(k, ['g'], src.get(k)!.g === 'in' ? 'out' : 'in')
        break
      }
      case 4: // nested non-sort write
        src.write(pick(), ['meta', 'x'], ++ctr)
        break
    }
  }

  const oracle = (): [string, FRow][] => {
    const ent = [...src.snapshot()].filter(([, r]) => r.g === 'in') as [string, FRow][]
    ent.sort((x, y) => y[1].val - x[1].val)
    return ent.slice(0, 8)
  }

  for (let step = 0; step < 400; step++) {
    const c = Math.floor(rnd() * 6)
    if (c === 5) {
      const m = 2 + Math.floor(rnd() * 4)
      const flipped = new Set<string>()
      rt.batch(() => {
        for (let j = 0; j < m; j++) doOne(Math.floor(rnd() * 5), flipped)
      })
    } else {
      doOne(c)
    }
    const exp = oracle()
    same([...v.currentOrder()], exp.map(([k]) => k), `order @ step ${step}`)
    assertOracle(v, () => new Map(exp), `oracle @ step ${step}`)
  }
})

test('LCG churn, array-born: filter → za(val, 6), 300 steps incl. mid-inserts, oracle + conform at every step', () => {
  const rt = new Runtime()
  const rnd = lcg(1337)
  let ctr = 0
  const mkVal = () => Math.floor(rnd() * 500) + ++ctr / 1e6
  const mkRow = (): FRow => ({ g: rnd() < 0.5 ? 'in' : 'out', val: mkVal(), meta: { x: 0 } })

  const seedArr: FRow[] = []
  for (let i = 0; i < 15; i++) seedArr.push(mkRow())
  const src = new SourceNode<FRow>(rt, seedArr)
  const live: RowKey[] = [...src.snapshot().keys()]
  const north = filter(src, (r) => r.g === 'in')
  const v = za(north, 'val', 6)
  conform(src)
  conform(north)
  conform(v)

  const pick = () => live[Math.floor(rnd() * live.length)]
  const doOne = (c: number, flipped?: Set<RowKey>) => {
    if (live.length === 0) c = 0
    switch (c) {
      case 0: { // insert, sometimes mid-array (order channel churn upstream)
        const at = rnd() < 0.5 ? Math.floor(rnd() * (live.length + 1)) : undefined
        live.push(src.insert(mkRow(), at))
        break
      }
      case 1: { // remove
        const i = Math.floor(rnd() * live.length)
        src.remove(live[i])
        live.splice(i, 1)
        break
      }
      case 2:
        src.write(pick(), ['val'], mkVal())
        break
      case 3: { // see the object-born churn: no double-flip per batch (kernel gap)
        const k = pick()
        if (flipped !== undefined) {
          if (flipped.has(k)) break
          flipped.add(k)
        }
        src.write(k, ['g'], src.get(k)!.g === 'in' ? 'out' : 'in')
        break
      }
      case 4:
        src.write(pick(), ['meta', 'x'], ++ctr)
        break
    }
  }

  const oracle = (): [RowKey, FRow][] => {
    const ent = [...src.snapshot()].filter(([, r]) => r.g === 'in')
    ent.sort((x, y) => y[1].val - x[1].val)
    return ent.slice(0, 6)
  }

  for (let step = 0; step < 300; step++) {
    const c = Math.floor(rnd() * 6)
    if (c === 5) {
      const m = 2 + Math.floor(rnd() * 3)
      const flipped = new Set<RowKey>()
      rt.batch(() => {
        for (let j = 0; j < m; j++) doOne(Math.floor(rnd() * 5), flipped)
      })
    } else {
      doOne(c)
    }
    const exp = oracle()
    same([...v.currentOrder()], exp.map(([k]) => k), `order @ step ${step}`)
    assertOracle(v, () => new Map(exp), `oracle @ step ${step}`)
  }
})
