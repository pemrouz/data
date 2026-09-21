# facts.md — what is TRUE about data v4 (use these names; invent nothing that contradicts them)

This is a UI prototype: numbers, tick streams, "live" results and peer engines MAY be
smoke and mirrors (canned, animated, plausible). But every NAME below is real and must be
used as written. Do not print v2-era facts (`npm install data`, "29 kB gzip", `data/full`,
`dist/`, `trades[42].bid = 99.5` assignment-style writes, ×-figures from a bench).

## The engine, in one breath
A reactive data engine. `$(value)` wraps an object or array into a live source; chainable
operators derive incrementally-maintained views; subscriptions deliver consolidated
per-commit deltas; a render layer binds views to the DOM. Work is proportional to the
change, not the data. It is SOURCE-SERVED: no npm package, no dist, no build step — you
import `api/index.ts` directly (Node runs it with `--experimental-strip-types`; the site
would ship the same files type-stripped). Zero dependencies. MIT. One consumer today: fero.

## Writes (the v4 API — NOT proxy assignment)
```
const trades = $({ t1: { sym: 'AAPL', side: 'buy', qty: 200, px: 187.5 }, … })   // object-born, keyed
const rows   = $([ … ])                                                          // array-born, ordered
trades.t3.qty.update(380)          // a deep-path write: one delta, path ['qty'], prev 500
trades.get('t3').set('qty', 380)   // same thing
rows.insert({ … }) · rows.get(k).remove() · rows.patch(k, { … })
batch(() => { … many writes … })   // ONE commit, consolidated (k writes → 1 delta per key)
```
Builtin verbs on a handle (18): get, snapshot, update, set, insert, remove, patch, connect,
dispose, mirror, raf, first, last, ingest, sink, promote, each, rowCount.

## The delta algebra (contract/delta.ts) — the WHOLE protocol
Three row verbs: `add` · `update` (first-class, carries `prev` and a `path`) · `remove`.
Three order verbs: `orderInsert` · `orderRemove` · `orderMove`. One scalar shape. One batch
envelope: `{ seq, origin, rows, order, scalar }`. Every operator consumes and emits exactly
this. SCHEMA_VERSION 3. A printed delta looks like: `update t3 .qty 500 → 380`.

## Subscriptions
`view.sink({ init(snapshot), apply(batch) })` — native, by reference.
`view.connect(opts, fn)` — v2-profile change records (fero's `records()` shape).
`wireSink(view, wb => …)` — a WireBatch (JSON-safe) for replication; `ingest(replica, wb.records)` applies it.
`lane(source, …)` — the HOT ingest lane (fero Recs verbatim).
`runtime().onCommit(c => …)` — CommitInfo `{ seq, origin, nodes: [{ id, deltas, ms }] }` in settle order.
`runtime().graph()` — the live DAG `{ id, kind, op, parents, height }[]`.

## The operator registry — 33 operators, 4 categories (exportContract())
rowop (10): filter · map · gt · lt · gte · lte · between · intersect · union · except
aggregate-decomposable (7): sum · avg · length · group · lengthBuckets · some · every
holistic (13): az · za · top · limit · reverse · max · min · reduce · distinct · to · quantile · percentile · median
iter (3): tap · keys · values
Notes: `between(col, [lo, hi])` takes REACTIVE bounds (a value handle works); `za('qty', 2)` = top-2 descending;
`length(fn)` = counts per bucket; `median/percentile/quantile` are R-type-7; `intersect/union/except` never dedup.
52 reserved names on a handle (the 33 + verbs + a few throwing placeholders like `page`, `join`).

## The contract — contract/SCHEDULE.md, SCHEDULE_VERSION 4, eleven clauses
 1 Apply phase — every write routes through the runtime's commit
 2 Read-your-writes — source reads see post-write values inside the batch
 3 Flush phase — consolidated batches settle height-ordered at batch close
 4 Effects last, isolated — effect sinks run after settle; a throwing sink can't corrupt state (AggregateError)
 5 Re-entrancy — a write inside an effect queues as the NEXT commit
 6 Origin tokens — every batch carries its origin; replicas suppress their own echo
 7 Snapshot-then-deltas — a sink attached between commits gets init(snapshot) then only deltas (mid-batch attach defers to the commit)
 8 Emission legality — at most one row delta per key per batch; add on an existing key is illegal; consolidation rules
 9 Coalescing — opt-in `coalesce('microtask' | 'frame')`, sugar not semantics
10 The deep-path law — replication of nested writes: pathCopy / pathDelete (SCHEDULE_VERSION 2, fero W3)
11 The value-domain portability table — which JS values cross the wire intact (SCHEDULE_VERSION 3, W15)
Each clause is pinned by conformance/schedule.test.ts — 18 tests (1 version assert + 17 clause tests) — and the
SAME file runs in fero's CI against data HEAD ("the contract ride"). `conform(node)` = a legality checker + a
replay sink that re-folds every commit and asserts the fold equals the view. Whole suite: 330+ tests, 4 type
programs, 4 perf gates. (The suite has been run in a browser through node:test/node:assert shims: 18/18.)

## Devtools
`devtools/` ships an inspector panel + DOM overlay (`devtools/index.ts`, `devtools/dom.ts`, `devtools/panel/`):
the live graph as Tree/DAG, per-commit deltas, per-node settle ms. Mounts on demand (never auto).

## The consumer: fero
fero's substrate imports ONE entry — `../../data/api/index.ts` — and uses exactly seven names:
`$`, `value`, `node`, `lane`, `ingest`, `DataNode`, `exportContract`. fero's `npm test` runs data's
conformance/schedule.test.ts against data HEAD. The lane record shape (`{ type: 0|1|2, key: [rowKey, …fieldPath], value, at? }`)
is a wire-stability surface.

## History you may reference lightly
v2 was a proxy library (the old site's `trades[42].bid = 99.5`); v3 a kernel rewrite; v4 = the kernel + fero's
W1–W17 wishlist + an adversarial re-evaluation, promoted to the repo root 2026-08-16. The essay
"Write the view, flow the change" (a table and its change-stream are one thing) still describes the idea.
