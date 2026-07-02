# SCHEDULE.md — the v3 timing & consistency contract (SCHEDULE_VERSION 1)

This document is versioned and contract-tested (cross-repo: data CI and fero CI both run the
executable tests in `v3/conformance/schedule.test.ts` against data HEAD). It is the answer to
fero plan-v3 §10 M0 item 4. Changes to any numbered clause bump SCHEDULE_VERSION.

## The model

Two-phase batch commit. **A bare write is a synchronous batch of one** — batching is a strict
superset of v2's per-write settle, never a replacement.

1. **Apply phase.** Every write routes through the runtime's commit. Inside `batch(fn)`,
   writes apply to source stores immediately in program order, with path-copy (copy-on-write
   along the written path) and central no-op drop (`Object.is` at the written leaf). Pending
   per-node output deltas accumulate, consolidated (≤1 row delta per key per batch).
2. **Read-your-writes.**
   - (a) Source reads always see post-write values, including mid-batch.
   - (b) Derived reads mid-batch are consistent: the value returned reflects all writes so
     far (pull recompute of that node's ancestry) — but **no effect fires and no record is
     emitted** by such a read; pending deltas keep buffering.
3. **Flush phase.** At batch close (immediately, for a bare write), consolidated batches
   propagate in topological order by node height (height = 1 + max(parent heights)). Each
   node processes each commit exactly once. No node or sink ever observes a half-applied
   graph.
4. **Effects last, isolated.** Effect sinks (tap fns, connect fns, DOM sinks) run after all
   operator state is settled, in topological order, each exception-isolated; failures collect
   into one `AggregateError` thrown after the drain completes.
5. **Re-entrancy.** A write issued inside an effect queues as the NEXT commit, drained FIFO
   after the current flush completes. Cascades are bounded by a cycle cap (dev-mode error).
6. **Origin tokens.** Every batch carries the `origin` of the commit that produced it. Writes
   issued by a sink carry that sink's origin, so echo suppression is
   `if (batch.origin === mine) return` — declarative, timing-independent.
7. **Snapshot-then-deltas.** A sink connected between commits receives `init(snapshot,
   order?)` reflecting fully-settled state, then `apply(batch)` for every subsequent commit,
   exactly once each, in commit order. No gap, no overlap.
8. **Emission legality.** Within one batch: at most one row delta per key; `add` only for
   keys not live before the batch; `update`/`remove` only for keys live before the batch;
   no `update` whose written leaf satisfies `Object.is(prevLeaf, nextLeaf)` (no-phantom-events);
   scalar deltas only when `!Object.is(prev, next)`; order deltas reference keys live after
   the batch's row deltas, with in-bounds indices.
9. **Coalescing (opt-in sugar, not a semantic change).** `coalesce('microtask' | 'frame')`
   turns implicit batches into scheduled batches for producers that opt in. The default is
   clause 0: bare write = synchronous batch of one.
