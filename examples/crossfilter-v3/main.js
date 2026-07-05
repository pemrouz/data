// crossfilter, on the v3 engine.
//
// The same demo as ../crossfilter, rewritten on data/v3. Every chart, the
// flight list, and the totals line derive from ONE flights source; each
// dimension is a `between` whose bounds live in a plain reactive `filters`
// source, so brushing is just a write:
//
//   filters.set('date', [lo, hi])
//
// and the whole page — chart bars, counts, the top-80 list — catches up
// incrementally through the keyed delta graph. No scheduler, no manual
// invalidation, no positional bookkeeping.

import { $, value, render, el, text, list, bind } from 'data/v3'

const data = await loadFlights()

// ── parse ─────────────────────────────────────────────────────────────────────

const months = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

// "MMDDhhmm" → Date in 2001
const parseDate = s => new Date(2001, s.slice(0, 2) - 1, s.slice(2, 4), s.slice(4, 6), s.slice(6, 8))

const parseFlight = ({ date, delay, distance, origin, destination }) => {
  const d = parseDate(date)
  return {
    date: d,
    time: d.getHours() + d.getMinutes() / 60,
    delay: Math.max(-60, Math.min(149, delay)),
    distance: Math.min(1999, distance),
    origin,
    destination,
  }
}

// ── the reactive graph ────────────────────────────────────────────────────────

const flights = $(data).map(parseFlight)

// One filter tuple per dimension. [] = unfiltered.
const filters = $({
  date: [+new Date(2001, 1, 1), +new Date(2001, 2, 1)],
  delay: [],
  distance: [],
  time: [],
})

// Each dimension: flights inside that filter's range. The bounds arg is a
// live view of the filters source — a write re-selects via the brush walk.
const dims = {
  time:     flights.between('time',     filters.get('time')),
  delay:    flights.between('delay',    filters.get('delay')),
  distance: flights.between('distance', filters.get('distance')),
  date:     flights.between('date',     filters.get('date')),
}

// A chart shows flights passing every OTHER dimension's filter (so its own
// brush doesn't empty its own bars) — classic crossfilter.
const withoutDim = name =>
  Object.entries(dims).filter(([dim]) => dim !== name).map(([, view]) => view)

const active = flights.intersect(...Object.values(dims))

// grouping keys
const byHour = f => Math.floor(f.time)
const byTenMins = f => Math.floor(f.delay / 10) * 10
const byFiftyMiles = f => Math.floor(f.distance / 50) * 50
const byDay = f => Math.floor(f.date / 86400000) * 86400000

const charts = {
  time: {
    title: 'Time of Day',
    data: flights.intersect(...withoutDim('time')).length(byHour),
    domain: [0, 24], width: 240, ticks: [0, 5, 10, 15, 20], format: String,
  },
  delay: {
    title: 'Arrival Delay (min.)',
    data: flights.intersect(...withoutDim('delay')).length(byTenMins),
    domain: [-60, 150], width: 210, ticks: [-60, -30, 0, 30, 60, 90, 120, 150], format: String,
  },
  distance: {
    title: 'Distance (mi.)',
    data: flights.intersect(...withoutDim('distance')).length(byFiftyMiles),
    domain: [0, 2000], width: 400, ticks: [0, 500, 1000, 1500, 2000], format: String,
  },
  date: {
    title: 'Date',
    data: flights.intersect(...withoutDim('date')).length(byDay),
    domain: [+new Date(2001, 0, 1), +new Date(2001, 3, 1)], width: 900,
    ticks: [+new Date(2001, 0, 1), +new Date(2001, 1, 1), +new Date(2001, 2, 1), +new Date(2001, 3, 1)],
    format: t => months[new Date(t).getMonth()],
    round: t => Math.round(t / 86400000) * 86400000,
  },
}

// The flight list: the 80 most recent active flights (a bounded sort window —
// maintained incrementally, never a full re-sort), grouped into day buckets,
// days ordered newest-first.
const formatDate = d => `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
const dayOf = bucket => +Object.values(bucket)[0].date // members share the day
const recent = active.za('date', 80)
const days = recent.group(f => formatDate(f.date)).za((a, b) => dayOf(a) - dayOf(b))

// debug / test hooks
window.__cf = { flights, filters, dims, active, recent, days, value }

// ── formatting ────────────────────────────────────────────────────────────────

const pad = n => String(n).padStart(2, '0')
const formatTime = d =>
  `${pad(d.getHours() % 12)}:${pad(d.getMinutes())} ${d.getHours() > 12 ? 'PM' : 'AM'}`
const formatDistance = n => `${n.toLocaleString()} mi.`
const formatChange = n => `${n < 0 ? '' : '+'}${n}min.`

// poor man's linear scale
const scale = ([i0, i1], [o0, o1]) => v => i1 === i0 ? 0 : o0 + ((v - i0) / (i1 - i0)) * (o1 - o0)

// ── render ────────────────────────────────────────────────────────────────────

render(document.body, el('div', null,
  el('h1', null, 'crossfilter'),
  el('h2', null, 'fast multidimensional filtering for coordinated views.'),
  el('p', null,
    'The same crossfilter demo as the v2 example, on the v3 engine: every chart, ',
    'the data table, and the totals counter is a keyed reactive view derived from ',
    'one flights source. Brushing a chart writes a filter tuple; dependent views ',
    'recompute incrementally — the brush walk touches only the rows that crossed ',
    'a boundary — and the DOM bindings catch up on their own. Click and drag on any chart.',
  ),
  el('aside', null,
    text(active.length(), n => n.toLocaleString()),
    ' of ',
    text(flights.length(), n => n.toLocaleString()),
    ' flights selected.',
  ),
  el('div', { id: 'charts' },
    ...Object.entries(charts).map(([name, cfg]) => chart(name, cfg)),
  ),
  el('div', { class: 'list' },
    list(days, (bucket, day) => el('div', { class: 'date' },
      el('div', { class: 'day' }, day),
      ...flightsOf(bucket).map(f => el('div', { class: 'flight' },
        el('div', { class: 'time' }, formatTime(f.date)),
        el('div', { class: 'origin' }, f.origin),
        el('div', { class: 'destination' }, f.destination),
        el('div', { class: 'distance' }, formatDistance(f.distance)),
        el('div', { class: `delay${f.delay < 0 ? ' early' : ''}` }, formatChange(f.delay)),
      )),
    )),
  ),
  el('footer', null,
    'Sample data: ',
    el('a', { href: 'http://stat-computing.org/dataexpo/2009/' }, 'ASA Data Expo'),
    ' (US domestic flights, January 2001).',
  ),
))

dismissLoader()

// day buckets render newest-flight-first
function flightsOf(bucket) {
  return Object.values(bucket).sort((a, b) => b.date - a.date)
}

// ── one chart ─────────────────────────────────────────────────────────────────

function chart(name, { data, title, domain, width, ticks, format, round }) {
  const height = 100
  const margin = { top: 10, right: 10, bottom: 20, left: 10 }
  const x = scale(domain, [0, width])
  const rx = scale([0, width], domain)
  const filter = filters.get(name)
  const snap = round || (v => v)

  // filter tuple → pixel geometry (defaults to the full domain when unfiltered)
  const lo = f => x(f?.length ? f[0] : domain[0])
  const span = f => x(f?.length ? f[1] : domain[1]) - lo(f)

  // bar path recomputes from the buckets alone — the peak is derived inside,
  // so the scale can never lag the data by a commit
  const barPath = data.to(groups => {
    const peak = Math.max(1, ...Object.values(groups).map(g => g.value))
    const y = scale([0, peak], [height, 0])
    let d = ''
    for (const key in groups) d += `M${x(+key)},${height}V${y(groups[key].value)}h9V${height}`
    return d
  })

  return el('div', { class: 'chart' },
    el('div', { class: 'title' },
      title,
      el('a', {
        class: 'reset',
        style: bind(filter, f => f?.length ? '' : 'display:none'),
        onClick: () => filters.set(name, []),
      }, 'reset'),
    ),
    el('svg', {
      viewBox: `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`,
      width: width + margin.left + margin.right,
      height: height + margin.top + margin.bottom,
    },
      el('g', { transform: 'translate(10, 10)' },
        el('clipPath', { id: `clip-${name}` },
          el('rect', { height, x: bind(filter, lo), width: bind(filter, span) }),
        ),
        el('path', { class: 'background bar', d: barPath }),
        el('path', { class: 'foreground bar', d: barPath, 'clip-path': `url(#clip-${name})` }),
        el('g', { class: 'axis', transform: `translate(0, ${height})` },
          el('path', { class: 'domain', d: `M0.5,6V0.5H${width - 0.5}V6` }),
          ...ticks.map(t => el('g', { class: 'tick', transform: `translate(${x(t)}, 0)` },
            el('line', { y2: 6 }),
            el('text', { y: 9, dy: '.71em', 'text-anchor': 'middle' }, format(t)),
          )),
        ),
        brush(name, { filter, domain, width, height, x, rx, snap, lo, span }),
      ),
    ),
  )
}

// ── the brush: background drag creates, extent drag moves, handles resize ─────

function brush(name, { filter, domain, width, height, x, rx, snap, lo, span }) {
  // Convert a pointer event to a domain value. The SVG can render narrower
  // than its design width (responsive CSS), so measure the background rect
  // on every drag start and rescale incoming pixels.
  let pxLeft = 0, pxScale = 1
  const measure = bg => {
    const r = bg.getBoundingClientRect()
    pxLeft = r.left
    pxScale = width / r.width
  }
  const domainAt = e => snap(rx((e.x - pxLeft) * pxScale))

  const current = () => filter[value] ?? []
  const write = filters.get(name).raf() // one commit per frame while dragging

  const release = (el2, e) => {
    el2.releasePointerCapture?.(e.pointerId)
    write.flush()
  }

  // drag on the empty background: start a new range
  let down = false, start = 0
  const background = el('rect', {
    class: 'background', width, height,
    onPointerDown: function (e) {
      down = true
      this.setPointerCapture?.(e.pointerId)
      measure(this)
      start = domainAt(e)
      filters.set(name, [start, start])
    },
    onPointerMove: function (e) {
      if (!down) return
      const cur = domainAt(e)
      write(cur > start ? [start, cur] : [cur, start])
    },
    onPointerUp: function (e) { down = false; release(this, e); collapsePoint() },
    onPointerCancel: function (e) { down = false; release(this, e); collapsePoint() },
  })
  const collapsePoint = () => {
    const [a, b] = current()
    if (a === b) filters.set(name, []) // a click without a drag clears
  }

  // drag on the extent: translate the whole range
  let exDown = false, exFrom = 0, exBase = []
  const extent = el('rect', {
    class: 'extent', height,
    x: bind(filter, lo),
    width: bind(filter, f => f?.length ? span(f) : 0),
    onPointerDown: function (e) {
      if (!current().length) return
      exDown = true
      this.setPointerCapture?.(e.pointerId)
      measure(this.parentNode.querySelector('.background'))
      exFrom = rx((e.x - pxLeft) * pxScale)
      exBase = current()
      e.stopPropagation()
    },
    onPointerMove: function (e) {
      if (!exDown) return
      const delta = rx((e.x - pxLeft) * pxScale) - exFrom
      const range = exBase[1] - exBase[0]
      let a = exBase[0] + delta, b = exBase[1] + delta
      if (a < domain[0]) { a = domain[0]; b = a + range }
      else if (b > domain[1]) { b = domain[1]; a = b - range }
      write([snap(a), snap(b)])
    },
    onPointerUp: function (e) { exDown = false; release(this, e) },
    onPointerCancel: function (e) { exDown = false; release(this, e) },
  })

  return el('g', { class: 'brush' }, background, extent,
    resizeHandle(0), resizeHandle(1))

  // one edge handle (i = 0 west, 1 east): drag moves that bound
  function resizeHandle(i) {
    let hDown = false
    const dir = i ? 1 : -1
    const yTop = height / 3
    const grip = `M${.5 * dir},${yTop}A6,6 0 0 ${i} ${6.5 * dir},${yTop + 6}V${2 * yTop - 6}` +
      `A6,6 0 0 ${i} ${.5 * dir},${2 * yTop}ZM${2.5 * dir},${yTop + 8}V${2 * yTop - 8}` +
      `M${4.5 * dir},${yTop + 8}V${2 * yTop - 8}`
    return el('g', {
      class: `resize ${i ? 'e' : 'w'}`,
      transform: bind(filter, f => `translate(${x(f?.length ? f[i] : domain[i])}, 0)`),
      style: bind(filter, f => f?.length ? '' : 'display:none'),
      onPointerDown: function (e) {
        hDown = true
        this.setPointerCapture?.(e.pointerId)
        measure(this.parentNode.querySelector('.background'))
        e.stopPropagation()
      },
      onPointerMove: function (e) {
        if (!hDown) return
        const moved = domainAt(e)
        const other = current()[1 - i]
        write(moved < other ? [moved, other] : [other, moved])
      },
      onPointerUp: function (e) { hDown = false; release(this, e) },
      onPointerCancel: function (e) { hDown = false; release(this, e) },
    },
      el('rect', { x: -3, width: 6, height, style: 'visibility:hidden' }),
      el('path', { d: grip }),
    )
  }
}

// ── loader ────────────────────────────────────────────────────────────────────

async function loadFlights() {
  const loader = document.getElementById('loader')
  const $bar = loader.querySelector('.loader-bar-fill')
  const $pct = loader.querySelector('.loader-pct')
  const $bytes = loader.querySelector('.loader-bytes')
  const $rate = loader.querySelector('.loader-rate')
  const $stat = loader.querySelector('.loader-status')
  const fmtMB = b => (b / 1048576).toFixed(1)

  const t0 = performance.now()
  const res = await fetch('../crossfilter/flights.js')
  const total = +res.headers.get('Content-Length') || 37313858

  const reader = res.body.getReader()
  const chunks = []
  let received = 0
  while (true) {
    const { done, value: chunk } = await reader.read()
    if (done) break
    chunks.push(chunk)
    received += chunk.byteLength
    const elapsed = (performance.now() - t0) / 1000
    $bar.style.width = `${(received / total * 100).toFixed(1)}%`
    $pct.textContent = `${(received / total * 100) | 0}%`
    $bytes.textContent = `${fmtMB(received)} / ${fmtMB(total)} MB`
    $rate.textContent = elapsed > 0.05 ? `${fmtMB(received / elapsed)} MB/s` : '…'
  }

  $bar.style.width = '100%'
  $pct.textContent = '100%'
  $stat.textContent = 'parsing'
  await new Promise(r => requestAnimationFrame(r)) // let the bar paint before the parse blocks

  const url = URL.createObjectURL(new Blob(chunks, { type: 'application/javascript' }))
  const mod = await import(url)
  URL.revokeObjectURL(url)
  return mod.data
}

function dismissLoader() {
  const loader = document.getElementById('loader')
  if (!loader) return
  loader.classList.add('done')
  setTimeout(() => loader.remove(), 360)
}
