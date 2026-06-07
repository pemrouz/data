// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { test } from 'node:test'
import { $, value } from '../../core.ts'
import { map } from './index.ts'

test('map - update/insert/remove', async () => {
  const res = $({ 0: { num: 1 }, 1: { num: 2 }, 2: { num: 3 } })
  const mapped = map(res, d => d.num * 10)
  const changes = mapped.connect([])

  res[3] = { num: 4 }
  res[2].insert(5, 'num')
  delete res[1].num
  delete res[1]
  delete res[value]
  res[value] = { 0: { num: 6 } }
  res[0] = { num: 7 }
  res[0].num = 8

  same(changes, [
    { type: 'update', key: [], value: { '0': 10, '1': 20, '2': 30 } },
    { type: 'insert', key: [], value: 40, at: '3' },
    { type: 'update', key: [ '2' ], value: 50 },
    { type: 'update', key: [ '1' ], value: NaN },
    { type: 'remove', key: [ '1' ], value: NaN },
    { type: 'remove', key: [], value: { '0': 10, '2': 50, '3': 40 } },
    { type: 'update', key: [], value: { '0': 60 } },
    { type: 'update', key: [ '0' ], value: 70 },
    { type: 'update', key: [ '0' ], value: 80 }
  ])
  same(mapped[value], { '0': 80 })
})

// Regression: a genuine MID-array positional insert upstream of map must not
// drop the displaced row (the C2 / RowOperator.BI0A path). The differential
// harness only ever TAIL-appends array sources, so this path was a coverage
// blind spot — removing RowOperator.BI0A still passed the whole suite while a
// mid-array insert silently dropped a row. core routes an array insert-at-
// position through BI0A; without RowOperator's splice-aware BI0A, loop() reads
// the displaced occupant as the inserted row's "old" value, misclassifies the
// insert as an update of that slot, overwrites the occupant, and never shifts
// it down — so the displaced row vanishes (map would give [10,99,30]).
test('map - mid-array positional insert keeps the displaced row (BI0A / C2)', () => {
  const src = $([{ v: 10 }, { v: 20 }, { v: 30 }])
  const m = map(src, (r) => r.v)
  same(m[value], [10, 20, 30])
  ;(src as any).insert({ v: 99 }, 1)        // splice in at index 1
  same(m[value], [10, 99, 20, 30])          // pre-BI0A: [10,99,30] (20 dropped)
  ;(src as any).insert({ v: 77 }, 0)        // splice at the front too
  same(m[value], [77, 10, 99, 20, 30])
})
