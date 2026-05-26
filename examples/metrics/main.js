/* A live metrics board, built on `data`.
 *
 * The shape of the whole app is: one source, a few derived views, one render.
 *
 *   events  — a bounded ring buffer of the most recent requests
 *   byStatus / byEndpoint / byLatency / avgLatency
 *           — derived views the library keeps up to date incrementally
 *   board   — a small presentation view, refreshed once per frame from the above
 *   render  — binds the DOM straight to `board`; no manual DOM updates
 *
 * Events stream in by the thousand per second; each one moves a couple of
 * counters (O(Δ)), never a rescan of the window. We snapshot the maintained
 * aggregates into `board` once per frame and let `render` surgically update only
 * the cells that changed. The single imperative piece is the canvas sparkline. */

import { $, value, render, HTML } from 'data/full'

const { div, span, button, label, input, canvas } = HTML

/* ------------------------------- the domain ------------------------------ */

const WINDOW = 20_000 // keep the last 20k requests; older slots are overwritten

const ENDPOINTS = ['GET /feed', 'GET /user', 'POST /order', 'GET /search', 'GET /price', 'POST /auth', 'GET /chart', 'PUT /cart', 'GET /quote', 'DELETE /sess']
const POPULARITY = [30, 20, 6, 16, 18, 5, 11, 4, 9, 3] // skewed, so the leaderboard has shape
const STATUSES = [200, 201, 304, 400, 404, 429, 500, 503]
const BANDS = [['fast', '< 50ms'], ['ok', '50–200'], ['slow', '200–500'], ['bad', '> 500ms']]

const statusClass = code => code < 300 ? 'ok' : code < 400 ? 'redir' : code < 500 ? 'warn' : 'bad'
const latencyBand = ms => ms < 50 ? 'fast' : ms < 200 ? 'ok' : ms < 500 ? 'slow' : 'bad'

// A tiny request generator with skewed endpoints, per-endpoint latency, and the
// occasional incident that spikes one endpoint's latency and error rate.
const rng = (seed => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)(11)
const weighted = (() => {
  const cumulative = POPULARITY.reduce((acc, w) => (acc.push((acc[acc.length - 1] || 0) + w), acc), [])
  const total = cumulative[cumulative.length - 1]
  return () => { const x = rng() * total; return cumulative.findIndex(c => x < c) }
})()

let incident = { ttl: 0, endpoint: 0 }
function makeEvent () {
  if (rng() < 0.004) incident = { ttl: 100 + (rng() * 120 | 0), endpoint: weighted() }
  const i = weighted()
  const hot = incident.ttl > 0 && i === incident.endpoint
  if (incident.ttl > 0) incident.ttl--

  const baseLatency = 18 + i * 9 + (i === 2 ? 60 : 0) + (hot ? 350 : 0)
  const lat = Math.round(Math.max(2, baseLatency * (0.5 + rng() * 1.4)))

  const errorChance = (i === 2 ? 0.05 : i === 5 ? 0.04 : 0.01) + (hot ? 0.4 : 0)
  const roll = rng()
  const status =
    roll < errorChance ? (rng() < 0.5 ? 500 : 503)
    : roll < errorChance + 0.018 ? (rng() < 0.5 ? 404 : 429)
    : roll < errorChance + 0.032 ? (rng() < 0.5 ? 400 : 304)
    : rng() < 0.04 ? 201
    : 200

  return { endpoint: ENDPOINTS[i], status, lat }
}

/* ================================ the pipeline =========================== */
//
//        events ──┬─ length(e => e.status)    → byStatus     (status codes)
//   (a bounded    ├─ length(e => e.endpoint)  → byEndpoint   (leaderboard)
//    ring buffer) ├─ length(e => band(e.lat)) → byLatency    (distribution)
//                 └─ avg('lat')               → avgLatency   (rolling mean)
//
// Each derived view is maintained incrementally: a single event moves a couple
// of counters / nudges a mean — never a rescan of the 20k-event window.

const seed = {}
for (let i = 0; i < WINDOW; i++) seed[i] = makeEvent()

const events = $(seed)
const byStatus = events.length(e => '' + e.status)
const byEndpoint = events.length(e => e.endpoint)
const byLatency = events.length(e => latencyBand(e.lat))
const avgLatency = events.avg('lat')

/* ---------------------------- the presentation view ---------------------- */

// `length(group)` buckets look like { '200': { value: 4321 }, … }.
const count = (groups, key) => (groups && groups[key] && groups[key].value) || 0
const top = entries => entries.reduce((m, e) => Math.max(m, e.count), 1)

// The view the DOM binds to. Refreshed once per frame in tick();
// every field below maps directly to something on screen. Each bar row carries
// a `name`, a `count`, and a `pct` (its share of the largest bar in the panel).
const board = $({
  rps: 0,
  served: 0,
  avg: 0,
  errorRate: 0,
  status: STATUSES.map(code => ({ name: '' + code, cls: statusClass(code), count: 0, pct: 0 })),
  endpoints: ENDPOINTS.map(name => ({ name, cls: 'ep', count: 0, pct: 0 })),
  latency: BANDS.map(([key, label]) => ({ key, label, count: 0, pct: 0 }))
})

function refreshBoard () {
  const status = byStatus[value], endpoint = byEndpoint[value], latency = byLatency[value]

  const statusRows = STATUSES.map(code => ({ name: '' + code, cls: statusClass(code), count: count(status, '' + code) }))
  const endpointRows = ENDPOINTS.map(name => ({ name, cls: 'ep', count: count(endpoint, name) }))
  const latencyRows = BANDS.map(([key, label]) => ({ key, label, count: count(latency, key) }))

  const errors = STATUSES.filter(c => c >= 400).reduce((n, c) => n + count(status, '' + c), 0)
  const total = STATUSES.reduce((n, c) => n + count(status, '' + c), 0)
  const withPct = (rows, max) => rows.map(r => ({ ...r, pct: Math.round(r.count / max * 100) }))

  board[value] = {
    rps: Math.round(smoothedRps),
    served,
    avg: avgLatency[value] || 0,
    errorRate: total ? errors / total * 100 : 0,
    status: withPct(statusRows, top(statusRows)),
    endpoints: withPct(endpointRows, top(endpointRows)).sort((a, b) => b.count - a.count),
    latency: withPct(latencyRows, top(latencyRows))
  }
}

/* --------------------------------- the view ------------------------------ */

let rate = 12000 // target events/sec (the throughput slider); the rest of the stream state lives below

const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : '' + Math.round(n)
const pct = p => p.to(v => v + '%')

const tile = (key, label, unit = '') => div.tile(
  div.tlabel(label),
  div.tval(span.attr('data-k', key).text(board[key].to(fmtTile[key])), unit && span.tunit(' ' + unit))
)
const fmtTile = {
  rps: fmt, served: fmt,
  avg: v => v.toFixed(1),
  errorRate: v => v.toFixed(2)
}

const horizontalBars = (rows, klass) => div.bars[klass](div(rows, (row, r) => row.bar.nodes(
  span.bname.text(r.name),
  div.btrack(div.bfill.attr('data-cls', r.cls).style('width', pct(r.pct))),
  span.bval.text(r.count.to(fmt))
)))

render(document.body, div.mapp(
  div.mbar(
    span.mbrand('◉  live metrics'),
    label.mrate('throughput ',
      input['type=range']['min=400']['max=40000']['step=200'].attr('value', rate).on('input', e => setRate(+e.target.value)),
      span.mrateout.text(board.rps.to(r => fmt(r) + '/s'))
    ),
    button.mtoggle.on('click', toggle)
  ),

  div.tiles(
    tile('rps', 'requests / sec'),
    tile('served', 'served (total)'),
    tile('avg', 'avg latency', 'ms'),
    tile('errorRate', 'error rate', '%')
  ),

  div.mgrid(
    div.panel.span2(div.ptitle('throughput', span.psub('requests / sec · last 60s')), canvas.spark),
    div.panel(div.ptitle('status codes'), horizontalBars(board.status, 'status')),
    div.panel(div.ptitle('endpoints', span.psub('by request count')), horizontalBars(board.endpoints, 'eps')),
    div.panel(div.ptitle('latency distribution'), div.bands(
      div(board.latency, (col, b) => col.bandcol.nodes(
        div.bandbar(div.bandfill.attr('data-bk', b.key).style('height', pct(b.pct))),
        div.bandval.text(b.count.to(fmt)),
        div.bandlbl.text(b.label)
      ))
    ))
  )
))

/* ------------------------------- the stream ------------------------------ */
// Write events into the ring; the library propagates each into the derived
// views. Once per frame we snapshot those into `board` and redraw the sparkline.

let running = false
let slot = 0
let served = 0
let smoothedRps = 0
let trafficScale = 1 // a slow random walk so throughput wobbles like real load
let lastFrame = 0
let frameId = 0

function tick (now) {
  if (!running) return
  const dt = Math.min(0.1, (now - lastFrame) / 1000)
  lastFrame = now

  trafficScale = clamp(trafficScale + (rng() - 0.5) * 0.08, 0.55, 1.45)
  const n = Math.round(rate * trafficScale * dt)
  for (let i = 0; i < n; i++) { events[slot] = makeEvent(); slot = (slot + 1) % WINDOW }

  served += n
  smoothedRps = smoothedRps ? smoothedRps * 0.9 + (n / dt) * 0.1 : n / dt
  pushSample(smoothedRps)

  refreshBoard()
  drawSparkline()
  frameId = requestAnimationFrame(tick)
}

function toggle () {
  running = !running
  toggleEl.textContent = running ? '⏸ pause' : '▶ run'
  toggleEl.classList.toggle('on', running)
  if (running) { lastFrame = performance.now(); frameId = requestAnimationFrame(tick) }
  else cancelAnimationFrame(frameId)
}

function setRate (v) { rate = v }
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))

/* the one imperative corner: a throughput sparkline on a canvas */
const sparkEl = document.querySelector('.spark')
const sctx = sparkEl.getContext('2d')
const dpr = Math.max(1, devicePixelRatio || 1)
const samples = []
const SAMPLE_CAP = 240
const sizeCanvas = () => { sparkEl.width = sparkEl.clientWidth * dpr; sparkEl.height = sparkEl.clientHeight * dpr }
const pushSample = v => { samples.push(v); if (samples.length > SAMPLE_CAP) samples.shift() }
sizeCanvas()
addEventListener('resize', sizeCanvas)

function drawSparkline () {
  const w = sparkEl.width, h = sparkEl.height
  sctx.clearRect(0, 0, w, h)
  if (samples.length < 2) return
  const max = Math.max(...samples, 1)
  const step = w / (SAMPLE_CAP - 1)
  const y = v => h - (v / max) * (h - 6 * dpr) - 3 * dpr

  sctx.beginPath()
  sctx.moveTo(0, h)
  samples.forEach((v, i) => sctx.lineTo(i * step, y(v)))
  sctx.lineTo((samples.length - 1) * step, h)
  sctx.closePath()
  sctx.fillStyle = 'rgba(255,94,58,0.16)'
  sctx.fill()

  sctx.beginPath()
  samples.forEach((v, i) => i ? sctx.lineTo(i * step, y(v)) : sctx.moveTo(i * step, y(v)))
  sctx.strokeStyle = '#ff5e3a'
  sctx.lineWidth = 1.6 * dpr
  sctx.lineJoin = 'round'
  sctx.stroke()
}

const toggleEl = document.querySelector('.mtoggle')
toggleEl.textContent = '▶ run'
refreshBoard()
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) toggle()
