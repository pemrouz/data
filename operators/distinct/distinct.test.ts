// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { test } from 'node:test'
import { $, value } from '../../core.ts'
import { distinct } from './index.ts'

test('distinct - identity dedup, first-seen order', () => {
  const res = $([1, 2, 1, 3, 2, 4])
  same(distinct(res)[value], [1, 2, 3, 4])
})

test('distinct - fn projects to a key', () => {
  const res = $([
    { airline: 'AA', flight: 1 },
    { airline: 'UA', flight: 2 },
    { airline: 'AA', flight: 3 },
    { airline: 'DL', flight: 4 },
  ])
  same(distinct(res, r => r.airline)[value], [
    { airline: 'AA', flight: 1 },
    { airline: 'UA', flight: 2 },
    { airline: 'DL', flight: 4 },
  ])
})

test('distinct - reactive: insert of a new key appends', () => {
  const res = $(['a', 'b', 'a'])
  const d = distinct(res)
  same(d[value], ['a', 'b'])
  res.insert('c')
  same(d[value], ['a', 'b', 'c'])
})

test('distinct - reactive: insert of an existing key is a no-op for the output', () => {
  const res = $(['a', 'b'])
  const d = distinct(res)
  same(d[value], ['a', 'b'])
  res.insert('a')
  same(d[value], ['a', 'b'])
})

test('distinct - reactive: removing all of a key drops it from the output', () => {
  const res = $({ x: 'a', y: 'b', z: 'a' })
  const d = distinct(res)
  same(d[value], ['a', 'b'])
  // After deleting `x`, iteration order is `y, z` so first-seen flips:
  // 'b' is now seen before 'a'.
  delete res.x
  same(d[value], ['b', 'a'])  // 'a' still present via 'z'
  delete res.z
  same(d[value], ['b'])
})

test('distinct - dedup: same fn → same view', () => {
  const res = $([1, 2, 3])
  const fn = d => d
  const a = distinct(res, fn)
  const b = distinct(res, fn)
  same(a[value], b[value])
})
