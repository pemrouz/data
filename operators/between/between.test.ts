import { deepStrictEqual as same } from 'node:assert'
import { spec } from '../../tests/spec.ts'
import { $, value, createOperator } from '../../core.ts'
import { between } from './index.ts'
import { filter } from '../filter/index.ts'
import { length } from '../length/index.ts'
import { sum } from '../aggregate/index.ts'
import { AZColumnValue } from '../sort/index.ts'
const az = (src: any, col: any, n?: any) => createOperator(src, AZColumnValue, col, n)

const dense = (a: any) => (Array.isArray(a) ? a.filter((x: any) => x !== undefined) : a)

spec({ op:'between', guarantee:'Alignment', trigger:'remove', shape:'array', via:['BH1','BR1'], issue:'C1', chain:'between→filter',
  asserts:'removing an out-of-range row keeps a downstream filter aligned' }, () => {
  // A row OUT of between's range is a hole in between's array. Removing it
  // splices between's array; between must emit that splice (BH1/BR1 path) so
  // the downstream filter shifts in lockstep — otherwise filter keeps a ghost.
  const src: any = $([{ v: 10 }, { v: 50 }, { v: 90 }, { v: 55 }])
  const b: any = between(src, 'v', [40, 70])   // in range: {v:50},{v:55}; holes: 10, 90
  const f: any = filter(b, (r: any) => r.v > 45)
  same(dense(b[value]), [{ v: 50 }, { v: 55 }])
  same(dense(f[value]), [{ v: 50 }, { v: 55 }])
  delete src[0]                            // remove the holed {v:10} (out of range)
  same(dense(b[value]), [{ v: 50 }, { v: 55 }])
  same(dense(f[value]), [{ v: 50 }, { v: 55 }])   // pre-fix: ghost — drifted by one
  delete src[0]                            // now remove {v:50} (in range)
  same(dense(b[value]), [{ v: 55 }])
  same(dense(f[value]), [{ v: 55 }])
})

spec({ op:'between', guarantee:'Alignment', trigger:'edit', shape:'array', via:['BH1','BF0'], issue:'C1', chain:'filter→between',
  asserts:'an upstream hole-fill or hole-remove changes membership without splicing' }, () => {
  // between DOWNSTREAM of filter: filter's array carries holes for excluded
  // rows. between must skip them (no crash deref-ing `.v` on a hole) and treat
  // an upstream hole-fill/hole-remove (BF0/BH1) as a membership change without
  // splicing.
  const src: any = $([{ v: 10 }, { v: 50 }, { v: 90 }, { v: 30 }])
  const f: any = filter(src, (r: any) => r.v >= 25)   // holes out {v:10}; keeps 50,90,30
  const b: any = between(f, 'v', [40, 100])      // of those, 50 & 90 in range
  same(dense(b[value]), [{ v: 50 }, { v: 90 }])
  src[3].v = 70                             // {v:30}→70: enters filter? already in; now in between range
  same(dense(b[value]), [{ v: 50 }, { v: 90 }, { v: 70 }])
  src[0].v = 60                             // {v:10}→60: enters filter (BF0) AND between range
  same(dense(b[value]), [{ v: 60 }, { v: 50 }, { v: 90 }, { v: 70 }])
  src[1].v = 5                              // {v:50}→5: leaves filter (BH1) → leaves between
  same(dense(b[value]), [{ v: 60 }, { v: 90 }, { v: 70 }])
})

spec({ op:'between', guarantee:'Propagation', trigger:'bound-move', shape:'array', via:'reactive-bound', issue:'C1', chain:'between→filter',
  asserts:'a bound move re-points membership downstream without a ghost' }, () => {
  const src: any = $([{ v: 10 }, { v: 50 }, { v: 90 }, { v: 55 }])
  const bound: any = $([40, 70])
  const b: any = between(src, 'v', bound)
  const f: any = filter(b, (r: any) => r.v > 20)
  same(dense(f[value]), [{ v: 50 }, { v: 55 }])
  bound[value] = [0, 60]                    // 10 and 50,55 in; 90 out
  same(dense(b[value]), [{ v: 10 }, { v: 50 }, { v: 55 }])
  same(dense(f[value]), [{ v: 50 }, { v: 55 }])   // 10 excluded by filter, not a ghost
})

// Regression: between() with plain numeric bounds previously threw
// `arg[0].connect is not a function` because it called .connect on raw
// numbers. The README and operators/README explicitly document plain bounds
// as valid ("captured once"), so this is a doc/code contract gap.
spec({ op:'between', guarantee:'Selection', trigger:'construct', shape:'object',
  asserts:'plain numeric bounds select the in-range rows' }, () => {
  const all: any = $({ 1: { num: 90 }, 2: { num: 10 }, 3: { num: 50 } })
  const filtered: any = between(all, 'num', [20, 80])
  same(filtered[value], { 3: { num: 50 } })
})

spec({ op:'between', guarantee:'Selection', trigger:'bound-move', shape:'object', via:'reactive-bound',
  asserts:'a reactive bound end re-selects when it changes' }, () => {
  const all: any = $({ 1: { num: 90 }, 2: { num: 10 }, 3: { num: 50 } })
  const lo: any = $(20)
  const filtered: any = between(all, 'num', [lo, 80])
  same(filtered[value], { 3: { num: 50 } })
  lo[value] = 5
  same(filtered[value], { 2: { num: 10 }, 3: { num: 50 } })
})

// Regression: between() previously didn't override BU1/BU2/BI0/BI2/BR1/BR2,
// inheriting Value's pass-through. So when a row's sort-column changed
// across a bound, the view kept the row at its old membership and `sorted`
// drifted out of sync with the source. The crossfilter demo never exposed
// this because it brushes a static dataset.
spec({ op:'between', guarantee:'Selection', trigger:'edit', shape:'object', via:'BU2',
  asserts:'a row whose value crosses the bound enters or leaves' }, () => {
  const data: any = $({
    a: { price: 10 },
    b: { price: 50 },
    c: { price: 90 },
  })
  const inRange: any = between(data, 'price', [40, 60])
  same(inRange[value], { b: { price: 50 } })
  data.b.price = 100  // b leaves the range
  same(inRange[value], {})
  data.c.price = 50   // c enters the range
  same(inRange[value], { c: { price: 50 } })
  data.b.price = 45   // b re-enters
  same(inRange[value], { c: { price: 50 }, b: { price: 45 } })
})

spec({ op:'between', guarantee:'Selection', trigger:'insert/remove', shape:'object', via:['BI0','BR1'],
  asserts:'in-range inserts and removes change membership; out-of-range ones do not' }, () => {
  const data: any = $({ a: { price: 50 } })
  const inRange: any = between(data, 'price', [40, 60])
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
spec({ op:'between', guarantee:'Selection', trigger:'bound-move', shape:'array', via:'reactive-bound',
  asserts:'widening onto a boundary value re-includes that row (high)' }, () => {
  const flights: any = $([
    { dest: 'A', ts: 10 },
    { dest: 'B', ts: 11 },
    { dest: 'C', ts: 12 },
    { dest: 'D', ts: 13 },
    { dest: 'E', ts: 14 },
    { dest: 'F', ts: 15 },
  ])
  const brush: any = $([10, 13])
  const win: any = between(flights, 'ts', brush)
  same(win[value].filter(Boolean).map((r: any) => r.dest), ['A','B','C','D'])
  brush[value] = [10, 15]
  same(win[value].filter(Boolean).map((r: any) => r.dest), ['A','B','C','D','E','F'])
})

spec({ op:'between', guarantee:'Selection', trigger:'bound-move', shape:'array', via:'reactive-bound',
  asserts:'widening onto a boundary value re-includes that row (low)' }, () => {
  const flights: any = $([
    { dest: 'A', ts: 10 },
    { dest: 'B', ts: 11 },
    { dest: 'C', ts: 12 },
    { dest: 'D', ts: 13 },
    { dest: 'E', ts: 14 },
    { dest: 'F', ts: 15 },
  ])
  const brush: any = $([11, 15])
  const win: any = between(flights, 'ts', brush)
  same(win[value].filter(Boolean).map((r: any) => r.dest), ['B','C','D','E','F'])
  brush[value] = [10, 15]
  same(win[value].filter(Boolean).map((r: any) => r.dest), ['A','B','C','D','E','F'])
})

spec({ op:'between', guarantee:'Fidelity', trigger:'bound-move', shape:'object', via:'reactive-bound', emits:['insert','remove','update'],
  asserts:'bound moves emit the exact insert/remove/update stream; a point range emits nothing' }, async () => {
  const all: any = $({ 1: { num: 90 }, 2: { num: 10 }, 3: { num: 50 } })
  const filters: any = $({ lo: 20, hi: 80 })
  const filtered: any = between(all, 'num', [filters.lo, filters.hi])
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
spec({ op:'between', guarantee:'Robustness', trigger:'insert', shape:'array+object', via:['BU2','BI0'],
  asserts:'an insert after an in-place edit neither crashes nor duplicates' }, () => {
  // array
  const arr: any = $([{ v: 50, g: 0 }])
  const wa: any = between(arr, 'v', [20, 80])
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
  const obj: any = $({ a: { v: 50 }, b: { v: 90 } })
  const wo: any = between(obj, 'v', [20, 80])
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
spec({ op:'between', guarantee:'Selection', trigger:'bound-move', shape:'array+object', via:'reactive-bound',
  asserts:'narrowing to a point range keeps rows equal to the bound' }, () => {
  const clean = (o: any) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))

  // object source — narrow the high bound down onto the low bound
  const src: any = $({ a: { gx: 1 }, b: { gx: 2 }, c: { gx: 3 } })
  const lo: any = $(1), hi = $(3)
  const b: any = between(src, 'gx', [lo, hi])
  same(clean(b[value]), { a: { gx: 1 }, b: { gx: 2 }, c: { gx: 3 } })
  hi[value] = 1                                                     // [1,3] -> [1,1]
  same(clean(b[value]), { a: { gx: 1 } })                          // pre-fix: {} (row a dropped)
  same(clean(b[value]), clean(between(src, 'gx', [$(1), $(1)])[value]))  // identical to a fresh [1,1]

  // narrow the low bound up onto the high bound, to a different interior point
  const lo2: any = $(1), hi2 = $(2)
  const b2: any = between(src, 'gx', [lo2, hi2])
  lo2[value] = 2                                                    // [1,2] -> [2,2]
  same(clean(b2[value]), { b: { gx: 2 } })                         // pre-fix: {} (row b dropped)

  // array source — both bounds converge to a point
  const arr: any = $([{ gx: 1 }, { gx: 2 }, { gx: 3 }])
  const lo3: any = $(1), hi3 = $(3)
  const ba: any = between(arr, 'gx', [lo3, hi3])
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
spec({ op:'between', guarantee:'Propagation', trigger:'bound-move', shape:'object', via:'reactive-bound', issue:'C8', chain:'between→length/sum',
  asserts:'sweeping a bound past the other emits no phantom removes to a downstream count or sum' }, () => {
  // k0..k8 with v = 0,11,…,88; window [20,70] holds k2..k6 (v 22,33,44,55,66).
  const mk = () => $(Object.fromEntries(Array.from({ length: 9 }, (_: any, i: any) => ['k' + i, { v: i * 11 }])))

  // (a) sweep the LOW bound UP, past the high boundary -> empty window.
  const sA = mk(), bA = $([20, 70])
  const wA: any = between(sA, 'v', bA)
  const cA: any = length(wA), tA = sum(wA, 'v')
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
  const wB: any = between(sB, 'v', bB)
  const cB: any = length(wB), tB = sum(wB, 'v')
  same(cB[value], 5)
  bB[value] = [0, 10]
  // narrow-high walks past k1(11) — already excluded (< lo_val 20) — before
  // widen-low admits k0(0). Pre-fix the phantom remove of k1 dropped count to 0.
  same(cB[value], 1)
  same(tB[value], 0)                // only k0, v=0
})

// Regression: a sort directly downstream of `between` mis-ordered rows on a
// SIDEWAYS brush (one that removes some rows AND admits others in the same
// `set extent`). `set extent` writes `view.value` for BOTH the holes and the
// fills before emitting, and used to emit the fills (BF0/BI0) BEFORE the holes
// (BH1/BR1). A downstream sort ranks a fill by bisecting `p.value[sorted[mid]]`
// — dereferencing the between view at every position still in its `sorted`. With
// fills emitted first, the not-yet-removed positions are already holes, so the
// bisect read `col(undefined)` and ranked the newcomer at the wrong end. Fixed
// by emitting removes before fills, so the sort drops the holed positions from
// `sorted` before it bisects any fill. (Laundered by intersect/union/except —
// they re-emit their own membership — so only a sort DIRECTLY on between bit.)
spec({ op:'between', guarantee:'Propagation', trigger:'brush', shape:'array', via:['BH1','BF0'], chain:'between→az',
  asserts:'a sideways brush keeps a downstream sort correctly ordered' }, () => {
  // rows v = 0,11,…,88 at indices 0..8.
  const src: any = $(Array.from({ length: 9 }, (_: any, i: any) => ({ id: i, v: i * 11 })))
  const bound: any = $([33, 66])
  const view: any = between(src, 'v', bound)
  const sorted: any = az(view, 'v')
  const vals = () => sorted[value].filter((r: any) => r !== undefined).map((r: any) => r.v)
  same(vals(), [33, 44, 55, 66])

  bound[value] = [22, 55]            // narrow-high drops 66, widen-low admits 22
  same(vals(), [22, 33, 44, 55])

  bound[value] = [50, 70]            // sideways: drop 22/33/44 (holes), admit 66 (fill)
  same(vals(), [55, 66])             // pre-fix: [66, 55] — 66 bisected over the holes to rank 0
})

// Regression (F / #21): when reactive bounds widen to full domain, `set extent`
// aliases view.value = p.value and every source-mutation handler relays the
// event WITHOUT marking `sorted` dirty. A row inserted/removed while unfiltered
// was then absent from the stale `sorted`, so the next narrow either leaked it
// as an out-of-range ghost or skipped a since-removed key. The relays now set
// sortedDirty. (Crossfilter's reset state is exactly full-domain bounds.)
spec({ op:'between', guarantee:'Selection', trigger:'insert/remove', shape:'array', via:'reactive-bound', issue:'#21',
  asserts:'a mutation made while unfiltered shows on the next narrow' }, () => {
  const ext: any = $([0, 100])
  const s: any = $([{ v: 10 }, { v: 20 }, { v: 30 }])
  const b: any = between(s, 'v', ext)
  ext[value] = [-Infinity, Infinity]      // unfilter (alias)
  s.insert({ v: 999 })                    // out-of-range insert while unfiltered
  ext[value] = [0, 100]                   // narrow back
  same(b[value].filter((x: any) => x !== undefined).map((r: any) => r.v), [10, 20, 30]) // 999 excluded, no ghost

  const ext2: any = $([0, 100])
  const s2: any = $([{ v: 10 }, { v: 20 }, { v: 30 }])
  const b2: any = between(s2, 'v', ext2)
  ext2[value] = [-Infinity, Infinity]
  delete s2[1]                            // remove while unfiltered
  ext2[value] = [0, 100]
  same(b2[value].filter((x: any) => x !== undefined).map((r: any) => r.v), [10, 30])
})

// between's raison d'être (crossfilter): a bound move walks `sorted` only over
// the rows it CROSSES, emitting one membership record per crossed row — O(Δ),
// not O(N). On a large source a small move must emit a number of records
// proportional to ROWS CROSSED, and a no-op move (identical bounds) must emit
// nothing. This fails the moment a future change regresses the incremental
// walk to a whole-set XU0 resnapshot (which would emit ~N records). The N=3
// Fidelity specs above can't catch that — here N (40) ≫ Δ. Bounds are inclusive.
spec({ op:'between', guarantee:'Efficiency', trigger:'bound-move', shape:'object', via:['BR1','BI0'], asserts:'a bound move emits records proportional to rows crossed, not source size; a no-op move emits none' }, () => {
  const N = 40
  const obj: any = {}
  for (let i = 0; i < N; i++) obj['k' + i] = { v: i }     // v: 0..39
  const src: any = $(obj)
  const ext: any = $([0, 100])                                  // all 40 in range
  const b: any = between(src, 'v', ext)
  const ch = b.connect([])

  let base = ch.length
  ext[value] = [0, 36]                                     // v > 36 leave: 37, 38, 39 → 3 rows
  same(ch.length - base, 3)                                // 3 records, NOT ~40

  base = ch.length
  ext[value] = [0, 36]                                     // identical bounds — nothing crosses
  same(ch.length - base, 0)

  base = ch.length
  ext[value] = [0, 38]                                     // widen: 37, 38 re-enter → 2 rows
  same(ch.length - base, 2)
})
