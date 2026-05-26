/* A live metrics / observability board on `data`.
 *
 * One firehose of request events streams into a fixed-size ring buffer (the last
 * WINDOW events), so the working set is BOUNDED — every frame overwrites the
 * oldest slots with fresh events. The library keeps every panel incrementally:
 *
 *   length(e => e.status)   → status-code breakdown
 *   length(e => e.endpoint) → per-endpoint counts (the leaderboard)
 *   length(e => band(lat))  → latency-band distribution
 *   avg('lat')              → rolling average latency
 *
 * Each of these is O(Δ) per event — a slot overwrite moves a couple of counters
 * and nudges a running mean, no rescan of the window. The reactive numbers are
 * bound to the DOM with `render` (surgical text updates); bar widths + the
 * throughput sparkline are painted once per frame (the real render cadence),
 * reading the already-maintained aggregates.
 *
 * Hand-written `.js`, no `.ts` sibling (see CLAUDE.md). */

if (location.search.includes('devtools')) await import('data/devtools')
import { $, value, render, HTML } from 'data/full'

const { div, span, button, input, label, canvas } = HTML

const WINDOW = 20_000
const ENDPOINTS = ['GET /feed', 'GET /user', 'POST /order', 'GET /search', 'GET /price', 'POST /auth', 'GET /chart', 'PUT /cart', 'GET /quote', 'DELETE /sess']
const STATUSES = [200, 201, 304, 400, 404, 429, 500, 503]
const STATUS_CLASS = s => s < 300 ? 'ok' : s < 400 ? 'redir' : s < 500 ? 'warn' : 'bad'
const BANDS = [['fast', '<50ms'], ['ok', '50–200'], ['slow', '200–500'], ['bad', '>500ms']]
const band = l => l < 50 ? 'fast' : l < 200 ? 'ok' : l < 500 ? 'slow' : 'bad'

function lcg (seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x1_0000_0000 } }
const r = lcg(11)
// per-endpoint base latency + error proclivity so the board has texture
const base = ENDPOINTS.map((_, i) => ({ lat: 18 + i * 9 + (i === 2 ? 60 : 0), err: i === 2 ? 0.05 : i === 5 ? 0.04 : 0.01 }))
// skewed popularity so the leaderboard has shape (and reorders as it warms up)
const WEIGHT = [30, 20, 6, 16, 18, 5, 11, 4, 9, 3]
const CUM = []; { let s = 0; for (const w of WEIGHT) { s += w; CUM.push(s) } }
const TOTW = CUM[CUM.length - 1]
function pickEp () { const x = r() * TOTW; for (let i = 0; i < CUM.length; i++) if (x < CUM[i]) return i; return CUM.length - 1 }
let stress = 0, stressEp = 0 // occasional incident: one endpoint spikes latency + errors

function makeEvent () {
  if (r() < 0.004) { stress = 90 + (r() * 120 | 0); stressEp = (r() * ENDPOINTS.length) | 0 }
  const ep = pickEp()
  const hot = stress > 0 && ep === stressEp
  if (stress > 0) stress--
  const b = base[ep]
  let lat = Math.max(2, (b.lat + (hot ? 350 : 0)) * (0.5 + r() * 1.4))
  let st = 200
  const e = r()
  const errP = b.err + (hot ? 0.4 : 0)
  if (e < errP) st = r() < 0.5 ? 500 : 503
  else if (e < errP + 0.018) st = r() < 0.5 ? 404 : 429
  else if (e < errP + 0.032) st = r() < 0.5 ? 400 : 304
  else if (r() < 0.04) st = 201
  return { endpoint: ENDPOINTS[ep], status: st, lat: Math.round(lat) }
}

/* ---------------- the library's reactive layer ---------------- */
// Seed the ring so the panels read sensibly on first paint.
const seed = {}
for (let i = 0; i < WINDOW; i++) seed[i] = makeEvent()
const events = $(seed)

const byStatus = events.length(e => '' + e.status)
const byEndpoint = events.length(e => e.endpoint)
const byBand = events.length(e => band(e.lat))
const avgLat = events.avg('lat')
const errCount = events.length(e => e.status >= 400 ? 'err' : 'ok')

const cnt = (view, key) => { const o = view[value]; const c = o && o[key]; return (c && c.value) || 0 }

/* ---------------- view ---------------- */
const tile = (k, label, unit) => div.tile(div.tlabel(label), div.tval(span.attr('data-k', k)('—'), unit ? span.tunit(' ' + unit) : ''))

render(document.body, div.mapp(
  div.mbar(
    span.mbrand('◉  live metrics'),
    label.mrate('throughput ', input['type=range']['min=200']['max=40000']['value=12000']['step=200'].on('input', e => { rate = +e.target.value; rateOut.textContent = fmtN(rate) + '/s' }), span.mrateout('—')),
    button.mtoggle.on('click', toggleRun)
  ),
  div.tiles(
    tile('rps', 'requests / sec'),
    tile('served', 'served (total)'),
    tile('avg', 'avg latency', 'ms'),
    tile('err', 'error rate', '%')
  ),
  div.mgrid(
    div.panel.span2(
      div.ptitle('throughput', span.psub('requests / sec · last 60s')),
      canvas.spark
    ),
    div.panel(
      div.ptitle('status codes'),
      div.bars.attr('id', 'status').nodes(...STATUSES.map(s => barRow('s' + s, s, STATUS_CLASS(s), byStatus.to(o => fmtN((o && o['' + s] && o['' + s].value) || 0)))))
    ),
    div.panel(
      div.ptitle('endpoints', span.psub('by request count')),
      div.bars.eps.attr('id', 'eps').nodes(...ENDPOINTS.map(ep => barRow('e' + ep, ep, 'ep', byEndpoint.to(o => fmtN((o && o[ep] && o[ep].value) || 0)))))
    ),
    div.panel(
      div.ptitle('latency distribution'),
      div.bands.nodes(...BANDS.map(([k, lbl]) => div.bandcol(
        div.bandbar.attr('data-band', k).nodes(div.bandfill.attr('data-bk', k)),
        div.bandval.text(byBand.to(o => fmtN((o && o[k] && o[k].value) || 0))),
        div.bandlbl(lbl)
      )))
    )
  )
))

function barRow (k, name, cls, textVP) {
  return div.bar.attr('data-bar', k).nodes(
    span.bname(name),
    div.btrack.nodes(div.bfill.attr('data-fill', k).attr('data-cls', cls)),
    span.bval.text(textVP)
  )
}

/* ---------------- once-per-frame paint (widths + sparkline + tiles) ---------------- */
const $$ = s => document.querySelector(s)
const sparkEl = $$('.spark')
const rateOut = $$('.mrateout')
const toggleEl = $$('.mtoggle')
const setText = (k, v) => { const el = document.querySelector(`[data-k=${k}]`); if (el) el.textContent = v }
const fillEls = {}
for (const el of document.querySelectorAll('[data-fill]')) fillEls[el.getAttribute('data-fill')] = el
const bandFills = {}
for (const el of document.querySelectorAll('[data-bk]')) bandFills[el.getAttribute('data-bk')] = el

const sctx = sparkEl.getContext('2d')
const dpr = Math.max(1, devicePixelRatio || 1)
function sizeSpark () { sparkEl.width = sparkEl.clientWidth * dpr; sparkEl.height = sparkEl.clientHeight * dpr }
sizeSpark(); addEventListener('resize', sizeSpark)

const hist = []; const HCAP = 240
let rate = 12000, served = 0, running = false, raf = 0, lastT = 0, frac = 0
let rpsSmooth = 0, jf = 1 // jf: slow random-walk traffic multiplier so throughput wobbles like real traffic
rateOut.textContent = fmtN(rate) + '/s'

let ptr = 0
function frame (now) {
  if (!running) return
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now
  jf = Math.max(0.55, Math.min(1.45, jf + (r() - 0.5) * 0.08)) // organic traffic wobble
  const owed = rate * jf * dt + frac; const k = Math.floor(owed); frac = owed - k
  for (let i = 0; i < k; i++) { events[ptr] = makeEvent(); ptr = (ptr + 1) % WINDOW }
  served += k

  // smoothed req/s for the tile + sparkline
  const inst = dt > 0 ? k / dt : 0
  rpsSmooth = rpsSmooth ? rpsSmooth * 0.9 + inst * 0.1 : inst
  hist.push(rpsSmooth); if (hist.length > HCAP) hist.shift()

  paint()
  raf = requestAnimationFrame(frame)
}

function paint () {
  // tiles
  setText('rps', fmtN(Math.round(rpsSmooth)))
  setText('served', fmtN(served))
  setText('avg', (avgLat[value] || 0).toFixed(1))
  const total = cnt(errCount, 'ok') + cnt(errCount, 'err')
  setText('err', total ? (cnt(errCount, 'err') / total * 100).toFixed(2) : '0.00')

  // status + endpoint bar widths (relative to the largest in each panel)
  paintBars(byStatus, STATUSES.map(s => ['s' + s, '' + s]))
  paintBars(byEndpoint, ENDPOINTS.map(ep => ['e' + ep, ep]), true)
  // latency bands (relative to window)
  let bmax = 1; for (const [k] of BANDS) bmax = Math.max(bmax, cnt(byBand, k))
  for (const [k] of BANDS) { const f = bandFills[k]; if (f) f.style.height = (cnt(byBand, k) / bmax * 100) + '%' }

  drawSpark()
}

function paintBars (view, rows, reorder) {
  const o = view[value]; let max = 1
  const vals = rows.map(([fk, key]) => { const c = (o && o[key] && o[key].value) || 0; if (c > max) max = c; return [fk, key, c] })
  for (const [fk, , c] of vals) { const el = fillEls[fk]; if (el) el.style.width = (c / max * 100) + '%' }
  if (reorder) { const sorted = vals.slice().sort((a, b) => b[2] - a[2]); sorted.forEach(([fk], i) => { const bar = document.querySelector(`[data-bar=${CSS.escape(fk)}]`); if (bar) bar.style.order = i }) }
}

function drawSpark () {
  const w = sparkEl.width, h = sparkEl.height
  sctx.clearRect(0, 0, w, h)
  if (hist.length < 2) return
  let max = 1; for (const v of hist) if (v > max) max = v
  const step = w / (HCAP - 1)
  const y = v => h - (v / max) * (h - 6 * dpr) - 3 * dpr
  sctx.beginPath(); sctx.moveTo(0, h)
  for (let i = 0; i < hist.length; i++) sctx.lineTo(i * step, y(hist[i]))
  sctx.lineTo((hist.length - 1) * step, h); sctx.closePath()
  sctx.fillStyle = 'rgba(255,94,58,0.16)'; sctx.fill()
  sctx.beginPath()
  for (let i = 0; i < hist.length; i++) { const x = i * step, yy = y(hist[i]); i ? sctx.lineTo(x, yy) : sctx.moveTo(x, yy) }
  sctx.strokeStyle = '#ff5e3a'; sctx.lineWidth = 1.6 * dpr; sctx.lineJoin = 'round'; sctx.stroke()
}

function toggleRun () {
  running = !running
  toggleEl.textContent = running ? '⏸ pause' : '▶ run'
  toggleEl.classList.toggle('on', running)
  if (running) { lastT = performance.now(); raf = requestAnimationFrame(frame) } else cancelAnimationFrame(raf)
}

function fmtN (n) { return n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : '' + n }

toggleEl.textContent = '▶ run'
paint()
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) toggleRun()
Object.assign(window, { metrics: { events, byStatus, avgLat, value } })
