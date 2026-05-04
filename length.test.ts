// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { test } from 'node:test'
import { $, value } from './core.ts'
import { length } from './length.ts'

test('length - object', () => {
  const obj = $({ 10: 'a' })
  const count = length(obj)
  const changes = count.connect([])
  obj.insert('b')
  obj.insert('c')
  delete obj[10]
  delete obj[value]
  same(count[value], 0)
})

test('length - array', () => {
  const arr = $(['a'])
  const count = length(arr)
  const changes = count.connect([])
  arr.insert('b')
  arr.insert('c')
  delete arr[0]
  delete arr[value]
  same(count[value], 0)
})

test('length fn - group counting', () => {
  const res = $({
    1: { num: 1.1 }, 2: { num: 2.2 }, 3: { num: 1.9 },
    4: { num: 2.6 }, 5: { num: 1.7 }
  })
  const lengths = length(res, d => Math.floor(d.num))
  const changes = lengths.connect([])
  res.insert({ num: 1.8 })
  res[5] = { num: 1.8 }
  res[5] = { num: 2.1 }
  res[9] = { num: 2.1 }
  res[9].foo = 'bar'
  delete res[3]
  delete res[value]
  same(changes, [
    { type: 'update', key: [], value: { '1': { value: 3 }, '2': { value: 2 } } },
    { type: 'update', key: [], value: { '1': { value: 4 }, '2': { value: 2 } } },
    { type: 'update', key: [], value: { '1': { value: 4 }, '2': { value: 2 } } },
    { type: 'update', key: [], value: { '1': { value: 3 }, '2': { value: 3 } } },
    { type: 'update', key: [], value: { '1': { value: 3 }, '2': { value: 4 } } },
    { type: 'update', key: [], value: { '1': { value: 2 }, '2': { value: 4 } } },
    { type: 'update', key: [], value: {} }
  ])
  same(lengths[value], {})
})
