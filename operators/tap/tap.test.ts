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
