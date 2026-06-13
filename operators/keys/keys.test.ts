// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { test } from 'node:test'
import { $, value, createOperator } from '../../core.ts'
import { between } from '../between/index.ts'
import { keys, values } from './index.ts'
import { AZColumnValue } from '../sort/index.ts'
import { reverse } from '../reverse/index.ts'
import { distinct } from '../distinct/index.ts'

test('keys - object: list of property names', () => {
  const data = $({ a: 1, b: 2, c: 3 })
  same(keys(data)[value], ['a', 'b', 'c'])
})

test('keys - reactive: insert appends, remove drops', () => {
  const data = $({ a: 1 })
  const k = keys(data)
  same(k[value], ['a'])
  data.b = 2
  same(k[value], ['a', 'b'])
  delete data.a
  same(k[value], ['b'])
})

test('values - object: list of property values', () => {
  const data = $({ a: 1, b: 2, c: 3 })
  same(values(data)[value], [1, 2, 3])
})

test('values - reactive: updates flow through', () => {
  const data = $({ a: 1, b: 2 })
  const v = values(data)
  same(v[value], [1, 2])
  data.a = 99
  same(v[value], [99, 2])
})

test('keys - works on arrays (returns string indices)', () => {
  const data = $(['x', 'y', 'z'])
  same(keys(data)[value], ['0', '1', '2'])
})

// Regression: keys/values/reverse/distinct chained after a sort window (az/za/
// top/limit) corrupted their output. A row entering the window emits BI0 with a
// POSITIONAL `at` (numeric rank), but these operators only appended on BI0 — so
// keys() produced e.g. ["0","1",0] (a stray numeric index pushed as a "key"),
// and values()/reverse()/distinct() got wrong order/contents. They now rebuild
// on a BI0 from an array upstream (positional inserts), keeping the O(1) append
// only for object (append-at-end) upstreams.
test('keys/values/reverse/distinct stay correct over a sort window', () => {
  const src = $({ a: { v: 40, g: 0 }, b: { v: 10, g: 1 }, c: { v: 90, g: 2 }, d: { v: 50, g: 0 }, e: { v: 20, g: 3 } })
  const win = createOperator(src, AZColumnValue, 'v', 3)   // az('v', 3): 3 lowest by v
  const k = keys(win), vv = values(win), rv = reverse(win), dd = distinct(win, r => r.g)

  // rotate the window with in-place edits (rows enter/leave at positions)
  src.a.v = 5; src.c.v = 15; src.b.v = 99
  const w = win[value].filter(Boolean)
  same(k[value], w.map((_, i) => String(i)))                 // exactly ['0','1','2'] — no stray number
  same(k[value].every(x => typeof x === 'string'), true)
  same(vv[value], w)                                          // values track the window contents/order
  same(rv[value], [...w].reverse())                           // reverse tracks order
  same(dd[value].length, new Set(w.map(r => r.g)).size)       // distinct group count correct

  // a brand-new row that lands inside the window (BI0 at a front position)
  src.f = { v: 1, g: 7 }
  const w2 = win[value].filter(Boolean)
  same(k[value], w2.map((_, i) => String(i)))
  same(vv[value], w2)
})

// Regression (G3 / #30): _rebuild took raw Object.keys/Object.values, which
// include explicit-undefined slots of a sparse object source (between/intersect),
// while the BI0 append fast path skips undefined. Composed, a row leaving then
// re-entering an object-source sparse view showed up TWICE (keys ["a","b","c","c"],
// values [..,undefined,..]). _rebuild now skips undefined slots like the append path.
test('keys/values - leave-then-re-enter over a sparse object source: no duplicate', () => {
  const src = $({ a: { v: 1 }, b: { v: 5 }, c: { v: 9 } })
  const ext = $([0, 10])
  const ranged = between(src, 'v', ext)
  const ks = keys(ranged)
  const vs = values(ranged)
  ext[value] = [0, 6]            // c (v:9) leaves -> explicit-undefined slot
  ext[value] = [0, 10]           // c re-enters
  same(ks[value], ['a', 'b', 'c'])
  same(vs[value].map((r) => r.v), [1, 5, 9])
})
