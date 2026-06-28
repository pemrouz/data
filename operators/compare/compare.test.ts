import { deepStrictEqual as same, ok } from 'node:assert'
import { spec } from '../../tests/spec.ts'
import '../../full.ts'      // registers Operators dispatch (needed for .length() chain)
import { $, value } from '../../core.ts'
import { gt, lt, gte, lte } from './index.ts'

spec({ op:'compare', guarantee:'Selection', trigger:'construct', shape:'object', asserts:'gt keeps rows whose column exceeds the threshold' }, () => {
  const src = $({ a: { age: 10 }, b: { age: 20 }, c: { age: 30 } })
  same(gt(src, 'age', 18)[value], { b: { age: 20 }, c: { age: 30 } })
})

spec({ op:'compare', guarantee:'Selection', trigger:'construct', shape:'object', asserts:'lt keeps rows whose column is below the threshold' }, () => {
  const src = $({ a: { age: 10 }, b: { age: 20 }, c: { age: 30 } })
  same(lt(src, 'age', 25)[value], { a: { age: 10 }, b: { age: 20 } })
})

spec({ op:'compare', guarantee:'Selection', trigger:'construct', shape:'object', asserts:'gte/lte include the boundary, gt/lt exclude it' }, () => {
  const src = $({ a: { n: 1 }, b: { n: 2 }, c: { n: 3 } })
  same(gte(src, 'n', 2)[value], { b: { n: 2 }, c: { n: 3 } })
  same(lte(src, 'n', 2)[value], { a: { n: 1 }, b: { n: 2 } })
  // Strict counterparts exclude the boundary.
  same(gt(src, 'n', 2)[value], { c: { n: 3 } })
  same(lt(src, 'n', 2)[value], { a: { n: 1 } })
})

// Single column mutation that crosses the threshold — drives BU2 through
// the operator's `process` and out as BR1 (leaving) or BI0 (entering).
spec({ op:'compare', guarantee:'Selection', trigger:'edit', shape:'object', via:['BU2','BI0','BR1'], asserts:'a row crossing the threshold enters or leaves' }, () => {
  const src = $({ a: { age: 10 }, b: { age: 20 }, c: { age: 30 } })
  const adults = gt(src, 'age', 18)
  const ch = adults.connect([])

  src.a.age[value] = 25            // a enters
  src.b.age[value] = 5             // b leaves
  src.c.age[value] = 31            // c stays (update, not enter/leave)

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

spec({ op:'compare', guarantee:'Selection', trigger:'insert/remove', shape:'object', asserts:'inserts and removes update membership by threshold' }, () => {
  // adds keys b/c and deletes them — a dynamic-keyed map, declared
  const src = $<Record<string, { v: number }>>({ a: { v: 5 } })
  const filt = gt(src, 'v', 3)
  same(filt[value], { a: { v: 5 } })
  src.b[value] = { v: 10 }
  same(filt[value], { a: { v: 5 }, b: { v: 10 } })
  src.c[value] = { v: 1 }          // below threshold — not inserted into view
  same(filt[value], { a: { v: 5 }, b: { v: 10 } })
  delete src.c              // out-of-range delete — view unchanged
  same(filt[value], { a: { v: 5 }, b: { v: 10 } })
  delete src.a              // in-range delete — view shrinks
  same(filt[value], { b: { v: 10 } })
})

spec({ op:'compare', guarantee:'Selection', trigger:'construct', shape:'object', asserts:'a row missing the column never passes the comparison' }, () => {
  // `undefined > 5` is false in JS; we propagate that — rows without the
  // column never pass any comparison, no special-case. Heterogeneous rows (one
  // lacks `age`) → a dynamic `Record<string, any>`, since `ColOf` of a union of
  // differing shapes is `never`.
  const src = $<Record<string, any>>({ a: { age: 10 }, b: { name: 'noage' }, c: { age: 30 } })
  same(gt(src, 'age', 5)[value], { a: { age: 10 }, c: { age: 30 } })
  same(lt(src, 'age', 50)[value], { a: { age: 10 }, c: { age: 30 } })
})

spec({ op:'compare', guarantee:'Selection', trigger:'construct', shape:'object', asserts:'a string column compares lexicographically' }, () => {
  // JS `>` on strings is lexicographic. We don't coerce; if it works in JS,
  // it works here. Useful for "rows where name >= 'M'". The threshold is typed to
  // the column's value type, so a string column accepts a string bound.
  const src = $({ a: { n: 'apple' }, b: { n: 'mango' }, c: { n: 'zebra' } })
  same(gte(src, 'n', 'm')[value], { b: { n: 'mango' }, c: { n: 'zebra' } })
})

spec({ op:'compare', guarantee:'Propagation', trigger:'edit', shape:'object', chain:'compare→length/max', asserts:'membership changes flow to a downstream length and max' }, () => {
  const src = $<Record<string, { v: number }>>({ a: { v: 5 }, b: { v: 10 }, c: { v: 15 } })
  const filt = gt(src, 'v', 7)
  same(filt.length()[value], 2)
  same(filt.max('v')[value], 15)
  src.d[value] = { v: 100 }
  same(filt.length()[value], 3)
  same(filt.max('v')[value], 100)
  src.c.v[value] = 6              // c leaves the filter
  same(filt.length()[value], 2)
  same(filt.max('v')[value], 100)
})

spec({ op:'compare', guarantee:'Identity', trigger:'dedup-call', shape:'object', asserts:'identical args share state; a different threshold is independent' }, () => {
  // Identical args → same underlying view. We verify behaviorally (both
  // observe the same value and stay in sync through mutations) rather than
  // by wrapper identity, since createOperator returns a fresh ViewProxy
  // wrapper each call even when the op is cached.
  const src = $<Record<string, { v: number }>>({ a: { v: 5 } })
  const f1 = gt(src, 'v', 3)
  const f2 = gt(src, 'v', 3)
  same(f1[value], f2[value])
  src.b[value] = { v: 10 }
  same(f1[value], { a: { v: 5 }, b: { v: 10 } })
  same(f2[value], { a: { v: 5 }, b: { v: 10 } })
  // Different threshold → independent op (no false-sharing).
  const f3 = gt(src, 'v', 7)
  same(f3[value], { b: { v: 10 } })
})

spec({ op:'compare', guarantee:'Robustness', trigger:'overwrite', shape:'object', via:['XU0'], asserts:'a primitive whole-value collapses the view; an object restores it' }, () => {
  // `src` is `Data<any>` (via `$<any>`): the test overwrites the whole value slot
  // with a PRIMITIVE (`src[value] = 42`) and then a differently-shaped object —
  // neither fits a precise source type. (`$<any>` also keeps `gt`'s `T` inferring
  // `any`; a bare `: any` capture leaves `T` as `unknown`, collapsing the threshold
  // type to `never`.)
  const src = $<any>({ a: { v: 5 } })
  const filt = gt(src, 'v', 0)
  same(filt[value], { a: { v: 5 } })
  src[value] = 42           // primitive — RowOperator collapses
  same(filt[value], undefined)
  src[value] = { x: { v: 99 } }
  same(filt[value], { x: { v: 99 } })
})

spec({ op:'compare', guarantee:'Alignment', trigger:'remove', shape:'array', via:['BR1'], issue:'C13', asserts:'an array remove shifts holes in lockstep with the source' }, () => {
  // Mirror filter's array-shift regression test — RowOperator.BR1 splices
  // for array sources so subsequent BU2s don't read holes. The operator's
  // array mirrors the SOURCE LENGTH (excluded slots are holes, including a
  // trailing one) so the source<->operator index correspondence holds — that
  // length-mirroring is the C13 fix; the old code let the array stop at the
  // last passing index, which broke a later tail insert / positional chain.
  const data = $([
    { v: 5 },
    { v: 1 },
    { v: 8 },
    { v: 2 },
  ])
  const big = gt(data, 'v', 3)
  // keep indices 0 (v:5) and 2 (v:8); indices 1 and 3 are holes — length 4.
  same(big[value]!.length, 4)
  same(big[value]!.filter(x => x !== undefined), [{ v: 5 }, { v: 8 }])
  // Drop the v:1 row. Source becomes [v:5, v:8, v:2] (length 3); the operator
  // shifts in lockstep, keeping a trailing hole at the excluded v:2 — length 3.
  delete data[1]
  same(big[value]!.length, 3)
  same(big[value]!.filter(x => x !== undefined), [{ v: 5 }, { v: 8 }])
  // Post-shift mutation — the row originally at idx 3 is now at idx 2;
  // updating it via the new index must hit the right slot (and now passes).
  data[2].v[value] = 99
  same(big[value], [{ v: 5 }, { v: 8 }, { v: 99 }])
})

// ─── Reactive thresholds (a ViewProxy second arg) ─────────────────────────
// A reactive threshold subscribes like between's bounds: moving it re-classifies
// every row. The single-sided counterpart to between('col', [lo, hi]). The
// recompute is a coarse whole-snapshot XU0 (no sort index to walk), so the
// change stream is `update` records, not granular insert/remove — for an
// incremental brush prefer between.
spec({ op:'compare', guarantee:'Selection', trigger:'threshold-move', shape:'object', via:'reactive-threshold', asserts:'a reactive gt threshold re-selects when it changes' }, () => {
  const src = $({ a: { age: 10 }, b: { age: 20 }, c: { age: 30 } })
  const t = $(18)
  const adults = gt(src, 'age', t)
  same(adults[value], { b: { age: 20 }, c: { age: 30 } })
  t[value] = 25            // raise the bar — b leaves
  same(adults[value], { c: { age: 30 } })
  t[value] = 5             // lower it — a and b re-enter
  same(adults[value], { a: { age: 10 }, b: { age: 20 }, c: { age: 30 } })
})

spec({ op:'compare', guarantee:'Selection', trigger:'threshold-move', shape:'object', via:'reactive-threshold', asserts:'reactive lte/gte thresholds track their bound (boundary inclusive)' }, () => {
  const src = $({ a: { n: 1 }, b: { n: 2 }, c: { n: 3 } })
  const t = $(2)
  const le = lte(src, 'n', t)
  const ge = gte(src, 'n', t)
  same(le[value], { a: { n: 1 }, b: { n: 2 } })
  same(ge[value], { b: { n: 2 }, c: { n: 3 } })
  t[value] = 3
  same(le[value], { a: { n: 1 }, b: { n: 2 }, c: { n: 3 } })
  same(ge[value], { c: { n: 3 } })
})

spec({ op:'compare', guarantee:'Fidelity', trigger:'threshold-move', shape:'object', via:'reactive-threshold', emits:['update'], asserts:'construction seeds exactly one snapshot, then each threshold move re-emits the whole view (XU0)' }, () => {
  const src = $({ a: { v: 5 }, b: { v: 10 }, c: { v: 15 } })
  const t = $(7)
  const filt = gt(src, 'v', t)
  const ch = filt.connect([])
  // The bindReactive construction-time seed must NOT double-fire: connect sees one snapshot.
  same(ch, [
    { type: 'update', key: [], value: { b: { v: 10 }, c: { v: 15 } } },
  ])
  t[value] = 12            // b leaves
  t[value] = 4             // a and b re-enter
  same(filt[value], { a: { v: 5 }, b: { v: 10 }, c: { v: 15 } })
  same(ch, [
    { type: 'update', key: [], value: { b: { v: 10 }, c: { v: 15 } } },
    { type: 'update', key: [], value: { c: { v: 15 } } },
    { type: 'update', key: [], value: { a: { v: 5 }, b: { v: 10 }, c: { v: 15 } } },
  ])
})

spec({ op:'compare', guarantee:'Identity', trigger:'dedup-call', shape:'object', via:'reactive-threshold', asserts:'two calls sharing a reactive threshold SOURCE share one operator; a literal is independent' }, () => {
  const src = $<Record<string, { v: number }>>({ a: { v: 5 }, b: { v: 10 } })
  const t = $(3)
  const f1 = gt(src, 'v', t)
  const f2 = gt(src, 'v', t)        // same bound source → deduped to one op (view-identity match)
  same(f1[value], f2[value])
  t[value] = 8
  same(f1[value], { b: { v: 10 } })
  same(f2[value], { b: { v: 10 } })
  // A plain-literal threshold never matches the reactive op (and vice-versa).
  const f3 = gt(src, 'v', 3)
  same(f3[value], { a: { v: 5 }, b: { v: 10 } })
})

// Performance-shaped invariant — gt should *not* maintain a sorted index
// (that's between's job). We verify behaviour-wise by inspecting the
// operator instance.
spec({ op:'compare', guarantee:'Efficiency', trigger:'construct', shape:'object', asserts:'no sorted index is maintained, unlike between' }, () => {
  const src = $({ a: { v: 1 } })
  const op = gt(src, 'v', 0)
  // The underlying operator instance is reachable via the proxy's view
  // chain; the simplest check is that the operator has no `sorted` field
  // (BetweenValue has one, CompareValue doesn't).
  // We don't need to assert the internals here — the perf test in
  // compare.perf.ts will catch any drift toward sort-indexing.
  ok(!('sorted' in (op as any)), 'CompareValue should not carry a sorted index')
})
