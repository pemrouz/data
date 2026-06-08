// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { test } from 'node:test'
import { $, value } from '../../core.ts'
import { union } from './index.ts'
import { filter } from '../filter/index.ts'

test('union - rows in any source', () => {
  const a = $({ 1: 'a', 2: 'b' })
  const b = $({ 2: 'b', 3: 'c' })
  const res = union(a, b)
  same(res[value], { 1: 'a', 2: 'b', 3: 'c' })
})

test('union - value comes from first source containing the row', () => {
  // Both a and b have key 2, but with different values. union picks a's.
  const a = $({ 1: 'a1', 2: 'a2' })
  const b = $({ 2: 'b2', 3: 'b3' })
  const res = union(a, b)
  same(res[value], { 1: 'a1', 2: 'a2', 3: 'b3' })
})

test('union - reactive: insert in secondary appears in output', () => {
  const a = $({ 1: 'a' })
  const b = $({ 2: 'b' })
  const res = union(a, b)
  same(res[value], { 1: 'a', 2: 'b' })
  b[3] = 'c'
  same(res[value], { 1: 'a', 2: 'b', 3: 'c' })
})

test('union - reactive: removing from one source keeps row if another has it', () => {
  const a = $({ 1: 'x' })
  const b = $({ 1: 'y' })
  const res = union(a, b)
  same(res[value], { 1: 'x' })   // a wins
  delete a[1]
  same(res[value], { 1: 'y' })   // a gone, b still has it — value flips to 'y'
  delete b[1]
  same(res[value], {})
})

// Regression (C12, array half): union over DERIVED array facets (each a filter
// of one underlying array — the set-algebra shape) used to drift under
// insert/remove churn: an array remove SHIFTS later indices, but union handled
// removes with the object _leave path (no splice), so its per-index bitmask +
// sparse view.value drifted from the (shifting) source and later positional
// events (a tail insert, an in-place edit) hit the wrong slot — a survivor was
// lost. The array-only BI0A/BR1A handlers (structural splice keyed to the
// PRIMARY echo — which for union comes FIRST — plus per-source membership folded
// in from each carried value) fix it. Locks the live view against the obvious
// expected set across a tail insert and a shifting remove.
const denseV = (vp) => (vp[value] || []).filter((r) => r !== undefined).map((r) => r.v)
test('union - array, derived facets: tail insert + shifting remove stay aligned', () => {
  const s = $([{ v: 10 }, { v: 70 }, { v: 20 }, { v: 90 }, { v: 50 }])
  // v > 60 OR v < 30 ⇒ {10,70,20,90} (50 is in neither).
  const res = union(filter(s, (r) => r.v > 60), filter(s, (r) => r.v < 30))
  same(denseV(res).sort((a, b) => a - b), [10, 20, 70, 90])

  // Tail insert that joins the union (> 60).
  s.insert({ v: 80 })
  same(denseV(res).sort((a, b) => a - b), [10, 20, 70, 80, 90])

  // Tail insert in NEITHER facet (30..60) — must not appear.
  s.insert({ v: 45 })
  same(denseV(res).sort((a, b) => a - b), [10, 20, 70, 80, 90])

  // Remove a middle row (index 2 = {v:20}); later indices shift down — the
  // survivors must stay aligned, none lost.
  delete s[2]
  same(denseV(res).sort((a, b) => a - b), [10, 70, 80, 90])

  // Remove the head (index 0 = {v:10}) — pure shift.
  delete s[0]
  same(denseV(res).sort((a, b) => a - b), [70, 80, 90])

  // In-place edit pulling a survivor out of the union still works post-shift.
  // s = [{70},{90},{50},{80},{45}]; push {70} into the dead band.
  s[0].v = 40
  same(denseV(res).sort((a, b) => a - b), [80, 90])
})
