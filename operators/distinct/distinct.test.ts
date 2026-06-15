// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { spec } from '../../tests/spec.ts'
import { $, value } from '../../core.ts'
import { distinct } from './index.ts'
import { between } from '../between/index.ts'

spec({ op:'distinct', guarantee:'Selection', trigger:'construct', shape:'array', asserts:'keeps one row per value, in first-seen order' }, () => {
  const res = $([1, 2, 1, 3, 2, 4])
  same(distinct(res)[value], [1, 2, 3, 4])
})

spec({ op:'distinct', guarantee:'Selection', trigger:'construct', shape:'array', asserts:'a key projection keeps the first row per key' }, () => {
  const res = $([
    { airline: 'AA', flight: 1 },
    { airline: 'UA', flight: 2 },
    { airline: 'AA', flight: 3 },
    { airline: 'DL', flight: 4 },
  ])
  same(distinct(res, r => r.airline)[value], [
    { airline: 'AA', flight: 1 },
    { airline: 'UA', flight: 2 },
    { airline: 'DL', flight: 4 },
  ])
})

spec({ op:'distinct', guarantee:'Selection', trigger:'insert', shape:'array', asserts:'inserting a new key appends it' }, () => {
  const res = $(['a', 'b', 'a'])
  const d = distinct(res)
  same(d[value], ['a', 'b'])
  res.insert('c')
  same(d[value], ['a', 'b', 'c'])
})

spec({ op:'distinct', guarantee:'Selection', trigger:'insert', shape:'array', asserts:'inserting an existing key does not change the output' }, () => {
  const res = $(['a', 'b'])
  const d = distinct(res)
  same(d[value], ['a', 'b'])
  res.insert('a')
  same(d[value], ['a', 'b'])
})

spec({ op:'distinct', guarantee:'Order', trigger:'remove', shape:'object', asserts:'removing a key\'s last row drops it and re-derives first-seen order' }, () => {
  const res = $({ x: 'a', y: 'b', z: 'a' })
  const d = distinct(res)
  same(d[value], ['a', 'b'])
  // After deleting `x`, iteration order is `y, z` so first-seen flips:
  // 'b' is now seen before 'a'.
  delete res.x
  same(d[value], ['b', 'a'])  // 'a' still present via 'z'
  delete res.z
  same(d[value], ['b'])
})

spec({ op:'distinct', guarantee:'Selection', trigger:'edit', shape:'object', via:['BU2'], asserts:'mutating a shared key\'s representative rebuckets without losing the sibling' }, () => {
  // Two rows project to the same key 'x'; the FIRST (the instance cached in
  // the output) is mutated in place to a new key 'y'. Bucket 'x' is still
  // occupied by the sibling, so the output must show one 'y' and one 'x' —
  // not drop 'x' and duplicate 'y'. Before the fix, BU2's _update left the
  // stale representative in `output` (same mutated reference) and pushed it
  // again, yielding [{k:'y'},{k:'y'}] with 'x' lost entirely.
  const res = $({ a: { k: 'x' }, b: { k: 'x' } })
  const d = distinct(res, r => r.k)
  same(d[value], [{ k: 'x' }])              // both collapse to one 'x'
  res.a.k = 'y'                             // mutate the representative in place
  same(d[value], [{ k: 'y' }, { k: 'x' }]) // a→'y' (first-seen), b still 'x'
})

spec({ op:'distinct', guarantee:'Selection', trigger:'edit', shape:'object', via:['BU2'], asserts:'mutating a non-representative keeps the representative and adds the new key' }, () => {
  // Mirror of the above: mutating the SECOND row of the shared bucket must
  // NOT disturb the representative — output keeps 'x' (via a) and adds 'y'.
  const res = $({ a: { k: 'x' }, b: { k: 'x' } })
  const d = distinct(res, r => r.k)
  same(d[value], [{ k: 'x' }])
  res.b.k = 'y'
  same(d[value], [{ k: 'x' }, { k: 'y' }]) // a still represents 'x', b→'y'
})

spec({ op:'distinct', guarantee:'Identity', trigger:'dedup-call', shape:'array', asserts:'the same projection returns the same view' }, () => {
  const res = $([1, 2, 3])
  const fn = d => d
  const a = distinct(res, fn)
  const b = distinct(res, fn)
  same(a[value], b[value])
})

// Change-stream fidelity on the O(1) object path: a duplicate-key insert bumps
// a bucket count only (_insert returns changed=false) so BI0 publishes NOTHING,
// while a fresh-key insert pushes one row and emits a single whole-array update.
// Pins the "redundant insert is a no-op event" guarantee the incremental path
// gives (the array path always rebuilds and re-emits, so this is object-only).
spec({ op:'distinct', guarantee:'Fidelity', trigger:'insert', shape:'object', via:['BI0'], asserts:'a duplicate-key insert emits nothing; a fresh-key insert emits one whole-array update' }, () => {
  const res = $({ a: 'x', b: 'y' })
  const d = distinct(res)
  const changes = d.connect([])
  same(changes, [{ type: 'update', key: [], value: ['x', 'y'] }])   // baseline only
  res.c = 'x'                          // projection duplicates 'x' — no record
  same(changes.length, 1)
  res.d = 'z'                          // fresh projection — one whole-array update
  same(changes, [
    { type: 'update', key: [], value: ['x', 'y'] },
    { type: 'update', key: [], value: ['x', 'y', 'z'] },
  ])
})

spec({ op:'distinct', guarantee:'Robustness', trigger:'construct', shape:'array', asserts:'empty, {} and null sources all yield [] without throwing' }, () => {
  same(distinct($([]))[value], [])
  same(distinct($({}))[value], [])
  same(distinct($(null), r => r.g)[value], [])   // null source — no crash (cf. sort #18)
})

// The projection must never be invoked on a hole — neither a directly-cleared
// slot nor an excluded slot of a sparse producer upstream (between). _rebuild /
// _insert both guard `row === undefined`, so a throwing projection proves the
// guard holds through a slot-clear, a re-insert, and a brush-to-empty.
spec({ op:'distinct', guarantee:'Robustness', trigger:'edit', shape:'array', via:['BF0'], chain:'between→distinct', asserts:'a hole is never handed to the projection, directly or via a sparse producer' }, () => {
  const throwingProj = (r) => { if (r === undefined) throw new Error('projection saw a hole'); return r.g }

  const src = $([{ g: 'g0' }, { g: 'g1' }, { g: 'g2' }])
  const d = distinct(src, throwingProj)
  same(d[value], [{ g: 'g0' }, { g: 'g1' }, { g: 'g2' }])
  src[1] = undefined                   // slot 1 cleared — must be skipped, not projected
  src.insert({ g: 'g3' })
  same(d[value], [{ g: 'g0' }, { g: 'g2' }, { g: 'g3' }])

  const s2 = $([{ v: 30, g: 'a' }, { v: 50, g: 'b' }])
  const ext = $([20, 70])
  const d2 = distinct(between(s2, 'v', ext), throwingProj)
  same(d2[value].map(r => r.g), ['a', 'b'])
  ext[value] = [200, 300]              // brush excludes every row — holes, never projected
  same(d2[value].filter(r => r !== undefined), [])
})
