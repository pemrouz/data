/* A pivot table on `data`.
 *
 * Pick a row dimension, a column dimension, a measure and an aggregation; every
 * cell is one group's rolled-up value. The library computes the whole grid with
 * a single incremental `reduce`:
 *
 *   data.reduce(add, remove, () => ({}))
 *     add(acc, row)    → acc[rowVal‖colVal].{sum += measure; n++}
 *     remove(acc, row) → the exact inverse
 *
 * so a streamed insert/evict moves O(1) cells — the {sum,n} per group is
 * maintained in place, never rebuilt by rescanning 50k rows. Sum / avg / count
 * and the row / column / grand totals all read off that one accumulator.
 *
 * Changing a dimension or the measure recompiles the key function (a one-pass
 * O(n) rebuild, ~ms); the stream then keeps it incrementally. Cell values are
 * painted once per frame from the maintained accumulator (the settle-once-per-
 * frame cadence the race + metrics boards use).
 *
 * Hand-written `.js`, no `.ts` sibling (see CLAUDE.md). */

if (location.search.includes('devtools')) await import('data/devtools')
import { $, value, render, HTML } from 'data/full'

const { div, span, select, option, button, table, thead, tbody, tfoot, tr, th, td } = HTML

const N = 50_000
const SEP = ''
const DIMS = {
  region: ['N. America', 'EMEA', 'APAC', 'LATAM', 'MEA'],
  category: ['Hardware', 'Software', 'Services', 'Cloud', 'Support'],
  channel: ['Direct', 'Partner', 'Online'],
  quarter: ['Q1', 'Q2', 'Q3', 'Q4']
}
const DIM_KEYS = Object.keys(DIMS)
const MEASURES = { revenue: { label: 'revenue', money: true }, units: { label: 'units', money: false } }

function lcg (seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x1_0000_0000 } }
const r = lcg(5)
const pick = arr => arr[(r() * arr.length) | 0]
function makeRec () {
  const category = pick(DIMS.category)
  const base = { Hardware: 4200, Software: 2600, Services: 1800, Cloud: 3100, Support: 900 }[category]
  const units = 1 + ((r() * 40) | 0)
  return { region: pick(DIMS.region), category, channel: pick(DIMS.channel), quarter: pick(DIMS.quarter), revenue: Math.round(base * (0.4 + r() * 1.2) * units / 10), units }
}

/* ---------------- state + the library's incremental pivot ---------------- */
let rowDim = 'region', colDim = 'quarter', measure = 'revenue', aggMode = 'sum'
const recs = new Array(N)
for (let i = 0; i < N; i++) recs[i] = makeRec()
const data = $(recs)

let pivot = null
function makePivot () {
  const rd = rowDim, cd = colDim, m = measure // capture
  pivot = data.reduce(
    (acc, d) => { const k = d[rd] + SEP + d[cd]; const c = acc[k] || (acc[k] = { s: 0, n: 0 }); c.s += d[m]; c.n++; return acc },
    (acc, d) => { const k = d[rd] + SEP + d[cd]; const c = acc[k]; if (c) { c.s -= d[m]; c.n-- } return acc },
    () => ({})
  )
  void pivot[value] // force the initial fold
}
makePivot()

/* ---------------- view ---------------- */
const dimSelect = (cur, on) => select.psel.on('change', e => on(e.target.value)).nodes(...DIM_KEYS.map(k => { const o = option.attr('value', k)(k); if (k === cur) o['selected=']; return o }))

render(document.body, div.pvapp(
  div.pvbar(
    span.pvbrand('▦  pivot'),
    span.pvctrl('rows ', dimSelect(rowDim, v => { rowDim = v; rebuild() })),
    span.pvctrl('cols ', dimSelect(colDim, v => { colDim = v; rebuild() })),
    span.pvctrl('measure ', select.psel.on('change', e => { measure = e.target.value; rebuild() }).nodes(...Object.keys(MEASURES).map(k => { const o = option.attr('value', k)(MEASURES[k].label); if (k === measure) o['selected=']; return o }))),
    span.pvctrl('agg ', select.psel.on('change', e => { aggMode = e.target.value; paint() }).nodes(...['sum', 'avg', 'count'].map(k => { const o = option.attr('value', k)(k); if (k === aggMode) o['selected=']; return o }))),
    button.pvstream.on('click', toggleStream),
    span.pvn(span.pvnv('—'), ' rows')
  ),
  div.pvwrap.attr('id', 'pvwrap')
))

const wrap = document.querySelector('#pvwrap')
const nv = document.querySelector('.pvnv')
const streamBtn = document.querySelector('.pvstream')

let rowKeys = [], colKeys = []
function buildTable () {
  rowKeys = DIMS[rowDim]; colKeys = DIMS[colDim]
  const head = tr(th.corner(rowDim + ' ╲ ' + colDim), ...colKeys.map(c => th.ch(c)), th.tot('Σ'))
  const body = rowKeys.map(rk => tr.prow(
    th.rh(rk),
    ...colKeys.map(ck => td.pcell.attr('data-c', rk + SEP + ck)('·')),
    td.prtot.attr('data-rt', rk)('·')
  ))
  const foot = tr.pfoot(th.rh('Σ'), ...colKeys.map(ck => td.pctot.attr('data-ct', ck)('·')), td.pgrand.attr('data-grand', '')('·'))
  // render() mounts the template's CHILDREN into the target and appends on each
  // call, so clear the wrap before re-rendering on a dimension change; the table
  // must be a child of the wrapper (not the top-level template) to stay a real
  // <table>.
  wrap.replaceChildren()
  render(wrap, div.pvinner(table.ptable(thead(head), tbody(...body), tfoot(foot))))
  paint()
}

const cellEl = sel => wrap.querySelector(sel)
const fmtVal = v => {
  const money = MEASURES[measure].money && aggMode !== 'count'
  const a = Math.abs(v)
  let s = a >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : (aggMode === 'avg' ? v.toFixed(1) : '' + Math.round(v))
  return money ? '$' + s : s
}
const heat = t => `rgba(255,94,58,${(0.06 + 0.5 * Math.max(0, Math.min(1, t))).toFixed(3)})`

function aggregate (c) { if (!c || !c.n) return null; return aggMode === 'count' ? c.n : aggMode === 'avg' ? c.s / c.n : c.s }
function combine (cells) { let s = 0, n = 0; for (const c of cells) if (c) { s += c.s; n += c.n }; return n ? (aggMode === 'count' ? n : aggMode === 'avg' ? s / n : s) : null }

function paint () {
  const o = pivot[value] || {}
  let total = 0
  let max = 0
  for (const rk of rowKeys) for (const ck of colKeys) { const v = aggregate(o[rk + SEP + ck]); if (v != null && v > max) max = v }
  for (const rk of rowKeys) {
    const rowCells = []
    for (const ck of colKeys) {
      const c = o[rk + SEP + ck], v = aggregate(c); rowCells.push(c)
      const el = cellEl(`[data-c="${rk}${SEP}${ck}"]`)
      el.textContent = v == null ? '·' : fmtVal(v)
      el.style.background = v == null ? '' : heat(max ? v / max : 0)
    }
    const rt = cellEl(`[data-rt="${rk}"]`); const rv = combine(rowCells); rt.textContent = rv == null ? '·' : fmtVal(rv)
  }
  for (const ck of colKeys) {
    const colCells = rowKeys.map(rk => o[rk + SEP + ck])
    const ct = cellEl(`[data-ct="${ck}"]`); const cv = combine(colCells); ct.textContent = cv == null ? '·' : fmtVal(cv)
  }
  const all = []; for (const k in o) all.push(o[k])
  cellEl('[data-grand]').textContent = fmtVal(combine(all) ?? 0)
  nv.textContent = liveCount.toLocaleString()
}

function rebuild () { makePivot(); buildTable() }

/* ---------------- stream (insert + evict, O(Δ)) ---------------- */
let head = 0, liveCount = N, streaming = false, raf = 0
function streamFrame () {
  if (!streaming) return
  for (let i = 0; i < 1500; i++) { data.insert(makeRec()); delete data[head]; head++ }
  paint()
  raf = requestAnimationFrame(streamFrame)
}
function toggleStream () {
  streaming = !streaming
  streamBtn.textContent = streaming ? '⏸ streaming' : '▶ stream'
  streamBtn.classList.toggle('on', streaming)
  if (streaming) raf = requestAnimationFrame(streamFrame); else cancelAnimationFrame(raf)
}

streamBtn.textContent = '▶ stream'
buildTable()
Object.assign(window, { pivot: () => pivot, data, value })
