# lede — wired to the real engine (variant b, the pick; a and c untouched)

## What is real now
b's figure is `$(trades)` on the page's one runtime (`import { api } from '../engine.js'`): the four
rows of facts.md (`t1…t4`, object-born, string keys). The table body is rendered by the engine's keyed
list sink — `render(tbody, list(trades, rowFn))` — one `<tr>` per key from the snapshot, then per-commit
deltas: on `update` the row fn re-runs and `patchRow` rewrites ONLY the text node whose string changed
(the qty cell is the same element across every write — verified by element identity). The delta line
is the RowDelta the source's native sink delivers — `trades.sink({ apply(b) })` → `d.op · d.key ·
.d.path · leaf(d.prev, path) → leaf(d.row, path)` — and `seq` is `b.seq` (the batch's own; the page's
runtime seq runs ahead because other sections commit too). "N rows" is `trades.rowCount()`, re-read
per commit. The flashed cell is the node a MutationObserver on the tbody saw the list sink mutate
(characterData) — presentation of a real DOM patch, never the source of a number.

## Tiers (every printed digit is stamped; audit `[lede]` = 0 lines)
- runtime: rows count (`rowCount()`), every table cell (sym/side/qty/px from the list sink's row),
  the delta's op/key/path/prev/next, seq (`b.seq`), and `SCHEDULE_VERSION` in the trust line
  (`contract.SCHEDULE_VERSION` from the contract module the engine loaded).
- build: `0 dependencies` and `330 tests` — fetched from `gen/manifest.json` (`dependencies`, `tests`;
  the exact count replaces the old "330+").
- literal: the key cells `t1…t4` (`data-literal`, typography per REAL.md — the key itself is still the
  RowKey the list sink handed the row fn), the write line (inside `<code>`: it is the source line that
  ran, its value put in as the call is issued), the import line in the copy button.
- measured: nothing in this section prints a performance figure.

## Synthetic input
The writer: `t3.qty` walks a fixed nine-value cycle (380 → 410 → 365 → 420 → 390 → 445 → 375 →
430 → 500) — each step is one real deep-path write `trades.t3.qty.update(v)` (one commit), issued
every ~1.2 s from the page's rAF loop (`onFrame`). One write on load so the figure is never empty;
then the writer runs only while the variant is shown, the figure intersects the viewport, the tab is
visible, and motion is welcome (`prefers-reduced-motion` → the single load write, then rest). The
media query is followed LIVE (lede.js keeps its own `matchMedia` listener rather than engine.js's
load-time `REDUCED` const): toggling reduce mid-visit stops the writer and the flash; toggling back
resumes it. Each `update()` call is guarded: per clause 4 the commit is already applied and every
sink has run when a foreign effect's AggregateError surfaces, so the writer reports it
(`console.error`) instead of letting it unwind through the page's shared rAF loop (engine.js re-arms
the frame only after every tick returns — one throw from any tick freezes every section).

## Presentation-only
The 600 ms `cellflash` on the write value / the patched cell / the delta's next (skipped entirely under
reduced motion). `min-height: 17.38rem` on the card holds its measured settled height (278 px at
1440/1280/390) so nothing beneath shifts in the ~0 ms between engine load and the first render.

## Smoke removed
The scripted `tick()` (staggered fake write→cell→delta timers), the hand-counted `seq`, the canned
`<tr>` rows and the literal trust digits are gone from b's code path; the variant label lost its "v4"
(a digit the ribbon would print). Variants a and c are byte-identical to before (their trust lines
still carry literals; they are hidden and unwired by design).

## Reviewed (2026-09-14, adversarial pass)
- `scratchpad/lede-refute.mjs`: a `runtime().onCommit` hook recorded every commit on the page; every
  printed seq is a real commit's seq (0 mismatches over 3–4 lede commits among ~260 page commits),
  each delta's prev = the previous next, and cell = write = next; the qty `<span>`, its `<td>` and the
  `<tr>` are the same elements across writes (the list sink patched the text node in place). Off-screen
  (3.2 s), `document.hidden` (3.2 s) and variant-hidden (3.2 s): the printed seq held; each resumed
  within 2.6 s of return. Reduced-motion context: one write, no `.flash` element. Figure live 0.1 ms
  after `#engine.ok`. No unattested digit-bearing text inside variant b. Trust line = `gen/manifest.json`
  = the repo's live `test(` count (330) and `package.json` (no `dependencies`); `SCHEDULE_VERSION` =
  `contract.SCHEDULE_VERSION`. `scratchpad/lede-motion.mjs`: toggling `prefers-reduced-motion` live →
  held 3.2 s, resumed on toggle-back. `scratchpad/lede-height.mjs`: the card's natural settled height
  equals the min-height (278.1 px) at 1440 / 1280 / 390 — no dead space, no shift.
- Found and fixed: (1) reduced motion was read once at load (a live toggle was ignored) → own
  `matchMedia` listener; (2) an effect error surfacing from `update()` inside the shared rAF tick would
  have frozen the page's frame loop (observed once when a scratch hook threw: every section stalled)
  → the writer catches and reports. Not this section's to fix: engine.js's `loop` re-arms the frame
  after the ticks without a guard, so any OTHER section's throwing tick still freezes the lede's writer.
- No canned RESULT survives on the b path: the only constant is the nine-value INPUT cycle; no
  `Math.random`, no timers standing in for engine events; the copy button's `setTimeout`s are badge
  feedback, not figures.

## Verified (2026-09-14)
- `tools/audit.mjs`: 0 `[lede]` lines (was 21); zero console/page errors.
- `tools/probe.mjs --dwell 2500 0 300 600` ×3: 59.9 fps at every offset (min 59.9).
- scratch Playwright (`scratchpad/lede-verify.mjs`): figure live 0 ms after `#engine.ok` (rAF-sampled);
  first delta `update t3 .qty 500 → 380`; `runtime().seq` advanced (24 → 115) and the printed seq with
  it (1 → 49); an in-page MutationObserver log shows every delta's prev = the previous next and
  cell = write = next; the qty `<span>` is the same element after writes; the writer holds while
  scrolled off-screen (2.6 s, no change) and resumes on return; reduced-motion context: one write, then
  rest; tiers as listed above.
- `tools/sec.mjs` at 1440 / 1280 / 390 (`shots/real-lede-b*.png`), each read: layout unchanged from
  the approved UI apart from "330 tests" (exact count) replacing "330+ tests".
