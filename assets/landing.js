/* Landing-page bootstrap: page chrome (tabs, TOC, copy, stream toggle, the
 * "this page runs on data" counter) and the regex syntax highlighter. The
 * reactive data lives in feed.js; the operator gallery in operators.js; the
 * hero/explainer diagrams in hero.js. Importing operators.js builds those
 * live views as a side effect.
 *
 * Hand-written `.js` with no `.ts` sibling (see CLAUDE.md). */

import { $, render, pageUpdates, isStreaming, setStreaming, $$, HTML } from './feed.js'
import './operators.js'
import './hero.js'

const { span } = HTML

/* ---------- stream toggle (drives the shared feed) ---------- */

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
      const prev = el.dataset.label || el.textContent
      el.dataset.label = prev
      el.classList.add('copied')
      el.setAttribute('data-state', 'copied ✓')
      setTimeout(() => { el.classList.remove('copied'); el.removeAttribute('data-state') }, 1400)
    } catch { /* clipboard unavailable — selecting the text still works */ }
  })
})

/* ---------- "this page runs on data" — live update counter ---------- */
/* pageUpdates is a real $() bumped by a 0-arg .tap() on the source feed. Bind
 * it to the DOM with render() so even the counter on the closer is a data view. */

const counterEl = $$('#page-updates')
if (counterEl) {
  counterEl.textContent = ''
  render(counterEl, span.text(pageUpdates.to(n => n.toLocaleString())))
}

/* ---------- devtools: mount the real panel on demand ----------
   The panel auto-mounts on import and docks to the screen edge, so we load it
   lazily on click rather than forcing it on every visitor. It inspects the
   page's real graph (the hero pipeline + the operator feed). */

const dtBtn = $$('#devtools-mount')
const dtStatus = $$('#devtools-status')
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

/* ---------- operator tabs ----------
   All panels are rendered (subscriptions stay live); only the active one is
   shown. Switching is one class flip on the tab and its target panel. */

const opPanels = Array.from(document.querySelectorAll('.operators .op-section'))
const opTabs   = Array.from(document.querySelectorAll('.op-tabs .op-tab'))
function selectOp (id) {
  opTabs  .forEach(t => t.classList.toggle('on', t.dataset.target === id))
  opPanels.forEach(p => p.classList.toggle('on', p.id            === id))
}
opTabs.forEach(t => t.addEventListener('click', () => selectOp(t.dataset.target)))
if (opPanels.length) {
  const hashId = location.hash && location.hash.slice(1)
  const initial = opPanels.find(p => p.id === hashId) ? hashId : opPanels[0].id
  selectOp(initial)
}

/* ---------- TOC active-section highlight ----------
   IntersectionObserver picks the topmost intersecting section and marks the
   matching TOC link. Hidden TOC (small viewports) → no observers attached. */

const tocLinks = Array.from(document.querySelectorAll('.toc a[data-toc]'))
if (tocLinks.length && 'IntersectionObserver' in window) {
  const sections = tocLinks
    .map(a => document.getElementById(a.dataset.toc))
    .filter(Boolean)
  const visible = new Set()
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.isIntersecting) visible.add(e.target)
      else                  visible.delete(e.target)
    }
    if (!visible.size) return
    let top = null, topY = Infinity
    for (const el of visible) {
      const y = el.getBoundingClientRect().top
      if (y < topY) { topY = y; top = el }
    }
    if (!top) return
    tocLinks.forEach(a => a.classList.toggle('on', a.dataset.toc === top.id))
  }, { rootMargin: '-25% 0px -65% 0px', threshold: 0 })
  sections.forEach(s => io.observe(s))
}

/* ---------- syntax highlighter ---------- */

const KEYWORDS = /\b(import|from|const|let|var|function|return|new|if|else|for|of|in|true|false|null|undefined|delete|class|extends|export|default|async|await|typeof|instanceof|Infinity)\b/g

function highlight (el) {
  if (el.dataset.hl === 'off') return
  let s = el.textContent
  // Don't escape '>' — outside tag context it's literal, and escaping it to
  // '&gt;' lets the punctuation regex below match the entity's trailing ';'.
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
}
document.querySelectorAll('pre.code, code.inline').forEach(highlight)
