// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { spec } from '../../tests/spec.ts'
import { $, value } from '../../core.ts'
import { reverse, ReverseValue } from './index.ts'

spec({ op:'reverse', guarantee:'Order', trigger:'construct', shape:'array', asserts:'an array\'s order is flipped' }, () => {
  const data = $(['a', 'b', 'c', 'd'])
  same(reverse(data)[value], ['d', 'c', 'b', 'a'])
})

spec({ op:'reverse', guarantee:'Order', trigger:'construct', shape:'object', asserts:'an object\'s values flip in iteration order' }, () => {
  const data = $({ x: 1, y: 2, z: 3 })
  same(reverse(data)[value], [3, 2, 1])
})

spec({ op:'reverse', guarantee:'Order', trigger:'insert', shape:'array', asserts:'an insert appears at the front of the reversed view' }, () => {
  const data = $(['a', 'b'])
  const r = reverse(data)
  same(r[value], ['b', 'a'])
  data.insert('c')
  same(r[value], ['c', 'b', 'a'])
})

spec({ op:'reverse', guarantee:'Order', trigger:'remove', shape:'array', asserts:'a remove drops the right row from the reversed view' }, () => {
  const data = $(['a', 'b', 'c'])
  const r = reverse(data)
  same(r[value], ['c', 'b', 'a'])
  delete data[0]
  same(r[value], ['c', 'b'])
})

spec({ op:'reverse', guarantee:'Robustness', trigger:'construct', shape:'array', asserts:'sparse undefined slots are filtered out' }, () => {
  const data = $(['a', undefined, 'c'])
  same(reverse(data)[value], ['c', 'a'])
})

// Over an OBJECT source a new key lands at the END of iteration order, so in
// the reversed view it appears at the FRONT — the BI0 unshift fast path. A
// multi-key patch threads I0 back-to-front so the source-FIRST of the batch
// ends up at output[0]. (The array-insert Order spec is above; this is the
// object counterpart, which only the chained-window keys() test touched.)
spec({ op:'reverse', guarantee:'Order', trigger:'insert', shape:'object', via:['BI0'], asserts:'a new key prepends to the reversed view; a batch keeps back-to-front order' }, () => {
  const d = $({ x: 1, y: 2, z: 3 })
  const r = reverse(d)
  same(r[value], [3, 2, 1])
  d.w = 4
  same(r[value], [4, 3, 2, 1])              // new key at the front
  d.patch(['p', 5, 'q', 6])
  same(r[value], [5, 6, 4, 3, 2, 1])        // source-last 'q'=6 at [1], source-first 'p'=5 at [0]
})

// The BI0 unshift is the only fast path — every other verb falls back to a full
// _rebuild (finding a value's position is O(N) and ambiguous for duplicates).
// Spy on _rebuild to pin BOTH directions of the line-51 isArray guard: an
// OBJECT insert must NOT rebuild, while an ARRAY insert and any object edit MUST.
// (_rebuild reuses this.output, so reference identity can't distinguish the
// paths — a call-count spy is the probe.)
spec({ op:'reverse', guarantee:'Efficiency', trigger:'insert', shape:'object', via:['BI0'], asserts:'an object insert prepends without rebuilding; an array insert and an object edit rebuild' }, () => {
  let rebuilds = 0
  const orig = ReverseValue.prototype._rebuild
  ReverseValue.prototype._rebuild = function (...a) { rebuilds++; return orig.apply(this, a) }
  try {
    const d = $({ a: 1, b: 2, c: 3 })
    const r = reverse(d)
    rebuilds = 0                              // ignore construction
    d.e = 4                                   // object insert → BI0 unshift, no rebuild
    same(r[value], [4, 3, 2, 1])
    same(r[value][0], 4)
    same(rebuilds, 0)

    const arr = $(['a', 'b'])
    const ra = reverse(arr)
    rebuilds = 0
    arr.insert('c')                           // array insert → positional → rebuild
    same(ra[value], ['c', 'b', 'a'])
    same(rebuilds, 1)

    rebuilds = 0
    d.a = 9                                    // object value edit (BU1) → rebuild
    same(rebuilds, 1)
  } finally {
    ReverseValue.prototype._rebuild = orig
  }
})
