/* sections/operators/variant-a.js — §02 variant a (NOT picked, untouched this round): the
   canned catalogue on its canned feed (./feed.js). Nothing here is the engine: lists are
   reconciled by key and the changed cell flashes, the way the real render layer would.
   It runs ONLY while variant a is shown ('variantshow' / 'varianthide'), on screen and
   visible — the picked variant b (../operators.js) never touches this module's feed. */
import { SYMS, rows, size, onCommit, printDelta, running } from './feed.js'
const root = document.getElementById('operators')
const $$ = (sel, r = root) => r.querySelector(sel)
const fmt2 = v => v.toFixed(2)
const fmtN = v => Math.round(v).toLocaleString('en-US')
const signed = (v, dp) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(dp)
const signedN = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + fmtN(Math.abs(v))
const kn = k => +k.slice(1)
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : undefined)
/* R-type-7: h = (n − 1)·p (0-based), linear between the two ranks it straddles */
const q7 = (sorted, p) => {
  const n = sorted.length
  if (!n) return undefined
  const h = (n - 1) * p, lo = Math.floor(h), hi = Math.ceil(h)
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo])
}

/* ---------- gates: streaming × visible × on-screen × a variant shown ---------- */
const variants = [...root.querySelectorAll(':scope > .opt > [data-variant="a"]')]   // a only — b is the real engine (../operators.js)
const VA = variants[0]
const shown = new Set(variants.filter(v => !v.hidden))
let streaming = !matchMedia('(prefers-reduced-motion: reduce)').matches, onScreen = false   // reduced motion: start paused, the button offers ▶ stream
const sync = () => running(streaming && !document.hidden && onScreen && shown.size > 0)
for (const v of variants) {
  v.addEventListener('variantshow', () => { shown.add(v); renderAll(null); sync() })
  v.addEventListener('varianthide', () => { shown.delete(v); sync() })
}
new IntersectionObserver(es => { onScreen = es.some(e => e.isIntersecting); sync() }, { rootMargin: '160px 0px' }).observe(root)
document.addEventListener('visibilitychange', sync)
const toggles = [...VA.querySelectorAll('[data-stream-toggle]')]
const syncToggles = () => { for (const b of toggles) b.textContent = streaming ? '⏸ pause' : '▶ stream' }
for (const b of toggles) b.addEventListener('click', () => { streaming = !streaming; syncToggles(); sync() })
VA.querySelectorAll('details').forEach(d => d.addEventListener('toggle', () => renderAll(null)))

/* ---------- tiny DOM kit ---------- */
function flash(el) { if (!el) return; el.classList.remove('op-flash'); void el.offsetWidth; el.classList.add('op-flash') }
function setText(el, text, flashIt = false) {
  if (!el || el.textContent === text) return false
  el.textContent = text
  if (flashIt) flash(el)
  return true
}
/* keyed reconciliation: keep, move, add (→ rowin), remove */
function syncList(host, items, make, update) {
  const stale = new Map()
  for (const el of host.children) stale.set(el.dataset.key, el)
  let cursor = host.firstElementChild
  items.forEach((it, i) => {
    let el = stale.get(it.k)
    if (el) { stale.delete(it.k); update(el, it, i, false) }
    else { el = make(it); el.dataset.key = it.k; update(el, it, i, true) }
    if (el !== cursor) host.insertBefore(el, cursor)
    else cursor = cursor.nextElementSibling
  })
  for (const el of stale.values()) el.remove()
}

/* ---------- blotter rows ---------- */
const COL = {
  rank:     { cls: 'op-rank', f: (r, i) => String(i + 1) },
  k:        { cls: 'op-k', f: r => r.k },
  sym:      { cls: 'op-sym', f: r => r.sym, sym: true },
  side:     { cls: 'op-side', f: r => r.side, side: true },
  bar:      { cls: 'op-bar', bar: r => r.qty / 1400 },
  qty:      { cls: 'op-qty', f: r => String(r.qty), on: ['qty'] },
  px:       { cls: 'op-px', f: r => fmt2(r.px), on: ['px'] },
  notional: { cls: 'op-notional', f: r => fmtN(r.qty * r.px), on: ['qty', 'px'] },
}
function makeRow(cols) {
  const el = document.createElement('div')
  el.className = 'mrow op-row'
  el.dataset.cols = cols.join('-')   // the grid template lives in operators.css, per column set
  for (const c of cols) {
    const s = document.createElement('span')
    s.className = COL[c].cls
    if (c === 'bar') s.appendChild(document.createElement('i'))
    el.appendChild(s)
  }
  return el
}
function fillRow(el, r, cols, i, delta) {
  const hit = delta && delta.verb === 'update' && delta.key === r.k ? delta.path[0] : null
  cols.forEach((c, j) => {
    const spec = COL[c], s = el.children[j]
    if (c === 'bar') { s.firstChild.style.width = (Math.min(1, spec.bar(r)) * 100).toFixed(1) + '%'; return }
    const text = spec.f(r, i)
    if (s.textContent !== text) { s.textContent = text; if (hit && spec.on && spec.on.includes(hit)) flash(s) }
    if (spec.sym) s.dataset.sym = r.sym
    if (spec.side) s.className = 'op-side ' + r.side
  })
}
function renderList(host, items, cols, delta, cap = 8, moreEl = null) {
  const show = cap ? items.slice(0, cap) : items
  syncList(host, show, () => makeRow(cols), (el, r, i, fresh) => fillRow(el, r, cols, i, fresh ? null : delta))
  if (moreEl) {
    const extra = items.length - show.length
    moreEl.hidden = extra <= 0
    if (extra > 0) moreEl.textContent = `+ ${extra} more row${extra === 1 ? '' : 's'}`
  }
}

/* ---------- sparkline (DPR ≤ 1.5, redrawn per commit) ---------- */
class Spark {
  constructor(canvas, n = 80) { this.c = canvas; this.v = []; this.n = n }
  seed(end, step) {
    const v = [end]
    for (let i = 1; i < this.n * 0.7; i++) v.unshift(v[0] + (Math.random() - 0.5) * step)
    this.v = v; this.draw()
  }
  push(x) { if (x === undefined) return; this.v.push(x); if (this.v.length > this.n) this.v.shift(); this.draw() }
  draw() {
    const c = this.c, w = c.clientWidth, h = 40
    if (!w) return
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    const W = Math.round(w * dpr), H = Math.round(h * dpr)
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H }
    const g = c.getContext('2d')
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    const v = this.v
    if (v.length < 2) return
    let lo = Math.min(...v), hi = Math.max(...v)
    if (hi - lo < 1e-9) { lo -= 1; hi += 1 }
    const pad = (hi - lo) * 0.18; lo -= pad; hi += pad
    const x = i => 1 + (i / (this.n - 1)) * (w - 2)
    const y = val => h - 3 - ((val - lo) / (hi - lo)) * (h - 6)
    g.strokeStyle = '#26262b'; g.lineWidth = 1
    g.beginPath(); g.moveTo(0, Math.round(y(v[0])) + 0.5); g.lineTo(w, Math.round(y(v[0])) + 0.5); g.stroke()
    g.strokeStyle = '#ff5e3a'; g.lineWidth = 1.5; g.lineJoin = 'round'
    g.beginPath()
    v.forEach((val, i) => { const px = x(i), py = y(val); i ? g.lineTo(px, py) : g.moveTo(px, py) })
    g.stroke()
    g.fillStyle = '#ff5e3a'
    g.beginPath(); g.arc(x(v.length - 1), y(v[v.length - 1]), 2.2, 0, Math.PI * 2); g.fill()
  }
}
function nudge(el, v, fmt) {
  if (!el) return
  el.textContent = (v > 0 ? '▲ ' : '▼ ') + fmt(v)
  el.className = 'op-nudge ' + (v > 0 ? 'pos' : 'neg') + ' show'
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('show')))
}

/* ---------- the feed line under the lead-para ---------- */
function renderFeedline(sfx, d) {
  setText($$(`#op-fl-n-${sfx}`), String(size()))
  if (d) { setText($$(`#op-fl-seq-${sfx}`), String(d.seq)); setText($$(`#op-fl-delta-${sfx}`), printDelta(d)) }
}

/* ======================================================================
 * a · the catalogue
 * ====================================================================== */
const STD = ['k', 'sym', 'side', 'bar', 'qty', 'px']

/* filter: side chips */
let sideSel = 'buy'
const filterSig = () => (sideSel === 'all' ? 'trades.filter(t => true)' : `trades.filter(t => t.side === '${sideSel}')`)
{
  const host = $$('#op-filter-chips-a')
  for (const s of ['buy', 'sell', 'all']) {
    const b = document.createElement('button')
    b.type = 'button'; b.className = 'chip' + (s === sideSel ? ' on' : ''); b.textContent = s
    b.setAttribute('aria-pressed', String(s === sideSel))
    b.addEventListener('click', () => {
      sideSel = s
      for (const c of host.children) { const on = c === b; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)) }
      setText($$('#op-sig-filter-a'), filterSig())
      renderFilterA(null)
    })
    host.appendChild(b)
  }
}
function renderFilterA(d) {
  const all = rows(), rs = sideSel === 'all' ? all : all.filter(r => r.side === sideSel)
  setText($$('#op-filter-n-a'), `${rs.length} of ${all.length} rows`)
  setText($$('#op-filter-avg-a'), `sum qty ${fmtN(rs.reduce((s, r) => s + r.qty, 0))}`)
  renderList($$('#op-filter-rows-a'), rs, STD, d, 8, $$('#op-filter-more-a'))
}

/* between: two reactive bounds */
const bwLo = $$('#op-bw-lo-a'), bwHi = $$('#op-bw-hi-a')
let bwLast = null
bwLo.addEventListener('input', () => { bwLast = 'lo'; renderBetweenA(null) })
bwHi.addEventListener('input', () => { bwLast = 'hi'; renderBetweenA(null) })
function renderBetweenA(d) {
  const lo = Math.min(+bwLo.value, +bwHi.value), hi = Math.max(+bwLo.value, +bwHi.value)
  const all = rows(), rs = all.filter(r => r.px >= lo && r.px <= hi)
  setText($$('#op-bw-lo-v-a'), bwLo.value); setText($$('#op-bw-hi-v-a'), bwHi.value)
  setText($$('#op-sig-between-a'), `trades.between('px', [${lo}, ${hi}])`)
  setText($$('#op-bw-label-a'), `between('px', [${lo}, ${hi}])`)
  setText($$('#op-bw-n-a'), String(rs.length), !!d)
  setText($$('#op-bw-total-a'), String(all.length))
  setText($$('#op-bw-range-a'), `${lo}, ${hi}`)
  setText($$('#op-bw-count-a'), `${rs.length} row${rs.length === 1 ? '' : 's'}`)
  if (!d) {
    const wrote = bwLast === null ? null : bwLast === 'lo' ? `bounds.set(0, ${bwLo.value})` : `bounds.set(1, ${bwHi.value})`
    $$('#op-bw-law-a').innerHTML = `<b>const bounds = $([100, 200])</b> · trades.between('px', bounds) · a drag is one write — <i>${wrote || 'bounds.set(0, lo)'}</i> — and the view re-bounds`
  }
  renderList($$('#op-bw-rows-a'), rs, ['k', 'sym', 'side', 'px'], d, 7, $$('#op-bw-more-a'))
}

/* za: the top-5 buys by qty, sliding into rank */
const ZA_COLS = ['rank', 'k', 'sym', 'qty'], ROW_H = 1.68
function renderZaA(d) {
  const buys = rows().filter(r => r.side === 'buy')
  const top = [...buys].sort((a, b) => b.qty - a.qty || kn(a.k) - kn(b.k)).slice(0, 5)
  setText($$('#op-za-note-a'), `top-${Math.min(5, buys.length)} of ${buys.length} buys · slides as qty ticks`)
  const host = $$('#op-za-rows-a')
  const stale = new Map()
  for (const el of host.children) stale.set(el.dataset.key, el)
  top.forEach((r, i) => {
    let el = stale.get(r.k)
    if (el) { stale.delete(r.k); fillRow(el, r, ZA_COLS, i, d) }
    else { el = makeRow(ZA_COLS); el.dataset.key = r.k; fillRow(el, r, ZA_COLS, i, null); el.style.transform = `translateY(${i * ROW_H}rem)`; host.appendChild(el) }
    el.style.transform = `translateY(${i * ROW_H}rem)`
  })
  for (const el of stale.values()) el.remove()
}

/* group: one bucket per sym */
function bucketEl() {
  const el = document.createElement('div')
  el.className = 'gbucket'
  el.innerHTML = '<div class="gbucket-head"><span class="op-sym"></span><span class="gcount"></span></div><div class="gbucket-body op-rows"></div>'
  return el
}
function renderGroupA(d) {
  const all = rows()
  const groups = SYMS.map(s => ({ k: s, rows: all.filter(r => r.sym === s) })).filter(g => g.rows.length)
  syncList($$('#op-group-a'), groups, bucketEl, (el, g, i, fresh) => {
    const head = el.querySelector('.op-sym')
    head.dataset.sym = g.k; setText(head, g.k)
    setText(el.querySelector('.gcount'), String(g.rows.length), !fresh)
    renderList(el.querySelector('.gbucket-body'), g.rows, ['k', 'side', 'qty'], d, 0)
  })
}

/* sum / avg: running scalars, and the law that moves them */
const sparkAvg = new Spark($$('#op-avg-spark-a')), sparkSum = new Spark($$('#op-sum-spark-a'))
let prevAvg, prevSum
function renderAvgA(d) {
  const all = rows(), n = all.length
  const avg = mean(all.map(r => r.px)), sum = all.reduce((s, r) => s + r.qty, 0)
  setText($$('#op-avg-v-a'), avg === undefined ? '—' : fmt2(avg))
  setText($$('#op-sum-v-a'), fmtN(sum))
  const law = $$('#op-avg-law-a')
  if (d) {
    if (prevAvg !== undefined && avg !== prevAvg) nudge($$('#op-avg-d-a'), avg - prevAvg, v => signed(v, 2))
    if (prevSum !== undefined && sum !== prevSum) nudge($$('#op-sum-d-a'), sum - prevSum, signedN)
    if (d.verb === 'update' && d.path[0] === 'px')
      law.innerHTML = `<b>${printDelta(d)}</b> ⇒ avg += (${fmt2(d.value)} − ${fmt2(d.prev)}) / ${n} = <i>${signed(avg - prevAvg, 2)}</i> · sum('qty') untouched — the path is .px`
    else if (d.verb === 'update')
      law.innerHTML = `<b>${printDelta(d)}</b> ⇒ sum += <i>${signedN(d.value - d.prev)}</i> · avg('px') untouched — the path is .qty`
    else if (d.verb === 'add')
      law.innerHTML = `<b>add ${d.key}</b> ⇒ n ${n - 1} → ${n} · avg += (${fmt2(d.row.px)} − avg) / ${n} · sum += ${d.row.qty}`
    else
      law.innerHTML = `<b>remove ${d.key}</b> ⇒ n ${n + 1} → ${n} · avg −= (${fmt2(d.row.px)} − avg) / ${n} · sum −= ${d.row.qty}`
    sparkAvg.push(avg); sparkSum.push(sum)
  } else {
    if (prevAvg === undefined) { law.innerHTML = `n = ${n} · one write nudges a running sum and count — nothing is re-summed`; sparkAvg.seed(avg, 0.3); sparkSum.seed(sum, 60) }
    else { sparkAvg.draw(); sparkSum.draw() }
  }
  prevAvg = avg; prevSum = sum
}

/* median / percentile: R-type-7 over px */
const sparkMed = new Spark($$('#op-med-spark-a')), sparkP90 = new Spark($$('#op-p90-spark-a'))
let prevMed, prevP90
function renderMedA(d) {
  const px = rows().map(r => ({ k: r.k, px: r.px })).sort((a, b) => a.px - b.px)
  const vals = px.map(p => p.px), n = vals.length
  const med = q7(vals, 0.5), p90 = q7(vals, 0.9)
  setText($$('#op-med-v-a'), med === undefined ? '—' : fmt2(med))
  setText($$('#op-p90-v-a'), p90 === undefined ? '—' : fmt2(p90))
  const h = (n - 1) * 0.5 + 1, lo = Math.floor(h), frac = h - lo
  const law = $$('#op-med-law-a')
  law.innerHTML = frac
    ? `R-type-7 · n = ${n} · h = (n − 1)·½ + 1 = <b>${h}</b> ⇒ halfway between x${lo} <i>${fmt2(vals[lo - 1])}</i> (${px[lo - 1].k}) and x${lo + 1} <i>${fmt2(vals[lo])}</i> (${px[lo].k}) · one write moves at most one rank`
    : `R-type-7 · n = ${n} · h = (n − 1)·½ + 1 = <b>${h}</b> ⇒ exactly x${h} <i>${fmt2(vals[h - 1])}</i> (${px[h - 1].k}) · one write moves at most one rank`
  if (d) {
    if (prevMed !== undefined && med !== prevMed) nudge($$('#op-med-d-a'), med - prevMed, v => signed(v, 2))
    if (prevP90 !== undefined && p90 !== prevP90) nudge($$('#op-p90-d-a'), p90 - prevP90, v => signed(v, 2))
    sparkMed.push(med); sparkP90.push(p90)
  } else if (prevMed === undefined) { sparkMed.seed(med, 0.6); sparkP90.seed(p90, 0.8) }
  else { sparkMed.draw(); sparkP90.draw() }
  prevMed = med; prevP90 = p90
}


/* ---------- one render per commit; only while the variant is shown ---------- */
function renderAll(d) {
  if (shown.has(VA)) { renderFeedline('a', d); renderFilterA(d); renderBetweenA(d); renderZaA(d); renderGroupA(d); renderAvgA(d); renderMedA(d) }
}
onCommit(renderAll)
renderAll(null)
syncToggles()
sync()
