import { $, value, render, HTML, SVG } from 'data/full'

const { div, span, ul, li, b } = HTML
const { svg: svgEl, rect, line, text, circle, g } = SVG
const $$ = (sel, root = document) => root.querySelector(sel)

const fmt2   = v => Number(v).toFixed(2)
const fmtPnl = p => (p > 0 ? '+' : '') + Math.round(p).toLocaleString()
const STR = s => `<span class="tok-str">'${s}'</span>`
const NUM = n => `<span class="tok-num">${n}</span>`

/* ---------- 1. hero ticker ---------- */

const tick = $(0)
tick.connect($$('[data-demo=ticker]'), 'textContent')
let timer = setInterval(bump, 1000)
function bump () { if (document.visibilityState !== 'hidden') tick[value] = tick[value] + 1 }
document.addEventListener('visibilitychange', () => {
  clearInterval(timer)
  if (document.visibilityState !== 'hidden') timer = setInterval(bump, 1000)
})

/* ---------- 2. streaming blotter (now with tenor) ---------- */

const TRADE_DEFS = [
  { id: 'USD-1Y',  tenor: '1Y'  },
  { id: 'USD-5Y',  tenor: '5Y'  },
  { id: 'USD-10Y', tenor: '10Y' },
  { id: 'USD-30Y', tenor: '30Y' },
  { id: 'EUR-2Y',  tenor: '2Y'  },
  { id: 'EUR-5Y',  tenor: '5Y'  },
  { id: 'EUR-10Y', tenor: '10Y' },
  { id: 'GBP-5Y',  tenor: '5Y'  },
  { id: 'GBP-10Y', tenor: '10Y' },
  { id: 'JPY-10Y', tenor: '10Y' },
]

const trades = $(TRADE_DEFS.map(({ id, tenor }) => {
  const base = 1 + Math.random() * 5
  return {
    id, tenor,
    bid:  +(base - 0.05 - Math.random() * 0.05).toFixed(2),
    ask:  +(base + 0.05 + Math.random() * 0.05).toFixed(2),
    last: +base.toFixed(2),
    pnl:  Math.round((Math.random() - 0.5) * 3000),
  }
}))

const lastTick = $('—')
lastTick.connect($$('#last-tick'), 'textContent')

render($$('#blotter-body'), div(
  div.trow(trades, (node, t, i) => node.attr('data-row', '' + i)(
    span.cell.attr('data-field', 'id').text(t.id),
    span.cell.attr('data-field', 'tenor').attr('data-tenor', t.tenor).text(t.tenor),
    span.cell.attr('data-field', 'bid').text(t.bid.to(fmt2)),
    span.cell.attr('data-field', 'ask').text(t.ask.to(fmt2)),
    span.cell.attr('data-field', 'last').text(t.last.to(fmt2)),
    span.cell.attr('data-field', 'pnl')
      .class('neg', t.pnl.to(p => p < 0))
      .text(t.pnl.to(fmtPnl)),
  ))
))

function flashCell (row, field) {
  const el = $$(`#blotter-body [data-row="${row}"] [data-field="${field}"]`)
  if (!el) return
  el.classList.remove('flash')
  void el.offsetWidth
  el.classList.add('flash')
}

const NUM_FIELDS = ['bid', 'ask', 'last', 'pnl']
let streaming = true
let streamId = null

// Flash only the cell(s) whose displayed value depends on the changed field.
// A cell tagged data-fields="bid" flashes on bid ticks; data-fields="bid ask"
// (e.g. map's spread column) flashes on either. No cell with the field → no
// flash, so panels that don't show the field stay quiet automatically.
function flashOperatorCell (tradeId, field) {
  const sel = `[data-trade-id="${tradeId}"] [data-fields~="${field}"]`
  document.querySelectorAll(sel).forEach(cell => {
    cell.classList.remove('flash')
    void cell.offsetWidth
    cell.classList.add('flash')
  })
}

function mutateOnce () {
  const N = trades[value].length
  const i = (Math.random() * N) | 0
  const f = NUM_FIELDS[(Math.random() * NUM_FIELDS.length) | 0]
  const row = trades[i]
  const cur = row[f][value]
  const fmt = f === 'pnl' ? fmtPnl : fmt2
  let next
  if (f === 'pnl') {
    const raw = Math.round(cur + (Math.random() - 0.5) * 600)
    next = Math.max(-1900, Math.min(1900, raw))
  } else {
    const raw = cur + (Math.random() - 0.5) * 0.08
    next = +Math.max(0.5, raw).toFixed(2)
  }
  // Skip if the formatted display wouldn't change — reactive .to() already
  // dedupes the DOM text update, so flashing here would be noise.
  if (fmt(cur) === fmt(next)) return
  row[f] = next
  lastTick[value] = `trades[${i}].${f} = ${fmt(next)}`
  flashCell(i, f)
  flashOperatorCell(row.id[value], f)
}

function streamTick () {
  if (!streaming || document.visibilityState === 'hidden') return
  mutateOnce(); mutateOnce()
}

function startStream () { if (!streamId) streamId = setInterval(streamTick, 90) }
function stopStream  () { if (streamId) { clearInterval(streamId); streamId = null } }
startStream()

const tBtn = $$('#stream-toggle')
tBtn.addEventListener('click', () => {
  streaming = !streaming
  tBtn.textContent = streaming ? '⏸ pause' : '▶ stream'
})
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') stopStream()
  else if (streaming) startStream()
})

/* ---------- 3. operators — each derives from `trades` ---------- */

const TENORS = ['1Y', '2Y', '5Y', '10Y', '30Y']

/* ---- filter: pick a tenor ----
   Note: we use trades.to(arr => arr.filter(...)) instead of trades.filter
   because filter produces a sparse-keyed view whose source-key indices
   collide with DOMSink's dense-array node storage, causing duplicate row
   nodes after stream updates. `to` returns a fresh dense array each tick. */
let currentTenor = '5Y'
function syncFilter () {
  $$('#op-filter pre.code').innerHTML =
    `trades.filter(${STR('tenor')}, ${STR(currentTenor)})`
  const live = $$('#filter-result')
  live.innerHTML = ''
  const tenor = currentTenor
  const filtered = trades.to(arr => arr.filter(r => r && r.tenor === tenor))
  render(live, div(
    div.mblot_head(
      span.text('id'), span.text('tenor'), span.text('bid'),
      span.text('ask'), span.text('last'), span.text('pnl'),
    ),
    div.mblot_row(filtered, (node, t) => node.attr('data-trade-id', t.id)(
      span.text(t.id),
      span.attr('data-tenor', t.tenor).text(t.tenor),
      span.attr('data-fields', 'bid').text(t.bid.to(fmt2)),
      span.attr('data-fields', 'ask').text(t.ask.to(fmt2)),
      span.attr('data-fields', 'last').text(t.last.to(fmt2)),
      span.pnl.attr('data-fields', 'pnl').class('neg', t.pnl.to(p => p < 0)).text(t.pnl.to(fmtPnl)),
    ))
  ))
}
syncFilter()
const filterChips = $$('#filter-chips')
TENORS.forEach(t => {
  const chip = document.createElement('span')
  chip.className = 'chip' + (t === currentTenor ? ' on' : '')
  chip.textContent = t
  chip.addEventListener('click', () => {
    currentTenor = t
    filterChips.querySelectorAll('.chip').forEach(el => el.classList.toggle('on', el === chip))
    syncFilter()
  })
  filterChips.appendChild(chip)
})

/* ---- between: brush by pnl ---- */
const PNL_MIN = -2000, PNL_MAX = 2000
const W = 720, H = 90, PAD = 28
const xScale = pnl =>
  PAD + ((Math.max(PNL_MIN, Math.min(PNL_MAX, pnl)) - PNL_MIN) / (PNL_MAX - PNL_MIN)) * (W - 2 * PAD)
const TICKS = [-2000, -1000, 0, 1000, 2000]

const pnlRange = $([-500, 1000])
const between = trades.between('pnl', pnlRange)
render($$('#between-result'), div(
  svgEl.bet_axis['viewBox=0 0 720 90']
    .attr('preserveAspectRatio', 'xMidYMid meet')(
      rect.range_rect
        .attr('x', pnlRange.to(([lo]) => xScale(lo)))
        .attr('y', 14)
        .attr('width', pnlRange.to(([lo, hi]) => Math.max(0, xScale(hi) - xScale(lo))))
        .attr('height', H - 42),
      line.zero_line
        .attr('x1', xScale(0)).attr('x2', xScale(0))
        .attr('y1', 10).attr('y2', H - 28),
      line.axis_line
        .attr('x1', PAD).attr('x2', W - PAD)
        .attr('y1', H / 2).attr('y2', H / 2),
      ...TICKS.map(t =>
        text.tick_text
          .attr('x', xScale(t)).attr('y', H - 8)
          .attr('text-anchor', 'middle')
          .text(t.toLocaleString())
      ),
      g(trades, (node, t) => node(
        circle.attr('r', 5)
          .attr('cx', t.pnl.to(v => xScale(v)))
          .attr('cy', H / 2)
          .attr('data-tenor', t.tenor)
      )),
    ),
  div.bet_meta(
    span.text(between.length().to(n => `${n} of 10 in range — `)),
    span(b.text(' '), span.text(pnlRange[0].to(v => `[${v.toLocaleString()},`)),
         span.text(pnlRange[1].to(v => ` ${v.toLocaleString()}]`))),
  ),
))
const lo = $$('#op-between input.lo'), hi = $$('#op-between input.hi')
lo.min = -2000; lo.max = 2000; lo.value = -500
hi.min = -2000; hi.max = 2000; hi.value = 1000
function syncBetween () {
  $$('#op-between pre.code').innerHTML =
    `trades.between(${STR('pnl')}, [${NUM((+lo.value).toLocaleString())}, ${NUM((+hi.value).toLocaleString())}])`
  pnlRange[value] = [+lo.value, +hi.value]
}
syncBetween()
lo.addEventListener('input', syncBetween)
hi.addEventListener('input', syncBetween)

/* ---- za / az: top / bottom 5 by pnl ---- */
const top5    = trades.za('pnl', 5)
const bottom5 = trades.az('pnl', 5)
const renderRanked = (root, view) => render(root, div(
  div.mblot_head(
    span.text(''), span.text('id'), span.text('tenor'), span.text('pnl'),
  ),
  div.mblot_row(view, (node, t) => node.attr('data-trade-id', t.id)(
    span.rank_cell.text(''),
    span.text(t.id),
    span.attr('data-tenor', t.tenor).text(t.tenor),
    span.pnl.attr('data-fields', 'pnl').class('neg', t.pnl.to(p => p < 0)).text(t.pnl.to(fmtPnl)),
  ))
))
renderRanked($$('#za-result'), top5)
renderRanked($$('#az-result'), bottom5)

/* ---- length: total + per-tenor stacked bar ---- */
const totalCount = trades.length()
const segs = trades.to(arr => {
  const c = { '1Y': 0, '2Y': 0, '5Y': 0, '10Y': 0, '30Y': 0 }
  for (const r of arr) if (r && c[r.tenor] !== undefined) c[r.tenor]++
  const t = (c['1Y'] + c['2Y'] + c['5Y'] + c['10Y'] + c['30Y']) || 1
  const out = {}
  for (const k of TENORS) out[k] = { count: c[k], pct: c[k] / t }
  return out
})
render($$('#length-result'), div.length_panel(
  div.total(
    span.big.text(totalCount),
    span.total_label.text(' positions'),
  ),
  div.tenor_bar(
    ...TENORS.map(k =>
      div.seg.attr('data-tenor', k)
        .style('flex-grow', segs[k].pct.to(p => p))
        .text(segs[k].count.to(n => n > 0 ? `${k} · ${n}` : ''))
    )
  ),
  div.tenor_bar_legend(
    ...TENORS.map(k =>
      span(span.swatch.style('background', `var(--ten-${k.toLowerCase()})`),
           span.text(' ' + k))
    )
  ),
))

/* ---- intersect: tenor ∩ profitable ----
   Filter / between / intersect produce sparse-keyed views; their `.length()`
   returns array.length (highest index + 1), not the count of set entries.
   Use dense `to`-derived counts for display, but keep the real operator
   chain to exercise the propagation path. */
let interTenor = '5Y'
function syncIntersect () {
  $$('#op-intersect pre.code').innerHTML =
    `trades\n  .filter(${STR('tenor')}, ${STR(interTenor)})\n  .intersect(trades.between(${STR('pnl')}, [${NUM(0)}, Infinity]))`
  const tenor = interTenor
  // operator chain — runs the propagation, but counts are unreliable on sparse
  trades.filter('tenor', tenor).intersect(trades.between('pnl', $([0, Infinity])))
  // counts via dense arrays
  const tenorCount = trades.to(arr => arr.filter(r => r && r.tenor === tenor).length)
  const profitCount = trades.to(arr => arr.filter(r => r && r.pnl >= 0).length)
  const interCount = trades.to(arr => arr.filter(r => r && r.tenor === tenor && r.pnl >= 0).length)
  const denseRows = trades.to(arr => arr.filter(r => r && r.tenor === tenor && r.pnl >= 0))
  const live = $$('#intersect-result')
  live.innerHTML = ''
  render(live, div.inter_panel(
    div.pipeline(
      span.step(span.text(`tenor=${tenor}: `), span.count.text(tenorCount)),
      span.arrow.text(' ∩ '),
      span.step(span.text('profitable: '), span.count.text(profitCount)),
      span.arrow.text(' = '),
      span.count.text(interCount),
    ),
    div.mblot_head(
      span.text('id'), span.text('tenor'), span.text('last'), span.text('pnl'),
    ),
    div.mblot_row(denseRows, (node, t) => node.attr('data-trade-id', t.id)(
      span.text(t.id),
      span.attr('data-tenor', t.tenor).text(t.tenor),
      span.attr('data-fields', 'last').text(t.last.to(fmt2)),
      span.pnl.attr('data-fields', 'pnl').class('neg', t.pnl.to(p => p < 0)).text(t.pnl.to(fmtPnl)),
    )),
  ))
}
syncIntersect()
const interChips = $$('#intersect-chips')
TENORS.forEach(t => {
  const chip = document.createElement('span')
  chip.className = 'chip' + (t === interTenor ? ' on' : '')
  chip.textContent = t
  chip.addEventListener('click', () => {
    interTenor = t
    interChips.querySelectorAll('.chip').forEach(el => el.classList.toggle('on', el === chip))
    syncIntersect()
  })
  interChips.appendChild(chip)
})

/* ---- group: nested view by tenor ---- */
const grouped = trades.group(d => d.tenor)
render($$('#group-result'), div.group_panel(
  div.tgroup(grouped, (node, rows, tenor) => node(
    div.tgroup_head(
      span.tag.attr('data-tenor', tenor).text(tenor),
      span.ctx.text(`${tenor} positions`),
    ),
    div.tgroup_body.attr('data-tenor', tenor)(
      div.tgroup_row(rows, (n, t) => n.attr('data-trade-id', t.id)(
        span.text(t.id),
        span.attr('data-fields', 'bid').text(t.bid.to(fmt2)),
        span.attr('data-fields', 'ask').text(t.ask.to(fmt2)),
        span.pnl.attr('data-fields', 'pnl').class('neg', t.pnl.to(p => p < 0)).text(t.pnl.to(fmtPnl)),
      ))
    ),
  ))
))

/* ---- map: derive bid-ask spread per row ---- */
const spreaded = trades.map(d => ({
  id: d.id, tenor: d.tenor,
  bid: d.bid, ask: d.ask,
  spread: +(d.ask - d.bid).toFixed(2),
}))
render($$('#map-result'), div(
  div.mblot_head(
    span.text('id'), span.text('tenor'),
    span.text('bid'), span.text('ask'), span.spread.text('spread'),
  ),
  div.mblot_row(spreaded, (node, t) => node.attr('data-trade-id', t.id)(
    span.text(t.id),
    span.attr('data-tenor', t.tenor).text(t.tenor),
    span.attr('data-fields', 'bid').text(t.bid.to(fmt2)),
    span.attr('data-fields', 'ask').text(t.ask.to(fmt2)),
    span.spread.attr('data-fields', 'bid ask').text(t.spread.to(fmt2)),
  ))
))

/* ---- to / reduce: aggregate pnl, two ways ---- */
const totalPnlTo     = trades.to(arr =>
  arr.reduce((s, t) => s + (t?.pnl || 0), 0)
)
const totalPnlReduce = trades.reduce((s, t) => s + (t?.pnl || 0), 0)
render($$('#to-result'), div.to_panel(
  div.agg_pair(
    div.agg_col(
      div.agg_label.text('to'),
      div.agg_num
        .class('pos', totalPnlTo.to(p => p >= 0))
        .class('neg', totalPnlTo.to(p => p < 0))
        .text(totalPnlTo.to(fmtPnl)),
    ),
    div.agg_col(
      div.agg_label.text('reduce'),
      div.agg_num
        .class('pos', totalPnlReduce.to(p => p >= 0))
        .class('neg', totalPnlReduce.to(p => p < 0))
        .text(totalPnlReduce.to(fmtPnl)),
    ),
  ),
  div.agg_sub.text(trades.length().to(n => `summed across ${n} positions`)),
))

/* ---- aggregates: sum / avg / max / min / some / every ---- */
const sumPnl   = trades.sum('pnl')
const avgPnl   = trades.avg('pnl')
const maxPnl   = trades.max('pnl')
const minPnl   = trades.min('pnl')
const anyBig   = trades.some(t => t && t.pnl > 1000)
const allWin   = trades.every(t => t && t.pnl > 0)
const fmtBool  = b => b ? 'true' : 'false'
const fmtMoney = v => v === undefined ? '—'
                    : (v > 0 ? '+' : '') + Math.round(v).toLocaleString()
const fmtAvg   = v => v === undefined ? '—'
                    : (v > 0 ? '+' : '') + v.toFixed(0)
render($$('#aggregates-result'), div.agg_grid(
  div.agg_cell(
    div.agg_cell_label.text('sum(pnl)'),
    div.agg_cell_val
      .class('pos', sumPnl.to(p => p >= 0)).class('neg', sumPnl.to(p => p < 0))
      .text(sumPnl.to(fmtMoney)),
  ),
  div.agg_cell(
    div.agg_cell_label.text('avg(pnl)'),
    div.agg_cell_val
      .class('pos', avgPnl.to(p => p >= 0)).class('neg', avgPnl.to(p => p < 0))
      .text(avgPnl.to(fmtAvg)),
  ),
  div.agg_cell(
    div.agg_cell_label.text('max(pnl)'),
    div.agg_cell_val.class('pos').text(maxPnl.to(fmtMoney)),
  ),
  div.agg_cell(
    div.agg_cell_label.text('min(pnl)'),
    div.agg_cell_val.class('neg').text(minPnl.to(fmtMoney)),
  ),
  div.agg_cell(
    div.agg_cell_label.text('some(pnl > 1000)'),
    div.agg_cell_val
      .class('pos', anyBig.to(b => b)).class('neg', anyBig.to(b => !b))
      .text(anyBig.to(fmtBool)),
  ),
  div.agg_cell(
    div.agg_cell_label.text('every(pnl > 0)'),
    div.agg_cell_val
      .class('pos', allWin.to(b => b)).class('neg', allWin.to(b => !b))
      .text(allWin.to(fmtBool)),
  ),
))

/* ---- setops: union / except over the same chip selector as intersect ---- */
let setopTenor = '5Y'
function syncSetops () {
  $$('#op-setops pre.code').innerHTML =
`const A = trades.filter(${STR('tenor')}, ${STR(setopTenor)})
const B = trades.between(${STR('pnl')}, [${NUM(0)}, Infinity])

A.union(B)     // either tenor or profitable
A.except(B)    // ${setopTenor} losers (in A, not in B)`
  // Counts via dense arrays, like the intersect demo above.
  const aCount = trades.to(arr => arr.filter(r => r && r.tenor === setopTenor).length)
  const bCount = trades.to(arr => arr.filter(r => r && r.pnl >= 0).length)
  const uCount = trades.to(arr => arr.filter(r => r && (r.tenor === setopTenor || r.pnl >= 0)).length)
  const eCount = trades.to(arr => arr.filter(r => r && r.tenor === setopTenor && r.pnl < 0).length)
  const eRows  = trades.to(arr => arr.filter(r => r && r.tenor === setopTenor && r.pnl < 0))
  const live = $$('#setops-result')
  live.innerHTML = ''
  render(live, div.setops_panel(
    div.setops_grid(
      div.setops_card(
        div.setops_card_op.text('A ∩ B'),
        div.setops_card_label.text(`${setopTenor} ∩ profitable`),
        div.setops_card_count.text(trades.to(arr =>
          arr.filter(r => r && r.tenor === setopTenor && r.pnl >= 0).length
        )),
      ),
      div.setops_card(
        div.setops_card_op.text('A ∪ B'),
        div.setops_card_label.text(`${setopTenor} or profitable`),
        div.setops_card_count.text(uCount),
      ),
      div.setops_card(
        div.setops_card_op.text('A ∖ B'),
        div.setops_card_label.text(`${setopTenor} losers`),
        div.setops_card_count.text(eCount),
      ),
    ),
    div.setops_pipeline(
      span.step(span.text(`A: tenor=${setopTenor}: `), span.count.text(aCount)),
      span.dim.text(' · '),
      span.step(span.text('B: profitable: '), span.count.text(bCount)),
    ),
    div.mblot_head(
      span.text('id'), span.text('tenor'), span.text('last'), span.text('pnl'),
    ),
    div.mblot_row(eRows, (node, t) => node.attr('data-trade-id', t.id)(
      span.text(t.id),
      span.attr('data-tenor', t.tenor).text(t.tenor),
      span.attr('data-fields', 'last').text(t.last.to(fmt2)),
      span.pnl.attr('data-fields', 'pnl').class('neg', t.pnl.to(p => p < 0)).text(t.pnl.to(fmtPnl)),
    )),
  ))
}
syncSetops()
const setopsChips = $$('#setops-chips')
TENORS.forEach(t => {
  const chip = document.createElement('span')
  chip.className = 'chip' + (t === setopTenor ? ' on' : '')
  chip.textContent = t
  chip.addEventListener('click', () => {
    setopTenor = t
    setopsChips.querySelectorAll('.chip').forEach(el => el.classList.toggle('on', el === chip))
    syncSetops()
  })
  setopsChips.appendChild(chip)
})

/* ---- projections: distinct / keys / values / reverse ---- */
const distinctTenors = trades.distinct(t => t && t.tenor)
const tenorCounts    = trades.length(t => t && t.tenor)
const tenorKeys      = tenorCounts.keys()
const tenorValues    = tenorCounts.values().to(arr => arr.map(c => c?.value ?? c))
const bottomReversed = top5.reverse()    // top5 reversed = bottom of top5 first
render($$('#projections-result'), div.proj_panel(
  div.proj_row(
    div.proj_label.text('distinct(tenor)'),
    div.proj_val.text(distinctTenors.to(arr =>
      arr.map(t => t && t.tenor).filter(Boolean).join(', ') || '—'
    )),
  ),
  div.proj_row(
    div.proj_label.text('length(tenor).keys()'),
    div.proj_val.text(tenorKeys.to(ks => ks.join(', ') || '—')),
  ),
  div.proj_row(
    div.proj_label.text('length(tenor).values()'),
    div.proj_val.text(tenorValues.to(vs => vs.join(', ') || '—')),
  ),
  div.proj_row(
    div.proj_label.text('za(pnl, 5).reverse()'),
    div.proj_val.text(bottomReversed.to(arr =>
      arr.map(t => t && t.id).filter(Boolean).join(' → ') || '—'
    )),
  ),
))

/* ---- tap: live event log of top5 ---- */
const tapLog = []
const TAP_MAX = 18
top5.tap(change => {
  // Compact, readable summary — full record is too noisy for the panel.
  const summary = change.type === 'move'
    ? `${change.type} ${change.from}→${change.to}`
    : `${change.type} ${change.key.length ? `[${change.key.join(',')}]` : '[]'} ${
        change.at !== undefined ? `at ${change.at}` : ''
      }`
  tapLog.unshift({ at: Date.now(), summary })
  if (tapLog.length > TAP_MAX) tapLog.length = TAP_MAX
  // Manual re-render (the log isn't a ViewProxy).
  const node = $$('#tap-result')
  if (!node) return
  node.innerHTML = tapLog.map(e =>
    `<div class="tap-entry"><span class="tap-time">${
      new Date(e.at).toTimeString().slice(0, 8)
    }</span> <span class="tap-msg">${e.summary}</span></div>`
  ).join('')
})

/* ---------- 4. crossfilter iframe auto-resize ---------- */

// The crossfilter example posts its content height; size the iframe to
// match so the embedded view never shows a scrollbar or empty space.
window.addEventListener('message', e => {
  if (e.data?.type !== 'crossfilter-height') return
  const frame = $$('iframe.cf')
  if (!frame || !(e.data.height > 0)) return
  frame.style.height = e.data.height + 'px'
})

/* ---------- 5. syntax highlighter ---------- */

const KEYWORDS = /\b(import|from|const|let|var|function|return|new|if|else|for|of|in|true|false|null|undefined|delete|class|extends|export|default|async|await|typeof|instanceof|Infinity)\b/g

document.querySelectorAll('pre.code, code.inline').forEach(el => {
  if (el.dataset.hl === 'off') return
  let s = el.textContent
  // Don't escape '>' — outside tag context it's literal, and escaping it to
  // '&gt;' lets the punctuation regex below match the entity's trailing ';'.
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  s = s.replace(/(\/\/[^\n]*)/g, '\x00C\x01$1\x02')
  s = s.replace(/(['"`])((?:\\.|(?!\1).)*)\1/g, '\x00S\x01$1$2$1\x02')
  s = s.replace(/\b(\d+\.?\d*)\b/g, '\x00N\x01$1\x02')
  s = s.replace(KEYWORDS, '\x00K\x01$1\x02')
  s = s.replace(/[(){}[\];,]/g, m => `\x00P\x01${m}\x02`)
  s = s
    .replace(/\x00C\x01/g, '<span class="tok-com">').replace(/\x00S\x01/g, '<span class="tok-str">')
    .replace(/\x00N\x01/g, '<span class="tok-num">').replace(/\x00K\x01/g, '<span class="tok-key">')
    .replace(/\x00P\x01/g, '<span class="tok-pun">')
    .replace(/\x02/g, '</span>')
  el.innerHTML = s
})
