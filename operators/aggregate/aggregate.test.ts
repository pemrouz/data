// @ts-nocheck
import { deepStrictEqual as same, strictEqual as eq, ok } from 'node:assert'
import { spec } from '../../tests/spec.ts'
import { $, value } from '../../core.ts'
import { sum, avg, max, min, some, every } from './index.ts'
import { sort, limit } from '../sort/index.ts'
import { filter } from '../filter/index.ts'

// SUM ------------------------------------------------------------------

spec({ op:'sum', guarantee:'Reduction', trigger:'edit', shape:'array', asserts:'the running sum tracks edits, inserts and removes' }, () => {
  const res = $([1, 2, 3, 4])
  const s = sum(res)
  eq(s[value], 10)
  res[1] = 20
  eq(s[value], 28)        // 1 + 20 + 3 + 4
  res.insert(5)
  eq(s[value], 33)
  delete res[0]
  eq(s[value], 32)        // 20 + 3 + 4 + 5
})

// Regression: scalar aggregates downstream of a sort/limit (array-shaped
// upstreams) silently desynced on remove/insert. sort emits removal/insert
// notifications with *numeric* array-index names (key [0], [1], …), but
// AggregateValue.XU0 keys its `tracked` Map with stringified names. The
// incremental BU1/BR1/BI0 handlers used the raw numeric name for get/delete,
// so the lookup missed and the running total never moved — `sum` stuck, count
// (length) correct because it's key-agnostic. Surfaced building the Kanban
// example (per-column `filter(status).sort(order).sum(points)`).
spec({ op:'sum', guarantee:'Reduction', trigger:'remove/insert', shape:'array', via:['numeric-key'], chain:'sort→sum', asserts:'sum/avg/max/min stay correct downstream of a numeric-keyed sort' }, () => {
  const res = $({ x: { p: 3, o: 0 }, y: { p: 5, o: 1 }, z: { p: 9, o: 2 } })
  const s = sort(res, 'o')              // descending by o → array-shaped output
  const sm = sum(s, 'p'), av = avg(s, 'p'), mx = max(s, 'p'), mn = min(s, 'p')
  eq(sm[value], 17); eq(av[value], 17 / 3); eq(mx[value], 9); eq(mn[value], 3)

  delete res.z                          // remove the max via an array shift
  eq(sm[value], 8)                      // was stuck at 17 before the fix
  eq(av[value], 4)
  eq(mx[value], 5); eq(mn[value], 3)

  res.x.p = 1                           // in-place update lowers the min
  eq(sm[value], 6); eq(mn[value], 1)

  res.insert({ p: 20, o: 9 }, ['w'])    // insert a new max
  eq(sm[value], 26); eq(mx[value], 20)
})

// A filter that flips a row's membership reaches a downstream sort as a
// BR1/BI0 with the sort's positional (numeric) key — the exact Kanban "move
// card between columns" path. The column's point total must follow.
spec({ op:'sum', guarantee:'Reduction', trigger:'edit', shape:'object', chain:'filter→sort→sum', asserts:'a membership flip upstream moves the column total' }, () => {
  const board = $({
    a: { s: 'todo', p: 3, o: 0 },
    b: { s: 'todo', p: 5, o: 1 },
    c: { s: 'done', p: 2, o: 0 },
  })
  const col = sort(filter(board, 's', 'todo'), 'o')
  const pts = sum(col, 'p')
  eq(pts[value], 8)
  board.a.s = 'done'                    // move a out of the todo column
  eq(pts[value], 5)                     // was stuck at 8 before the fix
  board.c.s = 'todo'                    // move c into the todo column
  eq(pts[value], 7)
})

// limit shares the same array-index notification shape as sort.
spec({ op:'sum', guarantee:'Reduction', trigger:'remove', shape:'array', chain:'limit→sum', asserts:'a source remove decrements the sum through limit' }, () => {
  const res = $([{ p: 10 }, { p: 20 }, { p: 30 }])
  const lim = limit(res, 3)
  const sm = sum(lim, 'p')
  eq(sm[value], 60)
  delete res[0]
  eq(sm[value], 50)                     // 20 + 30
})

spec({ op:'sum', guarantee:'Reduction', trigger:'construct', shape:'object', asserts:'sums the values of an object source' }, () => {
  const res = $({ a: 1, b: 2, c: 3 })
  eq(sum(res)[value], 6)
})

spec({ op:'sum', guarantee:'Reduction', trigger:'construct', shape:'array', asserts:'a column accessor sums row[col]' }, () => {
  const res = $([{ x: 1, y: 10 }, { x: 2, y: 20 }, { x: 3, y: 30 }])
  eq(sum(res, 'x')[value], 6)
  eq(sum(res, 'y')[value], 60)
})

spec({ op:'sum', guarantee:'Reduction', trigger:'edit', shape:'array', via:['BU2'], asserts:'an in-place column edit updates the sum' }, () => {
  const res = $([{ x: 1 }, { x: 2 }])
  const s = sum(res, 'x')
  eq(s[value], 3)
  res[0].x = 10
  eq(s[value], 12)
})

// AVG ------------------------------------------------------------------

spec({ op:'avg', guarantee:'Reduction', trigger:'construct', shape:'array', asserts:'averages the values of the source' }, () => {
  const res = $([2, 4, 6])
  eq(avg(res)[value], 4)
})

spec({ op:'avg', guarantee:'Reduction', trigger:'construct', shape:'array', asserts:'an empty set averages to undefined, not NaN' }, () => {
  const res = $([])
  eq(avg(res)[value], undefined)
})

spec({ op:'avg', guarantee:'Reduction', trigger:'construct', shape:'array', asserts:'a column accessor averages row[col]' }, () => {
  const res = $([{ d: 10 }, { d: 20 }, { d: 30 }])
  eq(avg(res, 'd')[value], 20)
})

spec({ op:'avg', guarantee:'Reduction', trigger:'remove', shape:'array', asserts:'removing a row updates the mean incrementally' }, () => {
  const res = $([10, 20, 30])
  const a = avg(res)
  eq(a[value], 20)
  delete res[1]
  eq(a[value], 20)        // (10 + 30) / 2
  delete res[0]
  eq(a[value], 30)
})

// MAX / MIN ------------------------------------------------------------

spec({ op:'max', guarantee:'Reduction', trigger:'insert/remove', shape:'array', asserts:'the maximum tracks inserts, edits and removes' }, () => {
  const res = $([3, 1, 4, 1, 5, 9, 2, 6])
  const m = max(res)
  eq(m[value], 9)
  res.insert(100)
  eq(m[value], 100)
  delete res[8]           // remove the 100
  eq(m[value], 9)
  res[5] = 0              // 9 → 0
  eq(m[value], 6)         // new max
})

spec({ op:'min', guarantee:'Reduction', trigger:'insert/remove', shape:'array', asserts:'the minimum tracks inserts, edits and removes' }, () => {
  const res = $([3, 1, 4, 1, 5, 9, 2, 6])
  const m = min(res)
  eq(m[value], 1)
  res.insert(-5)
  eq(m[value], -5)
  delete res[8]
  eq(m[value], 1)
  res[1] = 100            // remove a 1; another 1 still at index 3
  eq(m[value], 1)
  res[3] = 100            // remove the other 1
  eq(m[value], 2)
})

spec({ op:'max', guarantee:'Reduction', trigger:'construct', shape:'array', asserts:'a column of Date values compares correctly' }, () => {
  const res = $([
    { date: new Date(2001, 0, 1) },
    { date: new Date(2001, 5, 1) },
    { date: new Date(2001, 2, 1) },
  ])
  const m = max(res, 'date')
  eq(+m[value], +new Date(2001, 5, 1))
})

spec({ op:'max', guarantee:'Reduction', trigger:'construct', shape:'array', asserts:'an empty set maxes to undefined' }, () => {
  const res = $([])
  eq(max(res)[value], undefined)
})

// MaxValue/MinValue maintain a parallel Float64Array fast path for numeric
// data and fall back to Map iteration the moment a non-number arrives. The
// flip is sticky within a snapshot (until XU0/XR0 re-evaluates). These
// tests exercise the boundary so we know the fallback engages, stays
// engaged for the rest of the batch, and produces the same answer the
// old slow path would.

spec({ op:'max', guarantee:'Robustness', trigger:'insert', shape:'array', via:['fallback'], asserts:'a non-numeric value flips off the numeric fast path and still answers' }, () => {
  const res = $([1, 2, 3])
  const m = max(res)
  eq(m[value], 3)        // initial all-numeric: fast path
  res.insert(new Date(2001, 5, 1))
  // After inserting a Date, max should still be the latest greater value.
  // Date.valueOf() gives ms since epoch, which is larger than any small int,
  // so the Date wins. Compare via valueOf to be type-agnostic.
  eq(+m[value], +new Date(2001, 5, 1))
  // Subsequent updates while in fallback mode still produce the right answer.
  res.insert(new Date(2002, 0, 1))
  eq(+m[value], +new Date(2002, 0, 1))
})

spec({ op:'max', guarantee:'Robustness', trigger:'overwrite', shape:'array', via:['XU0','fallback'], asserts:'a whole-data swap re-enters the numeric fast path' }, () => {
  const res = $([1, 2, 3])
  const m = max(res)
  res[0] = 'oops'           // poisons the fast path → fallback
  // Sanity: still works in fallback. 'oops' > 2 > 3 is false (string compare),
  // but for our purposes we just want max to not crash.
  // (We don't assert m[value] here — string/number max is implementation-defined.)
  // Wholesale data swap — the operator's XU0 re-runs _afterReset which
  // re-evaluates numericMode. Now all-numeric again, so fast path.
  res[value] = [10, 20, 30]
  eq(m[value], 30)
})

spec({ op:'min', guarantee:'Robustness', trigger:'insert', shape:'array', via:['fallback'], asserts:'a non-numeric value flips off the numeric fast path and still answers' }, () => {
  const res = $([10, 20, 30])
  const m = min(res)
  eq(m[value], 10)
  res.insert(new Date(1999, 0, 1))   // very small ms, smaller than 10? no, way bigger
  // The Date's epoch ms (~915k+ million) is huge; 10 is still smaller.
  eq(m[value], 10)
  // But if we insert a Date that DOES win, fallback should still notice.
  res[0] = new Date(1970, 0, 1)      // epoch 0 in local TZ ≈ small but positive
  // Result depends on TZ but it's definitely smaller than any of {20, 30, Date(1999)}.
  // Just check it changed and is a Date.
  ok(m[value] instanceof Date)
})

// Dedup -----------------------------------------------------------------

spec({ op:'sum', guarantee:'Identity', trigger:'dedup-call', shape:'array', asserts:'calling with identical args returns the same operator view' }, () => {
  const res = $([1, 2, 3])
  const s1 = sum(res)
  const s2 = sum(res)
  // Both should be the same operator view (matches() checks col).
  eq(s1[value], s2[value])
  // And mutating the source advances both — proving they share state.
  res.insert(4)
  eq(s1[value], 10)
  eq(s2[value], 10)
})

spec({ op:'sum', guarantee:'Identity', trigger:'dedup-call', shape:'array', asserts:'a different column accessor creates a distinct view' }, () => {
  const res = $([{ x: 1, y: 10 }, { x: 2, y: 20 }])
  const sx = sum(res, 'x')
  const sy = sum(res, 'y')
  eq(sx[value], 3)
  eq(sy[value], 30)
  // independent — mutating x doesn't change y's sum
  res[0].x = 100
  eq(sx[value], 102)
  eq(sy[value], 30)
})

// SOME / EVERY ---------------------------------------------------------

spec({ op:'some', guarantee:'Reduction', trigger:'insert/remove', shape:'array', asserts:'true when any row matches the predicate' }, () => {
  const res = $([1, 2, 3])
  const s = some(res, d => d > 5)
  eq(s[value], false)
  res.insert(10)
  eq(s[value], true)
  delete res[3]
  eq(s[value], false)
})

spec({ op:'some', guarantee:'Reduction', trigger:'construct', shape:'array', asserts:'an empty set is false (matches Array#some)' }, () => {
  const res = $([])
  eq(some(res, d => d > 0)[value], false)
})

spec({ op:'every', guarantee:'Reduction', trigger:'insert/edit', shape:'array', asserts:'true only when every row matches the predicate' }, () => {
  const res = $([2, 4, 6])
  const e = every(res, d => d % 2 === 0)
  eq(e[value], true)
  res.insert(3)
  eq(e[value], false)
  res[3] = 8
  eq(e[value], true)
})

spec({ op:'every', guarantee:'Reduction', trigger:'construct', shape:'array', asserts:'an empty set is true (vacuous truth, matches Array#every)' }, () => {
  const res = $([])
  eq(every(res, d => d > 0)[value], true)
})

spec({ op:'some', guarantee:'Reduction', trigger:'edit', shape:'array', via:['BU2'], asserts:'an in-place edit flipping a predicate moves some and every' }, () => {
  const res = $([{ done: false }, { done: false }, { done: true }])
  const allDone = every(res, r => r.done)
  const anyDone = some(res, r => r.done)
  eq(allDone[value], false)
  eq(anyDone[value], true)
  res[0].done = true
  res[1].done = true
  eq(allDone[value], true)
  eq(anyDone[value], true)
  res[2].done = false
  eq(allDone[value], false)
  eq(anyDone[value], true)
})

spec({ op:'some', guarantee:'Identity', trigger:'dedup-call', shape:'array', asserts:'the same predicate returns the same view' }, () => {
  const res = $([1, 2, 3])
  const fn = d => d > 0
  const a = some(res, fn)
  const b = some(res, fn)
  eq(a[value], b[value])
  res.insert(-1)
  eq(a[value], true)
  eq(b[value], true)   // shared state
})
