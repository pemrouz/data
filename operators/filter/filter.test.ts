import { deepStrictEqual as same } from 'node:assert'
import { spec } from '../../tests/spec.ts'
import '../../full.ts'      // registers the Operators dispatch (for the filter→length chain test)
import { $, value } from '../../core.ts'
import { filter } from './index.ts'

// Over an ARRAY source a predicate keeps each passing row at its SOURCE index
// and leaves an explicit hole (a for-in-skipped empty slot, not undefined) at
// every excluded slot — including a TRAILING-excluded one, because RowOperator.XU0
// pads the output to source length (the C13 fix), not to the last-passing index.
// A predicate flip during an edit fills/holes one slot IN PLACE (BF0/BH1, no
// splice) so neighbours keep their indices. Nothing else in the filter row pins
// the hole POSITIONS directly — the differential oracle densifies before
// comparing, so it would miss a positional regression.
spec({ op:'filter', guarantee:'Selection', trigger:'construct/edit', shape:'array', via:['BH1','BF0'], issue:'C13', asserts:'passing rows keep their source index; excluded slots are holes, including a trailing one' }, () => {
  const src = $([{ v: 10 }, { v: 30 }, { v: 40 }, { v: 5 }])
  const f = filter(src, r => r.v >= 30)   // predicate row `r` inferred as { v: number }
  same(f[value]!.length, 4)             // padded to source length
  same(1 in f[value]!, true); same(f[value]![1].v, 30)
  same(2 in f[value]!, true); same(f[value]![2].v, 40)
  same(0 in f[value]!, false)           // excluded → hole, not undefined
  same(3 in f[value]!, false)           // trailing excluded → still a hole within length 4

  src[3].v = 99                        // idx3 now passes → fills the trailing hole in place
  same(f[value]!.length, 4)             // no shift
  same(3 in f[value]!, true); same(f[value]![3].v, 99)
  same(0 in f[value]!, false)           // neighbour holes unchanged

  src[1].v = 0                         // idx1 now fails → holes in place
  same(1 in f[value]!, false)
  same(2 in f[value]!, true); same(f[value]![2].v, 40)
})

// `res` stays `any` deliberately: this helper exercises OFF-SHAPE mutations a
// precise type is designed to reject — deleting a field (`completed`), deleting a
// non-existent key (`foo`), adding dynamic keys (`40`/`50`), and clearing the
// whole value slot. That's the documented loose-capture exception.
function filterTest(tx: (res: any) => any) {
  const res: any = $({
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

spec({ op:'filter', guarantee:'Selection', trigger:'insert/remove', shape:'object', asserts:'the function predicate form tracks inserts, edits and removes' }, () => {
  filterTest((res: any) => filter(res, (d: any) => d.completed))
})

spec({ op:'filter', guarantee:'Selection', trigger:'insert/remove', shape:'object', asserts:'the (key, value) form tracks inserts, edits and removes' }, () => {
  filterTest((res: any) => filter(res, 'completed', true))
})

spec({ op:'filter', guarantee:'Selection', trigger:'insert/remove', shape:'object', asserts:'the key-only truthy form tracks inserts, edits and removes' }, () => {
  filterTest((res: any) => filter(res, 'completed'))
})

spec({ op:'filter', guarantee:'Selection', trigger:'insert/remove', shape:'object', asserts:'the [key] array form tracks inserts, edits and removes' }, () => {
  filterTest((res: any) => filter(res, ['completed']))
})

spec({ op:'filter', guarantee:'Selection', trigger:'insert/remove', shape:'object', asserts:'the {key: value} object form tracks inserts, edits and removes' }, () => {
  filterTest((res: any) => filter(res, { completed: true }))
})

// Regression: array-source delete must splice the filter's view (not just
// `delete view.value[name]`), or the filter's array layout drifts away from
// the source. Subsequent BU2 events on a post-shift row would then read a
// hole, classify as a fresh insert, and double-count downstream.
spec({ op:'filter', guarantee:'Alignment', trigger:'remove', shape:'array', via:['BR1'], asserts:'an array delete splices the view so post-shift edits hit the right slot' }, () => {
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
spec({ op:'filter', guarantee:'Alignment', trigger:'insert', shape:'array', via:['BI0A'], issue:'C2', asserts:'a mid-array positional insert keeps the displaced row' }, () => {
  const src = $([{ v: 10 }, { v: 20 }, { v: 30 }])
  const f = filter(src, r => r.v >= 15)
  same(f[value]!.filter(x => x !== undefined), [{ v: 20 }, { v: 30 }])
  src.insert({ v: 99 }, 1)        // passes the predicate, splices at 1
  same(f[value]!.filter(x => x !== undefined), [{ v: 99 }, { v: 20 }, { v: 30 }])
  src.insert({ v: 5 }, 0)         // fails the predicate, splices at 0
  same(f[value]!.filter(x => x !== undefined), [{ v: 99 }, { v: 20 }, { v: 30 }])
})

// Regression: filter(['path','seg'], v) used to INFINITE-LOOP on any row whose
// nested path hit a nullish intermediate — `r?.[p.shift()]` short-circuits past
// the shift() once r is nullish, so the path array never drained. A row simply
// missing an intermediate segment (ordinary data) froze the process at 100% cpu
// with no error, at construction or inside any later cascade.
spec({ op:'filter', guarantee:'Robustness', trigger:'construct', shape:'object', via:['nested-path'], asserts:'the nested-path form terminates on a null intermediate segment' }, () => {
  // heterogeneous + off-shape (key `e` added below): a dynamic-keyed map
  const res = $<Record<string, any>>({
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
spec({ op:'filter', guarantee:'Robustness', trigger:'edit', shape:'object', via:['BU1'], asserts:'an undefined row is a leave, not a crash, for the string forms' }, () => {
  // rows legitimately go undefined (a BU1 leave) — declared in the value type
  const src = $<Record<string, { on: number } | undefined>>({ a: { on: 1 }, b: { on: 0 } })
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
spec({ op:'filter', guarantee:'Fidelity', trigger:'remove', shape:'array', issue:'D3', asserts:'deleting an excluded array row emits no phantom remove record' }, () => {
  const src = $([{ v: 30 }, { v: 5 }, { v: 40 }])
  const f = filter(src, r => r.v > 10)
  const log = f.connect([])
  delete src[1]                       // {v:5} was excluded — no record
  same(log.slice(1), [])
  delete src[0]                       // {v:30} WAS in the view — real remove
  same(log.slice(1), [{ type: 'remove', key: ['0'], value: { v: 30 } }])
})

// ─── Reactive value arguments (a ViewProxy in the value slot) ──────────────
// filter('key', $(x)) / filter(['path'], $(x)) / filter({k: $(x)}) re-select
// when the bound value changes — the equality counterpart to between/gt's
// reactive bounds. A reactive value change re-runs a whole-snapshot XU0 (any
// row can move in/out on an equality flip), so the change stream is coarse
// `update` records. A plain literal value is captured once, as before.
spec({ op:'filter', guarantee:'Selection', trigger:'value-move', shape:'array', via:'reactive-value', asserts:"filter('key', $(x)) re-selects when the bound value changes" }, () => {
  const src = $([{ foo: 5, n: 'a' }, { foo: 7, n: 'b' }, { foo: 5, n: 'c' }])
  const x = $(5)
  const f = filter(src, 'foo', x)
  same(f[value]!.filter(Boolean), [{ foo: 5, n: 'a' }, { foo: 5, n: 'c' }])
  x[value] = 7                        // re-select on the new value
  same(f[value]!.filter(Boolean), [{ foo: 7, n: 'b' }])
  x[value] = 5                        // and back
  same(f[value]!.filter(Boolean), [{ foo: 5, n: 'a' }, { foo: 5, n: 'c' }])
})

spec({ op:'filter', guarantee:'Selection', trigger:'value-move', shape:'object', via:'reactive-value', asserts:"filter(['path'], $(x)) tracks a reactive nested-path value" }, () => {
  const src = $({ a: { m: { g: 'A' } }, b: { m: { g: 'B' } }, c: { m: { g: 'A' } } })
  const x = $('A')
  const f = filter(src, ['m', 'g'], x)
  same(f[value], { a: { m: { g: 'A' } }, c: { m: { g: 'A' } } })
  x[value] = 'B'
  same(f[value], { b: { m: { g: 'B' } } })
})

spec({ op:'filter', guarantee:'Selection', trigger:'value-move', shape:'object', via:'reactive-value', asserts:'filter({k: $(x), static: v}) tracks the reactive leaf while honouring static leaves' }, () => {
  const src = $({
    a: { foo: 5, active: true },
    b: { foo: 7, active: true },
    c: { foo: 5, active: false },
  })
  const x = $(5)
  const f = filter(src, { foo: x, active: true })
  same(f[value], { a: { foo: 5, active: true } })   // c excluded by static active:false
  x[value] = 7
  same(f[value], { b: { foo: 7, active: true } })
})

spec({ op:'filter', guarantee:'Fidelity', trigger:'value-move', shape:'object', via:'reactive-value', emits:['update'], asserts:'construction seeds one snapshot (no double-fire); each value move re-emits the whole view' }, () => {
  const src = $({ a: { foo: 5 }, b: { foo: 7 }, c: { foo: 5 } })
  const x = $(5)
  const f = filter(src, 'foo', x)
  const ch = f.connect([])
  same(ch, [{ type: 'update', key: [], value: { a: { foo: 5 }, c: { foo: 5 } } }])
  x[value] = 7
  same(ch, [
    { type: 'update', key: [], value: { a: { foo: 5 }, c: { foo: 5 } } },
    { type: 'update', key: [], value: { b: { foo: 7 } } },
  ])
})

spec({ op:'filter', guarantee:'Propagation', trigger:'value-move', shape:'object', via:'reactive-value', chain:'filter→length', asserts:'a reactive-value membership change flows to a downstream length' }, () => {
  const src = $({ a: { g: 'x' }, b: { g: 'y' }, c: { g: 'x' }, d: { g: 'x' } })
  const x = $('x')
  const n = filter(src, 'g', x).length()
  same(n[value], 3)
  x[value] = 'y'
  same(n[value], 1)
})
