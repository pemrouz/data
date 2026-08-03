// v4/conformance/schedule.test.ts — SCHEDULE.md made EXECUTABLE (W4).
//
// One test per numbered clause of contract/SCHEDULE.md, run against the real
// kernel (fresh Runtime per test — no shared graph state). This suite is the
// cross-repo timing contract: data CI runs it here, fero CI runs this same
// file against data HEAD, and any clause change must bump SCHEDULE_VERSION
// (contract/index.ts) — the constant is asserted below, so a behavioral edit
// that forgets the bump fails in BOTH repos on the clause it changed. The
// existence proof for why this file must be executable and not prose: data
// c870bde changed re-entrant write timing (inline → deferred drain), no test
// on either side pinned it, and fero shipped a cluster-wide silent lost write
// (fero DECISIONS Z).

import { test } from 'node:test'
import assert from 'node:assert'
import { Runtime } from '../kernel/runtime.ts'
import { SourceNode } from '../kernel/node.ts'
import { conform } from './harness.ts'
import { filter } from '../ops/rowops.ts'
import { sum } from '../ops/aggregate.ts'
import { intersect } from '../ops/setops.ts'
import { SCHEDULE_VERSION } from '../contract/index.ts'
import { handleFor } from '../api/index.ts'
import type { CommitBatch } from '../contract/delta.ts'
import { ingest, fromAsync, InMemoryBacking } from '../seam/index.ts'

const same = assert.deepStrictEqual
const ok = assert.ok

type Row = { n: number }

function capture<T>(node: any, origin: symbol | null = null): CommitBatch<T>[] {
  const out: CommitBatch<T>[] = []
  node.connect({ wantsOrder: true, origin, apply: (b: CommitBatch<T>) => out.push(b) })
  return out
}

//! SCHEDULE_VERSION — the constant this suite executes; a clause change without a bump fails here.
test('SCHEDULE_VERSION is exported at runtime and matches this suite', () => {
  same(SCHEDULE_VERSION, 4) // v2: clause 10 deep-path law (W3); v3: clause 11 value domain (W15); v4: clause 7 mid-batch attach
})

//! Clause 1 — a bare write is a SYNCHRONOUS batch of one; central Object.is no-op drop.
test('clause 1: bare write = synchronous batch of one; Object.is-equal write emits nothing', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { n: 1 } })
  conform(src)
  const batches = capture<Row>(src)

  src.write('a', ['n'], 2)
  same(batches.length, 1) // delivered BEFORE write() returned — no microtask hop
  same(batches[0].rows.length, 1)
  same(src.snapshot().get('a'), { n: 2 })

  src.write('a', ['n'], 2) // Object.is at the written leaf — dropped centrally
  same(batches.length, 1) // no phantom batch
})

//! Clause 2 — read-your-writes mid-batch: sources AND derived reads consistent; no emission until close.
test('clause 2: mid-batch reads see all writes so far; no effect fires until batch close', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { n: 1 } })
  const big = filter(src, (r: Row) => r.n > 10)
  conform(src)
  conform(big)
  const srcBatches = capture<Row>(src)
  const bigBatches = capture<Row>(big)

  rt.batch(() => {
    src.write('a', ['n'], 50)
    same(src.get('a'), { n: 50 }) // (a) source read post-write mid-batch
    ok(big.hasRow('a')) // (b) derived read consistent mid-batch (pull recompute)
    same(srcBatches.length, 0) // ...but NO effect fired, no record emitted
    same(bigBatches.length, 0)
  })
  same(srcBatches.length, 1) // one consolidated commit at close
  same(bigBatches.length, 1)
})

//! Clause 3 — topological flush: exactly-once per node per commit; no sink sees a half-applied graph.
test('clause 3: height-ordered propagation, exactly once, parents settled before a child sink fires', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { n: 5 }, b: { n: 20 } })
  const lo = filter(src, (r: Row) => r.n < 100)
  const hi = filter(src, (r: Row) => r.n > 1)
  const both = intersect(lo, hi)
  conform(both)

  let applies = 0
  both.connect({
    wantsOrder: false,
    origin: null,
    apply(b: CommitBatch<Row>) {
      applies++
      // No half-applied graph: when this child's effect observes the commit,
      // BOTH parents are already settled to post-write state.
      ok(lo.hasRow('c'))
      ok(hi.hasRow('c'))
      same(b.rows.length, 1)
    },
  })

  src.write('c', [], { n: 7 })
  same(applies, 1) // exactly once, not once per parent path through the diamond
})

//! Clause 4 — effects run LAST, exception-isolated; failures aggregate into ONE AggregateError.
test('clause 4: a throwing effect never starves siblings; failures collect into one AggregateError', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, {})
  const total = sum(src, 'n')
  const seen: number[] = []

  src.connect({
    wantsOrder: false,
    origin: null,
    apply() {
      // Effects run after ALL operator state settles: the downstream
      // aggregate already reflects this commit's write.
      same((total as any).value(), 3)
      throw new Error('sink boom')
    },
  })
  src.connect({ wantsOrder: false, origin: null, apply: (b: CommitBatch<Row>) => seen.push(b.seq) })

  assert.throws(
    () => src.write('a', [], { n: 3 }),
    (e: unknown) => e instanceof AggregateError && /1 effect\(s\) failed during commit/.test((e as Error).message),
  )
  same(seen.length, 1) // the sibling sink still received the commit
  same(src.snapshot().get('a'), { n: 3 }) // and the write itself committed
})

//! Clause 5 — re-entrancy: a write inside an effect queues as the NEXT commit, FIFO; cycles hit the cap.
test('clause 5: effect-issued writes drain FIFO as separate next commits', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, {})
  conform(src)
  const commits: string[][] = []
  let armed = true
  src.connect({
    wantsOrder: false,
    origin: null,
    apply(b: CommitBatch<Row>) {
      commits.push(b.rows.map((d) => String(d.key)))
      if (armed) {
        armed = false
        src.write('second', [], { n: 2 }) // queued — must NOT join this commit
        src.write('third', [], { n: 3 }) // queued behind it, FIFO
      }
    },
  })

  src.write('first', [], { n: 1 })
  // Three separate commits, program order: the re-entrant writes were not
  // folded into the triggering batch and not reordered.
  same(commits, [['first'], ['second'], ['third']])
})

test('clause 5: an unbounded write cascade throws at the cycle cap, not an infinite loop', () => {
  const rt = new Runtime()
  const src = new SourceNode<{ n: number }>(rt, { k: { n: 0 } })
  let i = 0
  src.connect({
    wantsOrder: false,
    origin: null,
    apply() {
      src.write('k', ['n'], ++i) // always-fresh value: a genuine cycle
    },
  })
  assert.throws(() => src.write('k', ['n'], -1), /re-entrant write cascade exceeded 1000 commits/)
})

//! Clause 6 — origin tokens: batch carries its origin; suppression is a declarative identity compare; issue-time capture for queued writes.
test('clause 6: same-origin sinks are suppressed (source AND derived); re-entrant writes carry issue-time origin', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, {})
  const mine = Symbol('peer-A')
  const view = filter(src, (r: Row) => r.n > 0)

  const asMine = capture<Row>(src, mine)
  const asOther = capture<Row>(src, Symbol('peer-B'))
  const asNull = capture<Row>(src, null)
  const derivedAsMine = capture<Row>(view, mine)

  ingest(src, [{ t: 'add', k: 'a', v: { n: 1 } }], { origin: mine })
  same(asMine.length, 0) // echo suppressed at the kernel effect loop
  same(derivedAsMine.length, 0) // suppression reaches DERIVED sinks too
  same(asOther.length, 1)
  same(asNull.length, 1)
  same(asNull[0].origin, mine) // the batch itself carries the producing origin

  // Issue-time origin capture: a write queued from inside an effect keeps the
  // origin that was installed WHEN IT WAS ISSUED — the next commit carries it,
  // so the issuing side's own sinks stay suppressed for the cascade too.
  let armed = true
  src.connect({
    wantsOrder: false,
    origin: null,
    apply() {
      if (armed) {
        armed = false
        rt.withOrigin(mine, () => src.write('b', [], { n: 2 }))
      }
    },
  })
  ingest(src, [{ t: 'add', k: 'c', v: { n: 3 } }], { origin: mine })
  same(asMine.length, 0) // neither the trigger nor the cascade echoed back
  same(asOther.length, 3) // trigger + cascade both reached the other peer
  same(asOther[2].origin, mine)
})

//! Clause 7 — snapshot-then-deltas: init reflects settled state; then every commit exactly once, in order.
test('clause 7: init(snapshot) then apply per commit — no gap, no overlap', () => {
  const rt = new Runtime()
  const backing = new InMemoryBacking<Row>(rt, { a: { n: 1 } })
  backing.source.write('b', [], { n: 2 }) // pre-subscribe commit — must be in init, not replayed

  const seqs: number[] = []
  let snapshotAtInit: Map<any, Row> | null = null
  backing.subscribe({
    wantsOrder: false,
    init(snap) {
      snapshotAtInit = new Map(snap)
    },
    apply(b) {
      seqs.push(b.seq)
    },
  })

  same(snapshotAtInit!.size, 2) // fully-settled state at init — the pre-subscribe write included
  backing.source.write('c', [], { n: 3 })
  backing.source.write('a', ['n'], 9)
  same(seqs.length, 2) // every subsequent commit, exactly once each
  ok(seqs[0] < seqs[1]) // in commit order — no reordering, no overlap
})

//! Clause 7 addendum (SCHEDULE_VERSION 4) — an attach INSIDE an open batch() observes the
//! batch boundary: the whole attach defers to that batch's commit. Pre-v4 the init snapshot
//! read the half-applied batch (read-your-writes) and apply() then redelivered the same
//! batch — a mid-batch subscriber double-counted every pending write.
test('clause 7: sink()/connect() attached INSIDE batch() — init is the settled commit, apply starts at the NEXT commit', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { n: 1 } })
  conform(src)
  const h = handleFor(src)

  // sink(): no gap (init carries writes made before AND after the attach in
  // the batch), no overlap (the batch's own deltas are not redelivered).
  let snap: Map<unknown, Row> | null = null
  const applies: unknown[] = []
  rt.batch(() => {
    src.write('b', [], { n: 2 }) // before the attach
    h.sink({
      init: (s: Map<unknown, Row>) => (snap = new Map(s)),
      apply: (b: unknown) => applies.push(b),
    })
    src.write('c', [], { n: 3 }) // after the attach, same batch
    ok(snap === null) // nothing delivered mid-batch (clause 2b)
  })
  same([...snap!.keys()].sort(), ['a', 'b', 'c']) // no gap — the whole settled batch
  same(applies.length, 0) // no overlap — the attach batch is not redelivered
  src.write('c', ['n'], 9)
  same(applies.length, 1) // delivery starts at the NEXT commit, exactly once

  // connect([]): one settled whole-value opening record, no per-key
  // duplicates for the attach batch, then one record per subsequent commit.
  const recs: any[] = []
  rt.batch(() => {
    src.write('d', [], { n: 4 })
    h.connect(recs)
  })
  same(recs.length, 1)
  same(recs[0].type, 'update')
  same(recs[0].key, [])
  ok('d' in recs[0].value) // settled state including the mid-batch write
  src.remove('d')
  same(recs.length, 2)
  same(recs[1].type, 'remove')

  // A write-free batch never commits — the attach lands at batch close
  // against the unchanged state.
  const recs2: any[] = []
  rt.batch(() => h.connect(recs2))
  same(recs2.length, 1)

  // dispose() before the deferred attach ran cancels it entirely.
  const recs3: any[] = []
  rt.batch(() => {
    src.write('e', [], { n: 5 })
    h.connect(recs3).dispose()
  })
  same(recs3.length, 0)
  src.write('e', ['n'], 6)
  same(recs3.length, 0)
})

//! Clause 8 — emission legality: consolidation ≤1 delta/key; net-zero flips annihilate to NOTHING.
test('clause 8: A→B→A and add+remove annihilate; multi-write batches consolidate to one delta per key', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { n: 1 } })
  conform(src) // legality-checks every emission this test does produce
  const batches = capture<Row>(src)

  rt.batch(() => {
    src.write('a', ['n'], 2)
    src.write('a', ['n'], 3)
    src.write('a', ['n'], 1) // net-zero at the leaf: A→B→C→A
    src.insert // (no-op read; keep the batch write-only)
    src.write('ghost', [], { n: 9 })
    src.remove('ghost') // add + remove annihilate
  })
  same(batches.length, 0) // the ENTIRE batch consolidated away — no commit, no phantom events

  rt.batch(() => {
    src.write('a', ['n'], 5)
    src.write('a', ['n'], 6)
    src.write('b', [], { n: 7 })
  })
  same(batches.length, 1)
  same(batches[0].rows.length, 2) // ≤1 delta per key: a's two writes consolidated
  const a = batches[0].rows.find((d) => d.key === 'a')!
  ok(a.op === 'update' && (a as any).prev.n === 1) // first prev, last row
})

//! Clause 10a — nested-field removal: property deleted, delta carries deleted:true, no phantom.
test('clause 10a: remove(key, path) deletes the field; the delta is a deleted-marked update', () => {
  const rt = new Runtime()
  const src = new SourceNode<{ a?: { b?: number; c?: number } }>(rt, { r: { a: { b: 1, c: 2 } } })
  conform(src)
  const batches = capture<any>(src)

  src.remove('r', ['a', 'b'])
  same(batches.length, 1)
  const d = batches[0].rows[0] as any
  same(d.op, 'update')
  same(d.deleted, true)
  same(d.path, ['a', 'b'])
  same(src.snapshot().get('r'), { a: { c: 2 } }) // property GONE, not undefined
  ok(!Object.hasOwn(src.snapshot().get('r')!.a!, 'b')) // enumeration changed
  same((d.prev as any).a.b, 1) // prev carries the deleted leaf's value

  // Array-element deletion is refused loudly — a sparse hole is version-broken.
  const arr = new SourceNode<{ xs: number[] }>(rt, { r: { xs: [1, 2, 3] } })
  assert.throws(() => arr.remove('r', ['xs', 1]), /sparse hole/)
})

//! Clause 10b — removes are idempotent everywhere: non-live key, absent ancestor, un-owned leaf.
test('clause 10b: every absent-target remove is a silent no-op, never a throw or a write', () => {
  const rt = new Runtime()
  const src = new SourceNode<any>(rt, { r: { a: { b: 1 } }, s: { flat: 0 }, u: { x: undefined } })
  conform(src)
  const batches = capture<any>(src)

  src.remove('ghost') // non-live key
  src.remove('ghost', ['a']) // non-live key, deep
  src.remove('r', ['nope', 'deep']) // absent ancestor
  src.remove('r', ['a', 'nope']) // un-owned leaf
  src.remove('s', ['flat', 'under-scalar']) // scalar ancestor
  src.remove('u', ['x']) // owned-but-undefined leaf: absence ≡ undefined at the leaf
  same(batches.length, 0) // not one emission, not one throw
  same(src.snapshot().get('r'), { a: { b: 1 } }) // and not one write
})

//! Clause 10c — deep writes vivify under null/scalar on LIVE rows; stay loud on dead keys.
test('clause 10c: vivify-under-null/scalar on live rows; deep write to a non-live key throws', () => {
  const rt = new Runtime()
  const src = new SourceNode<any>(rt, { r: { a: null, s: 5 } })
  conform(src)

  src.write('r', ['a', 'deep'], 1) // null intermediate → vivified object
  same(src.snapshot().get('r').a, { deep: 1 })
  src.write('r', ['s', 'deep'], 2) // scalar intermediate → vivified object
  same(src.snapshot().get('r').s, { deep: 2 })
  assert.throws(() => src.write('dead', ['a'], 1), /not live/) // a deep write cannot invent a row
})

//! Clause 10d — ingest isolates per record: siblings commit, rejects surface after the flush.
test('clause 10d: a poison record never aborts its siblings; rejects collect into one AggregateError', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, {})
  conform(src)
  const batches = capture<Row>(src)

  // Default: loud — AggregateError AFTER the good records committed + emitted.
  assert.throws(
    () =>
      ingest(src, [
        { t: 'add', k: 'a', v: { n: 1 } },
        { t: 'update', k: 'ghost', path: ['n'], v: 9 }, // poison: deep write to a dead key
        { t: 'add', k: 'b', v: { n: 2 } }, // the pre-v4 bug LOST this one
      ]),
    (e: unknown) => e instanceof AggregateError && /rejected 1 of 3/.test((e as Error).message),
  )
  same(batches.length, 1) // ONE batch, already flushed before the throw
  same(src.snapshot().size, 2) // both siblings committed
  same(src.snapshot().get('b'), { n: 2 })

  // onReject: consumed, no throw, report returned.
  const rejects: number[] = []
  const report = ingest(
    src,
    [
      { t: 'update', k: 'a', path: ['n'], v: 10 },
      { t: 'update', k: 'ghost2', path: ['n'], v: 9 },
    ],
    { onReject: (rj) => rejects.push(rj.index) },
  )
  same(report, { applied: 1, rejected: 1 })
  same(rejects, [1])
  same(src.snapshot().get('a'), { n: 10 })
})

//! Clause 9 — coalescing is opt-in sugar: same final state, fewer commits; default stays sync.
test('clause 9: coalescing changes commit COUNT, never semantics — default stays sync per chunk', async () => {
  const rt = new Runtime()
  // Already-resolved next() promises: both chunks settle back-to-back in one
  // tick (an async generator's resumption takes extra hops and would defeat
  // the same-tick premise — the seam suite pinned this construction).
  const chunks = [[{ n: 1 }], [{ n: 2 }]]
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
  const sync = fromAsync(rt, mkIter())
  const syncBatches = capture<{ n: number }>(sync.source)
  await new Promise((r) => setTimeout(r, 20))
  same(sync.status(), 'ready')
  same(syncBatches.length, 2) // the DEFAULT: one synchronous commit per chunk (clause 1)

  const co = fromAsync(rt, mkIter(), { coalesce: 'microtask' })
  const coBatches = capture<{ n: number }>(co.source)
  await new Promise((r) => setTimeout(r, 20))
  same(co.status(), 'ready')
  same(coBatches.length, 1) // opted in: one merged commit...
  same(co.source.rowCount(), sync.source.rowCount()) // ...identical final state — sugar, not semantics
})

//! Clause 11 — the value-domain portability table: NUL keys, first-class NaN/undefined, by-ref immutability.
test('clause 11: NUL/unicode keys are total; undefined/NaN are first-class; by-ref values are shared-immutable', () => {
  const rt = new Runtime()
  const src = new SourceNode<any>(rt, {})
  conform(src)

  // NUL and friends in KEYS — no separator assumption may leak (the v2 \x00 bug class).
  const evil = ['\x00', 'a\x00b', '\x00\x00', 'ключ🔑', 'a.b[c]']
  for (const k of evil) src.write(k, [], { n: k.length })
  for (const k of evil) ok(src.hasRow(k), `key ${JSON.stringify(k)} lost`)
  src.remove('a\x00b')
  ok(!src.hasRow('a\x00b') && src.hasRow('\x00')) // no over-matching via separators

  // undefined and NaN as first-class VALUES (dense — the row exists).
  src.write('u', [], undefined)
  ok(src.hasRow('u') && src.rowAt('u') === undefined)
  src.write('nan', [], { x: NaN })
  ok(Number.isNaN((src.rowAt('nan') as any).x)) // in-engine NaN survives (wire codecs own their fate)

  // By-ref surfaces share the SAME reference (the shared-immutable contract).
  const row = { deep: { v: 1 } }
  let seen: any
  src.connect({ wantsOrder: false, origin: null, apply: (b: any) => (seen = b.rows[0]?.row) })
  src.write('r', [], row)
  ok(seen === row)
})
