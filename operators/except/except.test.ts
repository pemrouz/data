// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { test } from 'node:test'
import { $, value } from '../../core.ts'
import { except } from './index.ts'
import { filter } from '../filter/index.ts'

// Regression (C12): an in-place edit that pushes a row INTO the exclusion left
// it stuck in the output. The facet (a filter) correctly emits an insert when
// its predicate flips, and except's BI0-from-other drops the row — but the
// SAME source edit also fans a BU2 to except's primary, and the base BU2
// default re-materialised the row, undoing the drop. except.BU2 now respects
// exclusion membership (mirrors except's BU1): skip excluded rows, forward the
// rest.
test('except - in-place edit into the exclusion drops the row (BU2)', () => {
  const src = $({ k0: { v: 0 }, k1: { v: 11 }, k2: { v: 22 }, k3: { v: 77 } })
  const res = except(src, filter(src, (r) => r.v > 60))
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined).map(([k, x]) => [k, x.v]))
  same(clean(res[value]), { k0: 0, k1: 11, k2: 22 })   // k3 excluded (v>60)
  src.k1.v = 200                                         // k1 now matches the exclusion
  same(clean(res[value]), { k0: 0, k2: 22 })            // pre-fix: k1 stuck at 200
  src.k1.v = 5                                           // k1 leaves the exclusion again
  same(clean(res[value]), { k0: 0, k1: 5, k2: 22 })     // re-admitted
})

test('except - rows in source but not in other', () => {
  const a = $({ 1: 'a', 2: 'b', 3: 'c' })
  const b = $({ 2: 'b' })
  same(except(a, b)[value], { 1: 'a', 3: 'c' })
})

test('except - reactive: adding to `other` drops the row from output', () => {
  const a = $({ 1: 'a', 2: 'b' })
  const b = $({})
  const res = except(a, b)
  same(res[value], { 1: 'a', 2: 'b' })
  b[1] = 'a'
  same(res[value], { 2: 'b' })
})

test('except - reactive: removing from `other` re-admits the row', () => {
  const a = $({ 1: 'a', 2: 'b' })
  const b = $({ 1: 'a' })
  const res = except(a, b)
  same(res[value], { 2: 'b' })
  delete b[1]
  same(res[value], { 1: 'a', 2: 'b' })
})

test('except - reactive: removing from source drops from output', () => {
  const a = $({ 1: 'a', 2: 'b', 3: 'c' })
  const b = $({ 1: 'a' })
  const res = except(a, b)
  same(res[value], { 2: 'b', 3: 'c' })
  delete a[2]
  same(res[value], { 3: 'c' })
})

test('except - reactive: insert into source admits if not in other', () => {
  const a = $({ 1: 'a' })
  const b = $({ 9: 'z' })
  const res = except(a, b)
  same(res[value], { 1: 'a' })
  a[2] = 'b'
  same(res[value], { 1: 'a', 2: 'b' })
  a[9] = 'z'
  same(res[value], { 1: 'a', 2: 'b' })   // 9 is in `other`, so excluded
})

// Regression (C12, array half): except over a DERIVED array source — p is the
// raw array `s` and `other` is a filter of it (the set-difference shape) — used
// to drift under remove churn: an array remove SHIFTS later indices, but except
// dropped/holed by name (object semantics, no splice), so its sparse view.value
// drifted from the (shifting) source and removing an EXCLUDED row deleted a
// drifted VISIBLE one (a survivor vanished). The array-only BR1A (primary `s`
// splices; an `other` echo of the same underlying delete is a no-op) + BI0A
// (visibility decided from `other`'s carried membership) fix it. Locks the live
// view across tail inserts (admitted + excluded) and shifting removes.
const denseV = (vp) => (vp[value] || []).filter((r) => r !== undefined).map((r) => r.v)
test('except - array, derived `other`: tail insert + shifting remove stay aligned', () => {
  const s = $([{ v: 10 }, { v: 70 }, { v: 20 }, { v: 90 }, { v: 50 }])
  // rows NOT in `other` (v > 60) ⇒ v ≤ 60 ⇒ {10,20,50}.
  const res = except(s, filter(s, (r) => r.v > 60))
  same(denseV(res).sort((a, b) => a - b), [10, 20, 50])

  // Tail insert ADMITTED (≤ 60, not in other).
  s.insert({ v: 40 })
  same(denseV(res).sort((a, b) => a - b), [10, 20, 40, 50])

  // Tail insert EXCLUDED (> 60, in other) — must NOT appear.
  s.insert({ v: 80 })
  same(denseV(res).sort((a, b) => a - b), [10, 20, 40, 50])

  // Remove an EXCLUDED middle row (index 3 = {v:90}); later indices shift down —
  // no visible survivor may be lost (the seed-42 desync).
  delete s[3]
  same(denseV(res).sort((a, b) => a - b), [10, 20, 40, 50])

  // Remove a VISIBLE middle row (index 2 = {v:20}); pure shift.
  delete s[2]
  same(denseV(res).sort((a, b) => a - b), [10, 40, 50])

  // In-place edit pushing a survivor INTO the exclusion still works post-shift.
  // s = [{10},{70},{50},{40},{80}]; bump {10} above 60.
  s[0].v = 75
  same(denseV(res).sort((a, b) => a - b), [40, 50])
})
