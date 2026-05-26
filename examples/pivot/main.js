/* A pivot table, built on `data`.
 *
 * The whole engine is one incremental fold:
 *
 *        data ── reduce(add, remove, () => ({})) ──▶ pivot
 *
 *   add(acc, row)    →  acc[rowKey ‖ colKey].{ sum += measure; n++ }
 *   remove(acc, row) →  the exact inverse
 *
 * So `pivot[value]` is a live map of { cellKey → {sum, n} }, and a streamed
 * insert/evict moves O(1) cells — never a rescan of the 50k rows. Every cell,
 * row total, column total and the grand total reads off that one accumulator.
 *
 * The DOM binds to a small `grid` presentation view, refreshed from `pivot`;
 * changing a dimension recompiles the key function and rebuilds the table. */

import { $, value, render, HTML } from 'data/full'

const { div, span, select, option, button, table, thead, tbody, tfoot, tr, th, td } = HTML

/* ------------------------------- the domain ------------------------------ */

const ROWS = 50_000
const SEP = '' // joins row+col into a cell key; control char never collides
const DIMENSIONS = {
  region: ['N. America', 'EMEA', 'APAC', 'LATAM', 'MEA'],
  category: ['Hardware', 'Software', 'Services', 'Cloud', 'Support'],
  channel: ['Direct', 'Partner', 'Online'],
  quarter: ['Q1', 'Q2', 'Q3', 'Q4']
}
const MEASURES = { revenue: { money: true }, units: { money: false } }
const AGGREGATIONS = ['sum', 'avg', 'count']

const rng = (seed => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)(5)
const pick = list => list[(rng() * list.length) | 0]
function makeRecord () {
  const category = pick(DIMENSIONS.category)
  const unitPrice = { Hardware: 4200, Software: 2600, Services: 1800, Cloud: 3100, Support: 900 }[category]
  const units = 1 + ((rng() * 40) | 0)
  return {
    region: pick(DIMENSIONS.region),
    category,
    channel: pick(DIMENSIONS.channel),
    quarter: pick(DIMENSIONS.quarter),
    units,
    revenue: Math.round(unitPrice * (0.4 + rng() * 1.2) * units / 10)
  }
}

/* ================================ the pipeline =========================== */

let rowDim = 'region', colDim = 'quarter', measure = 'revenue', aggregation = 'sum'
const cellKey = row => row[rowDim] + SEP + row[colDim]

const records = new Array(ROWS)
for (let i = 0; i < ROWS; i++) records[i] = makeRecord()
const data = $(records)

// `pivot[value]` is { cellKey → {sum, n} }, kept incrementally by one fold.
let pivot
function compilePivot () {
  pivot = data.reduce(
    (acc, row) => { const c = acc[cellKey(row)] ??= { sum: 0, n: 0 }; c.sum += row[measure]; c.n++; return acc },
    (acc, row) => { const c = acc[cellKey(row)]; if (c) { c.sum -= row[measure]; c.n-- } return acc },
    () => ({})
  )
  void pivot[value] // force the initial fold
}
compilePivot()

/* ---------------------------- the presentation view ---------------------- */

// One cell's value under the chosen aggregation (null = empty group).
const valueOf = c => !c || !c.n ? null : aggregation === 'count' ? c.n : aggregation === 'avg' ? c.sum / c.n : c.sum
// Combine a set of {sum,n} for row / column / grand totals.
const combine = cells => {
  let sum = 0, n = 0
  for (const c of cells) if (c) { sum += c.sum; n += c.n }
  return n ? valueOf({ sum, n }) : null
}

const format = v => {
  if (v == null) return '·'
  const money = MEASURES[measure].money && aggregation !== 'count'
  const a = Math.abs(v)
  const s = a >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (v / 1e6).toFixed(2) + 'M'
    : a >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : aggregation === 'avg' ? v.toFixed(1) : '' + Math.round(v)
  return money ? '$' + s : s
}
const heat = t => `rgba(255, 94, 58, ${(0.06 + 0.5 * Math.max(0, Math.min(1, t))).toFixed(3)})`

// `grid` mirrors the pivot in display-ready form; the DOM binds to it directly.
const grid = $({ cells: {}, rowTotals: {}, colTotals: {}, grand: '·' })

function refreshGrid () {
  const acc = pivot[value] || {}
  const rowKeys = DIMENSIONS[rowDim], colKeys = DIMENSIONS[colDim]
  const max = Math.max(1, ...rowKeys.flatMap(r => colKeys.map(c => valueOf(acc[r + SEP + c]) || 0)))

  const cells = {}
  for (const r of rowKeys) for (const c of colKeys) {
    const v = valueOf(acc[r + SEP + c])
    cells[r + SEP + c] = { text: format(v), heat: v == null ? 'transparent' : heat(v / max) }
  }
  const rowTotals = Object.fromEntries(rowKeys.map(r => [r, format(combine(colKeys.map(c => acc[r + SEP + c])))]))
  const colTotals = Object.fromEntries(colKeys.map(c => [c, format(combine(rowKeys.map(r => acc[r + SEP + c])))]))
  grid[value] = { cells, rowTotals, colTotals, grand: format(combine(Object.values(acc))) }
}

/* --------------------------------- the view ------------------------------ */

const dropdown = (options, current, onChange) => select.psel
  .on('change', e => onChange(e.target.value))
  .nodes(...options.map(o => { const opt = option.attr('value', o)(o); if (o === current) opt['selected=']; return opt }))

render(document.body, div.pvapp(
  div.pvbar(
    span.pvbrand('▦  pivot'),
    span.pvctrl('rows ', dropdown(Object.keys(DIMENSIONS), rowDim, v => { rowDim = v; rebuild() })),
    span.pvctrl('cols ', dropdown(Object.keys(DIMENSIONS), colDim, v => { colDim = v; rebuild() })),
    span.pvctrl('measure ', dropdown(Object.keys(MEASURES), measure, v => { measure = v; rebuild() })),
    span.pvctrl('agg ', dropdown(AGGREGATIONS, aggregation, v => { aggregation = v; refreshGrid() })),
    button.pvstream.on('click', toggleStream),
    span.pvn(ROWS.toLocaleString(), ' rows')
  ),
  div.pvtable.attr('id', 'pvtable')
))

const tableHost = document.querySelector('#pvtable')

// Rebuilt only when a dimension changes (the cell set changes shape). Cells bind
// to `grid`, so streaming updates flow in reactively without re-rendering.
function buildTable () {
  const rowKeys = DIMENSIONS[rowDim], colKeys = DIMENSIONS[colDim]
  tableHost.replaceChildren() // render() appends, so clear before re-rendering

  render(tableHost, div.pvinner(table.ptable(
    thead(tr(
      th.corner(rowDim + ' ╲ ' + colDim),
      ...colKeys.map(c => th.ch(c)),
      th.tot('Σ')
    )),
    tbody(...rowKeys.map(r => tr.prow(
      th.rh(r),
      ...colKeys.map(c => td.pcell.text(grid.cells[r + SEP + c].text).style('background', grid.cells[r + SEP + c].heat)),
      td.prtot.text(grid.rowTotals[r])
    ))),
    tfoot(tr.pfoot(
      th.rh('Σ'),
      ...colKeys.map(c => td.pctot.text(grid.colTotals[c])),
      td.pgrand.text(grid.grand)
    ))
  )))
}

function rebuild () { compilePivot(); refreshGrid(); buildTable() }

/* ------------------------------- the stream ------------------------------ */
// Insert a fresh record and evict the oldest, so the dataset stays ~50k rows and
// the fold updates O(Δ). `grid` is refreshed once per frame; the bound cells
// follow.

let oldest = 0, streaming = false, frameId = 0
function streamFrame () {
  if (!streaming) return
  for (let i = 0; i < 1500; i++) { data.insert(makeRecord()); delete data[oldest]; oldest++ }
  refreshGrid()
  frameId = requestAnimationFrame(streamFrame)
}
function toggleStream () {
  streaming = !streaming
  streamBtn.textContent = streaming ? '⏸ streaming' : '▶ stream'
  streamBtn.classList.toggle('on', streaming)
  if (streaming) frameId = requestAnimationFrame(streamFrame); else cancelAnimationFrame(frameId)
}

const streamBtn = document.querySelector('.pvstream')
streamBtn.textContent = '▶ stream'
refreshGrid()
buildTable()
