/* A million-row data grid, built on `data`.
 *
 * The work is split by what each tool is good at:
 *
 *   • plain JS owns filter / sort / virtualization. A linear scan and an index
 *     sort over 1,000,000 rows are tens of ms — instant enough — and a virtual
 *     scroller is imperative by nature: you only ever build ~40 DOM rows.
 *   • the library owns the two reactive things — see "the pipeline" below.
 *
 * So `data` here isn't the virtual scroller; it's the incremental-compute layer
 * underneath one: it binds the on-screen window and keeps the global aggregates. */

import { $, value, render, HTML } from 'data/full'

const { div, span, input, select, option, button } = HTML

/* ------------------------------- the domain ------------------------------ */

const N = 1_000_000
const ROW_HEIGHT = 24
const SECTORS = ['Tech', 'Energy', 'Health', 'Finance', 'Retail', 'Auto', 'Media', 'Mining']

// Column definitions drive both the header and each row's cells.
const COLUMNS = [
  { key: 'id', label: '#', css: 'cidx' },
  { key: 'name', label: 'instrument', css: 'cname' },
  { key: 'sector', label: 'sector', css: 'csec' },
  { key: 'price', label: 'price', css: 'cnum', format: v => '$' + v.toFixed(2) },
  { key: 'qty', label: 'qty', css: 'cnum', format: v => v.toLocaleString() },
  { key: 'value', label: 'value', css: 'cnum', format: money },
  { key: 'chg', label: 'chg %', css: 'cchg', format: v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%' }
]

const rng = (seed => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
function money (v) {
  const a = Math.abs(v)
  if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B'
  if (a >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M'
  if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'k'
  return '$' + v.toFixed(0)
}

// Paint a splash first — generating a million rows blocks the thread for ~2s.
document.body.innerHTML = '<div class="dgsplash">building <b>1,000,000</b> rows…</div>'
await new Promise(resume => requestAnimationFrame(() => setTimeout(resume, 0)))

const VOWELS = 'AEIOU', CONSONANTS = 'BCDFGHJKLMNPRSTVWXYZ'
const ticker = r => CONSONANTS[r() * 20 | 0] + VOWELS[r() * 5 | 0] + CONSONANTS[r() * 20 | 0] + (r() < 0.5 ? CONSONANTS[r() * 20 | 0] : '')

const rows = new Array(N)
{
  const r = rng(99)
  for (let i = 0; i < N; i++) {
    const price = Math.round((2 + r() * 800) * 100) / 100
    const qty = 1 + (r() * 9999 | 0)
    rows[i] = {
      id: i + 1,
      name: ticker(r),
      sector: SECTORS[r() * SECTORS.length | 0],
      price,
      qty,
      value: Math.round(price * qty),
      chg: Math.round((r() * 20 - 10) * 100) / 100
    }
  }
}

/* ================================ the pipeline =========================== */
//
//   data ──┬─ sum('value')                  → total      Σ market value
//  ($(rows) ├─ avg('price')                  → avgPrice
//   1M rows)└─ length(d => up? 'up':'down')  → gainers
//
//   data ─────────────────────────────────▶ windowRows   the ~40 on-screen rows
//
// Aggregates update O(1) per changed row, so the streaming footer never rescans
// the million; `windowRows` is bound by `render`, so scrolling rewrites only the
// cells whose value changed.

const data = $(rows)
const total = data.sum('value')
const avgPrice = data.avg('price')
const gainers = data.length(d => d.chg >= 0 ? 'up' : 'down')
const windowRows = $([])

const gainerCount = g => (g && g.up && g.up.value) || 0

/* --------------------- filter + sort (plain JS, interactive) ------------- */

const filters = { query: '', sector: '', minValue: 0 }
let sortKey = 'value', sortDir = -1 // -1 descending
let view = new Int32Array(0)        // row indices, filtered + sorted

function rebuildView () {
  const query = filters.query.trim().toUpperCase()
  const matched = []
  for (let i = 0; i < N; i++) {
    const row = rows[i]
    if (filters.sector && row.sector !== filters.sector) continue
    if (filters.minValue && row.value < filters.minValue) continue
    if (query && !row.name.includes(query)) continue
    matched.push(i)
  }
  matched.sort((a, b) => cmp(rows[a][sortKey], rows[b][sortKey]) * sortDir)

  view = Int32Array.from(matched)
  canvas.style.height = view.length * ROW_HEIGHT + 'px'
  shownEl.textContent = view.length.toLocaleString()
  syncHeaders()
  showWindow(true)
}
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0

/* ----------------------------- virtualization ---------------------------- */
// Slice the current view to whatever rows the scroll position exposes, hand
// those ~40 rows to `windowRows`, and offset the row container. The library
// diffs the slice and updates only the cells that changed.

let windowStart = -1
function showWindow (force) {
  const visible = Math.ceil((viewport.clientHeight || 600) / ROW_HEIGHT) + 6
  const start = Math.min(Math.max(0, Math.floor(viewport.scrollTop / ROW_HEIGHT) - 2), Math.max(0, view.length - 1))
  if (!force && start === windowStart) return
  windowStart = start

  const end = Math.min(view.length, start + visible)
  const slice = []
  for (let i = start; i < end; i++) slice.push(rows[view[i]])
  rowsEl.style.transform = `translateY(${start * ROW_HEIGHT}px)`
  windowRows[value] = slice
}

/* --------------------------------- the view ------------------------------ */

const cell = (column, row) => {
  const node = div[column.css]
  return column.format ? node.text(row[column.key].to(column.format)) : node.text(row[column.key])
}

const rowView = (node, row) => node
  .class('up', row.chg.to(c => c >= 0))
  .class('down', row.chg.to(c => c < 0))
  .nodes(...COLUMNS.map(column => cell(column, row)))

document.querySelector('.dgsplash')?.remove()
render(document.body, div.dgapp(
  div.dgbar(
    span.dgbrand('▦  1,000,000 rows'),
    input.dgsearch['placeholder=search instrument…'].on('input', e => { filters.query = e.target.value; rebuildView() }),
    select.dgsel.on('change', e => { filters.sector = e.target.value; rebuildView() }).nodes(
      option['value=']('all sectors'),
      ...SECTORS.map(s => option.attr('value', s)(s))
    ),
    span.dgminwrap('min value ',
      input.dgmin['type=number']['value=0'].on('input', e => { filters.minValue = +e.target.value || 0; rebuildView() })
    ),
    button.dgstream.on('click', toggleStream),
    span.dgshown(span.dgshownv('—'), ' of 1,000,000')
  ),

  div.dghead.nodes(...COLUMNS.map(column =>
    div[column.css].cell.attr('data-sort', column.key).on('click', () => sortBy(column.key)).nodes(
      span.lab(column.label),
      span.arrow('')
    )
  )),

  div.dgviewport(div.dgcanvas(div.dgrows(div(windowRows, rowView)))),

  div.dgfoot(
    span.f('Σ value '), span.fv.text(total.to(money)),
    span.f('   avg price '), span.fv.text(avgPrice.to(v => '$' + (v || 0).toFixed(2))),
    span.f('   gainers '), span.fv.text(gainers.to(g => gainerCount(g).toLocaleString()))
  )
))

const viewport = document.querySelector('.dgviewport')
const canvas = document.querySelector('.dgcanvas')
const rowsEl = document.querySelector('.dgrows')
const shownEl = document.querySelector('.dgshownv')
const streamBtn = document.querySelector('.dgstream')
const headers = [...document.querySelectorAll('.dghead [data-sort]')]

let scrollQueued = false
viewport.addEventListener('scroll', () => {
  if (scrollQueued) return
  scrollQueued = true
  requestAnimationFrame(() => { scrollQueued = false; showWindow() })
})
addEventListener('resize', () => showWindow(true))

function sortBy (key) {
  if (sortKey === key) sortDir = -sortDir
  else { sortKey = key; sortDir = key === 'name' || key === 'sector' ? 1 : -1 }
  viewport.scrollTop = 0
  rebuildView()
}
function syncHeaders () {
  for (const el of headers) {
    const key = el.getAttribute('data-sort')
    el.querySelector('.arrow').textContent = key === sortKey ? (sortDir < 0 ? ' ▾' : ' ▴') : ''
  }
}

/* ------------------------------- the stream ------------------------------ */
// Mutate a few thousand random rows a frame; the aggregates above tick in O(Δ),
// and the visible window re-slices so its cells show the new prices. Sort order
// stays put (re-sorting a million rows every frame would be the wrong trade).

const noise = rng(7)
let streaming = false, frameId = 0
function streamFrame () {
  if (!streaming) return
  for (let k = 0; k < 4000; k++) {
    const i = noise() * N | 0
    const row = rows[i]
    const price = Math.round(Math.max(0.5, row.price * (1 + (noise() - 0.5) * 0.04)) * 100) / 100
    data[i].price = price
    data[i].value = Math.round(price * row.qty)
    data[i].chg = Math.round((row.chg + (noise() - 0.5) * 2) * 100) / 100
  }
  showWindow(true)
  frameId = requestAnimationFrame(streamFrame)
}
function toggleStream () {
  streaming = !streaming
  streamBtn.textContent = streaming ? '⏸ streaming' : '▶ stream'
  streamBtn.classList.toggle('on', streaming)
  if (streaming) frameId = requestAnimationFrame(streamFrame); else cancelAnimationFrame(frameId)
}

streamBtn.textContent = '▶ stream'
rebuildView()
