// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { test } from 'node:test'
import { $, value } from './core.ts'
import { between } from './between.ts'

test('between - reactive bounds', async () => {
  const all = $({ 1: { num: 90 }, 2: { num: 10 }, 3: { num: 50 } })
  const filters = $({ lo: 20, hi: 80 })
  const filtered = between(all, 'num', [filters.lo, filters.hi])
  const changes = filtered.connect([])
  filters.lo = 5
  filters.hi = 6
  filters.hi = 100
  filters.lo = 99
  filters.lo = 100
  same(changes, [
    { type: 'update', key: [], value: { '3': { num: 50 } } },
    { type: 'insert', value: { num: 10 }, key: [], at: '2' },
    { type: 'remove', value: { num: 50 }, key: [ '3' ] },
    { type: 'remove', value: { num: 10 }, key: [ '2' ] },
    { type: 'insert', value: { num: 10 }, key: [], at: '2' },
    { type: 'insert', value: { num: 50 }, key: [], at: '3' },
    { type: 'insert', value: { num: 90 }, key: [], at: '1' },
    { type: 'remove', value: { num: 10 }, key: [ '2' ] },
    { type: 'remove', value: { num: 50 }, key: [ '3' ] },
    { type: 'remove', value: { num: 90 }, key: [ '1' ] },
    { type: 'update', value: {}, key: [] },
  ])
})
