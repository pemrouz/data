# SCHEDULE.md — the v4 timing & consistency contract (SCHEDULE_VERSION 4)

This document is versioned and contract-tested: the executable suite in
[../conformance/schedule.test.ts](../conformance/schedule.test.ts) covers every numbered clause
(some clauses carry several tests) against data HEAD, and fero CI rides the same suite
cross-repo (its `test:contract` chains this file into `npm test` — W4 of fero's DESIGN-DATA3
wishlist; data-side CI wiring lands with the v4 root promotion). SCHEDULE_VERSION
is exported at runtime from [../contract/index.ts](index.ts) so consumers can pin it. It is the
answer to fero plan-v3 §10 M0 item 4. Changes to any numbered clause bump SCHEDULE_VERSION.

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
6. **Origin tokens.** Every batch carries the `origin` of the commit that produced it. A sink
   declares its origin for suppression — `if (batch.origin === mine) return`, and a declared
   entry origin is suppressed at the kernel — declarative, timing-independent. A re-entrant
   write carries the AMBIENT origin at ISSUE time (the origin of the commit whose effect
   issued it, or the enclosing `withOrigin`), not the issuing sink's declared origin.
7. **Snapshot-then-deltas.** A sink connected between commits receives `init(snapshot,
   order?)` reflecting fully-settled state, then `apply(batch)` for every subsequent commit,
   exactly once each, in commit order. No gap, no overlap. An attach issued INSIDE an open
   `batch()` observes the batch boundary (SCHEDULE_VERSION 4): the whole attach — init
   snapshot + connect — defers to that batch's own commit, so `init` reflects the settled
   post-commit state (writes both before AND after the attach in that batch) and delivery
   starts at the NEXT commit; a write-free batch attaches at close against the unchanged
   state. (An attach from inside an effect keeps the established mid-flush semantics: its
   init already contains the current commit, delivery starts at the next.)
8. **Emission legality.** Within one batch: at most one row delta per key; `add` only for
   keys not live before the batch; `update`/`remove` only for keys live before the batch;
   no `update` whose written leaf satisfies `Object.is(prevLeaf, nextLeaf)` (no-phantom-events);
   scalar deltas only when `!Object.is(prev, next)`; order deltas reference keys live after
   the batch's row deltas, with in-bounds indices.
9. **Coalescing (opt-in sugar, not a semantic change).** `coalesce('microtask' | 'frame')`
   turns implicit batches into scheduled batches for producers that opt in. The default is
   clause 0: bare write = synchronous batch of one.
10. **The deep-path law (introduced at SCHEDULE_VERSION 2 — fero W3).** Replication reorders and redelivers
    freely, so deep-path operations are tolerant, isolated, and lossless:
    - (a) **Nested-field removal is first-class.** `remove(key, path)` deletes the property
      (enumeration changes); the delta is an `update` carrying `deleted: true` with the field's
      path, and wire/compat sinks emit it as a nested REMOVE record — never an
      update-to-undefined (which would be indistinguishable from a real `undefined` value).
      Deleting an ARRAY element throws (a sparse hole is a version-broken shape) — write the
      spliced array.
    - (b) **Removes are idempotent everywhere.** A remove of a non-live key, an absent
      ancestor, or an un-owned leaf is a silent no-op — never a throw, never a write.
    - (c) **Deep writes vivify on live rows; stay loud on dead ones.** A deep write under a
      `null`/scalar intermediate of a LIVE row auto-creates object intermediates (path-copy);
      a deep write to a NON-live key throws — a deep write cannot invent a row.
      At the leaf, **absence ≡ `undefined`**: writing `undefined` over an absent field is the
      Object.is no-op drop, and deleting an owned-but-`undefined` leaf is a no-op — explicit
      `undefined` and absence are indistinguishable to the deep-write layer (whole-row writes
      still distinguish them).
    - (d) **Ingest isolates per record.** One bad record in an `ingest()` batch never aborts,
      starves, or silently drops its siblings: good records commit and emit in the one batch;
      rejects are collected and surfaced AFTER the flush — as one `AggregateError` by default,
      or per-record via `opts.onReject` (which suppresses the throw). The pre-v4 failure mode
      (prefix commits, suffix silently lost, error propagates) is outlawed.
11. **The value-domain portability table (introduced at SCHEDULE_VERSION 3 — W15; what a replicating codec must preserve).**
    Row values are arbitrary JS values with these law-bearing points:
    - `undefined` and `null` are FIRST-CLASS row/leaf values (dense snapshots; absence = key
      absence — except at the deep-write layer, where leaf absence ≡ `undefined`, clause 10c).
    - `NaN`/`Infinity` are first-class numbers in-engine. A JSON-based wire mangles nested
      ones to `null` — a codec claiming this profile must preserve them (CBOR/binary) or
      document the v2-JSON degradation it inherits.
    - Binary values (TypedArray/ArrayBuffer) are opaque leaf values in-engine; JSON does not
      round-trip them. A replicating codec must either preserve them or reject loudly at
      ingress — never silently reshape (`{type:'Buffer',data:[…]}` is the outlawed shape).
    - Row KEYS are arbitrary unicode strings (object-born) or minted ints (array-born).
      NUL (`\x00`) and every other codepoint are legal in string keys — no separator
      assumption may leak into key handling (the inherited v2 `\x00`-separator bug class);
      pinned by a conformance case.
    - Reference semantics: by-ref surfaces (sink(), clone:false, lane()) share IMMUTABLE
      references — the path-copy law is what makes that sound.
