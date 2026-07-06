// Pivot, on the v3 engine — every cell is a STANDING reactive aggregate.
//
// One source: `sales = $({})` keyed by sale id. The grid is a set of standing
// scalars, all derived from that one source:
//
//   cell   = sales.filter(s => s.region === rv && s.category === cv).sum('revenue')
//   rowTot = sales.filter(s => s.region === rv).sum('revenue')
//   colTot = sales.filter(s => s.category === cv).sum('revenue')
//   grand  = sales.sum('revenue')
//
// DESIGN NOTE (the v3 pivot idiom): v2 built cells by chaining aggregates off
// nested group() buckets — `rows[rv].group(colField)[cv].sum(measure)`. In v3
// a bucket/row child of a view is a PATH ADDRESS, not a view: you cannot
// chain `.sum()` off `group()` children. Per-cell FILTERS are the idiom
// instead — one small standing filter→aggregate chain per cell. Every cell,
// every total, and the grand total is its own scalar off the SAME source, so
// they reconcile by construction: one write settles them all in one commit.
//
// The grid STRUCTURE (which fields, which measure) is config, so a selector
// change disposes every cell view and rebuilds. Within a configuration the
// grid never rebuilds: +100 sales / stream are ONE `sales.patch([[id, row]…])`
// batch each, and shuffle is a batch of in-place `sale.set('region', …)`
// writes — only the affected cells' scalars re-emit, and only their text
// bindings touch the DOM.

import { $, value, render, text, bind, batch, HTML } from 'data/v3'

const { div, section, header, span, button, select, option, label, h1, h2 } = HTML

// ── synthetic sales ──────────────────────────────────────────────────────────
const REGIONS = ['North', 'South', 'East', 'West']
const CATS = ['Hardware', 'Software', 'Services', 'Cloud']
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4']
const REPS = ['Ada', 'Boyd', 'Cleo', 'Dane', 'Eve', 'Finn', 'Gwen', 'Hugo']

let seed = 1234567
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
const pick = a => a[(rnd() * a.length) | 0]

let nextId = 1
const newSale = () => ({
  region: pick(REGIONS), category: pick(CATS), quarter: pick(QUARTERS), rep: pick(REPS),
  units: 1 + ((rnd() * 40) | 0),
  revenue: 200 + Math.round(rnd() * rnd() * 9800),
})

const seedRows = {}
for (let i = 0; i < 2000; i++) seedRows['s' + nextId++] = newSale()
const sales = $(seedRows)

// ── pivot configuration (plain state; domains are static config, not derived) ─
const ROW_FIELDS = ['region', 'category', 'rep', 'quarter']
const COL_FIELDS = ['none', 'region', 'category', 'quarter']
const DOMAINS = { region: REGIONS, category: CATS, quarter: QUARTERS, rep: REPS }

// Empty-slice scalar semantics (v3): sum → 0, length → 0, avg/max → undefined.
// The formatters lean on that: fmtMoney renders undefined as '—'.
const MEASURES = {
  count:   { label: 'Count',        of: v => v.length(),       fmt: n => `${n ?? 0}` },
  revenue: { label: 'Σ Revenue',    of: v => v.sum('revenue'), fmt: fmtMoney },
  avg:     { label: 'Avg Revenue',  of: v => v.avg('revenue'), fmt: fmtMoney },
  units:   { label: 'Σ Units',      of: v => v.sum('units'),   fmt: n => `${n ?? 0}` },
  max:     { label: 'Max Revenue',  of: v => v.max('revenue'), fmt: fmtMoney },
}
const cfg = { rowField: 'region', colField: 'category', measure: 'revenue' }

function fmtMoney(n) {
  if (n == null) return '—'
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'k'
  return '$' + Math.round(n)
}

// measure(view) → a standing scalar for the active measure over `view`
const measure = v => MEASURES[cfg.measure].of(v)
const fmt = n => MEASURES[cfg.measure].fmt(n)

// ── transient views: the dispose idiom at scale ──────────────────────────────
//
// Every cell/total chain minted for the CURRENT configuration is held here and
// dispose()d on config change — the chat-v3 transient-filter lesson, scaled to
// a whole grid. filter() is fresh per call (opaque closures never dedup), so
// without dispose each rebuild would leave a dead grid of operators attached
// to `sales`, and every later write would pay for all of them.
//
// Deliberately NOT tracked: aggregates minted directly off the source
// (`measure(sales)`, the header metrics). Those dedup by value identity —
// `sales.sum('revenue')` returns the SAME standing node every time — so
// rebuilds reuse them for free, and disposing one would leave the dedup cache
// handing out a dead node.
let transients = []
const track = view => { transients.push(view); return view }

// One cell = one standing filter → aggregate chain over the source.
const cellOf = pred => track(measure(track(sales.filter(pred))))

// ── grid construction (re-run on config change) ──────────────────────────────
function buildGrid() {
  const { rowField, colField } = cfg
  const rowVals = DOMAINS[rowField]
  const grand = measure(sales) // deduped standing scalar — survives rebuilds

  if (colField === 'none') {
    // 1-D: row label + measure + share-of-total bar
    return div.ptable.oneD(
      div.prow.phead(
        div.pcell.rowhead(rowField),
        div.pcell.meashead(MEASURES[cfg.measure].label),
        div.pcell.barhead(),
      ),
      div.pbody(
        ...rowVals.map(rv => {
          const m = cellOf(s => s[rowField] === rv)
          return div.prow(
            div.pcell.rowkey(rv),
            div.pcell.num(text(m, fmt)),
            div.pcell.bar(
              // The width recomputes on this row's scalar; the grand total is
              // read fresh at that moment (all scalars settle in the same
              // commit before any binding runs) — v2-parity behaviour.
              div.barfill({ style: bind(m, v => `width:${pct(v, grand[value])}%`) }),
            ),
          )
        }),
      ),
      div.prow.pfoot(
        div.pcell.rowkey('Total'),
        div.pcell.num(text(grand, fmt)),
        div.pcell.bar(),
      ),
    )
  }

  // 2-D: row label + one cell per column value + row total
  const colVals = DOMAINS[colField]
  const gridCols = `minmax(90px,1.2fr) repeat(${colVals.length}, minmax(70px,1fr)) minmax(80px,1fr)`

  return div.ptable.twoD({ style: `grid-template-columns:${gridCols}` },
    // header
    div.pcell.corner(`${rowField} ╲ ${colField}`),
    ...colVals.map(cv => div.pcell.colhead(cv)),
    div.pcell.colhead.total('Total'),
    // body — each row is a display:contents wrapper contributing
    // (1 + colVals + 1) cells into the grid
    ...rowVals.map(rv => div.contents(
      div.pcell.rowkey(rv),
      ...colVals.map(cv => {
        const m = cellOf(s => s[rowField] === rv && s[colField] === cv)
        return div.pcell.num(
          { class: bind(m, v => v == null || v === 0 ? 'zero' : '') },
          text(m, fmt),
        )
      }),
      div.pcell.num.rowtotal(text(cellOf(s => s[rowField] === rv), fmt)),
    )),
    // footer — column grand totals
    div.pcell.rowkey.foot('Total'),
    ...colVals.map(cv => div.pcell.num.foot(text(cellOf(s => s[colField] === cv), fmt))),
    div.pcell.num.foot.grand(text(grand, fmt)),
  )
}

const pct = (v, total) => (total ? Math.max(0, Math.min(100, Math.round(100 * (v || 0) / total))) : 0)

// ── mount + rebuild on config change ─────────────────────────────────────────
let gridHandle = null // RenderHandle for the current grid mount

function disposeGrid() {
  // Teardown order: the render handle first (detaches every text/bind
  // subscription from the scalars), then every transient view, aggregates
  // before the filters they chain off (transients is pushed filter-then-
  // aggregate, so walk it in reverse).
  if (gridHandle) gridHandle.dispose()
  gridHandle = null
  for (let i = transients.length - 1; i >= 0; i--) transients[i].dispose()
  transients = []
}

function rebuild() {
  disposeGrid()
  const host = document.querySelector('#grid')
  const fresh = document.createElement('div')
  fresh.className = 'grid-inner'
  host.replaceChildren(fresh)
  gridHandle = render(fresh, buildGrid())
}

// ── controls ─────────────────────────────────────────────────────────────────
const fieldSelect = (id, fields, current, onPick) =>
  select({ id, onChange: ev => { onPick(ev.target.value); rebuild() } },
    ...fields.map(f =>
      option({ value: f, selected: f === current }, f === 'none' ? '— none —' : f)))

const measureSelect = () =>
  select({ id: 'measure', onChange: ev => { cfg.measure = ev.target.value; rebuild() } },
    ...Object.entries(MEASURES).map(([k, m]) =>
      option({ value: k, selected: k === cfg.measure }, m.label)))

// ── live data ops ────────────────────────────────────────────────────────────

// Keyed inserts as ONE patch batch — pairs are [key, row] TUPLES in v3. One
// commit, one settle per cell scalar, one DOM write per changed binding.
const addSales = n => () => {
  const pairs = []
  for (let i = 0; i < n; i++) pairs.push(['s' + nextId++, newSale()])
  sales.patch(pairs)
}

// Shuffle: move a sample of sales to a fresh random region IN PLACE — a
// path-addressed `sale.set('region', …)` per pick, grouped by batch() into a
// single commit. Each edit leaves one row-slice filter and enters another;
// the row totals re-balance while the column totals and the grand total stay
// put (revenue is conserved). No-op writes (same region) are dropped by the
// source, so re-picking a row's current region costs nothing.
const shuffleRegions = () => {
  const ids = Object.keys(sales[value])
  batch(() => {
    for (let i = 0; i < 200 && ids.length; i++) {
      const id = ids[(rnd() * ids.length) | 0]
      sales.get(id).set('region', pick(REGIONS))
    }
  })
}

let streamTimer = null
const toggleStream = ev => {
  if (streamTimer) { clearInterval(streamTimer); streamTimer = null; ev.target.textContent = '▶ stream' }
  else { streamTimer = setInterval(addSales(8), 250); ev.target.textContent = '⏸ stream' }
}

// ── header metrics (permanent, deduped source-level aggregates) ──────────────
const totalSales = sales.length()
const totalRevenue = sales.sum('revenue')

render(document.body, [
  header.topbar(
    div.brand(h1('pivot'), h2('every cell is a reactive aggregate')),
    div.spacer(),
    div.metrics(
      span.metric(span.mlabel('rows '), span.mval(text(totalSales, n => n.toLocaleString()))),
      span.metric(span.mlabel('Σ revenue '), span.mval(text(totalRevenue, fmtMoney))),
    ),
  ),
  section.controls(
    label('rows'), fieldSelect('rowField', ROW_FIELDS, cfg.rowField, v => cfg.rowField = v),
    label('columns'), fieldSelect('colField', COL_FIELDS, cfg.colField, v => cfg.colField = v),
    label('measure'), measureSelect(),
    div.spacer(),
    button.ctl['#add100']({ onClick: addSales(100) }, '+100 sales'),
    button.ctl['#shuffle']({ onClick: shuffleRegions }, 'shuffle regions'),
    button.ctl.stream['#stream']({ onClick: toggleStream }, '▶ stream'),
  ),
  section.gridwrap(div['#grid']()),
])

rebuild()

// debug / test hooks
window.__pivot = { sales, value }
