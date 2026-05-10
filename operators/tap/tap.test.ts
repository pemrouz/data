// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { test } from 'node:test'
import { $, value } from '../../core.ts'
import { tap } from './index.ts'
import { filter } from '../filter/index.ts'
import { length } from '../length/index.ts'

test('tap - fires fn for the initial XU0 and downstream events', () => {
  const data = $({ a: 1, b: 2 })
  const events = []
  const t = tap(data, e => events.push(e))
  data.a = 10
  data.c = 3
  delete data.b
  same(events, [
    { type: 'update', key: [],    value: { a: 1, b: 2 } },
    { type: 'update', key: ['a'], value: 10 },
    { type: 'insert', key: [],    value: 3, at: 'c' },
    { type: 'remove', key: ['b'], value: 2 },
  ])
  // tap is a passthrough — the underlying data (and tap's view) should match
  same(t[value], { a: 10, c: 3 })
})

test('tap - chains: downstream operator sees the same events', () => {
  const data = $([{ done: false }, { done: true }, { done: false }])
  const taps = []
  const remaining = length(filter(tap(data, e => taps.push(e.type)), 'done', false))
  same(remaining[value], 2)
  data.insert({ done: false })
  same(remaining[value], 3)
  // tap recorded each upstream event (initial update, then insert)
  same(taps, ['update', 'insert'])
})

test('tap - nested updates flow through BU2', () => {
  const data = $({ a: { x: 1 } })
  const events = []
  tap(data, e => events.push(e))
  data.a.x = 99
  same(events, [
    { type: 'update', key: [], value: { a: { x: 1 } } },
    { type: 'update', key: ['a', 'x'], value: 99 },
  ])
})

test('tap - 0-arg fn opts into bare path: fires per emit, no record, no clone', () => {
  // Bare tap exists for hot-path consumers that re-read the live proxy
  // value inside their callback (chart redraws, count textContent updates).
  // Skipping the structuredClone+record construction is the whole point —
  // verify that the fn fires synchronously after the value is updated, so
  // reading `data[value]` inside the callback returns post-mutation state.
  const data = $({ a: 1, b: 2 })
  let calls = 0
  let snapshot
  tap(data, () => { calls++; snapshot = data[value] })
  // Constructor fires the initial XU0 → fn() once.
  same(calls, 1)
  same(snapshot, { a: 1, b: 2 })
  data.a = 10
  same(calls, 2)
  same(snapshot.a, 10)
  data.c = 3                     // insert
  same(calls, 3)
  same(snapshot.c, 3)
  delete data.b                  // remove
  same(calls, 4)
  same('b' in snapshot, false)
})

test('tap - 1-arg fn keeps the full record path (no silent downgrade)', () => {
  // Strict 0-arity check is what makes the dispatch safe: anyone who
  // declared `(c) => ...` (length 1) still gets full change records. A
  // future minifier-driven param drop is the failure mode this guards
  // against, so we pin the dispatch with an explicit assertion.
  const data = $({ a: 1 })
  const records = []
  tap(data, (c) => records.push(c))
  data.a = 2
  same(records.length, 2)                       // initial + one update
  same(records[1], { type: 'update', key: ['a'], value: 2 })
})
