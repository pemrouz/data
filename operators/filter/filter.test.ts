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

// Regression: a genuine MID-array positional insert upstream of filter must not
// drop the displaced row (the C2 / RowOperator.BI0A path; sibling of the map
// test). Tail-only inserts in the differential harness left this uncovered —
// removing RowOperator.BI0A still passed the suite. core routes the array
// insert-at-position through BI0A; without the splice-aware override the
// displaced surviving row is misclassified as an update and lost.
test('filter - mid-array positional insert keeps the displaced row (BI0A / C2)', () => {
  const src = $([{ v: 10 }, { v: 20 }, { v: 30 }])
  const f = filter(src, (r) => r.v >= 15)
  same(f[value].filter((x) => x !== undefined), [{ v: 20 }, { v: 30 }])
  ;(src as any).insert({ v: 99 }, 1)        // passes the predicate, splices at 1
  same(f[value].filter((x) => x !== undefined), [{ v: 99 }, { v: 20 }, { v: 30 }])
  ;(src as any).insert({ v: 5 }, 0)         // fails the predicate, splices at 0
  same(f[value].filter((x) => x !== undefined), [{ v: 99 }, { v: 20 }, { v: 30 }])
})

// Regression: filter(['path','seg'], v) used to INFINITE-LOOP on any row whose
// nested path hit a nullish intermediate — `r?.[p.shift()]` short-circuits past
// the shift() once r is nullish, so the path array never drained. A row simply
// missing an intermediate segment (ordinary data) froze the process at 100% cpu
// with no error, at construction or inside any later cascade.
test('filter - nested-path form terminates on missing/null intermediate segments', () => {
  const res = $({
    a: { x: { y: 1 } },   // full path present — kept
    b: { g: 2 },          // x missing — must classify as excluded, not hang
    c: { x: null },       // null intermediate — same
    d: null,              // null row — same
  })
  const filtered = filter(res, ['x', 'y'], 1)
  same(filtered[value], { a: { x: { y: 1 } } })
  res.e = { x: { y: 1 } }                  // mutation cascade walks the path too
  same(filtered[value], { a: { x: { y: 1 } }, e: { x: { y: 1 } } })
  res.e = { x: {} }                        // leaves via a now-missing leaf
  same(filtered[value], { a: { x: { y: 1 } } })
  // truthy (2-arg) nested form takes the same walker
  same(filter(res, ['x', 'y'])[value], { a: { x: { y: 1 } } })
})

// Regression: filter('key') / filter('key', val) lowered to bare `r[name]`
// derefs. The protocol legitimately delivers undefined rows to process() —
// `src.k = undefined` arrives as a BU1 leave, and a sparse view's XU0 walk
// hands undefined slots through — so both forms threw TypeError mid-cascade
// while the function / object / nested-path forms (all guarded) survived.
test('filter - string forms classify an undefined row as a leave, not a crash', () => {
  const src = $({ a: { on: 1 }, b: { on: 0 } })
  const truthy = filter(src, 'on')
  const eq = filter(src, 'on', 1)
  same(truthy[value], { a: { on: 1 } })
  same(eq[value], { a: { on: 1 } })
  src.a = undefined                 // BU1 [a, undefined] — a leave
  same(truthy[value], {})
  same(eq[value], {})
  src.a = { on: 1 }                 // re-enters
  same(truthy[value], { a: { on: 1 } })
  same(eq[value], { a: { on: 1 } })
})

// Regression (D3): deleting a source array row the predicate EXCLUDED used to
// surface a phantom `{type:'remove', value:undefined}` to connect([]) /
// connect(obj,fn) consumers — RowOperator forwards `[index, undefined]` to keep
// array-aware sinks' positions aligned, but a record sink must not report a
// remove for a row that was never in the view. A genuine remove still fires.
test('filter - deleting an excluded array row emits no phantom remove record', () => {
  const src = $([{ v: 30 }, { v: 5 }, { v: 40 }])
  const f = filter(src, (r) => r.v > 10)
  const log = f.connect([])
  delete src[1]                       // {v:5} was excluded — no record
  same(log.slice(1), [])
  delete src[0]                       // {v:30} WAS in the view — real remove
  same(log.slice(1), [{ type: 'remove', key: ['0'], value: { v: 30 } }])
})
