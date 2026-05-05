// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { test } from 'node:test'
import { $, value } from '../../core.ts'
import { intersect } from './index.ts'

test('intersect - objects', () => {
  const a = $({ 10: 'a', 20: 'b', 30: 'c' })
  const b = $({ 10: 'a', 20: 'b' })
  const res = intersect(a, b)
  const changes = res.connect([])
  b[30] = 'x'
  a[40] = 'y'
  b[20] = 'd'
  a[20] = 'e'
  b[value] = { 20: 'g', 30: 'h' }
  delete b[20]
  delete b[value]
  same(changes, [
    { type: 'update', key: [], value: { 10: 'a', 20: 'b' } },
    { type: 'insert', key: [], value: 'c', at: '30' },
    { type: 'update', key: ['20'], value: 'e' },
    { type: 'update', key: [], value: { 20: 'e', 30: 'c' } },
    { type: 'remove', key: ['20'], value: 'e' },
    { type: 'update', key: [], value: {} }
  ])
  same(res[value], {})
})

test('intersect - arrays', () => {
  const a = $(['a', 'b', 'c'])
  const b = $(['a', 'b'])
  const res = intersect(a, b)
  const changes = res.connect([])
  b[2] = 'x'
  a[3] = 'y'
  b[1] = 'd'
  a[1] = 'e'
  b[value] = [,'g','h']
  delete b[1]
  delete b[value]
  same(changes, [
    { type: 'update', key: [], value: ['a', 'b'] },
    { type: 'insert', key: [], value: 'c', at: '2' },
    { type: 'update', key: ['1'], value: 'e' },
    { type: 'update', key: [], value: ['a', 'e', 'c'] },
    { type: 'remove', key: ['1'], value: 'e' },
    { type: 'update', key: [], value: [] }
  ])
  same(res[value], [])
})
