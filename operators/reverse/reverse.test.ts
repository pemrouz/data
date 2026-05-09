// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { test } from 'node:test'
import { $, value } from '../../core.ts'
import { reverse } from './index.ts'

test('reverse - array: order flipped', () => {
  const data = $(['a', 'b', 'c', 'd'])
  same(reverse(data)[value], ['d', 'c', 'b', 'a'])
})

test('reverse - object: values flipped (iteration order)', () => {
  const data = $({ x: 1, y: 2, z: 3 })
  same(reverse(data)[value], [3, 2, 1])
})

test('reverse - reactive: insert appears at the front of the reversed view', () => {
  const data = $(['a', 'b'])
  const r = reverse(data)
  same(r[value], ['b', 'a'])
  data.insert('c')
  same(r[value], ['c', 'b', 'a'])
})

test('reverse - reactive: remove drops correctly', () => {
  const data = $(['a', 'b', 'c'])
  const r = reverse(data)
  same(r[value], ['c', 'b', 'a'])
  delete data[0]
  same(r[value], ['c', 'b'])
})

test('reverse - filters out undefined slots (sparse arrays)', () => {
  const data = $(['a', undefined, 'c'])
  same(reverse(data)[value], ['c', 'a'])
})
