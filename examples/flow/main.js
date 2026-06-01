/* The essay's inline figures.
 *
 * Each section's claim earns one small live demo:
 *   §2  filter is an index, not a recompute    → mountQueryLives
 *   §3  cost of a change is O(Δ), not O(N)     → mountCostDelta
 *   §4  selectivity — pulse along real edges   → mountPulse
 *   §5  composition is graphs of invariants    → mountComposition
 *
 * §1, §6, §7 are prose-only.
 */

import { $, value, render, HTML } from 'data/full'

const { div, span, button, label, select, option, h4, strong } = HTML

mountQueryLives(document.querySelector('#fig-query-lives'))
mountCostDelta (document.querySelector('#fig-cost-delta'))
mountPulse     (document.querySelector('#fig-pulse'))
mountComposition(document.querySelector('#fig-composition'))
mountLog       (document.querySelector('#fig-log'))


/* =========================================================================
 * §2 — A view is a query that lives.
 *
 * Eight orders on the left, click to toggle .active. The right column is
 * `orders.filter(o => o.active)` — a live materialized view. Rows enter and
 * leave it as you click; the runtime maintains membership in place.
 * ========================================================================= */
function mountQueryLives (target) {
  const orders = $([
    { id: 1, active: true,  value: 87 },
    { id: 2, active: false, value: 42 },
    { id: 3, active: true,  value: 65 },
    { id: 4, active: true,  value: 91 },
    { id: 5, active: false, value: 28 },
    { id: 6, active: true,  value: 74 },
    { id: 7, active: false, value: 53 },
    { id: 8, active: true,  value: 36 }
  ])

  const active = orders.filter(o => o.active)

  // Iterate `orders` in both columns and toggle a `.hide` placeholder for
  // rows that don't pass the predicate. This keeps each filtered slot
  // vertically aligned with its source row — and (incidentally) sidesteps
  // a row-removal corruption bug in the iterated filter view.
  render(target, div.qfig(
    div.qcount.text(active.length().to(n =>
      `filter view: ${n} of 8 rows pass. click any row to toggle.`
    )),
    div.qfig_cols(
      div.qfig_col(
        h4('$(orders)'),
        div(orders, (node, row) => node
          .qrow
          .class('on',  row.active)
          .class('off', row.active.to(a => !a))
          .on('click', () => { row.active = !row.active[value] })
          .nodes(
            span.qid.text(row.id.to(id => '#' + id)),
            span.qval.text(row.value)
          )
        )
      ),
      div.qfig_col(
        h4('orders.filter(o => o.active)'),
        div(orders, (node, row) => node
          .qrow.slot
          .class('show', row.active)
          .class('hide', row.active.to(a => !a))
          .nodes(
            span.qid.text(row.id.to(id => '#' + id)),
            span.qval.text(row.value)
          )
        )
      )
    )
  ))
}


/* =========================================================================
 * §3 — The cost of a change is the size of the change.
 *
 * We instrument each operator with a tap that increments a counter every
 * time a row event passes through. Resetting the counter to zero right
 * before each insert lets us read off the exact O(Δ) cost — and watch it
 * stay constant as the dataset N scales from 60 to 60,000.
 * ========================================================================= */
function mountCostDelta (target) {
  let work = 0

  const buildDataset = n => Array.from({ length: n }, (_, i) => ({
    id: i, active: i % 3 !== 0, value: 50 + ((i * 37) % 90)
  }))

  const orders  = $(buildDataset(60))
  const active  = orders.filter(o => o.active)
  const count   = active.length()
  const total   = active.sum('value')

  // Strong refs so the WeakRef sinks aren't collected — without these the
  // tap callbacks vanish on the first GC and the counter stops advancing.
  const taps = [
    active.tap(c => { work++ }),
    count .tap(c => { work++ }),
    total .tap(c => { work++ })
  ]

  const state = $({ n: 60, work: 0 })

  function setN (n) {
    orders[value] = buildDataset(n)
    state.n = n
    state.work = 0
  }
  function insertOne () {
    work = 0
    const id = state.n[value] + 1
    orders.insert({ id, active: true, value: 50 + ((id * 37) % 90) })
    state.n = id
    state.work = work
    flashCell()
  }
  function flashCell () {
    const el = target.querySelector('[data-stat=real] .cstat-v')
    if (!el) return
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash')
  }

  render(target, div.cfig(
    div.cfig_meta(
      label(
        span('dataset size N'),
        select.on('change', ev => setN(+ev.target.value)).nodes(
          option['value=60']('60'),
          option['value=600']('600'),
          option['value=6000']('6,000'),
          option['value=60000']('60,000')
        )
      )
    ),
    div.cfig_stats(
      div.cstat.attr('data-stat', 'n').nodes(
        div.cstat_l('current size'),
        div.cstat_v.text(state.n.to(n => n.toLocaleString()))
      ),
      div.cstat.real.attr('data-stat', 'real').nodes(
        div.cstat_l('work this insert'),
        div.cstat_v.text(state.work.to(w => w + ' events'))
      ),
      div.cstat.naive.attr('data-stat', 'naive').nodes(
        div.cstat_l('naive recompute'),
        div.cstat_v.text(state.n.to(n => (2 * n).toLocaleString() + ' reads'))
      )
    ),
    div.cfig_action(
      button.cbtn.text('insert 1 row').on('click', insertOne)
    ),
    div.cnote(
      'A naive count + filter scans the whole dataset on every change. ' +
      'Incremental maintenance pays only for the delta — bounded operator ' +
      'work regardless of N.'
    )
  ))
}


/* =========================================================================
 * §4 — Selectivity: pulses walk the edges the change actually touches.
 *
 *   $(orders) ─┬─ filter(o => o.active) ─┬─ length()      → count
 *              │                         └─ sum('value')  → total
 *              └─ avg('value')                            → avg
 *
 * Three triggers, each with a different propagation footprint. While the
 * figure is on-screen we cycle through them every few seconds; clicking
 * pauses the auto-loop and fires the chosen one directly.
 * ========================================================================= */
function mountPulse (target) {
  const N = 60
  const orders = $(Array.from({ length: N }, (_, i) => ({
    id: i, active: i % 3 !== 0, value: 50 + ((i * 37) % 90)
  })))

  const active  = orders.filter(o => o.active)
  const count   = active.length()
  const total   = active.sum('value')
  const average = orders.avg('value')

  const fires = []
  const taps  = [
    active .tap(() => fires.push('filter')),
    count  .tap(() => fires.push('length')),
    total  .tap(() => fires.push('sum')),
    average.tap(() => fires.push('avg'))
  ]

  const display = $({ count: 0, total: 0, average: 0 })
  const refresh = () => {
    display[value] = {
      count: count[value]   || 0,
      total: total[value]   || 0,
      average: average[value] || 0
    }
  }
  const fmt2 = n => (+n).toFixed(2)

  render(target, div.pfig(
    div.pfig_stage(
      div.pgraph_host.attr('id', 'pgraph-host'),
      div.ppanel(
        div.ppanel_h('rendered values'),
        div.prow(span.plabel('count'),    span.pval.attr('data-k', 'count').text(display.count.to(n => '' + n))),
        div.prow(span.plabel('Σ value'),  span.pval.attr('data-k', 'sum').text(display.total.to(fmt2))),
        div.prow(span.plabel('avg value'), span.pval.attr('data-k', 'avg').text(display.average.to(fmt2)))
      )
    ),
    div.pcontrols(
      button.pbtn.attr('data-fire', 'active').nodes(
        span.pbtn_t("toggle a row's active flag"),
        span.pbtn_h('lights filter → length, sum')
      ),
      button.pbtn.attr('data-fire', 'value').nodes(
        span.pbtn_t("change a row's value"),
        span.pbtn_h('lights avg + sum')
      ),
      button.pbtn.attr('data-fire', 'add').nodes(
        span.pbtn_t('append a new row'),
        span.pbtn_h('lights every reachable path')
      )
    ),
    div.pauto.attr('id', 'pauto').text('auto-cycling while visible')
  ))

  /* ---- build the SVG graph (inside #pgraph-host) ---- */
  const SVG_NS = 'http://www.w3.org/2000/svg'
  const NODES = {
    source: { x: 110, y: 220, w: 160, h: 134, label: '$(orders)', sub: '60 rows', labelTop: true },
    filter: { x: 360, y: 110, w: 150, h: 56,  label: 'filter',    sub: 'o => o.active' },
    length: { x: 590, y:  60, w: 130, h: 56,  label: 'length()' },
    sum:    { x: 590, y: 160, w: 130, h: 56,  label: 'sum',       sub: "'value'" },
    avg:    { x: 360, y: 330, w: 150, h: 56,  label: 'avg',       sub: "'value'" }
  }
  const EDGES = [
    { from: 'source', to: 'filter', via: 'filter' },
    { from: 'source', to: 'avg',    via: 'avg' },
    { from: 'filter', to: 'length', via: 'length' },
    { from: 'filter', to: 'sum',    via: 'sum' }
  ]

  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 820 430')
  svg.setAttribute('class', 'pgsvg')
  target.querySelector('#pgraph-host').appendChild(svg)

  const mkG = cls => { const g = document.createElementNS(SVG_NS, 'g'); g.setAttribute('class', cls); svg.appendChild(g); return g }
  const edgeLayer  = mkG('edges')
  const pulseLayer = mkG('pulses')
  const nodeLayer  = mkG('nodes')

  const edgePaths = new Map()
  for (const e of EDGES) {
    const a = NODES[e.from], b = NODES[e.to]
    const x1 = a.x + a.w / 2, y1 = a.y
    const x2 = b.x - b.w / 2, y2 = b.y
    const cx1 = x1 + (x2 - x1) * 0.55
    const cx2 = x2 - (x2 - x1) * 0.55
    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', `M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`)
    path.setAttribute('class', 'edge')
    edgeLayer.appendChild(path)
    edgePaths.set(e.from + '_' + e.via, path)
  }

  for (const [id, n] of Object.entries(NODES)) {
    const g = document.createElementNS(SVG_NS, 'g')
    g.setAttribute('class', id === 'source' ? 'node source' : 'node')
    g.setAttribute('data-node', id)
    g.setAttribute('transform', `translate(${n.x - n.w / 2}, ${n.y - n.h / 2})`)
    const labelY = n.labelTop ? 22 : n.h / 2 - (n.sub ? 6 : -4)
    const subY   = n.labelTop ? 38 : n.h / 2 + 14
    g.innerHTML = `
      <rect class="bg" width="${n.w}" height="${n.h}" rx="10"></rect>
      <text class="label" x="${n.w / 2}" y="${labelY}" text-anchor="middle">${n.label}</text>
      ${n.sub ? `<text class="sub" x="${n.w / 2}" y="${subY}" text-anchor="middle">${n.sub}</text>` : ''}
    `
    nodeLayer.appendChild(g)
  }

  // Visual row strip inside the source node — gives a "row 43" focal point.
  const srcInner = document.createElementNS(SVG_NS, 'g')
  srcInner.setAttribute('transform',
    `translate(${NODES.source.x - NODES.source.w / 2 + 14}, ${NODES.source.y - NODES.source.h / 2 + 52})`)
  const SRC_ROWS = 8, HIGHLIGHT = 3
  for (let i = 0; i < SRC_ROWS; i++) {
    const r = document.createElementNS(SVG_NS, 'rect')
    r.setAttribute('class', i === HIGHLIGHT ? 'srow target' : 'srow')
    r.setAttribute('x', 0); r.setAttribute('y', i * 9)
    r.setAttribute('width', 132); r.setAttribute('height', 6); r.setAttribute('rx', 2)
    srcInner.appendChild(r)
  }
  nodeLayer.appendChild(srcInner)

  const nodeEl = id => svg.querySelector(`[data-node="${id}"]`)
  const edgeEl = (from, via) => edgePaths.get(from + '_' + via)

  /* ---- pulse animation along path geometry ---- */
  const PULSE_MS = 380
  const pulseAlongEdge = (from, to, done) => {
    const path = edgeEl(from, to)
    if (!path) return done?.()
    path.classList.add('lit')
    const length = path.getTotalLength()
    const dot = document.createElementNS(SVG_NS, 'circle')
    dot.setAttribute('class', 'pulse'); dot.setAttribute('r', 6)
    pulseLayer.appendChild(dot)
    const start = performance.now()
    const step = now => {
      const t = Math.min(1, (now - start) / PULSE_MS)
      const e = t * t * (3 - 2 * t)
      const p = path.getPointAtLength(length * e)
      dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y)
      if (t < 1) requestAnimationFrame(step)
      else { dot.remove(); done?.() }
    }
    requestAnimationFrame(step)
  }
  const landOn = id => {
    const el = nodeEl(id); if (!el) return
    el.classList.add('lit')
    setTimeout(() => el.classList.remove('lit'), 700)
  }
  async function animatePath (origin, hops) {
    landOn(origin)
    for (const hop of hops) {
      const edge = EDGES.find(e => e.via === hop)
      if (!edge) continue
      await new Promise(r => pulseAlongEdge(edge.from, edge.via, r))
      landOn(hop)
    }
  }
  const flashPanelCell = key => {
    const el = target.querySelector(`[data-k="${key}"]`)
    if (!el) return
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash')
  }

  /* ---- triggers ---- */
  // Two target rows so each trigger reliably walks its claimed path
  // regardless of prior interactions:
  //   TOGGLE_ROW is operated on by 'active' (membership flips in/out).
  //   VALUE_ROW is kept permanently active so 'value' always flows through
  //   filter → sum, not just avg.
  const TOGGLE_ROW = 6   // 6 % 3 = 0 → seeded inactive; toggles in/out
  const VALUE_ROW  = 43  // 43 % 3 = 1 → seeded active; never toggled
  function fire (kind) {
    fires.length = 0
    if (kind === 'active')      orders[TOGGLE_ROW].active = !orders[TOGGLE_ROW].active[value]
    else if (kind === 'value')  orders[VALUE_ROW].value   = (orders[VALUE_ROW].value[value] || 0) + 17
    else if (kind === 'add')    orders.insert({ id: N + Math.floor(Math.random() * 1e6), active: true, value: 80 + (Math.random() * 40 | 0) })

    const hops = fires.slice()
    // Update the values panel + flash affected cells IMMEDIATELY so the
    // click feels instantly responsive. The pulse animation is a visual
    // trace of which edges the change walked — decorative, not load-bearing.
    refresh()
    if (hops.includes('length') || hops.includes('filter')) flashPanelCell('count')
    if (hops.includes('sum')) flashPanelCell('sum')
    if (hops.includes('avg')) flashPanelCell('avg')
    animatePath('source', hops)
  }

  for (const btn of target.querySelectorAll('[data-fire]')) {
    btn.addEventListener('click', () => {
      stopAuto()  // user took control
      // Visual confirmation that THIS click registered, separate from the
      // pulse + values update — the button itself flashes briefly.
      btn.classList.remove('pbtn-fired'); void btn.offsetWidth; btn.classList.add('pbtn-fired')
      fire(btn.getAttribute('data-fire'))
    })
  }

  /* ---- auto-loop while visible ---- */
  let autoTimer = null
  let cycleIdx  = 0
  const order   = ['active', 'value', 'add', 'value', 'active']
  const pauto   = target.querySelector('#pauto')
  function startAuto () {
    if (autoTimer) return
    pauto.classList.add('on')
    pauto.textContent = 'auto-cycling while visible'
    autoTimer = setInterval(() => {
      fire(order[cycleIdx % order.length])
      cycleIdx++
    }, 2400)
  }
  function stopAuto () {
    if (!autoTimer) return
    clearInterval(autoTimer); autoTimer = null
    pauto.classList.remove('on')
    pauto.textContent = 'click a trigger to fire — or scroll away & back to resume auto'
  }
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.isIntersecting) startAuto()
      else stopAuto()
    }
  }, { threshold: 0.25 })
  io.observe(target)

  refresh()
}


/* =========================================================================
 * §6 — The log is the source of truth; state is the fold.
 *
 * We tap the source's change stream and append every record to a visible
 * log. The "rebuilt state" panel on the right is literally
 * `log.reduce(apply, [])` — so the user can see that the array they're
 * mutating IS the fold of the record stream. A "replay from scratch"
 * button blanks the state and re-folds the log to prove it.
 * ========================================================================= */
function mountLog (target) {
  // We deliberately drive this demo OUTSIDE the lib's state so the
  // reduction is transparent: every mutation is recorded as a plain
  // {type, key, value} object; the current orders array is computed by
  // folding that log on demand.
  const log = []          // append-only sequence of change records
  let nextId = 1
  const view = $({ orders: [], rebuilt: [], lastRecord: null })

  function refold () {
    const acc = []
    for (const r of log) apply(acc, r)
    view.rebuilt = acc
  }

  function apply (acc, r) {
    if (r.type === 'insert') acc.push({ id: r.key, ...r.value })
    else if (r.type === 'update') {
      const row = acc.find(x => x.id === r.key); if (row) row[r.field] = r.value
    } else if (r.type === 'remove') {
      const i = acc.findIndex(x => x.id === r.key); if (i >= 0) acc.splice(i, 1)
    }
  }

  function emit (record) {
    log.push(record)
    // Live state advances forward by applying the one record.
    const next = view.orders[value].slice()
    apply(next, record)
    view.orders = next
    view.lastRecord = record
    refold()  // rebuild from-scratch state too, so user can compare
  }

  function doInsert () {
    const id = nextId++
    emit({ type: 'insert', key: id, value: { active: id % 2 === 1, value: 40 + Math.floor(Math.random() * 60) } })
  }
  function doUpdate () {
    const live = view.orders[value]
    if (!live.length) return doInsert()
    const row = live[Math.floor(Math.random() * live.length)]
    emit({ type: 'update', key: row.id, field: 'value', value: row.value + 11 })
  }
  function doRemove () {
    const live = view.orders[value]
    if (!live.length) return
    const row = live[Math.floor(Math.random() * live.length)]
    emit({ type: 'remove', key: row.id })
  }
  function doReplay () {
    // Blank the rebuilt state, then walk the log forward — this is what
    // the operators do internally, made visible.
    view.rebuilt = []
    refold()
  }

  // Seed a few records so the log isn't empty on first paint.
  ;[1,2,3].forEach(doInsert)

  render(target, div.lfig(
    div.lfig_cols(
      div.lfig_col(
        h4('change log'),
        div.lfig_loglist.attr('id', 'loglist'),
        div.lfig_meta.text(view.lastRecord.to(r =>
          r ? `${log.length} records · last: ${r.type}` : `${log.length} records`
        ))
      ),
      div.lfig_col(
        h4('state = log.reduce(apply, [])'),
        div.lfig_state.attr('id', 'staterows')
      )
    ),
    div.lfig_controls(
      button.cbtn.text('insert').on('click', doInsert),
      button.cbtn.text('update random').on('click', doUpdate),
      button.cbtn.text('remove random').on('click', doRemove),
      button.cbtn.text('replay from scratch').on('click', doReplay)
    )
  ))

  // Render the log and state imperatively — they're short lists whose
  // shape is just plain text, and this keeps the demo's "I'm doing a fold
  // by hand" framing honest without dragging another iteration concern in.
  const loglist  = target.querySelector('#loglist')
  const staterows = target.querySelector('#staterows')
  const fmtRec = r => {
    if (r.type === 'insert') return `▸ insert #${r.key} → ${JSON.stringify(r.value)}`
    if (r.type === 'update') return `▸ update #${r.key}.${r.field} = ${r.value}`
    if (r.type === 'remove') return `▸ remove #${r.key}`
    return JSON.stringify(r)
  }
  const renderLog = () => {
    loglist.innerHTML = ''
    const tail = log.slice(-8)
    if (log.length > 8) loglist.innerHTML = `<div class="lrec faint">… ${log.length - 8} earlier records</div>`
    for (const r of tail) {
      const d = document.createElement('div')
      d.className = 'lrec'
      d.textContent = fmtRec(r)
      loglist.appendChild(d)
    }
    // Flash the freshest record
    if (loglist.lastElementChild) loglist.lastElementChild.classList.add('fresh')
  }
  const renderState = () => {
    const rows = view.rebuilt[value] || []
    staterows.innerHTML = ''
    if (!rows.length) {
      staterows.innerHTML = '<div class="lrow faint">∅ empty</div>'
      return
    }
    for (const row of rows) {
      const d = document.createElement('div')
      d.className = 'lrow'
      d.textContent = `#${row.id}  active: ${row.active}  value: ${row.value}`
      staterows.appendChild(d)
    }
  }
  // Re-render on each tick. Kept alive in `taps` so WeakRef won't reap them.
  const taps = [
    view.lastRecord.tap(() => renderLog()),
    view.rebuilt   .tap(() => renderState())
  ]
  renderLog(); renderState()
}


/* =========================================================================
 * §5 — Composition: pipelines are graphs of small invariants.
 *
 * Two operators in series: filter the active rows, then count them by
 * region. The result is a live record { north: 7, south: 9, ... } that the
 * runtime maintains in place as you mutate the source.
 * ========================================================================= */
function mountComposition (target) {
  const REGIONS = ['north', 'south', 'east', 'west']
  const orders = $(Array.from({ length: 40 }, (_, i) => ({
    id: i,
    active: i % 5 !== 0,
    region: REGIONS[i % 4]
  })))

  const active    = orders.filter(o => o.active)
  const perRegion = active.length(o => o.region)

  // length(fn) buckets to {key: {value: n}}, so the count lives one hop
  // deeper at perRegion[r].value (not perRegion[r] itself, which is the
  // bucket object).
  const countOf = r => perRegion[r].value

  // Flash a cell's count display whenever it changes. Keeping these taps
  // alive in `cellTaps` prevents the WeakRef sink from collecting them.
  const cellTaps = REGIONS.map(r => countOf(r).tap(() => flashRegion(r)))
  function flashRegion (r) {
    const el = target.querySelector(`[data-r="${r}"] .gcell-v`)
    if (!el) return
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash')
  }

  render(target, div.gfig(
    div.gfig_grid(
      ...REGIONS.map(r => div.gcell.attr('data-r', r).nodes(
        div.gcell_k(r),
        div.gcell_v.text(countOf(r).to(v => v == null ? '0' : String(v)))
      ))
    ),
    div.gfig_controls(
      button.cbtn.text('toggle a random row').on('click', () => {
        const i = Math.floor(Math.random() * orders[value].length)
        orders[i].active = !orders[i].active[value]
      }),
      button.cbtn.text('insert into a random region').on('click', () => {
        const r = REGIONS[Math.floor(Math.random() * 4)]
        const id = 1000 + Math.floor(Math.random() * 1e6)
        orders.insert({ id, active: true, region: r })
      })
    )
  ))
}
