/* Live demos for every operator in the catalogue — the v3 port of demos.js.
 * Each renders into the inline expansion card below its row in index.html
 * (id = `<op>-result`); all views derive from the one shared `trades` handle
 * in feed.js (a v3 array-born source over the same 10-row blotter — minted
 * integer keys). Pairs with the v3 rewrite of feed.js, which re-exports the
 * `data` entry's render vocabulary (text / list / bind) alongside the feed.
 *
 * The v3 disciplines this file runs on (v3/MIGRATION.md):
 * - chains are built ONCE; interactive re-selection goes through a mirror()
 *   slot re-pointed at TRANSIENT filters that are dispose()d after the
 *   re-point (§5.1/§5.2 — the chat-v3 / kanban-v3 idiom). No card is ever
 *   re-rendered wholesale.
 * - iteration is ONLY list(view, rowFn), the SOLE child of its container
 *   (§4.1); rowFns receive PLAIN rows (§4.2), so cells are plain expressions
 *   — no .to() bindings, no dense() helper, no undefined guards (v3 views
 *   are DENSE; the v2 sparse-slot gotchas are structurally gone).
 * - reactive text is text(view, fn?); reactive attrs are bind(view, fn).
 *
 * DOM parity with the v2 module: same card ids, same row/cell classes, same
 * data-trade-id / data-fields / data-tenor attributes (the CSS and the flash
 * mechanism key off them). The one systematic delta: v3's sole-child list
 * rule means rows that v2 appended directly beside a sibling header now sit
 * inside a plain, unstyled wrapper div.
 *
 * Hand-written `.js`, no `.ts` sibling (see CLAUDE.md). */

import {
  $, value, render, HTML, text, list, bind,
  trades, lastTick, onTick, flashOperatorCell,
  $$, fmt2, fmtPnl, fmtAvg, TENORS,
} from './feed.js'

const { div, span, style } = HTML

/* flash the pnl cell of whichever row just ticked — unchanged from v2: the
 * flash is imperative classList work on [data-trade-id]/[data-fields] cells,
 * deliberately outside the reactive graph. */
onTick(({ id, field }) => flashOperatorCell(id, field))

/* pnl cell. The v2 version formatted through `p === undefined ? '—' : …`
 * because sparse producers left explicit-undefined slots the row template
 * visited. v3 rowFns receive PLAIN dense rows (§4.2), so this collapses to
 * plain-number formatting; the sign class is a static prop computed from row
 * data, which the renderer diffs surgically on each row update. */
const pnlCell = t => span.pnl(
  { 'data-fields': 'pnl', class: t.pnl < 0 ? 'neg' : 'pos' },
  fmtPnl(t.pnl),
)

/* The v2 dense() helper is DELETED: between / gt / lt / intersect / union /
 * except emit honest keyed membership in v3 (§1.3) — there are no
 * explicit-undefined holes to filter out before iterating, ever. */

/* ---- filter: pick a tenor ----
 * v2 re-rendered the whole card per chip (innerHTML = '' + render). v3 builds
 * the chain ONCE off a mirror() slot: length() / avg('pnl') chain off the
 * SLOT, the keyed list binds to the SLOT, and a chip click composes a
 * TRANSIENT trades.filter(...), re-points the slot, and dispose()s the
 * previous transient AFTER the slot has left it — the chat-v3 search /
 * kanban-v3 chips discipline (§5.1/§5.2). filter is PREDICATE-ONLY in v3
 * (§3.1): the v2 filter('tenor', tn) string form throws at construction. */
let tenor = '5Y'
let tenorView = trades.filter(r => r.tenor === '5Y') // the initial transient
const tenorSlot = tenorView.mirror()                 // THE slot — everything chains off it
const tenorCount = tenorSlot.length()                // chained ONCE, follows every re-point
const tenorAvg = tenorSlot.avg('pnl')

render($$('#filter-result'), div(
  div.demo_stat(
    span(text(tenorCount, n => `${n} trade${n === 1 ? '' : 's'}`)),
    span.stat_avg(text(tenorAvg, v => 'avg ' + fmtAvg(v))),
  ),
  // the keyed list — sole child of its container (§4.1); bound once, never re-binds
  div.f_rows(list(tenorSlot, t => div.mrow.f_row(
    { 'data-trade-id': t.id },
    span({ 'data-tenor': t.tenor }, t.id),
    span.last({ 'data-fields': 'last' }, fmt2(t.last)),
    pnlCell(t),
  ))),
))

const pickTenor = tn => {
  if (tn === tenor) return
  tenor = tn
  const prev = tenorView
  tenorView = trades.filter(r => r.tenor === tn) // TRANSIENT — one per pick
  tenorSlot.set(tenorView)                       // one consolidated diff commit
  prev.dispose()                                 // AFTER re-pointing away (§5.2)
}

const chips = $$('#filter-chips')
TENORS.forEach(tn => {
  const chip = document.createElement('button')
  chip.type = 'button'
  chip.className = 'chip' + (tn === tenor ? ' on' : '')
  chip.textContent = tn
  chip.setAttribute('aria-pressed', String(tn === tenor))
  chip.addEventListener('click', () => {
    chips.querySelectorAll('.chip').forEach(el => {
      const on = el === chip
      el.classList.toggle('on', on)
      el.setAttribute('aria-pressed', String(on))
    })
    pickTenor(tn)
  })
  chips.appendChild(chip)
})

/* ---- za: top 5 by pnl ----
 * trades.za('pnl', 5) — unchanged signature, a bounded window (§3.4). Rows
 * are plain and the rowFn's key is the SOURCE row key (a minted integer id),
 * NOT the rank — and an in-window reorder is an orderMove (one insertBefore
 * of the EXISTING element) that does not re-run row fns, so a painted rank
 * number would go stale on every rotation. Rank is therefore a CSS COUNTER:
 * it reads position off DOM order, which the ordered list sink maintains —
 * always correct, zero bindings. (NO worked precedent: none of the seven
 * *-v3 examples renders an ordinal column; §3.4 is the authority here.) */
const top5 = trades.za('pnl', 5)
render($$('#za-result'), [
  style(
    '#za-result { counter-reset: zrank } ' +
    '#za-result .z-row { counter-increment: zrank } ' +
    '#za-result .z-row .rank::before { content: counter(zrank) }',
  ),
  div(list(top5, t => div.mrow.z_row(
    { 'data-trade-id': t.id },
    span.rank(), // filled by the CSS counter above
    span({ 'data-tenor': t.tenor }, t.id),
    pnlCell(t),
  ))),
])

/* ---- group: nest by tenor ----
 * list(grouped, (bucket, tenor) => …) — the bucket arrives as PLAIN data (a
 * { rowKey: row } member object, §3.6), so the count is a plain length and
 * the member rows are a plain loop rendered as STATIC children: no inner
 * list, and no chaining off the bucket (child handles are path addresses,
 * §3.7). A member edit arrives as a bucket update; the list sink re-runs
 * this fn and patches the changed text in place. Worked precedent:
 * crossfilter-v3's `list(days, (bucket, day) => …)`. */
const grouped = trades.group(d => d.tenor)
render($$('#group-result'), div(
  list(grouped, (bucket, tn) => {
    const rows = Object.values(bucket)
    return div.gbucket(
      div.gbucket_head(
        span({ 'data-tenor': tn }, tn),
        span.gcount(String(rows.length)),
      ),
      div.gbucket_body(rows.map(t => div.grow(
        { 'data-trade-id': t.id },
        span(t.id),
        pnlCell(t),
      ))),
    )
  }),
))

/* ============================================================
 * The other twelve operator demos. Each renders into the cat-demo
 * panel beneath its catalogue row; all derive from `trades`.
 * Shared helpers below for the common shapes that repeat (row, col).
 * ============================================================ */

/* a compact row list: id + pnl, tenor-coloured. The plain wrapper div exists
 * because a v3 list() must be the sole child of its container (§4.1) — v2
 * appended these rows directly beside the column header. */
const idPnlRow = rows => div(list(rows, r => div.mrow.id_row(
  { 'data-trade-id': r.id },
  span({ 'data-tenor': r.tenor }, r.id),
  pnlCell(r),
)))

/* a labelled column in a split layout — `count` is a scalar view into
 * text(), `set` a dense keyed view straight into the row list (the v2
 * dense() wrap is gone). */
const split2Col = (label, count, set) => div.split_col(
  div.col_head(
    span.col_head_label(label),
    span.col_head_count(text(count, n => `${n} row${n === 1 ? '' : 's'}`)),
  ),
  idPnlRow(set),
)

/* a labelled scalar cell, sign-coloured — a scalar handle goes straight into
 * text() (the number) and bind() (the sign class). */
const scalarCell = (label, vp, fmt = fmtPnl, signed = true) => div.scalar_cell(
  span.scalar_label(label),
  signed
    ? div.scalar_val(
        { class: bind(vp, v => v > 0 ? 'pos' : v < 0 ? 'neg' : '') },
        text(vp, v => v === undefined ? '—' : fmt(v)),
      )
    : div.scalar_val(text(vp, v => v === undefined ? '—' : fmt(v))),
)

const aggCell = (label, vp, fmt = fmtPnl, sign = 'auto') => div.agg_cell(
  span.agg_label(label),
  sign === 'pos' ? div.agg_val.pos(text(vp, v => v === undefined ? '—' : fmt(v)))
  : sign === 'neg' ? div.agg_val.neg(text(vp, v => v === undefined ? '—' : fmt(v)))
  : div.agg_val(
      { class: bind(vp, v => v > 0 ? 'pos' : v < 0 ? 'neg' : '') },
      text(vp, v => v === undefined ? '—' : fmt(v)),
    ),
)

/* ---- between: pnl in [-500, 500] ----
 * Static [lo, hi] bounds — v3-valid as-is (§3.2). The output is DENSE: no
 * sparse undefined slots, no hole protocol, so the rows bind straight to the
 * list and pnlCell formats a plain number. */
const bwRows = trades.between('pnl', [-500, 500])
render($$('#between-result'), div(
  div.demo_stat(
    span(text(bwRows.length(), n => `${n} in [−500, 500]`)),
    span.stat_avg(text(bwRows.avg('pnl'), v => 'avg ' + fmtAvg(v))),
  ),
  div.f_rows(list(bwRows, r => div.mrow.f_row(
    { 'data-trade-id': r.id },
    span({ 'data-tenor': r.tenor }, r.id),
    span.last({ 'data-fields': 'last' }, fmt2(r.last)),
    pnlCell(r),
  ))),
))

/* ---- compare: gainers (gt) vs losers (lt) ----
 * Unchanged signatures (§3.3); the threshold could be reactive, but a static
 * 0 is the demo. */
const cmpGainers = trades.gt('pnl', 0)
const cmpLosers  = trades.lt('pnl', 0)
render($$('#compare-result'), div.split.split_2(
  split2Col("gt('pnl', 0)", cmpGainers.length(), cmpGainers),
  split2Col("lt('pnl', 0)", cmpLosers.length(), cmpLosers),
))

/* ---- length(fn): counts per tenor with a live bar ----
 * Buckets are { value: N } wrappers, the same contract as v2 (§3.6) — but the
 * count is read through the CHILD-PATH HANDLE tenorCounts.get(tn).get('value')
 * (child handles are total path addresses, §3.7): text() renders the number,
 * bind() drives the bar-fill style. (kanban-v3 reads the same shape one level
 * up — text(cardsByPerson.get(who), b => b?.value ?? 0) — either form works.)
 * Scale: max bucket on this dataset is ~4, so ×25 fills the bar at 100%. */
const tenorCounts = trades.length(d => d.tenor)
const countOf = tn => tenorCounts.get(tn).get('value')
render($$('#length-result'), div.tcount_block(
  TENORS.map(tn => div.tcount_row(
    span.tcount_label({ 'data-tenor': tn }, tn),
    div.tcount_bar(div.tcount_fill({
      style: bind(countOf(tn), c => `width:${Math.min(100, (c || 0) * 25)}%`),
    })),
    span.tcount_val(text(countOf(tn), c => String(c || 0))),
  )),
))

/* ---- sum / avg / max / min: four live scalars over pnl ----
 * Scalar handles straight into text()/bind() cells (§3.5). v3's sum() is 0
 * over an empty set (not undefined) — moot here, the feed is fixed at 10
 * rows; avg/max/min keep the undefined branch per the §3.5 rule. */
render($$('#aggregate-result'), div.agg_grid(
  aggCell('sum',  trades.sum('pnl')),
  aggCell('avg',  trades.avg('pnl'), fmtAvg),
  aggCell('max',  trades.max('pnl'), fmtPnl, 'pos'),
  aggCell('min',  trades.min('pnl'), fmtPnl, 'neg'),
))

/* ---- some / every: live booleans ----
 * Predicate boolean scalars (§3.5). v2 toggled two class bindings
 * (.class('tru', vp).class('fal', vp.to(b => !b))); v3 collapses that to ONE
 * reactive class value through bind(). */
const anyBig     = trades.some(r => r.pnl > 1000)
const allBounded = trades.every(r => r.pnl > -1900)
const boolCell = (label, vp) => div.bool_cell(
  span.bool_key(label),
  span.bool_val(
    { class: bind(vp, b => b ? 'tru' : 'fal') },
    text(vp, b => b ? '✓ true' : '✗ false'),
  ),
)
render($$('#some-result'), div.bool_grid(
  boolCell('some(pnl > 1000)', anyBig),
  boolCell('every(pnl > −1900)', allBounded),
))

/* ---- intersect: 5Y rows ∩ profitable rows ----
 * Set-op operands are VIEWS in v3 (§3.8) — the v2 filter('tenor','5Y') string
 * form throws at construction, so both operands are predicate filters
 * (defined once, shared with union/except below). Because both derive from
 * the one source they share its minted key domain, which is what makes the
 * set algebra honest — membership is by key, not position. */
const setFiveY   = trades.filter(r => r.tenor === '5Y')
const setGainers = trades.filter(r => r.pnl > 0)
const interSet   = setFiveY.intersect(setGainers)
render($$('#intersect-result'), div.split.split_3(
  split2Col("filter(r=>r.tenor==='5Y')", setFiveY.length(),   setFiveY),
  split2Col("filter(r=>r.pnl>0)",        setGainers.length(), setGainers),
  split2Col('5Y ∩ gainers',              interSet.length(),   interSet),
))

/* ---- union / except: same view operands, two set-algebra results (§3.8) ---- */
const unionSet  = setFiveY.union(setGainers)
const exceptSet = setFiveY.except(setGainers)
render($$('#union-result'), div.split.split_2(
  split2Col('5Y ∪ gainers',  unionSet.length(),  unionSet),
  split2Col('5Y \\ gainers', exceptSet.length(), exceptSet),
))

/* ---- distinct: unique tenors, first seen ----
 * Signature unchanged, but v3's distinct EXPOSES THE PROJECTED VALUE, not the
 * holding source row (§3.10): each row here IS the tenor string, keyed by it.
 * The v2 card also showed the first-seen holder's trade id, which the view no
 * longer carries — so it's looked up from the source snapshot instead. That
 * lookup is stable and honest on this feed: rows are never removed, so source
 * order IS first-seen order and the representative never moves. (NO worked
 * precedent: none of the seven *-v3 examples renders a distinct
 * representative's sibling field.) */
const distTrades = trades.distinct(r => r.tenor)
const firstIdOf = tn => (trades[value].find(t => t.tenor === tn) || {}).id || ''
render($$('#distinct-result'), div(
  div.demo_stat(
    span(text(distTrades.length(), n => `${n} unique tenor${n === 1 ? '' : 's'}`)),
    span.stat_avg('first seen'),
  ),
  div(list(distTrades, tn => div.distinct_chips.distinct_chip(
    span.distinct_chip_tenor({ 'data-tenor': tn }, tn),
    span.distinct_chip_id(firstIdOf(tn)),
  ))),
))

/* ---- map: per-row transform → (id, tenor, spread, pnl) ----
 * Unchanged shape — fn receives (row, key), output rows are plain objects and
 * the derived view keeps the source's minted keys. `spread` derives from
 * bid/ask so its cell flashes on either field (data-fields="bid ask"). */
const mappedRows = trades.map(r => ({
  id: r.id, tenor: r.tenor, pnl: r.pnl,
  spread: +(r.ask - r.bid).toFixed(2),
}))
render($$('#map-result'), div(
  div.demo_stat(
    span(text(mappedRows.length(), n => `${n} rows`)),
    span.stat_avg(text(mappedRows.avg('spread'), v => 'avg spread ' + (v === undefined ? '—' : fmt2(v)))),
  ),
  div.f_rows(list(mappedRows, r => div.mrow.f_row(
    { 'data-trade-id': r.id },
    span({ 'data-tenor': r.tenor }, r.id),
    span.last({ 'data-fields': 'bid ask' }, fmt2(r.spread)),
    pnlCell(r),
  ))),
))

/* ---- reduce: running pnl sum (3-arg incremental), plus a companion mean ----
 * The incremental form is STRICTLY better in v3 (§3.9): an in-place tick (the
 * feed's bread-and-butter) arrives as an update delta CARRYING prev, so it
 * threads as remove(prevRow) + add(newRow) — O(Δ) always. The v2 BU2 rebuild
 * fallback is gone; kanban-v3's points-per-person deck is the worked
 * precedent. `remove` must exactly invert `add`, same contract as v2. */
const sumPnl = trades.reduce(
  (acc, r) => acc + r.pnl, // add
  (acc, r) => acc - r.pnl, // remove — the exact inverse
  0,
)
render($$('#reduce-result'), div.scalar_row(
  scalarCell('Σ pnl', sumPnl, fmtPnl),
  scalarCell('μ pnl', trades.avg('pnl'), fmtAvg),
))

/* ---- tap: count emits, mirror lastTick from the feed ----
 * The v2 card carried a paragraph-long WeakRef workaround (tapEl._tap = …):
 * v2 sinks died silently once V8 reclaimed the only strong reference, so a
 * standalone tap had to be anchored on a DOM node. That hack is DEAD in v3 —
 * operators are STRONG references owned by their parent (§3.11/§5.4); the
 * module-level const below is documentation, not life support. The
 * parameterless fn takes the bare path (fires once per commit batch, plus
 * once at construction — TapNode in v3/ops/misc.ts, the same param-presence
 * dispatch as v2) and runs as a post-settle EFFECT, so writing the counter
 * source from inside it starts a clean follow-on commit. */
const tapN = $({ n: 0 })
let tapCount = 0
const tapEvents = trades.tap(() => tapN.set('n', ++tapCount))
render($$('#tap-result'), div.tap_grid(
  div.tap_block(span.tap_label('events received'), div.tap_counter(text(tapN.get('n')))),
  div.tap_block(span.tap_label('last mutation'),   div.tap_last(text(lastTick))),
))

/* ---- keys / values: projections over shape ----
 * The v2 right column was .reverse() — GONE in v3: a reserved name that
 * throws `reserved name reverse has no implementation yet` (§3.12). The
 * column is .values() instead (an identity view; unordered, §3.10) and the
 * labels say so; the card keeps its #keys-result id. keys() rows are
 * String(key) — the minted integer keys of the array-born feed. */
const tradeKeys   = trades.keys()
const tradeValues = trades.values()
render($$('#keys-result'), div.split.split_2(
  div.split_col(
    div.col_head(
      span.col_head_label('.keys()'),
      span.col_head_count(text(tradeKeys.length(), n => `${n} keys`)),
    ),
    div(list(tradeKeys, s => div.key_chips.kchip(s))),
  ),
  div.split_col(
    div.col_head(
      span.col_head_label('.values()'),
      span.col_head_count(text(tradeValues.length(), n => `${n} rows`)),
    ),
    idPnlRow(tradeValues),
  ),
))

// keep the standing tap referenced for readers grepping "unused" — the graph
// holds it regardless (strong refs); this is purely for lint/clarity.
void tapEvents
