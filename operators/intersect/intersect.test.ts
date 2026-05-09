// @ts-nocheck
import { deepStrictEqual as same, ok } from 'node:assert'
import { test } from 'node:test'
import { $, value, view } from '../../core.ts'
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

// Regression: when one source EXPANDS via XU0 to include rows it didn't
// have at intersect's construction time (e.g. crossfilter's `between`
// resetting from a narrow window back to the full source on reset),
// those new rows have to enter the intersection if every other source
// also has them. Previously intersect tracked filters only for rows in
// p.value at construction, so the expanding source's XU0 left filters[i]
// permanently zero (or NaN, after `undefined & off`) for the freshly
// admitted rows — they could never satisfy the all-bits-set check, and
// in the crossfilter example brushing a date range outside the initial
// filter would silently produce 0 active rows.
test('intersect - source expanding past construction-time tracking', () => {
  const a = $({ 1: 'a', 2: 'b' })  // narrow primary
  const b = $({ 1: 'a', 2: 'b', 3: 'c', 4: 'd' })
  const c = $({ 1: 'a', 2: 'b', 3: 'c', 4: 'd' })
  const res = intersect(a, b, c)
  same(res[value], { 1: 'a', 2: 'b' })

  // Expand `a` to cover the full set; intersection should pick up the
  // newly-admitted rows because they're in b and c too.
  a[value] = { 1: 'a', 2: 'b', 3: 'c', 4: 'd' }
  same(res[value], { 1: 'a', 2: 'b', 3: 'c', 4: 'd' })

  // Shrink back — only rows still in `a` survive.
  a[value] = { 1: 'a' }
  same(res[value], { 1: 'a' })
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
    // After `b[value] = [,'g','h']` index 0 is sparse in b, so intersection
    // excludes index 0 (was incorrectly included by the previous code which
    // iterated all positions of an array regardless of whether they were
    // present in the source).
    { type: 'update', key: [], value: [, 'e', 'c'] },
    { type: 'remove', key: ['1'], value: 'e' },
    { type: 'update', key: [], value: [] }
  ])
  same(res[value], [])
})

// Crossfilter "leave-one-out" pattern: dimensions are named once in a plain
// object whose values are derived ViewProxies, then each consumer asks for
// "all dimensions" or "all dimensions except mine". Adding a new dimension
// means adding one entry to dims; existing call sites don't change because
// each names only the dimension to exclude.
test('intersect - dims object form intersects all values', () => {
  const source   = $({ 1: 'a', 2: 'b', 3: 'c' })
  const f1       = $({ 1: 'a', 2: 'b' })
  const f2       = $({ 2: 'b', 3: 'c' })
  const dims     = { f1, f2 }
  const res = intersect(source, dims)
  // Only key 2 is in source, f1, AND f2.
  same(res[value], { 2: 'b' })
})

test('intersect - dims object with key excludes that dim (leave-one-out)', () => {
  const source   = $({ 1: 'a', 2: 'b', 3: 'c' })
  const f1       = $({ 1: 'a', 2: 'b' })
  const f2       = $({ 2: 'b', 3: 'c' })
  const dims     = { f1, f2 }
  // Excluding 'f1' means we intersect source with f2 only.
  // Keys 2 and 3 are in both; key 1 is only in source.
  const res = intersect(source, dims, 'f1')
  same(res[value], { 2: 'b', 3: 'c' })
})

test('intersect - dedup: same args return the same operator view', () => {
  const a = $({ 1: 'a', 2: 'b' })
  const b = $({ 1: 'a', 2: 'b' })
  // The free function intersect() goes through createOperator which dedups
  // by (class, matches()). Two calls with identical args = one operator.
  const r1 = intersect(a, b)
  const r2 = intersect(a, b)
  ok(r1[view] === r2[view])
})

test('intersect - dedup: dims-form with same key reuses; different key creates new', () => {
  const source = $({ 1: 'a', 2: 'b' })
  const f1     = $({ 1: 'a', 2: 'b' })
  const f2     = $({ 1: 'a', 2: 'b' })
  const dims   = { f1, f2 }
  const r1 = intersect(source, dims, 'f1')
  const r2 = intersect(source, dims, 'f1')
  const r3 = intersect(source, dims, 'f2')
  ok(r1[view] === r2[view])      // same key → same view
  ok(r1[view] !== r3[view])      // different key → different view
})
