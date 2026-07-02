// v3/ops/reactive.test.ts — the uniform reactive value-slot binder.
//
// Covers: the reactiveArg normalizer (handles, raw nodes, plain values);
// compareR (moving gt threshold re-selects as ONE consolidated batch, oracle
// after every move); orderedR (reactive za window size re-windows in place,
// order script checked); sumR/avgR (reactive column re-aggregates with one
// scalar delta); construction-connect-is-noop; subscription lifetime
// (disposing the operator — directly or via its scope — detaches the param
// subscription); installReactive registry wrapping (reactive args route to
// the R factories, plain args delegate; dedup is by bound-node identity +
// handle key path); mid-batch read-your-writes through reactive params; and
// a 320-step seeded LCG churn mixing data writes with param moves, oracled
// at every step. Every collection node is conform()-wrapped; scalars use
// conformScalar().

import { test } from 'node:test'
import assert from 'node:assert'
import { Runtime } from '../kernel/runtime.ts'
import { SourceNode, DataNode } from '../kernel/node.ts'
import { scope, runInScope } from '../kernel/scope.ts'
import { conform, conformScalar, assertOracle } from '../conformance/harness.ts'
import { registry } from './registry.ts'
import { FilterNode } from './rowops.ts'
import { OrderedView } from './ordered.ts'
import { sum } from './aggregate.ts'
import { BetweenNode } from './between.ts'
import {
  reactiveArg, bindParam, installReactive, normN,
  compareR, orderedR, sumR, avgR,
  CompareRNode, OrderedRNode, SumRNode, AvgRNode,
} from './reactive.ts'
import { $, runtime, batch, node as N, value as V } from '../api/index.ts'
import type { CommitBatch, RowKey } from '../contract/delta.ts'

const same = assert.deepStrictEqual
const ok = assert.ok

installReactive()

type Row = { val: number; qty?: number }

// Deterministic LCG (numerical-recipes constants) — no Math.random anywhere.
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const collect = <T>(n: DataNode<T>): CommitBatch<T>[] => {
  const out: CommitBatch<T>[] = []
  n.connect({ wantsOrder: true, origin: null, apply: (b: CommitBatch<T>) => out.push(b) })
  return out
}

// ── the normalizer ───────────────────────────────────────────────────────────

test('reactiveArg: detects handles (with key-path identity) and raw nodes; plain values pass through', () => {
  const th = $({ v: 42, w: 7 })
  const ra = reactiveArg(th.get('v'))
  ok(ra.isReactive)
  ok(ra.node === (th[N] as DataNode<any>))
  same(ra.current(), 42)
  const ra2 = reactiveArg(th.get('w'))
  ok(ra2.isReactive)
  ok(ra.identity !== ra2.identity) // same node, DIFFERENT key path — never collides
  same(reactiveArg(th.get('v')).identity, ra.identity) // stable identity per (node, path)

  const whole = reactiveArg(th)
  ok(whole.isReactive)
  same(whole.current(), { v: 42, w: 7 })

  const raw = new SourceNode(runtime(), { p: 1 })
  const rr = reactiveArg(raw)
  ok(rr.isReactive && rr.node === raw)
  same(rr.current(), { p: 1 })

  for (const plain of [5, 'col', null, undefined, [10, 20], { a: 1 }, (x: number) => x]) {
    const rp = reactiveArg(plain)
    ok(!rp.isReactive, `plain arg ${String(plain)} must not be reactive`)
    same(rp.current(), plain)
  }
})

// ── compareR ─────────────────────────────────────────────────────────────────

test('compareR: moving gt threshold re-selects — one consolidated batch per move, oracle after each', () => {
  const src = new SourceNode<Row>(runtime(), {
    a: { val: 10 }, b: { val: 25 }, c: { val: 50 }, d: { val: 75 },
  })
  const th = $({ v: 30 })
  const gtN = compareR<Row>(src, 'gt', 'val', th.get('v'))
  conform(src)
  conform(gtN)
  const oracle = () => {
    const t = gtN.threshold() as number
    const m = new Map<RowKey, Row>()
    for (const [k, row] of src.snapshot()) if (row.val > t) m.set(k, row)
    return m
  }
  same([...gtN.snapshot().keys()].sort(), ['c', 'd'])
  assertOracle(gtN, oracle)

  const batches = collect(gtN)
  th.set('v', 20) // b enters
  same(batches.length, 1)
  same(batches[0].rows.length, 1)
  ok(batches[0].rows[0].op === 'add' && batches[0].rows[0].key === 'b')
  assertOracle(gtN, oracle)

  th.set('v', 60) // b and c leave — ONE batch, two removes
  same(batches.length, 2)
  same(batches[1].rows.map((d) => d.op).sort(), ['remove', 'remove'])
  same(batches[1].rows.map((d) => d.key).sort(), ['b', 'c'])
  assertOracle(gtN, oracle)

  th.set('v', 60) // Object.is no-op at the arg source — nothing flows
  same(batches.length, 2)

  src.write('e', [], { val: 99 }) // data path still incremental (delegated to FilterNode)
  same(batches.length, 3)
  ok(batches[2].rows[0].op === 'add' && batches[2].rows[0].key === 'e')
  assertOracle(gtN, oracle)
})

test('compareR: construction-time seed is NOT emitted (construction-connect-is-noop)', () => {
  const src = new SourceNode<Row>(runtime(), { a: { val: 10 }, b: { val: 25 }, c: { val: 50 } })
  const th = $({ v: 30, other: 0 })
  const gtN = compareR<Row>(src, 'gt', 'val', th.get('v'))
  conform(gtN)
  const batches = collect(gtN)
  same(batches.length, 0)
  th.set('other', 99) // arg-source commit on an UNRELATED key: effect fires, leaf unchanged → no-op
  same(batches.length, 0)
  th.set('v', 30) // Object.is-equal write — dropped at the arg source
  same(batches.length, 0)
  th.set('v', 20) // a real move still works after the no-ops
  same(batches.length, 1)
  same([...gtN.snapshot().keys()].sort(), ['b', 'c'])
})

test('compareR: raw scalar DataNode as a live threshold (aggregate-driven bound)', () => {
  const base = new SourceNode<{ val: number }>(runtime(), { x: { val: 20 } })
  const thr = sum(base, 'val') // scalar node — current value 20
  const src = new SourceNode<Row>(runtime(), { a: { val: 10 }, b: { val: 30 }, c: { val: 50 } })
  const gtN = compareR<Row>(src, 'gt', 'val', thr)
  conform(gtN)
  same([...gtN.snapshot().keys()].sort(), ['b', 'c'])
  base.write('x', ['val'], 40) // the aggregate moves → the threshold moves
  same([...gtN.snapshot().keys()], ['c'])
  same(gtN.threshold(), 40)
})

test('compareR: cross-runtime reactive arg throws', () => {
  const src = new SourceNode<Row>(runtime(), { a: { val: 10 } })
  const rt2 = new Runtime()
  const foreign = new SourceNode(rt2, { v: 5 })
  assert.throws(() => compareR<Row>(src, 'gt', 'val', foreign), /different runtime/)
})

// ── orderedR ─────────────────────────────────────────────────────────────────

test('orderedR: reactive window size on za re-windows in place (keyset diff + order script)', () => {
  const src = new SourceNode<Row>(runtime(), {
    a: { val: 10 }, b: { val: 25 }, c: { val: 50 }, d: { val: 75 }, e: { val: 90 },
  })
  const nCfg = $({ n: 2 })
  const win = orderedR<Row>(src, 'val', nCfg.get('n'), 'za')
  conform(src)
  conform(win)
  same([...win.currentOrder()], ['e', 'd'])

  const batches = collect(win)
  nCfg.set('n', 4) // grow: ONE batch admitting c, b at the tail
  same(batches.length, 1)
  same(batches[0].rows.map((d) => d.op), ['add', 'add'])
  same([...win.currentOrder()], ['e', 'd', 'c', 'b'])

  nCfg.set('n', 1) // shrink: ONE batch evicting d, c, b
  same(batches.length, 2)
  same(batches[1].rows.map((d) => d.op).sort(), ['remove', 'remove', 'remove'])
  same([...win.currentOrder()], ['e'])

  src.write('a', ['val'], 100) // data path: a rotates in, e rotates out (n still 1)
  same([...win.currentOrder()], ['a'])

  nCfg.set('n', undefined) // non-numeric → Infinity → unbounded
  same(win.windowSize(), Infinity)
  same([...win.currentOrder()], ['a', 'e', 'd', 'c', 'b'])

  batch(() => {
    src.write('b', ['val'], 95) // re-ranks b
    nCfg.set('n', 2) // and shrink in the same batch()
  })
  same([...win.currentOrder()], ['a', 'b']) // 100, 95
  same([...win.snapshot().keys()].sort(), ['a', 'b'])

  nCfg.set('n', 0) // empty window
  same([...win.currentOrder()], [])
  same(win.snapshot().size, 0)

  nCfg.set('n', '3' as any) // string n coerces (the v2 limit($(n)) lesson)
  same(win.windowSize(), 3)
  same([...win.currentOrder()], ['a', 'b', 'e'])
})

test('orderedR: limit(n) with reactive n over view-arrival order', () => {
  const src = new SourceNode<Row>(runtime(), { a: { val: 3 }, b: { val: 1 }, c: { val: 2 } })
  const nCfg = $({ n: 2 })
  const lim = orderedR<Row>(src, undefined, nCfg.get('n'), 'limit')
  conform(lim)
  same([...lim.currentOrder()], ['a', 'b']) // arrival (source key-insertion) order, not value order
  nCfg.set('n', 3)
  same([...lim.currentOrder()], ['a', 'b', 'c'])
  nCfg.set('n', 1)
  same([...lim.currentOrder()], ['a'])
})

// ── sumR / avgR ──────────────────────────────────────────────────────────────

test('sumR: reactive column re-aggregates — ONE scalar delta per column move', () => {
  const src = new SourceNode<{ x: number; y: number }>(runtime(), {
    a: { x: 1, y: 10 }, b: { x: 2, y: 20 },
  })
  const cfg = $({ c: 'x' })
  const sm = sumR(src, cfg.get('c'))
  conformScalar(sm as any)
  same(sm.value(), 3)

  const batches = collect(sm as unknown as DataNode<never>)
  cfg.set('c', 'y')
  same(batches.length, 1)
  same(batches[0].rows.length, 0)
  same(batches[0].scalar, { prev: 3, next: 30 })
  same(sm.value(), 30)
  same(sm.column(), 'y')

  src.write('a', ['y'], 15) // incremental path stays correct AFTER the rebuild
  same(sm.value(), 35)
  same(batches.length, 2)

  cfg.set('c', 'x') // back — tracked set re-projects
  same(sm.value(), 3)
  src.write('b', ['x'], 7)
  same(sm.value(), 8)
})

test('sumR: a column move that lands on the same total emits NOTHING (state still rebuilt)', () => {
  const src = new SourceNode<{ x: number; y: number }>(runtime(), {
    a: { x: 5, y: 5 }, b: { x: 1, y: 1 },
  })
  const cfg = $({ c: 'x' })
  const sm = sumR(src, cfg.get('c'))
  conformScalar(sm as any)
  const batches = collect(sm as unknown as DataNode<never>)
  cfg.set('c', 'y') // Σx = Σy = 6 → no phantom scalar delta
  same(batches.length, 0)
  same(sm.value(), 6)
  src.write('a', ['y'], 9) // but the projection DID move to y — incremental proof
  same(sm.value(), 10)
  same(batches.length, 1)
})

test('avgR: reactive column, including a column with no comparable values (→ undefined)', () => {
  const src = new SourceNode<{ x: number; y?: number }>(runtime(), {
    a: { x: 1 }, b: { x: 3 },
  })
  const cfg = $({ c: 'x' })
  const av = avgR(src, cfg.get('c'))
  conformScalar(av as any)
  same(av.value(), 2)
  const batches = collect(av as unknown as DataNode<never>)
  cfg.set('c', 'y') // no row has y → empty tracked set → undefined (never NaN)
  same(batches.length, 1)
  same(batches[0].scalar, { prev: 2, next: undefined })
  same(av.value(), undefined)
  cfg.set('c', 'x')
  same(av.value(), 2)
})

// ── subscription lifetime ────────────────────────────────────────────────────

test('lifetime: disposing the operator detaches the param subscription — no further recomputes', () => {
  const src = new SourceNode<Row>(runtime(), { a: { val: 10 }, b: { val: 50 } })
  const th = $({ v: 5 })
  const argNode = th[N] as DataNode<any>
  const before = argNode.effects.length
  const gtN = compareR<Row>(src, 'gt', 'val', th.get('v'))
  same(argNode.effects.length, before + 1)
  same([...gtN.snapshot().keys()].sort(), ['a', 'b'])

  gtN.dispose()
  same(argNode.effects.length, before) // subscription detached with the owner
  ok(gtN.paramSrc.disposed) // the hidden param source is torn down too
  th.set('v', 40) // no error, no recompute — the view is frozen post-dispose
  same(gtN.view.has('a'), true)
})

test('lifetime: scope disposal tears down the operator AND its param subscription', () => {
  const src = new SourceNode<Row>(runtime(), { a: { val: 10 }, b: { val: 50 } })
  const nCfg = $({ n: 1 })
  const argNode = nCfg[N] as DataNode<any>
  const before = argNode.effects.length
  const s = scope(null)
  let win: OrderedRNode<Row>
  runInScope(s, () => {
    win = orderedR<Row>(src, 'val', nCfg.get('n'), 'za')
  })
  same(argNode.effects.length, before + 1)
  same([...win!.currentOrder()], ['b'])
  s.dispose()
  same(argNode.effects.length, before)
  ok(win!.disposed)
  ok(win!.paramSrc.disposed)
  nCfg.set('n', 2) // arg keeps working; nothing downstream recomputes
  same(win!.window.length, 1)
})

// ── installReactive: registry wrapping ───────────────────────────────────────

test('installReactive: reactive args route to R nodes, plain args delegate to the original defs', () => {
  const th = $({ v: 30 })
  const nCfg = $({ n: 2 })
  const src = new SourceNode<Row>(runtime(), { a: { val: 10 }, b: { val: 50 } })

  const rGt = registry.get('gt')!.create(src, 'val', th.get('v'))
  ok(rGt instanceof CompareRNode)
  conform(rGt)
  same([...rGt.snapshot().keys()], ['b'])

  const pGt = registry.get('gt')!.create(src, 'val', 30)
  ok(pGt instanceof FilterNode && !(pGt instanceof CompareRNode))
  same([...pGt.snapshot().keys()], ['b'])

  const rZa = registry.get('za')!.create(src, 'val', nCfg.get('n'))
  ok(rZa instanceof OrderedRNode)
  const pZa = registry.get('za')!.create(src, 'val', 2)
  ok(pZa instanceof OrderedView && !(pZa instanceof OrderedRNode))

  const rTop = registry.get('top')!.create(src, nCfg.get('n'))
  ok(rTop instanceof OrderedRNode)
  const rLim = registry.get('limit')!.create(src, nCfg.get('n'))
  ok(rLim instanceof OrderedRNode)

  const cfg = $({ c: 'val' })
  ok(registry.get('sum')!.create(src, cfg.get('c')) instanceof SumRNode)
  ok(registry.get('avg')!.create(src, cfg.get('c')) instanceof AvgRNode)
  ok(!(registry.get('sum')!.create(src, 'val') instanceof SumRNode))
})

test('installReactive: dedup is by bound-node identity + key path; plain keys delegate; idempotent', () => {
  const th = $({ v: 30, w: 60 })
  const gtDef = registry.get('gt')!
  same(gtDef.dedupKey!('val', 30), 'gt:val:30') // plain → the original static key

  const k1 = gtDef.dedupKey!('val', th.get('v'))
  const k2 = gtDef.dedupKey!('val', th.get('v'))
  same(k1, k2) // identity dedup — same bound source
  ok(typeof k1 === 'string' && (k1 as string).startsWith('gt:val:@'))
  const k3 = gtDef.dedupKey!('val', th.get('w'))
  ok(k1 !== k3) // SAME node, different key path — must not collide

  const other = $({ v: 30 })
  ok(gtDef.dedupKey!('val', other.get('v')) !== k1) // different node — different key

  const zaDef = registry.get('za')!
  same(zaDef.dedupKey!('val', 2), 'za:val:2')
  ok((zaDef.dedupKey!('val', th.get('v')) as string).startsWith('za:val:@'))
  same(zaDef.dedupKey!((a: any, b: any) => 0, th.get('v')), null) // comparator by — never dedup

  const sumDef = registry.get('sum')!
  same(sumDef.dedupKey!('val'), 'sum:val')
  ok((sumDef.dedupKey!(th.get('v')) as string).startsWith('sum:@'))

  const snapshotGt = registry.get('gt')
  installReactive() // second install is a no-op — no double wrapping
  same(registry.get('gt'), snapshotGt)
})

test('handle dispatch end-to-end: h.gt(col, reactiveThreshold) routes, dedups, and updates live', () => {
  const h = $({ a: { val: 10 }, b: { val: 50 } })
  const th = $({ v: 20 })
  const g1 = h.gt('val', th.get('v'))
  const g2 = h.gt('val', th.get('v'))
  ok(g1 === g2) // scope-owned dedup hit by node identity
  ok((g1[N] as any) instanceof CompareRNode)
  conform(g1[N] as DataNode<any>)
  same(Object.keys(g1[V]), ['b'])
  th.set('v', 5)
  same(Object.keys(g1[V]).sort(), ['a', 'b']) // live re-select through the handle
  const g3 = h.gt('val', 20)
  ok(g3 !== g1) // plain arg — different dedup key

  const nCfg = $({ n: 1 })
  const w = h.za('val', nCfg.get('n'))
  ok((w[N] as any) instanceof OrderedRNode)
  same(w[V], [{ val: 50 }]) // ordered views materialize as arrays in rank order
  nCfg.set('n', 2)
  same(w[V], [{ val: 50 }, { val: 10 }])
})

// ── mid-batch read-your-writes ───────────────────────────────────────────────

test('mid-batch: derived reads see the post-write TARGET param; no effect fires until flush', () => {
  const src = new SourceNode<Row>(runtime(), { a: { val: 10 }, b: { val: 40 } })
  const th = $({ v: 20 })
  const nCfg = $({ n: 1 })
  const gtN = compareR<Row>(src, 'gt', 'val', th.get('v'))
  const win = orderedR<Row>(gtN, 'val', nCfg.get('n'), 'za')
  conform(gtN)
  conform(win)
  let effects = 0
  gtN.connect({ wantsOrder: false, origin: null, apply: () => effects++ })

  batch(() => {
    th.set('v', 5)
    same([...gtN.snapshot().keys()].sort(), ['a', 'b']) // target threshold visible mid-batch
    nCfg.set('n', 2)
    same([...win.currentOrder()], ['b', 'a']) // target n visible mid-batch
    same(effects, 0) // no emission from a mid-batch read
  })
  same(effects, 1) // ONE consolidated re-select batch
  same([...gtN.snapshot().keys()].sort(), ['a', 'b'])
  same([...win.currentOrder()], ['b', 'a'])
  assertOracle(gtN, () => {
    const t = gtN.threshold() as number
    const m = new Map<RowKey, Row>()
    for (const [k, row] of src.snapshot()) if (row.val > t) m.set(k, row)
    return m
  })
})

// ── the binder primitive itself ──────────────────────────────────────────────

test('bindParam: plain arg returns as-is with no subscription; reactive returns initial (no seed emission)', () => {
  const src = new SourceNode<Row>(runtime(), { a: { val: 1 } })
  const owner = new SourceNode<Row>(runtime(), {}) // any node works as an owner
  same(bindParam(owner, 42, () => ok(false, 'plain arg must not subscribe')), 42)

  const th = $({ v: 7 })
  const argNode = th[N] as DataNode<any>
  const seen: unknown[] = []
  const init = bindParam(owner, th.get('v'), (v) => seen.push(v))
  same(init, 7)
  same(seen, []) // construction-time seed NOT emitted
  th.set('v', 8)
  same(seen, [8])
  owner.dispose()
  th.set('v', 9)
  same(seen, [8]) // detached with the owner
  same(argNode.effects.length, 0)
  void src
})

// ── seeded churn ─────────────────────────────────────────────────────────────

test('churn: 320 seeded steps mixing data writes, threshold moves, window resizes, column flips', () => {
  type CRow = { val: number; qty: number }
  const src = new SourceNode<CRow>(runtime(), {})
  const cfg = $({ t: 0, n: 3, col: 'qty' })
  const gtN = compareR<CRow>(src, 'gt', 'val', cfg.get('t'))
  const win = orderedR<CRow>(gtN, 'val', cfg.get('n'), 'za')
  const sm = sumR<CRow>(src, cfg.get('col'))
  conform(src)
  conform(gtN)
  conform(win)
  conformScalar(sm as any)

  const rnd = lcg(0xfeedbee5)
  // Unique, dyadic-exact vals: integer part strictly increases (no sort ties);
  // the /1024 fraction is exactly representable so incremental sums are exact.
  let vc = 0
  const uniqueVal = () => {
    vc++
    return vc + (vc % 997) / 1024
  }
  let nextId = 0
  const liveKeys = () => [...src.snapshot().keys()]
  const randKey = () => {
    const ks = liveKeys()
    return ks.length === 0 ? null : ks[(rnd() * ks.length) | 0]
  }
  const oneWrite = () => {
    const r = rnd()
    if (r < 0.4 || src.snapshot().size === 0) {
      src.write(`r${nextId++}`, [], { val: uniqueVal(), qty: (rnd() * 100) | 0 })
    } else if (r < 0.6) {
      const k = randKey()
      if (k !== null) src.remove(k)
    } else if (r < 0.85) {
      const k = randKey()
      if (k !== null) src.write(k, ['val'], uniqueVal())
    } else {
      const k = randKey()
      if (k !== null) src.write(k, ['qty'], (rnd() * 100) | 0)
    }
  }
  const oneParamMove = () => {
    const r = rnd()
    if (r < 0.45) {
      // threshold: a live row's exact val (boundary, strict >) or a random cut
      const k = randKey()
      const t = k !== null && rnd() < 0.5 ? src.snapshot().get(k)!.val : rnd() * vc
      cfg.set('t', t)
    } else if (r < 0.8) {
      cfg.set('n', rnd() < 0.12 ? undefined : (rnd() * 7) | 0) // includes 0 and Infinity
    } else {
      cfg.set('col', (cfg.get('col')[V] as string) === 'qty' ? 'val' : 'qty')
    }
  }

  const gtOracle = () => {
    const t = gtN.threshold() as number
    const m = new Map<RowKey, CRow>()
    for (const [k, row] of src.snapshot()) if (row.val > t) m.set(k, row)
    return m
  }
  const winExpect = () => {
    const t = gtN.threshold() as number
    const entries = [...src.snapshot()].filter(([, r]) => r.val > t)
    entries.sort((a, b) => b[1].val - a[1].val) // vals unique — total order
    const n = win.windowSize()
    const lim = n === Infinity ? entries.length : Math.max(0, Math.min(entries.length, Math.trunc(n)))
    return entries.slice(0, lim)
  }
  const sumExpect = () => {
    const col = sm.column() as 'val' | 'qty'
    let total = 0
    for (const row of src.snapshot().values()) total += row[col]
    return total
  }

  for (let step = 0; step < 320; step++) {
    const r = rnd()
    if (r < 0.5) {
      oneWrite()
    } else if (r < 0.8) {
      oneParamMove()
    } else {
      batch(() => {
        const n = 1 + ((rnd() * 3) | 0)
        for (let i = 0; i < n; i++) oneWrite()
        if (rnd() < 0.6) oneParamMove()
      })
    }
    assertOracle(gtN, gtOracle, `gt oracle @ step ${step}`)
    assertOracle(win, () => new Map(winExpect()), `window oracle @ step ${step}`)
    same([...win.currentOrder()], winExpect().map((e) => e[0]), `window order @ step ${step}`)
    same(sm.value(), sumExpect(), `sum @ step ${step}`)
  }
  ok(src.snapshot().size > 0)
})

// ── betweenR ─────────────────────────────────────────────────────────────────

test('betweenR: reactive bounds through the $ handle — brush walk, oracle, dedup, lifetime', () => {
  const d = $({
    a: { val: 10 }, b: { val: 25 }, c: { val: 50 }, d: { val: 75 }, e: { val: 90 },
  } as Record<string, Row>)
  const filters = $({ r: [] as number[], other: [0, 1] as number[] })
  const dim = d.between('val', filters.get('r'))
  const bn = dim[N] as BetweenNode<Row>
  conform(bn)
  const oracle = () => {
    const m = new Map<RowKey, Row>()
    for (const [k, row] of (d[N] as DataNode<Row>).snapshot())
      if (row.val >= bn.lo && row.val <= bn.hi) m.set(k, row)
    return m
  }
  // [] = unfiltered (±∞) — the v2 empty-filter contract
  same(bn.view.size, 5)
  assertOracle(bn, oracle)

  const batches = collect(bn)
  filters.set('r', [20, 60]) // a, d, e leave — ONE consolidated batch
  same(batches.length, 1)
  same(batches[0].rows.map((x) => x.op).sort(), ['remove', 'remove', 'remove'])
  assertOracle(bn, oracle)

  filters.set('r', [20, 80]) // d re-enters via the walk (only the crossing row)
  same(batches.length, 2)
  same(batches[1].rows.length, 1)
  ok(batches[1].rows[0].op === 'add' && batches[1].rows[0].key === 'd')
  assertOracle(bn, oracle)

  filters.set('other', [5, 6]) // unrelated key: effect fires, leaf unchanged → no-op
  same(batches.length, 2)

  filters.set('r', []) // reset re-opens to ±∞ — a and e re-enter
  same(batches.length, 3)
  same(batches[2].rows.map((x) => x.key).sort(), ['a', 'e'])
  assertOracle(bn, oracle)

  d.get('f').update({ val: 33 }) // the data path stays incremental
  same(batches.length, 4)
  assertOracle(bn, oracle)

  // dedup by bound-node identity + key path — never by current value
  ok(d.between('val', filters.get('r')) === dim)
  ok(d.between('val', filters.get('other')) !== dim)

  // lifetime: disposing the operator detaches the param subscription
  bn.dispose()
  const before = batches.length
  filters.set('r', [0, 1])
  same(batches.length, before)
})

test('betweenR churn: 300 seeded steps mixing writes, removes, and bound moves — oracle every step', () => {
  const d = $({} as Record<string, Row>)
  const filters = $({ r: [] as number[] })
  const dim = d.between('val', filters.get('r'))
  const bn = dim[N] as BetweenNode<Row>
  conform(bn)
  const cnt = dim.length()
  const oracle = () => {
    const m = new Map<RowKey, Row>()
    for (const [k, row] of (d[N] as DataNode<Row>).snapshot())
      if (row.val >= bn.lo && row.val <= bn.hi) m.set(k, row)
    return m
  }
  const rnd = lcg(0xbe7)
  let nextId = 0
  for (let step = 0; step < 300; step++) {
    const r = rnd()
    if (r < 0.45) {
      d.get('k' + nextId++).update({ val: (rnd() * 100) | 0 })
    } else if (r < 0.6 && nextId > 0) {
      d.get('k' + ((rnd() * nextId) | 0)).remove()
    } else if (r < 0.85) {
      const lo = (rnd() * 100) | 0
      const hi = (rnd() * 100) | 0
      filters.set('r', [lo, hi]) // crossed bounds normalize inside setBounds
    } else {
      filters.set('r', [])
    }
    assertOracle(bn, oracle, `between oracle @ step ${step}`)
    same(cnt[V], oracle().size, `count @ step ${step}`)
  }
})
