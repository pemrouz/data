/* Editorial-page bootstrap. Wires the live race (race.js), the operator demos
 * (demos.js, which build off the shared feed.js), and page chrome: click-to-copy
 * install, the lazy devtools-panel mount, the "this page runs on data" counter,
 * the stream toggle, and the regex syntax highlighter.
 *
 * Hand-written `.js`, no `.ts` sibling (see CLAUDE.md). */

import { $, isStreaming, setStreaming, $$ } from './feed.js'
import { createRace } from './race.js'
import './demos.js'

/* ---------- the race ---------- */
if (document.getElementById('race-grid')) {
  createRace({
    grid: $$('#race-grid'), multidimHost: $$('#race-multidim'),
    libSel: $$('#race-lib'),
    prevBtn: $$('#race-prev'), nextBtn: $$('#race-next'), posEl: $$('#race-pos'),
    rateInput: $$('#race-rate'), rateOut: $$('#race-rate-out'),
    toggleBtn: $$('#race-toggle'), statusEl: $$('#race-status'),
  }).catch(e => console.error('[race] init failed', e))
}

/* ---------- stream toggle (drives the demo feed) ---------- */
document.querySelectorAll('[data-stream-toggle]').forEach(btn => {
  const sync = () => { btn.textContent = isStreaming() ? '⏸ pause' : '▶ stream' }
  sync()
  btn.addEventListener('click', () => { setStreaming(!isStreaming()); sync() })
})

/* ---------- click-to-copy install command ---------- */
document.querySelectorAll('[data-copy]').forEach(el => {
  el.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(el.dataset.copy)
      el.setAttribute('data-state', 'copied ✓')
      setTimeout(() => el.removeAttribute('data-state'), 1400)
    } catch { /* clipboard unavailable — selecting the text still works */ }
  })
})

/* ---------- devtools: mount the real panel on demand ---------- */
const dtBtn = $$('#devtools-mount'), dtStatus = $$('#devtools-status')
if (dtBtn) {
  dtBtn.addEventListener('click', async () => {
    dtBtn.disabled = true
    if (dtStatus) dtStatus.textContent = 'loading…'
    try {
      await import('data/devtools')
      $.devtools?.panel?.open?.()
      if (dtStatus) dtStatus.textContent = 'mounted — see the right-edge dock →'
      dtBtn.textContent = 'inspector mounted ✓'
    } catch (err) {
      if (dtStatus) dtStatus.textContent = 'failed to load — try a worked example below'
      dtBtn.disabled = false
      console.error('[devtools] mount failed', err)
    }
  })
}

/* ---------- syntax highlighter ----------
 * Single-pass tokenizer: one ordered alternation matches a comment, string,
 * number, keyword, or punctuation as a WHOLE token, and each segment (matched
 * or in-between) is HTML-escaped on its own. The previous multi-pass version
 * re-ran the keyword/number/punctuation passes over text already inside a
 * comment/string sentinel, which highlighted `new` inside a comment and split
 * the `;` out of `&lt;` — rendering the quickstart's `<li>` as `<;li>`.
 * Matching whole tokens (so nothing inside a comment/string is re-tokenized)
 * and escaping per-segment (incl. `>`) fixes both. */
const TOKEN = /(\/\/[^\n]*)|(`(?:\\.|[^`])*`|'(?:\\.|[^'])*'|"(?:\\.|[^"])*")|\b(\d+\.?\d*)\b|\b(import|from|const|let|var|function|return|new|if|else|for|of|in|true|false|null|undefined|delete|class|extends|export|default|async|await|typeof|instanceof|Infinity)\b|([(){}[\];,])/g
const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
document.querySelectorAll('pre.code').forEach(el => {
  if (el.dataset.hl === 'off') return
  const src = el.textContent
  let out = '', last = 0, m
  TOKEN.lastIndex = 0
  while ((m = TOKEN.exec(src))) {
    out += esc(src.slice(last, m.index))
    const cls = m[1] ? 'tok-com' : m[2] ? 'tok-str' : m[3] ? 'tok-num' : m[4] ? 'tok-key' : 'tok-pun'
    out += `<span class="${cls}">${esc(m[0])}</span>`
    last = m.index + m[0].length
  }
  out += esc(src.slice(last))
  el.innerHTML = out
})
