// v3/seam/seam.test.ts — seam layer conformance suite.
//
// Every collection node is conform()-wrapped (legality + replay on every
// commit) so the ingress cannot smuggle an illegal emission past clause 8.
// Covers: ingest with both wire profiles over object- AND array-born sources
// (positional v2 keys resolve through currentOrder() at application time),
// the one-batch guarantee + consolidation, the live-key add (LWW) tolerance,
// origin echo suppression round-trip (source AND derived sinks), move
// deferral, full v2 record-stream round-trips (capture from A, replay into
// B), fromAsync (promise + async generator, status transitions, chunk
// batching, downstream filter/sum consistency, microtask coalescing,
// dispose-cancels, error surfacing), InMemoryBacking's load/apply/subscribe
// boundary, and the exportContract manifest shape.

import { test } from 'node:test'
import assert from 'node:assert'
import { Runtime } from '../kernel/runtime.ts'
import { SourceNode } from '../kernel/node.ts'
import { scope, runInScope } from '../kernel/scope.ts'
import { conform, conformScalar, assertOracle } from '../conformance/harness.ts'
import { filter } from '../ops/rowops.ts'
import { sum } from '../ops/aggregate.ts'
import { connectRecords, materialize } from '../compat/v2-records.ts'
import { RESERVED } from '../contract/index.ts'
import type { ChangeRecordV2, WireRecord } from '../contract/index.ts'
import type { CommitBatch, OriginToken, RowDelta, RowKey } from '../contract/delta.ts'
import { ingest, fromAsync, InMemoryBacking, exportContract } from './index.ts'

const same = assert.deepStrictEqual
const ok = assert.ok

type Row = { n: number; meta?: { note: number } }

function captureBatches<T>(node: SourceNode<T> | any): CommitBatch<T>[] {
  const out: CommitBatch<T>[] = []
  node.connect({ wantsOrder: false, origin: null, apply: (b: CommitBatch<T>) => out.push(b) })
  return out
}

async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('until(): condition not met within timeout')
    await new Promise((r) => setTimeout(r, 1))
  }
}

// ── ingest: wire profile ─────────────────────────────────────────────────────

test('ingest wire → object source: add / update(path) / remove, one batch, LWW tolerances', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { n: 1 } })
  conform(src)
  const batches = captureBatches(src)

  ingest(src, [
    { t: 'add', k: 'a', v: { n: 2 } }, // live key → whole-row UPDATE (LWW tolerance)
    { t: 'update', k: 'x', v: { n: 9 } }, // non-live, path [] → ADD (the other direction)
    { t: 'update', k: 'a', path: ['n'], v: 3 },
    { t: 'remove', k: 'ghost' }, // non-live remove — silent no-op
  ] satisfies WireRecord[])

  same(batches.length, 1) // ONE commit for the whole record batch
  same(src.snapshot().get('a'), { n: 3 })
  same(src.snapshot().get('x'), { n: 9 })
  same(src.snapshot().size, 2)

  const byKey = new Map<RowKey, RowDelta<Row>>(batches[0].rows.map((d) => [d.key, d]))
  same(byKey.size, batches[0].rows.length) // consolidated: ≤1 delta per key
  ok(byKey.get('a')!.op === 'update') // NOT add — the live-key tolerance routed it
  ok(byKey.get('x')!.op === 'add')

  // deep write to a non-live key stays LOUD (no implicit row creation)
  assert.throws(() => ingest(src, [{ t: 'update', k: 'nope', path: ['n'], v: 1 }]), /not live/)
})

test('ingest wire → array source: explicit minted keys append in arrival order; nextKey advances', () => {
  const rt = new Runtime()
  const src = new SourceNode<{ v: number }>(rt, [{ v: 1 }, { v: 2 }]) // keys 0, 1
  conform(src)

  ingest(src, [
    { t: 'add', k: 5, v: { v: 5 } }, // wire-carried minted key — appends
    { t: 'update', k: 0, path: ['v'], v: 11 },
    { t: 'remove', k: 1 },
  ] satisfies WireRecord[])

  same(src.currentOrder(), [0, 5])
  same(materialize(src.snapshot(), src.currentOrder()), [{ v: 11 }, { v: 5 }])
  // the store's mint counter advanced past the ingested key — no collision
  const k = src.insert({ v: 9 })
  same(k, 6)
})

test('ingest: profile detection is per-record; unrecognizable records are loud', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, {})
  conform(src)
  // mixed profiles in one call — both detected
  ingest(src, [
    { t: 'add', k: 'a', v: { n: 1 } },
    { type: 'insert', key: [], value: { n: 2 }, at: 'b' } as ChangeRecordV2,
  ])
  same(src.snapshot().size, 2)
  assert.throws(() => ingest(src, [{ nope: true } as any]), /cannot detect record profile/)
  assert.throws(() => ingest({} as any, []), /must be a source/)
})

test('ingest unwraps an api handle through the [node] symbol (no api import in the seam)', async () => {
  // Late dynamic import: proves the seam's Symbol.for-based unwrap works
  // against the real handle without a static seam → api dependency.
  const api = await import('../api/index.ts')
  const h = api.$({ a: { n: 1 } })
  ingest(h, [
    { t: 'update', k: 'a', path: ['n'], v: 5 },
    { t: 'add', k: 'b', v: { n: 2 } },
  ] satisfies WireRecord[])
  same(h.snapshot(), { a: { n: 5 }, b: { n: 2 } })
  // operator views are not ingest targets — loud
  assert.throws(() => ingest(h.filter(() => true), [{ t: 'remove', k: 'a' }]), /must be a source/)
})

test('ingest wire: move records are deferred with a clear error (both profiles)', () => {
  const rt = new Runtime()
  const src = new SourceNode<{ v: number }>(rt, [{ v: 1 }, { v: 2 }])
  conform(src)
  assert.throws(() => ingest(src, [{ t: 'move', k: 0, from: 0, to: 1 }]), /does not support move records yet/)
  assert.throws(() => ingest(src, [{ type: 'move', from: 0, to: 1 }]), /does not support move records yet/)
  same(src.currentOrder(), [0, 1]) // untouched
})

// ── ingest: v2 profile ───────────────────────────────────────────────────────

test('ingest v2 → object source: insert(at=key) / nested update / remove, one batch', () => {
  const rt = new Runtime()
  const src = new SourceNode<any>(rt, { a: { val: 1, meta: { note: 0 } } })
  conform(src)
  const batches = captureBatches(src)

  ingest(src, [
    { type: 'insert', key: [], value: { val: 2, meta: { note: 0 } }, at: 'b' },
    { type: 'update', key: ['a', 'meta', 'note'], value: 5 },
    { type: 'update', key: ['b', 'val'], value: 9 },
    { type: 'remove', key: ['a'], value: { val: 1, meta: { note: 5 } } },
  ] satisfies ChangeRecordV2[])

  same(batches.length, 1)
  same(src.snapshot().size, 1)
  same(src.snapshot().get('b'), { val: 9, meta: { note: 0 } })
  // consolidation: a's update+remove folded to one remove with pre-batch prev
  const a = batches[0].rows.find((d) => d.key === 'a')!
  ok(a.op === 'remove')
  same((a as any).prev, { val: 1, meta: { note: 0 } })

  // insert with a LIVE at-key routes as whole-row update (add tolerance)
  ingest(src, [{ type: 'insert', key: [], value: { val: 10, meta: { note: 1 } }, at: 'b' }])
  same(src.snapshot().get('b'), { val: 10, meta: { note: 1 } })
  ok(batches[1].rows[0].op === 'update')
})

test('ingest v2 → array source: positional keys resolve through currentOrder() at application time', () => {
  const rt = new Runtime()
  const src = new SourceNode<{ v: number }>(rt, [{ v: 10 }, { v: 20 }, { v: 30 }]) // keys 0,1,2
  conform(src)

  ingest(src, [
    { type: 'remove', key: ['0'], value: { v: 10 } }, // key 0 leaves → order [1,2]
    { type: 'update', key: ['0', 'v'], value: 21 }, // positional 0 is NOW key 1
    { type: 'insert', key: [], value: { v: 5 }, at: 0 }, // front insert → order [3,1,2]
    { type: 'update', key: ['2', 'v'], value: 31 }, // positional 2 is key 2
  ] satisfies ChangeRecordV2[])

  same(materialize(src.snapshot(), src.currentOrder()), [{ v: 5 }, { v: 21 }, { v: 31 }])

  // out-of-range positional remove is an idempotent no-op; update is loud
  ingest(src, [{ type: 'remove', key: ['99'], value: null }])
  same(src.snapshot().size, 3)
  assert.throws(() => ingest(src, [{ type: 'update', key: ['99', 'v'], value: 1 }]), /out of range/)
})

test('ingest v2 whole-value update (key []) diffs against current state, both shapes', () => {
  const rt = new Runtime()
  const obj = new SourceNode<Row>(rt, { a: { n: 1 }, b: { n: 2 } })
  conform(obj)
  const objBatches = captureBatches(obj)
  ingest(obj, [{ type: 'update', key: [], value: { b: { n: 2 }, c: { n: 3 } } }])
  same(materialize(obj.snapshot(), null), { b: { n: 2 }, c: { n: 3 } })
  // a removed, c added, b rewritten (different reference → legal update)
  const ops = new Map(objBatches[0].rows.map((d) => [d.key, d.op]))
  same(ops.get('a'), 'remove')
  same(ops.get('c'), 'add')

  const arr = new SourceNode<{ v: number }>(rt, [{ v: 1 }, { v: 2 }, { v: 3 }])
  conform(arr)
  ingest(arr, [{ type: 'update', key: [], value: [{ v: 9 }, { v: 2 }] }])
  same(materialize(arr.snapshot(), arr.currentOrder()), [{ v: 9 }, { v: 2 }])
})

// ── ingest: v2 stream round-trips (capture from A, replay into B) ────────────

test('round-trip (object-born): captured v2 records replayed into a fresh source reconstruct it', () => {
  const rtA = new Runtime()
  const srcA = new SourceNode<any>(rtA, { a: { val: 10, meta: { note: 0 } }, b: { val: 20, meta: { note: 0 } } })
  const recs: ChangeRecordV2[] = []
  const sub = connectRecords(srcA, recs) // opens with the whole-value snapshot record
  srcA.write('a', ['meta', 'note'], 7)
  srcA.write('c', [], { val: 30, meta: { note: 1 } })
  srcA.remove('b')
  rtA.batch(() => {
    srcA.write('a', ['val'], 11)
    srcA.write('d', [], { val: 40, meta: { note: 2 } })
  })
  sub.dispose()

  const rtB = new Runtime()
  const srcB = new SourceNode<any>(rtB, {})
  conform(srcB)
  ingest(srcB, recs) // whole stream, one commit
  same(materialize(srcB.snapshot(), null), materialize(srcA.snapshot(), null))
})

test('round-trip (array-born): positional v2 records replay index-correctly', () => {
  const rtA = new Runtime()
  const srcA = new SourceNode<{ v: number }>(rtA, [{ v: 1 }, { v: 2 }, { v: 3 }])
  const recs: ChangeRecordV2[] = []
  const sub = connectRecords(srcA, recs)
  srcA.insert({ v: 4 }, 1) // mid insert
  srcA.write(2, ['v'], 22) // key 2 sits at position 3 now
  srcA.remove(0) // front remove — later indices shift
  srcA.insert({ v: 5 }) // tail append
  sub.dispose()

  const rtB = new Runtime()
  const srcB = new SourceNode<{ v: number }>(rtB, [])
  conform(srcB)
  ingest(srcB, recs)
  same(
    materialize(srcB.snapshot(), srcB.currentOrder()),
    materialize(srcA.snapshot(), srcA.currentOrder()),
  )
  same(materialize(srcB.snapshot(), srcB.currentOrder()), [{ v: 4 }, { v: 2 }, { v: 22 }, { v: 5 }])
})

// ── ingest: origin echo suppression ──────────────────────────────────────────

test('origin round-trip: a sink with origin X never sees an ingest carrying origin X — others do', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { n: 1 } })
  conform(src)
  const flt = filter(src, () => true)
  conform(flt)

  const X: OriginToken = Symbol('remote-peer-X')
  const Y: OriginToken = Symbol('remote-peer-Y')
  let srcX = 0
  let fltX = 0
  let srcAny = 0
  src.connect({ wantsOrder: false, origin: X, apply: () => srcX++ })
  flt.connect({ wantsOrder: false, origin: X, apply: () => fltX++ }) // suppression reaches DERIVED sinks too
  src.connect({ wantsOrder: false, origin: null, apply: () => srcAny++ })

  ingest(src, [{ t: 'update', k: 'a', path: ['n'], v: 2 }], { origin: X })
  same(src.snapshot().get('a'), { n: 2 }) // the write LANDED...
  same(srcAny, 1) // ...and reached unsuppressed sinks...
  same(srcX, 0) // ...but never echoed to X
  same(fltX, 0)

  ingest(src, [{ t: 'update', k: 'a', path: ['n'], v: 3 }], { origin: Y })
  same(srcX, 1) // a DIFFERENT origin delivers
  same(fltX, 1)

  ingest(src, [{ t: 'update', k: 'a', path: ['n'], v: 4 }]) // no origin = default user origin
  same(srcX, 2)
  same(fltX, 2)
  same(srcAny, 3)
})

// ── fromAsync ────────────────────────────────────────────────────────────────

test('fromAsync(promise): pending → ready, rows land as one commit, keyed store', async () => {
  const rt = new Runtime()
  const statuses: string[] = []
  const h = fromAsync(rt, Promise.resolve([{ id: 'a', v: 1 }, { id: 'b', v: 2 }]), {
    key: (r) => r.id,
    onStatus: (s) => statuses.push(s),
  })
  conform(h.source)
  const batches = captureBatches(h.source)
  same(h.status(), 'pending')
  same(h.source.snapshot().size, 0)

  await until(() => h.status() === 'ready')
  same(statuses, ['ready'])
  same(batches.length, 1)
  same([...h.source.snapshot().keys()].sort(), ['a', 'b'])
  same(h.source.currentOrder(), null) // keyed → object-born
  same(h.error(), undefined)
})

test('fromAsync(async generator): each chunk = one batch; downstream filter/sum stay consistent; key redelivery is LWW', async () => {
  const rt = new Runtime()
  let releaseNext: () => void = () => {}
  const gate = new Promise<void>((r) => (releaseNext = r))
  async function* feed() {
    yield [{ id: 'a', v: 5 }, { id: 'b', v: 10 }]
    await gate
    yield [{ id: 'c', v: 20 }, { id: 'a', v: 7 }] // 'a' redelivered → whole-row LWW update
  }
  const h = fromAsync(rt, feed(), { key: (r) => r.id })
  conform(h.source)
  const flt = filter(h.source, (r: any) => r.v >= 10)
  conform(flt)
  const total = sum(h.source, 'v')
  conformScalar(total as any)
  const batches = captureBatches(h.source)
  const fltOracle = () => {
    const m = new Map<RowKey, any>()
    for (const [k, r] of h.source.snapshot()) if ((r as any).v >= 10) m.set(k, r)
    return m
  }

  await until(() => h.source.snapshot().size === 2)
  same(h.status(), 'pending') // stream still open
  same(batches.length, 1)
  same(total.value(), 15)
  same([...flt.snapshot().keys()], ['b'])
  assertOracle(flt, fltOracle)

  releaseNext()
  await until(() => h.status() === 'ready')
  same(batches.length, 2)
  same((h.source.snapshot().get('a') as any).v, 7)
  same(total.value(), 37) // 7 + 10 + 20
  same([...flt.snapshot().keys()].sort(), ['b', 'c'])
  assertOracle(flt, fltOracle)
})

test('fromAsync without key: array-born source, minted keys in arrival order', async () => {
  const rt = new Runtime()
  const h = fromAsync(rt, Promise.resolve([{ v: 1 }, { v: 2 }]))
  conform(h.source)
  await until(() => h.status() === 'ready')
  same(h.source.currentOrder(), [0, 1])
  same(materialize(h.source.snapshot(), h.source.currentOrder()), [{ v: 1 }, { v: 2 }])
})

test('fromAsync coalesce microtask: chunks settled in the same tick merge into ONE commit', async () => {
  const rt = new Runtime()
  const chunks = [[{ id: 'a', v: 1 }], [{ id: 'b', v: 2 }]]
  const mkIter = () => {
    let i = 0
    return {
      [Symbol.asyncIterator]: () => ({
        next: () =>
          Promise.resolve(
            i < chunks.length ? { value: chunks[i++], done: false as const } : { value: undefined, done: true as const },
          ),
      }),
    }
  }

  const hSync = fromAsync(rt, mkIter(), { key: (r: any) => r.id })
  conform(hSync.source)
  const syncBatches = captureBatches(hSync.source)
  await until(() => hSync.status() === 'ready')
  same(syncBatches.length, 2) // default: one commit per chunk

  const hCo = fromAsync(rt, mkIter(), { key: (r: any) => r.id, coalesce: 'microtask' })
  conform(hCo.source)
  const coBatches = captureBatches(hCo.source)
  await until(() => hCo.status() === 'ready')
  same(coBatches.length, 1) // coalesced: both chunks in one commit
  same(hCo.source.snapshot().size, 2)
})

test('fromAsync dispose() cancels consumption; committed rows stay; generator finalizes', async () => {
  const rt = new Runtime()
  let releaseNext: () => void = () => {}
  const gate = new Promise<void>((r) => (releaseNext = r))
  let finalized = false
  async function* feed() {
    try {
      yield [{ id: 'a', v: 1 }]
      await gate
      yield [{ id: 'b', v: 2 }]
    } finally {
      finalized = true
    }
  }
  const h = fromAsync(rt, feed(), { key: (r) => r.id })
  conform(h.source)
  await until(() => h.source.snapshot().size === 1)
  h.dispose()
  releaseNext()
  await until(() => finalized)
  await new Promise((r) => setTimeout(r, 5))
  same(h.source.snapshot().size, 1) // no rows after dispose
  same(h.status(), 'pending') // cancelled — never reaches ready
})

test('fromAsync scope-tied cancellation: disposing the enclosing scope stops consumption', async () => {
  const rt = new Runtime()
  let releaseNext: () => void = () => {}
  const gate = new Promise<void>((r) => (releaseNext = r))
  async function* feed() {
    yield [{ id: 'a', v: 1 }]
    await gate
    yield [{ id: 'b', v: 2 }]
  }
  const s = scope(null)
  const h = runInScope(s, () => fromAsync(rt, feed(), { key: (r) => r.id }))
  await until(() => h.source.snapshot().size === 1)
  s.dispose()
  releaseNext()
  await new Promise((r) => setTimeout(r, 10))
  same(h.source.snapshot().size, 1)
  ok(h.source.disposed) // the source registered with the same scope
})

test('fromAsync error: rejection surfaces via status()/error()/onStatus', async () => {
  const rt = new Runtime()
  const statuses: string[] = []
  const h = fromAsync(rt, Promise.reject(new Error('boom')), { onStatus: (s) => statuses.push(s) })
  await until(() => h.status() === 'error')
  same(statuses, ['error'])
  ok(h.error() instanceof Error)
  same((h.error() as Error).message, 'boom')
  same(h.source.snapshot().size, 0)
})

// ── SourceBacking / InMemoryBacking ──────────────────────────────────────────

test('InMemoryBacking: load / apply / subscribe boundary over object- and array-born state', () => {
  const rt = new Runtime()
  const b = new InMemoryBacking<Row>(rt, { a: { n: 1 } })
  conform(b.source)

  const loaded = b.load()
  same(loaded.order, null)
  same(loaded.rows.get('a'), { n: 1 })

  // subscribe: snapshot-then-deltas (clause 7)
  const inits: unknown[] = []
  const applied: CommitBatch<Row>[] = []
  const sub = b.subscribe({
    init: (snap, order) => inits.push([new Map(snap), order]),
    apply: (batch) => applied.push(batch),
  })
  same(inits.length, 1)
  same((inits[0] as any)[0].get('a'), { n: 1 })

  b.apply([{ t: 'add', k: 'b', v: { n: 2 } }])
  same(applied.length, 1)
  ok(applied[0].rows[0].op === 'add')
  same(b.load().rows.size, 2)

  // origin threads through apply → echo suppression at the boundary
  const X: OriginToken = Symbol('backing-writer')
  let xHits = 0
  b.subscribe({ origin: X, init: () => {}, apply: () => xHits++ })
  b.apply([{ t: 'update', k: 'b', v: { n: 3 } }], X)
  same(xHits, 0)
  same(applied.length, 2) // origin-free subscriber still sees it
  b.apply([{ t: 'update', k: 'b', v: { n: 4 } }])
  same(xHits, 1)

  sub.dispose()
  b.apply([{ t: 'remove', k: 'a' }])
  same(applied.length, 3) // disposed — no further deliveries

  const arr = new InMemoryBacking<{ v: number }>(rt, [{ v: 1 }, { v: 2 }])
  conform(arr.source)
  same(arr.load().order, [0, 1])
  arr.apply([{ type: 'update', key: ['1', 'v'], value: 22 } as ChangeRecordV2])
  same(materialize(arr.source.snapshot(), arr.source.currentOrder()), [{ v: 1 }, { v: 22 }])
})

// ── exportContract ───────────────────────────────────────────────────────────

test('exportContract: schema version, full RESERVED set, registry-projected operator descriptors', () => {
  const m = exportContract()
  same(m.SCHEMA_VERSION, 3)
  same(new Set(m.reserved), new Set(RESERVED))
  ok(m.reserved.includes('filter') && m.reserved.includes('get') && m.reserved.includes('ingest'))

  // spot-check descriptors against known classifications
  same(m.operators.filter, { category: 'rowop', declarative: false })
  same(m.operators.between, { category: 'rowop', declarative: true })
  same(m.operators.sum, { category: 'aggregate-decomposable', declarative: true })
  same(m.operators.max, { category: 'holistic', declarative: true })
  same(m.operators.za.category, 'holistic')
  same(m.operators.intersect, { category: 'rowop', declarative: true })
  same(m.operators.tap.category, 'iter')

  // sanity over the whole projection
  const cats = new Set(['rowop', 'aggregate-decomposable', 'holistic', 'iter'])
  const names = Object.keys(m.operators)
  ok(names.length >= 25, `expected a populated registry, got ${names.length}`)
  for (const name of names) {
    const d = m.operators[name]
    ok(cats.has(d.category), `${name}: unknown category ${d.category}`)
    same(typeof d.declarative, 'boolean')
    // every dispatchable operator name is RESERVED (lengthBuckets is the
    // internal length(fn) target, dispatched via 'length')
    if (name !== 'lengthBuckets') ok(m.reserved.includes(name), `${name} missing from RESERVED`)
  }
  // manifest is a fresh projection, not a live view of internals
  ok(m.reserved !== (RESERVED as unknown))
})
