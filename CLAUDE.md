# CLAUDE.md

Guide for Claude sessions working in this repo. Read this before making changes.

## What this is

**data v4** — a reactive data engine: sources (`$(value)` handles), a CLOSED
delta algebra ([contract/delta.ts](contract/delta.ts): three row verbs, three
order verbs, one scalar shape, one batch envelope — that is the WHOLE
protocol), incremental operators, native/wire/record subscriptions, and a DOM
render layer (builders + classic/automatic JSX + a devtools panel), all under
the EXECUTABLE timing contract [contract/SCHEDULE.md](contract/SCHEDULE.md)
(`SCHEDULE_VERSION`, currently 4).

**fero (`../fero-v2`) is the only in-repo consumer.** Its substrate imports
exactly one entry — `../../data/api/index.ts` — and its CI runs this repo's
[conformance/schedule.test.ts](conformance/schedule.test.ts) against data HEAD
(`test:contract`, chained into fero's `npm test`). Inside the repo everything
is SOURCE-SERVED — fero, the suite, the perf gates and the site's strip all
run the `.ts` via `--experimental-strip-types`. For npm the package is
`data@4.0.0`, served from `dist/`: [build.mjs](build.mjs) type-strips the
sources FILE-FOR-FILE (Node refuses to strip under node_modules, so the
tarball ships JavaScript) and `exports` point at `dist/` + the curated
`types/*.d.ts`; nothing in the repo imports `dist/`. The landing page lives in
[site/](site) and runs THIS engine in the browser (see Layout and Commands).

History: the v2 proxy library, the v3 kernel rewrite, the landing site, the
gallery examples, and the Playwright e2e layer were all retired at the v4 root
promotion (2026-08-16). The full old tree remains at the **`v3` branch tip**;
an uncommitted site-redesign WIP is stashed (`git stash list` — apply it on
the `v3` branch only). v4 = v3 + fero's W1–W17 wishlist ([STATUS.md](STATUS.md)
is the ledger), hardened by an adversarial re-evaluation (10 confirmed
findings fixed — see the 2026-08 log entries).

## Layout

| Dir | What lives there |
|---|---|
| [api/](api) | The public surface: `$()`, the shared-handler Proxy handles, builtins (`get/set/update/insert/remove/patch/connect/sink/ingest/promote/each/rowCount/snapshot/mirror/raf/first/last`), `connectPath` (per-path records), operator dispatch off the registry, `handleFor`, `batch`, `runtime`. Re-exports the render/jsx/devtools/seam surface — fero imports THIS ONE ENTRY. |
| [kernel/](kernel) | `Runtime` (two-phase batch commit, height-ordered settle, effect phase, re-entrant write queue, `attachWhenSettled`), `DataNode`/`SourceNode` (+ `attachSettled`, `diffOrder`, `pathCopy`/`pathDelete` — the clause-10 deep-path law), `Store` (adopted containers; minted int keys vs adopted string keys), `scope`. |
| [ops/](ops) | The typed operator registry ([ops/registry.ts](ops/registry.ts): name/kind/category/dedupKey) + implementations: rowops (filter/map/compare + `rescopeFilter` W10), ordered (az/za/top/limit/reverse), between (reactive bounds), setops, bucket (group/lengthBuckets), misc (max/min/some/every incl. col overloads W12, reduce, distinct, tap, to, keys/values, mirror), quantile (median/percentile/quantile W13, R-type-7), aggregate (sum/avg/length), reactive (value-slot reactive args). |
| [seam/](seam) | The outside-world boundary: `ingest()` (both wire profiles, per-record isolation — clause 10d), `lane()` (the HOT ingest lane — fero Recs verbatim, W7), `wireSink()` (native egress, application-order emission, keyDomain W1), `fromAsync`, `SourceBacking`/`InMemoryBacking`/`mount()` (W5), `exportContract()`. |
| [contract/](contract) | [SCHEDULE.md](contract/SCHEDULE.md) (the law), [delta.ts](contract/delta.ts) (the verb algebra), [index.ts](contract/index.ts) (`SCHEDULE_VERSION`, `SCHEMA_VERSION`, `RESERVED`, `WireRecord`/`WireBatch`/`ChangeRecordV2`). |
| [conformance/](conformance) | [schedule.test.ts](conformance/schedule.test.ts) — the executable contract (one+ test per clause; fero rides this file CROSS-REPO, so keep its import cone repo-internal and CWD-independent). Plus legality/replay harness + conformance/differential suites. |
| [compat/](compat) | `V2RecordSink`/`connectRecords`/`materialize` — the v2-record profile (PERMANENT, not a shim; fero's `records()` shape). |
| [render/](render) [jsx/](jsx) [devtools/](devtools) | DOM render layer (el/text/list/bind/component + HTML/SVG builders + mock-dom tests), classic `h` + automatic runtime JSX, devtools + overlay panel. |
| [types/](types) | The FOUR type-gate programs (`npm run typecheck`): `tsconfig.json` (surface.ts + check.ts + check.negative.ts), `tsconfig.jsx.json` (classic JSX), `tsconfig.auto.json` (automatic, `jsxImportSource: "data"`), `tsconfig.public.json` (**the SHIPPED types** — [public.d.ts](types/public.d.ts) for `exports["."]`, `jsx-runtime.d.ts` for `./jsx-runtime` + `./jsx-dev-runtime`, `devtools.d.ts` for `./devtools` — checked via the `check.public.*` fixtures (check.public.ts; check.public.tsx under `jsxImportSource: "data"`; check.public.classic.tsx under the classic `h` pragmas; check.public.devtools.ts; check.public.lockstep.ts) with positives + biting `@ts-expect-error` negatives, every bare specifier resolved through `paths`). |
| [perf/](perf) | The four gates `npm run perf` runs (see below) + `commit.bench.ts` (informational absolute tracker). |
| [build.mjs](build.mjs) → `dist/` | The npm build (`npm run build`): walks the `exports` entries (`api/index.ts`, `api/jsx-runtime.ts`, `devtools/entry.ts`) and type-strips their import cones FILE-FOR-FILE with Node's `stripTypeScriptTypes` (`.ts` specifiers → `.js`, one module per source file, nothing bundled), then gates: `node --check` on every module, no `.ts`/`node:` specifier survives, no runtime dependencies, a consumer smoke in a fresh Node process. `dist/` is GENERATED and gitignored (so are `*.tgz`) — never edit it, never import it from repo code. The shipped types are NOT emitted from it (see the contract discipline). |
| [site/](site) | The landing page (https://pemrouz.github.io/data/): `page.html` + `sections/<name>.{html,css,js}` assembled by `site/build.mjs` (not the root build.mjs); `site/strip.mjs` type-strips the api cone + the conformance suite into `lib/` and extracts the law into `gen/` (gitignored by design, built in CI by [.github/workflows/pages.yml](.github/workflows/pages.yml) on every push — INTERIM since 2026-09-21: TRACKED while the repo's Actions are locked, so regenerate before committing; see .gitignore). [site/REAL.md](site/REAL.md) is the honesty rule (every printed digit `data-attested`), `tools/audit.mjs` its gate; `sections/<name>.md` hold each section's notes and measurements. |

## Commands

| Command | What it does |
|---|---|
| `npm test` | The whole suite (330+ tests) via `node --experimental-strip-types --test` over `api kernel ops seam conformance render jsx devtools`. The suite needs no build — it runs the `.ts` directly (the only build in the repo, `npm run build`, is for npm). |
| `npm run typecheck` | The four type programs (all `noCheck:false`). The pre-commit hook runs this too when TS/tsconfig/package.json is staged. |
| `npm run perf` | m1 (single-tick: chain/bare ratio ≤ 3 + absolute ceilings), m2 (brush/batch flagship shapes, absolute ceilings), m3 (hot-lane replication: frame-16 ≤ 3 µs/rec + CROSS-LANE state equality), m4 (allocation + sink-cost budgets, B1–B5). All SELF-CONTAINED and machine-calibrated (the v2-relative referents were retired at the promotion; the final A/B numbers are recorded in each gate's header + STATUS.md). Don't widen a ceiling to make a failing gate pass — investigate. |
| `npm run test:all` | All three above. |
| `npm run bench:commit` | Informational commit-machinery absolute costs. |
| `npm run build` | `node build.mjs` → `dist/` (see Layout). The only build in the repo; only npm consumes it. |
| `npm run pack:check` | Build, then `npm pack --dry-run` — the tarball's file list (exactly `files` — `dist`, the three `types/*.d.ts`, `contract/SCHEDULE.md`, README, LICENSE — plus the package.json npm always adds: 40 files). Run it before a release. |
| `npm publish` | The release step — the USER runs it, never a session. `prepublishOnly` = build + test + typecheck (a red gate aborts the publish). Bump `version` first. |
| `node site/strip.mjs && node site/build.mjs` | Builds the landing page's engine (`site/lib`, `site/gen`) and `site/index.html`; `node site/tools/serve.mjs site 4176` serves it, and `node site/tools/audit.mjs http://localhost:4176/ --proofs 18` is the honesty gate (must report 0 problems). Re-run strip after any engine source change. |

## The contract discipline (the most important convention here)

- **A change to any numbered SCHEDULE clause bumps `SCHEDULE_VERSION`** in
  [contract/index.ts](contract/index.ts) AND the SCHEDULE.md header AND the
  suite assert in schedule.test.ts — one commit, all three. The suite runs in
  BOTH repos, so a behavioral edit that forgets the bump fails everywhere.
- Keep the SHIPPED types in lockstep with the runtime. They are CURATED, not
  emitted — three files, one per export subpath:
  [types/public.d.ts](types/public.d.ts) for `"."` (mirrors `api/index.ts`),
  `types/jsx-runtime.d.ts` for `./jsx-runtime` + `./jsx-dev-runtime` (mirrors
  `api/jsx-runtime.ts`), `types/devtools.d.ts` for `./devtools` (mirrors
  `devtools/entry.ts`); all three are gated by `tsconfig.public.json` (the
  `check.public.*` fixtures — .ts, .tsx, .classic.tsx, .devtools.ts, .lockstep.ts — resolve
  every bare specifier through `paths`; positives + biting negatives), and
  the gate stays FOUR programs. Every new public verb goes into public.d.ts +
  its twin surface in [types/surface.ts](types/surface.ts) + a fixture in
  check.public.ts; a new export of a subpath entry goes into that subpath's
  `.d.ts` + a fixture in its check.public.* file (check.public.tsx for the
  automatic JSX runtime, check.public.classic.tsx for the classic `h`,
  check.public.devtools.ts for devtools); every RESERVED
  addition goes into BOTH
  `Reserved` unions. (The re-evaluation found the W-waves shipped
  runtime-only; don't repeat that.)
- Source-only verbs (`ingest`, `promote`) live on the `Writes<T>` interface,
  never `ReadCore` — a verb the runtime throws on for operator views must not
  type-check there.

## The fero coupling (keep it tight)

- fero's substrate (`../fero-v2/api/substrate.ts`) imports ONE entry:
  `../../data/api/index.ts`, using `$`, `value`, `node`, `lane`, `ingest`,
  `DataNode`, `exportContract`. Renaming/moving any of these is a fero-breaking
  change — update fero in the same session and run its suite.
- fero's `npm test` chains `test:contract` →
  `../data/conformance/schedule.test.ts`. Keep that path valid.
- The `lane()` record shape (`HOT` tags ≅ fero kernel REC: `{type:0|1|2,
  key: [rowKey, ...fieldPath], value, at?}`) and the v2-record profile are
  wire-stability surfaces.
- After ANY seam/kernel/api change: `cd ../fero-v2 && npm test` (299+ tests
  + the contract ride). fero's perf pins (`npm run perf` there) guard the seam
  budgets from the consumer side.

## Gotchas that survived into v4 (learned the hard way; all pinned by tests)

- **Mid-batch attach defers** (clause 7, VERSION 4): a `sink()`/`connect()`
  inside an open `batch()` runs its WHOLE attach at the batch's commit via
  `attachSettled` — init reflects the settled state, delivery starts next
  commit. Every public snapshot-then-connect site must go through
  `attachSettled` (api sink/connect, connectPath, connectRecords, wireSink).
  `SourceBacking.subscribe` stays synchronous BY CONTRACT (mount requires it).
- **wireSink emits in application order** (removes → survivor moves → adds at
  ascending final indices → updates): a WireBatch replays sequentially, so
  first-touch rows order desyncs replicas on compound array-born batches.
  `keyDomain` = emitted KEY IDENTITY (root mint mode; bucket views re-key to
  'string'), not orderedness.
- **Reject delivery survives a throwing effect sink** (`finishIngest`):
  ingest/lane deliver `onReject` even when the flush throws clause-4's
  AggregateError; without onReject both classes merge into ONE AggregateError.
- **Clause-10 edges**: `pathCopy` vivifies ANY non-object intermediate to a
  clean `{}` (a string intermediate must not leak index chars); `pathDelete`'s
  array refusal outranks the undefined-leaf no-op; the four same-batch
  field-write+delete merges in `recordUpdate` are pinned by conformance.
- The `Symbol.for('data.v4.node')`/`('data.v4.value')` registry keys are the
  handle identity — version-branded on purpose; do not rename casually.
- Operator dedup is per-registry `dedupKey` (reactive args key by bound-node
  identity); disposed nodes are lazily evicted from the dedup cache (the
  dispose-then-rerequest footgun).

## Working conventions (please follow)

- **Keep docs in sync with code** — this file, SCHEDULE.md (+ the version
  discipline above), STATUS.md's ledger/log, README.md.
- **Commit granularly with detailed messages** (Conventional-Commits-ish:
  `fix(kernel): …`, `feat(seam): …`, `docs: …`); one logical change per
  commit; explain WHY in the body.
- **Present every change in chat before committing** (what/why/test results/
  perf results), then commit and keep moving.
- **Run `npm test` on every change; extend the suite when behavior changes.**
  A bug fix ships with the regression test that catches it (verify the test
  fails on the pre-fix code).
- **Run `npm run perf` for behavior/hot-path changes.** Ceilings are guard
  rails calibrated to the dev machine (WSL2 — wall-clock variance is real and
  documented in each gate); investigate regressions, don't widen.
- **Never push / open PRs without the user's explicit instruction.**
