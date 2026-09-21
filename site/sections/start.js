/* sections/start.js — §03 From zero.
   a · the old layout (not picked, untouched): click-to-copy import line + two highlighted snips.
   b · twelve lines (THE PICK) — REAL. The twelve lines on the panel EXECUTE against the page's
       engine (`api` from ../engine.js = api/index.ts, type-stripped, the page's one runtime):
       the source, buys, largest, volume, a sink that captures its batch, a render into the
       small live <ol> under the panel, then `batch(() => trades.t3.qty.update(n))`. Every
       `// →` is read off the engine / the DOM at the moment its line runs and stamped
       data-attested (runtime | measured). Nothing on this panel is typed by hand except the
       program text itself (.src, data-literal).
       Pace: the first run defines the objects, then prints lines 05–10 at reading pace and lands
       the write after a beat; the write's four outputs are captured IN FIRE ORDER (the sink's
       effect → the DOM patch, measured by a MutationObserver → the sum's settled value → the
       commit hook) and shown in that order. The stagger is presentation only — no number comes
       from a timer. `↻ replay` (and an idle loop while the panel is on screen) re-reads the
       live views and lands the write again with the alternate value (380 ↔ 500); the src line
       flips to show the literal that actually ran. Reduced motion: everything prints at once,
       no idle loop. */
import { api, attest, REDUCED } from '../engine.js'
const { $, batch, render, el, list, runtime, value, node } = api

const root = document.getElementById('start')
if (root) {
  /* ---------- syntax highlighter (the old landing.js tokenizer, verbatim) ---------- */
  const TOKEN = /(\/\/[^\n]*)|(`(?:\\.|[^`])*`|'(?:\\.|[^'])*'|"(?:\\.|[^"])*")|\b(\d+\.?\d*)\b|\b(import|from|const|let|var|function|return|new|if|else|for|of|in|true|false|null|undefined|delete|class|extends|export|default|async|await|typeof|instanceof|Infinity)\b|([(){}[\];,])/g
  const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const highlight = el => {
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
  }
  root.querySelectorAll('pre.code:not([data-hl="off"]), .twelve .src').forEach(highlight)

  /* ---------- a · click-to-copy (the old page's idiom: data-state badge + live region) ---------- */
  root.querySelectorAll('[data-copy]').forEach(el => {
    el.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(el.dataset.copy)
        el.setAttribute('data-state', 'copied ✓')
        setTimeout(() => el.removeAttribute('data-state'), 1400)
        const live = document.getElementById('copy-live')
        if (live) { live.textContent = ''; setTimeout(() => { live.textContent = `Copied: ${el.dataset.copy}` }, 30) }
      } catch { /* clipboard unavailable — the text is still selectable */ }
    })
  })

  /* ---------- b · the program, run for real ---------- */
  const vb = root.querySelector('[data-variant="b"]')
  const panel = document.getElementById('start-twelve-b')
  const ol = document.getElementById('start-ol-b')
  const writeLine = document.getElementById('start-write-b')
  if (vb && panel && ol && writeLine) {
    const outs = [...panel.querySelectorAll('.row > .out')]
    // panel rows (0-based) that carry an output
    const ROW = { trades: 4, buys: 5, largest: 6, volume: 7, sink: 8, render: 9, batch: 11 }
    const PACE = REDUCED ? 0 : 110      // one line, ms — presentation only
    const BEAT = REDUCED ? 0 : 650      // the pause before line 12 lands
    const LOOP_MS = 8000                // idle replay while on screen

    const flash = o => { o.classList.remove('flash'); void o.offsetWidth; o.classList.add('on', 'flash') }
    const print = (row, text, tier) => { const o = outs[row]; attest(o, text, tier); flash(o) }
    const reset = () => { for (const o of outs) { o.classList.remove('on', 'flash'); o.textContent = ''; o.removeAttribute('data-attested') } }
    const leaf = (obj, path) => path.reduce((v, k) => (v == null ? undefined : v[k]), obj)

    /* the program's objects: defined once (lines 01–10), kept alive for every replay */
    let P = null
    let capture = null                  // where line 09's sink hands its batch during a write
    function define() {
      const trades = $({
        t1: { sym: 'AAPL', side: 'buy',  qty: 200, px: 187.5 },
        t2: { sym: 'MSFT', side: 'sell', qty: 120, px: 412.1 },
        t3: { sym: 'NVDA', side: 'buy',  qty: 500, px: 118.4 },
      })
      const buys    = trades.filter(t => t.side === 'buy')
      const largest = buys.za('qty', 2)
      const volume  = buys.sum('qty')
      trades.sink({ apply: b => { console.log(b); if (capture) capture(b) } })
      render(ol, list(largest, t => el('li', null, el('b', null, t.sym), t.qty)))
      ol.setAttribute('data-attested', 'runtime')   // its <li>s are the engine's render output
      const mo = new MutationObserver(() => {})     // read synchronously via takeRecords()
      mo.observe(ol, { subtree: true, childList: true, characterData: true })
      P = { trades, buys, largest, volume, mo }
    }

    /* line 12: land the write; capture its four outputs in the order they fire */
    function write(n) {
      const { trades, volume, mo } = P
      const fired = []
      capture = b => {
        const s = b.rows.map(d => d.op === 'update'
          ? `${d.op} ${d.key} .${d.path.join('.')} ${leaf(d.prev, d.path)} → ${leaf(d.row, d.path)}`
          : `${d.op} ${d.key}`).join(' · ')
        fired.push([ROW.sink, s, 'runtime'])
      }
      mo.takeRecords()                              // nothing pending belongs to this write
      let commits = 0
      const hook = runtime().onCommit(c => {         // fires after settle + effects (clause 4)
        commits++
        let text = 0, created = 0
        for (const r of mo.takeRecords()) { if (r.type === 'characterData') text++; created += r.addedNodes.length }
        fired.push([ROW.render, `${text} text · ${created} created`, 'measured'])
        fired.push([ROW.volume, volume[value], 'runtime'])
        const src = c.nodes.find(x => x.id === trades[node].id)
        fired.push([ROW.batch, `${commits} commit · ${src ? src.deltas : 0} delta`, 'runtime'])
      })
      writeLine.textContent = `batch(() => trades.t3.qty.update(${n}))`
      highlight(writeLine)
      try { batch(() => trades.t3.qty.update(n)) } finally { hook.dispose(); capture = null }
      return fired
    }

    /* ---------- the run: reads at reading pace, then the write ---------- */
    let timers = [], active = false
    let inView = false, shown = !vb.hidden, ran = false
    const later = (ms, fn) => { if (ms <= 0) fn(); else timers.push(setTimeout(fn, ms)) }
    const stop = () => { for (const t of timers) clearTimeout(t); timers = []; active = false }
    const armed = () => inView && shown && !document.hidden

    function run() {
      stop()
      active = true
      if (!P) define()
      const { trades, buys, largest, volume } = P
      reset()
      let at = 0
      const step = (d, fn) => { at += d; later(at, fn) }
      step(0,        () => print(ROW.trades, `${trades.rowCount()} rows`, 'runtime'))
      step(PACE,     () => print(ROW.buys, `${buys.rowCount()} rows`, 'runtime'))
      step(PACE,     () => print(ROW.largest, largest[node].currentOrder().join(' · '), 'runtime'))
      step(PACE,     () => print(ROW.volume, volume[value], 'runtime'))
      step(PACE * 2, () => print(ROW.render, `${ol.querySelectorAll('li').length} <li>`, 'measured'))   // line 09 prints nothing on attach
      step(BEAT, () => {
        const next = trades.t3.qty[value] === 500 ? 380 : 500
        const fired = write(next)
        let t = 0
        for (const [row, text, tier] of fired) { later(t, () => print(row, text, tier)); t += PACE }
        if (!REDUCED) later(t + LOOP_MS, () => { if (armed()) run(); else active = false })
        else active = false
      })
    }

    /* ---------- gates: on screen × variant shown × tab visible ---------- */
    const sync = () => {
      if (armed()) { if (!active && (!REDUCED || !ran)) { ran = true; run() } }
      else stop()
    }
    new IntersectionObserver(es => { inView = es.some(e => e.isIntersecting); sync() }, { threshold: 0.15 }).observe(panel)
    vb.addEventListener('variantshow', () => { shown = true; sync() })
    vb.addEventListener('varianthide', () => { shown = false; sync() })
    document.addEventListener('visibilitychange', sync)
    document.getElementById('start-run-b')?.addEventListener('click', () => { ran = true; run() })
  }
}
