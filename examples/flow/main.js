/* The essay's figures — all windows onto ONE model (see log.js).
 *
 *   the duality (§1)    : the real change records (left) ⟷ the orders table
 *                         (right), two forms of one thing, + three derived views.
 *   §3 cost             : per-change work vs table size — data O(Δ) flat, recompute O(N).
 *   §4 selectivity      : each change tinted by the derived views it actually moved.
 *   §5 edge / §7 dom    : one change handed view-to-view; one change → one DOM instruction.
 *
 * The table and derived-view panels are ordinary `render()` calls off the model's
 * views, so they update for free. Only the chrome (records list, playhead, meters)
 * is wired by hand. Scrubbing reconstructs an earlier state for display only — the
 * library itself never re-folds; it always moves forward.
 *
 * Hand-written .js, no .ts sibling (see CLAUDE.md).
 */

import { render, HTML } from 'data/full'
import { createLog, REGIONS } from './log.js'

const { div, span } = HTML
// reduced-motion is handled entirely in CSS (index.css @media prefers-reduced-motion).

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
  // §1 duality — the orders table on the right is a live render() sink.
  render(document.getElementById('dz-rows'), div['.flist'](
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
 * §1 the duality — the change records (left) ⟷ the table (right).
 * The records list is the REAL log (model.log), rendered as literal deltas
 * and doubling as the scrub control. The table is a live render() sink off
 * model.display. Scrub = apply changes → table; a button = edit the table →
 * a new change appears. One shared playhead drives the whole page.
 * ====================================================================== */
const recordsEl = document.getElementById('dz-records')
const dzDetail  = document.getElementById('dz-detail')
const dzMeta    = document.getElementById('dz-meta')
const selStrip  = document.getElementById('sel-strip')
const pinStrip  = document.getElementById('tl-pin-strip')
let recEls = []
let pinChipEls = []
let selRowEls = []
/* figure updaters registered by their mount fns; syncHead drives them all so
 * every figure is a function of the one shared playhead. */
const figureUpdaters = []

const FOLD_NAMES = ['active', 'perRegion', 'avg', 'orders']
const foldEl = f => f === 'orders'
  ? document.querySelector('.dz-table')
  : document.querySelector(`.fold[data-fold="${f}"]`)

const glyphOf = rec =>
  rec.type === 'insert' ? '+' :
  rec.type === 'remove' ? '✕' :
  rec.field === 'active' ? '↻' : '△'

const downChanged = rec => [...(rec.changed || [])].filter(f => f !== 'orders')

/* the literal delta a record carries — { type, key/at, value } made readable. */
function recordParts (rec) {
  if (rec.type === 'insert') {
    const v = rec.value || {}
    return { k: 'insert', id: `#${v.id ?? rec.at}`, val: `{ ${v.region} · ${v.active ? 'on' : 'off'} · ${v.value} }` }
  }
  if (rec.type === 'remove') {
    return { k: 'remove', id: `#${(rec.key && rec.key[0]) ?? rec.rid}`, val: '' }
  }
  const path = rec.key || []
  const field = path[path.length - 1]
  const id = path[0] ?? rec.rid
  const val = field === 'active' ? (rec.value ? 'on' : 'off') : rec.value
  return { k: 'update', id: `#${id}.${field}`, val: `→ ${val}` }
}

function buildRecords () {
  recordsEl.innerHTML = ''
  pinStrip.innerHTML = ''
  recEls = []
  pinChipEls = []
  selRowEls = []
  // §4 matrix header (records × views)
  selStrip.innerHTML =
    '<div class="selm-head"><span>change</span>' +
    '<span class="sh-active">active</span><span class="sh-region">perRegion</span><span class="sh-avg">avg</span></div>'

  model.log.forEach((rec, i) => {
    const p = recordParts(rec)

    // the real change record (left of §1) — full literal delta, doubles as scrub track
    const r = document.createElement('div')
    r.className = 'drec'
    r.dataset.i = i
    r.dataset.type = rec.type
    r.innerHTML =
      `<span class="dr-k">${p.k}</span>` +
      `<span class="dr-id">${p.id}</span>` +
      `<span class="dr-v">${p.val}</span>`
    r.addEventListener('mouseenter', () => { describeRecord(rec, i); lightFolds(rec) })
    r.addEventListener('mouseleave', () => clearLitFolds())
    recordsEl.appendChild(r)
    recEls.push(r)

    // §4 selectivity matrix row — a filled dot under each view this change moved
    const cell = f => `<span class="sm-cell ${rec.changed && rec.changed.has(f) ? 'on' : ''}" data-v="${f}"></span>`
    const row = document.createElement('div')
    row.className = 'selm-row'
    row.dataset.type = rec.type
    row.dataset.i = i
    row.innerHTML = `<span class="sm-change"><span class="g">${glyphOf(rec)}</span>${p.id}</span>` +
      cell('active') + cell('perRegion') + cell('avg')
    row.addEventListener('mouseenter', () => { describeSel(rec); lightFolds(rec) })
    row.addEventListener('mouseleave', () => { clearLitFolds(); updateSel() })
    row.addEventListener('click', () => setHead(i + 1))
    selStrip.appendChild(row)
    selRowEls.push(row)

    // pinned rail line — a clean mini-timeline entry (type tick + glyph + id), not a pill
    const pc = document.createElement('div')
    pc.className = 'pchip'
    pc.dataset.type = rec.type
    pc.innerHTML = `<span class="chip-g">${glyphOf(rec)}</span><span class="pchip-id">${p.id.split('.')[0]}</span>`
    pinStrip.appendChild(pc)
    pinChipEls.push(pc)
  })
}

const verbOf = rec =>
  rec.type === 'insert' ? `inserted <b>#${rec.rid}</b>` :
  rec.type === 'remove' ? `removed <b>#${rec.rid}</b>` :
  rec.field === 'active' ? `toggled <b>#${rec.rid}</b>.active` :
  `bumped <b>#${rec.rid}</b>.value`


/* the head record as the literal source-side delta, e.g. { update · #3.active }. */
function srcDeltaText (rec) {
  if (!rec) return '—'
  const p = recordParts(rec)
  return rec.type === 'update' ? `{ update · ${p.id} }` : `{ ${p.k} · ${p.id} }`
}
/* the same change as `active` re-emitted it (§5). Reads the captured actDeltas. */
function actDeltaText (rec) {
  const a = rec && rec.actDeltas && rec.actDeltas[rec.actDeltas.length - 1]
  if (!a) return '{ no change to active }'
  const id = (a.value && a.value.id) ?? (a.key && a.key[0]) ?? a.at ?? '?'
  return `{ ${a.type} · #${id} }`
}

function selectivityTail (rec) {
  const ch = downChanged(rec)
  return ch.length
    ? `moved <span class="tag">${ch.join(' · ')}</span>${ch.length < 3 ? ` <span class="muted">· left the other ${3 - ch.length} untouched</span>` : ''}`
    : 'moved nothing downstream'
}

function describeRecord (rec, i) {
  dzDetail.innerHTML = `record ${i + 1}: ${verbOf(rec)} — ${selectivityTail(rec)}`
}

function describeSel (rec) {
  document.getElementById('sel-detail').innerHTML = `${verbOf(rec)} — ${selectivityTail(rec)}`
}

/* light the panels a record moved, each in its own colour (orders = the table). */
function lightFolds (rec) {
  for (const f of FOLD_NAMES) {
    const el = foldEl(f)
    if (el) el.classList.toggle('lit-' + f, !!(rec.changed && rec.changed.has(f)))
  }
}
function clearLitFolds () {
  for (const f of FOLD_NAMES) {
    const el = foldEl(f)
    if (el) el.classList.remove('lit-' + f)
  }
}

const paintHead = (els, h) => els.forEach((c, i) => {
  c.classList.toggle('behind', i < h)
  c.classList.toggle('ahead', i >= h)
  c.classList.toggle('head', i === h - 1)
})

/* light the duality hinge in the direction the last interaction implied:
 * scrubbing applies changes (→ table); a button diffs the table (→ a change). */
function lightArrow (dir) {
  const a = document.querySelector(dir === 'diff' ? '.dz-diff' : '.dz-apply')
  if (a) { a.classList.add('lit'); setTimeout(() => a.classList.remove('lit'), 520) }
}

/* the change at the playhead — the one record every figure reads from. */
const headRec = () => model.log[model.head() - 1] || null

/* §4 reflects the head record too: mark its chip, default the detail to it. */
function updateSel () {
  paintHead(selRowEls, model.head())
  const rec = headRec()
  const el = document.getElementById('sel-detail')
  if (el) el.innerHTML = rec ? `${verbOf(rec)} — ${selectivityTail(rec)}` : 'add a change, or scrub the history'
}

function syncHead () {
  const h = model.head(), L = model.log.length
  paintHead(recEls, h)
  paintHead(pinChipEls, h)
  if (dzMeta) dzMeta.textContent = `${h} / ${L}`
  const meta = document.getElementById('tl-pin-meta')
  if (meta) meta.textContent = `${h} / ${L}`
  const rec = model.log[h - 1]
  if (!rec) dzDetail.textContent = 'no changes applied — the table is empty'
  else describeRecord(rec, h - 1)
  updateSel()
  // every other figure is a function of the same head.
  for (const u of figureUpdaters) u()
}

function setHead (k) { model.scrubTo(k); syncHead(); lightArrow('apply') }

/* ---- scrubbing: pointer + keyboard, on either strip (vertical records list,
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
wireScrub(recordsEl, () => recEls, 'y')
wireScrub(pinStrip, () => pinChipEls, 'y')

/* ====================================================================== *
 * appends — editing the table emits a new change (the 'diff' direction)
 * ====================================================================== */
function appendRecord (act) {
  const recs = model.actions[act]()
  buildRecords(); syncHead()
  flashFolds(recs && recs[recs.length - 1])
  flashNewRecord()
  return recs
}

/* the duality made visible: a table edit produced a fresh delta on the left.
 * (No auto-scroll — that would move the playhead's position out from under a
 * pointer mid-scrub; the new record's .head styling marks it in place.) */
function flashNewRecord () {
  const last = recEls[recEls.length - 1]
  if (last) { last.classList.remove('flash'); void last.offsetWidth; last.classList.add('flash') }
  lightArrow('diff')
}

function flashFolds (rec) {
  if (!rec) return
  for (const f of FOLD_NAMES) {
    if (rec.changed && rec.changed.has(f)) {
      const el = foldEl(f)
      if (el) { el.classList.add('lit-' + f); setTimeout(() => el.classList.remove('lit-' + f), 480) }
    }
  }
  // flash the specific row the record touched, in the views that show it.
  if (rec.rid != null) {
    for (const sel of ['#dz-rows', '#fold-active']) {
      const row = document.querySelector(`${sel} .frow[data-id="${rec.rid}"]`)
      if (row) { row.classList.remove('fresh'); void row.offsetWidth; row.classList.add('fresh') }
    }
  }
}

document.querySelectorAll('#dz-controls .tlb').forEach(btn => {
  btn.addEventListener('click', () => appendRecord(btn.dataset.act))
})

/* ====================================================================== *
 * §3 — flow the change, not the table. The sweep: the `orders` table drawn as
 * N row-ticks. One change touches ONE row (data, O(Δ)); recompute re-scans
 * EVERY row (O(N)) — a left→right sweep that lights the lot. Drag N and the
 * recompute strip fills regardless while data stays one tick. The data tick +
 * label track the change at the PLAYHEAD, so scrubbing the rail keeps §3 in
 * sync with the rest of the page (without re-running the sweep animation).
 * ====================================================================== */
const sweepData  = document.getElementById('sweep-data')
const sweepRef   = document.getElementById('sweep-ref')
const sweepDataN = document.getElementById('sweep-data-n')
const sweepRefN  = document.getElementById('sweep-ref-n')
const SHOWN_MAX  = 180          // ticks we can draw; the label carries the true N
let costN = 6000
let costRevealed = false

// data's footprint at the playhead — the views the change moved (excl. the base).
function dataWorkAtHead () {
  const rec = headRec()
  return rec && rec.changed ? rec.changed.size : 0
}
const shownBars = () => Math.max(1, Math.min(costN, SHOWN_MAX))

// light the one row the change at the playhead touched.
function markHit () {
  const n = sweepData.children.length
  if (!n) return
  const rec = headRec()
  const hit = rec && rec.rid != null ? (rec.rid % n) : (n >> 1)
  ;[...sweepData.children].forEach((b, i) => b.classList.toggle('hit', i === hit))
}

// runs on every playhead move (a figureUpdater): move the lit row + relabel,
// but DON'T rebuild or re-animate the recompute sweep.
function updateCostLabel () {
  if (!costRevealed) { sweepDataN.textContent = '—'; sweepRefN.textContent = '—'; return }
  markHit()
  const views = Math.max(0, dataWorkAtHead() - 1)
  sweepDataN.innerHTML = `<b>1</b> row${views ? ` + ${views} view${views === 1 ? '' : 's'}` : ''}`
}

// runs on reveal + N change: rebuild both strips and play the recompute sweep.
function rebuildSweep () {
  if (!costRevealed) return
  const shown = shownBars()
  const bars = '<i class="sweep-bar"></i>'.repeat(shown)
  sweepData.innerHTML = bars
  sweepRef.innerHTML = bars
  sweepData.classList.add('lit')
  const step = Math.min(900 / shown, 8)   // stagger → a visible left→right sweep
  ;[...sweepRef.children].forEach((b, i) => { b.style.transitionDelay = `${Math.round(i * step)}ms` })
  sweepRef.classList.remove('swept'); void sweepRef.offsetWidth; sweepRef.classList.add('swept')
  updateCostLabel()
  sweepRefN.innerHTML = `<b>${costN.toLocaleString()}</b> rows${costN > SHOWN_MAX ? ` (${SHOWN_MAX} shown)` : ''}`
}

function mountCost () {
  const veil = document.getElementById('cost-veil')
  const note = document.getElementById('cost-note')
  veil.querySelectorAll('[data-bet]').forEach(btn => btn.addEventListener('click', () => {
    const right = btn.dataset.bet === 'linear'
    costRevealed = true
    veil.classList.add('gone')
    rebuildSweep()
    note.innerHTML = `${right ? '<b class="win">right.</b>' : 'not quite —'} recompute re-scans <b>all N</b> rows for a one-row change — ten times the table, ten times the work; data touches one row at any size. Drag N, or scrub the rail.`
  }))
  document.getElementById('cost-n').addEventListener('change', e => { costN = +e.target.value; rebuildSweep() })
  figureUpdaters.push(updateCostLabel)   // move the lit row when the playhead moves
  updateCostLabel()
}

/* ====================================================================== *
 * §5 — the change at every edge: the change `orders` sees becomes the change
 * `active` hands on. The model captures active's OWN delta for every record
 * (log.js → actDeltas), so this figure just reads the head record. The button
 * appends a toggle to the SAME stream; scrubbing the rail drives it too.
 * ====================================================================== */
function mountEdge () {
  const srcEl = document.getElementById('edge-src')
  const actEl = document.getElementById('edge-act')
  if (!srcEl || !actEl) return
  const flash = el => { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash') }
  function updateEdge () {
    const rec = headRec()
    srcEl.textContent = srcDeltaText(rec)
    actEl.textContent = rec ? actDeltaText(rec) : '—'
  }
  document.getElementById('edge-go').addEventListener('click', () => {
    appendRecord('toggle')        // one toggle on the shared stream; syncHead refreshes the text
    flash(srcEl); flash(actEl)
  })
  figureUpdaters.push(updateEdge)
  updateEdge()
}

/* ====================================================================== *
 * §7 — the DOM is the last derivation: render() is one more sink on the same
 * changes. This list is a SECOND render() pointed at the very SAME source as
 * the §1 table, so a button updates both from the one change — and each record
 * maps to exactly one DOM instruction, read off the head record.
 * ====================================================================== */
function mountDomFold () {
  const listEl = document.getElementById('dom-list')
  const recEl = document.getElementById('dom-rec')
  const opEl = document.getElementById('dom-op')
  if (!listEl) return

  render(listEl, div['.flist'](
    div(model.display, (n, row) => n.dl_row.attr('data-id', row.id).nodes(
      span.dl_id.text(row.id.to(id => '#' + id)),
      span.dl_reg.text(row.region),
      span.dl_val.text(row.value),
    )),
  ))

  const opFor = rec =>
    rec.type === 'insert' ? `list.<b>appendChild</b>(node) — one call` :
    rec.type === 'remove' ? `node.<b>remove</b>() — one call` :
    `<b>one</b> text write — the row never re-renders`
  function updateDomOp () {
    const rec = headRec()
    recEl.textContent = rec ? srcDeltaText(rec) : '— press a button —'
    opEl.innerHTML = rec ? '↳ ' + opFor(rec) : '↳ the one DOM instruction it becomes'
  }
  const flashOp = () => { recEl.classList.remove('flash'); void recEl.offsetWidth; recEl.classList.add('flash') }
  const flashDomRow = rec => {
    if (!rec || rec.rid == null) return
    const row = listEl.querySelector(`.dl-row[data-id="${rec.rid}"]`); if (!row) return
    const t = rec.field === 'value' ? row.querySelector('.dl-val') : row
    if (t) { t.classList.remove('fresh'); void t.offsetWidth; t.classList.add('fresh') }
  }
  // insert / update-a-field / remove → the shared model's verbs (bump = a field update).
  const act = name => () => { const recs = appendRecord(name); flashOp(); flashDomRow(recs && recs[recs.length - 1]) }
  document.getElementById('dom-insert').addEventListener('click', act('insert'))
  document.getElementById('dom-update').addEventListener('click', act('bump'))
  document.getElementById('dom-remove').addEventListener('click', act('remove'))

  figureUpdaters.push(updateDomOp)
  updateDomOp()
}

/* ====================================================================== *
 * spotlight the fold a section is about + label the pinned timeline, as
 * each section scrolls into view.
 * ====================================================================== */
function mountSpotlights () {
  // section id -> { fold to spotlight, pin label }
  const map = {
    'view-fold':    { fold: 'active',    label: 'a view is a derivation' },
    'cost':         { fold: null,        label: 'cost of a change' },
    'selectivity':  { fold: null,        label: 'selectivity' },
    'composition':  { fold: 'perRegion', label: 'derivations compose' },
    'determinism':  { fold: null,        label: 'no deltas by hand' },
    'dom-fold':     { fold: 'orders',    label: 'the DOM' },
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

/* ---- boot ---- *
 * Mount every figure first so each registers its updater, then build the
 * records and run ONE syncHead — which drives §1 and every registered figure
 * from the shared playhead. From here, any scrub or button calls syncHead and
 * the whole page re-reads itself from the head. */
mountFolds()
mountCost()
mountEdge()
mountDomFold()
mountSpotlights()
buildRecords()
syncHead()
