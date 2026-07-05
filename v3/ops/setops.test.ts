// v3/ops/setops.test.ts — set algebra (intersect/union/except) over the key
// domain. Every collection node is wrapped in conform() (legality + replay on
// every commit); every mutation step is oracle-checked against a naive
// plain-JS recompute. The crossfilter shape — setop over filters derived from
// ONE source — is the primary composition under test, over object-born AND
// array-born sources, single writes and batch() writes, nested path updates,
// add/remove churn, and a seeded LCG churn loop.

import { test } from 'node:test'
import assert from 'node:assert'
import { Runtime } from '../kernel/runtime.ts'
import { SourceNode } from '../kernel/node.ts'
import { filter } from './rowops.ts'
import { sum } from './aggregate.ts'
import { intersect, union, except } from './setops.ts'
import { za } from './ordered.ts'
import { conform, conformScalar, assertOracle } from '../conformance/harness.ts'
import type { CommitBatch, RowKey } from '../contract/delta.ts'

const same = assert.deepStrictEqual
const ok = assert.ok

type Row = { val: number; cat: string; nested?: { deep: number } }

const pA = (r: Row) => r.val >= 50
const pB = (r: Row) => r.cat === 'x'

const rows = (): Record<string, Row> => ({
  a: { val: 60, cat: 'x', nested: { deep: 1 } }, // A ∩ B
  b: { val: 70, cat: 'y' }, // A only
  c: { val: 10, cat: 'x' }, // B only
  d: { val: 20, cat: 'z' }, // neither
})

// Oracle: naive recompute over the source snapshot.
const oracle =
  (src: SourceNode<Row>, keep: (r: Row) => boolean) => (): Map<RowKey, Row> => {
    const m = new Map<RowKey, Row>()
    for (const [k, r] of src.snapshot()) if (keep(r)) m.set(k, r)
    return m
  }

// ── the crossfilter shape: setops over filters derived from ONE source ──────

test('intersect: derived filters over one OBJECT source — membership churn, conformant', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const fA = filter(src, pA)
  const fB = filter(src, pB)
  const inter = intersect(fA, fB)
  conform(fA)
  conform(fB)
  conform(inter)
  const orc = oracle(src, (r) => pA(r) && pB(r))
  assertOracle(inter, orc)
  same([...inter.snapshot().keys()], ['a'])

  src.write('b', ['cat'], 'x') // b enters B → enters intersect
  assertOracle(inter, orc)
  same(inter.snapshot().size, 2)

  src.write('a', ['val'], 40) // a leaves A → leaves intersect
  assertOracle(inter, orc)
  same(inter.snapshot().has('a'), false)

  src.write('c', ['val'], 55) // c enters A (already in B) → enters
  assertOracle(inter, orc)
  ok(inter.snapshot().has('c'))

  src.write('c', ['val'], 56) // stays in — forwards as update
  assertOracle(inter, orc)
  same(inter.snapshot().get('c')!.val, 56)

  src.write('e', [], { val: 90, cat: 'x' }) // new row entering both
  assertOracle(inter, orc)
  ok(inter.snapshot().has('e'))

  src.remove('e')
  src.remove('b')
  assertOracle(inter, orc)
  same([...inter.snapshot().keys()], ['c'])
})

test('intersect: derived filters over one ARRAY source — minted keys shared by provenance', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, [
    { val: 60, cat: 'x' }, // key 0: both
    { val: 70, cat: 'y' }, // key 1: A only
    { val: 10, cat: 'x' }, // key 2: B only
  ])
  const fA = filter(src, pA)
  const fB = filter(src, pB)
  const inter = intersect(fA, fB)
  conform(inter)
  const orc = oracle(src, (r) => pA(r) && pB(r))
  assertOracle(inter, orc)
  same([...inter.snapshot().keys()], [0])

  const k = src.insert({ val: 99, cat: 'x' }, 1) // mid-insert: keys are stable, no shift concepts
  assertOracle(inter, orc)
  ok(inter.snapshot().has(k))

  src.write(1, ['cat'], 'x') // key 1 enters B
  assertOracle(inter, orc)
  ok(inter.snapshot().has(1))

  src.remove(0)
  assertOracle(inter, orc)
  same(inter.snapshot().has(0), false)

  src.write(2, ['val'], 80) // key 2 enters A
  src.write(k, ['val'], 5) // k leaves A
  assertOracle(inter, orc)
  same([...inter.snapshot().keys()].sort(), [1, 2])
})

// ── independent OBJECT sources: adopted string keys ARE a shared domain ─────

test('intersect: independent object sources — string keys match; value comes from the PRIMARY; secondary-only updates emit nothing', () => {
  const rt = new Runtime()
  const srcA = new SourceNode<Row>(rt, {
    x: { val: 1, cat: 'a' },
    y: { val: 2, cat: 'a' },
  })
  const srcB = new SourceNode<Row>(rt, {
    y: { val: 200, cat: 'b' }, // divergent view of the same key
    z: { val: 300, cat: 'b' },
  })
  const inter = intersect(srcA, srcB)
  conform(inter)
  same([...inter.snapshot().entries()], [['y', { val: 2, cat: 'a' }]]) // primary's row

  let batches = 0
  inter.connect({ wantsOrder: false, origin: null, apply: () => batches++ })

  srcB.write('y', ['val'], 201) // membership unchanged, value comes from primary → NOTHING
  same(batches, 0)
  same(inter.snapshot().get('y'), { val: 2, cat: 'a' })

  srcA.write('y', ['val'], 3) // primary update forwards
  same(batches, 1)
  same(inter.snapshot().get('y')!.val, 3)

  srcA.write('z', [], { val: 4, cat: 'a' }) // key z now in both → add (primary's row)
  same(batches, 2)
  same(inter.snapshot().get('z'), { val: 4, cat: 'a' })

  srcB.remove('y') // leaves secondary → remove
  same(batches, 3)
  same([...inter.snapshot().keys()], ['z'])
})

test('union: value precedence — primary wins; exposure flips emit updates with the view\'s prev', () => {
  const rt = new Runtime()
  const rowA = { val: 1, cat: 'a' }
  const rowB = { val: 2, cat: 'b' }
  const rowC = { val: 3, cat: 'c' }
  const srcA = new SourceNode<Row>(rt, { k: rowA })
  const srcB = new SourceNode<Row>(rt, { k: rowB, only_b: { val: 20, cat: 'b' } })
  const srcC = new SourceNode<Row>(rt, { k: rowC })
  const u = union(srcA, srcB, srcC)
  conform(u)
  // primary wins the 3-way conflict at k; only_b exposed from srcB
  same(u.snapshot().get('k'), rowA)
  same(u.snapshot().get('only_b'), { val: 20, cat: 'b' })

  const got: CommitBatch<Row>[] = []
  u.connect({ wantsOrder: false, origin: null, apply: (b: CommitBatch<Row>) => got.push(b) })

  srcA.remove('k') // exposure falls through to srcB (next in parent order)
  same(got.length, 1)
  const d1 = got[0].rows[0]
  ok(d1.op === 'update' && d1.prev === rowA && d1.row === rowB)
  same(u.snapshot().get('k'), rowB)

  srcB.write('k', ['val'], 22) // exposing parent updated → union's value changes
  const d2 = got[1].rows[0]
  ok(d2.op === 'update' && d2.prev === rowB && (d2.row as Row).val === 22)

  srcB.remove('k') // falls through to srcC
  const d3 = got[2].rows[0]
  ok(d3.op === 'update' && d3.row === rowC)

  const rowA2 = { val: 9, cat: 'a' }
  srcA.write('k', [], rowA2) // primary regains the key → primary wins again
  const d4 = got[3].rows[0]
  ok(d4.op === 'update' && d4.prev === rowC && d4.row === rowA2)

  srcC.write('k', ['val'], 33) // non-exposing secondary update → NOTHING
  same(got.length, 4)

  srcA.remove('k')
  srcC.remove('k') // last holder gone → remove with the view's prev (rowC post-update)
  const last = got[got.length - 1].rows[0]
  ok(last.op === 'remove' && (last.prev as Row).val === 33)
  same([...u.snapshot().keys()], ['only_b'])
})

test('except: multiple others — any other\'s membership excludes; leaving ALL others re-admits', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const base = filter(src, () => true)
  const exA = filter(src, pA) // excludes val >= 50
  const exB = filter(src, pB) // excludes cat === 'x'
  const e = except(base, exA, exB)
  conform(e)
  const orc = oracle(src, (r) => !pA(r) && !pB(r))
  assertOracle(e, orc)
  same([...e.snapshot().keys()], ['d']) // a: both; b: A; c: B — only d survives

  src.write('b', ['val'], 10) // b leaves exA → re-admitted
  assertOracle(e, orc)
  ok(e.snapshot().has('b'))

  src.write('b', ['cat'], 'x') // b enters exB → excluded again
  assertOracle(e, orc)
  same(e.snapshot().has('b'), false)

  src.write('a', ['val'], 5) // a still in exB (cat x) → stays excluded
  assertOracle(e, orc)
  same(e.snapshot().has('a'), false)

  src.write('a', ['cat'], 'q') // a now in NEITHER other → re-admitted
  assertOracle(e, orc)
  ok(e.snapshot().has('a'))

  src.write('n', [], { val: 1, cat: 'n' })
  src.remove('d')
  assertOracle(e, orc)
})

test('self/duplicate parents: intersect(a, a) ≡ a; except(a, a) is honestly empty; intersect(a, b, b) dedups', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const fA = filter(src, pA)
  const fB = filter(src, pB)

  const selfInter = intersect(fA, fA) // v2 bug: silently empty forever — now ≡ fA
  const selfExcept = except(fA, fA) // in-A AND not-in-A → honestly empty
  const dupInter = intersect(fA, fB, fB) // duplicate secondary collapses
  conform(selfInter)
  conform(selfExcept)
  conform(dupInter)

  assertOracle(selfInter, oracle(src, pA))
  same(selfExcept.snapshot().size, 0)
  assertOracle(dupInter, oracle(src, (r) => pA(r) && pB(r)))

  src.write('d', ['val'], 99)
  src.write('d', ['cat'], 'x')
  src.remove('a')
  src.write('m', [], { val: 77, cat: 'x' })
  assertOracle(selfInter, oracle(src, pA))
  same(selfExcept.snapshot().size, 0) // stays empty through churn
  assertOracle(dupInter, oracle(src, (r) => pA(r) && pB(r)))
})

// ── v2's C14, answered honestly ──────────────────────────────────────────────

test('C14: two INDEPENDENT array-born sources — intersect is EMPTY (honest), not positional aliasing', () => {
  // Each store mints its own numeric keys starting at 0, so both sources
  // carry keys 0,1,2 — the INTEGERS collide but the key DOMAINS are
  // unrelated (key 0 of srcA and key 0 of srcB name different rows in
  // different stores). v2 silently intersected these by position — the
  // WRONG answer. v3's honest answer is the empty set: provenance-disjoint
  // parents never co-match numeric minted keys. (The explicit `on:` join
  // selector — intersect by a column instead of by key — is future work.)
  const rt = new Runtime()
  const srcA = new SourceNode<Row>(rt, [
    { val: 60, cat: 'x' },
    { val: 70, cat: 'y' },
  ])
  const srcB = new SourceNode<Row>(rt, [
    { val: 60, cat: 'x' }, // identical VALUES, colliding key ints — still no match
    { val: 99, cat: 'z' },
  ])
  same(srcA.currentOrder(), [0, 1])
  same(srcB.currentOrder(), [0, 1]) // the collision is real…
  const inter = intersect(srcA, srcB)
  conform(inter)
  same(inter.snapshot().size, 0) // …and the intersect is still, loudly, EMPTY

  // Stays empty under churn from both sides.
  srcA.insert({ val: 1, cat: 'x' })
  srcB.insert({ val: 1, cat: 'x' })
  srcA.write(0, ['val'], 61)
  srcB.remove(1)
  same(inter.snapshot().size, 0)

  // except: an unrelated store's minted keys cannot EXCLUDE yours either —
  // except(A, B-independent) is just A.
  const e = except(srcA, srcB)
  conform(e)
  assertOracle(e, () => srcA.snapshot())
  srcA.insert({ val: 5, cat: 'q' })
  srcB.insert({ val: 5, cat: 'q' })
  assertOracle(e, () => srcA.snapshot())

  // Contrast: derived-from-ONE-array parents share the minted-key domain and
  // intersect fine (the crossfilter shape) — proven in the array test above.
})

// ── path fidelity + batch consolidation ──────────────────────────────────────

test('nested path updates: an in-view forwarded update keeps its path; a deep write to an excluded row emits nothing', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const fA = filter(src, pA)
  const fB = filter(src, pB)
  const inter = intersect(fA, fB)
  conform(inter)

  const got: CommitBatch<Row>[] = []
  inter.connect({ wantsOrder: false, origin: null, apply: (b: CommitBatch<Row>) => got.push(b) })

  src.write('a', ['nested', 'deep'], 7) // 'a' is in view; both parents echo the same path
  same(got.length, 1)
  const d = got[0].rows[0]
  ok(d.op === 'update')
  same(d.path, ['nested', 'deep'])
  same((d as any).prev.nested.deep, 1)
  same((d as any).row.nested.deep, 7)

  src.write('d', ['nested', 'deep'], 9) // 'd' is in NEITHER parent → nothing leaks
  same(got.length, 1)

  src.write('b', ['nested', 'deep'], 3) // 'b' is in A only → not in intersect → nothing
  same(got.length, 1)
})

test('batch(): one consolidated output batch, ≤1 delta per key; add+remove annihilate; mid-batch snapshot is flush-on-read pure', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const fA = filter(src, pA)
  const fB = filter(src, pB)
  const inter = intersect(fA, fB)
  conform(inter)

  const got: CommitBatch<Row>[] = []
  inter.connect({ wantsOrder: false, origin: null, apply: (b: CommitBatch<Row>) => got.push(b) })

  rt.batch(() => {
    src.write('n1', [], { val: 90, cat: 'x' }) // enters both → add
    src.write('a', ['val'], 10) // leaves A → remove
    src.write('tmp', [], { val: 99, cat: 'x' }) // add…
    src.remove('tmp') // …annihilated within the batch
    src.write('c', ['val'], 55) // c enters A (already in B) → add
    src.write('c', ['val'], 56) // …consolidates into the same add
    // mid-batch derived read: consistent (pure recompute), and NO effect fired
    same(got.length, 0)
    const mid = inter.snapshot()
    ok(mid.has('n1') && mid.has('c') && !mid.has('a') && !mid.has('tmp'))
    same(mid.get('c')!.val, 56)
  })

  same(got.length, 1) // exactly one commit
  const byKey = new Map(got[0].rows.map((r) => [r.key, r]))
  same(got[0].rows.length, byKey.size) // ≤1 delta per key
  same(byKey.get('n1')!.op, 'add')
  same(byKey.get('a')!.op, 'remove')
  same(byKey.get('c')!.op, 'add')
  same((byKey.get('c') as any).row.val, 56)
  same(byKey.has('tmp'), false)
})

// ── compositions: setop → sum, filter downstream of setop ────────────────────

test('chain: intersect → sum and intersect → filter stay consistent through churn', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const fA = filter(src, pA)
  const fB = filter(src, pB)
  const inter = intersect(fA, fB)
  const total = sum(inter, 'val')
  const small = filter(inter, (r) => r.val < 90) // filter DOWNSTREAM of the setop
  conform(inter)
  conform(small)
  conformScalar(total)
  const smallOrc = oracle(src, (r) => pA(r) && pB(r) && r.val < 90)

  same(total.value(), 60) // only 'a'
  assertOracle(small, smallOrc)

  src.write('b', ['cat'], 'x') // b (70) enters
  same(total.value(), 130)
  src.write('b', ['val'], 95) // in-place: leaves `small` but stays in inter
  same(total.value(), 155)
  assertOracle(small, smallOrc)
  same(small.snapshot().has('b'), false)

  src.remove('a')
  same(total.value(), 95)
  rt.batch(() => {
    src.write('z1', [], { val: 50, cat: 'x' })
    src.write('z2', [], { val: 51, cat: 'x' })
    src.remove('b')
  })
  same(total.value(), 101)
  assertOracle(small, smallOrc)

  const u = union(fA, fB)
  const uTotal = sum(u, 'val')
  conform(u)
  conformScalar(uTotal)
  src.write('c', ['val'], 55)
  assertOracle(u, oracle(src, (r) => pA(r) || pB(r)))
  let expect = 0
  for (const [, r] of src.snapshot()) if (pA(r) || pB(r)) expect += r.val
  same(uTotal.value(), expect)
})

// ── seeded pseudo-random churn (LCG, deterministic) ──────────────────────────

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s
  }
}

const CATS = ['x', 'y', 'z']

function churnLoop(rt: Runtime, src: SourceNode<Row>, arrayBorn: boolean, seed: number, steps: number): void {
  const fA = filter(src, pA)
  const fB = filter(src, pB)
  const inter = intersect(fA, fB)
  const uni = union(fA, fB)
  const exc = except(fA, fB)
  conform(fA)
  conform(fB)
  conform(inter)
  conform(uni)
  conform(exc)
  const interOrc = oracle(src, (r) => pA(r) && pB(r))
  const uniOrc = oracle(src, (r) => pA(r) || pB(r))
  const excOrc = oracle(src, (r) => pA(r) && !pB(r))

  const rnd = lcg(seed)
  const ri = (n: number) => rnd() % n
  let nextKey = 1000

  const mkRow = (): Row => ({ val: ri(100), cat: CATS[ri(CATS.length)], nested: { deep: ri(10) } })
  const liveKey = (): RowKey | undefined => {
    const keys = [...src.snapshot().keys()]
    return keys.length === 0 ? undefined : keys[ri(keys.length)]
  }
  const oneOp = () => {
    const k = liveKey()
    switch (ri(7)) {
      case 0: // flip A membership via val
        if (k !== undefined) src.write(k, ['val'], ri(100))
        break
      case 1: // flip B membership via cat
        if (k !== undefined) src.write(k, ['cat'], CATS[ri(CATS.length)])
        break
      case 2: // insert
        if (arrayBorn) src.insert(mkRow(), ri(src.snapshot().size + 1))
        else src.write(`k${nextKey++}`, [], mkRow())
        break
      case 3: // remove
        if (k !== undefined && src.snapshot().size > 2) src.remove(k)
        break
      case 4: // nested deep write
        if (k !== undefined) src.write(k, ['nested', 'deep'], ri(1000))
        break
      case 5: // whole-row overwrite
        if (k !== undefined) src.write(k, [], mkRow())
        break
      case 6: // batched multi-write (consolidation under fire)
        rt.batch(() => {
          const n = 2 + ri(3)
          for (let j = 0; j < n; j++) {
            const kk = liveKey()
            if (kk === undefined) continue
            if (ri(2) === 0) src.write(kk, ['val'], ri(100))
            else src.write(kk, ['cat'], CATS[ri(CATS.length)])
          }
          if (ri(3) === 0) {
            if (arrayBorn) src.insert(mkRow())
            else src.write(`k${nextKey++}`, [], mkRow())
          }
        })
        break
    }
  }

  for (let i = 0; i < steps; i++) {
    oneOp()
    // conform() sinks re-verified legality + replay on the commit itself;
    // here we additionally pin each view to the naive oracle.
    assertOracle(inter, interOrc, `intersect step ${i}`)
    assertOracle(uni, uniOrc, `union step ${i}`)
    assertOracle(exc, excOrc, `except step ${i}`)
  }
}

test('seeded churn ≥300 steps: intersect/union/except over derived filters — OBJECT source, conform + oracle every step', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  churnLoop(rt, src, false, 0xdecafbad, 320)
})

test('seeded churn ≥300 steps: intersect/union/except over derived filters — ARRAY source, conform + oracle every step', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, [
    { val: 60, cat: 'x' },
    { val: 70, cat: 'y' },
    { val: 10, cat: 'x' },
    { val: 20, cat: 'z' },
  ])
  churnLoop(rt, src, true, 0xc0ffee42, 320)
})

// ── the hasRow/rowAt protocol (what set-ops now query instead of mirroring) ──

test('hasRow/rowAt: O(1) materialized reads when settled; pure (post-write) mid-batch; window membership on ordered views', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { g: 'x', val: 1 }, b: { g: 'y', val: 2 }, c: { g: 'x', val: 3 } })
  const f = filter(src, (r) => r?.g === 'x') // ?-guard: the test writes an undefined row below
  const i = intersect(src, f)
  conform(i)

  // settled reads
  assert.strictEqual(src.hasRow('a'), true)
  assert.strictEqual(f.hasRow('b'), false)
  assert.strictEqual(f.rowAt('a'), src.rowAt('a')) // same reference exposure
  assert.strictEqual(i.hasRow('c'), true)

  // an undefined-VALUED row is a first-class member: hasRow true, rowAt undefined
  src.write('u', [], undefined as unknown as Row)
  assert.strictEqual(src.hasRow('u'), true)
  assert.strictEqual(src.rowAt('u'), undefined)

  // mid-batch: reads are pure post-write (read-your-writes), not stale views
  rt.batch(() => {
    src.write('b', ['g'], 'x')
    assert.strictEqual(f.hasRow('b'), true) // filter admits b mid-batch
    assert.strictEqual((f.rowAt('b') as Row).g, 'x')
    assert.strictEqual(i.hasRow('b'), true)
  })
  assert.strictEqual(f.hasRow('b'), true) // and after the flush

  // ordered views expose WINDOW membership, not the full row cache
  const w = za(src, 'val', 2) // vals: c=3, b=2, a=1, u=undefined → window [c, b]
  assert.strictEqual(w.hasRow('c'), true)
  assert.strictEqual(w.hasRow('b'), true)
  assert.strictEqual(w.hasRow('a'), false) // ranked, but OUTSIDE the window
  assert.strictEqual(w.hasRow('u'), false)
  assert.strictEqual((w.rowAt('c') as Row).val, 3)
  assert.strictEqual(w.rowAt('a'), undefined) // not exposed by this view
})
