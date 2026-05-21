/* Three live operator demos for the editorial page — filter, za, group — all
 * derived from the one shared $(trades) feed in feed.js. Deliberately a lean
 * subset (the full gallery lived in v1); the catalogue table carries breadth.
 *
 * Hand-written `.js`, no `.ts` sibling (see CLAUDE.md). */

import {
  trades, value, render, onTick, flashOperatorCell,
  div, span, $$, fmtPnl, TENORS,
} from './feed.js'

const neg = p => p < 0
const pos = p => p >= 0

/* flash the pnl cell of whichever row just ticked */
onTick(({ id, field }) => flashOperatorCell(id, field))

const pnlCell = t => span.pnl
  .attr('data-fields', 'pnl')
  .class('neg', t.pnl.to(neg)).class('pos', t.pnl.to(pos))
  .text(t.pnl.to(fmtPnl))

/* ---- filter: pick a tenor ---- */
let tenor = '5Y'
function syncFilter () {
  const t = tenor
  const rows = trades.to(arr => arr.filter(r => r && r.tenor === t))
  const live = $$('#filter-result'); live.innerHTML = ''
  render(live, div(
    div.mrow.f_row(rows, (node, r) => node.attr('data-trade-id', r.id)(
      span.text(r.id),
      span.attr('data-tenor', r.tenor).text(r.tenor),
      pnlCell(r),
    ))
  ))
}
const chips = $$('#filter-chips')
TENORS.forEach(tn => {
  const chip = document.createElement('span')
  chip.className = 'chip' + (tn === tenor ? ' on' : '')
  chip.textContent = tn
  chip.addEventListener('click', () => {
    tenor = tn
    chips.querySelectorAll('.chip').forEach(el => el.classList.toggle('on', el === chip))
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
