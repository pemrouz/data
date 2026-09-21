// sections/lede.js — the lede. Two jobs:
//   1. click-to-copy on the import-line button (every variant) — the old
//      landing.js idiom: a data-state badge + a polite live-region announce.
//   2. variant b's figure — REAL, on the page's one runtime (engine.js):
//        const trades = $({ t1…t4 })            the four rows of facts.md
//        render(tbody, list(trades, rowFn))     the keyed list sink renders the
//                                               rows; an update re-runs the row
//                                               fn and patches ONLY the changed
//                                               text node in place
//        trades.t3.qty.update(v)                a scripted writer issues one
//                                               deep-path write every ~1.2 s
//                                               through the page's rAF loop
//                                               (the value cycle is INPUT)
//        trades.sink({ apply(b) })              the delta line prints the real
//                                               RowDelta (op · key · .path ·
//                                               prev → next) and b.seq
//      The flashed cell is the td the list sink actually mutated (a
//      MutationObserver on the tbody — presentation of a real DOM patch, never
//      the source of a number). "N rows" = rowCount(). Trust line: dependencies
//      and the test count from gen/manifest.json (build tier), SCHEDULE_VERSION
//      from contract/index.js (runtime tier).
//      The writer pauses while the variant is hidden, the figure is off-screen,
//      the tab is hidden, or the visitor prefers reduced motion — after ONE
//      write on load, so the figure is never empty.
import { api, contract, attest, put, onFrame } from '../engine.js'

/* prefers-reduced-motion, followed LIVE (engine.js reads it once at load; a
   visitor who toggles it mid-visit must still get the rest — rule 6) */
const motionMQ = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
let REDUCED = !!motionMQ?.matches

const root = document.getElementById('lede')

/* ---------- click-to-copy ---------- */
if (root) root.querySelectorAll('[data-copy]').forEach(el => {
  el.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(el.dataset.copy)
      el.setAttribute('data-state', 'copied ✓')
      setTimeout(() => el.removeAttribute('data-state'), 1400)
      const live = document.getElementById('copy-live')
      if (live) { live.textContent = ''; setTimeout(() => { live.textContent = `Copied: ${el.dataset.copy}` }, 30) }
    } catch { /* clipboard unavailable — the button text is user-select:all, selecting still works */ }
  })
})

/* ---------- b · the one-write figure, on the real engine ---------- */
const fig = document.getElementById('lede-fig-b')
if (fig) {
  const { $, render, el, list } = api
  const byId = id => document.getElementById(id)
  const variant = fig.closest('[data-variant]')
  const tbody = byId('lede-rows-b')
  const writeVal = byId('lede-write-val-b')
  const rowsEl = byId('lede-rowcount-b')
  const opEl = byId('lede-op-b'), keyEl = byId('lede-key-b'), pathEl = byId('lede-path-b')
  const prevEl = byId('lede-prev-b'), nextEl = byId('lede-next-b'), seqEl = byId('lede-seq-b')

  /* the source — object-born, keyed (string keys), the four rows of facts.md */
  const trades = $({
    t1: { sym: 'AAPL', side: 'buy', qty: 200, px: 187.5 },
    t2: { sym: 'MSFT', side: 'sell', qty: 150, px: 415.2 },
    t3: { sym: 'NVDA', side: 'buy', qty: 500, px: 118.4 },
    t4: { sym: 'AAPL', side: 'sell', qty: 80, px: 187.9 },
  })
  attest(rowsEl, trades.rowCount())

  /* the rows — the keyed list sink: one <tr> per key from the snapshot, then
     per-commit deltas; on `update` the row fn re-runs and patchRow writes only
     the text node whose string changed (element identity preserved). Every
     figure-bearing cell is stamped runtime; the key cell is typography. */
  const px = v => v.toFixed(2)
  render(tbody, list(trades, (row, key) => el('tr', { class: key === 't3' ? 'hot' : null },
    el('td', { class: 'key', 'data-literal': '' }, String(key)),
    el('td', { 'data-attested': 'runtime' }, row.sym),
    el('td', { class: row.side, 'data-attested': 'runtime' }, row.side),
    el('td', { class: 'num qty', 'data-attested': 'runtime' }, el('span', null, String(row.qty))),
    el('td', { class: 'num', 'data-attested': 'runtime' }, px(row.px)),
  )))

  /* the flash — presentation of a REAL mutation: whichever text node the list
     sink patched, its parent flashes. Rests under prefers-reduced-motion. */
  const flash = node => {
    if (REDUCED || !node) return
    node.classList.remove('flash'); void node.offsetWidth; node.classList.add('flash')
  }
  new MutationObserver(recs => {
    for (const r of recs) if (r.type === 'characterData') flash(r.target.parentElement)
  }).observe(tbody, { subtree: true, characterData: true })

  /* the delta line — the RowDelta the source's native sink delivers for the
     commit, printed verbatim: op · key · .path · leaf(prev) → leaf(row); seq
     is the batch's own. rowCount() is re-read per commit (it is live). */
  const leaf = (v, path) => { let c = v; for (const p of path) { if (c == null) return undefined; c = c[p] } return c }
  trades.sink({
    apply(b) {
      for (const d of b.rows) {
        attest(opEl, d.op)
        attest(keyEl, d.key)
        if (d.op === 'update') {
          attest(pathEl, '.' + d.path.join('.'))
          attest(prevEl, leaf(d.prev, d.path))
          attest(nextEl, leaf(d.row, d.path))
          flash(nextEl)
        }
      }
      attest(seqEl, b.seq)
      attest(rowsEl, trades.rowCount())
    },
  })

  /* the writer — synthetic INPUT: t3.qty walks a fixed cycle; each step is one
     real deep-path write (one commit). The write line prints the call as it is
     issued (inside <code>: it is the source line that ran, not a result). */
  const WALK = [380, 410, 365, 420, 390, 445, 375, 430, 500]
  const PERIOD = 1200
  let i = -1, last = 0, running = false
  const write = now => {
    i = (i + 1) % WALK.length
    const v = WALK[i]
    put(writeVal, String(v)); flash(writeVal)
    last = now
    try {
      trades.t3.qty.update(v)
    } catch (e) {
      // clause 4: the commit has already been applied and every sink has run;
      // what surfaces here is another subscriber's effect failure (an
      // AggregateError after the drain). Report it — but never let it unwind
      // through the page's shared rAF loop (engine.js re-arms the frame only
      // after every tick returns, so one throw would freeze every section).
      console.error('lede: an effect failed during the commit', e)
    }
  }
  write(performance.now()) // one write on load — the figure is never empty
  onFrame(now => {
    if (!running || now - last < PERIOD) return
    write(now)
  })

  /* the gate: run only while the variant is shown, the figure is on screen,
     the tab is visible, and motion is welcome */
  let shown = !variant.hidden, onscreen = false
  const sync = () => { running = shown && onscreen && !document.hidden && !REDUCED }
  variant.addEventListener('variantshow', () => { shown = true; sync() })
  variant.addEventListener('varianthide', () => { shown = false; sync() })
  document.addEventListener('visibilitychange', sync)
  motionMQ?.addEventListener('change', e => { REDUCED = e.matches; sync() })
  new IntersectionObserver(es => { onscreen = es.some(e => e.isIntersecting); sync() }).observe(fig)

  /* the trust line — build-tier facts from gen/manifest.json; the version from
     the contract module the engine itself loaded */
  attest(byId('lede-ver-b'), contract.SCHEDULE_VERSION, 'runtime')
  fetch('./gen/manifest.json').then(r => r.json()).then(m => {
    attest(byId('lede-deps-b'), m.dependencies, 'build')
    attest(byId('lede-tests-b'), m.tests, 'build')
  }).catch(e => console.warn('lede: gen/manifest.json unavailable — trust figures stay unfilled', e))
}
