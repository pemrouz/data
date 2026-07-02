// M0 gate: the kit is demonstrably red/green on a toy operator BEFORE any
// kernel code exists. A well-behaved toy stream passes both checkers; each
// class of illegal emission is caught by name.

import { test } from 'node:test'
import assert from 'node:assert'
import { LegalityChecker, LegalityError } from './legality.ts'
import { ReplaySink, ReplayError } from './replay.ts'
import type { CommitBatch, RowKey } from '../contract/delta.ts'

const ORIGIN = Symbol('test')
const batch = <T>(seq: number, rows: CommitBatch<T>['rows'], order?: CommitBatch<T>['order']): CommitBatch<T> =>
  ({ seq, origin: ORIGIN, rows, order, scalar: undefined })

type Row = { v: number }

test('legality: a well-formed stream passes', () => {
  const c = new LegalityChecker<Row>('toy')
  c.init(new Map<RowKey, Row>([['a', { v: 1 }]]), ['a'])
  c.apply(batch(1, [{ op: 'add', key: 'b', row: { v: 2 } }], [{ op: 'orderInsert', key: 'b', index: 1 }]))
  c.apply(batch(2, [{ op: 'update', key: 'b', row: { v: 3 }, prev: { v: 2 }, path: ['v'] }]))
  c.apply(batch(3, [{ op: 'remove', key: 'a', prev: { v: 1 } }], [{ op: 'orderRemove', key: 'a', index: 0 }]))
  assert.deepStrictEqual([...c.live], ['b'])
})

test('legality: add for a live key is illegal', () => {
  const c = new LegalityChecker<Row>('toy')
  c.init(new Map([['a', { v: 1 }]]))
  assert.throws(
    () => c.apply(batch(1, [{ op: 'add', key: 'a', row: { v: 9 } }])),
    (e: Error) => e instanceof LegalityError && /add for already-live/.test(e.message),
  )
})

test('legality: update/remove for a non-live key is illegal', () => {
  const c = new LegalityChecker<Row>('toy')
  c.init(new Map())
  assert.throws(
    () => c.apply(batch(1, [{ op: 'update', key: 'x', row: { v: 1 }, prev: { v: 0 }, path: [] }])),
    LegalityError,
  )
  assert.throws(() => c.apply(batch(2, [{ op: 'remove', key: 'x', prev: { v: 0 } }])), LegalityError)
})

test('legality: two deltas for one key in one batch is illegal (consolidation contract)', () => {
  const c = new LegalityChecker<Row>('toy')
  c.init(new Map([['a', { v: 1 }]]))
  assert.throws(
    () =>
      c.apply(
        batch(1, [
          { op: 'update', key: 'a', row: { v: 2 }, prev: { v: 1 }, path: ['v'] },
          { op: 'update', key: 'a', row: { v: 3 }, prev: { v: 2 }, path: ['v'] },
        ]),
      ),
    (e: Error) => e instanceof LegalityError && />1 row delta/.test(e.message),
  )
})

test('legality: phantom update (unchanged leaf) is illegal — no-phantom-events', () => {
  const c = new LegalityChecker<Row>('toy')
  c.init(new Map([['a', { v: 1 }]]))
  assert.throws(
    () => c.apply(batch(1, [{ op: 'update', key: 'a', row: { v: 1 }, prev: { v: 1 }, path: ['v'] }])),
    (e: Error) => e instanceof LegalityError && /phantom update/.test(e.message),
  )
})

test('legality: phantom scalar is illegal', () => {
  const c = new LegalityChecker<Row>('scalar')
  c.init(new Map())
  assert.throws(
    () => c.apply({ seq: 1, origin: ORIGIN, rows: [], order: undefined, scalar: { prev: 5, next: 5 } }),
    (e: Error) => e instanceof LegalityError && /phantom scalar/.test(e.message),
  )
})

test('legality: order deltas — non-live key, out-of-bounds, key mismatch, duplicates all fail', () => {
  const c = new LegalityChecker<Row>('ordered')
  c.init(new Map([['a', { v: 1 }], ['b', { v: 2 }]]), ['a', 'b'])
  assert.throws(
    () => c.apply(batch(1, [], [{ op: 'orderInsert', key: 'ghost', index: 0 }])),
    (e: Error) => e instanceof LegalityError && /non-live/.test(e.message),
  )
  assert.throws(
    () => c.apply(batch(2, [], [{ op: 'orderMove', key: 'a', from: 5, index: 0 }])),
    (e: Error) => e instanceof LegalityError && /out of bounds/.test(e.message),
  )
  assert.throws(
    () => c.apply(batch(3, [], [{ op: 'orderRemove', key: 'b', index: 0 }])), // ord[0] is 'a'
    (e: Error) => e instanceof LegalityError && /mismatch/.test(e.message),
  )
})

test('legality: seq must be monotonic', () => {
  const c = new LegalityChecker<Row>('toy')
  c.init(new Map())
  c.apply(batch(5, [{ op: 'add', key: 'a', row: { v: 1 } }]))
  assert.throws(() => c.apply(batch(5, [{ op: 'add', key: 'b', row: { v: 2 } }])), LegalityError)
})

test('replay: stream folds back to the value (the duality law)', () => {
  const r = new ReplaySink<Row>('toy')
  r.init(new Map([['a', { v: 1 }]]), ['a'])
  r.apply(batch(1, [{ op: 'add', key: 'b', row: { v: 2 } }], [{ op: 'orderInsert', key: 'b', index: 0 }]))
  r.apply(batch(2, [{ op: 'update', key: 'a', row: { v: 10 }, prev: { v: 1 }, path: ['v'] }]))
  r.assertMatches(new Map([['a', { v: 10 }], ['b', { v: 2 }]]), ['b', 'a'], 2)
})

test('replay: a wrong incremental delta fails on the introducing commit (the C8 class)', () => {
  const r = new ReplaySink<Row>('toy')
  r.init(new Map([['a', { v: 1 }]]))
  // Toy operator "forgets" to emit the update (v2's C8: value right, stream wrong)
  r.apply(batch(1, []))
  assert.throws(
    () => r.assertMatches(new Map([['a', { v: 2 }]]), undefined, 1),
    (e: Error) => e instanceof ReplayError && /value mismatch/.test(e.message),
  )
})

test('replay: scalar channel folds', () => {
  const r = new ReplaySink<Row>('sum')
  r.initScalar(3)
  r.apply({ seq: 1, origin: ORIGIN, rows: [], order: undefined, scalar: { prev: 3, next: 7 } })
  r.assertScalar(7, 1)
  assert.throws(() => r.assertScalar(8, 1), ReplayError)
})
