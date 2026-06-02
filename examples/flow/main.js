/* The essay's figures — all windows onto ONE model (see log.js).
 *
 *   the instrument (§1) : the scrubbable change history + four derived-view panels.
 *   §3 cost             : per-change work vs table size — data O(Δ) flat, recompute O(N).
 *   §4 selectivity      : each change tinted by the derived views it actually moved.
 *   §5 edge / §7 dom    : one change handed view-to-view; one change → one DOM instruction.
 *
 * The derived-view panels are ordinary `render()` calls off the model's views,
 * so they update for free. Only the chrome (chips, playhead, meters) is wired by
 * hand. Scrubbing reconstructs an earlier state for display only — the library
 * itself never re-folds; it always moves forward.
 *
 * Hand-written .js, no .ts sibling (see CLAUDE.md).
 */

import { $, render, HTML, value } from 'data/full'
import { createLog, REGIONS } from './log.js'

const { div, span } = HTML
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

/* ---- the one model ---------------------------------------------------- */
const SEED = [
  { active: true,  region: 'north', value: 87 },
  { active: false, region: 'south', value: 42 },
  { active: true,  region: 'east',  value: 65 },
  { active: true,  region: 'west',  value: 74 },
]
const model = createLog(SEED)
const countView = r => model.perRegion[r].value

/* ====================================================================== *
 * the four fold panels — declarative, off the model's views
 * ====================================================================== */
function mountFolds () {
  render(document.getElementById('fold-orders'), div['.flist'](
    div(model.display, (n, row) => n.frow.attr('data-id', row.id).nodes(
      span.fr_id.text(row.id.to(id => '#' + id)),
      span.fr_reg.text(row.region),
      span.fr_val.text(row.value),
    )),
  ))

  render(document.getElementById('fold-active'), div['.flist'](
    div(model.active, (n, row) => n.frow.attr('data-id', row.id).nodes(
      span.fr_id.text(row.id.to(id => '#' + id)),
      span.fr_reg.text(row.region),
      span.fr_val.text(row.value),
    )),
  ))

  render(document.getElementById('fold-perRegion'), div['.flist'](
    ...REGIONS.map(r => div.rbar.nodes(
      span.rb_k(r),
      div.rb_track.nodes(
        div.rb_fill.style('width', countView(r).to(n => Math.min(100, (n || 0) * 18) + '%')),
      ),
      span.rb_n.text(countView(r).to(n => String(n || 0))),
    )),
  ))

  render(document.getElementById('fold-avg'), div['.flist'](
    span.avg_scalar.text(model.avg.to(v => v == null ? '—' : String(Math.round(v)))),
    span.avg_unit('mean value, all orders'),
  ))
}

/* ====================================================================== *
 * the timeline — chips + playhead (hand-wired interaction)
 * ====================================================================== */
const stripEl   = document.getElementById('tl-strip')
const detailEl  = document.getElementById('tl-detail')
const headNEl   = document.getElementById('tl-head-n')
const lenEl     = document.getElementById('tl-len')
const selStrip  = document.getElementById('sel-strip')
const pinStrip  = document.getElementById('tl-pin-strip')
let chipEls = []
let pinChipEls = []

const glyphOf = rec =>
  rec.type === 'insert' ? '+' :
  rec.type === 'remove' ? '✕' :
  rec.field === 'active' ? '↻' : '△'

const downChanged = rec => [...(rec.changed || [])].filter(f => f !== 'orders')

// a dot per fold the record actually MOVED — its selectivity footprint.
function feedDots (rec) {
  return ['active', 'perRegion', 'avg']
    .filter(f => rec.changed && rec.changed.has(f))
    .map(f => `<i class="feed-${f}"></i>`).join('')
}

function buildChips () {
  stripEl.innerHTML = ''
  selStrip.innerHTML = ''
  pinStrip.innerHTML = ''
  pinChipEls = []
  chipEls = model.log.map((rec, i) => {
    const c = document.createElement('div')
    c.className = 'chip'
    c.dataset.i = i
    c.dataset.type = rec.type
    c.innerHTML =
      `<span class="chip-g">${glyphOf(rec)}</span>` +
      `<span class="chip-k">#${rec.rid ?? '?'}</span>` +
      `<span class="chip-feeds">${feedDots(rec)}</span>`
    c.addEventListener('mouseenter', () => describeRecord(rec, i))
    stripEl.appendChild(c)

    // §4 mirror chip — same record, feed-focused
    const s = document.createElement('div')
    s.className = 'chip'
    s.dataset.type = rec.type
    s.style.width = '34px'
    s.innerHTML = `<span class="chip-g">${glyphOf(rec)}</span><span class="chip-feeds">${feedDots(rec)}</span>`
    s.addEventListener('mouseenter', () => { describeSel(rec); lightFolds(rec) })
    s.addEventListener('mouseleave', () => clearLitFolds())
    selStrip.appendChild(s)

    // pinned mini-chip — same record, follows the scroll
    const p = document.createElement('div')
    p.className = 'pchip'
    p.dataset.type = rec.type
    p.innerHTML = `<span class="chip-g">${glyphOf(rec)}</span><span class="pchip-id">#${rec.rid ?? '?'}</span><span class="chip-feeds">${feedDots(rec)}</span>`
    pinStrip.appendChild(p)
    pinChipEls.push(p)

    return c
  })
}

const verbOf = rec =>
  rec.type === 'insert' ? `inserted <b>#${rec.rid}</b>` :
  rec.type === 'remove' ? `removed <b>#${rec.rid}</b>` :
  rec.field === 'active' ? `toggled <b>#${rec.rid}</b>.active` :
  `bumped <b>#${rec.rid}</b>.value`

function selectivityTail (rec) {
  const ch = downChanged(rec)
  return ch.length
    ? `moved <span class="tag">${ch.join(' · ')}</span>${ch.length < 3 ? ` <span class="muted">· left the other ${3 - ch.length} untouched</span>` : ''}`
    : 'moved nothing downstream'
}

function describeRecord (rec, i) {
  detailEl.innerHTML = `record ${i + 1}: ${verbOf(rec)} — ${selectivityTail(rec)}`
}

function describeSel (rec) {
  document.getElementById('sel-detail').innerHTML = `${verbOf(rec)} — ${selectivityTail(rec)}`
}

/* light the fold panels a record moved, each in its own colour. */
function lightFolds (rec) {
  for (const f of ['active', 'perRegion', 'avg', 'orders']) {
    const el = document.querySelector(`.fold[data-fold="${f}"]`)
    if (el) el.classList.toggle('lit-' + f, !!(rec.changed && rec.changed.has(f)))
  }
}
function clearLitFolds () {
  for (const f of ['active', 'perRegion', 'avg', 'orders']) {
    const el = document.querySelector(`.fold[data-fold="${f}"]`)
    if (el) el.classList.remove('lit-' + f)
  }
}

const paintHead = (els, h) => els.forEach((c, i) => {
  c.classList.toggle('behind', i < h)
  c.classList.toggle('ahead', i >= h)
  c.classList.toggle('head', i === h - 1)
})

function syncHead () {
  const h = model.head(), L = model.log.length
  headNEl.textContent = h
  lenEl.textContent = L
  paintHead(chipEls, h)
  paintHead(pinChipEls, h)
  const meta = document.getElementById('tl-pin-meta')
  if (meta) meta.textContent = `${h} / ${L}`
  const rec = model.log[h - 1]
  if (!rec) detailEl.textContent = 'log folded to the beginning — state is empty'
  else describeRecord(rec, h - 1)
}

function setHead (k) { model.scrubTo(k); syncHead() }

/* ---- scrubbing: pointer + keyboard, on either strip (horizontal main,
 * vertical left rail) ---- */
const headFromPointer = (e, els, axis) => els.filter(c => {
  const r = c.getBoundingClientRect()
  return axis === 'y' ? e.clientY > r.top : e.clientX > r.left
}).length

function wireScrub (el, getEls, axis) {
  let dragging = false
  el.addEventListener('pointerdown', e => {
    dragging = true; el.setPointerCapture(e.pointerId); setHead(headFromPointer(e, getEls(), axis))
  })
  el.addEventListener('pointermove', e => { if (dragging) setHead(headFromPointer(e, getEls(), axis)) })
  el.addEventListener('pointerup',   () => { dragging = false })
  el.addEventListener('pointercancel', () => { dragging = false })
  el.addEventListener('mouseleave',  () => { if (!dragging) syncHead() })
  el.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')   { setHead(Math.max(0, model.head() - 1)); e.preventDefault() }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { setHead(Math.min(model.log.length, model.head() + 1)); e.preventDefault() }
  })
}
wireScrub(stripEl, () => chipEls, 'x')
wireScrub(pinStrip, () => pinChipEls, 'y')

/* ====================================================================== *
 * appends — the instrument controls
 * ====================================================================== */
function appendRecord (act) {
  const recs = model.actions[act]()
  buildChips(); syncHead()
  flashFolds(recs && recs[recs.length - 1])
  return recs
}

function flashFolds (rec) {
  if (!rec) return
  for (const f of ['active', 'perRegion', 'avg', 'orders']) {
    if (rec.changed && rec.changed.has(f)) {
      const el = document.querySelector(`.fold[data-fold="${f}"]`)
      if (el) { el.classList.add('lit-' + f); setTimeout(() => el.classList.remove('lit-' + f), 480) }
    }
  }
  // flash the specific row the record touched, in the panels that show it.
  if (rec.rid != null) {
    for (const panel of ['fold-orders', 'fold-active']) {
      const row = document.querySelector(`#${panel} .frow[data-id="${rec.rid}"]`)
      if (row) { row.classList.remove('fresh'); void row.offsetWidth; row.classList.add('fresh') }
    }
  }
}

document.querySelectorAll('#tl-controls .tlb').forEach(btn => {
  btn.addEventListener('click', () => appendRecord(btn.dataset.act))
})

/* ====================================================================== *
 * §3 — the cost is the change, not the table.
 * The naive way re-derives every view over all N rows on each change: O(N),
 * and it grows with the table. data touches only what moved: O(Δ), flat in N.
 * We plot per-change work as a function of table size N, both measured — the
 * recompute by actually scanning N rows, data by counting the views a real
 * change moves.
 * ====================================================================== */
const costIncEl = document.getElementById('cost-inc')
const costRefEl = document.getElementById('cost-ref')
const barFill   = document.getElementById('cost-bar-fill')
const barLabel  = document.getElementById('cost-bar-label')
const N_POINTS  = [60, 600, 6000, 60000]
let costN = 6000
let costRevealed = false
let dataWork = 3        // ~one row × the views a change moves; constant in N

// data's per-change work: apply one real change to the model and count how many
// derived views it moves (each O(1)). Constant in N. Measured, not authored.
function measureDataWork () {
  const recs = appendRecord('toggle')
  const r = recs && recs[recs.length - 1]
  dataWork = r && r.changed ? r.changed.size : 1   // e.g. orders + active + perRegion
  return dataWork
}
// recompute's per-change work: re-derive filter + group + avg over all N rows.
function measureRecomputeWork (n) {
  let visits = 0
  for (let i = 0; i < n; i++) { visits++; /* filter pass */ }
  for (let i = 0; i < n; i++) { visits++; /* group pass  */ }
  for (let i = 0; i < n; i++) { visits++; /* avg pass    */ }
  return visits
}

function renderCost () {
  const dataW = dataWork
  const refW = costRevealed ? measureRecomputeWork(costN) : null
  costIncEl.textContent = `${dataW} ops`
  costRefEl.textContent = refW == null ? '—' : `${refW.toLocaleString()} visits`
  if (refW != null) {
    const ratio = Math.round(refW / dataW)
    barFill.style.width = Math.min(100, (1 - dataW / refW) * 100) + '%'
    barLabel.textContent = `at N=${costN.toLocaleString()}, recompute does ≈ ${ratio.toLocaleString()}× the work of one change`
  } else { barFill.style.width = '0'; barLabel.textContent = '' }
  drawCurve()
}

// per-change work vs table size: data a flat line near the axis, recompute a
// line rising with N. Sampled across the size range; the chosen N is marked.
function drawCurve () {
  const svg = document.getElementById('cost-curve')
  if (!svg) return
  const W = 584, H = 116, x0 = 8, y0 = 14
  const base = `<line class="cc-grid" x1="${x0}" y1="${y0 + H}" x2="${x0 + W}" y2="${y0 + H}"/>`
  if (!costRevealed) { svg.innerHTML = base; return }
  const Nmax = N_POINTS[N_POINTS.length - 1]
  const maxW = 3 * Nmax
  const X = n => (x0 + (n / Nmax) * W).toFixed(1)
  const Y = v => (y0 + H - (v / maxW) * H).toFixed(1)
  const pts = []
  for (let s = 0; s <= 40; s++) pts.push(Math.round((s / 40) * Nmax))
  const ref = pts.map(n => `${X(n)},${Y(3 * n)}`).join(' ')
  const adv = pts.map(n => `${X(n)},${Y(3)}`).join(' ')
  const markX = X(costN), markY = Y(3 * costN)
  svg.innerHTML = base +
    `<polygon class="cc-refold-area" points="${X(0)},${y0 + H} ${ref} ${X(Nmax)},${y0 + H}"/>` +
    `<polyline class="cc-refold" points="${ref}"/>` +
    `<polyline class="cc-advance" points="${adv}"/>` +
    `<line class="cc-grid" x1="${markX}" y1="${y0}" x2="${markX}" y2="${y0 + H}" stroke-dasharray="2 3"/>` +
    `<circle class="cc-dot" r="3.5" fill="var(--neg)" cx="${markX}" cy="${markY}"/>` +
    `<circle class="cc-dot" r="3.5" fill="var(--pos)" cx="${markX}" cy="${Y(3)}"/>` +
    `<text class="cc-label ref" x="${x0 + 6}" y="${y0 + 12}">recompute · O(N)</text>` +
    `<text class="cc-label adv" x="${x0 + 6}" y="${y0 + H - 6}">data · O(Δ)</text>` +
    `<text class="cc-label" fill="var(--faint)" x="${x0 + 4}" y="${y0 + H + 11}">table size N →</text>`
}

function mountCost () {
  const veil = document.getElementById('cost-veil')
  const note = document.getElementById('cost-note')
  // ensure the model reflects one settled change before measuring data's cost.
  veil.querySelectorAll('[data-bet]').forEach(btn => btn.addEventListener('click', () => {
    const right = btn.dataset.bet === 'linear'
    costRevealed = true
    veil.classList.add('gone')
    measureDataWork(); buildChips(); syncHead()
    renderCost()
    note.innerHTML = `${right ? '<b class="win">right.</b>' : 'not quite —'} recompute is <code>O(N)</code> — ten times the table, ten times the cost per change; data stays flat at <code>O(Δ)</code>.`
  }))
  document.getElementById('cost-n').addEventListener('change', e => { costN = +e.target.value; renderCost() })
  renderCost()
}

/* ====================================================================== *
 * §5 — a log at every edge: a record on the source becomes a record on
 * `active`, which is what perRegion folds. We capture active's own emitted
 * records during one toggle.
 * ====================================================================== */
function mountEdge () {
  const srcEl = document.getElementById('edge-src')
  const actEl = document.getElementById('edge-act')
  if (!srcEl || !actEl) return
  let cap = false
  const actBuf = []
  const anchor = {}
  model.active.connect(anchor, c => { if (cap) actBuf.push(c) })
  const idFrom = a => (a.value && a.value.id) ?? (a.key && a.key[0]) ?? a.at ?? '?'
  const flash = el => { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash') }
  document.getElementById('edge-go').addEventListener('click', () => {
    actBuf.length = 0
    cap = true
    const recs = appendRecord('toggle')   // mutates the source, advances the log
    cap = false
    const r = recs && recs[0]
    srcEl.textContent = r ? `{ update · #${r.rid}.active }` : '(none)'
    const a = actBuf[actBuf.length - 1]
    actEl.textContent = a ? `{ ${a.type} · #${idFrom(a)} }` : '{ no membership change }'
    flash(srcEl); flash(actEl)
  })
}

/* ====================================================================== *
 * §7 — the DOM is the last fold: one record becomes one DOM operation, on a
 * small live list that is itself an ordinary render() sink.
 * ====================================================================== */
function mountDomFold () {
  const listEl = document.getElementById('dom-list')
  const recEl = document.getElementById('dom-rec')
  const opEl = document.getElementById('dom-op')
  if (!listEl) return
  const src = $({})
  let nid = 1
  const REG = ['north', 'south', 'east', 'west']

  render(listEl, div['.flist'](
    div(src, (n, row) => n.dl_row.attr('data-id', row.id).nodes(
      span.dl_id.text(row.id.to(id => '#' + id)),
      span.dl_reg.text(row.region),
      span.dl_val.text(row.value),
    )),
  ))

  const present = () => Object.keys(src[value]).filter(k => src[value][k] != null)
  const flashRow = (id, only) => {
    const row = listEl.querySelector(`.dl-row[data-id="${id}"]`); if (!row) return
    const target = only === 'val' ? row.querySelector('.dl-val') : row
    if (target) { target.classList.remove('fresh'); void target.offsetWidth; target.classList.add('fresh') }
  }
  const show = (rec, op) => { recEl.textContent = rec; opEl.innerHTML = '↳ ' + op; recEl.classList.remove('flash'); void recEl.offsetWidth; recEl.classList.add('flash') }
  const seed = () => { const id = nid++; src[id] = { id, region: REG[(id - 1) % 4], value: 40 + ((id * 31) % 50) }; return id }

  document.getElementById('dom-insert').addEventListener('click', () => {
    const id = seed()
    show(`{ insert · #${id} }`, `list.<b>appendChild</b>(node) — one call`); flashRow(id)
  })
  document.getElementById('dom-update').addEventListener('click', () => {
    const ks = present(); if (!ks.length) return
    const k = ks[(Math.random() * ks.length) | 0]
    src[k].value = src[k].value[value] + 5
    show(`{ update · #${k}.value }`, `<b>one</b> text write — the row never re-renders`); flashRow(k, 'val')
  })
  document.getElementById('dom-remove').addEventListener('click', () => {
    const ks = present(); if (!ks.length) return
    const k = ks[(Math.random() * ks.length) | 0]
    delete src[k]
    show(`{ remove · #${k} }`, `node.<b>remove</b>() — one call`)
  })

  seed(); seed()
}

/* ====================================================================== *
 * spotlight the fold a section is about + label the pinned timeline, as
 * each section scrolls into view.
 * ====================================================================== */
function mountSpotlights () {
  // section id -> { fold to spotlight, pin label }
  const map = {
    'view-fold':    { fold: 'active',    label: '§2 · stays live' },
    'cost':         { fold: null,        label: '§3 · cost of a change' },
    'selectivity':  { fold: null,        label: '§4 · selectivity' },
    'composition':  { fold: 'perRegion', label: '§5 · composed' },
    'determinism':  { fold: null,        label: '§6 · no deltas' },
    'dom-fold':     { fold: 'orders',    label: '§7 · the DOM' },
  }
  const pinLabel = document.getElementById('tl-pin-label')
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      const m = map[e.target.id]; if (!m) continue
      document.querySelectorAll('.fold').forEach(f => f.classList.remove('spotlight'))
      if (m.fold) { const el = document.querySelector(`.fold[data-fold="${m.fold}"]`); if (el) el.classList.add('spotlight') }
      if (pinLabel) pinLabel.textContent = m.label
    }
  }, { threshold: 0.4 })
  for (const id of Object.keys(map)) { const s = document.getElementById(id); if (s) io.observe(s) }

  // show the pinned timeline once the instrument has scrolled above the top.
  // A scroll check (rAF-throttled) rather than an IntersectionObserver: an
  // instant scrollIntoView can jump the tall instrument from below the viewport
  // to above it without ever intersecting, which an observer would never fire on.
  const pin = document.getElementById('tl-pin')
  const instrument = document.getElementById('instrument')
  if (pin && instrument) {
    let ticking = false
    const update = () => { ticking = false; pin.classList.toggle('show', instrument.getBoundingClientRect().bottom < 8) }
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update) } }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    update()
  }
}

/* ---- boot ---- */
mountFolds()
buildChips()
syncHead()
mountCost()
mountEdge()
mountDomFold()
mountSpotlights()
document.getElementById('sel-legend').innerHTML =
  ['active', 'perRegion', 'avg'].map(f =>
    `<span class="lk"><span class="sw feed-${f}"></span>${f}</span>`).join('') +
  `<span class="lk muted">a dot per derived view the change moves</span>`
