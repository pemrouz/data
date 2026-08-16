# data

A reactive data engine. `$(value)` wraps an object or array into a live
source; chainable operators (`filter`, `between`, `gt`/`lt`/`gte`/`lte`,
`az`/`za`/`top`/`limit`/`reverse`, `length`, `sum`/`avg`/`max`/`min`,
`median`/`percentile`/`quantile`, `some`/`every`, `intersect`/`union`/
`except`, `group`/`distinct`, `map`/`to`/`reduce`, `tap`, `keys`/`values`)
derive incrementally-maintained views; subscriptions deliver consolidated
per-commit deltas (native `sink()` batches by reference, v2-profile records
via `connect()`, wire batches via `wireSink()`); a render layer binds views
to the DOM (builders or JSX). Work is proportional to the change, not the
data.

Everything runs under an **executable timing contract** —
[contract/SCHEDULE.md](contract/SCHEDULE.md) (`SCHEDULE_VERSION 4`): batch
commit semantics, read-your-writes, effect isolation, origin-token echo
suppression, snapshot-then-deltas subscriptions, emission legality, the
deep-path law, and the value-domain portability table, each pinned by
[conformance/schedule.test.ts](conformance/schedule.test.ts).

The delta protocol is deliberately CLOSED
([contract/delta.ts](contract/delta.ts)): three row verbs (`add`/`update`/
`remove`, update first-class with `prev` and a path), a separate order
channel (`orderInsert`/`orderRemove`/`orderMove`), one scalar shape, one
consolidated batch envelope. Every operator consumes and emits exactly this.

## Consumer

This library is SOURCE-SERVED (no build, no dist — node
`--experimental-strip-types` reads the `.ts` directly). Its consumer is
**[fero](../fero-v2)** — a replicated, partitioned runtime whose substrate
imports the one entry [api/index.ts](api/index.ts) and applies replication
records through the hot lane ([seam/index.ts](seam/index.ts) `lane()`), with
fero's CI riding this repo's SCHEDULE conformance suite cross-repo.

```js
import { $, batch } from 'data'            // exports["."] → api/index.ts

const orders = $({})                        // an object-born (keyed) source
const active = orders.filter(o => o.active) // an incremental view
const avg    = active.avg('value')          // a scalar view

orders.set('o1', { active: true, value: 42 })
orders.get('o1').update({ active: true, value: 43 })
batch(() => { /* many writes, ONE commit */ })

const sub = active.sink({                   // native per-commit batches, by ref
  init: (snapshot) => {},
  apply: (commit) => {},
})
sub.dispose()
```

## Commands

- `npm test` — the full suite (unit + the SCHEDULE conformance suite).
- `npm run typecheck` — four `tsc` programs, including the shipped
  [types/public.d.ts](types/public.d.ts) consumer gate.
- `npm run perf` — the m1–m4 budget gates (machine-calibrated absolutes).

## History

v4 is the fourth engine: the v2 proxy library and the v3 kernel rewrite —
including the landing site, gallery examples, cross-library benchmarks, and
e2e layer — were retired when v4 was promoted to the repo root (2026-08-16;
all of it remains at the `v3` branch tip). v4 = v3 + fero's W1–W17 wishlist
([STATUS.md](STATUS.md) is the ledger) + the adversarial re-evaluation
hardening that preceded the promotion.
