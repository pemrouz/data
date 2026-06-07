// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { test } from 'node:test'
import { $, value } from '../../core.ts'
import { except } from './index.ts'
import { filter } from '../filter/index.ts'

// Regression (C12): an in-place edit that pushes a row INTO the exclusion left
// it stuck in the output. The facet (a filter) correctly emits an insert when
// its predicate flips, and except's BI0-from-other drops the row — but the
// SAME source edit also fans a BU2 to except's primary, and the base BU2
// default re-materialised the row, undoing the drop. except.BU2 now respects
// exclusion membership (mirrors except's BU1): skip excluded rows, forward the
// rest.
test('except - in-place edit into the exclusion drops the row (BU2)', () => {
  const src = $({ k0: { v: 0 }, k1: { v: 11 }, k2: { v: 22 }, k3: { v: 77 } })
  const res = except(src, filter(src, (r) => r.v > 60))
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined).map(([k, x]) => [k, x.v]))
  same(clean(res[value]), { k0: 0, k1: 11, k2: 22 })   // k3 excluded (v>60)
  src.k1.v = 200                                         // k1 now matches the exclusion
  same(clean(res[value]), { k0: 0, k2: 22 })            // pre-fix: k1 stuck at 200
  src.k1.v = 5                                           // k1 leaves the exclusion again
  same(clean(res[value]), { k0: 0, k1: 5, k2: 22 })     // re-admitted
})

test('except - rows in source but not in other', () => {
  const a = $({ 1: 'a', 2: 'b', 3: 'c' })
  const b = $({ 2: 'b' })
  same(except(a, b)[value], { 1: 'a', 3: 'c' })
})

test('except - reactive: adding to `other` drops the row from output', () => {
  const a = $({ 1: 'a', 2: 'b' })
  const b = $({})
  const res = except(a, b)
  same(res[value], { 1: 'a', 2: 'b' })
  b[1] = 'a'
  same(res[value], { 2: 'b' })
})

test('except - reactive: removing from `other` re-admits the row', () => {
  const a = $({ 1: 'a', 2: 'b' })
  const b = $({ 1: 'a' })
  const res = except(a, b)
  same(res[value], { 2: 'b' })
  delete b[1]
  same(res[value], { 1: 'a', 2: 'b' })
})

test('except - reactive: removing from source drops from output', () => {
  const a = $({ 1: 'a', 2: 'b', 3: 'c' })
  const b = $({ 1: 'a' })
  const res = except(a, b)
  same(res[value], { 2: 'b', 3: 'c' })
  delete a[2]
  same(res[value], { 3: 'c' })
})

test('except - reactive: insert into source admits if not in other', () => {
  const a = $({ 1: 'a' })
  const b = $({ 9: 'z' })
  const res = except(a, b)
  same(res[value], { 1: 'a' })
  a[2] = 'b'
  same(res[value], { 1: 'a', 2: 'b' })
  a[9] = 'z'
  same(res[value], { 1: 'a', 2: 'b' })   // 9 is in `other`, so excluded
})
