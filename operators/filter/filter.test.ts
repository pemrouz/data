// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { test } from 'node:test'
import { $, value } from '../../core.ts'
import { filter } from './index.ts'

function filterTest(tx) {
  const res = $({
    10: { completed: true },
    20: { completed: false },
    30: { completed: true },
  })
  const filtered = tx(res)
  const changes = filtered.connect([])

  delete res[10].foo
  delete res[10].completed
  delete res[20]
  delete res[value]

  res[value] = { 10: { completed: true }, 20: { completed: false }, 30: { completed: true } }
  res[20].completed = true
  res[20].completed = false
  res[30] = { completed: false }
  res[30] = { completed: true }
  res[40] = { completed: true }
  res[50] = { completed: false }

  same(changes, [
    { type: 'update', key: [], value: { '10': { completed: true }, '30': { completed: true } } },
    { type: 'remove', key: [ '10' ], value: {} },
    { type: 'remove', key: [], value: { '30': { completed: true } } },
    { type: 'update', key: [], value: { '10': { completed: true }, '30': { completed: true } } },
    { type: 'insert', key: [], value: { completed: true }, at: '20' },
    { type: 'remove', key: [ '20' ], value: { completed: false } },
    { type: 'remove', key: [ '30' ], value: { completed: true } },
    { type: 'insert', key: [], value: { completed: true }, at: '30' },
    { type: 'insert', key: [], value: { completed: true }, at: '40' }
  ])
  same(filtered[value], {
    '10': { completed: true },
    '30': { completed: true },
    '40': { completed: true }
  })
}

test('filter - function', () => {
  filterTest(res => filter(res, d => d.completed))
})

test('filter - string key/value', () => {
  filterTest(res => filter(res, 'completed', true))
})

test('filter - string key only', () => {
  filterTest(res => filter(res, 'completed'))
})

test('filter - array key', () => {
  filterTest(res => filter(res, ['completed']))
})

test('filter - object', () => {
  filterTest(res => filter(res, { completed: true }))
})

// Regression: array-source delete must splice the filter's view (not just
// `delete view.value[name]`), or the filter's array layout drifts away from
// the source. Subsequent BU2 events on a post-shift row would then read a
// hole, classify as a fresh insert, and double-count downstream.
test('filter - array source delete propagates shift', () => {
  const data = $([
    { keep: true, n: 1 },
    { keep: false, n: 2 },
    { keep: true, n: 3 },
    { keep: true, n: 4 },
  ])
  const kept = filter(data, 'keep', true)
  same(kept[value], [
    { keep: true, n: 1 }, , { keep: true, n: 3 }, { keep: true, n: 4 },
  ])
  delete data[1]  // remove the excluded row; post-splice source has 3 rows
  same(kept[value], [
    { keep: true, n: 1 }, { keep: true, n: 3 }, { keep: true, n: 4 },
  ])
  // The row originally at idx 3 is now at idx 2; updating it via the new
  // index must surface as an update on the post-shift slot (not a stale-
  // hole-filling insert that leaves the old row dangling at idx 3).
  data[2].n = 99
  same(kept[value], [
    { keep: true, n: 1 }, { keep: true, n: 3 }, { keep: true, n: 99 },
  ])
})
