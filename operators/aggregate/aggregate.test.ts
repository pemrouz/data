// @ts-nocheck
import { deepStrictEqual as same, strictEqual as eq } from 'node:assert'
import { test } from 'node:test'
import { $, value } from '../../core.ts'
import { sum, avg, max, min, some, every } from './index.ts'

// SUM ------------------------------------------------------------------

test('sum - array of numbers', () => {
  const res = $([1, 2, 3, 4])
  const s = sum(res)
  eq(s[value], 10)
  res[1] = 20
  eq(s[value], 28)        // 1 + 20 + 3 + 4
  res.insert(5)
  eq(s[value], 33)
  delete res[0]
  eq(s[value], 32)        // 20 + 3 + 4 + 5
})

test('sum - object of numbers', () => {
  const res = $({ a: 1, b: 2, c: 3 })
  eq(sum(res)[value], 6)
})

test('sum - col accessor pulls from row objects', () => {
  const res = $([{ x: 1, y: 10 }, { x: 2, y: 20 }, { x: 3, y: 30 }])
  eq(sum(res, 'x')[value], 6)
  eq(sum(res, 'y')[value], 60)
})

test('sum - col accessor reacts to nested updates', () => {
  const res = $([{ x: 1 }, { x: 2 }])
  const s = sum(res, 'x')
  eq(s[value], 3)
  res[0].x = 10
  eq(s[value], 12)
})

// AVG ------------------------------------------------------------------

test('avg - mean of numbers', () => {
  const res = $([2, 4, 6])
  eq(avg(res)[value], 4)
})

test('avg - empty set returns undefined (not NaN)', () => {
  const res = $([])
  eq(avg(res)[value], undefined)
})

test('avg - col accessor', () => {
  const res = $([{ d: 10 }, { d: 20 }, { d: 30 }])
  eq(avg(res, 'd')[value], 20)
})

test('avg - removing a row updates the mean incrementally', () => {
  const res = $([10, 20, 30])
  const a = avg(res)
  eq(a[value], 20)
  delete res[1]
  eq(a[value], 20)        // (10 + 30) / 2
  delete res[0]
  eq(a[value], 30)
})

// MAX / MIN ------------------------------------------------------------

test('max - tracks maximum across inserts/updates/removes', () => {
  const res = $([3, 1, 4, 1, 5, 9, 2, 6])
  const m = max(res)
  eq(m[value], 9)
  res.insert(100)
  eq(m[value], 100)
  delete res[8]           // remove the 100
  eq(m[value], 9)
  res[5] = 0              // 9 → 0
  eq(m[value], 6)         // new max
})

test('min - tracks minimum across inserts/updates/removes', () => {
  const res = $([3, 1, 4, 1, 5, 9, 2, 6])
  const m = min(res)
  eq(m[value], 1)
  res.insert(-5)
  eq(m[value], -5)
  delete res[8]
  eq(m[value], 1)
  res[1] = 100            // remove a 1; another 1 still at index 3
  eq(m[value], 1)
  res[3] = 100            // remove the other 1
  eq(m[value], 2)
})

test('max - col accessor + Date values (non-numeric comparison)', () => {
  const res = $([
    { date: new Date(2001, 0, 1) },
    { date: new Date(2001, 5, 1) },
    { date: new Date(2001, 2, 1) },
  ])
  const m = max(res, 'date')
  eq(+m[value], +new Date(2001, 5, 1))
})

test('max - empty set returns undefined', () => {
  const res = $([])
  eq(max(res)[value], undefined)
})

// Dedup -----------------------------------------------------------------

test('aggregate - dedup: same args reuse the operator view', () => {
  const res = $([1, 2, 3])
  const s1 = sum(res)
  const s2 = sum(res)
  // Both should be the same operator view (matches() checks col).
  eq(s1[value], s2[value])
  // And mutating the source advances both — proving they share state.
  res.insert(4)
  eq(s1[value], 10)
  eq(s2[value], 10)
})

test('aggregate - dedup: different col → different view', () => {
  const res = $([{ x: 1, y: 10 }, { x: 2, y: 20 }])
  const sx = sum(res, 'x')
  const sy = sum(res, 'y')
  eq(sx[value], 3)
  eq(sy[value], 30)
  // independent — mutating x doesn't change y's sum
  res[0].x = 100
  eq(sx[value], 102)
  eq(sy[value], 30)
})

// SOME / EVERY ---------------------------------------------------------

test('some - true when any row matches', () => {
  const res = $([1, 2, 3])
  const s = some(res, d => d > 5)
  eq(s[value], false)
  res.insert(10)
  eq(s[value], true)
  delete res[3]
  eq(s[value], false)
})

test('some - empty set is false (matches Array#some)', () => {
  const res = $([])
  eq(some(res, d => d > 0)[value], false)
})

test('every - true when all rows match', () => {
  const res = $([2, 4, 6])
  const e = every(res, d => d % 2 === 0)
  eq(e[value], true)
  res.insert(3)
  eq(e[value], false)
  res[3] = 8
  eq(e[value], true)
})

test('every - empty set is true (matches Array#every — vacuous truth)', () => {
  const res = $([])
  eq(every(res, d => d > 0)[value], true)
})

test('some/every - update flipping a row\'s predicate', () => {
  const res = $([{ done: false }, { done: false }, { done: true }])
  const allDone = every(res, r => r.done)
  const anyDone = some(res, r => r.done)
  eq(allDone[value], false)
  eq(anyDone[value], true)
  res[0].done = true
  res[1].done = true
  eq(allDone[value], true)
  eq(anyDone[value], true)
  res[2].done = false
  eq(allDone[value], false)
  eq(anyDone[value], true)
})

test('some - dedup: same fn → same view', () => {
  const res = $([1, 2, 3])
  const fn = d => d > 0
  const a = some(res, fn)
  const b = some(res, fn)
  eq(a[value], b[value])
  res.insert(-1)
  eq(a[value], true)
  eq(b[value], true)   // shared state
})
