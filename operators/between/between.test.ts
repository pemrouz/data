// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { test } from 'node:test'
import { $, value } from '../../core.ts'
import { between } from './index.ts'
import { filter } from '../filter/index.ts'
import { length } from '../length/index.ts'
import { sum } from '../aggregate/index.ts'

const dense = (a) => (Array.isArray(a) ? a.filter((x) => x !== undefined) : a)

test('between → filter over an ARRAY source stays aligned through a holed-row removal (C1)', () => {
  // A row OUT of between's range is a hole in between's array. Removing it
  // splices between's array; between must emit that splice (BH1/BR1 path) so
  // the downstream filter shifts in lockstep — otherwise filter keeps a ghost.
  const src = $([{ v: 10 }, { v: 50 }, { v: 90 }, { v: 55 }])
  const b = between(src, 'v', [40, 70])   // in range: {v:50},{v:55}; holes: 10, 90
  const f = filter(b, (r) => r.v > 45)
  same(dense(b[value]), [{ v: 50 }, { v: 55 }])
  same(dense(f[value]), [{ v: 50 }, { v: 55 }])
  delete src[0]                            // remove the holed {v:10} (out of range)
  same(dense(b[value]), [{ v: 50 }, { v: 55 }])
  same(dense(f[value]), [{ v: 50 }, { v: 55 }])   // pre-fix: ghost — drifted by one
  delete src[0]                            // now remove {v:50} (in range)
  same(dense(b[value]), [{ v: 55 }])
  same(dense(f[value]), [{ v: 55 }])
})

test('filter → between over an ARRAY source: between consumes upstream holes/fills (C1)', () => {
  // between DOWNSTREAM of filter: filter's array carries holes for excluded
  // rows. between must skip them (no crash deref-ing `.v` on a hole) and treat
  // an upstream hole-fill/hole-remove (BF0/BH1) as a membership change without
  // splicing.
  const src = $([{ v: 10 }, { v: 50 }, { v: 90 }, { v: 30 }])
  const f = filter(src, (r) => r.v >= 25)   // holes out {v:10}; keeps 50,90,30
  const b = between(f, 'v', [40, 100])      // of those, 50 & 90 in range
  same(dense(b[value]), [{ v: 50 }, { v: 90 }])
  src[3].v = 70                             // {v:30}→70: enters filter? already in; now in between range
  same(dense(b[value]), [{ v: 50 }, { v: 90 }, { v: 70 }])
  src[0].v = 60                             // {v:10}→60: enters filter (BF0) AND between range
  same(dense(b[value]), [{ v: 60 }, { v: 50 }, { v: 90 }, { v: 70 }])
  src[1].v = 5                              // {v:50}→5: leaves filter (BH1) → leaves between
  same(dense(b[value]), [{ v: 60 }, { v: 90 }, { v: 70 }])
})

test('between → filter over an ARRAY source tracks a reactive bound move (C1)', () => {
  const src = $([{ v: 10 }, { v: 50 }, { v: 90 }, { v: 55 }])
  const bound = $([40, 70])
  const b = between(src, 'v', bound)
  const f = filter(b, (r) => r.v > 20)
  same(dense(f[value]), [{ v: 50 }, { v: 55 }])
  bound[value] = [0, 60]                    // 10 and 50,55 in; 90 out
  same(dense(b[value]), [{ v: 10 }, { v: 50 }, { v: 55 }])
  same(dense(f[value]), [{ v: 50 }, { v: 55 }])   // 10 excluded by filter, not a ghost
})

// Regression: between() with plain numeric bounds previously threw
// `arg[0].connect is not a function` because it called .connect on raw
// numbers. The README and operators/README explicitly document plain bounds
// as valid ("captured once"), so this is a doc/code contract gap.
test('between - plain numeric bounds', () => {
  const all = $({ 1: { num: 90 }, 2: { num: 10 }, 3: { num: 50 } })
  const filtered = between(all, 'num', [20, 80])
  same(filtered[value], { 3: { num: 50 } })
})

test('between - mixed reactive/plain bounds', () => {
  const all = $({ 1: { num: 90 }, 2: { num: 10 }, 3: { num: 50 } })
  const lo = $(20)
  const filtered = between(all, 'num', [lo, 80])
  same(filtered[value], { 3: { num: 50 } })
  lo[value] = 5
  same(filtered[value], { 2: { num: 10 }, 3: { num: 50 } })
})

// Regression: between() previously didn't override BU1/BU2/BI0/BI2/BR1/BR2,
// inheriting Value's pass-through. So when a row's sort-column changed
// across a bound, the view kept the row at its old membership and `sorted`
// drifted out of sync with the source. The crossfilter demo never exposed
// this because it brushes a static dataset.
test('between - row crosses bound via BU2', () => {
  const data = $({
    a: { price: 10 },
    b: { price: 50 },
    c: { price: 90 },
  })
  const inRange = between(data, 'price', [40, 60])
  same(inRange[value], { b: { price: 50 } })
  data.b.price = 100  // b leaves the range
  same(inRange[value], {})
  data.c.price = 50   // c enters the range
  same(inRange[value], { c: { price: 50 } })
  data.b.price = 45   // b re-enters
  same(inRange[value], { c: { price: 50 }, b: { price: 45 } })
})

test('between - insert/remove track membership', () => {
  const data = $({ a: { price: 50 } })
  const inRange = between(data, 'price', [40, 60])
  same(inRange[value], { a: { price: 50 } })
  // insert in-range
  ;(data as any).insert({ price: 55 }, 'b')
  same(inRange[value], { a: { price: 50 }, b: { price: 55 } })
  // insert out-of-range
  ;(data as any).insert({ price: 200 }, 'c')
  same(inRange[value], { a: { price: 50 }, b: { price: 55 } })
  // remove an out-of-range row — view unchanged
  delete (data as any).c
  same(inRange[value], { a: { price: 50 }, b: { price: 55 } })
  // remove an in-range row — view shrinks
  delete (data as any).b
  same(inRange[value], { a: { price: 50 } })
})

// Regression: widening a bound onto a value that an existing row holds
// exactly used to drop that row. The widen-up and widen-down branches in
// `set extent` compared with strict `<` / `>` against the new bound, and
// hi_index was initialised via the left-bisect — so when hi_val sat on a
// row's col-value the bisect landed *on* the row instead of past it, and
// the strict comparison then refused to (re)include the boundary row when
// the bound moved out to a value that equaled another row.
test('between - widen onto boundary row (hi)', () => {
  const flights = $([
    { dest: 'A', ts: 10 },
    { dest: 'B', ts: 11 },
    { dest: 'C', ts: 12 },
    { dest: 'D', ts: 13 },
    { dest: 'E', ts: 14 },
    { dest: 'F', ts: 15 },
  ])
  const brush = $([10, 13])
  const win = between(flights, 'ts', brush)
  same(win[value].filter(Boolean).map(r => r.dest), ['A','B','C','D'])
  brush[value] = [10, 15]
  same(win[value].filter(Boolean).map(r => r.dest), ['A','B','C','D','E','F'])
})

test('between - widen onto boundary row (lo)', () => {
  const flights = $([
    { dest: 'A', ts: 10 },
    { dest: 'B', ts: 11 },
    { dest: 'C', ts: 12 },
    { dest: 'D', ts: 13 },
    { dest: 'E', ts: 14 },
    { dest: 'F', ts: 15 },
  ])
  const brush = $([11, 15])
  const win = between(flights, 'ts', brush)
  same(win[value].filter(Boolean).map(r => r.dest), ['B','C','D','E','F'])
  brush[value] = [10, 15]
  same(win[value].filter(Boolean).map(r => r.dest), ['A','B','C','D','E','F'])
})

test('between - reactive bounds', async () => {
  const all = $({ 1: { num: 90 }, 2: { num: 10 }, 3: { num: 50 } })
  const filters = $({ lo: 20, hi: 80 })
  const filtered = between(all, 'num', [filters.lo, filters.hi])
  const changes = filtered.connect([])
  filters.lo = 5
  filters.hi = 6
  filters.hi = 100
  filters.lo = 99
  filters.lo = 100
  same(changes, [
    { type: 'update', key: [], value: { '3': { num: 50 } } },
    { type: 'insert', value: { num: 10 }, key: [], at: '2' },
    { type: 'remove', value: { num: 50 }, key: [ '3' ] },
    { type: 'remove', value: { num: 10 }, key: [ '2' ] },
    { type: 'insert', value: { num: 10 }, key: [], at: '2' },
    { type: 'insert', value: { num: 50 }, key: [], at: '3' },
    { type: 'insert', value: { num: 90 }, key: [], at: '1' },
    { type: 'remove', value: { num: 10 }, key: [ '2' ] },
    { type: 'remove', value: { num: 50 }, key: [ '3' ] },
    { type: 'remove', value: { num: 90 }, key: [ '1' ] },
    // The final `filters.lo = 100` narrows [99,100] -> [100,100] on an
    // already-empty view: no row crosses, so it emits NOTHING. (Before the
    // point-range fix, the `new_lo === new_hi` branch fired a spurious
    // `XU0({})` reset here even though nothing changed.)
  ])
})

// Regression: on an ARRAY source, an in-place edit of the between column (BU2,
// or a whole-row BU1) sets `sortedDirty`; the NEXT insert then ran _resort()
// (which rebuilt `sorted` from the already-mutated p.value) AND the incremental
// array shift+place, double-counting the new row and minting an out-of-bounds
// key the bisect dereferenced → `Cannot read properties of undefined (reading
// 'v')` thrown to the caller's .insert(). This is the crossfilter/swarm shape
// (stream inserts while attributes mutate in place). Now the dirty path rebuilds
// via XU0. Object sources had the silent-duplicate analogue.
test('between - insert after an in-place column edit does not crash (array + object)', () => {
  // array
  const arr = $([{ v: 50, g: 0 }])
  const wa = between(arr, 'v', [20, 80])
  arr[0].v = 60                       // in-place col edit -> sortedDirty
  arr.insert({ v: 40, g: 1 })         // used to throw
  same(wa[value].filter(Boolean), [{ v: 60, g: 0 }, { v: 40, g: 1 }])
  arr[1].v = 70                       // dirty again (in-band edit also triggers)
  arr.insert({ v: 30, g: 2 })
  same(wa[value].filter(Boolean), [{ v: 60, g: 0 }, { v: 70, g: 1 }, { v: 30, g: 2 }])
  arr[0].v = 100                      // 60 -> 100 leaves the band, dirty
  arr.insert({ v: 25, g: 3 })
  same(wa[value].filter(Boolean), [{ v: 70, g: 1 }, { v: 30, g: 2 }, { v: 25, g: 3 }])

  // object (was a silent `sorted` duplicate rather than a crash)
  const obj = $({ a: { v: 50 }, b: { v: 90 } })
  const wo = between(obj, 'v', [20, 80])
  obj.a.v = 60
  ;(obj as any).insert({ v: 40 }, 'c')
  same(wo[value], { a: { v: 60 }, c: { v: 40 } })
})

// Regression: narrowing a reactive bound down to a POINT range [v, v] must keep
// the rows with col === v — bounds are inclusive — not collapse to empty. The
// old `set extent` special-cased new_lo === new_hi to an empty view, which
// contradicted both the constructor (a fresh `between(col,[v,v])` keeps col===v)
// and the inclusive narrow loops, so a brush dragged to zero width silently
// dropped the boundary rows (the swarm gx/gy cohort-brush path).
test('between - narrowing a reactive bound to a point range keeps the boundary rows', () => {
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))

  // object source — narrow the high bound down onto the low bound
  const src = $({ a: { gx: 1 }, b: { gx: 2 }, c: { gx: 3 } })
  const lo = $(1), hi = $(3)
  const b = between(src, 'gx', [lo, hi])
  same(clean(b[value]), { a: { gx: 1 }, b: { gx: 2 }, c: { gx: 3 } })
  hi[value] = 1                                                     // [1,3] -> [1,1]
  same(clean(b[value]), { a: { gx: 1 } })                          // pre-fix: {} (row a dropped)
  same(clean(b[value]), clean(between(src, 'gx', [$(1), $(1)])[value]))  // identical to a fresh [1,1]

  // narrow the low bound up onto the high bound, to a different interior point
  const lo2 = $(1), hi2 = $(2)
  const b2 = between(src, 'gx', [lo2, hi2])
  lo2[value] = 2                                                    // [1,2] -> [2,2]
  same(clean(b2[value]), { b: { gx: 2 } })                         // pre-fix: {} (row b dropped)

  // array source — both bounds converge to a point
  const arr = $([{ gx: 1 }, { gx: 2 }, { gx: 3 }])
  const lo3 = $(1), hi3 = $(3)
  const ba = between(arr, 'gx', [lo3, hi3])
  hi3[value] = 2; lo3[value] = 2                                    // -> [2,2]
  same(dense(ba[value]), [{ gx: 2 }])                              // pre-fix: [] (boundary row dropped)
})

// Regression (C8): `set extent`'s narrow loops walk `sorted` bounded only by the
// MOVING bound (`col > new_hi` / `col < new_lo`), so a brush that sweeps one
// bound PAST the opposite boundary steps onto rows that were already out of view
// (their slot is a hole) and re-emitted a remove for each. between's own
// `view.value` stayed correct, but a downstream COUNTING/AGGREGATING sink
// (length/sum/avg) decremented on the phantom remove and drifted to 0 / negative.
// The differential harness missed this (it had no between→aggregate scenario);
// it now does. Each sweep below starts from a fresh window so the pre-fix value
// is exact, not compounded.
test('between → length/sum stays correct when a brush sweeps a bound past the opposite bound (C8)', () => {
  // k0..k8 with v = 0,11,…,88; window [20,70] holds k2..k6 (v 22,33,44,55,66).
  const mk = () => $(Object.fromEntries(Array.from({ length: 9 }, (_, i) => ['k' + i, { v: i * 11 }])))

  // (a) sweep the LOW bound UP, past the high boundary -> empty window.
  const sA = mk(), bA = $([20, 70])
  const wA = between(sA, 'v', bA)
  const cA = length(wA), tA = sum(wA, 'v')
  same(cA[value], 5)
  same(tA[value], 220)
  bA[value] = [90, 100]
  // narrow-low walks past k7(77)/k8(88) — already excluded (> hi_val 70). Pre-fix
  // it re-emitted a remove for each, so the count drifted to -2 and the running
  // sum to -165 (negative). Post-fix both drain cleanly to 0.
  same(cA[value], 0)
  same(tA[value], 0)

  // (b) sweep the HIGH bound DOWN, past the low boundary -> just k0(0).
  const sB = mk(), bB = $([20, 70])
  const wB = between(sB, 'v', bB)
  const cB = length(wB), tB = sum(wB, 'v')
  same(cB[value], 5)
  bB[value] = [0, 10]
  // narrow-high walks past k1(11) — already excluded (< lo_val 20) — before
  // widen-low admits k0(0). Pre-fix the phantom remove of k1 dropped count to 0.
  same(cB[value], 1)
  same(tB[value], 0)                // only k0, v=0
})
