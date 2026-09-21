# site-v8 — the old page's form, refilled for v4 (UI ONLY; smoke and mirrors allowed)

Read this whole file, then `facts.md`, then the reference page, before writing anything.

## What this is
The user judged the OLD live site (https://pemrouz.github.io/data — source at `ref/old-index.html`,
stylesheet `v2.css`, scripts `ref/assets/*.js`) better than every one-viewport concept since. We are
rebuilding THAT FORM for data v4: a scrolling editorial landing (~6 viewports at 1440), all-monospace
apparatus + sans prose, near-black, ONE orange accent, numbered sections, the demo as centrepiece.

This round is **UI only**. No real engine on the page, no build, no honesty layer. "Live" things are
smoke and mirrors: canned data, plausible animation (random-walk books, ticking counters, a CPU wave),
fake peers, canned test results. What matters: it LOOKS like the finished page, at 60 fps, with no
console errors, and it reads like the old page's voice. Every name/fact in `facts.md` is real — use them.

## The grammar (from v2.css — REUSE these classes; add new ones only in your own sections/<name>.css)
- `.wrap` (max 1140px) is the column. Sections are `<section class="…" id="<name>">` with
  `<div class="sec-head"><span class="sec-no">01</span><h2>Title</h2></div>` then `p.lead-para`, `p`, `p.muted`.
- Prose is `--sans` 16px/1.6; apparatus (labels, code, figures, tables) is `--mono` 0.72–0.9rem, often
  uppercase + letter-spaced for kickers (`.race-title`, `.race-md-label`, `.kicker`).
- Colours: bg `#0c0c0d`, bg-2 `#141417`, bg-3 `#1b1b1f`, ink `#edece8`, dim `#9a9a93`, faint `#80807a`,
  rule `#26262b`, accent `#ff5e3a` (live values, hot state, the "data" word), pos `#67dba1`, neg `#ff7873`,
  peer `#7d8aa3`. Use the CSS variables. No new hues except the tenor palette already in v2.css.
- Cards: `background: var(--bg-2); border: 1px solid var(--rule); border-radius: 6–10px`. Code blocks: `pre.code`
  with `.tok-key/.tok-str/.tok-num/.tok-com/.tok-pun` spans (hand-mark the tokens, or use the regex highlighter
  in `ref/assets/landing.js` — copy it into your section js if you want it).
- Buttons: `.stream-btn`, `.install`, `.cta-link`. Chips: `.demo-chips .chip`. Tables: the `.cat-row` grammar
  (`.cat-op`, `.cat-desc`, `.cat-sig`, `.cat-x`) for the operator catalogue.
- Motion: subtle. Flash a changed cell with the existing `.flash` idiom (see `ref/assets/feed.js`
  `flashOperatorCell`), tick numbers, draw waves on a canvas at DPR ≤ 1.5. No CSS `filter` on animated things.
  Pause every loop while your variant is hidden (see the events below) or off-screen (IntersectionObserver).
- Responsive down to 390px like the old page (the old CSS already handles most of it). Check 1440 and 1280.

## The variant mechanism (this is how "options" are shown)
Wrap alternatives in `.opt`:
```html
<section class="race" id="race">
  <div class="opt" data-section="race">
    <div data-variant="a" data-label="nine engines">…</div>
    <div data-variant="b" data-label="one engine · two workloads">…</div>
  </div>
</section>
```
`variants.js` shows one variant (`?race=b` picks; the bottom-right bar switches live; `?all=1` stacks
them all; `?bar=0` hides the bar). The shown root receives a `variantshow` event, the hidden one
`varianthide` — start/pause your animation loops on these. Element ids must be UNIQUE across variants
(suffix them `-a`, `-b`). Each variant must be COMPLETE on its own (its own `.sec-head` if the head differs,
its own caption). Two variants is the norm, three at most. A variant that is a mere colour change is not
a variant — variants differ in STRUCTURE or CONTENT (a different centrepiece, a different table grammar,
a different claim).

## Files you own
`sections/<name>.html` — ONE `<section …>` element (no html/head/body). `sections/<name>.css`, `sections/<name>.js`
(ES module; runs after the DOM exists; import nothing outside your own `sections/<name>/` dir), optional
assets under `sections/<name>/`. Nothing else — never touch page.html, v2.css, variants.*, build.mjs, or
another section. `node proto/site-v8/build.mjs` assembles `index.html` (safe to run any time, concurrently).

## Tools (cwd = the repo root `/mnt/c/Users/pemrouz/cloud/data`; the server is ALREADY running on 4176)
- `node proto/site-v8/build.mjs` — assemble.
- `node proto/site-v8/tools/sec.mjs "http://localhost:4176/?<name>=b&bar=0" "#<name>" proto/site-v8/shots/<name>-b.png`
  — screenshot your section at a variant. LOOK at every PNG you write (Read it). Iterate until it is good.
- `node proto/site-v8/tools/shot.mjs "http://localhost:4176/?bar=0" proto/site-v8/shots/<name>-page 0 900 1800 …`
  — viewport shots at offsets; `node proto/site-v8/tools/full.mjs <url> <out.png>` — the full page.
- Console errors are printed by every tool. Zero is the bar.

## Definition of done (per section)
- Every variant screenshotted at 1440 AND 1280 (`--width 1280`), looked at, and good: no overflow, no clipped
  text, no orphaned controls, the head/caption grammar matching the old page.
- No console errors; loops paused when hidden; nothing fetched from a third party (peers are FAKE here).
- A 6-line `sections/<name>.md`: what each variant is, what is smoke, what you'd wire for real, what you cut.
