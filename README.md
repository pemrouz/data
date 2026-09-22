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

**Live:** https://pemrouz.github.io/data/ — the landing page runs this very
engine in the browser (its source is [site/](site)).

## Install

```sh
npm i data
```

```js
import { $, batch, render, el, list } from 'data'
```

ESM only (no `require` entry). Node ≥ 20 imports it as is (no flags — the
package ships JavaScript); a browser takes it through a bundler, or an
importmap that points `data` at the package's `dist/api/index.js`. JSX:
`"jsxImportSource": "data"` resolves the automatic runtime (`data/jsx-runtime`,
`data/jsx-dev-runtime`); the classic `h`/`Fragment`/`For`/`ErrorBoundary` come
off the main entry, typed per tag as well (`"jsx": "react"`, `"jsxFactory": "h"`,
`"jsxFragmentFactory": "Fragment"`). TypeScript resolves the subpaths' types under
`moduleResolution` `node16`/`nodenext`/`bundler` (the legacy `node10` sees
only `data`).
`data/devtools` is the inspector — importing it attaches `$.inspect`/`$.graph`/
`$.trace`/… and, in a browser, mounts the overlay panel (`?nopanel` keeps the
console helpers only); `inspect`/`graph`/`trace`/`profile`/`cascades`/
`mountPanel` are its named exports; `runtime().seq` / `.onCommit(hook)` / `.graph()`
are the observability primitives the shipped `Runtime` type carries.

The tarball is `dist/` — the sources type-stripped FILE-FOR-FILE by
[build.mjs](build.mjs) (Node's `stripTypeScriptTypes`: one module per source
file, `.ts` specifiers rewritten to `.js`, nothing bundled, so a stack trace
names the file you would open) — plus the curated types
([types/public.d.ts](types/public.d.ts) for `data`, `types/jsx-runtime.d.ts`
for `data/jsx-runtime` + `data/jsx-dev-runtime`, `types/devtools.d.ts` for
`data/devtools`: written by hand and gated by `npm run typecheck`, not emitted) and
[contract/SCHEDULE.md](contract/SCHEDULE.md). Zero runtime dependencies.
Inside the repo nothing goes through `dist/`: fero imports
`../../data/api/index.ts` by relative path and Node runs the `.ts` under
`--experimental-strip-types`.

## The contract

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

Inside the repo this library is source-served — node
`--experimental-strip-types` reads the `.ts` directly; `dist/` exists only
for npm. Its in-repo consumer is **fero** ([github.com/pemrouz/fero](https://github.com/pemrouz/fero);
checked out beside this repo as `../fero-v2`) — a replicated, partitioned
runtime whose substrate imports the one entry
[api/index.ts](api/index.ts) by relative path and applies replication
records through the hot lane ([seam/index.ts](seam/index.ts) `lane()`), with
fero's CI riding this repo's SCHEDULE conformance suite cross-repo.

```js
import { $, batch } from 'data'            // exports["."] → dist/api/index.js (api/index.ts in-repo)

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
- `npm run build` — `dist/` for npm (`npm run pack:check` builds and lists
  the tarball; `prepublishOnly` = build + test + typecheck).

## History

v4 is the fourth engine: the v2 proxy library and the v3 kernel rewrite —
including the landing site, gallery examples, cross-library benchmarks, and
e2e layer — were retired when v4 was promoted to the repo root (2026-08-16;
all of it remains at the `v3` branch tip). v4 = v3 + fero's W1–W17 wishlist
([STATUS.md](STATUS.md) is the ledger) + the adversarial re-evaluation
hardening that preceded the promotion.
