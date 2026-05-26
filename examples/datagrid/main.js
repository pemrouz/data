/* A million-row data grid on `data`.
 *
 * Two jobs split by what each tool is good at:
 *   • plain JS owns filter / sort / virtualization — a linear scan and an index
 *     sort over 1,000,000 rows are tens of ms, fast enough to feel instant, and
 *     virtualization is inherently imperative (you only ever build ~40 DOM rows).
 *   • the library owns the two reactive things: it binds the visible window
 *     ($(windowRows) → render) so scrolling surgically rewrites only the cells
 *     whose value changed, and it maintains GLOBAL aggregates (Σ value, avg
 *     price, gainers) that update O(Δ) per tick when the "stream" is on — a
 *     million rows mutating and the footer never re-scans the dataset.
 *
 * That's the honest picture: data isn't a virtual-scroller, it's the
 * incremental-compute layer underneath one.
 *
 * Hand-written `.js`, no `.ts` sibling (see CLAUDE.md). */

if (location.search.includes('devtools')) await import('data/devtools')
import { $, value, render, HTML } from 'data/full'

const { div, span, input, select, option, button } = HTML

const N = 1_000_000
const ROWH = 24
const SECTORS = ['Tech', 'Energy', 'Health', 'Finance', 'Retail', 'Auto', 'Media', 'Mining']
const COLS = [
  { k: 'id', label: '#', cls: 'cidx', num: true },
  { k: 'name', label: 'instrument', cls: 'cname' },
  { k: 'sector', label: 'sector', cls: 'csec' },
  { k: 'price', label: 'price', cls: 'cnum', num: true, fmt: v => '$' + v.toFixed(2) },
  { k: 'qty', label: 'qty', cls: 'cnum', num: true, fmt: v => v.toLocaleString() },
  { k: 'value', label: 'value', cls: 'cnum', num: true, fmt: v => fmtMoney(v) },
  { k: 'chg', label: 'chg %', cls: 'cchg', num: true }
]

function lcg (seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x1_0000_0000 } }
function fmtMoney (v) {
  const a = Math.abs(v)
  if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B'
  if (a >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M'
  if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'k'
  return '$' + v.toFixed(0)
}

/* ---------------- splash (paint before the 1M-row build blocks the thread) ---------------- */
document.body.innerHTML = '<div class="dgsplash">building <b>1,000,000</b> rows…</div>'
await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))

/* ---------------- generate ---------------- */
const A = 'AEIOU', B = 'BCDFGHJKLMNPRSTVWXYZ'
function ticker (r) { return B[(r() * 20) | 0] + A[(r() * 5) | 0] + B[(r() * 20) | 0] + (r() < 0.5 ? B[(r() * 20) | 0] : '') }
const rows = new Array(N)
{
  const r = lcg(99)
  for (let i = 0; i < N; i++) {
    const price = Math.round((2 + r() * 800) * 100) / 100
    const qty = 1 + ((r() * 9999) | 0)
    rows[i] = { id: i + 1, name: ticker(r), sector: SECTORS[(r() * SECTORS.length) | 0], price, qty, value: Math.round(price * qty), chg: Math.round((r() * 20 - 10) * 100) / 100 }
  }
}

/* ---------------- the library's slice: aggregates + window ---------------- */
const data = $(rows)
const total = data.sum('value')         // Σ market value  — O(1) per tick
const avgPrice = data.avg('price')      // avg price        — O(1) per tick
const gainers = data.length(d => d.chg >= 0 ? 'up' : 'down') // bucketed count — O(1) per tick
const windowRows = $([])                // the ~40 visible rows, surgically bound

/* ---------------- view: filter + sort (plain JS, interactive) ---------------- */
const flt = { q: '', sector: '', minVal: 0 }
let sortKey = 'value', sortDir = -1
let viewIdx = new Int32Array(0)

function rebuildView () {
  const q = flt.q.trim().toUpperCase()
  const out = []
  for (let i = 0; i < N; i++) {
    const row = rows[i]
    if (flt.sector && row.sector !== flt.sector) continue
    if (flt.minVal && row.value < flt.minVal) continue
    if (q && !row.name.includes(q)) continue
    out.push(i)
  }
  out.sort((a, b) => { const x = rows[a][sortKey], y = rows[b][sortKey]; return (x < y ? -1 : x > y ? 1 : 0) * sortDir })
  viewIdx = Int32Array.from(out)
  canvas.style.height = (viewIdx.length * ROWH) + 'px'
  shownEl.textContent = viewIdx.length.toLocaleString()
  paintWindow(true)
  syncHeaders()
}

/* ---------------- virtualization ---------------- */
let lastStart = -1
function paintWindow (force) {
  const vh = viewport.clientHeight || 600
  const vis = Math.ceil(vh / ROWH) + 6
  let start = Math.max(0, Math.floor(viewport.scrollTop / ROWH) - 2)
  if (start > viewIdx.length - 1) start = Math.max(0, viewIdx.length - 1)
  if (!force && start === lastStart) return
  lastStart = start
  const end = Math.min(viewIdx.length, start + vis)
  const slice = new Array(end - start)
  for (let i = start; i < end; i++) slice[i - start] = rows[viewIdx[i]]
  rowsEl.style.transform = `translateY(${start * ROWH}px)`
  windowRows[value] = slice
}

/* ---------------- DOM ---------------- */
function rowNode (node, row) {
  return node
    .class('up', row.chg.to(c => c >= 0))
    .class('down', row.chg.to(c => c < 0))
    .nodes(...COLS.map(col => {
      const cell = div[col.cls]
      if (col.k === 'chg') return cell.text(row.chg.to(c => (c >= 0 ? '+' : '') + c.toFixed(2) + '%'))
      return cell.text(col.fmt ? row[col.k].to(col.fmt) : row[col.k])
    }))
}

document.querySelector('.dgsplash')?.remove()
render(document.body, div.dgapp(
  div.dgbar(
    span.dgbrand('▦  1,000,000 rows'),
    input.dgsearch['placeholder=search instrument…'].on('input', e => { flt.q = e.target.value; rebuildView() }),
    select.dgsel.on('change', e => { flt.sector = e.target.value; rebuildView() }).nodes(
      option['value=']('all sectors'), ...SECTORS.map(s => option.attr('value', s)(s))
    ),
    span.dgminwrap('min value ', input.dgmin['type=number']['value=0'].on('input', e => { flt.minVal = +e.target.value || 0; rebuildView() })),
    button.dgstream.on('click', toggleStream),
    span.dgshown(span.dgshownv('—'), ' of 1,000,000')
  ),
  div.dghead.nodes(...COLS.map(c => div[c.cls].cell.attr('data-sort', c.k).on('click', () => setSort(c.k)).nodes(span.lab(c.label), span.arrow('')))),
  div.dgviewport.nodes(div.dgcanvas.nodes(div.dgrows.nodes(div(windowRows, rowNode)))),
  div.dgfoot(
    span.f('Σ value '), span.fv.text(total.to(fmtMoney)),
    span.f('   avg price '), span.fv.text(avgPrice.to(v => '$' + (v || 0).toFixed(2))),
    span.f('   gainers '), span.fv.text(gainers.to(g => ((g && g.up && g.up.value) || 0).toLocaleString()))
  )
))

const viewport = document.querySelector('.dgviewport')
const canvas = document.querySelector('.dgcanvas')
const rowsEl = document.querySelector('.dgrows')
const shownEl = document.querySelector('.dgshownv')
const streamBtn = document.querySelector('.dgstream')
const headCells = [...document.querySelectorAll('.dghead [data-sort]')]

let scheduled = false
viewport.addEventListener('scroll', () => { if (scheduled) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; paintWindow() }) })

function setSort (k) { if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = k === 'name' || k === 'sector' ? 1 : -1 }; viewport.scrollTop = 0; rebuildView() }
function syncHeaders () { for (const el of headCells) { const k = el.getAttribute('data-sort'); el.querySelector('.arrow').textContent = k === sortKey ? (sortDir < 0 ? ' ▾' : ' ▴') : '' } }

/* ---------------- streaming (shows the incremental aggregates) ---------------- */
const sr = lcg(7)
let streaming = false, raf = 0
function streamFrame () {
  if (!streaming) return
  for (let k = 0; k < 4000; k++) {
    const i = (sr() * N) | 0, row = rows[i]
    const np = Math.round(Math.max(0.5, row.price * (1 + (sr() - 0.5) * 0.04)) * 100) / 100
    data[i].price = np
    data[i].value = Math.round(np * row.qty)
    data[i].chg = Math.round((row.chg + (sr() - 0.5) * 2) * 100) / 100
  }
  paintWindow(true) // re-slice so visible cells show the new values (order stays put)
  raf = requestAnimationFrame(streamFrame)
}
function toggleStream () {
  streaming = !streaming
  streamBtn.textContent = streaming ? '⏸ streaming' : '▶ stream'
  streamBtn.classList.toggle('on', streaming)
  if (streaming) raf = requestAnimationFrame(streamFrame); else cancelAnimationFrame(raf)
}

streamBtn.textContent = '▶ stream'
rebuildView()
window.addEventListener('resize', () => paintWindow(true))
Object.assign(window, { grid: { rows, data, total, viewIdx: () => viewIdx, rebuildView }, value })
