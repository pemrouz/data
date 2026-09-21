# race — §01 the centrepiece · variant d (THE PICK) · ALL THREE STAGES DONE · reviewed 2026-09-14 · brushing peers ported 2026-09-19 · brushing peers honesty-reviewed 2026-09-19 · brush made continuous 2026-09-20

## State
- **d is wholly on the REAL engine.** Stage 1: the order book (`orders = $(initial)`, the five
  views — `filter→length`, `avg('bid')`, `avg('ask')`, `length(bucket)×2` — one `batch()` per
  frame timed with `performance.now()`). Stage 2: the eight peers are
  the real libraries, imported from esm.sh only on selection, run in lockstep on the same
  ticks. Stage 3 (this): the brushing card runs the REAL flights on the REAL engine — the 37 MB
  `data/flights.js` fetched + parsed in a Worker when the section nears the viewport, the
  231,083 rows built in chunks across frames, `$(flights)` and the old data lane's graph
  (four reactive `between`s, leave-one-out `intersect` → `length(bin)`, `intersect(all
  four).length()`) constructed one step per frame behind an attested progress line; a brush
  handle is one `filters.get(name).update([lo, hi])` timed with `performance.now()` (both
  commits, settle + effects included) → ms/brush + session p50 / p95 / n; the bars are the
  buckets' values, the readout is `count[value]` of `rowCount()`. The audit prints ZERO `[race]`
  lines. Nothing canned survives in d's code path: `makeBrushPanel` / `makeBins` / `makeLatency` /
  `topFive` / `ENGINES[].brushMs·mdTag·ver·at2k` / `costOf` are a·b's only.
- **Brushing peers: PORTED (2026-09-19).** The brushing card switches with the carousel
  exactly as the order book does: selecting a peer re-tags it (name, the import-map pin as
  version — 'build', the engine's tag line, `is-data` off → the ms/brush figure in the peer's
  accent, warn-red over 16 ms), builds that library's OWN brushing lane over the same 231,083
  adopted rows (`race/brush-peers.js`), and every drag is timed against it: data's write runs
  first (the baseline session keeps filling), then the same bounds go through the peer in an
  identical `performance.now()` window — `brush()` + the forced read of its four histograms +
  its count (eager libraries walk inside `brush()`, lazy ones on the read). The charts draw
  the peer's dense bins, the readout is the peer's count, the figures are the peer's own
  session (ms / p50 / p95 / n, for the page's life) plus a "data p50 X · N×" line (data's p50
  for the SAME brushes and the peer's over it). `window.__perf['race.brush.lockstep']`
  compares the peer's count and all four histograms with data's after every brush (always
  true in every run). Re-selecting data drops the peer, repaints data's histograms and
  returns the card to data's own session. A peer selected but not mounted (its import in
  flight, or failed → "peer unavailable") prints NO figures — the slots rest dashed, n 0,
  only the count moves (2026-09-19 review). See "Brushing peers" below.
- a · b · c: not picked, untouched, reachable via `?race=a|b|c`; they keep their smoke and
  load clean, and NEVER fetch the flights (d hidden → its loop never runs → no `near`;
  asserted). Shared code changed only at `race.js`'s header (two new d-only imports,
  `./race/brush.js` and `./race/flights.js`, inert at import time). The latent null-range bug
  in the shared `makeChart` (a resize dragged past the fixed edge) is fixed in d's own chart
  (`race/brush.js`) only — a·b·c still carry it, untouched by rule.

## Files
- `race.js` — `initD`: the book (stage 1), the peers (stage 2), and the stage-3 wiring: the
  lane + loader construction, `flightsStep(now)` (the per-frame pipeline slice), `paintBrush`
  (the attested prints), `onSource` / `onReady` (the counts), `mountBrushPeer` (the brushing peer, under the
  same `selSeq` guard as the book's), `MD_TAG_D` (d's tag lines for the brushing lanes,
  counted from the lanes as built — the shared `ENGINES[].mdTag` strings undercount them and
  stay a·b's). `frame(now)` is a guard around `tick(now)` (the loop body): a commit that
  throws stops the section honestly (`stop(err)`, below) instead of escaping into the page's
  one rAF loop. `window.__race = { brush: lane, book() }` is exposed for probes only (the
  lane's nodes / stats; the book's `orders / liquid / avgBid / avgAsk / bids / asks` handles).
- `race/brush.js` — the brushing card: DEFS (the four dims, each with `res` — the column's
  value resolution; the seeded dim's indexing step and crossfilter's `[lo, hi)` nudge are
  half of it — and, since 2026-09-20, `snap` — the pointer's value on that grid), the d chart painter (empty until `setBins`, inert until built),
  `makeBrushLane` (the graph as build STEPS, the timed write, the session stats, the repaint
  of the charts whose histogram emitted, the peer slot: `setPeer` — its first forced reads,
  `at` = the build window's end BEFORE any canvas paint — `peerBrush`, `lockstep`).
- `race/flights.js` — the main-thread loader half: spawns the worker, mirrors its progress,
  builds the row objects ≤ 6 ms per frame from the transferred columns.
- `race/flights-worker.js` — fetch (streamed, progress every ~40 ms) → `JSON.parse` from the
  first `{` (the module's object literal IS JSON; an `import()` would evaluate 37 MB on the
  main thread in one task) → six typed columns + the airport-code table, transferred.
- `race/peers.js` — stage 2's eight adapters (the order book; unchanged).
- `race/brush-peers.js` — the brushing card's eight peer lanes (the old multidim rows'
  reactive cores, `ref/multidim/lib-*.js`, re-shaped): `loadBrushPeer(id)` → one dynamic
  import through the import map (deduped with the order-book peer's — nothing is fetched
  twice) → `make(rows, seed)`, a SYNCHRONOUS constructor; the adapter contract is
  `{ brush(name, [lo, hi]), hist(name) → Float64Array (dense, the chart's bins), active(),
  dispose() }`. `histOf` / `activeOf` are the two O(N) walks (the old lanes' bodies; the
  bounds read into locals once so a proxy is never measured per row). The walks bucket with
  `DEFS.bin` / `DEFS.bucket` from `race/brush.js` — `DEFS` now derives `bin(row)` from ONE
  `bucket(value)` per dimension, so data's `length(bin)`, the walks and crossfilter's
  `group(bucket)` share the formula.
- `race.html` (d only): the kicker's `#race-fl-kick-d` ("loading the flights" → `<b
  id=race-fl-d>` + " flight rows"), the `#race-fbuild-d` overlay inside the histogram grid,
  `#race-total-d`, `data-literal` on `#race-md-ver-d` (while data) and the `p50` / `p95` /
  `data p50` labels, the caption's `<b id=race-cap-f-d>` ("the" until the source exists),
  the `#race-brush-vs-d` line (hidden under data) with `#race-brush-base-d` /
  `#race-brush-ratio-d`. `race.css`: the overlay over the grid; the `.over` rule the
  `is-data` card needs; `.rd-lat` wraps; at ≤ 720 px the head grid gives the tag line its
  own row (a long engine name beside the figure squeezed it to ellipses — both cards).

## The pipeline (the progress line narrates every phase; each figure is attested 'measured')
1. `near` (IntersectionObserver, rootMargin 600px) → after the order book is built, one slice
   per frame whatever the motion setting: the worker starts (`fetching · N of M MB`, M from
   Content-Length), `parsing`, `projecting` (worker phases, elapsed ms), `building rows ·
   i of n rows` (main thread, chunked), then one ENGINE step per frame: `$(flights)` (O(1) —
   the array is adopted), `filters` (`$({ time: [6, 11], delay: [], distance: [], date: [] })`
   — the initial brush is a construction-time filter, the old lib-data seeding idiom, so
   nothing is written or cascaded for it), `between('time'|'delay'|'distance'|'date')` (each
   `source.between(col, filters.get(col))` — reactive bounds via `betweenR`, `[]` = ±∞),
   `intersect · X` + `length(bin) · X` ×4 (leave-one-out: `source.intersect(...the other three
   dims).length(binX)`), `intersect · all four`, `length()`, `tap × 4` (parameterless taps mark
   the charts whose histogram emitted; the histograms as constructed become the dim background
   bars), `indexing · delay | distance | date` (the column's DOMAIN `[d0, d1]` written per
   unseeded dim: `between` builds its sorted index lazily on the first bounds walk, so without
   these the visitor's first brush on each chart would also pay an O(N log N) sort; every row
   lies inside the domain so they emit no row delta — the driver asserts active === rowCount
   after a reset. Until 2026-09-20 this step wrote `null`, which is `[]` is (−∞, ∞) — the
   bounds the between was constructed with — so the walk returned on equal bounds before its
   sort and the step was a 0.1–0.2 ms no-op; see the 2026-09-20 section), `indexing · hour` (the seeded
  dim: its lower bound moved HALF a value resolution out — `[6 − 1/120, 11]` — and back to
  `[6, 11]`; no time value lies in that gap, so both writes cross zero rows and emit no row
  delta while the first walk builds the sorted index; 47–84 ms here. Before the 2026-09-19
  review the seeded dim was left lazy and the visitor's FIRST hour drag paid the sort —
  52–116 ms printed as a brush and, under a peer, charged to data in the "data p50 · N×"
  line while every peer's one-time index cost sat in its build), `ready`.
2. Parse, per the old multidim `parse()`: date "MMDDhhmm" → a 2001 timestamp in ms (UTC; the
   hours/minutes are read off the string — the old code built a local Date and read
   `getHours()` back: identical except across a DST gap), `time = hh + mm/60`, `delay` clamped
   to [-60, 149], `distance ≤ 1999`, origin/destination interned. The row is a number-valued
   `date` rather than a Date object (same comparisons in `between`, faster sort; the chart's
   domain/ticks are `Date.UTC(2001, m, 1)` and day buckets are `floor(date / 86400000)`).
3. A brush: the chart's drag (new / move / resize; since 2026-09-20 the bound is the pointer's
   position snapped to the column's VALUE resolution — a minute, a unit — and written on every
   pointer move; the picked look's bin snapping made every step a whole-bin jump, see the
   2026-09-20 note) →
   `brush(name, range)` → `write(name, bounds)` (skipped when the bounds did not move — a
   redundant pointermove is never written nor counted, for either engine) →
   `t0; filters.get(name).update(bounds); ms` →
   two synchronous commits inside `update()` (the filters commit, whose effect — the
   reactive-arg binder — writes the between's hidden bounds source; then the bounds commit:
   between's O(Δ) walk → the intersects → the histograms → the taps) — `runtime().seq` advances
   by 2 per brush (asserted) → the stats → the dirty charts repaint from `hist[value]`
   (`{ [bucket]: { value: N } }` → a dense array by `(bucket − d0) / step`) → the readout. A
   range collapsed to a point mid-drag is transient (band hidden, nothing written); the
   release writes the reset (`update(domain)`) once. `null` = unfiltered = the full domain.
   Under a peer the SAME `bounds` then go through `peerBrush()`: `t0; adapter.brush(name,
   bounds); hist(name) × 4; active(); ms` — the peer's ms/brush — its session is recorded
   (`samples`; `base` = data's ms for the same brush, index for index — nothing else is
  ever timed), the three
   other charts repaint from the peer's bins (leave-one-out: the brushed chart's own bars
   never change, in any engine), the readout prints the peer's count, and `lockstep()`
   compares count + all four histograms with data's.

## Attestation map (ids · tier) — the whole section
- runtime: `#race-rows-d`, `#race-cap-n-d`, `#race-liquid-d`, `#race-avg-d`, the ladder
  `.ob-cell-qty` / `.ob-cell-cum` (each row's count from `length(bucket)`, cum = the running
  sum away from the mid), the pill `$mid` = (`avg('bid')` + `avg('ask')`) / 2 and `mean
  spread` = `avg('ask')` − `avg('bid')` (two views — exact, avg is linear; the pill's title
  says so), every `.rd-fill` in `#race-tape-d` (stage 1); `#race-fl-d` (kicker), `#race-cap-f-d` (caption), `#race-total-d`
  = `source.rowCount()`, `#race-active-d` = `count[value]` (stage 3).
- measured: `#race-cpu-d`, `#race-ratio-d`, `#race-base-d`, `#race-tps-d`, `#race-build-ms-d`
  (stages 1–2); `#race-fbuild-ms-d` (the progress figure: bytes received / of Content-Length,
  elapsed ms, rows built of rows parsed), `#race-brush-cpu-d` (session p50 + " ms/brush",
  `.over` warn-red above 16 ms), `#race-ms-d` (this brush), `#race-p50-d`, `#race-p95-d`
  (nearest-rank over every counted brush this session), `#race-n-d` (the count; `0` at rest).
  Under a brushing peer the same slots carry the PEER's window / session (`#race-brush-cpu-d`
  = its p50, `#race-ms-d` its last brush, `#race-p50-d` / `#race-p95-d` / `#race-n-d` its own
  session) plus `#race-brush-base-d` (data's p50 for the same brushes) and
  `#race-brush-ratio-d` (the peer's p50 over it, two decimals below 1×) — all 'measured';
  `#race-active-d` = the peer's `active()` ('runtime' — the selected engine's count, asserted
  equal to data's by the lockstep hook).
- build: `#race-ver-d` and `#race-md-ver-d` under a peer (the import-map pin).
- data-literal: `#race-pos-d`, `#race-rate-out-d`, `#race-ver-d` / `#race-md-ver-d` while
  data is selected, `#race-tag-d`, `#race-md-tag-d` (the engine's tag line; while a brushing
  peer builds it reads "building X on <b>N</b> rows …" with the count nested attested
  'runtime'), the `p50` / `p95` / `data p50` labels, the pane-h "16 ms / 60 fps", the
  caption's "16 ms" and "O(1)", the ladder's price column.
- Unattested by design, never digits: `#race-ratio-d` "baseline" under data; the brushing ms
  slots and header show `—` (attribute removed) until the first brush — and, under a peer
  that is loading or unavailable, for every brush (n stays 0; the count moves); after a `stop(err)`
  (a commit threw) `#race-cpu-d` / `#race-ratio-d` / `#race-base-d` / `#race-tps-d` are dashed
  and unattested, the tag reads "stopped — a commit threw (see the console)", the toggle
  reads `▶ retry`, and `window.__perf['race.error']` carries the message; the kicker span reads
  "loading the flights" and the caption's `<b>` reads "the" until `$(flights)` has run; on a
  load failure the kicker/overlay read "flights unavailable" (`window.__perf['race.flights.
  error']`), the card stays empty, nothing else changes.
- `window.__perf`: `race.flights.ms|rows|bytes|steps` (every phase + engine step ms),
  `race.brush.ms|p50|p95|n|seq|active|total` (data's session — always), and under a brushing
  peer `race.brush.peer` (id) `.import.ms` `.build.ms` (constructor + the first forced reads)
  `.ms|p50|p95|n|active|base|ratio` (its session) `.error`, `race.brush.lockstep` (+
  `.detail` on a mismatch) — plus stage 1–2's keys.

## Synthetic input · presentation-only
- Input: the OU order-book walk (stage 1) — never printed. The flights are REAL data (the old
  crossfilter example's 231,083 rows); the initial hour 6–11 filter is a chosen seed.
- Presentation of real events: the book's flash/tape/wave smoothing (stage 1); the brush band,
  grips and the value-grid snap of the drag; the progress bar's fill fractions (the figures beside it are
  the attested ones).
- Not on the page: the old top-5 list (the d look never had it — no `za`).

## Measured on this machine (WSL2, headless Chromium 1440×900, alone unless noted; real Chrome will differ)
- Pipeline from `near`: 1,078–1,189 ms total — fetch 227–233 · parse 203–205 · project 87–92
  (worker) · build 34–35 (main, ≤ 6 ms slices) · `$(flights)` 0.2–0.6 · `between` 7 (seeded,
  73k members) / 22–30 ×3 · `intersect·X` 16–33 · `length(bin)·X` 10–30 · `intersect · all
  four` 16–18 · `length()` 0 · taps 1.5 · indexing ~60–90 each alone (delay / distance / date —
  real sorts since the 2026-09-20 fix; the steps were 0.1–0.2 ms no-ops before it) / 47–84
  (hour — the seeded dim's ε-step, since the review). 37,313,858 bytes, fetched exactly once (request log), never under `?race=a|b|c`.
- Brushes, the CONTINUOUS drag (since 2026-09-20 — see that section): per-move steps of ~1.1k
  rows crossing, data p50 6.4 · p95 17.8 · max 34.7 ms, the drag itself at 59.9 fps.
- Brushes (ms, the printed figures) under the ORIGINAL bin-snapped drag (before 2026-09-20;
  kept as the record of that look): whole-hour handle steps 18–30 (12–15k rows crossing);
  the seeded hour chart's first touch 32–43 (indexed at build since the review; 52–64
  with the lazy sort in it before); delay bin steps 4–48;
  early-morning hour steps 0.1–1 (a few hundred rows); a NEW selection's first step — the
  full domain narrowed to one bin, ≈ 200k rows evicted through eight nodes — 294–416; a reset
  of the hour brush 359–386 (158k admitted); resets of a narrow delay brush 150–277. With four
  browsers loading concurrently: 400 / 587. Node per-node profile (`onCommit` ms, a 12–15k-row
  step): between 1.5–4 · each intersect 3–5 · each lengthBuckets 1–4.5 (cost ∝ INPUT deltas)
  ≈ 25 total; a domain→[0,10] delay brush 298: between 75 (160k Δ) + intersect 73 + 3 ×
  34–48 + histograms 5–16. These are the engine's honest costs (~0.3–0.5 µs per row per node).
- fps (tools/probe.mjs, scrollY 849): 59.9 at rest. NOTE: probe.mjs computes its `--sel` rect
  BEFORE it scrolls, so with a scrollY its drag lands below the viewport and brushes nothing
  (`race.brush.n` stays 0) — use a driver that measures the rect after the scroll
  (`scratchpad/rv-dragfps.mjs`). The drag figures that follow are the ORIGINAL bin-snapped
  drag's (before 2026-09-20 — 12 brushes for a −190 px hour drag IS the whole-hour step; the
  continuous drag's fps, ~60 brushes a drag, is the last column of the 2026-09-20 table):
  median 59.9 during a −190 px drag on the hour chart (12 brushes, p50 1.1 / p95 209, 3 frames
  over 33 ms — the first step of a new selection), during a −60 px delay drag (18 brushes, p50
  22 / p95 328, worst frame 167 ms, header warn-red) and a +120 px distance drag (38 brushes,
  p50 2.7, no frame over 33 ms). Those long frames ARE the printed brush costs (a ~200k-row
  eviction through eight nodes), not the page. Stage 1–2
  figures unchanged (data 0.2–0.4 ms/frame at 2k ticks/s; the peers as before). Under
  crossfilter at its snap rate (63/s) the peer's own O(N)-per-tick rebuild costs ~200 ms/frame
  and the page runs at ~4 fps while it is selected — the honest cost, printed warn-red, with
  the applied rate (~23/s) in the strip.
- Off-screen: with `near` live (see the review notes) a reader who triggers the build and
  scrolls > 600 px away pays no frame for it — 0 frames over 33 ms, worst 16.8 ms, over 3 s
  while the book build sat at `sink` and the flights at `fetching` (the worker kept fetching);
  back at the section both resumed and finished in ~600 ms.

## Brushing peers (2026-09-19) — what each lane does, the window, what is measured
- mobx / solid / preact / vue: one signal per filter (`observable.box(v, { deep: false })` /
  `createSignal` / `signal` / `shallowRef`), four leave-one-out histogram computeds (each
  reads the OTHER three filters and walks all N rows into a dense `Float64Array`) and an
  active-count computed over all four; a brush = one signal set (inside `runInAction` /
  `batch`), so exactly three histograms + the count recompute — the old lib-mobx.js shape.
  mobx computeds are `keepAlive` (lazy: they recompute on the forced read, inside the
  window); solid memos recompute on set; preact / vue computeds are lazy too.
- rxjs: a `BehaviorSubject` of the filter state piped through five `map()`s — every
  emission re-runs all five walks (no per-key tracking). svelte/store: a `writable` per
  filter, `derived()` over the other three per histogram and over all four for the count,
  subscribed (eager). react: a headless root, `useState` filters, `useMemo` histograms +
  count keyed on the filters object (every brush replaces it, so all five recompute), one
  `flushSync` per brush. crossfilter: `crossfilter(rows)`, one dimension per dim,
  `dim.group(bucket)` per histogram (its native leave-one-out), `groupAll()` for the count;
  a brush = `dim.filterRange([lo, hi + ½ resolution])` — data's `between` is inclusive on
  both ends, filterRange is `[lo, hi)`, so the upper bound is nudged by half the dimension's
  value resolution (time 1/120 h, delay / distance 0.5, date 30 s) to select the same rows.
- The rows: the peer reads the SAME array `$(flights)` adopted (nobody mutates a flight);
  the seed = the bounds data's filters hold at mount (`lane.bounds()`), so the first
  histograms equal data's (asserted at mount). The build runs after one painted frame (the
  tag says "building X on N rows …"), is timed — constructor AND the lane's first forced
  read of the four histograms + count (a lazy library computes nothing before that) — and
  the ms lands in the name's title and `race.brush.peer.build.ms`. The window ends at those
  reads, before the lane paints its four charts (≤ 0.3 ms here — but paint is not build).
- Measured: the peer's window per brush, its session p50 / p95 / n, data's p50 for the same
  brushes and the ratio, the import and build ms. Runtime: the counts (data's, and the
  peer's `active()` under a peer). Build: the version pin. A peer's synchronous O(N) brush
  may drop frames while dragging — that is the measurement, printed warn-red over 16 ms,
  never throttled.
- The card is event-driven: under every gate (reduced motion, paused, a hidden tab,
  off-screen) a mounted peer rests DASHED — n 0 — until the visitor's first drag, exactly as
  data's own card rests; a drag brushes both engines whatever the gate. (The port's
  mount-time "fill" — one timed brush of the bounds the peer already held — was dropped in
  the 2026-09-19 review: crossfilter re-applies an unchanged range as a no-op and printed it
  as a "0.0 ms" brush, seeding its session with a zero, while the identity-comparing
  libraries walked for it — not the same measurement across peers.) A peer selected before
  the flights are built waits for the graph (`onLaneReady`); a failed import prints "peer
  unavailable" and the card keeps data's histograms — and, like the loading window, prints
  NO figures for a brush (the slots stay dashed, n 0; only the count moves); the same
  `selSeq` guard as the book supersedes an in-flight mount.
- The timed steps this machine printed under the ORIGINAL bin-snapped drag (superseded by
  the continuous drag — see the 2026-09-20 section; headless Chromium 1440×900, alone; the hour
  handle dragged 11 → 9, whole-hour steps of 12–15k rows crossing): MobX 17–21 ms/brush, Solid 16,
  Preact signals 14, Vue reactivity 12.5, Svelte store 11, RxJS 23, React 25–32, crossfilter
  0.4–2.7 (p95 1.7); data's same steps 16–29 ms (∝ Δ). Night-hour steps (a few rows): data
  0.2–1.5 ms against the walkers' 11–25 ms (8×–126×); the seeded hour dim is indexed at build since the
  review, so a visitor's first MobX drag reads "data p50 23 · 0.96×" and crossfilter's
  "data p50 24 · 0.06×" (before it data's first touch paid its lazy sort — 69–73 ms under
  three concurrent browsers — and the line read MobX 0.3×, crossfilter 0.02×; the older
  `race-d-brushpeer-*` shots show that). Review run, alone, the same 11 → 8 hour steps:
  MobX 19–25, Solid 21–27, Preact 19–24, Vue 19–24, Svelte 18–25, RxJS 34–40, React 40–45,
  crossfilter 1.1–1.3 ms/brush; data's same steps 16–43; a DIRECT plain-function timing of
  the same three leave-one-out walks + count over the same rows 18–26 — every walker's
  window sits on or above it (RxJS / React above: five walks + framework overhead),
  crossfilter's ~20× below (incremental). Builds: the signal / store / rx / react
  lanes 29–67 ms including their first five walks, crossfilter 202–217 ms (`crossfilter(rows)`
  + four dimensions); imports 48–600 ms from esm.sh. fps at rest at scrollY 849 with a peer
  selected: 59.9 (MobX, Solid; React 59.9 with one 33 ms frame in 2.5 s); crossfilter 4.6 —
  the ORDER-BOOK crossfilter peer's ~180 ms/frame rebuild, as documented above, while the
  brushing lane idles.

## Continuous brush (2026-09-20) — why the bin snap hid the thesis, what changed, what it prints now
- The finding. Under the bin-snapped drag the card read ~1× against the walkers (data 16–43
  ms at a whole-hour step, MobX 19–25) and the visitor's question was fair: an O(Δ) engine
  should beat a re-walk. The thesis held — it was the workload. A crossing row costs data
  FIVE node-deltas (between → four intersects → four folds, ~0.4–0.8 µs each ≈ 2–4 µs a row)
  against a walker's FIXED five-pass walk (~20 ms in the browser, ~80 in Node), so the
  crossover sits at Δ ≈ 3–6 % of N — and a whole hour of the busy day is ~13.7k rows, 6 %
  of N: every snapped step landed exactly at break-even. Node, over the real rows
  (`scratchpad/brush-anatomy.mjs`): whole-hour step 30–56 ms, quarter-hour (~3.2k rows) 5–9,
  per-pixel (~1k) ~2, night hours ~0, against a fixed ~80 ms walk; in the tab (the lane's own
  `brush()`, MobX mounted): whole-hour data 80–230 vs MobX 67–108 (~1×), quarter-hour 31–58
  vs 95–135 (~2.5×), per-pixel 8–15 vs 75–137 (~10×). crossfilter is O(Δ) as well, at
  ~0.1 µs a crossing row (one sorted index + a bitmask per dimension) — a constant-factor
  gap of ~15–20× that stays whatever the step size; it is the honest reading of the kernel.
- What changed (`race/brush.js`). `DEFS[].round` (to the bin) → `DEFS[].snap` (to the
  column's VALUE grid, by the worker's own formulas: time `hh + round(mi)/60`, delay /
  distance integers, date whole minutes) — the bound is bit-identical to a row's value, so
  data's inclusive `[lo, hi]` and crossfilter's `[lo, hi + res/2)` still select the same
  rows for ANY pointer position (lockstep asserted on every move, all four histograms + count).
  `makeChart` writes on every pointermove (new / move / resize); a move that stays on the
  same value is skipped by `write()` (same bounds — never written, never counted); the band
  is drawn where the pointer is. The a/b/c variants' synthetic `RB_DEFS` keep their bin
  `round` (unpicked, untouched). crossfilter's d-tag is now "filterRange + group.all() ·
  O(Δ)/brush" (the one peer in data's complexity class, said in data's words); the caption
  reads "timed on every pointer move as you drag" and names crossfilter's index as
  incremental with a tighter loop over the same crossing rows.
- Measured (`scratchpad/brush-cont.mjs`: headless Chromium 1440×900, load ~1.6, the hour
  handle RESIZED 11 → 5 over 60 pointer moves at 16 ms — ≈ 6 minutes a move, the seed put
  back through the charts before each engine so every engine gets the identical drag; 59
  brushes an engine; rows crossing per move p50 1,090 · max 5,089, the same in every engine):

  | engine | ms/brush p50 · p95 · max | the "data p50 · N×" line | drag fps (frames > 33 ms) |
  |---|---|---|---|
  | data | 6.4 · 17.8 · 34.7 | — | 59.9 (13 of 295, worst 50 ms) |
  | MobX | 55.6 · 82 · 88 | data p50 6.9 · 8.1× | 29.9 (219 of 243) |
  | React | 110.8 · 155 · 197 | data p50 7.9 · 14× | 29.9 (190 of 246) |
  | crossfilter | 0.4 · 0.9 · 2.9 | data p50 5.5 · 0.07× | 1.5 — the ORDER-BOOK crossfilter peer's rebuild, as documented |

  lockstep true on every move of every peer. Two more runs the same evening: alone, 4.3–6.2
  / 50.6 / 70.8 / 0.2 (8.3× · 14× · 0.05×); under another session's test suite (a core
  pinned), 11–14 / 101 / 194 / 0.6 (8.2× · 18× · 0.05×) — the multiples hold under load, the
  absolutes do not. The shots driver's 12-move whole-hour step (5-minute moves) printed data
  4.1–9.2 ms/brush, MobX 53–75, crossfilter 0.3–0.5 (`shots/race-d-brushpeer-*`, rewritten).
- Still the engine's honest costs, printed as before: a NEW selection's first move — the full
  domain narrowed to one pixel's width, ~230k rows evicted from the `between` and folded through
  the eight nodes below it — 300–440 ms (it was 294–416 at one bin); a session that starts with
  a fresh brush carries it in its p95. (The late-evening review re-measured it at 1.5–2.2 s, in
  the tab and in Node alike — the same 227,355 rows, 72,999 → 625, one brush, the press writing
  nothing — with the whole machine 4–6× slower at the time: `brush-anatomy.mjs`'s plain-JS
  walker read 437–506 ms against its ~80 above, whole-hour steps 108–240 against 30–56. The
  figure is this machine's on a quiet evening; the shape — ∝ the rows crossing — is the claim.)
  Moving a wide band crosses rows on both edges. The audit after the change: 248 attested,
  0 problems (`--proofs 18`); zero page errors in every driver.
- Adversarial review of the change (2026-09-20/21, two agents: code behaviour · copy/docs;
  drivers `scratchpad/cb-*.mjs`). Refuted: an off-grid snap (snap(v) === v for every row value
  of every dimension, 200k random pointer values per dim land on the grid, `[lo, hi]` ≡
  `[lo, hi + res/2)` on 40 random ranges a dim); a lockstep break in any of the eight peers ×
  four charts × new / resize-through-the-fixed-edge / move-past-the-domain-edge / collapsed
  release / reset link (161 brushes an engine, lockstep true after every move, a brute force
  equal to both engines after every phase); a same-value move that writes or counts (121
  sub-pixel moves: 85 same-value → 0 counted, 36 new-value → 36, seq +2 each); figures under a
  loading / failed peer; the ratio line (peer p50 / data p50 to the digit); the a/b/c variants;
  touch, right button, pointercancel, edge clamps, month-boundary dates. ONE real defect, fixed
  in `brush.js` `steps()`: the three unseeded dims' `indexing` steps wrote `null` — `[]` — which
  is (−∞, ∞), the bounds the between was constructed with, so `between` returned on equal bounds
  BEFORE its lazy sort: the index stayed empty (0 entries, 0.1–0.2 ms steps against the hour's
  92) and the visitor's first delay / distance / date brush paid the O(N log N) sort inside
  the brush window; worse, `written[name]` stayed null, so a plain click or a reset on an
  unbrushed chart was a COUNTED brush — "210 ms/brush" warn-red under data, "112 ms/brush ·
  data p50 271 · 0.41×" under MobX (a no-op click printed as data's brush with the sort inside
  and MobX's full walk beside it), "0.2 ms/brush · data p50 70 · 0.00×" under crossfilter. Now
  the step writes `def.domain.slice()`: it differs from (−∞, ∞) so the walk sorts, no row lies
  outside it so zero rows cross (verified with an `onCommit` hook: 5 filters commits, 0 row
  deltas below), and a plain click / reset on an unbrushed chart is the same-bounds skip (n
  0 → 0 under data, MobX, crossfilter). The three sorts now land in the build's progress line,
  where every peer's index cost is charged. Quiet-machine re-measure of the table's workload
  after the fix: data 3.4 · 9.1 · 17.4 ms at 59.9 fps (0 frames over 33 ms); MobX 30.3 · 40.2 ·
  45.8 → "data p50 3.5 · 8.7×"; React 64.4 · 81.6 · 85.5 → "data p50 4.4 · 15×"; crossfilter
  0.2 · 0.6 · 0.9 → "data p50 3.1 · 0.06×"; a NEW selection's first move 549–637 ms under data
  alone (crossfilter 20–34, MobX 26–37 — the one step where the walkers' fixed cost beats an
  eviction of 227,355 rows through the graph). Audit after the fix: 257 attested, 0 problems.
  Pre-existing, not changed: the brush canvases have no keyboard path (only each chart's
  reset button is focusable).

## Verified
- The entries below dated before 2026-09-20 ran under the bin-snapped drag: a drag's brush
  count there (7 for a delay drag, "n 2" with the hour handle at 9) is that step size's, not
  the continuous drag's (~one brush per pointer move — `brush-cont.mjs`, the 2026-09-20
  section); every other assertion they make still holds as written.
- `scratchpad/brush-peers.mjs [peers…]`: for each peer — select → wait for
  `race.brush.peer` + `.build.ms` → the card re-tagged (name, version 'build', not is-data,
  the engine's tag, the build in the name's title), lockstep at mount, the readout = the
  peer's count = data's; the hour handle dragged (rect computed AFTER the scroll) → ms / p50
  / p95 / n attested measured numbers that moved, n = the PEER's session count, the printed
  ms = its window, data still brushed underneath (seq ≥ +2 per brush), lockstep true, the
  count moved and equals data's and a brute-force walk of the rows under the live bounds,
  the other three canvases repainted, the header = the peer's p50 in its accent (warn-red
  iff > 16), the "data p50 · N×" line measured, the page-wide audit walker clean; then data
  again → `data v4` (literal), is-data, the figures = data's own session, the vs line hidden,
  the peer dropped, the charts from data's histograms pixel-identical to the peer's; the
  first peer re-selected resumes its session. ALL OK for all eight peers and for the trio
  after every change; 13 esm.sh requests for the trio (deduped with the book's imports).
- Review scripts (`scratchpad/hr-*.mjs`, 2026-09-19; `hr-lib.mjs` shared): `hr-timing.mjs`
  (stubbed clock, direct-walk comparison, raw brush/read split, nearest-rank check — all
  eight peers), `hr-results.mjs` (the loading window; 11 drives × 8 peers with an
  independent brute force on count + four histograms), `hr-fail.mjs` (a failed import on a
  fresh page), `hr-seed.mjs` (parity at the seed, at non-default bounds, after resets),
  `hr-leaks.mjs` (esm.sh before selection, dedup, stale adapters, heap), `hr-gates.mjs`
  (reduced motion / paused / hidden / off-screen — the no-fill contract), `hr-fps.mjs`,
  `hr-verify.mjs` (the ε-indexing step, the first brush, the tags, the build window),
  `hr-shots.mjs`, `hr-index.ts` (Node, the engine alone). ALL OK after the fixes; the
  port's `brush-peers-extra.mjs` reduced-motion / paused expectations (a mount fill, n 1)
  are superseded by `hr-gates.mjs`.
- `scratchpad/brush-peers-extra.mjs`: reduced motion → MobX mounts with ONE measured brush
  (n 1, no data counterpart, vs hidden) and a drag then pairs; paused → the same for
  crossfilter; a peer selected BEFORE the flights are built re-tags at once ("loading Solid
  …"), mounts once the graph is up, lockstep true, n 0; rapid switching (mobx → react → data
  → vue → crossfilter within 200 ms) mounts only the last on both cards; `?race=a` clean.
  ALL OK, zero errors throughout.
- `scratchpad/brush-peers-fps.mjs`: the fps figures above. `tools/probe.mjs` at 849: 59.9.
- `tools/audit.mjs --proofs 18`: 0 problems page-wide (255 attested) — also with a peer
  selected (the driver's in-page walker, the same checks).
- Shots: `shots/race-d-brushpeer-{data,mobx,crossfilter}-{1440,1280,390}.png` (built,
  mounted, one hour step; `scratchpad/brush-peers-shots.mjs`), `-390-head-book.png` for the
  phone-width head rows.
- `scratchpad/race-brush.mjs`: waits for `race.flights.ms`; at rest the kicker / caption /
  total print `rowCount()` (runtime), active === `count[value]` === `active.rowCount()`, the
  three unbrushed histograms sum to active and the seeded chart's own to rowCount (leave-one-
  out), a brute-force walk of `source.each` inside [6, 11] equals the engine's count, n = 0
  and the ms slots dashed + unattested, the filters source holds `[6, 11]`, the overlay hidden;
  a delay drag: 7 counted brushes, seq +71/72 (≥ 2 each), active fell and equals `count`, the
  brushed chart's own histogram unchanged, the prints equal the stats through the page's
  formatter, a two-brush brute-force count matches; the hour handle resized [6,11]→[6,8]; the
  collapse case (past the fixed edge → [4,6] → back to a point → release): no error, the
  point writes nothing, the release writes the domain once; resets → active === rowCount;
  the race audit walker: 0 lines; zero page errors.
- `scratchpad/race-brush-extra.mjs` (stage 3, before the port): `?race=a|b|c` zero errors and
  no flights fetch; reduced motion builds and a handle drag brushes; its "stays data under
  MobX" assertion is superseded by `brush-peers.mjs`.
- `scratchpad/brush-profile.ts`: the Node per-node profile above.
- `tools/audit.mjs`: 0 `[race]` lines (0 problems page-wide at the time of the run, 256
  attested elements). `tools/probe.mjs`: as above.
- Shots: `shots/race-d-final.png`, `-1280.png`, `-390.png` (built state, via
  `scratchpad/race-shots.mjs` which waits for the build — sec.mjs's fixed waits can catch the
  progress overlay at 390), `race-d-final-drag.png` (mid-drag: the hour handle at 9, the
  accent bars under the dim totals, "35 ms/brush" warn-red, p50 35 / p95 92 / n 2); the
  earlier `race-d-real*.png` / `race-d-mobx.png` / `race-d-react.png` still show stages 1–2.

## Review (2026-09-19, the brushing peers — adversarial honesty pass; findings and what changed)
- **A peer's name over data's figures (fixed).** While a peer's import was in flight
  ("loading MobX …", 50–600 ms from esm.sh, longer on a slow link) — and permanently after a
  failed import ("peer unavailable") — a drag went through `paintDataFigures`: data's ms /
  p50 / p95 / n were printed under the PEER's name, in the peer's accent, warn-red over
  16 ms (`hr-results.mjs`: "76 ms/brush · n 1" under MobX before its mount; `hr-fail.mjs`
  with esm.sh blocked for preact on a fresh page: "122 ms/brush" warn-red under "Preact
  signals"). Now `paintBrush` prints figures only for the SELECTED engine — data's under
  data, the peer's under a mounted peer; otherwise only the count moves and the slots
  stay dashed, n 0 (both scripts assert it).
- **Asymmetric one-time costs in the "data p50 · N×" line (fixed).** Every peer's index
  cost (crossfilter's dimension sorts, the walkers' first five walks) was charged to its
  BUILD, but data's seeded hour dim was left lazy, so the visitor's most likely first drag
  paid `between`'s O(N log N) sort inside the brush window — 52–116 ms, printed as a brush
  — and the ratio line read "data p50 71 · 0.3×" (MobX), "84 · 0.0×" (crossfilter) in the
  port's own shots. The build now has an `indexing · hour` step (and since 2026-09-20 the three unseeded dims' steps actually sort — until then they wrote null = (−∞, ∞), the constructed bounds, and were no-ops; see that section): the seeded dim's lower
  bound moved half a value resolution out and back (`DEFS[].res`; zero rows cross, zero
  row deltas — `hr-index.ts` on 231k synthetic rows of the same shape, `hr-verify.mjs` on
  the page: count unchanged, brute force equal); the first hour brush was then 32–43 ms
  (∝ Δ — a whole-hour step under the bin-snapped drag of the time; see the 2026-09-20
  section) and a first MobX drag read "data p50 23 · 0.96×".
- **A no-op printed as a 0.0 ms brush (fixed).** The mount-time "fill" under reduced motion
  / paused re-brushed the bounds the peer already held: crossfilter's `filterRange` of an
  unchanged range is a no-op (it compares by value) and the card printed "0.0 ms/brush" for
  it, seeding its session with a zero; the identity-comparing libraries walked for the same
  call — not one measurement. The fill is gone (`peerBrushOnce` removed): a mounted peer
  rests dashed, n 0, under every gate until a real drag, as data's card does
  (`hr-gates.mjs`: reduced motion, paused, hidden tab, off-screen).
- **The build window included four canvas paints (fixed, a note).** `setPeer` painted the
  charts before `mountBrushPeer` read its end time; the paints cost ≤ 0.3 ms here against
  35–240 ms builds (`hr-fps.mjs`). `setPeer` now returns `at`, taken right after the forced
  reads.
- **Tag lines undercounted the lanes (fixed).** The shared `ENGINES[].mdTag` strings
  ("computed × 4", "useMemo × 4", "map() × 4", "derived × 4") described a·b's smoke; the
  lanes as built have four filter primitives → FIVE derivations (four histograms + the
  count), React has TWO memos (one for all four histograms, one for the count — the ref's
  shape), RxJS a BehaviorSubject through five maps. d-only `MD_TAG_D` strings now count
  what runs (crossfilter's shared string was accurate and fits — kept then; on 2026-09-20 d got its
  own "filterRange + group.all() · O(Δ)/brush"); a·b's strings are untouched.
- Refuted (nothing to fix): a frozen `performance.now` collapses the peer's ms, p50 and
  header to 0.0 and hides the ratio line (data's ms too); the printed ms IS the last
  `race.brush.peer.ms`, p50 / p95 / n the nearest-rank of the session's samples (no
  smoothing, no throttling, no sampling — every counted data write pairs one peer window);
  the window contains the O(N) recompute — a raw `adapter.brush()` then `hist()` shows the
  walk landing in the READ for mobx / preact / vue (4.8–5 ms per histogram, re-read 0.000)
  and in `brush()` for solid / svelte / rxjs / react (13–31 ms), and each peer's window
  matches or exceeds a direct plain-function timing of the same walks (`hr-timing.mjs`,
  all eight); under every peer, across 11 filter drives over all four dims with resets,
  the printed count = the peer's `active()` = data's `count[value]` = an independent brute
  force, and all four dense histograms the charts draw (`peer.hist`) equal the brute force
  and data's views (`hr-results.mjs`, `hr-seed.mjs` — also seeded at non-default bounds
  and after every-dim resets); 0 esm.sh requests before a selection, 13 for the trio, every
  module fetched once; after 15 switches 19 stale adapters received no brush, heap after GC
  69.9 → 78.2 MB over 39 mounts (bounded, non-monotonic; `hr-leaks.mjs`); off-screen with
  crossfilter selected 0 frames over 33 ms in 2.5 s; fps at rest at scrollY 849: data /
  MobX / React 59.9, crossfilter 5 (the order-book peer's ~250 ms/frame rebuild, as
  documented); `tools/audit.mjs --proofs 18` → 0 problems (257 attested); the look
  survives at 1440 / 1280 / 390 (`shots/review-brushpeer-{data,mobx,crossfilter}-*.png`).
- Noted, unchanged: `#race-active-d` under a peer is the PEER's count stamped 'runtime'
  (the selected engine produced it; the lockstep hook asserts it equals data's every
  brush). Under reduced motion the engine's commit path is cold (the book never ticks), so
  data's first two brushes run 50–60 ms before settling to ~28 — the honest cold cost, not
  a model. The 'N of M rows' readout is the same number in every engine by construction.

## Review (2026-09-14, adversarial honesty pass — findings and what changed)
- **A throwing commit froze the whole page with stale 'measured' figures (fixed).** The
  page's one rAF loop (`engine.js`, shared — not touched) has no guard; clause 4 surfaces a
  failing effect ANYWHERE on the shared runtime as an AggregateError from the race's own
  `batch()`, which escaped `frame()` and killed the loop for every section — the race then sat
  at "290 µs/frame · 1,994 ticks/sec", both still stamped `measured`, with nothing measuring
  (proved with `scratchpad/rv-throw.mjs`: a throwing `onCommit` hook → 0 commits, 0 rAF
  samples, figures unchanged). Now `frame()` wraps `tick()`; on a throw `stop(err)` pauses
  the section, dashes and un-attests every measured slot, prints the reason in the tag,
  logs the error, sets `window.__perf['race.error']`, and turns the toggle into `▶ retry`
  (re-arms; a thrower still on the runtime stops it again). The page loop survives (30 rAF
  samples / 500 ms after the throw; `rv-retry.mjs` covers the retry both ways).
- **The spread pill was the ladder's grid, not the engine (fixed).** `spread 3.33 / 6.67` was
  the distance between two bucket-centre PRICE LITERALS chosen by which buckets were empty —
  i.e. `P_STEP × k`, a page constant, attested `runtime`; the mid was the histogram-weighted
  approximation of the mean bid/ask. Now a fifth view `avgAsk = orders.avg('ask')` (O(1) per
  delta) is built in the same chunked steps, and the pill prints `$mid` = (`avg('bid')` +
  `avg('ask')`) / 2 and `mean spread` = `avg('ask')` − `avg('bid')` — two engine values and
  one line of arithmetic (exact by linearity), with the formula in the pill's title; the tag
  reads `avg×2`. `scratchpad/rv-verify.mjs` pauses the book and walks `orders.snapshot()`
  by hand: rows, liquid, avg bid, avg ask, mid, mean spread, both histograms and every
  ladder qty equal the brute force AND the printed text (all `true`, n = 150,000).
- **The lazy builds ran while the reader was elsewhere (fixed).** `near` was sticky, so a
  reader who scrolled past paid the pipeline's 30–100 ms engine steps (`intersect`,
  `indexing`) on the section they were reading (6 frames over 33 ms, worst 100 ms, in 1.4 s —
  `rv-offscreen.mjs`). `near` now follows the IntersectionObserver (600 px margin): the
  main-thread slices run only while the section is near; the worker's fetch + parse carry on;
  the build resumes on return (0 frames over 33 ms far away; resumed and finished in 610 ms).
- Minor: the brushing header's "N ms/brush" is the session p50 — it now says so in a title.
- Refuted (nothing to fix): freezing `performance.now` collapses `#race-cpu-d`, `#race-base-d`
  and the peer's ms / "N× data" to 0 within the smoothing window (the numbers are the timer's,
  not a model's); the slider drives the applied rate (3.5 → 3,162/s, 2.0 → 100/s) and the
  frame cost with it; pause → 0 book commits and frozen values; scrolled far / `document.hidden`
  → 0 commits; the eight peers load only on selection (0 esm.sh requests before), their
  figures are attested `measured`, versions `build` from the import map, lockstep true; the
  brushing count equals `count[value]`, `active.rowCount()` and a brute-force walk over the
  source snapshot under the live bounds; no timers or `Math.random` feed any printed figure
  (the two `Math.random` uses gate a flash and pace the tape — presentation of real deltas);
  zero console/page errors; `tools/audit.mjs` prints 0 `[race]` lines (0 problems page-wide,
  257 attested); the look survives at 1440 / 1280 / 390 (`shots/review-race-d-*.png`).
- Still presentation-only (unchanged): the flash dot / streak and the tape's slide-in, the
  wave's smoothing, the depth gradient / glow, the brush band and grips, the progress bars'
  fill fractions. The tape prints the newest delta of the newest commit a few times a second
  (a sample of ~2,000 deltas/s, each one real).
