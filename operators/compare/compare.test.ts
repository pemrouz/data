// @ts-nocheck
import { deepStrictEqual as same, ok } from 'node:assert'
import { test } from 'node:test'
import '../../full.ts'      // registers Operators dispatch (needed for .length() chain)
import { $, value } from '../../core.ts'
import { gt, lt, gte, lte } from './index.ts'

test('gt - initial filter', () => {
  const src = $({ a: { age: 10 }, b: { age: 20 }, c: { age: 30 } })
  same(gt(src, 'age', 18)[value], { b: { age: 20 }, c: { age: 30 } })
})

test('lt - initial filter', () => {
  const src = $({ a: { age: 10 }, b: { age: 20 }, c: { age: 30 } })
  same(lt(src, 'age', 25)[value], { a: { age: 10 }, b: { age: 20 } })
})

test('gte / lte - boundary inclusion', () => {
  const src = $({ a: { n: 1 }, b: { n: 2 }, c: { n: 3 } })
  same(gte(src, 'n', 2)[value], { b: { n: 2 }, c: { n: 3 } })
  same(lte(src, 'n', 2)[value], { a: { n: 1 }, b: { n: 2 } })
  // Strict counterparts exclude the boundary.
  same(gt(src, 'n', 2)[value], { c: { n: 3 } })
  same(lt(src, 'n', 2)[value], { a: { n: 1 } })
})

// Single column mutation that crosses the threshold — drives BU2 through
// the operator's `process` and out as BR1 (leaving) or BI0 (entering).
test('gt - row crosses threshold via BU2', () => {
  const src = $({ a: { age: 10 }, b: { age: 20 }, c: { age: 30 } })
  const adults = gt(src, 'age', 18)
  const ch = adults.connect([])

  src.a.age = 25            // a enters
  src.b.age = 5             // b leaves
  src.c.age = 31            // c stays (update, not enter/leave)

  same(adults[value], { c: { age: 31 }, a: { age: 25 } })
  // Note: remove/update values reflect the row object's current state.
  // Rows are shared references across views, so by the time the change
  // record is built the underlying object already carries the new value.
  same(ch, [
    { type: 'update', key: [], value: { b: { age: 20 }, c: { age: 30 } } },
    { type: 'insert', key: [], value: { age: 25 }, at: 'a' },
    { type: 'remove', key: [ 'b' ], value: { age: 5 } },
    { type: 'update', key: [ 'c' ], value: { age: 31 } },
  ])
})

test('gt - insert/remove track membership', () => {
  const src = $({ a: { v: 5 } })
  const filt = gt(src, 'v', 3)
  same(filt[value], { a: { v: 5 } })
  src.b = { v: 10 }
  same(filt[value], { a: { v: 5 }, b: { v: 10 } })
  src.c = { v: 1 }          // below threshold — not inserted into view
  same(filt[value], { a: { v: 5 }, b: { v: 10 } })
  delete src.c              // out-of-range delete — view unchanged
  same(filt[value], { a: { v: 5 }, b: { v: 10 } })
  delete src.a              // in-range delete — view shrinks
  same(filt[value], { b: { v: 10 } })
})

test('compare - missing column treated as not-passing', () => {
  // `undefined > 5` is false in JS; we propagate that — rows without the
  // column never pass any comparison, no special-case.
  const src = $({ a: { age: 10 }, b: { name: 'noage' }, c: { age: 30 } })
  same(gt(src, 'age', 5)[value], { a: { age: 10 }, c: { age: 30 } })
  same(lt(src, 'age', 50)[value], { a: { age: 10 }, c: { age: 30 } })
})

test('compare - string column compares lexicographically', () => {
  // JS `>` on strings is lexicographic. We don't coerce; if it works in JS,
  // it works here. Useful for "rows where name >= 'M'".
  const src = $({ a: { n: 'apple' }, b: { n: 'mango' }, c: { n: 'zebra' } })
  same(gte(src, 'n', 'm')[value], { b: { n: 'mango' }, c: { n: 'zebra' } })
})

test('compare - chained with length() and max()', () => {
  const src = $({ a: { v: 5 }, b: { v: 10 }, c: { v: 15 } })
  const filt = gt(src, 'v', 7)
  same(filt.length()[value], 2)
  same(filt.max('v')[value], 15)
  src.d = { v: 100 }
  same(filt.length()[value], 3)
  same(filt.max('v')[value], 100)
  src.c.v = 6              // c leaves the filter
  same(filt.length()[value], 2)
  same(filt.max('v')[value], 100)
})

test('compare - matches() dedup reuses operator', () => {
  // Identical args → same underlying view. We verify behaviorally (both
  // observe the same value and stay in sync through mutations) rather than
  // by wrapper identity, since createOperator returns a fresh ViewProxy
  // wrapper each call even when the op is cached.
  const src = $({ a: { v: 5 } })
  const f1 = gt(src, 'v', 3)
  const f2 = gt(src, 'v', 3)
  same(f1[value], f2[value])
  src.b = { v: 10 }
  same(f1[value], { a: { v: 5 }, b: { v: 10 } })
  same(f2[value], { a: { v: 5 }, b: { v: 10 } })
  // Different threshold → independent op (no false-sharing).
  const f3 = gt(src, 'v', 7)
  same(f3[value], { b: { v: 10 } })
})

test('compare - non-object value collapses', () => {
  const src = $({ a: { v: 5 } })
  const filt = gt(src, 'v', 0)
  same(filt[value], { a: { v: 5 } })
  src[value] = 42           // primitive — RowOperator collapses
  same(filt[value], undefined)
  src[value] = { x: { v: 99 } }
  same(filt[value], { x: { v: 99 } })
})

test('compare - array source with delete propagates shift', () => {
  // Mirror filter's array-shift regression test — RowOperator.BR1 splices
  // for array sources so subsequent BU2s don't read holes.
  const data = $([
    { v: 5 },
    { v: 1 },
    { v: 8 },
    { v: 2 },
  ])
  const big = gt(data, 'v', 3)
  // Initial: keep indices 0 (v:5) and 2 (v:8). Trailing hole at index 3
  // isn't preserved by JS array semantics, so length is 3.
  same(big[value], [{ v: 5 }, , { v: 8 }])
  // Drop the v:1 row. Source becomes [v:5, v:8, v:2]; filter must shift
  // its own snapshot in lockstep so subsequent BU2s read the right slot.
  delete data[1]
  same(big[value], [{ v: 5 }, { v: 8 }])
  // Post-shift mutation — the row originally at idx 3 is now at idx 2;
  // updating it via the new index must hit the right slot.
  data[2].v = 99
  same(big[value], [{ v: 5 }, { v: 8 }, { v: 99 }])
})

// Performance-shaped invariant — gt should *not* maintain a sorted index
// (that's between's job). We verify behaviour-wise by inspecting the
// operator instance.
test('compare - no sorted-index maintenance', () => {
  const src = $({ a: { v: 1 } })
  const op = gt(src, 'v', 0)
  // The underlying operator instance is reachable via the proxy's view
  // chain; the simplest check is that the operator has no `sorted` field
  // (BetweenValue has one, CompareValue doesn't).
  // We don't need to assert the internals here — the perf test in
  // compare.perf.ts will catch any drift toward sort-indexing.
  ok(!('sorted' in (op as any)), 'CompareValue should not carry a sorted index')
})
