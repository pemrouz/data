// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { spec } from '../../tests/spec.ts'
import { $, value } from '../../core.ts'
import { distinct } from './index.ts'

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
