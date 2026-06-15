// @ts-nocheck
import { deepStrictEqual as same, ok } from 'node:assert'
import { spec } from '../../tests/spec.ts'
import { $, value, view } from '../../core.ts'
import { except } from './index.ts'
import { filter } from '../filter/index.ts'
import { between } from '../between/index.ts'

// Regression (C12): an in-place edit that pushes a row INTO the exclusion left
// it stuck in the output. The facet (a filter) correctly emits an insert when
// its predicate flips, and except's BI0-from-other drops the row — but the
// SAME source edit also fans a BU2 to except's primary, and the base BU2
// default re-materialised the row, undoing the drop. except.BU2 now respects
// exclusion membership (mirrors except's BU1): skip excluded rows, forward the
// rest.
spec({ op:'except', guarantee:'Selection', trigger:'edit', shape:'object', via:['BU2'], issue:'C12', asserts:'an in-place edit pushing a row into the exclusion drops it' }, () => {
  const src = $({ k0: { v: 0 }, k1: { v: 11 }, k2: { v: 22 }, k3: { v: 77 } })
  const res = except(src, filter(src, (r) => r.v > 60))
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined).map(([k, x]) => [k, x.v]))
  same(clean(res[value]), { k0: 0, k1: 11, k2: 22 })   // k3 excluded (v>60)
  src.k1.v = 200                                         // k1 now matches the exclusion
  same(clean(res[value]), { k0: 0, k2: 22 })            // pre-fix: k1 stuck at 200
  src.k1.v = 5                                           // k1 leaves the exclusion again
  same(clean(res[value]), { k0: 0, k1: 5, k2: 22 })     // re-admitted
})

spec({ op:'except', guarantee:'Selection', trigger:'construct', shape:'object', asserts:'rows in the source but not in the other source remain' }, () => {
  const a = $({ 1: 'a', 2: 'b', 3: 'c' })
  const b = $({ 2: 'b' })
  same(except(a, b)[value], { 1: 'a', 3: 'c' })
})

spec({ op:'except', guarantee:'Selection', trigger:'insert', shape:'object', asserts:'adding a row to the exclusion source drops it from output' }, () => {
  const a = $({ 1: 'a', 2: 'b' })
  const b = $({})
  const res = except(a, b)
  same(res[value], { 1: 'a', 2: 'b' })
  b[1] = 'a'
  same(res[value], { 2: 'b' })
})

spec({ op:'except', guarantee:'Selection', trigger:'remove', shape:'object', asserts:'removing a row from the exclusion re-admits it' }, () => {
  const a = $({ 1: 'a', 2: 'b' })
  const b = $({ 1: 'a' })
  const res = except(a, b)
  same(res[value], { 2: 'b' })
  delete b[1]
  same(res[value], { 1: 'a', 2: 'b' })
})

spec({ op:'except', guarantee:'Selection', trigger:'remove', shape:'object', asserts:'removing a row from the source drops it from output' }, () => {
  const a = $({ 1: 'a', 2: 'b', 3: 'c' })
  const b = $({ 1: 'a' })
  const res = except(a, b)
  same(res[value], { 2: 'b', 3: 'c' })
  delete a[2]
  same(res[value], { 3: 'c' })
})

spec({ op:'except', guarantee:'Selection', trigger:'insert', shape:'object', asserts:'an insert into the source appears unless the exclusion has it' }, () => {
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
spec({ op:'except', guarantee:'Alignment', trigger:'insert/remove', shape:'array', via:['BI0A','BR1A'], issue:'C12', chain:'filter→except', asserts:'with a derived exclusion, tail insert and shifting remove stay aligned' }, () => {
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

// Regression (F / #23): except decided a tail insert's admission SOLELY on
// `other`'s echo, justified by "other always echoes a tail insert" — true only
// for a RowOperator other. A between/intersect `other` emits nothing for an
// out-of-range insert, so an admissible row (in p, not in other) was dropped.
// except now also admits on the PRIMARY echo, reading other.value[at].
spec({ op:'except', guarantee:'Selection', trigger:'insert', shape:'array', issue:'#23', chain:'between→except', asserts:'a tail insert outside a between exclusion is admitted' }, () => {
  const s = $([{ v: 10 }, { v: 70 }, { v: 30 }])
  const e = except(s, between(s, 'v', [60, 100]))
  const dense = (a) => a.filter((x) => x !== undefined).map((r) => r.v)
  same(dense(e[value]), [10, 30])     // 70 is in [60,100] -> excluded from except
  s.insert({ v: 20 })                 // not in [60,100] -> must appear
  same(dense(e[value]), [10, 30, 20])
  s.insert({ v: 80 })                 // in [60,100] -> must NOT appear
  same(dense(e[value]), [10, 30, 20])
})

// Like union, except implements NO matches() — each call is a fresh operator
// view (no dedup). The deliberate counterpart to intersect's dedup spec.
spec({ op:'except', guarantee:'Identity', trigger:'dedup-call', shape:'object', asserts:'identical args return a distinct operator view each call (no dedup)' }, () => {
  const a = $({ 1: 'a', 2: 'b' })
  const b = $({ 1: 'a' })
  const r1 = except(a, b)
  const r2 = except(a, b)
  ok(r1[view] !== r2[view])
})

// Change-stream fidelity, mirroring intersect's edit-stream spec: removing a row
// from the exclusion re-admits it as a positional insert, and adding one to the
// exclusion drops it as a remove. Locks the verb mapping, the `at`/key path, and
// that an unrelated exclusion-source edit emits nothing for an already-excluded key.
spec({ op:'except', guarantee:'Fidelity', trigger:'insert/remove', shape:'object', via:['BI0','BR1'], emits:['BI0','BR1'], asserts:'an exclusion remove re-admits as an insert; an exclusion add drops as a remove' }, () => {
  const a = $({ 1: 'a', 2: 'b' })
  const b = $({ 1: 'a' })
  const res = except(a, b)
  const changes = res.connect([])
  same(res[value], { 2: 'b' })         // 1 excluded by b
  delete b[1]                          // 1 leaves the exclusion → re-admitted as an insert
  b[2] = 'b'                           // 2 enters the exclusion → removed
  same(changes, [
    { type: 'update', key: [], value: { 2: 'b' } },
    { type: 'insert', key: [], value: 'a', at: '1' },
    { type: 'remove', key: ['2'], value: 'b' },
  ])
  same(res[value], { 1: 'a' })
})

// Whole-source clears (XR0) from each side: emptying the EXCLUSION re-admits
// every primary row; emptying the PRIMARY collapses the output to {}. Both
// re-derive wholesale (a single update each) rather than churning per-key.
spec({ op:'except', guarantee:'Robustness', trigger:'remove', shape:'object', via:['XR0'], asserts:'clearing the exclusion re-admits all rows; clearing the primary collapses to {}' }, () => {
  const a = $({ 1: 'a', 2: 'b' })
  const b = $({ 1: 'a' })
  const res = except(a, b)
  const ch = res.connect([])
  same(res[value], { 2: 'b' })
  b[value] = {}                        // XR0 from the exclusion → re-admit all of a
  same(res[value], { 1: 'a', 2: 'b' })
  a[value] = {}                        // XR0 from the primary → collapse
  same(res[value], {})
  same(ch, [
    { type: 'update', key: [], value: { 2: 'b' } },
    { type: 'update', key: [], value: { 1: 'a', 2: 'b' } },
    { type: 'update', key: [], value: {} },
  ])
})
