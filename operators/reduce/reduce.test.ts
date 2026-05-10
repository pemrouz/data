// @ts-nocheck
import { deepStrictEqual as same, strictEqual as eq } from 'node:assert'
import { test } from 'node:test'
import { $, value } from '../../core.ts'
import { reduce } from './index.ts'

test('reduce - sums an array', () => {
  const res = $([1, 2, 3, 4])
  eq(reduce(res, (a, b) => a + b, 0)[value], 10)
})

test('reduce - non-commutative concat respects iteration order', () => {
  const res = $({ a: 'X', b: 'Y', c: 'Z' })
  eq(reduce(res, (acc, v) => acc + v, '')[value], 'XYZ')
})

test('reduce - reactive: insert/remove rebuilds the fold', () => {
  const res = $([1, 2, 3])
  const r = reduce(res, (a, b) => a + b, 0)
  eq(r[value], 6)
  res.insert(4)
  eq(r[value], 10)
  delete res[0]
  eq(r[value], 9)   // 2 + 3 + 4
})

test('reduce - fn receives (acc, row, key)', () => {
  const res = $({ a: 1, b: 2, c: 3 })
  const r = reduce(res, (acc, row, key) => acc + key + row, '')
  eq(r[value], 'a1b2c3')
})

test('reduce - dedup: same fn + init reuse the operator view', () => {
  const res = $([1, 2, 3])
  const fn = (a, b) => a + b
  const r1 = reduce(res, fn, 0)
  const r2 = reduce(res, fn, 0)
  eq(r1[value], r2[value])
})

// `reduce(add, remove, init)` — the incremental arity. The whole point is
// that BI0/BR1 thread through the user's add/remove instead of triggering
// a full rebuild, so the assertions here pin both the *result* (matches
// the equivalent 2-arg reduce) and the *call count* (only the delta rows
// hit the user functions).
test('reduce.incremental - insert calls add only for the inserted row', () => {
  const src = $([10, 20, 30])
  let addCalls = 0, removeCalls = 0
  const r = reduce(src,
    (acc, v) => { addCalls++; return acc + v },
    (acc, v) => { removeCalls++; return acc - v },
    0,
  )
  eq(r[value], 60)
  eq(addCalls, 3)                                // initial rebuild
  src.insert(40)
  eq(r[value], 100)
  eq(addCalls, 4)                                // +1 for the inserted row
  eq(removeCalls, 0)
})

test('reduce.incremental - remove calls remove only for the removed row', () => {
  const src = $({ a: 1, b: 2, c: 3 })
  let addCalls = 0, removeCalls = 0
  const r = reduce(src,
    (acc, v) => { addCalls++; return acc + v },
    (acc, v) => { removeCalls++; return acc - v },
    0,
  )
  eq(r[value], 6)
  delete src.b
  eq(r[value], 4)
  eq(removeCalls, 1)                             // exactly the deleted row
})

test('reduce.incremental - matches equivalent non-incremental reduce on the same source', () => {
  const src = $({ a: 1, b: 2, c: 3 })
  const total = reduce(src, (a, v) => a + v, 0)
  const totalInc = reduce(src,
    (a, v) => a + v,
    (a, v) => a - v,
    0,
  )
  eq(totalInc[value], total[value])
  src.d = 4
  eq(totalInc[value], total[value])
  delete src.a
  eq(totalInc[value], total[value])
})

test('reduce.incremental - thunk init produces a fresh acc on rebuild', () => {
  // Mutation-in-place is the common case for histogram-shaped accs. A
  // thunk init guarantees XU0/XR0 starts from a clean object instead of
  // re-using a polluted one.
  const src = $([])
  let initCalls = 0
  const histogram = reduce(src,
    (acc, row) => { acc[row.b] = (acc[row.b] || 0) + 1; return acc },
    (acc, row) => { if (--acc[row.b] === 0) delete acc[row.b]; return acc },
    () => { initCalls++; return {} },
  )
  eq(initCalls, 1)
  src.insert({ b: 'x' })
  src.insert({ b: 'x' })
  src.insert({ b: 'y' })
  same(histogram[value], { x: 2, y: 1 })
  // Replace the whole source — XU0. Thunk fires again so the new acc
  // doesn't inherit the previous counts.
  src[value] = [{ b: 'z' }]
  eq(initCalls, 2)
  same(histogram[value], { z: 1 })
})

test('reduce.incremental - BU1 falls back to rebuild', () => {
  // BU1 doesn't carry the old value, so the operator can't subtract the
  // prior contribution. Documented fallback — the test pins it.
  const src = $({ a: 1, b: 2 })
  let addCalls = 0
  const r = reduce(src,
    (acc, v) => { addCalls++; return acc + v },
    (acc, v) => acc - v,
    0,
  )
  eq(addCalls, 2)                                // initial rebuild
  src.a = 10                                     // BU1 → full rebuild
  eq(r[value], 12)
  eq(addCalls, 4)                                // both rows re-walked
})

test('reduce.incremental - dedup on (add, remove, init) identity', () => {
  const src = $([1, 2])
  const add = (a, v) => a + v
  const remove = (a, v) => a - v
  const r1 = reduce(src, add, remove, 0)
  const r2 = reduce(src, add, remove, 0)
  eq(r1[value], r2[value])
  // Same operator view: a mutation to one's view.value is observed via both.
  src.insert(3)
  eq(r1[value], 6)
  eq(r2[value], 6)
})
