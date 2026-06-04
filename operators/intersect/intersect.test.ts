// @ts-nocheck
import { deepStrictEqual as same, ok } from 'node:assert'
import { test } from 'node:test'
import { $, value, view } from '../../core.ts'
import { intersect } from './index.ts'
import { between } from '../between/index.ts'

// Regression: intersect's CONSTRUCTOR seeded its bitmask with `i in res.value`,
// but between/union/except leave EXPLICIT `undefined` at excluded slots (the
// key is present), so an excluded row counted as a member and was wrongly
// admitted. Only bites when the intersect is BUILT over an already-sparse
// source (e.g. a between whose bounds were tightened before the intersect was
// composed). The incremental paths already used `!== undefined`. Surfaced
// building the faceted-library example.
test('intersect - construction skips explicit-undefined slots of a sparse source', () => {
  const m = $({ a: { r: 8.3 }, b: { r: 8.6 }, c: { r: 8.5 } })
  const bounds = $([8.0, 9.0])
  const hi = between(m, 'r', bounds)           // reactive bounds; members a, b, c
  bounds[value] = [8.4, 9.0]                    // a leaves — left behind as undefined
  const dense = (v) => Object.keys(v).filter(k => v[k] !== undefined).sort()
  // a is `in hi.value` (key present, value undefined) but NOT a member
  same(hi[value].a, undefined)
  same('a' in hi[value], true)
  // build the intersect AFTER the sparse exclusion exists
  const res = intersect(m, hi)
  same(dense(res[value]), ['b', 'c'])
  same(res[value].a, undefined)                // must not be admitted
})

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

// Regression: nested-key updates (BU2/BR2/BI2) used to fall through to the
// default Operator forwarder because the gating handlers were misnamed
// `R2`/`U2`/`I2`. So a deep update on a row that was excluded from the
// intersection (because it wasn't in some secondary source) would still
// emit a BU2 downstream, leaking events for invisible rows.
test('intersect - deep update on a row excluded from intersection does not emit', () => {
  const a = $({ 1: { x: 'a1' }, 2: { x: 'a2' } })
  const b = $({ 1: { x: 'b1' } })   // row 2 excluded (not in b)
  const res = intersect(a, b)
  const changes = res.connect([])
  // Deep update on row 1 — in the intersection, should propagate.
  a[1].x = 'A1'
  // Deep update on row 2 — NOT in the intersection, should drop.
  a[2].x = 'A2'
  same(changes, [
    { type: 'update', key: [], value: { 1: { x: 'a1' } } },
    { type: 'update', key: ['1', 'x'], value: 'A1' },
  ])
})

// Regression: secondary sources' nested-key updates shouldn't propagate
// because intersect's downstream view shows `p.value[name]`, not the
// secondary's data — a deep change in `b` to row[1].x doesn't change what
// intersect emits.
test('intersect - secondary source nested update does not emit', () => {
  const a = $({ 1: { x: 'a1' } })
  const b = $({ 1: { x: 'b1' } })
  const res = intersect(a, b)
  const changes = res.connect([])
  b[1].x = 'B1'
  same(changes, [
    { type: 'update', key: [], value: { 1: { x: 'a1' } } },
  ])
})
