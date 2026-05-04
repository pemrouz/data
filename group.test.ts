// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { test } from 'node:test'
import { $, value } from './core.ts'
import { group } from './group.ts'

const max = (a, b) => a > b ? a : b
$.random = o => 1 + Object.keys(o).map(Number).sort().reduce(max, -1)

test('group - object', () => {
  const res = $({
    1: { num: 1.1 }, 2: { num: 2.2 }, 3: { num: 1.9 },
    4: { num: 2.6 }, 5: { num: 1.7 }
  })
  const grouped = group(res, d => Math.floor(d.num))
  const changes = grouped.connect([])
  res.insert({ num: 1.8 })
  res.insert({ num: 5.9 })
  res[5] = { num: 1.8 }
  res[5] = { num: 2.1 }
  res[7] = { num: 1.0 }
  res[8] = { num: 4.1 }
  delete res[2]
  delete res[8]
  delete res[value]
  same(changes, [
    { type: 'update', key: [], value: {
      1: { 1: { num: 1.1 }, 3: { num: 1.9 }, 5: { num: 1.7 } },
      2: { 2: { num: 2.2 }, 4: { num: 2.6 } }
    } },
    { type: 'insert', key: [ 1 ], value: { num: 1.8 }, at: '6' },
    { type: 'insert', key: [ 5 ], value: { num: 5.9 }, at: '7' },
    { type: 'update', key: [ 1, '5' ], value: { num: 1.8 } },
    { type: 'remove', key: [ 1, '5' ], value: { num: 1.8 } },
    { type: 'insert', key: [ 2 ], value: { num: 2.1 }, at: '5' },
    { type: 'remove', key: [ 5 ], value: {} },
    { type: 'remove', key: [ 5, '7' ], value: { num: 5.9 } },
    { type: 'insert', key: [ 1 ], value: { num: 1 }, at: '7' },
    { type: 'insert', key: [ 4 ], value: { num: 4.1 }, at: '8' },
    { type: 'remove', key: [ 2, '2' ], value: { num: 2.2 } },
    { type: 'remove', key: [ 4 ], value: {} },
    { type: 'remove', key: [ 4, '8' ], value: { num: 4.1 } },
    { type: 'update', key: [], value: {} }
  ])
  same(grouped[value], {})
})
