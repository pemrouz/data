// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { test } from 'node:test'
import { $, value } from '../../core.ts'
import { keys, values } from './index.ts'

test('keys - object: list of property names', () => {
  const data = $({ a: 1, b: 2, c: 3 })
  same(keys(data)[value], ['a', 'b', 'c'])
})

test('keys - reactive: insert appends, remove drops', () => {
  const data = $({ a: 1 })
  const k = keys(data)
  same(k[value], ['a'])
  data.b = 2
  same(k[value], ['a', 'b'])
  delete data.a
  same(k[value], ['b'])
})

test('values - object: list of property values', () => {
  const data = $({ a: 1, b: 2, c: 3 })
  same(values(data)[value], [1, 2, 3])
})

test('values - reactive: updates flow through', () => {
  const data = $({ a: 1, b: 2 })
  const v = values(data)
  same(v[value], [1, 2])
  data.a = 99
  same(v[value], [99, 2])
})

test('keys - works on arrays (returns string indices)', () => {
  const data = $(['x', 'y', 'z'])
  same(keys(data)[value], ['0', '1', '2'])
})
