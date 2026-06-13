// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { test } from 'node:test'
import { $, value, createOperator } from '../../core.ts'
import { sort, limit, AZColumnValue } from './index.ts'
import { filter } from '../filter/index.ts'
import { map } from '../map/index.ts'
import { between } from '../between/index.ts'
import { sum } from '../aggregate/index.ts'

const max = (a, b) => a > b ? a : b
$.random = o => 1 + Object.keys(o).map(Number).sort().reduce(max, -1)

test('sort (za window) → map/filter follows window rotation without dropping a row (C2)', () => {
  // A row rotating INTO a windowed sort reaches the downstream row op as a
  // positional BI0A (insert at rank 0) preceded by a BR1A (evict the row that
  // fell out). Before RowOperator.BI0A, the plain BI0 path read the displaced
  // occupant at position 0 as the inserted row's "old" value, misclassified
  // the insert as an update, and dropped the displaced row.
  const src = $([{ v: 5 }, { v: 3 }, { v: 9 }, { v: 1 }])
  const win = sort(src, 'v', 2)              // top-2 desc: [{v:9},{v:5}]
  const mapped = map(win, r => r.v)
  const kept = filter(win, r => r.v >= 6)
  same(win[value], [{ v: 9 }, { v: 5 }])
  same(mapped[value], [9, 5])
  same(kept[value].filter(x => x !== undefined), [{ v: 9 }])
  src.insert({ v: 100 })                      // enters at rank 0, evicts {v:5}
  same(win[value], [{ v: 100 }, { v: 9 }])
  same(mapped[value], [100, 9])              // pre-fix: [100] (9 dropped)
  same(kept[value].filter(x => x !== undefined), [{ v: 100 }, { v: 9 }])
})

test('sort (za) - insert/update/remove', () => {
  const data = $({
    10: { fooo: 1, date: 1 }, 40: { fooo: 4, date: 4 },
    30: { fooo: 3, date: 3 }, 20: { fooo: 2, date: 2 },
    50: { fooo: 5, date: 5 },
  })
  const res = sort(data, 'date', 3)
  const changes1 = res.connect([])
  const changes2 = res[0].connect([])
  const changes3 = res[1].connect([])
  const changes4 = res[2].connect([])
  const changes5 = res[3].connect([])
  same(res[value], [
    { fooo: 5, date: 5 }, { fooo: 4, date: 4 }, { fooo: 3, date: 3 },
  ])

  data.insert({ fooo: 0, date: 0 })
  same(res[value], [{ fooo: 5, date: 5 }, { fooo: 4, date: 4 }, { fooo: 3, date: 3 }])

  data.insert({ fooo: [], date: 6 })
  same(res[value], [{ fooo: [], date: 6 }, { fooo: 5, date: 5 }, { fooo: 4, date: 4 }])

  data[52].fooo.insert(1)
  same(res[value], [{ fooo: [1], date: 6 }, { fooo: 5, date: 5 }, { fooo: 4, date: 4 }])

  data[value] = {
    10: { fooo: 1, date: 1 }, 40: { fooo: 4, date: 4 },
    30: { fooo: 3, date: 3 }, 20: { fooo: 2, date: 2 }, 50: { fooo: 5, date: 5 },
  }
  same(res[value], [{ fooo: 5, date: 5 }, { fooo: 4, date: 4 }, { fooo: 3, date: 3 }])

  data[40].fooo = 40
  same(res[value], [{ fooo: 5, date: 5 }, { fooo: 40, date: 4 }, { fooo: 3, date: 3 }])

  data[10].fooo = 10
  same(res[value], [{ fooo: 5, date: 5 }, { fooo: 40, date: 4 }, { fooo: 3, date: 3 }])

  data[10].date = 10
  same(res[value], [{ fooo: 10, date: 10 }, { fooo: 5, date: 5 }, { fooo: 40, date: 4 }])

  data[10].date = 4
  same(res[value], [{ fooo: 5, date: 5 }, { fooo: 40, date: 4 }, { fooo: 10, date: 4 }])

  data[40].date = 0
  same(res[value], [{ fooo: 5, date: 5 }, { fooo: 10, date: 4 }, { fooo: 3, date: 3 }])

  data[value] = {
    10: { fooo: 1, date: 1 }, 40: { fooo: 4, date: 4 },
    30: { fooo: 3, date: 3 }, 20: { fooo: 2, date: 2 }, 50: { fooo: 5, date: 5 },
  }
  same(res[value], [{ fooo: 5, date: 5 }, { fooo: 4, date: 4 }, { fooo: 3, date: 3 }])

  delete data[50].fooo
  same(res[value], [{ date: 5 }, { fooo: 4, date: 4 }, { fooo: 3, date: 3 }])

  delete data[10].fooo
  same(res[value], [{ date: 5 }, { fooo: 4, date: 4 }, { fooo: 3, date: 3 }])

  delete data[20]
  same(res[value], [{ date: 5 }, { fooo: 4, date: 4 }, { fooo: 3, date: 3 }])

  delete data[40]
  same(res[value], [{ date: 5 }, { fooo: 3, date: 3 }, { date: 1 }])

  delete data[value]
  same(res[value], [])
})

// Regression: when the new value moves a *middle* row up, BU1 used to read
// `col(p.value[name])` while `name` was still at its old slot in `sorted`,
// feeding the bisect a non-monotonic array. The descending-bisect's
// `col(sorted[mid]) < v_new` test returned false at name's slot (equal, not
// less), so the search jumped right and never re-discovered the higher rank.
// Result: the row stayed at its old position with the new value, instead of
// being lifted to the front. The pre-existing "row 1 jumps to first" test
// missed this because '1' was already at the end of `sorted`, so the bisect
// happened to converge correctly even on the broken array.
test('sort (za) - middle row promoted to top (bisect on stale slot)', () => {
  const data = $({
    A: { vol: 900 }, B: { vol: 850 }, C: { vol: 800 },
    D: { vol: 750 }, E: { vol: 700 },
  })
  const top3 = sort(data, 'vol', 3)
  same(top3[value], [{ vol: 900 }, { vol: 850 }, { vol: 800 }])
  data.C.vol = 950
  same(top3[value], [{ vol: 950 }, { vol: 900 }, { vol: 850 }])
})

// Regression: out-of-window value updates with no rank change still emitted
// `super.BU1([oidx, value])` where oidx >= n, growing view.value past `n`
// (the materialized window). Found via stress test where a churning ticker
// pushed the top-50 view to 60+ entries after a few thousand updates.
test('sort (za) - out-of-window updates do not grow the window', () => {
  const data = $({
    A: { vol: 900 }, B: { vol: 850 }, C: { vol: 800 },
    D: { vol: 750 }, E: { vol: 700 }, F: { vol: 650 },
    G: { vol: 600 }, H: { vol: 550 },
  })
  const top3 = sort(data, 'vol', 3)
  same(top3[value].length, 3)
  data.E.vol = 695  // E was rank 4 (out), still rank 4
  data.F.vol = 645  // F was rank 5, still rank 5
  data.G.vol = 595  // ditto
  same(top3[value].length, 3)
})

// Regression: array-source deletion shifts every later upstream index down
// by one. Previously ZAValue.BR1 only spliced the deleted key out of `sorted`
// and left the rest untouched, so the next bisect dereferenced p.value with
// stale numeric keys and crashed (or silently returned wrong rows).
test('sort (za) - array source delete shifts sorted keys', () => {
  const data = $([
    { vol: 100 }, { vol: 200 }, { vol: 300 }, { vol: 400 }, { vol: 500 },
  ])
  const top3 = sort(data, 'vol', 3)
  same(top3[value], [{ vol: 500 }, { vol: 400 }, { vol: 300 }])
  // Delete the middle row (vol: 300, source idx 2). The two rows above
  // shift down to indices 2 and 3.
  delete data[2]
  same(top3[value], [{ vol: 500 }, { vol: 400 }, { vol: 200 }])
  // Updating what is *now* the top row must read the post-shift slot.
  data[2].vol = 999
  same(top3[value], [{ vol: 999 }, { vol: 500 }, { vol: 200 }])
})

// Regression: array-source insert at a non-end position shifts every key
// >= `at` up by one. Previously ZAValue.BI0 just spliced the new key into
// `sorted` without shifting siblings, so subsequent reads of p.value via
// stale keys crashed or returned the wrong row.
test('sort (za) - array source insert at position shifts sorted keys', () => {
  const data = $([
    { vol: 100 }, { vol: 200 }, { vol: 300 }, { vol: 400 }, { vol: 500 },
  ])
  const top3 = sort(data, 'vol', 3)
  data.insert({ vol: 999 }, 1)  // inserts at idx 1, shifts the rest
  same(top3[value], [{ vol: 999 }, { vol: 500 }, { vol: 400 }])
  // Updating row originally at idx 4 (vol: 500), now at idx 5
  data[5].vol = 1
  same(top3[value], [{ vol: 999 }, { vol: 400 }, { vol: 300 }])
})

// In-window rank rotation should be emitted as a single 'move' event rather
// than per-position 'update' events. Sinks that care about identity (DOMSink
// uses insertBefore on the same element) preserve it; sinks without BMV1
// fall back to a BU1 batch over the affected range automatically.
test('sort (za) - in-window rank change emits BMV1', () => {
  const data = $({
    1: { date: 1 },
    2: { date: 2 },
    3: { date: 3 },
    4: { date: 4 },
  })
  const res = sort(data, 'date', 4)
  const changes = res.connect([])
  changes.length = 0  // discard the initial XU0
  // row 1 (currently last in the desc-sorted window) jumps to first
  data[1].date = 99
  same(res[value], [
    { date: 99 }, { date: 4 }, { date: 3 }, { date: 2 },
  ])
  // expect a single 'move' event; the U2 for the changed value is also
  // emitted (the column update path that pre-dates the rank change).
  const moves = changes.filter(c => c.type === 'move')
  same(moves.length, 1)
  same(moves[0], { type: 'move', from: 3, to: 0 })
})

// Regression: a windowed sort feeding another windowed sort rotates the inner
// window's POSITION keys without re-keying the outer, so the outer's get_index
// misses (returns -1). The BU2/BR2 forwarding guard was `oidx < n`, and -1 < n
// admitted a bogus key[0]="-1" deep update — which makes an index-keyed DOM sink
// create a phantom node it never removes (a permanently inflated rendered list).
// The guard must drop get_index misses. (NB: chained *windowed* sort can still
// have stale CONTENT vs a fresh rebuild — a separate, deeper positional-
// composition limitation; this test locks only the phantom-key DOM regression.)
test('sort (za) - chained windowed sort never forwards a -1 position key', () => {
  const src = $([{ v: 40, g: 1 }, { v: 50, g: 0 }, { v: 30, g: 2 }, { v: 20, g: 3 }])
  const inner = sort(src, 'v', 2)                       // za('v', 2)
  const chain = createOperator(inner, AZColumnValue, 'v', 2)  // .az('v', 2)
  const changes = chain.connect([])
  changes.length = 0
  src[0].v = 5       // sort-column edit (rank change in the inner window)
  src[2].g = 9       // non-sort-column edit on an inner-window row -> BU2 forward
  // No change record may carry a "-1" position key (the phantom-node trigger).
  same(changes.some(c => c.key && String(c.key[0]) === '-1'), false)
  // And the window stays the correct SIZE (count), so a DOM sink shows 2 rows.
  same(chain[value].length, 2)
})

// Regression: an in-place row mutation that reaches sort as a whole-row BU1
// with an *unchanged object reference* used to be silently dropped. `filter`
// (a RowOperator) collapses an upstream deep BU2 into a whole-row BU1, and
// because the row was mutated in place the reference is unchanged — sort
// re-emitted via super.BU1 (Value.BU1), whose reference dedup (`old === new`)
// then dropped the change. Both a downstream aggregate AND a downstream child
// view (the render path) went stale. Surfaced building the Kanban example
// (`board.filter('status', s).sort('order')` columns whose cards get edited).
test('sort - in-window in-place edit through filter refreshes aggregate + child view', () => {
  const board = $({
    a: { status: 'todo', title: 'Hello', points: 5, order: 0 },
    b: { status: 'done', title: 'X',     points: 2, order: 1 },
  })
  const col = sort(filter(board, 'status', 'todo'), 'order')  // ascending column
  const pts = sum(col, 'points')
  // A raw sink on the positional child view's title field — the same XU0 a
  // render text-binding subscribes to. Kept alive in a local (WeakRef sinks).
  const seen = []
  const titleSink = { XU0: (v) => seen.push(v), BU1() {}, BR1() {}, BI0() {}, BU2() {}, XR0() {} }
  const keep = col[0].title
  keep.connect(titleSink)
  same(pts[value], 5)
  same(keep[value], 'Hello')

  // edit a non-sort, non-filter column in place — arrives as whole-row BU1,
  // same object reference, rank unchanged.
  board.a.points = 8
  same(pts[value], 8)                                           // aggregate followed

  // edit the rendered field in place — the positional child view must refresh.
  board.a.title = 'World'
  same(keep[value], 'World')                                    // child view followed
  same(seen[seen.length - 1], 'World')                          // and notified its sink
})
// Regression + perf-shape: a bounded top-K (`za('col', n)`) used to refill the
// window from the next-ranked row after EVERY in-window eviction. On a range
// brush narrowing past the visible window, that next-ranked row is itself in
// the doomed removal batch, so it was inserted-then-immediately-re-evicted:
// O(Δ) churn (each churned slot is an O(n) content shift + a DOM node
// create/destroy) instead of O(window). Surfaced building the faceted-library
// example (`between(...).za('rating', 60)` brushed on rating — every 0.1 step
// re-rendered the whole grid). The batch path now reconciles the window once
// with positional BU1s. This test pins both the correctness (window == fresh
// top-K across narrow/shrink/widen/grow) AND the no-churn property (a window
// turnover emits only `update`s, ≤ n of them — never insert/remove churn).
test('sort (za) - bounded window reconciles batch removal/insert without churn', () => {
  const seed = {}
  for (let i = 1; i <= 12; i++) seed['v' + i] = { id: 'v' + i, r: i }
  const m = $(seed)
  const bounds = $([0, 100])
  const top4 = sort(between(m, 'r', bounds), 'r', 4)        // bounded top-4 by r desc
  same(top4[value].map(x => x.r), [12, 11, 10, 9])
  const changes = top4.connect([])

  // Narrow so the top three (10,11,12) leave in ONE batch BR1 (length > 2).
  changes.length = 0
  bounds[value] = [0, 9]
  same(top4[value].map(x => x.r), [9, 8, 7, 6])             // window slid down, still full
  same(changes.every(c => c.type === 'update'), true)      // no doomed-row churn
  same(changes.length <= 4, true)                          // ≤ window, not O(Δ)

  // Widen back: the three re-enter as one batch BI0 — same no-churn reconcile.
  changes.length = 0
  bounds[value] = [0, 100]
  same(top4[value].map(x => x.r), [12, 11, 10, 9])
  same(changes.every(c => c.type === 'update'), true)
  same(changes.length <= 4, true)

  // Shrink past the window: only two survivors — window must drop to length 2
  // (the tail-removal branch), then grow back when they re-enter.
  bounds[value] = [0, 2]
  same(top4[value].map(x => x.r), [2, 1])
  bounds[value] = [0, 100]
  same(top4[value].map(x => x.r), [12, 11, 10, 9])
})

test('limit (obj) - takes first n keys in iteration order', () => {
  const data = $({ a: 1, b: 2, c: 3, d: 4, e: 5 })
  const res = limit(data, 3)
  same(res[value], [1, 2, 3])
})

test('limit (obj) - update inside the window emits a BU1, not a full XU0', () => {
  const data = $({ a: 1, b: 2, c: 3, d: 4 })
  const res = limit(data, 3)
  const changes = res.connect([])
  changes.length = 0
  data.b = 20
  same(res[value], [1, 20, 3])
  // Position is stringified by the operator's BU1 path; existing precedent.
  same(changes, [{ type: 'update', key: ['1'], value: 20 }])
})

test('limit (obj) - update outside the window is a no-op', () => {
  const data = $({ a: 1, b: 2, c: 3, d: 4 })
  const res = limit(data, 3)
  const changes = res.connect([])
  changes.length = 0
  data.d = 40   // outside the window
  same(res[value], [1, 2, 3])
  same(changes, [])
})

test('limit (obj) - removing a windowed key refills from the next iteration-order key', () => {
  const data = $({ a: 1, b: 2, c: 3, d: 4, e: 5 })
  const res = limit(data, 3)
  const changes = res.connect([])
  changes.length = 0
  delete data.b
  same(res[value], [1, 3, 4])
  // Position keys/`at` are numeric on the BR1A/BI0A paths (the array
  // branch emits the same shape) — only the BU1 path stringifies.
  same(changes, [
    { type: 'remove', key: [1], value: 2 },
    { type: 'insert', key: [], value: 4, at: 2 },
  ])
})

test('limit (obj) - removing a key outside the window is a no-op', () => {
  const data = $({ a: 1, b: 2, c: 3, d: 4 })
  const res = limit(data, 3)
  const changes = res.connect([])
  changes.length = 0
  delete data.d
  same(res[value], [1, 2, 3])
  same(changes, [])
})

// Regression: a windowed key leaving via `src.key = undefined` (a BU1 carrying
// undefined) used to double-splice view.value — the BU1 object branch manually
// spliced AND super.BR1A spliced again — collapsing a full window of 3 to 2,
// then 1, then 0 while the source still had rows to refill it. Must match the
// `delete src.key` (BR1) path exactly, in both snapshot and change stream.
test('limit (obj) - key leaving via assignment-to-undefined refills like delete', () => {
  const undef = $({ a: 1, b: 2, c: 3, d: 4, e: 5 })
  const ru = limit(undef, 3)
  const cu = ru.connect([])
  cu.length = 0
  undef.a = undefined
  same(ru[value], [2, 3, 4])                 // not [3, 4] (double-splice undercount)
  undef.b = undefined
  same(ru[value], [3, 4, 5])
  undef.c = undefined
  same(ru[value], [4, 5])

  // Parity: the delete-based path produces the identical sequence of states…
  const del = $({ a: 1, b: 2, c: 3, d: 4, e: 5 })
  const rd = limit(del, 3)
  const cd = rd.connect([])
  cd.length = 0
  delete del.a; same(rd[value], [2, 3, 4])
  delete del.b; same(rd[value], [3, 4, 5])
  delete del.c; same(rd[value], [4, 5])
  // …and the identical change stream (the broken path emitted a remove for the
  // wrong row, so a connect/DOM sink rendered a third, distinct wrong state).
  same(cu, cd)
})

// Regression: a sort feeding limit re-orders its output, so a removal or a rank
// crossing reaches limit as the array-positional BR1A/BI0A/BMV1 verbs. limit
// tracks `keys` as stable source positions and refills by forward-scanning, so
// it cannot follow a re-ranking parent — it used to DROP those verbs entirely,
// leaving stale/duped rows (id3 jumping 70→1 produced [5,1,5] instead of
// [1,5,10]). limit now recomputes its window from the parent on those verbs.
// (Only a sort emits them; sparse producers signal membership with BR1/BF0/BH1.)
test('limit after a sort tracks rank moves and removals (az → limit)', () => {
  const src = $([{ id: 0, v: 50 }, { id: 1, v: 10 }, { id: 2, v: 30 }, { id: 3, v: 70 }, { id: 4, v: 20 }])
  const sorted = createOperator(src, AZColumnValue, 'v')   // az('v')
  const top3 = limit(sorted, 3)
  const vals = () => top3[value].map((r) => r.v)
  same(vals(), [10, 20, 30])
  ;(src as any).insert({ id: 5, v: 5 })   // new smallest enters the window
  same(vals(), [5, 10, 20])
  src[3].v = 1                            // 70 → 1: id3 jumps to rank 0 (rank move)
  same(vals(), [1, 5, 10])               // pre-fix: [5, 1, 5]
  delete src[1]                          // remove v10 (BR1A from the sort)
  same(vals(), [1, 5, 20])               // pre-fix: [5, 1, 5]
})

// Regression: `limit` directly on a sparse producer (between/intersect) over an
// ARRAY, brushed SIDEWAYS (some rows leave AND others enter in one cascade), used
// to DUPLICATE a row. The producer updates its view.value for ALL holes+fills,
// then emits removes (BH1→BR1) before fills (BF0→BI0). limit's BR1 batch refills
// from the parent's already-updated value (`nextAfter`), pulling in a slot the
// BF0 batch then re-reports — and limit's array BI0 (the BF0 fallback) didn't
// dedup, so it re-inserted that slot (a duplicate + an evicted survivor:
// [44,55,55] where [44,55,66] is right). Fixed by deduping the array BI0 against
// the current window. (Object-source limit is iteration-order-loose — like
// distinct — so this guard is array-only, where position order is stable.)
test('limit on a sparse producer survives a sideways brush without duplicating (between → limit)', () => {
  const src = $(Array.from({ length: 9 }, (_, i) => ({ id: i, v: i * 11 })))  // v 0,11,…,88
  const bound = $([10, 50])
  const win = limit(between(src, 'v', bound), 3)
  same(win[value].map((r) => r.v), [11, 22, 33])
  bound[value] = [34, 85]                          // 11/22/33 leave; 44/55/66/77 enter
  same(win[value].map((r) => r.v), [44, 55, 66])   // pre-fix: [44, 55, 55] (dup)
})

test('limit (obj) - new key joins when window has headroom', () => {
  const data = $({ a: 1, b: 2 })
  const res = limit(data, 3)
  const changes = res.connect([])
  changes.length = 0
  data.c = 3
  same(res[value], [1, 2, 3])
  same(changes.filter(c => c.type === 'insert'), [
    { type: 'insert', key: [], value: 3, at: 2 },
  ])
})

test('limit (obj) - new key does not join a full window', () => {
  const data = $({ a: 1, b: 2, c: 3 })
  const res = limit(data, 3)
  const changes = res.connect([])
  changes.length = 0
  data.d = 4
  same(res[value], [1, 2, 3])
  same(changes, [])
})

// Regression: sort over a SPARSE source crashed. between/intersect/union/except
// leave the key present with value `undefined` at excluded slots; sort's XU0
// iterated Object.keys (including those) and called `col(undefined)` →
// `undefined[col]` threw. It must skip explicit-undefined members (like length
// does) and never leak undefined rows into its output. Surfaced building the
// faceted-library example (`final = …except(…); final.za('rating').limit(n)`).
test('sort - over a sparse (explicit-undefined) source skips excluded slots', () => {
  const m = $({ a: { r: 5 }, b: { r: 9 }, c: { r: 7 } })
  const bounds = $([4, 10])
  const btw = between(m, 'r', bounds)
  bounds[value] = [6, 10]                         // a (5) leaves → left as undefined
  same(btw[value].a, undefined)
  same('a' in btw[value], true)
  // construct the sort AFTER the source went sparse — must not throw
  const desc = sort(btw, 'r')
  same(desc[value], [{ r: 9 }, { r: 7 }])         // a excluded, no undefined leaked
  same(limit(desc, 10)[value], [{ r: 9 }, { r: 7 }])
  // a re-entering the range refills the sort
  bounds[value] = [4, 10]
  same(desc[value], [{ r: 9 }, { r: 7 }, { r: 5 }])
})

// Regression (E1 / #14): a patch() of multiple whole-row overwrites used to
// mis-order za/az permanently — Value.BU1 commits ALL pairs before notifying,
// so the per-pair bisect read the other batch keys' NEW values at their OLD
// ranks (a non-monotonic array). A multi-pair BU1 now reconciles the whole
// batch (remove all updated keys from `sorted`, then re-rank against the
// monotonic remainder).
test('za/az - patch of multiple overwrites re-ranks correctly', () => {
  const src = $({ T: { v: 1000 }, B: { v: 998 }, A: { v: 900 }, C: { v: 800 } })
  const za = sort(src, 'v')
  src.patch(['A', { v: 1002 }, 'B', { v: 1004 }])
  same(za[value].map((r) => r.v), [1004, 1002, 1000, 800])

  const src2 = $({ T: { v: 1000 }, B: { v: 998 }, A: { v: 900 }, C: { v: 800 } })
  const win = sort(src2, 'v', 2) // bounded window
  src2.patch(['A', { v: 1002 }, 'B', { v: 1004 }])
  same(win[value].map((r) => r.v), [1004, 1002])

  const src3 = $({ a: { v: 1 }, b: { v: 2 }, c: { v: 3 } })
  const az = createOperator(src3, AZColumnValue, 'v')
  src3.patch(['a', { v: 10 }, 'c', { v: 0 }]) // a jumps up, c drops to bottom
  same(az[value].map((r) => r.v), [0, 2, 10])
})

// Regression (E1 / #15): setting a row to undefined (the documented leave idiom)
// used to leave a GHOST in `sorted` and the output — za kept a trailing
// undefined, az inserted it at rank 0 and evicted a real windowed row. A
// value===undefined pair is now treated as a leave (dropped, not re-ranked).
test('za/az - setting a row to undefined leaves cleanly (no ghost)', () => {
  const s1 = $({ a: { v: 10 }, b: { v: 20 }, c: { v: 30 }, d: { v: 40 } })
  const win = createOperator(s1, AZColumnValue, 'v', 2)
  same(win[value].map((r) => r.v), [10, 20])
  s1.c = undefined
  same(win[value].filter((x) => x !== undefined).map((r) => r.v), [10, 20])
  same(win[value].length, 2) // no ghost slot

  const s2 = $({ a: { v: 1 }, b: { v: 2 }, c: { v: 3 } })
  const za = sort(s2, 'v')
  s2.b = undefined
  same(za[value].filter((x) => x !== undefined).map((r) => r.v), [3, 1])
  same(za[value].length, 2)
})

// Regression (E2 / #18): ZAValue/AZValue.XU0 guarded `typeof value !== 'object'`,
// which null passes — then Object.keys(null) threw, crashing a sort over a null
// root or mid-cascade when an upstream value became null.
test('za/az - null source does not crash', () => {
  same(sort($(null), 'v')[value], [])
  const src = $({ a: { v: 1 } })
  const s = sort(src, 'v')
  src[value] = null
  same(s[value], [])
  same(createOperator($(null), AZColumnValue, 'v')[value], [])
})

// Regression (E2 / #20): a NaN sort key made the comparator inconsistent
// (0 for every NaN comparison), so Array.sort scrambled the WHOLE array — a
// non-NaN row could rank below a smaller one. NaN keys now sort last and the
// rest order correctly.
test('za/az - a NaN key sorts last without corrupting other rows', () => {
  const za = sort($([{ v: 5 }, { v: NaN }, { v: 3 }, { v: 1 }, { v: 8 }]), 'v')
  const nonNaN = za[value].filter((r) => r.v === r.v).map((r) => r.v)
  same(nonNaN, [8, 5, 3, 1])             // descending, correct
  same(za[value][za[value].length - 1].v !== za[value][za[value].length - 1].v, true) // NaN last
  const az = createOperator($([{ v: 5 }, { v: NaN }, { v: 3 }, { v: 8 }]), AZColumnValue, 'v')
  same(az[value].filter((r) => r.v === r.v).map((r) => r.v), [3, 5, 8]) // ascending, correct
})
