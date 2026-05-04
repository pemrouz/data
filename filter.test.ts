// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { test } from 'node:test'
import { $, value } from './core.ts'
import { filter } from './filter.ts'

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
