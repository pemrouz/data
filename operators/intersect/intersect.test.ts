// @ts-nocheck
import { deepStrictEqual as same, ok } from 'node:assert'
import { spec } from '../../tests/spec.ts'
import { $, value, view } from '../../core.ts'
import { intersect } from './index.ts'
import { between } from '../between/index.ts'
import { filter } from '../filter/index.ts'
import { map } from '../map/index.ts'

// Regression: intersect's CONSTRUCTOR seeded its bitmask with `i in res.value`,
// but between/union/except leave EXPLICIT `undefined` at excluded slots (the
// key is present), so an excluded row counted as a member and was wrongly
// admitted. Only bites when the intersect is BUILT over an already-sparse
// source (e.g. a between whose bounds were tightened before the intersect was
// composed). The incremental paths already used `!== undefined`. Surfaced
// building the faceted-library example.
spec({ op:'intersect', guarantee:'Selection', trigger:'construct', shape:'object', via:['reactive-bound'], chain:'between→intersect', asserts:'construction skips explicit-undefined slots of a sparse source' }, () => {
  const m: any = $({ a: { r: 8.3 }, b: { r: 8.6 }, c: { r: 8.5 } })
  const bounds: any = $([8.0, 9.0])
  const hi: any = between(m, 'r', bounds)           // reactive bounds; members a, b, c
  bounds[value] = [8.4, 9.0]                    // a leaves — left behind as undefined
  const dense = (v: any) => Object.keys(v).filter((k: any) => v[k] !== undefined).sort()
  // a is `in hi.value` (key present, value undefined) but NOT a member
  same(hi[value].a, undefined)
  same('a' in hi[value], true)
  // build the intersect AFTER the sparse exclusion exists
  const res: any = intersect(m, hi)
  same(dense(res[value]), ['b', 'c'])
  same(res[value].a, undefined)                // must not be admitted
})

spec({ op:'intersect', guarantee:'Selection', trigger:'edit', shape:'object', via:['BU1','BI0','BR1','XU0'], asserts:'the intersection over object sources tracks inserts, edits and removes' }, () => {
  const a: any = $({ 10: 'a', 20: 'b', 30: 'c' })
  const b: any = $({ 10: 'a', 20: 'b' })
  const res: any = intersect(a, b)
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
spec({ op:'intersect', guarantee:'Selection', trigger:'insert', shape:'object', via:['XU0'], asserts:'a source expanding past construction admits the newly-shared rows' }, () => {
  const a: any = $({ 1: 'a', 2: 'b' })  // narrow primary
  const b: any = $({ 1: 'a', 2: 'b', 3: 'c', 4: 'd' })
  const c: any = $({ 1: 'a', 2: 'b', 3: 'c', 4: 'd' })
  const res: any = intersect(a, b, c)
  same(res[value], { 1: 'a', 2: 'b' })

  // Expand `a` to cover the full set; intersection should pick up the
  // newly-admitted rows because they're in b and c too.
  a[value] = { 1: 'a', 2: 'b', 3: 'c', 4: 'd' }
  same(res[value], { 1: 'a', 2: 'b', 3: 'c', 4: 'd' })

  // Shrink back — only rows still in `a` survive.
  a[value] = { 1: 'a' }
  same(res[value], { 1: 'a' })
})

spec({ op:'intersect', guarantee:'Selection', trigger:'edit', shape:'array', via:['BU1','BI0','BR1','XU0'], asserts:'the intersection over array sources tracks inserts, edits and removes' }, () => {
  const a: any = $(['a', 'b', 'c'])
  const b: any = $(['a', 'b'])
  const res: any = intersect(a, b)
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

// Regression (C12, array half): an intersect over a DERIVED array source —
// every facet is a filter of one underlying array, the crossfilter shape — used
// to desync under insert/remove churn. Two distinct bugs:
//   (1) a tail insert excluded by a secondary facet still got admitted, because
//       the secondary's positional BI0A carries `undefined` for the excluded
//       slot (a hole, not membership) and the object _enter path set the bit
//       unconditionally; and
//   (2) an array remove SHIFTS later indices, but the bitmask/view used object
//       (`delete`/hole) semantics and never spliced, so the index space drifted
//       from the (shifting) source and every later positional event hit the
//       wrong slot.
// The array-only BI0A/BR1A handlers fix both. This locks the live view against a
// from-scratch rebuild across a tail insert (admitted + excluded) and a
// shifting remove. The differential harness covers the same ground across many
// seeds; this is the focused, readable guard.
const denseV = (vp: any) => (vp[value] || []).filter((r: any) => r !== undefined).map((r: any) => r.v)
spec({ op:'intersect', guarantee:'Alignment', trigger:'insert/remove', shape:'array', via:['BI0A','BR1A'], issue:'C12', chain:'filter→intersect', asserts:'with derived facets, tail insert and shifting remove stay aligned' }, () => {
  const s: any = $([{ v: 10 }, { v: 30 }, { v: 50 }, { v: 70 }, { v: 90 }])
  // Two facets derived from s — the crossfilter pattern. 25 < v < 80 ⇒ {30,50,70}.
  const res: any = intersect(s, filter(s, (r: any) => r.v > 25), filter(s, (r: any) => r.v < 80))
  same(denseV(res), [30, 50, 70])

  // Tail insert ADMITTED (passes both facets).
  s.insert({ v: 60 })
  same(denseV(res), [30, 50, 70, 60])

  // Tail insert EXCLUDED by the < 80 facet (bug 1) — must NOT be admitted.
  s.insert({ v: 200 })
  same(denseV(res), [30, 50, 70, 60])

  // Remove a middle row (index 2 = {v:50}); later indices shift down (bug 2).
  delete s[2]
  same(denseV(res), [30, 70, 60])

  // Remove the head (index 0 = {v:10}, not in the intersection) — pure shift.
  delete s[0]
  same(denseV(res), [30, 70, 60])

  // A surviving row leaving via an in-place edit still works post-shift.
  // After the two removes s = [{30},{70},{90},{60},{200}]; bump {30} out of range.
  s[0].v = 5
  same(denseV(res), [70, 60])
})

// Crossfilter "leave-one-out" pattern: dimensions are named once in a plain
// object whose values are derived ViewProxies, then each consumer asks for
// "all dimensions" or "all dimensions except mine". Adding a new dimension
// means adding one entry to dims; existing call sites don't change because
// each names only the dimension to exclude.
spec({ op:'intersect', guarantee:'Selection', trigger:'construct', shape:'object', asserts:'the dims object form intersects all named values' }, () => {
  const source   = $({ 1: 'a', 2: 'b', 3: 'c' })
  const f1       = $({ 1: 'a', 2: 'b' })
  const f2       = $({ 2: 'b', 3: 'c' })
  const dims     = { f1, f2 }
  const res: any = intersect(source, dims)
  // Only key 2 is in source, f1, AND f2.
  same(res[value], { 2: 'b' })
})

spec({ op:'intersect', guarantee:'Selection', trigger:'construct', shape:'object', asserts:'the dims object with a key excludes that dim (leave-one-out)' }, () => {
  const source   = $({ 1: 'a', 2: 'b', 3: 'c' })
  const f1       = $({ 1: 'a', 2: 'b' })
  const f2       = $({ 2: 'b', 3: 'c' })
  const dims     = { f1, f2 }
  // Excluding 'f1' means we intersect source with f2 only.
  // Keys 2 and 3 are in both; key 1 is only in source.
  const res: any = intersect(source, dims, 'f1')
  same(res[value], { 2: 'b', 3: 'c' })
})

spec({ op:'intersect', guarantee:'Identity', trigger:'dedup-call', shape:'object', asserts:'calling with identical args returns the same operator view' }, () => {
  const a: any = $({ 1: 'a', 2: 'b' })
  const b: any = $({ 1: 'a', 2: 'b' })
  // The free function intersect() goes through createOperator which dedups
  // by (class, matches()). Two calls with identical args = one operator.
  const r1: any = intersect(a, b)
  const r2: any = intersect(a, b)
  ok(r1[view] === r2[view])
})

spec({ op:'intersect', guarantee:'Identity', trigger:'dedup-call', shape:'object', asserts:'dims-form with the same key reuses, a different key creates new' }, () => {
  const source: any = $({ 1: 'a', 2: 'b' })
  const f1     = $({ 1: 'a', 2: 'b' })
  const f2     = $({ 1: 'a', 2: 'b' })
  const dims   = { f1, f2 }
  const r1: any = intersect(source, dims, 'f1')
  const r2: any = intersect(source, dims, 'f1')
  const r3: any = intersect(source, dims, 'f2')
  ok(r1[view] === r2[view])      // same key → same view
  ok(r1[view] !== r3[view])      // different key → different view
})

// Regression: nested-key updates (BU2/BR2/BI2) used to fall through to the
// default Operator forwarder because the gating handlers were misnamed
// `R2`/`U2`/`I2`. So a deep update on a row that was excluded from the
// intersection (because it wasn't in some secondary source) would still
// emit a BU2 downstream, leaking events for invisible rows.
spec({ op:'intersect', guarantee:'Fidelity', trigger:'edit', shape:'object', via:['BU2'], asserts:'a deep update on a row excluded from the intersection does not emit' }, () => {
  const a: any = $({ 1: { x: 'a1' }, 2: { x: 'a2' } })
  const b: any = $({ 1: { x: 'b1' } })   // row 2 excluded (not in b)
  const res: any = intersect(a, b)
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
spec({ op:'intersect', guarantee:'Fidelity', trigger:'edit', shape:'object', via:['BU2'], asserts:'a secondary source nested update does not emit' }, () => {
  const a: any = $({ 1: { x: 'a1' } })
  const b: any = $({ 1: { x: 'b1' } })
  const res: any = intersect(a, b)
  const changes = res.connect([])
  b[1].x = 'B1'
  same(changes, [
    { type: 'update', key: [], value: { 1: { x: 'a1' } } },
  ])
})

// Regression (F / #22): the primary BR1A spliced `filters`/`view.value` for a
// pre-holed slot but emitted downstream only `if (oldVal !== undefined)`, so a
// downstream POSITIONAL consumer (here a map) never saw the shift — its length
// drifted and a later keyed edit landed on the wrong slot. The splice is now
// always communicated (record sinks skip the undefined-valued pair).
spec({ op:'intersect', guarantee:'Alignment', trigger:'remove', shape:'array', via:['BR1A'], issue:'#22', chain:'filter→intersect→map', asserts:'a primary remove of a holed slot keeps downstream positions aligned' }, () => {
  const s: any = $([{ v: 10 }, { v: 71 }, { v: 30 }, { v: 55 }, { v: 90 }])
  const i: any = intersect(s, filter(s, (r: any) => r.v >= 30))
  const m: any = map(i, (r: any) => r.v)
  const dense = (a: any) => a.filter((x: any) => x !== undefined)
  same(dense(i[value]).map((r: any) => r.v), [71, 30, 55, 90])
  delete s[0]                       // {v:10} was excluded — a holed-slot primary splice
  same(dense(i[value]).map((r: any) => r.v), [71, 30, 55, 90])
  same(dense(m[value]), [71, 30, 55, 90]) // map stays length-aligned (was longer)
  s[2].v = 56                       // edit a survivor by its post-shift index
  same(dense(i[value]).map((r: any) => r.v), [71, 30, 56, 90])
  same(dense(m[value]), [71, 30, 56, 90])
})

// Regression (F / #27): a duplicate or self source silently bricked the view.
// The constructor keyed `sources` by view but OR'd `all` per argument, so a
// duplicate's entry overwrote the first while `all` still demanded the
// discarded bit — `bits === all` unsatisfiable, output permanently empty.
// Sources are now deduped by view (idempotent: intersecting a set with itself
// or a source twice = the set).
spec({ op:'intersect', guarantee:'Identity', trigger:'construct', shape:'array', issue:'#27', asserts:'a duplicate or self source is idempotent, not empty' }, () => {
  const a: any = $([{ x: 1 }, { x: 2 }])
  const b: any = $([{ y: 1 }, { y: 2 }])
  same(intersect(a, b, b)[value].filter((x: any) => x !== undefined).length, 2) // dup b
  same(intersect(a, a)[value].filter((x: any) => x !== undefined).length, 2)    // self
})
