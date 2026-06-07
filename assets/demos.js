/* Live demos for every operator in the catalogue. Each renders into the
 * inline expansion card below its row in index.html (id = `<op>-result`).
 * All views derive from the one shared $(trades) feed from feed.js.
 *
 * Hand-written `.js`, no `.ts` sibling (see CLAUDE.md). */

import {
  $, trades, value, render, onTick, flashOperatorCell, lastTick,
  div, span, $$, fmt2, fmtPnl, fmtAvg, fmtMoney, TENORS,
} from './feed.js'

const neg = p => p !== undefined && p < 0
const pos = p => p !== undefined && p >= 0

/* flash the pnl cell of whichever row just ticked */
onTick(({ id, field }) => flashOperatorCell(id, field))

/* pnl cell that won't print "NaN" if the row VP transiently resolves to
 * undefined — between / intersect / union all leave undefined slots in their
 * sparse arrays at moments, which the row template visits. */
const pnlCell = t => span.pnl
  .attr('data-fields', 'pnl')
  .class('neg', t.pnl.to(neg)).class('pos', t.pnl.to(pos))
  .text(t.pnl.to(p => p === undefined ? '—' : fmtPnl(p)))

/* Densify a sparse view (between, gt/lt, intersect, union, except) before
 * iterating in a row template. Without this, indices the operator marked
 * `value[name] = undefined` get a DOM node whose pnl/id bindings render
 * "NaN" / blank. `.to()` here trades per-row reactivity for a clean snapshot —
 * fine at N=10. */
const dense = vp => vp.to(v => {
  if (!v) return []
  if (Array.isArray(v)) return v.filter(r => r !== undefined)
  return Object.values(v).filter(r => r !== undefined)
})

/* ---- filter: pick a tenor ----
 * Rows render off a dense `.to(arr.filter)` snapshot, and the same view feeds a
 * live `.length()` / `.avg('pnl')` summary line — so picking a chip and every
 * downstream tick recompute the count and average reactively. The redundant
 * tenor column is dropped (every row carries the tenor we just filtered to) and
 * replaced by the live `last` rate, so the card reads like a real blotter. */
let tenor = '5Y'
function syncFilter () {
  const t = tenor
  const rows = trades.to(arr => arr.filter(r => r && r.tenor === t))
  const live = $$('#filter-result'); live.innerHTML = ''
  render(live, div(
    div.demo_stat(
      span.text(rows.length().to(n => `${n} trade${n === 1 ? '' : 's'}`)),
      span.stat_avg.text(rows.avg('pnl').to(v => 'avg ' + fmtAvg(v))),
    ),
    div.f_rows(
      div.mrow.f_row(rows, (node, r) => node.attr('data-trade-id', r.id)(
        span.attr('data-tenor', tenor).text(r.id),
        span.last.attr('data-fields', 'last').text(r.last.to(fmt2)),
        pnlCell(r),
      ))
    ),
  ))
}
const chips = $$('#filter-chips')
TENORS.forEach(tn => {
  const chip = document.createElement('button')
  chip.type = 'button'
  chip.className = 'chip' + (tn === tenor ? ' on' : '')
  chip.textContent = tn
  chip.setAttribute('aria-pressed', String(tn === tenor))
  chip.addEventListener('click', () => {
    tenor = tn
    chips.querySelectorAll('.chip').forEach(el => {
      const on = el === chip
      el.classList.toggle('on', on)
      el.setAttribute('aria-pressed', String(on))
    })
    syncFilter()
  })
  chips.appendChild(chip)
})
syncFilter()

/* ---- za: top 5 by pnl ---- */
const top5 = trades.za('pnl', 5)
render($$('#za-result'), div(
  div.mrow.z_row(top5, (node, t, key) => node.attr('data-trade-id', t.id)(
    span.rank.text(String(+key + 1)),
    span.attr('data-tenor', t.tenor).text(t.id),
    pnlCell(t),
  ))
))

/* ---- group: nest by tenor ---- */
const grouped = trades.group(d => d.tenor)
render($$('#group-result'), div(
  div.gbucket(grouped, (node, rows, tn) => node(
    div.gbucket_head(
      span.attr('data-tenor', tn).text(tn),
      span.gcount.text(rows.length()),
    ),
    div.gbucket_body(
      div.grow(rows, (n, t) => n.attr('data-trade-id', t.id)(
        span.text(t.id),
        pnlCell(t),
      ))
    ),
  ))
))

/* ============================================================
 * The other twelve operator demos. Each renders into the cat-demo
 * panel beneath its catalogue row; all derive from `trades`.
 * Shared helpers below for the common shapes that repeat (row, col).
 * ============================================================ */

/* a compact row: id + pnl, tenor-coloured */
const idPnlRow = (rows) => div.mrow.id_row(rows, (n, r) => n.attr('data-trade-id', r.id)(
  span.attr('data-tenor', r.tenor).text(r.id),
  pnlCell(r),
))

/* a labelled column in a split layout — `set` is densified before iteration
 * so the row template never sees an undefined slot (would render "NaN"). */
const split2Col = (label, count, set) => div.split_col(
  div.col_head(
    span.col_head_label.text(label),
    span.col_head_count.text(count.to(n => `${n} row${n === 1 ? '' : 's'}`)),
  ),
  idPnlRow(dense(set)),
)

/* a labelled scalar cell, sign-coloured */
const scalarCell = (label, vp, fmt = fmtPnl, signed = true) => div.scalar_cell(
  span.scalar_label.text(label),
  signed
    ? div.scalar_val
        .class('pos', vp.to(v => v !== undefined && v > 0))
        .class('neg', vp.to(v => v !== undefined && v < 0))
        .text(vp.to(v => v === undefined ? '—' : fmt(v)))
    : div.scalar_val.text(vp.to(v => v === undefined ? '—' : fmt(v))),
)

const aggCell = (label, vp, fmt = fmtPnl, sign = 'auto') => div.agg_cell(
  span.agg_label.text(label),
  sign === 'pos' ? div.agg_val.pos.text(vp.to(v => v === undefined ? '—' : fmt(v)))
  : sign === 'neg' ? div.agg_val.neg.text(vp.to(v => v === undefined ? '—' : fmt(v)))
  : div.agg_val
      .class('pos', vp.to(v => v !== undefined && v > 0))
      .class('neg', vp.to(v => v !== undefined && v < 0))
      .text(vp.to(v => v === undefined ? '—' : fmt(v))),
)

/* ---- between: pnl in [-500, 500] ---- */
const bwRows = trades.between('pnl', [-500, 500])
render($$('#between-result'), div(
  div.demo_stat(
    span.text(bwRows.length().to(n => `${n} in [−500, 500]`)),
    span.stat_avg.text(bwRows.avg('pnl').to(v => 'avg ' + fmtAvg(v))),
  ),
  div.f_rows(div.mrow.f_row(dense(bwRows), (n, r) => n.attr('data-trade-id', r.id)(
    span.attr('data-tenor', r.tenor).text(r.id),
    span.last.attr('data-fields', 'last').text(r.last.to(fmt2)),
    pnlCell(r),
  ))),
))

/* ---- compare: gainers (gt) vs losers (lt) ---- */
const cmpGainers = trades.gt('pnl', 0)
const cmpLosers  = trades.lt('pnl', 0)
render($$('#compare-result'), div.split.split_2(
  split2Col("gt('pnl', 0)", cmpGainers.length(), cmpGainers),
  split2Col("lt('pnl', 0)", cmpLosers.length(), cmpLosers),
))


/* ---- length(fn): counts per tenor with a live bar ----
 * LengthFnValue stores each bucket as `{ value: count }` internally — so the
 * count VP is `tenorCounts[tn].value`, not `tenorCounts[tn]` itself. (Reading
 * the parent directly stringifies the wrapping object to "[object Object]" and
 * gives NaN in arithmetic.) Scale: max bucket on this dataset is ~4, so
 * multiplying by 25 fills the bar at 100%. */
const tenorCounts = trades.length(d => d.tenor)
const countOf = tn => tenorCounts[tn].value
render($$('#length-result'), div.tcount_block(
  TENORS.map(tn => div.tcount_row(
    span.tcount_label.attr('data-tenor', tn).text(tn),
    div.tcount_bar(div.tcount_fill.attr('style', countOf(tn).to(c => `width:${Math.min(100, (c || 0) * 25)}%`))),
    span.tcount_val.text(countOf(tn).to(c => String(c || 0))),
  ))
))

/* ---- sum / avg / max / min: four live scalars over pnl ---- */
render($$('#aggregate-result'), div.agg_grid(
  aggCell('sum',  trades.sum('pnl')),
  aggCell('avg',  trades.avg('pnl'), fmtAvg),
  aggCell('max',  trades.max('pnl'), fmtPnl, 'pos'),
  aggCell('min',  trades.min('pnl'), fmtPnl, 'neg'),
))

/* ---- some / every: live booleans ---- */
const anyBig    = trades.some(r => r.pnl > 1000)
const allBounded = trades.every(r => r.pnl > -1900)
const boolCell = (label, vp) => div.bool_cell(
  span.bool_key.text(label),
  span.bool_val
    .class('tru', vp)
    .class('fal', vp.to(b => !b))
    .text(vp.to(b => b ? '✓ true' : '✗ false')),
)
render($$('#some-result'), div.bool_grid(
  boolCell('some(pnl > 1000)', anyBig),
  boolCell('every(pnl > −1900)', allBounded),
))

/* ---- intersect: 5Y rows ∩ profitable rows ----
 * Defined once (also used by union/except) so the same operand views are
 * shared across the cards. */
const setFiveY   = trades.filter('tenor', '5Y')
const setGainers = trades.filter(r => r.pnl > 0)
const interSet   = setFiveY.intersect(setGainers)
render($$('#intersect-result'), div.split.split_3(
  split2Col("filter('tenor','5Y')", setFiveY.length(),   setFiveY),
  split2Col("filter(r=>r.pnl>0)",    setGainers.length(), setGainers),
  split2Col('5Y ∩ gainers',          interSet.length(),   interSet),
))

/* ---- union / except: same operands, two set-algebra results ---- */
const unionSet  = setFiveY.union(setGainers)
const exceptSet = setFiveY.except(setGainers)
render($$('#union-result'), div.split.split_2(
  split2Col('5Y ∪ gainers',  unionSet.length(),  unionSet),
  split2Col('5Y \\ gainers', exceptSet.length(), exceptSet),
))

/* ---- distinct: first-seen unique by tenor ---- */
const distTrades = trades.distinct(r => r.tenor)
render($$('#distinct-result'), div(
  div.demo_stat(
    span.text(distTrades.length().to(n => `${n} unique tenor${n === 1 ? '' : 's'}`)),
    span.stat_avg.text('first seen'),
  ),
  div.distinct_chips(distTrades, (node, r) => node.distinct_chip(
    span.distinct_chip_tenor.attr('data-tenor', r.tenor).text(r.tenor),
    span.distinct_chip_id.text(r.id),
  )),
))

/* ---- map: per-row transform → (id, tenor, spread, pnl) ----
 * `spread` is derived from bid/ask so its cell flashes on either field. */
const mappedRows = trades.map(r => ({
  id: r.id, tenor: r.tenor, pnl: r.pnl,
  spread: +(r.ask - r.bid).toFixed(2),
}))
render($$('#map-result'), div(
  div.demo_stat(
    span.text(mappedRows.length().to(n => `${n} rows`)),
    span.stat_avg.text(mappedRows.avg('spread').to(v => 'avg spread ' + (v === undefined ? '—' : fmt2(v)))),
  ),
  div.f_rows(div.mrow.f_row(mappedRows, (node, r) => node.attr('data-trade-id', r.id)(
    span.attr('data-tenor', r.tenor).text(r.id),
    span.last.attr('data-fields', 'bid ask').text(r.spread.to(fmt2)),
    pnlCell(r),
  ))),
))

/* ---- to / reduce: running pnl sum, plus a companion mean for context ----
 * Incremental form: BI0/BR1 thread through add/remove in O(Δ); BU2 ticks
 * (the streaming feed's bread-and-butter) fall back to rebuild — fine here
 * because the working set is only 10 rows. */
const sumPnl = trades.reduce(
  (acc, r) => acc + r.pnl,
  (acc, r) => acc - r.pnl,
  0,
)
render($$('#reduce-result'), div.scalar_row(
  scalarCell('Σ pnl', sumPnl, fmtPnl),
  scalarCell('μ pnl', trades.avg('pnl'), fmtAvg),
))

/* ---- tap: count emits, mirror lastTick from the feed ----
 * A standalone tap has no downstream sink to anchor it, and a bare
 * `const x = …; void x` is NOT enough — V8 reclaims a binding it can prove is
 * never read again, the sink's WeakRef dies, and the tap silently stops firing
 * (the "events received" counter froze while "last mutation" kept ticking).
 * Anchor it on the card's DOM node — alive for the page's life — exactly like
 * multidim's `chartsRoot._chains`. */
const tapEl = $$('#tap-result')
const tapN = $(0)
let _tapCounter = 0
tapEl._tap = trades.tap(() => { tapN[value] = ++_tapCounter })
render(tapEl, div.tap_grid(
  div.tap_block(span.tap_label.text('events received'), div.tap_counter.text(tapN)),
  div.tap_block(span.tap_label.text('last mutation'),   div.tap_last.text(lastTick)),
))

/* ---- keys / values / reverse: projections over shape ---- */
const tradeKeys = trades.keys()
const reversedRows = trades.reverse()
render($$('#keys-result'), div.split.split_2(
  div.split_col(
    div.col_head(
      span.col_head_label.text('.keys()'),
      span.col_head_count.text(tradeKeys.to(arr => `${arr.length} keys`)),
    ),
    div.key_chips(tradeKeys, (n, k) => n.kchip.text(k)),
  ),
  div.split_col(
    div.col_head(
      span.col_head_label.text('.reverse()'),
      span.col_head_count.text(reversedRows.length().to(n => `${n} rows`)),
    ),
    idPnlRow(reversedRows),
  ),
))
