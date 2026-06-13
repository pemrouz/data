// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { test } from 'node:test'
import { $, value } from '../../core.ts'
import { length } from './index.ts'
import { filter } from '../filter/index.ts'

test('length(fn) - array source: in-place key edit after a remove rebuckets correctly (C1)', () => {
  // `mapping` is keyed by position; an array remove splices and shifts
  // positions, so a later in-place group-key edit would rebucket the wrong row
  // unless the remove re-keys mapping. (counts read as bucket.value.)
  const src = $([{ g: 'a' }, { g: 'b' }, { g: 'a' }, { g: 'b' }])
  const counts = length(src, (r) => r.g)
  const c = (o) => Object.fromEntries(Object.entries(o[value]).map(([k, b]) => [k, b.value]))
  same(c(counts), { a: 2, b: 2 })
  delete src[0]                 // splice: was [b,a,b]; positions shift
  same(c(counts), { a: 1, b: 2 })
  src[0].g = 'a'                // the row now at index 0 ({g:'b'}) → 'a'
  same(c(counts), { a: 2, b: 1 })
})

test('length - object', () => {
  const obj = $({ 10: 'a' })
  const count = length(obj)
  const changes = count.connect([])
  obj.insert('b')
  obj.insert('c')
  delete obj[10]
  delete obj[value]
  same(count[value], 0)
})

test('length - array', () => {
  const arr = $(['a'])
  const count = length(arr)
  const changes = count.connect([])
  arr.insert('b')
  arr.insert('c')
  delete arr[0]
  delete arr[value]
  same(count[value], 0)
})

// Regression: filter on an array source produces a sparse array (holes for
// excluded rows). Previously LengthValue.XU0 returned `value.length` for
// arrays, which counted holes — so `arr.filter(...).length()` reported the
// source size instead of the kept count, contradicting the README quickstart.
test('length - filter(array) skips holes', () => {
  const todos = $([
    { task: 'foo', done: false },
    { task: 'bar', done: true  },
    { task: 'baz', done: false },
  ])
  const remaining = filter(todos, 'done', false)
  const remainingCount = length(remaining)
  const events = remainingCount.connect([])
  same(remainingCount[value], 2)
  todos.insert({ task: 'qux', done: false })
  todos[0].done = true
  delete todos[2]
  same(events, [
    { type: 'update', key: [], value: 2 },
    { type: 'update', key: [], value: 3 },
    { type: 'update', key: [], value: 2 },
    { type: 'update', key: [], value: 1 },
  ])
})

test('length fn - group counting', () => {
  const res = $({
    1: { num: 1.1 }, 2: { num: 2.2 }, 3: { num: 1.9 },
    4: { num: 2.6 }, 5: { num: 1.7 }
  })
  const lengths = length(res, d => Math.floor(d.num))
  const changes = lengths.connect([])
  res.insert({ num: 1.8 })
  res[5] = { num: 1.8 }
  res[5] = { num: 2.1 }
  res[9] = { num: 2.1 }
  res[9].foo = 'bar'
  delete res[3]
  delete res[value]
  same(changes, [
    { type: 'update', key: [], value: { '1': { value: 3 }, '2': { value: 2 } } },
    { type: 'update', key: [], value: { '1': { value: 4 }, '2': { value: 2 } } },
    { type: 'update', key: [], value: { '1': { value: 4 }, '2': { value: 2 } } },
    { type: 'update', key: [], value: { '1': { value: 3 }, '2': { value: 3 } } },
    { type: 'update', key: [], value: { '1': { value: 3 }, '2': { value: 4 } } },
    { type: 'update', key: [], value: { '1': { value: 2 }, '2': { value: 4 } } },
    { type: 'update', key: [], value: {} }
  ])
  same(lengths[value], {})
})

// Regression: length(fn) must rebucket on an in-place field mutation (BU2),
// not just on insert/remove. A field set arrives as a BU2 carrying the path,
// and the changed field is the bucket key — so the row has to move buckets,
// including into a bucket key that did not exist at construction time. This is
// the swarm example's SIR-by-state histogram (`pop.length(a => a.state)` driven
// by `pop[id].state = …`): before the BU2 handler existed the counts silently
// froze at their construction values. A field change that does NOT move the
// bucket must stay silent (no spurious republish).
test('length fn - rebuckets on in-place field change (BU2)', () => {
  const rows = $({
    a: { state: 'S' },
    b: { state: 'S' },
    c: { state: 'I' },
  })
  const byState = length(rows, d => d.state)
  const changes = byState.connect([])
  rows.a.state = 'I'          // S→I: moves a from S to I
  rows.c.state = 'R'          // I→R: creates the R bucket (absent at construction)
  rows.b.foo = 'x'            // unrelated field: no bucket move → no emit
  rows.b.state = 'R'          // S→R: into the now-existing R bucket
  same(changes, [
    { type: 'update', key: [], value: { S: { value: 2 }, I: { value: 1 } } },
    { type: 'update', key: [], value: { S: { value: 1 }, I: { value: 2 } } },
    { type: 'update', key: [], value: { S: { value: 1 }, I: { value: 1 }, R: { value: 1 } } },
    { type: 'update', key: [], value: { S: { value: 0 }, I: { value: 1 }, R: { value: 2 } } },
  ])
  same(byState.I.value[value], 1) // each bucket's count stays individually subscribable
  same(byState.R.value[value], 2)
})

// Regression (G1 / #31): setting an existing key to undefined is a BU1 leave
// (core's upsert split routes a previously-defined key to BU1, not BR1).
// length() was a blanket BU1 no-op so its count went permanently stale, and
// length(fn) called fn(undefined) and crashed. Both now treat undefined as a leave.
test('length - assignment-to-undefined decrements (length) / rebuckets (length fn)', () => {
  const src = $({ a: { n: 1 }, b: { n: 2 }, c: { n: 3 } })
  const len = length(src)
  same(len[value], 3)
  src.a = undefined
  same(len[value], 2)              // was stuck at 3
  src.b = { n: 9 }                 // a real update — count unchanged
  same(len[value], 2)

  const src2 = $({ a: { g: 'x' }, b: { g: 'y' }, c: { g: 'x' } })
  const lf = length(src2, (r) => r.g)
  same(lf[value].x.value, 2)
  src2.a = undefined               // leave — must not crash, decrements x
  same(lf[value].x.value, 1)
})
