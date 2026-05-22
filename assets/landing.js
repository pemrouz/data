/* Editorial-page bootstrap. Wires the live race (race.js), the operator demos
 * (demos.js, which build off the shared feed.js), and page chrome: click-to-copy
 * install, the lazy devtools-panel mount, the "this page runs on data" counter,
 * the stream toggle, and the regex syntax highlighter.
 *
 * Hand-written `.js`, no `.ts` sibling (see CLAUDE.md). */

import { $, render, pageUpdates, isStreaming, setStreaming, $$, HTML } from './feed.js'
import { createRace } from './race.js'
import './demos.js'

const { span } = HTML

/* ---------- the race ---------- */
if (document.getElementById('race-grid')) {
  createRace({
    grid: $$('#race-grid'), multidimHost: $$('#race-multidim'),
    workloadSel: $$('#race-workload'), libSel: $$('#race-lib'),
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

/* ---------- "this page runs on data" counter ---------- */
const counterEl = $$('#page-updates')
if (counterEl) { counterEl.textContent = ''; render(counterEl, span.text(pageUpdates.to(n => n.toLocaleString()))) }

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

/* ---------- syntax highlighter ---------- */
const KEYWORDS = /\b(import|from|const|let|var|function|return|new|if|else|for|of|in|true|false|null|undefined|delete|class|extends|export|default|async|await|typeof|instanceof|Infinity)\b/g
document.querySelectorAll('pre.code').forEach(el => {
  if (el.dataset.hl === 'off') return
  let s = el.textContent
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  s = s.replace(/(\/\/[^\n]*)/g, '\x00C\x01$1\x02')
  s = s.replace(/(['"`])((?:\\.|(?!\1).)*)\1/g, '\x00S\x01$1$2$1\x02')
  s = s.replace(/\b(\d+\.?\d*)\b/g, '\x00N\x01$1\x02')
  s = s.replace(KEYWORDS, '\x00K\x01$1\x02')
  s = s.replace(/[(){}[\];,]/g, m => `\x00P\x01${m}\x02`)
  s = s
    .replace(/\x00C\x01/g, '<span class="tok-com">').replace(/\x00S\x01/g, '<span class="tok-str">')
    .replace(/\x00N\x01/g, '<span class="tok-num">').replace(/\x00K\x01/g, '<span class="tok-key">')
    .replace(/\x00P\x01/g, '<span class="tok-pun">')
    .replace(/\x02/g, '</span>')
  el.innerHTML = s
})
