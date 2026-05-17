// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { test } from 'node:test'
import { $, value } from '../../core.ts'
import { between } from './index.ts'

// Regression: between() with plain numeric bounds previously threw
// `arg[0].connect is not a function` because it called .connect on raw
// numbers. The README and operators/README explicitly document plain bounds
// as valid ("captured once"), so this is a doc/code contract gap.
test('between - plain numeric bounds', () => {
  const all = $({ 1: { num: 90 }, 2: { num: 10 }, 3: { num: 50 } })
  const filtered = between(all, 'num', [20, 80])
  same(filtered[value], { 3: { num: 50 } })
})

test('between - mixed reactive/plain bounds', () => {
  const all = $({ 1: { num: 90 }, 2: { num: 10 }, 3: { num: 50 } })
  const lo = $(20)
  const filtered = between(all, 'num', [lo, 80])
  same(filtered[value], { 3: { num: 50 } })
  lo[value] = 5
  same(filtered[value], { 2: { num: 10 }, 3: { num: 50 } })
})

// Regression: between() previously didn't override BU1/BU2/BI0/BI2/BR1/BR2,
// inheriting Value's pass-through. So when a row's sort-column changed
// across a bound, the view kept the row at its old membership and `sorted`
// drifted out of sync with the source. The crossfilter demo never exposed
// this because it brushes a static dataset.
test('between - row crosses bound via BU2', () => {
  const data = $({
    a: { price: 10 },
    b: { price: 50 },
    c: { price: 90 },
  })
  const inRange = between(data, 'price', [40, 60])
  same(inRange[value], { b: { price: 50 } })
  data.b.price = 100  // b leaves the range
  same(inRange[value], {})
  data.c.price = 50   // c enters the range
  same(inRange[value], { c: { price: 50 } })
  data.b.price = 45   // b re-enters
  same(inRange[value], { c: { price: 50 }, b: { price: 45 } })
})

test('between - insert/remove track membership', () => {
  const data = $({ a: { price: 50 } })
  const inRange = between(data, 'price', [40, 60])
  same(inRange[value], { a: { price: 50 } })
  // insert in-range
  ;(data as any).insert({ price: 55 }, 'b')
  same(inRange[value], { a: { price: 50 }, b: { price: 55 } })
  // insert out-of-range
  ;(data as any).insert({ price: 200 }, 'c')
  same(inRange[value], { a: { price: 50 }, b: { price: 55 } })
  // remove an out-of-range row — view unchanged
  delete (data as any).c
  same(inRange[value], { a: { price: 50 }, b: { price: 55 } })
  // remove an in-range row — view shrinks
  delete (data as any).b
  same(inRange[value], { a: { price: 50 } })
})

// Regression: widening a bound onto a value that an existing row holds
// exactly used to drop that row. The widen-up and widen-down branches in
// `set extent` compared with strict `<` / `>` against the new bound, and
// hi_index was initialised via the left-bisect — so when hi_val sat on a
// row's col-value the bisect landed *on* the row instead of past it, and
// the strict comparison then refused to (re)include the boundary row when
// the bound moved out to a value that equaled another row.
test('between - widen onto boundary row (hi)', () => {
  const flights = $([
    { dest: 'A', ts: 10 },
    { dest: 'B', ts: 11 },
    { dest: 'C', ts: 12 },
    { dest: 'D', ts: 13 },
    { dest: 'E', ts: 14 },
    { dest: 'F', ts: 15 },
  ])
  const brush = $([10, 13])
  const win = between(flights, 'ts', brush)
  same(win[value].filter(Boolean).map(r => r.dest), ['A','B','C','D'])
  brush[value] = [10, 15]
  same(win[value].filter(Boolean).map(r => r.dest), ['A','B','C','D','E','F'])
})

test('between - widen onto boundary row (lo)', () => {
  const flights = $([
    { dest: 'A', ts: 10 },
    { dest: 'B', ts: 11 },
    { dest: 'C', ts: 12 },
    { dest: 'D', ts: 13 },
    { dest: 'E', ts: 14 },
    { dest: 'F', ts: 15 },
  ])
  const brush = $([11, 15])
  const win = between(flights, 'ts', brush)
  same(win[value].filter(Boolean).map(r => r.dest), ['B','C','D','E','F'])
  brush[value] = [10, 15]
  same(win[value].filter(Boolean).map(r => r.dest), ['A','B','C','D','E','F'])
})

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
