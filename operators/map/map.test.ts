import { deepStrictEqual as same } from 'node:assert'
import { spec } from '../../tests/spec.ts'
import { $, value } from '../../core.ts'
import { map } from './index.ts'

spec({ op:'map', guarantee:'Fidelity', trigger:'insert/remove', shape:'object', asserts:'the projection tracks inserts, edits and removes through the change stream' }, async () => {
  const res: any = $({ 0: { num: 1 }, 1: { num: 2 }, 2: { num: 3 } })
  const mapped: any = map(res, (d: any) => d.num * 10)
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
spec({ op:'map', guarantee:'Alignment', trigger:'insert', shape:'array', via:['BI0A'], issue:'C2', asserts:'a mid-array positional insert keeps the displaced row' }, () => {
  const src: any = $([{ v: 10 }, { v: 20 }, { v: 30 }])
  const m: any = map(src, (r: any) => r.v)
  same(m[value], [10, 20, 30])
  ;(src as any).insert({ v: 99 }, 1)        // splice in at index 1
  same(m[value], [10, 99, 20, 30])          // pre-BI0A: [10,99,30] (20 dropped)
  ;(src as any).insert({ v: 77 }, 0)        // splice at the front too
  same(m[value], [77, 10, 99, 20, 30])
})

// Symmetric to the object Fidelity spec above, for an ARRAY source: the
// projection forwards each positional change through the connect([]) stream —
// a tail insert and a mid-array splice as {type:'insert', key:[], value, at}
// (correct `at` index), and an array delete as {type:'remove', key:[idx], value}.
// The object spec and the array Alignment spec cover value/shape; only this
// pins map's positional record stream (the array-keyed insert/remove verbs),
// which the differential oracle never checks (it compares values, not records).
spec({ op:'map', guarantee:'Fidelity', trigger:'insert/remove', shape:'array', via:['BI0A','BR1'], asserts:'positional inserts and an array delete forward as the right records with the right at/key' }, () => {
  const src: any = $([{ v: 10 }, { v: 20 }, { v: 30 }])
  const m: any = map(src, (r: any) => r.v)
  const changes = m.connect([])
  src.insert({ v: 40 })                // tail insert → at '3'
  ;(src as any).insert({ v: 99 }, 1)   // mid splice → at '1'
  delete src[0]                        // array delete → remove key ['0']
  same(changes, [
    { type: 'update', key: [], value: [10, 20, 30] },
    { type: 'insert', key: [], value: 40, at: '3' },
    { type: 'insert', key: [], value: 99, at: '1' },
    { type: 'remove', key: ['0'], value: 10 },
  ])
  same(m[value], [99, 20, 30, 40])
})
