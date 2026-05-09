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
