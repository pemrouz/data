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
  same(SCHEDULE_VERSION, 1)
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
