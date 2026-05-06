// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { test } from 'node:test'
import { $, value, view } from '../../core.ts'
import { group, GroupValue } from './index.ts'

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
