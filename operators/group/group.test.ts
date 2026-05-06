// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { test } from 'node:test'
import { $, value, view } from '../../core.ts'
import { group, GroupValue } from './index.ts'
import { sort, limit } from '../sort/index.ts'

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
    { type: 'remove', key: [ 5 ], value: { '7': { num: 5.9 } } },
    { type: 'insert', key: [ 1 ], value: { num: 1 }, at: '7' },
    { type: 'insert', key: [ 4 ], value: { num: 4.1 }, at: '8' },
    { type: 'remove', key: [ 2, '2' ], value: { num: 2.2 } },
    { type: 'remove', key: [ 4 ], value: { '8': { num: 4.1 } } },
    { type: 'update', key: [], value: {} }
  ])
  same(grouped[value], {})
})

// regression: a batched BU1 where multiple rows leave the same source group
// (e.g. limit emitting several updates in one call after a filter shifts) used
// to push the empty-group cleanup once per row, so downstream sinks received
// the same group-remove twice and DOMSink's remove_node threw on the second
// call. The cleared group should now be reported exactly once, with the
// removed rows as the value.
test('group - batched BU1 with multiple rows leaving the same group', () => {
  const res = $({
    1: { num: 1.1 }, 2: { num: 1.2 }, 3: { num: 5.0 },
  })
  const grouped = group(res, d => Math.floor(d.num))
  const changes = grouped.connect([])
  changes.length = 0  // discard the initial XU0
  // simulate a parent operator emitting a batched BU1 in which both rows in
  // group 1 cross over to group 2 in the same tick
  const op = [...res[view].sinks]
    .map(w => w.deref?.())
    .find(s => s instanceof GroupValue)
  op.BU1(['1', { num: 2.1 }, '2', { num: 2.2 }])
  same(changes, [
    { type: 'remove', key: [ 1 ], value: { '1': { num: 1.1 }, '2': { num: 1.2 } } },
    { type: 'insert', key: [ 2 ], value: { num: 2.1 }, at: '1' },
    { type: 'insert', key: [ 2 ], value: { num: 2.2 }, at: '2' },
  ])
})

// Array source: GroupValue should treat upstream-position events as splices
// with implicit suffix-shift semantics, keeping a per-group bucket array
// and emitting BR2/BI2/BU2 keyed by per-group local index. This is what
// limit→group composition relies on for incremental DOM updates.
test('group - array source incremental updates', () => {
  const res = $([
    { num: 1.1 },   // 0 → group 1, idx 0
    { num: 5.0 },   // 1 → group 5, idx 0
    { num: 1.2 },   // 2 → group 1, idx 1
    { num: 1.3 },   // 3 → group 1, idx 2
  ])
  const grouped = group(res, d => Math.floor(d.num))
  const changes = grouped.connect([])
  changes.length = 0
  const op = [...res[view].sinks]
    .map(w => w.deref?.())
    .find(s => s instanceof GroupValue)

  // Simulate limit-style remove at upstream pos 1 (the only group-5 row).
  // Group 5 should clear; surviving positions [2, 3] shift down to [1, 2].
  op.BR1A([1, { num: 5.0 }])
  same(changes, [
    { type: 'remove', key: [ 5 ], value: [ { num: 5.0 } ] },
  ])
  changes.length = 0

  // Now upstream pos 1 is { num: 1.2 } (was 2 before the shift). Remove it
  // — group 1 still has rows at idx 0 (1.1) and idx 2 (1.3), so we expect
  // a partial BR2 keyed by the per-group idx the removed row had.
  op.BR1A([1, { num: 1.2 }])
  same(changes, [
    { type: 'remove', key: [ 1, 1 ], value: { num: 1.2 } },
  ])

  // Bucket order is preserved by upstream position.
  same(grouped[value], { 1: [ { num: 1.1 }, { num: 1.3 } ] })
})

// Array source: BI0A inserts at an upstream position and shifts every
// later upstream key up by one. The new row lands in its group's bucket
// at the position dictated by upstream order.
test('group - array source BI0A insert in middle', () => {
  const res = $([
    { num: 1.1 },
    { num: 1.3 },
  ])
  const grouped = group(res, d => Math.floor(d.num))
  const changes = grouped.connect([])
  changes.length = 0
  const op = [...res[view].sinks]
    .map(w => w.deref?.())
    .find(s => s instanceof GroupValue)

  // Insert a new row at upstream pos 1 (between the two existing entries).
  // It joins group 1 and should land at idx 1 in the bucket so that
  // bucket order = upstream order.
  op.BI0A([1, { num: 1.2 }])
  same(changes, [
    { type: 'insert', key: [ 1 ], value: { num: 1.2 }, at: 1 },
  ])
  same(grouped[value], { 1: [ { num: 1.1 }, { num: 1.2 }, { num: 1.3 } ] })
})

// End-to-end regression for the limit→group composition that motivated the
// array-source restructure. Before the fix, limit's incremental BR1A/BI0A
// emissions shifted positions in limit's array but downstream group still
// keyed its per-bucket entries by the *original* upstream position; later
// events referenced the *current* position and missed, eventually crashing
// downstream sinks. Now group keeps array buckets in upstream order with
// idx tracking, so a brush-style churn against limit→group stays consistent.
test('group - limit→group survives churn that shifts upstream positions', () => {
  // 30 source rows in 3 categories. limit(10) keeps the 10 lowest-id rows
  // (object iteration order). Each category has ~3 rows in the window.
  const data = {}
  for (let i = 0; i < 30; i++) data[i] = { cat: i % 3, val: i }
  const src = $(data)
  const limited = limit(src, 10)
  const grouped = group(limited, d => d.cat)

  same(grouped[value], {
    0: [ { cat: 0, val: 0 }, { cat: 0, val: 3 }, { cat: 0, val: 6 }, { cat: 0, val: 9 } ],
    1: [ { cat: 1, val: 1 }, { cat: 1, val: 4 }, { cat: 1, val: 7 } ],
    2: [ { cat: 2, val: 2 }, { cat: 2, val: 5 }, { cat: 2, val: 8 } ],
  })

  // Remove the row at the front of the window. limit refills from beyond
  // the window; group has to splice the right bucket and keep position
  // bookkeeping consistent.
  delete src[0]
  same(grouped[value], {
    0: [ { cat: 0, val: 3 }, { cat: 0, val: 6 }, { cat: 0, val: 9 } ],
    1: [ { cat: 1, val: 1 }, { cat: 1, val: 4 }, { cat: 1, val: 7 }, { cat: 1, val: 10 } ],
    2: [ { cat: 2, val: 2 }, { cat: 2, val: 5 }, { cat: 2, val: 8 } ],
  })

  // Remove a row from the middle of the window — this is the case where
  // limit's splice shifts positions of multiple rows, and the previous
  // implementation lost track.
  delete src[5]
  // window is now [1, 2, 3, 4, 6, 7, 8, 9, 10, 11]
  same(grouped[value], {
    0: [ { cat: 0, val: 3 }, { cat: 0, val: 6 }, { cat: 0, val: 9 } ],
    1: [ { cat: 1, val: 1 }, { cat: 1, val: 4 }, { cat: 1, val: 7 }, { cat: 1, val: 10 } ],
    2: [ { cat: 2, val: 2 }, { cat: 2, val: 8 }, { cat: 2, val: 11 } ],
  })

  // Repeat several times to exercise the shift bookkeeping under churn —
  // before the fix this trail of removes would corrupt group's posMap.
  for (const k of [1, 2, 3, 4]) delete src[k]
  // 10 lowest remaining ids: 6,7,8,9,10,11,12,13,14,15 (we removed 0..5)
  same(grouped[value], {
    0: [ { cat: 0, val: 6 }, { cat: 0, val: 9 }, { cat: 0, val: 12 }, { cat: 0, val: 15 } ],
    1: [ { cat: 1, val: 7 }, { cat: 1, val: 10 }, { cat: 1, val: 13 } ],
    2: [ { cat: 2, val: 8 }, { cat: 2, val: 11 }, { cat: 2, val: 14 } ],
  })
})
