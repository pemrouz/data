// Pivot — a live pivot table where every cell is a reactive aggregate.
//
// One source: `sales = $({})` keyed by sale id. The grid is a *derivation*:
//
//   rows = sales.group(d => d[rowField])            // one bucket per row value
//   cell = rows[rowVal].sum(measure)                // 1-D: aggregate the bucket
//   cell = rows[rowVal].group(colField)[colVal]     // 2-D: nested group …
//              .sum(measure)                         //      … then aggregate
//
// The grid STRUCTURE (which fields, which measure) is config, so we re-render
// it when you change a selector. But within a configuration every cell is a
// standing reactive view — streaming new sales, or shuffling sales between
// regions (an in-place `sale.region = …` edit), updates the affected cells
// surgically, with no rebuild. The shuffle is the `group`-rebuckets-on-`BU2`
// path: a sale changing region leaves one row bucket and joins another, and
// the row/column/grand totals all follow.

import { $, value, render, HTML } from 'data'

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
const sales = window.sales = $(seedRows)
window.value = value

// ── pivot configuration (plain state) ────────────────────────────────────────
const ROW_FIELDS = ['region', 'category', 'rep', 'quarter']
const COL_FIELDS = ['none', 'region', 'category', 'quarter']
const DOMAINS = { region: REGIONS, category: CATS, quarter: QUARTERS, rep: REPS }
const MEASURES = {
  count:   { label: 'Count',        fn: v => v.length(),       fmt: n => `${n ?? 0}` },
  revenue: { label: 'Σ Revenue',    fn: v => v.sum('revenue'), fmt: fmtMoney },
  avg:     { label: 'Avg Revenue',  fn: v => v.avg('revenue'), fmt: fmtMoney },
  units:   { label: 'Σ Units',      fn: v => v.sum('units'),   fmt: n => `${n ?? 0}` },
  max:     { label: 'Max Revenue',  fn: v => v.max('revenue'), fmt: fmtMoney },
}
const cfg = { rowField: 'region', colField: 'category', measure: 'revenue' }

function fmtMoney(n) {
  if (n == null) return '—'
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'k'
  return '$' + Math.round(n)
}

// measure(view) → a scalar reactive view for the active measure over `view`
const measure = v => MEASURES[cfg.measure].fn(v)
const fmt = n => MEASURES[cfg.measure].fmt(n)

// ── grid construction (re-run on config change) ──────────────────────────────
function buildGrid() {
  const rows = sales.group(d => d[cfg.rowField])
  const grandTotal = measure(sales)

  if (cfg.colField === 'none') {
    // 1-D: row label + measure + share-of-total bar
    return div.ptable.oneD(
      div.prow.phead(
        div.pcell.rowhead.text(cfg.rowField),
        div.pcell.meashead.text(MEASURES[cfg.measure].label),
        div.pcell.barhead(''),
      ),
      div.pbody(
        div.prow(rows, (node, bucket, rowKey) => {
          const m = measure(bucket)
          return node(
            div.pcell.rowkey.text(rowKey),
            div.pcell.num.text(m.to(fmt)),
            div.pcell.bar(
              div.barfill.style('width', m.to(v =>
                pct(v, grandTotal[value]) + '%')),
            ),
          )
        }),
      ),
      div.prow.pfoot(
        div.pcell.rowkey.text('Total'),
        div.pcell.num.text(grandTotal.to(fmt)),
        div.pcell.bar(''),
      ),
    )
  }

  // 2-D: row label + one cell per column value + row total
  const colVals = DOMAINS[cfg.colField]
  const gridCols = `minmax(90px,1.2fr) repeat(${colVals.length}, minmax(70px,1fr)) minmax(80px,1fr)`
  // grand totals per column (over all rows), for the footer
  const colGroups = sales.group(d => d[cfg.colField])

  return div.ptable.twoD.style('grid-template-columns', gridCols)(
    // header
    div.pcell.corner.text(`${cfg.rowField} ╲ ${cfg.colField}`),
    ...colVals.map(cv => div.pcell.colhead.text(cv)),
    div.pcell.colhead.total('Total'),
    // body — one prow contributes (1 + colVals + 1) cells into the grid
    div.contents(rows, (node, bucket, rowKey) => {
      const sub = bucket.group(d => d[cfg.colField])
      return node(
        div.pcell.rowkey.text(rowKey),
        ...colVals.map(cv => {
          const m = measure(sub[cv])
          return div.pcell.num
            .class('zero', m.to(v => v == null || v === 0))
            .text(m.to(fmt))
        }),
        div.pcell.num.rowtotal.text(measure(bucket).to(fmt)),
      )
    }),
    // footer — column grand totals
    div.pcell.rowkey.foot('Total'),
    ...colVals.map(cv =>
      div.pcell.num.foot.text(measure(colGroups[cv]).to(fmt))),
    div.pcell.num.foot.grand.text(grandTotal.to(fmt)),
  )
}

const pct = (v, total) => (total ? Math.max(0, Math.min(100, Math.round(100 * (v || 0) / total))) : 0)

// ── mount + rebuild on config change ─────────────────────────────────────────
const gridHost = () => document.querySelector('#grid')

function rebuild() {
  const host = gridHost()
  const fresh = document.createElement('div')
  fresh.className = 'grid-inner'
  host.replaceChildren(fresh)              // attach BEFORE render (DOMSink bails on detached parents)
  render(fresh, HTML.div(buildGrid()))
}

// ── controls ─────────────────────────────────────────────────────────────────
const fieldSelect = (id, fields, current, onChange) =>
  select.attr('id', id).on('change', ev => { onChange(ev.target.value); rebuild() })(
    ...fields.map(f => {
      const o = option.attr('value', f)(f === 'none' ? '— none —' : f)
      return f === current ? o.attr('selected', '') : o
    }))

const measureSelect = () =>
  select.attr('id', 'measure').on('change', ev => { cfg.measure = ev.target.value; rebuild() })(
    ...Object.entries(MEASURES).map(([k, m]) => {
      const o = option.attr('value', k)(m.label)
      return k === cfg.measure ? o.attr('selected', '') : o
    }))

// live data ops
const addSales = n => () => {
  const batch = []
  for (let i = 0; i < n; i++) batch.push('s' + nextId++, newSale())
  sales.patch(batch)                       // one batched cascade for the whole insert
}

// shuffle: move a sample of sales to a fresh random region IN PLACE — exercises
// group's BU2 rebucket. Batched through patch so the grid sees one cascade.
const shuffleRegions = () => {
  const ids = Object.keys(sales[value])
  const batch = []
  for (let i = 0; i < 200 && ids.length; i++) {
    const id = ids[(rnd() * ids.length) | 0]
    const cur = sales[value][id]
    batch.push(id, { ...cur, region: pick(REGIONS) })
  }
  if (batch.length) sales.patch(batch)
}

let streamTimer = null
const toggleStream = ev => {
  if (streamTimer) { clearInterval(streamTimer); streamTimer = null; ev.target.textContent = '▶ stream' }
  else { streamTimer = setInterval(addSales(8), 250); ev.target.textContent = '⏸ stream' }
}

// ── header metrics ───────────────────────────────────────────────────────────
const totalSales = sales.length()
const totalRevenue = sales.sum('revenue')

render(document.body, HTML.body(
  header.topbar(
    div.brand(h1('pivot'), h2('every cell is a reactive aggregate')),
    div.spacer,
    div.metrics(
      span.metric(span.mlabel('rows '), span.mval.text(totalSales.to(n => n.toLocaleString()))),
      span.metric(span.mlabel('Σ revenue '), span.mval.text(totalRevenue.to(fmtMoney))),
    ),
  ),
  section.controls(
    label('rows'), fieldSelect('rowField', ROW_FIELDS, cfg.rowField, v => cfg.rowField = v),
    label('columns'), fieldSelect('colField', COL_FIELDS, cfg.colField, v => cfg.colField = v),
    label('measure'), measureSelect(),
    div.spacer,
    button.ctl['#add100']('+100 sales').on('click', addSales(100)),
    button.ctl['#shuffle']('shuffle regions').on('click', shuffleRegions),
    button.ctl.stream['#stream']('▶ stream').on('click', toggleStream),
  ),
  section.gridwrap(div.attr('id', 'grid')),
))

rebuild()
