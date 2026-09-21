# REAL.md — wiring site-v8 to the real engine (read fully; then facts.md; then your section's files)

The user approved the UI (DIRECTION.md + facts.md still apply for voice, layout, ownership, tools) and
said: **"proceed to make it all real."** Every "live" thing that was canned becomes the REAL engine
running in the visitor's tab; every printed figure becomes engine-produced or measured in the tab.
The visuals stay as they are — same layout, same ids/classes wherever possible; you are replacing the
smoke behind them, not redesigning. Only the PICKED variants get wired (see DEFAULTS in variants.js);
the other variants stay on disk untouched and may keep their smoke.

## The engine on the page
- `lib/` = `api/index.ts` and its cone, type-stripped by `strip.mjs` (Node's stripTypeScriptTypes) —
  the ACTUAL source, file for file. `gen/` = build-tier facts (`manifest.json`: SCHEDULE_VERSION,
  SCHEMA_VERSION, operators (33, with category), reserved (52), exports, `tests` (330), `dependencies`
  (0); `schedule.json`: the 11 clause texts; `proofs.json`: the 18 conformance tests → clause + gist).
- Import map names (already injected into page.html → index.html): `data` (api/index.js),
  `data/contract`, `data/conform` (conform()), `data/replay` (ReplaySink, deepEq), `data/legality`,
  `data/schedule-suite` (the REAL conformance/schedule.test.ts, node:test/node:assert shimmed),
  `data/shim-test` (`tests` array the suite registered into), `data/devtools`, `data/devtools-dom`,
  `data/devtools-panel`; and the race's peers from esm.sh: `mobx`, `solid-js`, `@preact/signals-core`,
  `@vue/reactivity`, `crossfilter2`, `rxjs`, `rxjs/operators`, `react`, `react-dom`,
  `react-dom/client`, `svelte/store` — **load a peer ONLY on an explicit visitor action** (selecting it),
  never on first paint.
- `engine.js` boots the engine ONCE for the page: `import { api, contract, attest, put, fmt, fps,
  onFrame, libResources, REDUCED, COARSE } from '../engine.js'`. `api` = the full export of
  api/index.ts: `$ value node batch render el text list bind wireSink ingest lane runtime Runtime
  InMemoryBacking handleFor exportContract HOT …` (see `gen/manifest.json` → exports). `contract` =
  contract/index.js (`SCHEDULE_VERSION`, `SCHEMA_VERSION`, `RESERVED`). One runtime per page unless you
  construct a second (`new api.Runtime()` + `api.handleFor(new api.InMemoryBacking(rt, {}).source)`).
  `onFrame(fn)` registers into the page's single rAF loop (return quickly while hidden/off-screen).
  `window.__engine = { api, contract }` for probes.
- The footer's `engine · live` is the page's attestation that the real engine loaded.

## The honesty rules (this is what "real" means — tools/audit.mjs enforces it)
1. **Every printed digit** outside `pre`, `code`, `[data-literal]` must live in an element stamped
   `data-attested="runtime|measured|build"` — use `attest(el, value, tier)`. `runtime` = the engine
   produced it (seq, rowCount(), a view's value, a delta's prev/next, a WireBatch); `measured` =
   performance.now / rAF / MutationObserver / resource timing in THIS tab; `build` = from gen/.
   A `[data-attested]` element must never be empty or `—` once the page is up.
2. **Never type a number the engine can produce.** Row counts come from `rowCount()`; values from
   `view[value]` / sinks; seq from the batch; deltas printed from the real CommitBatch / WireBatch.
   Prose that carried a figure ("231,083 flight rows", "150,000 orders", "18 tests", "33 operators")
   must print it from the engine/gen into an attested `<b>` (or be reworded without the figure).
   Literal typography that is not a figure (section numerals, "1 / 9" carousel position, keyboard
   hints, `t1` keys inside data-attested tables) → `data-literal` on the element, sparingly.
3. **Absolute performance figures (µs, ms, ×) appear ONLY when measured in this tab**, labelled as
   such ("this machine" / "measured"), and computed from `performance.now()` around the real work
   (or `runtime().onCommit` node ms). Peer multiples: measured against the peer running in the tab,
   or shown as `—` with a "measure ▸" action. No canned curves, no invented multiples.
4. **Synthetic INPUT is fine; synthetic OUTPUT is not.** A random-walk order book, generated trades,
   a scripted writer — all fine (they are the writes). Every number the page prints as a RESULT of
   those writes must come from the engine.
5. **Remove the smoke, don't hide it.** Delete the fake timers/models from the picked variant's
   code path. A canned number that survives behind a real-looking label is the one failure that
   matters here.
6. Reduced motion: presentation animations (a travelling dot, a sweep, a stagger) may remain as
   PRESENTATION of real events — never as the source of a number — and rest under
   `prefers-reduced-motion`.

## Engine facts you will use (verify signatures in the repo source before use; don't guess)
- Sources: `$({ t1: {...}, … })` object-born (string keys); `$([ … ])` array-born (minted int keys,
  order channel). Reads: `h[value]` (current value), `h.rowCount()`, `h.snapshot()`, `h.get(k)`.
  Writes: `h.get(k).set('qty', 380)`, `h.t3.qty.update(380)`, `h.insert(row)`, `h.get(k).remove()`,
  `h.patch(k, {...})`; `batch(() => {...})` = ONE commit (k writes → 1 delta per key).
- Operators (registry names, 33): filter map gt lt gte lte between intersect union except · sum avg
  length group lengthBuckets some every · az za top limit reverse max min reduce distinct to quantile
  percentile median · tap keys values. `length()` = count; `length(fn)` = counts per bucket
  (`{ bucket: { value: N } }` wrappers — read ops/bucket.ts); `between(col, [lo,hi])` or
  `between(col, boundsHandle)` (reactive bounds: `filters.get('hour')` then
  `filters.get('hour').update([lo, hi])`); `za('qty', n)` = top-n descending; set ops take view
  operands and never dedup; `median('px')` R-type-7.
- Subscriptions: `v.sink({ init(snapshot, order?), apply(batch), wantsOrder? })` — batch =
  `{ seq, origin, rows: RowDelta[], order?, scalar? }`, RowDelta = `{ op: 'add'|'update'|'remove',
  key, row?, prev?, path? }`; `v.connect(opts, fn)` (v2 records); `wireSink(v, wb => …, { origin,
  initial })` → WireBatch `{ keyDomain, seq, records: [{ t, k, v, prev, path, at }] }`;
  `ingest(target, records, { origin })` (one commit; per-record isolation); `lane(source, { origin })`.
- Runtime: `runtime().seq`; `runtime().onCommit(c => …)` → `{ seq, origin, nodes: [{ id, deltas,
  ms }] }` in settle order (ms measured by the kernel only while a hook is live); `runtime().graph()`
  → `{ id, kind, op, parents, height }[]`; node metadata via `v[node].id / .height / .opName`;
  `import('data/devtools')` → `graph(target)`, `inspect`, `trace`, `profile`, `cascades`;
  `import('data/devtools-panel')` → `mountPanel({ open })` (the REAL dock, closed-shadow, fixed to
  the right edge; `.open()` / `.close()`).
- Conformance: `import('data/conform')` → `conform(v[node])` (LegalityChecker + ReplaySink on every
  commit; a violation throws through clause 4 as an AggregateError from the batch); `import('data/
  replay')` → `deepEq(a, b)`, `ReplaySink`; the suite: `await import('data/schedule-suite')` then
  `const { tests } = await import('data/shim-test')` → `[{ name, fn }]`; run `await t.fn()` each
  (proto/site-v7/smoke/index.html did exactly this: 18/18 in a browser). `gen/proofs.json` maps each
  test name to its clause.
- Render: `render(host, list(view, (row, key) => el('li', null, el('b', null, row.sym), row.qty)))`,
  `text(view)`, `bind(view)`; per-key surgical DOM updates (measure them with a MutationObserver).
- Gotchas: `lane()` throws on array-born sources; `intersect/union/except` never dedup; the
  `Symbol.for('data.v4.node')`/`('data.v4.value')` keys are `node`/`value`; a sink attached inside
  a batch attaches at the commit (clause 7); a throwing effect sink surfaces as AggregateError after
  the drain (clause 4).

## Working rules
- You own `sections/<name>.html/.css/.js/.md` and `sections/<name>/`. Never touch engine.js,
  page.html, strip.mjs, build.mjs, v2.css, variants.*, tools/, shim/, lib/, gen/, another section.
- `node proto/site-v8/build.mjs` assembles index.html (fast, safe, concurrent). Do not run strip.mjs.
- Server: http://localhost:4176/ (already running; never start one). Playwright resolves from the repo
  root (cwd = /mnt/c/Users/pemrouz/cloud/data).
- Verify, every iteration: (a) zero console/page errors; (b) `node proto/site-v8/tools/audit.mjs
  http://localhost:4176/` → grep `[<your-section-id>]` — drive YOUR lines to zero (other sections'
  lines are other builders'); (c) `node proto/site-v8/tools/probe.mjs "http://localhost:4176/"
  --dwell 2500 <scrollY-of-your-section>` → fps ≥ 55 with your section in view (the probe reads the
  page-wide meter); (d) a scratch Playwright script that exercises your control and asserts the
  ENGINE moved (`window.__engine.api.runtime().seq` advanced; the printed values changed
  accordingly); (e) shots at 1440 / 1280 / 390 via tools/sec.mjs, Read them — the look must survive.
- Boot cost: the page must paint and the lede's figure must be live within ~300 ms of engine load.
  Anything heavy (a 150k-row source, a 37 MB dataset) is constructed lazily when its section nears
  the viewport (IntersectionObserver, rootMargin ≥ 600px), with an attested progress line meanwhile.
- Finish by rewriting `sections/<name>.md`: what is real now, what is measured vs runtime vs build,
  what input is synthetic, what (if anything) is still presentation-only, and how you verified it.
