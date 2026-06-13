// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { test } from 'node:test'
import { $, value, view } from '../../core.ts'
import { group, GroupValue } from './index.ts'
import { sort, limit } from '../sort/index.ts'
import { sum } from '../aggregate/index.ts'
import { between } from '../between/index.ts'

const max = (a, b) => a > b ? a : b
$.random = o => 1 + Object.keys(o).map(Number).sort().reduce(max, -1)

const groups = (g) => Object.fromEntries(
  Object.entries(g[value]).map(([k, b]) => [k, Object.values(b).map((r) => r.id)]))

test('group - array source rebuckets on an in-place group-key edit (C1)', () => {
  // Array-source group's BU2 used to be a no-op, so changing a row's group key
  // in place left it stranded in its old bucket. It now rebuilds on a key move.
  const src = $([{ id: 0, g: 'a' }, { id: 1, g: 'b' }, { id: 2, g: 'a' }])
  const g = group(src, (r) => r.g)
  same(groups(g), { a: [0, 2], b: [1] })
  src[2].g = 'b'                            // id:2 moves a → b
  same(groups(g), { a: [0], b: [1, 2] })
  src[0].g = 'b'                            // a empties (rebuild → source order)
  same(groups(g), { b: [0, 1, 2] })
})

test('group - over between on an ARRAY source follows bound moves (C1)', () => {
  const src = $([{ id: 0, g: 'a', v: 10 }, { id: 1, g: 'b', v: 50 }, { id: 2, g: 'a', v: 90 }])
  const g = group(between(src, 'v', [40, 100]), (r) => r.g)
  same(groups(g), { b: [1], a: [2] })       // v in [40,100]: id1(b), id2(a)
  src[0].v = 45                             // id0 enters range (BF0) → bucket a
  same(groups(g), { a: [0, 2], b: [1] })
})

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
// Regression: group's BU2 was a no-op, so in-place field edits on an object
// source were invisible — a row whose group key changed in place was never
// rebucketed, and a non-key edit never reached bucket consumers (e.g. an
// aggregate over a bucket). Surfaced by the pivot example (group-by-region
// with editable revenue / region). Mirrors the length(fn)-on-BU2 fix.
test('group (object) - BU2 rebuckets on key change and forwards non-key edits', () => {
  const res = $({
    x: { g: 'A', v: 1 }, y: { g: 'A', v: 2 }, z: { g: 'B', v: 5 },
  })
  const grouped = group(res, d => d.g)
  const aSum = sum(grouped.A, 'v')          // aggregate over bucket A
  const bSum = sum(grouped.B, 'v')
  same(aSum[value], 3)                      // 1 + 2
  same(bSum[value], 5)

  // non-key edit in place — bucket A's sum must follow
  res.x.v = 10
  same(aSum[value], 12)                     // was stuck at 3

  // key edit in place — x moves A → B
  res.x.g = 'B'
  same(Object.keys(grouped[value].A), ['y'])
  same(Object.keys(grouped[value].B).sort(), ['x', 'z'])
  same(aSum[value], 2)                      // A now just y
  same(bSum[value], 15)                     // B = z(5) + x(10)

  // emptying a bucket via a key move drops the group
  res.y.g = 'B'
  same(grouped[value].A, undefined)
})

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

// Regression: a group fn returning undefined for some rows (the "unclassified"
// idiom) used to crash on that row's remove ("unexpected group r1") and silently
// DUPLICATE it on a cross-group move, because posMap stored the literal undefined
// group, indistinguishable from "untracked". posMap.has() now disambiguates.
test('group (object) - undefined group key: remove and move are correct', () => {
  const src = $({ a: { cat: 'x', v: 1 }, b: { v: 2 }, c: { cat: 'x', v: 3 } })
  const g = group(src, r => r.cat)            // b → the "undefined" bucket
  same(g[value], { x: { a: { cat: 'x', v: 1 }, c: { cat: 'x', v: 3 } }, undefined: { b: { v: 2 } } })

  // remove the undefined-group row — must not throw, bucket disappears
  delete src.b
  same(g[value], { x: { a: { cat: 'x', v: 1 }, c: { cat: 'x', v: 3 } } })

  // move an undefined-group row into a real group — must not leave a duplicate
  const src2 = $({ a: { cat: 'x', v: 1 }, b: { v: 2 } })
  const g2 = group(src2, r => r.cat)
  src2.b = { cat: 'z', v: 2 }                 // BU1 cross-group move out of "undefined"
  same(g2[value], { x: { a: { cat: 'x', v: 1 } }, z: { b: { cat: 'z', v: 2 } } })

  // same via an in-place BU2 field edit that newly classifies the row
  const src3 = $({ a: { cat: 'x', v: 1 }, b: { v: 2 } })
  const g3 = group(src3, r => r.cat)
  src3.b.cat = 'z'
  same(g3[value], { x: { a: { cat: 'x', v: 1 } }, z: { b: { cat: 'z', v: 2 } } })
})

// Regression: group over a SPARSE array source (downstream of between/intersect/
// union/except, which leave excluded slots as holes/explicit-undefined) crashed
// in XU0 calling fn(undefined). XU0 now skips undefined slots like sort does, and
// the array BR1A tolerates untracked (hole) positions rather than throwing
// `unexpected group r1` — so the (documented array-positional-limitation) combo
// degrades to no-crash through churn instead of throwing.
test('group - over a sparse array source skips excluded slots (no crash)', () => {
  const src = $([{ v: 10, g: 1 }, { v: 50, g: 2 }, { v: 90, g: 1 }])
  const g = group(between(src, 'v', [20, 80]), r => r.g)
  same(g[value], { 2: [ { v: 50, g: 2 } ] })
  // a removal that shifts past hole slots used to throw in BR1A — must not now
  delete src[0]
  // bucket 2 still holds its row; no exception is the assertion that matters
  same(2 in g[value], true)
})

// Regression (G2 / #29): group(fn) over a sparse OBJECT source (between/
// intersect leave excluded keys present with value undefined) called
// fn(undefined) and crashed — at construction (XU0) and on a leave via
// `src.k = undefined` (BU1). Both now treat undefined as excluded / a leave.
test('group - sparse object source and assignment-to-undefined do not crash', () => {
  const src = $({ a: { v: 1 }, b: { v: 5 }, c: { v: 2 } })
  const ext = $([0, 10])
  const ranged = between(src, 'v', ext)
  ext[value] = [0, 3]                       // b (v:5) leaves -> explicit-undefined slot
  const g = group(ranged, (r) => r.v < 3 ? 'lo' : 'hi') // construct over the churned sparse view
  const counts = (o) => Object.fromEntries(
    Object.entries(o).map(([k, b]) => [k, Object.values(b).filter((x) => x !== undefined).length]))
  same(counts(g[value]), { lo: 2 })         // a(1), c(2) in lo; b excluded; no crash

  const s2 = $({ a: { g: 'x', v: 1 }, b: { g: 'y', v: 2 } })
  const g2 = group(s2, (r) => r.g)
  s2.a = undefined                          // leave -> drops a, collapses bucket x
  same(Object.keys(g2[value]), ['y'])
})

// Regression (G2 / #33): the array BU2 branch looked up posMap.get(name) with a
// STRING path segment, but posMap is keyed numerically for arrays — so the
// lookup always missed, the "did the group key move?" check was always true,
// and every non-key in-place edit triggered a full XU0 rebuild (a whole-view
// update event downstream). Coerced to posMap.get(+name).
test('group - array non-key edit does not trigger a full rebuild', () => {
  const src = $([{ g: 'x', v: 1 }, { g: 'y', v: 2 }, { g: 'x', v: 3 }])
  let fnCalls = 0
  const g = group(src, (r) => { fnCalls++; return r.g })
  const base = fnCalls
  const ev = g.connect([])
  const evBase = ev.length
  src[0].v = 99                  // non-key edit
  same(fnCalls - base, 1)        // one re-evaluation, NOT a full 3-row rebuild
  same(ev.length - evBase, 0)    // non-key edit emits nothing
  // a key edit still rebuckets correctly
  src[0].g = 'y'
  same(g[value].x.filter((x) => x !== undefined).length, 1) // only {v:3} left in x
})
