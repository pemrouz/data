/* sections/race.js — the centrepiece, four variants.
 *
 * d (THE PICK) · ALL THREE STAGES on the REAL engine (see race.md).
 *   STAGE 1 — the ORDER BOOK: `orders = $(initial)` object-born, N rows built
 *   lazily in chunks across frames when the section nears the viewport; the
 *   four views of the old data lane (filter→length, avg, length(bucket)×2);
 *   every frame's ticks land in ONE batch() whose performance.now() cost is
 *   the µs/frame figure; every printed digit is attested (runtime = a view's
 *   value / rowCount() / a delta; measured = performance.now in this tab).
 *   STAGE 2 — the eight PEERS are the real libraries (race/peers.js), each
 *   loaded from esm.sh only when selected, built on its own structuredClone
 *   of the live book, fed the same ticks every frame and settled once per
 *   frame inside the same kind of performance.now() window — the peer's
 *   ms/frame, the wave's accent line and the "N× data" multiple are two
 *   measurements from this tab. STAGE 3 — the BRUSHING card: the REAL flights
 *   (data/flights.js, 37 MB) fetched + parsed in a Worker (race/flights-
 *   worker.js) when the section nears the viewport, the rows built in chunks
 *   across frames, then `$(flights)` and the old data lane's graph
 *   (race/brush.js: four reactive `between`s, leave-one-out `intersect` →
 *   `length(bin)` histograms, `intersect(all four).length()`), one engine step
 *   per frame behind an attested progress line; a brush handle is one
 *   `filters.get(name).update([lo, hi])` timed with performance.now() (settle
 *   included) → ms/brush + session p50 / p95 / n; the bars are the buckets'
 *   values, the readout is count[value] of rowCount(). The brushing card
 *   SWITCHES with the carousel too (race/brush-peers.js): the selected
 *   library's own brushing lane is built over the same adopted rows, seeded
 *   with data's bounds, and every drag goes through data's write first (the
 *   baseline) and then the peer in an identical window — the card's ms/brush,
 *   p50 / p95 / n are the peer's, the charts draw its histograms, the readout
 *   its count (asserted equal to data's — race.brush.lockstep).
 * a · b · c (not picked, untouched) · UI-only smoke: canned peer curves, a
 *   typed-array random walk, canned flight bins. Every NAME is the real v4
 *   surface. They run only while shown ('variantshow' / 'varianthide').
 *
 * The depth chart / price ladder / cpu wave drawing is lifted from the old
 * race-views.js and adapted; the brush charts re-draw the old multidim chart.js
 * grammar on canvas. Loops pause when hidden, off-screen, or the tab is hidden. */
import { api, attest, put, fmt, onFrame, REDUCED } from '../engine.js'
import { loadPeer, DEF_RATE, peerVersion } from './race/peers.js'   // d only: the eight peer adapters (nothing loads until a selection)
import { makeBrushLane } from './race/brush.js'                     // d only: the brushing card's real graph + charts
import { loadBrushPeer } from './race/brush-peers.js'               // d only: the eight brushing peer lanes (nothing loads until a selection)
import { makeFlightsLoader } from './race/flights.js'               // d only: the flights, off the main thread (nothing fetches until the section nears)

const q = (s, r = document) => r.querySelector(s)
const dpr = () => Math.min(1.5, window.devicePixelRatio || 1)
const fmtInt = n => Math.round(n).toLocaleString('en-US')
const fmtMs = ms => ms < 1 ? (ms * 1000).toFixed(0) + ' µs' : ms.toFixed(2) + ' ms'
const fmtCpu = ms => ms < 1 ? (ms * 1000).toFixed(0) + ' µs/frame' : ms.toFixed(2) + ' ms/frame'
const fmtRatio = r => (r >= 10 ? Math.round(r) : r.toFixed(1)) + '×'
const fmtRate = r => r >= 1e3 ? (r / 1e3).toFixed(1) + 'k' : '' + r
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
function lcg (seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x1_0000_0000 } }
function gaussFrom (rand) {
  let z2 = null
  return () => {
    if (z2 != null) { const z = z2; z2 = null; return z }
    let u = 0, v = 0; while (u === 0) u = rand(); while (v === 0) v = rand()
    const m = Math.sqrt(-2 * Math.log(u)); z2 = m * Math.sin(2 * Math.PI * v); return m * Math.cos(2 * Math.PI * v)
  }
}
const gauss = gaussFrom(Math.random)
const CSS = getComputedStyle(document.documentElement)
const tok = name => CSS.getPropertyValue(name).trim()
const COLOR = { accent: tok('--accent') || '#ff5e3a', pos: tok('--pos') || '#67dba1', rule: tok('--rule') || '#26262b', faint: tok('--faint') || '#80807a', dim: tok('--dim') || '#9a9a93', warn: tok('--warn') || '#ff4d3d' }
const MONO = tok('--mono') || 'ui-monospace, Menlo, monospace'

/* ---------- a loop runner: shown × on-screen × not paused × tab visible ---------- */
function runner ({ root, frame, build }) {
  let running = false, raf = 0, visible = false, shown = !root.hidden, paused = false, last = 0, built = false
  const ensure = () => { if (!built && shown) { built = true; build() } }
  const tick = now => { if (!running) return; frame(now, Math.min(100, Math.max(0, now - last))); last = now; raf = requestAnimationFrame(tick) }
  function sync () {
    ensure()
    const want = shown && visible && !paused && !document.hidden && !REDUCED
    if (want && !running) { running = true; last = performance.now(); raf = requestAnimationFrame(tick) }
    else if (!want && running) { running = false; cancelAnimationFrame(raf) }
  }
  root.addEventListener('variantshow', () => { shown = true; sync() })
  root.addEventListener('varianthide', () => { shown = false; sync() })
  if ('IntersectionObserver' in window) new IntersectionObserver(es => { visible = es.some(e => e.isIntersecting); sync() }, { threshold: 0.02 }).observe(root)
  else visible = true
  document.addEventListener('visibilitychange', sync)
  ensure()
  return { sync, setPaused (p) { paused = p; sync() }, get paused () { return paused }, get running () { return running }, get shown () { return shown } }
}

/* =========================================================================
 * workload 1: a drifting order book — 150,000 orders, O(1) per tick
 * (the OU walk is the old race.js one; the per-order arrays make the bucket
 * counts, the liquid count and the running mean exact and O(1) per tick)
 * ========================================================================= */
const N = 150000, BINS = 15, P_LO = 50, P_HI = 100, THRESH = 24, MID0 = 75
const P_STEP = (P_HI - P_LO) / BINS
const VIEW_LO = 56, VIEW_HI = 94
const bucketOf = p => p <= P_LO ? 0 : p >= P_HI ? BINS - 1 : Math.floor((p - P_LO) / (P_HI - P_LO) * BINS)
const bucketPrice = i => P_LO + (i + 0.5) * P_STEP
const MID_BUCKET = bucketOf(MID0)

function makeBook (seed = 7) {
  const r = lcg(seed), nz = gaussFrom(lcg(Math.imul(seed, 2654435761) >>> 0))
  const DT = 0.1, t0 = performance.now(), sdt = Math.sqrt(DT)
  const MID_THETA = 0.2, MID_SIGMA = 3 * Math.sqrt(2 * MID_THETA)
  let mid = MID0, spread = 12, imb = 0, step = 0
  const advance = () => {
    mid += MID_THETA * (MID0 - mid) * DT + MID_SIGMA * sdt * nz()
    mid = Math.max(P_LO + 10, Math.min(P_HI - 10, mid))
    spread += 0.1 * (12 - spread) * DT + 3 * sdt * nz(); spread = Math.max(6, Math.min(20, spread))
    imb += 0.1 * (0 - imb) * DT + 0.25 * sdt * nz(); imb = Math.max(-0.3, Math.min(0.3, imb))
  }
  const sync = () => { const want = ((performance.now() - t0) / 1000 / DT) | 0; while (step < want) { step++; advance() } }
  const hs = () => 4 + Math.min(r(), r()) * spread
  const bid = new Float32Array(N), ask = new Float32Array(N), bb = new Uint8Array(N), ab = new Uint8Array(N)
  const bids = new Array(BINS).fill(0), asks = new Array(BINS).fill(0)
  let liquid = 0, sumBid = 0, hitB = MID_BUCKET, hitS = 1
  for (let i = 0; i < N; i++) {
    const h = hs(), b = mid - h, a = mid + h
    bid[i] = b; ask[i] = a; bb[i] = bucketOf(b); ab[i] = bucketOf(a); bids[bb[i]]++; asks[ab[i]]++
    sumBid += b; if (a - b > THRESH) liquid++
  }
  function tick () {
    sync()
    const i = (r() * N) | 0, h = hs()
    const was = ask[i] - bid[i] > THRESH
    if (r() < 0.5 + imb) { const nv = mid + h; asks[ab[i]]--; ask[i] = nv; ab[i] = bucketOf(nv); asks[ab[i]]++; hitB = ab[i]; hitS = 1 }
    else { const nv = mid - h; sumBid += nv - bid[i]; bids[bb[i]]--; bid[i] = nv; bb[i] = bucketOf(nv); bids[bb[i]]++; hitB = bb[i]; hitS = -1 }
    const is = ask[i] - bid[i] > THRESH
    if (is !== was) liquid += is ? 1 : -1
  }
  // hitBucket/hitSide: the price level the LAST tick landed on (variant d flashes it)
  return { tick, sync, bids, asks, get liquid () { return liquid }, get avg () { return sumBid / N }, get mid () { return mid }, get imb () { return imb }, get hitBucket () { return hitB }, get hitSide () { return hitS } }
}

/* ---------- the order-book viz: depth chart (canvas) + price ladder (DOM) ---------- */
function setupOrderbook (host) {
  const canvas = host.querySelector('canvas')
  const ladder = host.querySelector('.ob-ladder')
  const ctx = canvas.getContext('2d')
  const st = { ctx, w: 0, h: 0, askRows: [], bidRows: [], scaleRef: { v: 1 } }
  function resize () {
    const d = dpr(), rect = canvas.getBoundingClientRect()
    st.w = Math.max(120, Math.round(rect.width)); st.h = Math.max(120, Math.round(rect.height))
    canvas.width = st.w * d; canvas.height = st.h * d
    ctx.setTransform(d, 0, 0, d, 0, 0)
  }
  resize()
  const mkRow = (cls, bucket, arr) => {
    const row = document.createElement('div')
    row.className = `ob-row ${cls} is-empty`
    row.innerHTML = '<span class="ob-cell-price"></span><span class="ob-cell-qty"></span><span class="ob-cell-cum"></span>'
    ladder.appendChild(row)
    arr.push({ bucket, el: row, qtyEl: row.children[1], cumEl: row.children[2], priceEl: row.children[0], empty: true })
  }
  for (let i = BINS - 1; i > MID_BUCKET; i--) mkRow('ob-row-ask', i, st.askRows)
  const midEl = document.createElement('div')
  midEl.className = 'ob-mid'
  midEl.innerHTML = `<span>$${bucketPrice(MID_BUCKET).toFixed(2)}</span><span class="ob-mid-spr">spread —</span>`
  ladder.appendChild(midEl)
  for (let i = MID_BUCKET - 1; i >= 0; i--) mkRow('ob-row-bid', i, st.bidRows)
  for (const r of st.askRows) r.priceEl.textContent = '$' + bucketPrice(r.bucket).toFixed(2)
  for (const r of st.bidRows) r.priceEl.textContent = '$' + bucketPrice(r.bucket).toFixed(2)
  st.midPriceEl = midEl.children[0]; st.midSprEl = midEl.children[1]; st.resize = resize
  return st
}

function renderOrderbook (st, bids, asks, mid) {
  const { ctx, w, h, askRows, bidRows, scaleRef } = st
  let aCum = 0
  for (let i = askRows.length - 1; i >= 0; i--) {
    const r = askRows[i], v = asks[r.bucket] || 0; aCum += v
    r.qtyEl.textContent = v > 0 ? v : '–'; r.cumEl.textContent = aCum > 0 ? aCum : '–'
    const empty = v === 0; if (r.empty !== empty) { r.empty = empty; r.el.classList.toggle('is-empty', empty) }
  }
  let bCum = 0
  for (let i = 0; i < bidRows.length; i++) {
    const r = bidRows[i], v = bids[r.bucket] || 0; bCum += v
    r.qtyEl.textContent = v > 0 ? v : '–'; r.cumEl.textContent = bCum > 0 ? bCum : '–'
    const empty = v === 0; if (r.empty !== empty) { r.empty = empty; r.el.classList.toggle('is-empty', empty) }
  }
  let bWS = 0, bWP = 0, aWS = 0, aWP = 0
  for (let i = 0; i < BINS; i++) {
    const b = bids[i] || 0, a = asks[i] || 0
    if (b > 0) { bWS += b; bWP += b * bucketPrice(i) }
    if (a > 0) { aWS += a; aWP += a * bucketPrice(i) }
  }
  const bidMode = bWS > 0 ? bWP / bWS : MID0, askMode = aWS > 0 ? aWP / aWS : MID0
  const liveMid = (mid == null || !isFinite(mid)) ? (bidMode + askMode) / 2 : mid
  st.midPriceEl.textContent = '$' + liveMid.toFixed(2)
  st.midSprEl.textContent = 'spread $' + Math.max(0, askMode - bidMode).toFixed(2)

  let aDepth = 0, bDepth = 0
  for (let i = 0; i < BINS; i++) { if (bucketPrice(i) > liveMid) aDepth += asks[i] || 0; else bDepth += bids[i] || 0 }
  const maxCum = Math.max(aDepth, bDepth, 1)
  if (maxCum > scaleRef.v) scaleRef.v = maxCum
  else if (maxCum < scaleRef.v * 0.6) scaleRef.v = maxCum * 1.1 || 1
  const scale = scaleRef.v

  ctx.clearRect(0, 0, w, h)
  const inset = 6, usableW = w - inset
  const yFor = p => h * (1 - (Math.max(VIEW_LO, Math.min(VIEW_HI, p)) - VIEW_LO) / (VIEW_HI - VIEW_LO))
  const yMid = yFor(liveMid)
  ctx.fillStyle = 'rgba(255, 94, 58, 0.28)'; ctx.strokeStyle = COLOR.accent; ctx.lineWidth = 1.2
  drawSide(ctx, asks, 1, liveMid, yFor, yMid, scale, usableW, w)
  ctx.fillStyle = 'rgba(103, 219, 161, 0.28)'; ctx.strokeStyle = COLOR.pos
  drawSide(ctx, bids, -1, liveMid, yFor, yMid, scale, usableW, w)
  ctx.strokeStyle = 'rgba(155, 155, 160, 0.5)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4])
  ctx.beginPath(); ctx.moveTo(0, yMid); ctx.lineTo(w, yMid); ctx.stroke(); ctx.setLineDash([])
}

function drawSide (ctx, counts, dir, mid, yFor, yMid, scale, usableW, w) {
  const order = []
  for (let i = 0; i < BINS; i++) {
    const lo = P_LO + i * P_STEP, hi = lo + P_STEP
    if (dir > 0 ? hi > mid : lo < mid) order.push({ near: dir > 0 ? Math.max(lo, mid) : Math.min(hi, mid), far: dir > 0 ? hi : lo, v: counts[i] || 0 })
  }
  if (dir > 0) order.sort((a, b) => a.near - b.near); else order.sort((a, b) => b.near - a.near)
  const trace = () => {
    ctx.beginPath(); ctx.moveTo(w, yMid); let cum = 0
    for (const seg of order) { cum += seg.v; const x = w - (cum / scale) * usableW; ctx.lineTo(x, yFor(seg.near)); ctx.lineTo(x, yFor(seg.far)) }
    return order.length ? yFor(order[order.length - 1].far) : yMid
  }
  const lastY = trace(); ctx.lineTo(w, lastY); ctx.closePath(); ctx.fill()
  trace(); ctx.stroke()
}

/* ---------- the cpu wave: selected engine (accent) over the data baseline (green) ---------- */
function makeWave (canvas, { selfBaseline = false, sqrt = false } = {}) {
  const CAP = 110, SMOOTH = 20
  const ctx = canvas.getContext('2d')
  let d = dpr()
  const resize = () => { d = dpr(); canvas.width = Math.round((canvas.clientWidth || 540) * d); canvas.height = Math.round((canvas.clientHeight || 72) * d) }
  resize(); window.addEventListener('resize', () => { resize(); draw() })
  const main = { samples: [], raw: [], stroke: COLOR.accent, fill: 'rgba(255,94,58,0.20)' }
  const base = { samples: [], raw: [], stroke: COLOR.pos, fill: 'rgba(103,219,161,0.16)' }
  let self = selfBaseline
  const smooth = (s, ms) => { s.raw.push(ms); if (s.raw.length > SMOOTH) s.raw.shift(); let t = 0; for (const v of s.raw) t += v; const avg = t / s.raw.length; s.samples.push(avg); if (s.samples.length > CAP) s.samples.shift(); return avg }
  const yOf = (v, top, h) => { const f = sqrt ? Math.sqrt(Math.min(1, v / top)) : Math.min(1, v / top); return h - f * (h - 4) - 2 }
  function drawSeries (s, top) {
    const w = canvas.width, h = canvas.height, n = s.samples.length
    if (!n) return
    const step = w / (CAP - 1)
    ctx.beginPath(); ctx.moveTo(0, h)
    for (let i = 0; i < n; i++) ctx.lineTo(i * step, yOf(s.samples[i], top, h))
    ctx.lineTo((n - 1) * step, h); ctx.closePath(); ctx.fillStyle = s.fill; ctx.fill()
    ctx.beginPath()
    for (let i = 0; i < n; i++) { const x = i * step, y = yOf(s.samples[i], top, h); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y) }
    ctx.strokeStyle = s.stroke; ctx.lineWidth = 1.6 * d; ctx.lineJoin = 'round'; ctx.stroke()
  }
  function draw () {
    const w = canvas.width, h = canvas.height
    ctx.clearRect(0, 0, w, h)
    let top = 0.4
    for (const v of main.samples) if (v > top) top = v
    for (const v of base.samples) if (v > top) top = v
    top = Math.max(top, 17)
    const y16 = yOf(16, top, h)
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.setLineDash([4 * d, 4 * d]); ctx.lineWidth = d
    ctx.beginPath(); ctx.moveTo(0, y16); ctx.lineTo(w, y16); ctx.stroke(); ctx.setLineDash([])
    ctx.fillStyle = COLOR.faint; ctx.font = `${9 * d}px ${MONO}`; ctx.textAlign = 'right'
    if (y16 < 14 * d) { ctx.textBaseline = 'top'; ctx.fillText('16 ms', w - 6 * d, y16 + 3 * d) } else { ctx.textBaseline = 'bottom'; ctx.fillText('16 ms', w - 6 * d, y16 - 2 * d) }
    drawSeries(base, top)
    if (!self) drawSeries(main, top)
  }
  const p50 = s => { if (!s.samples.length) return 0; const a = s.samples.slice().sort((x, y) => x - y); return a[Math.floor((a.length - 1) * 0.5)] }
  return {
    push (mainMs, baseMs) { smooth(main, mainMs); smooth(base, baseMs); draw(); const pb = p50(base), pm = p50(main); return { pm, pb, ratio: pb > 0.0005 ? pm / pb : 0 } },
    seed (mainFn, baseFn) { for (let i = 0; i < CAP; i++) { smooth(main, mainFn()); smooth(base, baseFn()) } draw() },
    reset (selfBase) { self = selfBase; main.samples.length = main.raw.length = base.samples.length = base.raw.length = 0; draw() },
    draw,
  }
}

/* ---------- the engines (peers are canned cost curves; only data is measured) ---------- */
const ENGINES = [
  { id: 'data', label: 'data', ver: 'v4', tag: 'length(bucket)×2 · filter→length · avg — O(1)/tick', mdTag: 'between → intersect → length(fn) · O(Δ)/brush', at2k: 0.38, brushMs: 0.8 },
  { id: 'mobx', label: 'MobX', ver: '6.15.3', tag: 'observable.box + 4 computed · O(N)/frame', mdTag: 'observable + computed × 4 · O(N)/brush', at2k: 6.0, brushMs: 41 },
  { id: 'solid', label: 'Solid', ver: '1.9.12', tag: 'createSignal + 4 createMemo · O(N)/frame', mdTag: 'createSignal + createMemo × 4 · O(N)/brush', at2k: 5.4, brushMs: 38 },
  { id: 'preact', label: 'Preact signals', ver: '1.14.1', tag: 'signal + 4 computed · O(N)/frame', mdTag: 'signal + computed × 4 · O(N)/brush', at2k: 5.7, brushMs: 39 },
  { id: 'vue', label: 'Vue reactivity', ver: '3.5.34', tag: 'shallowRef + 4 computed · O(N)/frame', mdTag: 'shallowRef + computed × 4 · O(N)/brush', at2k: 6.4, brushMs: 44 },
  { id: 'crossfilter', label: 'crossfilter', ver: '1.5.4', tag: 'dimensions × groups · cf.remove() rebuilds O(N)/tick', mdTag: 'filterRange + group.all() · incremental', at2k: 9.5, brushMs: 5.6 },
  { id: 'svelte', label: 'Svelte store', ver: '5.55.5', tag: 'writable + 4 derived · O(N)/frame', mdTag: 'writable + derived × 4 · O(N)/brush', at2k: 11.8, brushMs: 52 },
  { id: 'rxjs', label: 'RxJS', ver: '7.8.2', tag: 'Subject + 4 map() · O(N)/emit', mdTag: 'Subject + map() × 4 · O(N)/brush', at2k: 13.6, brushMs: 55 },
  { id: 'react', label: 'React', ver: '19.2.6', tag: 'useState + 4 useMemo + flushSync · O(N)/commit', mdTag: 'useState + useMemo × 4 + flushSync · O(N)/brush', at2k: 21, brushMs: 96 },
]
function costOf (eng, rate) {
  const x = rate / 2000
  const v = eng.id === 'data' ? 0.31 + 0.06 * x : eng.id === 'crossfilter' ? eng.at2k * x : eng.at2k * (0.6 + 0.4 * x)
  return Math.max(0.05, v * (1 + 0.07 * gauss()) + (Math.random() < 0.015 ? v * 0.5 : 0))
}

/* =========================================================================
 * workload 2: brushing 231,083 flight rows — canned bins, real brush mechanics
 * ========================================================================= */
const FLIGHTS = 231083
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr']
const bump = (v, m, s) => Math.exp(-0.5 * ((v - m) / s) ** 2)
const RB_DEFS = [
  { name: 'hour', domain: [0, 24], step: 1, ticks: [0, 6, 12, 18, 24], fmt: String, round: v => Math.round(v),
    shape: v => 0.1 + bump(v, 8, 2.2) + 0.95 * bump(v, 17.5, 3.2) + 0.55 * bump(v, 12.5, 4) },
  { name: 'delay', domain: [-60, 150], step: 10, ticks: [-60, 0, 60, 120], fmt: String, round: v => Math.round(v / 10) * 10,
    shape: v => bump(v, -8, 14) + (v > 0 ? 0.32 * Math.exp(-v / 55) : 0) + 0.02 },
  { name: 'distance', domain: [0, 2000], step: 50, ticks: [0, 1000, 2000], fmt: String, round: v => Math.round(v / 50) * 50,
    shape: v => (v / 320) * Math.exp(-v / 330) + 0.06 * bump(v, 1100, 120) + 0.04 * bump(v, 1500, 100) + 0.01 },
  { name: 'date', domain: [0, 90], step: 1, ticks: [0, 31, 59, 90], fmt: d => MONTHS[d < 31 ? 0 : d < 59 ? 1 : d < 90 ? 2 : 3], round: Math.round,
    shape: d => (1 + 0.12 * Math.sin(d / 90 * Math.PI)) * ((d % 7 === 5 || d % 7 === 6) ? 0.66 : 1) },
]
function makeBins (def, rand) {
  const n = Math.round((def.domain[1] - def.domain[0]) / def.step), raw = new Float64Array(n)
  let s = 0, best = 0
  for (let i = 0; i < n; i++) { const v = def.domain[0] + (i + 0.5) * def.step; raw[i] = Math.max(0, def.shape(v) * (0.92 + 0.16 * rand())); s += raw[i]; if (raw[i] > raw[best]) best = i }
  const out = new Float64Array(n); let acc = 0
  for (let i = 0; i < n; i++) { out[i] = Math.round(raw[i] / s * FLIGHTS); acc += out[i] }
  out[best] += FLIGHTS - acc
  return out
}

function makeChart (host, def, bins, width, onBrush, H = 60, opts = {}) {
  const M = { top: 8, right: 10, bottom: 18, left: 10 }
  const card = document.createElement('div'); card.className = 'rb-chart'
  const title = document.createElement('div'); title.className = 'rb-title'
  title.textContent = def.name
  const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'rb-reset'; reset.textContent = 'reset'; reset.hidden = true
  title.appendChild(reset)
  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-label', `${def.name} histogram — drag to brush`)
  card.append(title, canvas); host.appendChild(card)
  let W = width
  const ctx = canvas.getContext('2d')
  function size (w) {
    W = Math.max(60, Math.round(w)); const d = dpr()
    canvas.style.width = (W + M.left + M.right) + 'px'; canvas.style.height = (H + M.top + M.bottom) + 'px'
    canvas.width = (W + M.left + M.right) * d; canvas.height = (H + M.top + M.bottom) * d
    ctx.setTransform(d, 0, 0, d, M.left, M.top)
  }
  size(W)
  const [d0, d1] = def.domain
  const x = v => (v - d0) / (d1 - d0) * W
  const rx = px => d0 + px / W * (d1 - d0)
  let range = null, fg = bins, yMax = 1
  for (const v of bins) if (v > yMax) yMax = v
  const n = bins.length

  function bars (arr, lo, hi) {
    for (let i = 0; i < n; i++) {
      const x0 = x(d0 + i * def.step), x1 = x(d0 + (i + 1) * def.step)
      if (x1 <= lo || x0 >= hi) continue
      const bx0 = Math.max(x0, lo), bx1 = Math.min(x1, hi)
      const bh = arr[i] / yMax * H
      ctx.fillRect(bx0, H - bh, Math.max(0.6, bx1 - bx0 - (x1 - x0 > 3 ? 1 : 0.25)), bh)
    }
  }
  function drawClassic () {
    ctx.clearRect(-M.left, -M.top, W + M.left + M.right, H + M.top + M.bottom)
    ctx.fillStyle = COLOR.rule; bars(bins, -1, W + 1)
    ctx.fillStyle = COLOR.accent
    if (range) bars(fg, x(range[0]), x(range[1])); else bars(fg, -1, W + 1)
    ctx.strokeStyle = COLOR.faint; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0.5, H + 6); ctx.lineTo(0.5, H + 0.5); ctx.lineTo(W - 0.5, H + 0.5); ctx.lineTo(W - 0.5, H + 6); ctx.stroke()
    ctx.fillStyle = COLOR.faint; ctx.font = `9px ${MONO}`; ctx.textBaseline = 'top'
    def.ticks.forEach((t, i) => {
      const tx = Math.round(x(t)) + 0.5
      ctx.beginPath(); ctx.moveTo(tx, H); ctx.lineTo(tx, H + 6); ctx.stroke()
      ctx.textAlign = i === 0 ? 'left' : i === def.ticks.length - 1 ? 'right' : 'center'
      ctx.fillText(def.fmt(t), tx, H + 8)
    })
    if (range) {
      const lo = x(range[0]), hi = x(range[1])
      ctx.fillStyle = 'rgba(255,94,58,0.16)'; ctx.fillRect(lo, 0, hi - lo, H)
      ctx.strokeStyle = 'rgba(255,94,58,0.6)'; ctx.strokeRect(lo + 0.5, 0.5, hi - lo - 1, H - 1)
      ctx.fillStyle = COLOR.accent
      for (const hx of [lo, hi]) { ctx.beginPath(); ctx.moveTo(hx, H / 2 - 6); ctx.lineTo(hx + (hx === lo ? -4 : 4), H / 2); ctx.lineTo(hx, H / 2 + 6); ctx.closePath(); ctx.fill() }
    }
  }
  // variant d's painter: hairline baseline + ticks, a translucent accent band with two
  // accent handles (a 1.5px line and a small grip each), dimmer background bars
  function drawPretty () {
    ctx.clearRect(-M.left, -M.top, W + M.left + M.right, H + M.top + M.bottom)
    ctx.fillStyle = '#2a2a30'; bars(bins, -1, W + 1)
    ctx.fillStyle = COLOR.accent
    if (range) bars(fg, x(range[0]), x(range[1])); else bars(fg, -1, W + 1)
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, H + 0.5); ctx.lineTo(W, H + 0.5); ctx.stroke()
    ctx.fillStyle = COLOR.faint; ctx.font = `9px ${MONO}`; ctx.textBaseline = 'top'
    def.ticks.forEach((t, i) => {
      const tx = Math.round(x(t)) + 0.5
      ctx.beginPath(); ctx.moveTo(tx, H + 1); ctx.lineTo(tx, H + 5); ctx.stroke()
      ctx.textAlign = i === 0 ? 'left' : i === def.ticks.length - 1 ? 'right' : 'center'
      ctx.fillText(def.fmt(t), tx, H + 8)
    })
    if (range) {
      const lo = Math.round(x(range[0])) + 0.5, hi = Math.round(x(range[1])) - 0.5
      ctx.fillStyle = 'rgba(255,94,58,0.11)'; ctx.fillRect(lo, 0, Math.max(0, hi - lo), H)
      ctx.strokeStyle = COLOR.accent; ctx.lineWidth = 1.5
      for (const hx of [lo, hi]) { ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, H); ctx.stroke() }
      ctx.fillStyle = COLOR.accent
      for (const hx of [lo, hi]) {
        const gx = hx - 2.5, gy = H / 2 - 7, gw = 5, gh = 14, r = 2.5
        ctx.beginPath(); ctx.moveTo(gx + r, gy); ctx.lineTo(gx + gw - r, gy); ctx.arcTo(gx + gw, gy, gx + gw, gy + r, r); ctx.lineTo(gx + gw, gy + gh - r); ctx.arcTo(gx + gw, gy + gh, gx + gw - r, gy + gh, r); ctx.lineTo(gx + r, gy + gh); ctx.arcTo(gx, gy + gh, gx, gy + gh - r, r); ctx.lineTo(gx, gy + r); ctx.arcTo(gx, gy, gx + r, gy, r); ctx.closePath(); ctx.fill()
      }
    }
  }
  const draw = opts.pretty ? drawPretty : drawClassic
  function setRange (r, fire = true) {
    range = r && r[1] > r[0] ? r : null
    reset.hidden = !range
    draw()
    if (fire) onBrush()
  }
  reset.addEventListener('click', () => setRange(null))
  // three drag modes, as the old chart.js: new selection, translate the extent, resize an edge
  let drag = null
  const px = e => e.clientX - canvas.getBoundingClientRect().left - M.left
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const p = px(e)
    if (range) {
      const lo = x(range[0]), hi = x(range[1])
      if (Math.abs(p - lo) <= 6) drag = { mode: 'resize', edge: 0 }
      else if (Math.abs(p - hi) <= 6) drag = { mode: 'resize', edge: 1 }
      else if (p > lo && p < hi) drag = { mode: 'move', p0: rx(p), base: [range[0], range[1]] }
    }
    if (!drag) { const v = def.round(rx(Math.max(0, Math.min(W, p)))); drag = { mode: 'new', v0: v }; setRange([v, v]) }
    canvas.setPointerCapture(e.pointerId); e.preventDefault()
  })
  canvas.addEventListener('pointermove', e => {
    if (!drag) return
    const p = Math.max(0, Math.min(W, px(e))), v = def.round(rx(p))
    if (drag.mode === 'new') setRange(v > drag.v0 ? [drag.v0, v] : [v, drag.v0])
    else if (drag.mode === 'resize') { const other = range[1 - drag.edge]; setRange(v < other ? [v, other] : [other, v]) }
    else {
      const span = drag.base[1] - drag.base[0]
      let lo = drag.base[0] + (rx(p) - drag.p0), hi = lo + span
      if (lo < d0) { lo = d0; hi = lo + span } else if (hi > d1) { hi = d1; lo = hi - span }
      setRange([def.round(lo), def.round(hi)])
    }
  })
  const up = e => { if (!drag) return; drag = null; canvas.releasePointerCapture?.(e.pointerId); if (range && range[0] === range[1]) setRange(null) }
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up)
  draw()
  return { card, def, bins, draw, size, setRange, get range () { return range }, setFg (arr) { fg = arr; draw() } }
}

const TOP_POOL = [['SFO→LAX', 131], ['ORD→DFW', 118], ['JFK→BOS', 104], ['DEN→PHX', 97], ['ATL→MCO', 92], ['LAS→SEA', 88], ['IAH→MSY', 81], ['DTW→MSP', 76], ['SLC→OAK', 71], ['EWR→CLT', 64], ['BWI→FLL', 58], ['MIA→DCA', 52], ['PDX→SJC', 47]]

// one panel = four charts over the same canned rows; each chart counts rows
// passing every OTHER chart's brush (classic crossfilter — its own brush never
// empties its own bars)
function makeBrushPanel ({ host, widths, height = 60, seed = 11, onChange, pretty = false }) {
  const rand = lcg(seed)
  const charts = RB_DEFS.map((def, i) => makeChart(host, def, makeBins(def, rand), widths[i], () => recompute(i), height, { pretty }))
  const fractionOf = c => {
    if (!c.range) return 1
    let inside = 0, total = 0
    for (let i = 0; i < c.bins.length; i++) { const lo = c.def.domain[0] + i * c.def.step, hi = lo + c.def.step; total += c.bins[i]; if (hi > c.range[0] && lo < c.range[1]) inside += c.bins[i] * (Math.min(hi, c.range[1]) - Math.max(lo, c.range[0])) / c.def.step }
    return inside / total
  }
  function recompute (touched) {
    const fr = charts.map(fractionOf)
    let all = 1; for (const f of fr) all *= f
    charts.forEach((c, i) => {
      let g = 1; fr.forEach((f, j) => { if (j !== i) g *= f })
      if (g === 1) { c.setFg(c.bins); return }
      const fg = new Float64Array(c.bins.length)
      for (let k = 0; k < fg.length; k++) { const w = 0.35 * Math.sin(k * 0.9 + i * 1.7) * (1 - g) * g; fg[k] = c.bins[k] * Math.min(1, Math.max(0, g + w)) }
      c.setFg(fg)
    })
    const active = all === 1 ? FLIGHTS : Math.max(0, Math.min(FLIGHTS, Math.round(FLIGHTS * all * (1 + 0.04 * Math.sin(all * 37)))))
    onChange({ active, total: FLIGHTS, all, touched })
  }
  return {
    charts, recompute,
    reset () { for (const c of charts) c.setRange(null, false); recompute(null) },
    set (name, r) { charts.find(c => c.def.name === name).setRange(r, false); recompute(null) },
    resize (ws) { charts.forEach((c, i) => { c.size(ws[i]); c.draw() }) },
  }
}
function topFive (all) {
  const off = Math.min(TOP_POOL.length - 5, Math.floor((1 - all) * 8))
  return TOP_POOL.slice(off, off + 5).map(([od, d]) => `<li><span class="rb-od">${od}</span><span class="rb-d${d < 0 ? ' early' : ''}">${d >= 0 ? '+' : ''}${d}m</span></li>`).join('')
}
// canned per-brush latency: a rolling window of samples → p50 / p95 / n
function makeLatency () {
  const win = []; let n = 0
  const pct = p => { if (!win.length) return null; const a = win.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * p))] }
  return { sample (ms) { win.push(ms); if (win.length > 64) win.shift(); n++ }, reset () { win.length = 0; n = 0 }, get p50 () { return pct(0.5) }, get p95 () { return pct(0.95) }, get n () { return n } }
}
const fmtLat = ms => ms == null ? '—' : ms < 10 ? ms.toFixed(1) : ms.toFixed(0)

/* =========================================================================
 * variant a · nine engines
 * ========================================================================= */
function initA (root) {
  const sel = q('#race-lib-a'), prev = q('#race-prev-a'), next = q('#race-next-a'), pos = q('#race-pos-a')
  const rateIn = q('#race-rate-a'), rateOut = q('#race-rate-out-a'), toggle = q('#race-toggle-a')
  const card = q('#race-card-a'), nameEl = q('#race-name-a'), verEl = q('#race-ver-a'), tagEl = q('#race-tag-a'), cpuEl = q('#race-cpu-a'), ratioEl = q('#race-ratio-a')
  const liquidEl = q('#race-liquid-a'), avgEl = q('#race-avg-a'), baseEl = q('#race-base-a'), tpsEl = q('#race-tps-a')
  const mdName = q('#race-md-name-a'), mdVer = q('#race-md-ver-a'), mdTag = q('#race-md-tag-a'), mdNameWrap = mdName.parentElement
  const activeEl = q('#race-active-a'), p50El = q('#race-p50-a'), p95El = q('#race-p95-a'), nEl = q('#race-n-a'), topEl = q('#race-top-a')
  for (const e of ENGINES) { const o = document.createElement('option'); o.value = e.id; o.textContent = e.label; sel.appendChild(o) }
  let idx = 0, eng = ENGINES[0], book, ob, wave, panel, lat = makeLatency(), frac = 0, tickAcc = 0, tickT0 = 0, tps = 0, lastFrame = 0
  const rate = () => Math.round(Math.pow(10, +rateIn.value))
  const showRate = () => { rateOut.textContent = fmtRate(rate()) + ' ticks/sec' }
  showRate(); rateIn.addEventListener('input', showRate)

  function select (i) {
    idx = (i + ENGINES.length) % ENGINES.length; eng = ENGINES[idx]
    const isData = eng.id === 'data'
    sel.value = eng.id; pos.textContent = `${idx + 1} / ${ENGINES.length}`
    card.classList.toggle('is-data', isData)
    nameEl.textContent = eng.label; verEl.textContent = eng.ver; tagEl.textContent = eng.tag
    mdName.textContent = eng.label; mdVer.textContent = eng.ver; mdTag.textContent = eng.mdTag; mdNameWrap.classList.toggle('is-data', isData)
    ratioEl.textContent = isData ? 'baseline' : '—'
    if (wave) { wave.reset(isData); seedWave() }
    lat.reset(); lat.sample(eng.brushMs * (0.9 + 0.2 * Math.random())); paintLatency()
    if (panel) panel.recompute(null)
  }
  function seedWave () {
    const r = rate()
    wave.seed(() => costOf(eng, r), () => costOf(ENGINES[0], r))
    paintCpu(wave.push(costOf(eng, r), costOf(ENGINES[0], r)))
  }
  function paintCpu ({ pm, pb, ratio }) {
    const isData = eng.id === 'data'
    cpuEl.textContent = fmtCpu(pm); cpuEl.classList.toggle('over', pm > 16)
    ratioEl.textContent = isData ? 'baseline' : (ratio > 0 ? fmtRatio(ratio) + ' data' : '—')
    baseEl.textContent = (!isData && ratio > 0) ? `${fmtMs(pb)} (${fmtRatio(ratio)})` : fmtMs(pb)
  }
  function paintBook () {
    liquidEl.textContent = fmtInt(book.liquid); avgEl.textContent = book.avg.toFixed(2)
    renderOrderbook(ob, book.bids, book.asks, book.mid)
  }
  function paintLatency () { p50El.textContent = fmtLat(lat.p50); p95El.textContent = fmtLat(lat.p95); nEl.textContent = fmtInt(lat.n) }

  function build () {
    book = makeBook(7)
    ob = setupOrderbook(q('#race-ob-a'))
    wave = makeWave(q('#race-wave-a'), { selfBaseline: true })
    panel = makeBrushPanel({
      host: q('#race-charts-a'), widths: [105, 105, 105, 210], seed: 11,
      onChange ({ active, all, touched }) {
        activeEl.textContent = fmtInt(active)
        topEl.innerHTML = topFive(all)
        if (touched != null) { lat.sample(eng.brushMs * (0.8 + 0.4 * Math.random())); paintLatency() }
      },
    })
    panel.set('delay', [20, 90])
    select(0)
    tpsEl.textContent = fmtInt(rate()); tickT0 = performance.now()
    paintBook()
    window.addEventListener('resize', () => { ob.resize(); paintBook() })
  }
  function frame (now, dt) {
    if (now - lastFrame > 250) { tickAcc = 0; tickT0 = now }
    lastFrame = now
    const r = rate(), owed = r * dt / 1000 + frac
    const k = Math.min(8000, Math.floor(owed)); frac = owed - k
    for (let i = 0; i < k; i++) book.tick()
    tickAcc += k
    paintCpu(wave.push(costOf(eng, r), costOf(ENGINES[0], r)))
    paintBook()
    if (now - tickT0 >= 500) { tps = tickAcc / (now - tickT0) * 1000; tpsEl.textContent = fmtInt(tps); tickAcc = 0; tickT0 = now }
  }
  const run = runner({ root, frame, build })
  sel.addEventListener('change', () => select(ENGINES.findIndex(e => e.id === sel.value)))
  prev.addEventListener('click', () => select(idx - 1))
  next.addEventListener('click', () => select(idx + 1))
  toggle.addEventListener('click', () => { run.setPaused(!run.paused); toggle.textContent = run.paused ? '▶ resume' : '⏸ pause' })
  root.addEventListener('variantshow', () => { if (ob) { ob.resize(); paintBook() } })
}

/* =========================================================================
 * variant b · one engine · two workloads
 * ========================================================================= */
function initB (root) {
  const rateIn = q('#race-rate-b'), rateOut = q('#race-rate-out-b'), toggle = q('#race-toggle-b')
  const cpuEl = q('#race-cpu-b'), brushCpuEl = q('#race-brush-cpu-b'), activeEl = q('#race-active-b'), msEl = q('#race-ms-b')
  const liquidEl = q('#race-liquid-b'), avgEl = q('#race-avg-b'), tpsEl = q('#race-tps-b'), cpsEl = q('#race-cps-b')
  const chartsHost = q('#race-charts-b')
  const data = ENGINES[0]
  let book, ob, wave, panel, lat = makeLatency(), frac = 0, tickAcc = 0, tickT0 = 0, frames = 0, lastFrame = 0
  const rate = () => Math.round(Math.pow(10, +rateIn.value))
  const showRate = () => { rateOut.textContent = fmtRate(rate()) + ' ticks/sec' }
  showRate(); rateIn.addEventListener('input', showRate)
  const chartWidths = () => { const w = Math.max(120, (chartsHost.clientWidth - 16) / 2 - 20); return [w, w, w, w] }
  function paintBook () { liquidEl.textContent = fmtInt(book.liquid); avgEl.textContent = book.avg.toFixed(2); renderOrderbook(ob, book.bids, book.asks, book.mid) }
  function paintBrush () { brushCpuEl.textContent = lat.p50 == null ? '—' : fmtLat(lat.p50) + ' ms/brush'; msEl.textContent = lat.p50 == null ? '—' : fmtLat(lat.p50) + ' ms' }
  function build () {
    book = makeBook(9)
    ob = setupOrderbook(q('#race-ob-b'))
    wave = makeWave(q('#race-wave-b'), { selfBaseline: true, sqrt: true })
    const r = rate()
    wave.seed(() => costOf(data, r), () => costOf(data, r))
    cpuEl.textContent = fmtCpu(wave.push(costOf(data, r), costOf(data, r)).pb)
    panel = makeBrushPanel({
      host: chartsHost, widths: chartWidths(), height: 96, seed: 13,
      onChange ({ active, touched }) {
        activeEl.textContent = fmtInt(active)
        if (touched != null) { lat.sample(data.brushMs * (0.8 + 0.4 * Math.random())); paintBrush() }
      },
    })
    for (const c of panel.charts) c.card.classList.add('rb-fit')
    lat.sample(0.8); paintBrush()
    panel.set('hour', [6, 11])
    tpsEl.textContent = fmtInt(rate()); cpsEl.textContent = '60'; tickT0 = performance.now()
    paintBook()
    window.addEventListener('resize', () => { ob.resize(); paintBook(); panel.resize(chartWidths()) })
  }
  function frame (now, dt) {
    if (now - lastFrame > 250) { tickAcc = 0; frames = 0; tickT0 = now }
    lastFrame = now
    const r = rate(), owed = r * dt / 1000 + frac
    const k = Math.min(8000, Math.floor(owed)); frac = owed - k
    for (let i = 0; i < k; i++) book.tick()
    tickAcc += k; frames++
    const c = costOf(data, r)
    cpuEl.textContent = fmtCpu(wave.push(c, c).pb)
    paintBook()
    if (now - tickT0 >= 500) { tpsEl.textContent = fmtInt(tickAcc / (now - tickT0) * 1000); cpsEl.textContent = fmtInt(frames / (now - tickT0) * 1000); tickAcc = 0; frames = 0; tickT0 = now }
  }
  const run = runner({ root, frame, build })
  toggle.addEventListener('click', () => { run.setPaused(!run.paused); toggle.textContent = run.paused ? '▶ resume' : '⏸ pause' })
  root.addEventListener('variantshow', () => { if (ob) { ob.resize(); paintBook(); panel.resize(chartWidths()) } })
}

/* =========================================================================
 * variant c · follow one write
 * ========================================================================= */
function initC (root) {
  const T = {
    t1: { sym: 'AAPL', side: 'buy', qty: 200, px: 187.5 },
    t2: { sym: 'MSFT', side: 'sell', qty: 150, px: 411.25 },
    t3: { sym: 'NVDA', side: 'buy', qty: 500, px: 122.5 },
    t4: { sym: 'AAPL', side: 'buy', qty: 120, px: 188.5 },
  }
  const KEYS = ['t1', 't2', 't3', 't4']
  const qtyOf = k => T[k].qty
  // buys = t1 · t3 · t4; largest = buys.za('qty', 2): t3 leads above 200, drops out below 120
  const largestOf = v => v > 200 ? ['t3', 't1'] : v >= 120 ? ['t1', 't3'] : ['t1', 't4']
  const volumeOf = v => 200 + v + 120
  let seq = 2, samples = [], lastLargest = largestOf(500), tour = null
  const seqEl = q('#race-seq-c'), rowsEl = q('#fw-rows-c'), bigEl = q('#fw-big-c'), metaEl = q('#fw-meta-c'), jsonEl = q('#fw-json-c')
  const traceEl = q('#fw-trace-c'), rankedEl = q('#fw-ranked-c'), opsEl = q('#fw-ops-c'), chipsEl = q('#fw-chips-c'), repEl = q('#fw-rep-c'), wireEl = q('#fw-wire-c'), tourBtn = q('#race-tour-c')
  const NODES = ['trades', 'buys', 'largest', 'typical', 'volume']
  const gn = n => q(`#fw-n-${n}-c`), edge = n => q(`#fw-e-${n}-c`)

  /* 1 · the rows table; t3.qty is the control (pointer capture + coalesced samples) */
  rowsEl.innerHTML = '<thead><tr><th>key</th><th>sym</th><th>side</th><th class="num">qty</th><th class="num">px</th></tr></thead><tbody>' +
    KEYS.map(k => { const t = T[k]; return `<tr class="${t.side}" data-key="${k}"><td class="k">${k}</td><td>${t.sym}</td><td class="side">${t.side}</td>` +
      (k === 't3' ? `<td class="num fw-ctl" id="fw-ctl-c" role="slider" tabindex="0" aria-label="trades.t3.qty" aria-valuemin="0" aria-valuemax="1000" aria-valuenow="${t.qty}"><span>${t.qty}</span></td>` : `<td class="num">${t.qty}</td>`) +
      `<td class="px num">${t.px}</td></tr>` }).join('') + '</tbody>'
  const ctl = q('#fw-ctl-c'), ctlSpan = ctl.firstElementChild
  const clamp = v => Math.max(0, Math.min(1000, Math.round(v)))
  let drag = null
  ctl.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    tour = null; drag = { x: e.clientX, v: qtyOf('t3') }
    ctl.setPointerCapture(e.pointerId); ctl.classList.add('hot'); ctl.focus({ preventScroll: true }); e.preventDefault()
  })
  ctl.addEventListener('pointermove', e => {
    if (!drag) return
    const evs = e.getCoalescedEvents?.() ?? [e]
    for (const s of (evs.length ? evs : [e])) samples.push(clamp(drag.v + (s.clientX - drag.x) * 2))
  })
  const up = () => { if (!drag) return; drag = null; ctl.classList.remove('hot') }
  ctl.addEventListener('pointerup', up); ctl.addEventListener('pointercancel', up)
  ctl.addEventListener('keydown', e => {
    const step = e.shiftKey ? 100 : 10; let v = qtyOf('t3')
    switch (e.key) { case 'ArrowRight': case 'ArrowUp': v += step; break; case 'ArrowLeft': case 'ArrowDown': v -= step; break; case 'PageUp': v += 100; break; case 'PageDown': v -= 100; break; case 'Home': v = 0; break; case 'End': v = 1000; break; default: return }
    e.preventDefault(); tour = null; samples.push(clamp(v))
  })

  /* 4 · the ranked list — one <li> per key, moved (never recreated) on reorder */
  const lis = new Map()
  const liFor = k => { if (!lis.has(k)) { const li = document.createElement('li'); li.innerHTML = `<b>${T[k].sym}</b><span>${T[k].qty}</span>`; lis.set(k, li) } return lis.get(k) }
  const flash = el => { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash') }
  function paintRanked (order, changedKey, ops) {
    order.forEach((k, i) => { const li = liFor(k); if (rankedEl.children[i] !== li) rankedEl.insertBefore(li, rankedEl.children[i] || null) })
    for (const [k, li] of lis) if (!order.includes(k) && li.parentNode) li.remove()
    for (const k of order) { const li = lis.get(k), s = li.lastElementChild; const txt = String(T[k].qty); if (s.textContent !== txt) { s.textContent = txt; flash(s) } else if (k === changedKey && ops.created) flash(s) }
    opsEl.innerHTML = `this commit: <b>${ops.text}</b> text · <b>${ops.moved}</b> moved · <b>${ops.created}</b> created · <b>${ops.removed}</b> removed`
  }

  /* 2 · the delta, 3 · the flow, 4 · the wire */
  const rowLit = (name, text) => { const g = gn(name); g.classList.toggle('lit', !!text); g.querySelector('.emit').textContent = text || ''; const e = edge(name); if (e) { e.classList.remove('lit'); if (text) { void e.getBoundingClientRect(); e.classList.add('lit') } } }
  function paintGraph (lit) {
    for (const n of NODES) rowLit(n, lit[n])
    gn('largest').querySelector('.sub').textContent = lastLargest.map(k => `${T[k].sym} ${T[k].qty}`).join(' · ')
    gn('volume').querySelector('.emit').textContent = lit.volume || `${volumeOf(qtyOf('t3'))}`
    gn('trades').querySelector('.sub').textContent = '4 rows'; gn('buys').querySelector('.sub').textContent = '3 rows'
  }
  function chip (r) {
    const k = `<em>${r.k}</em>`
    switch (r.t) {
      case 'add': return `<span class="t-add">add ${k} @${r.at}</span>`
      case 'remove': return `<span class="t-remove">remove ${k}</span>`
      case 'update': return `<span class="t-update">update ${k} .${r.path.join('.')} ${r.prev} → ${r.v}</span>`
      case 'move': return `<span class="t-move">move ${k} ${r.from} → ${r.to}</span>`
    }
  }
  const rowJSON = t => `{ sym: '${t.sym}', side: '${t.side}', qty: ${t.qty}, px: ${t.px} }`

  function commit (prev, next, writes) {
    if (prev === next) {
      bigEl.className = 'fw-big none'; bigEl.textContent = `seq ${seq} unchanged · ${plural(writes, 'write')} → no commit`
      metaEl.innerHTML = 'Object.is(prev, next) → the write is dropped before the commit'
      return
    }
    seq++
    T.t3.qty = next; ctlSpan.textContent = next; ctl.setAttribute('aria-valuenow', String(next)); if (!drag && !tour) flash(ctlSpan)
    seqEl.textContent = seq
    // 2 · the delta (one row delta, path ['qty'], prev carried)
    bigEl.className = 'fw-big'
    bigEl.innerHTML = `<span class="op">update</span> t3 <span class="path">.qty</span> <span class="prev">${prev}</span> <span class="arr">→</span> ${next}`
    metaEl.innerHTML = `seq <b>${seq}</b> · ${plural(writes, 'write')} → <b>1 delta</b> · rows[0].path = ['qty'] · prev carried`
    jsonEl.textContent = `{ seq: ${seq}, origin: Symbol(scrub), rows: [ { op: 'update', key: 't3', path: ['qty'], prev: { …t3, qty: ${prev} }, row: { …t3, qty: ${next} } } ], order: undefined, scalar: undefined }`
    // 3 · the flow
    const was = lastLargest, now = largestOf(next); lastLargest = now
    const sameSet = was[0] === now[0] && was[1] === now[1]
    const sameMembers = was.includes(now[0]) && was.includes(now[1])
    const largestEmit = sameSet ? 'Δ 1 row' : sameMembers ? 'Δ 1 row · 1 move' : 'Δ 2 rows · 2 moves'
    const lit = { trades: 'Δ 1 row', buys: 'Δ 1 row', largest: largestEmit, typical: '', volume: `${volumeOf(prev)} → ${volumeOf(next)}` }
    paintGraph(lit)
    const settle = 0.02 + Math.random() * 0.04, batchMs = settle + 0.05 + Math.random() * 0.08
    const dl = sameSet ? 1 : 2
    traceEl.innerHTML = `flush seq <b>${seq}</b> · <i>trades</i> h0 (1Δ) → <i>buys</i> h1 (1Δ) → <i>largest</i> h2 (${dl}Δ) · <i>typical</i> h2 <span class="dark">—</span> · <i>volume</i> h2 (1Δ) · <b>${settle.toFixed(2)}</b> ms settle · <b>${batchMs.toFixed(2)}</b> ms batch() · this machine`
    // 4 · the sinks: dom ops + wire records, both from the same batch
    let records, ops
    if (sameSet) { records = [{ t: 'update', k: 't3', v: next, prev, path: ['qty'] }]; ops = { text: 1, moved: 0, created: 0, removed: 0 } }
    else if (sameMembers) { records = [{ t: 'update', k: 't3', v: next, prev, path: ['qty'] }, { t: 'move', k: 't3', from: was.indexOf('t3'), to: now.indexOf('t3') }]; ops = { text: 1, moved: 1, created: 0, removed: 0 } }
    else {
      const out = was.find(k => !now.includes(k)), inn = now.find(k => !was.includes(k))
      records = [{ t: 'remove', k: out }, { t: 'add', k: inn, v: T[inn], at: now.indexOf(inn) }]
      ops = { text: 0, moved: 0, created: 1, removed: 1 }
    }
    paintRanked(now, 't3', ops)
    chipsEl.innerHTML = `<span class="t-seq">seq ${seq} · keyDomain string</span>` + records.map(chip).join('')
    repEl.innerHTML = `replica · commit <b>${seq}</b> · ${plural(now.length, 'row')} · <b>identical to the view</b>`
    const rec = r => r.t === 'update' ? `{ t: 'update', k: '${r.k}', v: ${r.v}, prev: ${r.prev}, path: ['qty'] }` : r.t === 'move' ? `{ t: 'move', k: '${r.k}', from: ${r.from}, to: ${r.to} }` : r.t === 'remove' ? `{ t: 'remove', k: '${r.k}', prev: { …${r.k} } }` : `{ t: 'add', k: '${r.k}', v: { …${r.k} }, at: ${r.at} }`
    wireEl.textContent = `{ keyDomain: 'string', seq: ${seq}, records: [ ${records.map(rec).join(', ')} ] }`
  }

  function build () {
    paintRanked(lastLargest, null, { text: 0, moved: 0, created: 2, removed: 0 })
    opsEl.innerHTML = 'mount: <b>2</b> created'
    paintGraph({ trades: '', buys: '', largest: '', typical: '', volume: '' })
    seqEl.textContent = seq
    chipsEl.innerHTML = '<span class="t-seq">seq 0 · init</span><span class="t-add">add <em>t3</em> @0</span><span class="t-add">add <em>t1</em> @1</span>'
    repEl.innerHTML = 'replica · <b>2 rows</b> · identical to the view'
    wireEl.textContent = "{ keyDomain: 'string', seq: 0, records: [ { t: 'add', k: 't3', v: { …t3 }, at: 0 }, { t: 'add', k: 't1', v: { …t1 }, at: 1 } ] }"
    bigEl.className = 'fw-big none'; bigEl.textContent = 'init · snapshot 4 rows · t1 · t2 · t3 · t4'
    metaEl.textContent = 'a sink attached between commits gets init(snapshot), then only deltas'
    jsonEl.textContent = `Map(4) { 't1' => ${rowJSON(T.t1)}, 't2' => …, 't3' => ${rowJSON(T.t3)}, 't4' => … }`
    // the write this page opens on — the visitor's first drag takes over from here
    commit(500, 380, 7)
  }
  // the scripted tour: a drag through both thresholds (200 · 120) and back up
  const TOUR = [[380, 190, 900], [190, 110, 700], [110, 60, 400], [60, 500, 1400]]
  function startTour () {
    tour = { i: 0, t0: performance.now(), from: qtyOf('t3') }
    ctl.classList.add('hot')
  }
  function frame (now) {
    if (tour) {
      const [, to, dur] = TOUR[tour.i]
      if (now >= tour.t0) {
        const t = Math.min(1, (now - tour.t0) / dur), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
        const v = clamp(tour.from + (to - tour.from) * e)
        if (v !== qtyOf('t3')) samples.push(v)
        if (t >= 1) { tour.i++; if (tour.i >= TOUR.length) { tour = null; ctl.classList.remove('hot') } else { tour.t0 = now + 260; tour.from = to } }
      }
    }
    if (samples.length) { const prev = qtyOf('t3'), next = samples[samples.length - 1], k = samples.length; samples = []; commit(prev, next, k) }
  }
  runner({ root, frame, build })
  tourBtn.addEventListener('click', () => { if (tour) { tour = null; ctl.classList.remove('hot') } else startTour() })
}

/* =========================================================================
 * variant d · nine engines · two workloads — b's two columns under a's carousel.
 * STAGE 1: the order book on the REAL engine. STAGE 2: the peers, for real.
 *
 *   orders  = $(initial)                                   object-born, N rows { id, bid, ask }
 *   liquid  = orders.filter(t => t.ask - t.bid > THRESH).length()
 *   avgBid  = orders.avg('bid')
 *   avgAsk  = orders.avg('ask')                           the pill: mid = (avgBid + avgAsk) / 2 · mean spread = avgAsk − avgBid
 *   bids    = orders.length(t => bucketOf(t.bid))          { [bucket]: { value: N } } (ops/bucket.ts)
 *   asks    = orders.length(t => bucketOf(t.ask))
 *
 * Per frame: the slider's ticks/sec worth of ticks (synthetic INPUT — the old
 * race's mean-reverting random walk, makeWorkloadD) are applied as
 * `orders.get(idx).set(field, v)` inside ONE batch(); performance.now() around
 * that batch (settle + effects included) is the frame cost → the card's
 * µs/frame, the wave's data line, the strip's DATA BASELINE (all 'measured').
 * The ladder, depth chart, spread pill, LIQUID ORDERS and AVG BID read the
 * views' values after the batch ('runtime'); the tape and the flashes read the
 * commit's own deltas through orders.sink() ('runtime'). The source is built
 * lazily (IntersectionObserver, 600px margin) in chunks across frames behind an
 * attested progress line. Boot cost → window.__perf['race.boot.ms'].
 *
 * The peers (stage 2, race/peers.js): selecting one dynamic-imports the real
 * library from esm.sh (never before), builds its engine on
 * structuredClone(orders.snapshot()) — the SAME book, its own copy — and from
 * then on every frame's ticks go to BOTH engines: data's batch() in its window,
 * then `peer.ingest() × k; peer.settle()` in an identical performance.now()
 * window. The card's ms/frame is the peer's window (warn-red over 16 ms), the
 * wave plots peer (accent) over data (green), the pane header's "N× data" and
 * the strip's "(N×)" are the ratio of the two smoothed medians — all 'measured'.
 * data keeps running as the baseline; the printed book stays data's views. A
 * peer that fails to load prints "peer unavailable" and data carries on.
 * Selecting snaps the slider to the old race's per-engine safe rate.
 * ========================================================================= */
const LADDER_HI = 13, LADDER_LO = 1                      // $93.33 … $53.33 — the buckets the book actually reaches
const RGB = { pos: '103,219,161', neg: '255,120,115', accent: '255,94,58' }
const FLASH_MS = 300
const N_D = (() => { const n = parseInt(new URL(location.href).searchParams.get('n') || '', 10); return Number.isFinite(n) && n >= 1000 ? Math.min(n, 1_000_000) : N })()
const DATA_TAG = 'length(bucket)×2 · filter→length · avg×2 — O(1)/tick'
const DATA_MD_TAG = ENGINES[0].mdTag
// d's brushing-lane tag lines (race/brush-peers.js), counted from the lanes as built: four
// filter primitives, four leave-one-out histogram derivations + one count = five, or the
// shape the library actually has (react: ONE memo for the four histograms + one for the
// count, keyed on the filters object; rxjs: a BehaviorSubject through five maps). The shared
// ENGINES[].mdTag strings ("computed × 4") are a·b's and undercount the lanes here;
// crossfilter's says the honest thing in data's own words: its filterRange walks only the
// rows crossing the boundary too — O(Δ)/brush, the one peer with the same complexity class
const MD_TAG_D = {
  mobx: 'observable.box × 4 → computed × 5 · O(N)/brush', solid: 'createSignal × 4 → createMemo × 5 · O(N)/brush',
  preact: 'signal × 4 → computed × 5 · O(N)/brush', vue: 'shallowRef × 4 → computed × 5 · O(N)/brush',
  svelte: 'writable × 4 → derived × 5 · O(N)/brush',
  rxjs: 'BehaviorSubject → map() × 5 · O(N)/emit', react: 'useState + useMemo × 2 + flushSync · O(N)/brush',
  crossfilter: 'filterRange + group.all() · O(Δ)/brush',
}
// the brushing multiple: a peer's p50 over data's for the same brushes — crossfilter's
// incremental index lands well under 1×, so a ratio below one keeps two decimals
const fmtRatioB = r => (r >= 10 ? Math.round(r) : r >= 1 ? r.toFixed(1) : r.toFixed(2)) + '×'
// a digit-free dash in a figure slot: the attestation comes off with the figure
const dash = el => { if (!el) return; if (el.textContent !== '—') el.textContent = '—'; el.removeAttribute('data-attested') }

/* ---------- the workload: the old race's drifting order book (synthetic INPUT) ----------
   The regime — mid, spread, imbalance — is a mean-reverting (OU) random walk paced
   on the wall clock (0.1 s steps), so the book wanders at a watchable speed whatever
   the slider says; every tick reprices ONE random order around the current mid.
   Nothing here is ever printed: the rows go into $(), the ticks go into batch(). */
function makeWorkloadD (seed, n) {
  const r = lcg(seed), nz = gaussFrom(lcg(Math.imul(seed, 2654435761) >>> 0))
  const DT = 0.1, t0 = performance.now(), sdt = Math.sqrt(DT)
  const MID_THETA = 0.2, MID_SIGMA = 3 * Math.sqrt(2 * MID_THETA)
  let mid = MID0, spread = 12, imb = 0, step = 0
  const advance = () => {
    mid += MID_THETA * (MID0 - mid) * DT + MID_SIGMA * sdt * nz()
    mid = Math.max(P_LO + 10, Math.min(P_HI - 10, mid))
    spread += 0.1 * (12 - spread) * DT + 3 * sdt * nz(); spread = Math.max(6, Math.min(20, spread))
    imb += 0.1 * (0 - imb) * DT + 0.25 * sdt * nz(); imb = Math.max(-0.3, Math.min(0.3, imb))
  }
  const sync = () => { const want = ((performance.now() - t0) / 1000 / DT) | 0; while (step < want) { step++; advance() } }
  const hs = () => 4 + Math.min(r(), r()) * spread
  const CAP = 8000
  const TI = new Int32Array(CAP), TF = new Uint8Array(CAP), TV = new Float64Array(CAP)
  return {
    TI, TF, TV, CAP,
    // rows [from, to) into the initial object — chunked across frames by the builder
    generate (out, from, to) { for (let i = from; i < to; i++) { const h = hs(); out[i] = { id: i, bid: mid - h, ask: mid + h } } },
    // k ticks into the typed arrays: idx, field (1 = ask), the new price
    ticks (k) {
      sync()
      for (let i = 0; i < k; i++) {
        const ask = r() < 0.5 + imb, h = hs()
        TI[i] = (r() * n) | 0; TF[i] = ask ? 1 : 0; TV[i] = ask ? mid + h : mid - h
      }
    },
  }
}

function setupOrderbookD (host) {
  const canvas = host.querySelector('canvas'), ladder = host.querySelector('.ob-ladder'), ctx = canvas.getContext('2d')
  const st = { ctx, w: 0, h: 0, rows: [], scaleRef: { v: 1 }, flashes: [], split: -1, edgeX: new Float64Array(BINS).fill(NaN), edgeY: new Float64Array(BINS), mid: MID0 }
  function resize () {
    const d = dpr(), rect = canvas.getBoundingClientRect()
    st.w = Math.max(120, Math.round(rect.width)); st.h = Math.max(120, Math.round(rect.height))
    canvas.width = st.w * d; canvas.height = st.h * d; ctx.setTransform(d, 0, 0, d, 0, 0)
  }
  resize()
  // one row per bucket, descending price; each row is an ask or a bid depending on
  // where the live mid sits, and the spread pill is moved between the two sides.
  // The price column is the bucket axis (data-literal); qty/cum are the
  // length(bucket) view's counts (attested 'runtime' once they are painted).
  for (let i = LADDER_HI; i >= LADDER_LO; i--) {
    const row = document.createElement('div'); row.className = 'rd-row is-empty'
    row.innerHTML = `<span class="rd-bar"></span><span class="ob-cell-price" data-literal>$${bucketPrice(i).toFixed(2)}</span><span class="ob-cell-qty">–</span><span class="ob-cell-cum">–</span>`
    ladder.appendChild(row)
    st.rows.push({ bucket: i, el: row, bar: row.children[0], qtyEl: row.children[2], cumEl: row.children[3], side: '', empty: true, best: false, w: 0, qty: 0, cum: 0 })
  }
  const pill = document.createElement('div'); pill.className = 'rd-spread'
  pill.innerHTML = '<span class="rd-pill"><span>—</span><i>mean spread —</i></span>'
  pill.title = "mid = (avg('bid') + avg('ask')) / 2 · mean spread = avg('ask') − avg('bid') — two views of the engine, over every order"
  ladder.appendChild(pill)
  st.pill = pill; st.pillPrice = pill.firstElementChild.children[0]; st.pillSpr = pill.firstElementChild.children[1]
  st.resize = resize
  return st
}

// one side of the depth staircase on the price axis: gradient fill (opaque at the
// outer edge, near-clear at the mid), a 3px low-alpha glow stroke, then the crisp
// 1px step line. Returns the segments (nearest-first) so the caller can find the
// best level and place flashes on the step edges.
function drawSideD (ctx, st, counts, dir, mid, yFor, scale, usableW, rgb) {
  const { w, h } = st, segs = []
  for (let i = 0; i < BINS; i++) {
    const lo = P_LO + i * P_STEP, hi = lo + P_STEP, c = lo + P_STEP / 2
    if (dir > 0 ? c > mid : c <= mid) segs.push({ bucket: i, near: dir > 0 ? Math.max(lo, mid) : Math.min(hi, mid), far: dir > 0 ? hi : lo, v: counts[i] || 0 })
  }
  if (dir > 0) segs.sort((a, b) => a.near - b.near); else segs.sort((a, b) => b.near - a.near)
  let cum = 0
  for (const s of segs) {
    cum += s.v
    s.x = Math.round(w - (cum / scale) * usableW) + 0.5; s.y0 = Math.round(yFor(s.near)) + 0.5; s.y1 = Math.round(yFor(s.far)) + 0.5
    st.edgeX[s.bucket] = s.x; st.edgeY[s.bucket] = (s.y0 + s.y1) / 2
  }
  if (!segs.length) return segs
  const trace = () => { ctx.beginPath(); ctx.moveTo(w, segs[0].y0); for (const s of segs) { ctx.lineTo(s.x, s.y0); ctx.lineTo(s.x, s.y1) } }
  const g = ctx.createLinearGradient(0, dir > 0 ? 0 : h, 0, yFor(mid))
  g.addColorStop(0, `rgba(${rgb},0.35)`); g.addColorStop(1, `rgba(${rgb},0.04)`)
  trace(); ctx.lineTo(w, segs[segs.length - 1].y1); ctx.closePath(); ctx.fillStyle = g; ctx.fill()
  trace(); ctx.lineWidth = 3; ctx.strokeStyle = `rgba(${rgb},0.22)`; ctx.lineJoin = 'round'; ctx.stroke()
  trace(); ctx.lineWidth = 1; ctx.strokeStyle = `rgb(${rgb})`; ctx.stroke()
  return segs
}

// bids/asks: the two length(bucket) histograms flattened to BINS counts. mid and
// spread are the ENGINE's: mid = (avg('bid') + avg('ask')) / 2 and spread =
// avg('ask') − avg('bid') — the mean of ask − bid over every order, exact because
// avg is linear. Nothing printed here is derived from the ladder's price grid.
function renderOrderbookD (st, bids, asks, mid, spread, now) {
  const { ctx, w, h, rows, scaleRef } = st
  const liveMid = mid
  st.mid = liveMid
  /* the ladder: rows above the mid are asks, below are bids; cum grows away from the mid */
  let split = rows.length
  for (let j = 0; j < rows.length; j++) if (bucketPrice(rows[j].bucket) <= liveMid) { split = j; break }
  let aCum = 0, bCum = 0, bestA = -1, bestB = -1
  for (let j = split - 1; j >= 0; j--) { const r = rows[j], v = asks[r.bucket] || 0; aCum += v; r.qty = v; r.cum = aCum; if (bestA < 0 && v > 0) bestA = j }
  for (let j = split; j < rows.length; j++) { const r = rows[j], v = bids[r.bucket] || 0; bCum += v; r.qty = v; r.cum = bCum; if (bestB < 0 && v > 0) bestB = j }
  const maxCum = Math.max(aCum, bCum, 1)
  for (let j = 0; j < rows.length; j++) {
    const r = rows[j], side = j < split ? 'ask' : 'bid', best = j === bestA || j === bestB, empty = r.qty === 0
    if (r.side !== side) { r.el.classList.toggle('ask', side === 'ask'); r.el.classList.toggle('bid', side === 'bid'); r.side = side }
    if (r.best !== best) { r.el.classList.toggle('is-best', best); r.best = best }
    if (r.empty !== empty) { r.el.classList.toggle('is-empty', empty); r.empty = empty }
    attest(r.qtyEl, String(r.qty), 'runtime')
    attest(r.cumEl, String(r.cum), 'runtime')
    const bw = r.cum / maxCum
    if (Math.abs(bw - r.w) > 0.004) { r.w = bw; r.bar.style.transform = `scaleX(${bw.toFixed(3)})` }
  }
  if (split !== st.split) { st.split = split; st.pill.parentNode.insertBefore(st.pill, split < rows.length ? rows[split].el : null) }
  attest(st.pillPrice, '$' + liveMid.toFixed(2), 'runtime')
  attest(st.pillSpr, 'mean spread ' + spread.toFixed(2), 'runtime')

  /* the depth chart */
  let aDepth = 0, bDepth = 0
  for (let i = 0; i < BINS; i++) { if (bucketPrice(i) > liveMid) aDepth += asks[i] || 0; else bDepth += bids[i] || 0 }
  const need = Math.max(aDepth, bDepth, 1)
  if (need > scaleRef.v) scaleRef.v = need; else if (need < scaleRef.v * 0.6) scaleRef.v = need * 1.1 || 1
  const scale = scaleRef.v
  const G = 34, inset = 8, usableW = w - G - inset
  const yFor = p => h * (1 - (Math.max(VIEW_LO, Math.min(VIEW_HI, p)) - VIEW_LO) / (VIEW_HI - VIEW_LO))
  const yMid = yFor(liveMid)
  ctx.clearRect(0, 0, w, h)
  // gridlines + price labels in the left gutter
  ctx.font = `9px ${MONO}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
  for (let p = 60; p <= 90; p += 5) {
    const y = Math.round(yFor(p)) + 0.5
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(G, y); ctx.lineTo(w, y); ctx.stroke()
    ctx.fillStyle = 'rgba(128,128,122,0.85)'; ctx.fillText('$' + p, G - 7, y)
  }
  // the two staircases
  st.edgeX.fill(NaN)
  const aSegs = drawSideD(ctx, st, asks, 1, liveMid, yFor, scale, usableW, RGB.neg)
  const bSegs = drawSideD(ctx, st, bids, -1, liveMid, yFor, scale, usableW, RGB.pos)
  // the spread band: between the first non-empty step on each side, the mid printed inside
  const fa = aSegs.find(s => s.v > 0), fb = bSegs.find(s => s.v > 0)
  const yA = fa ? fa.y0 : yMid, yB = fb ? fb.y0 : yMid
  const bandTop = Math.min(yA, yB), bandH = Math.abs(yB - yA)
  ctx.fillStyle = 'rgba(255,255,255,0.055)'; ctx.fillRect(G, bandTop, w - G, bandH)
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.setLineDash([3, 4]); ctx.lineWidth = 1
  const ym = Math.round(yMid) + 0.5
  ctx.beginPath(); ctx.moveTo(G, ym); ctx.lineTo(w, ym); ctx.stroke(); ctx.setLineDash([])
  ctx.font = `600 10px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const ty = bandH >= 13 ? bandTop + bandH / 2 : yMid - 8
  const tx = G + (w - G - inset) * 0.42
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(12,12,13,0.9)'; ctx.strokeText('$' + liveMid.toFixed(2), tx, ty)
  ctx.fillStyle = '#edece8'; ctx.fillText('$' + liveMid.toFixed(2), tx, ty)
  // delta flashes: a dot on the step edge at the level a delta landed on + a faint
  // streak to the edge, fading over 300 ms (presentation of a real delta)
  const F = st.flashes; let live = 0
  for (const f of F) {
    const age = now - f.t; if (age >= FLASH_MS) continue
    F[live++] = f
    const x = st.edgeX[f.bucket]; if (!(x === x)) continue
    const k = age / FLASH_MS, a = 1 - k, rgb = f.side > 0 ? RGB.neg : RGB.pos, y = st.edgeY[f.bucket]
    ctx.fillStyle = `rgba(${rgb},${(0.14 * a).toFixed(3)})`; ctx.fillRect(x, y - 1, w - x, 2)
    ctx.fillStyle = `rgba(${rgb},${(0.95 * a).toFixed(3)})`; ctx.beginPath(); ctx.arc(x, y, 2 + 3.5 * k, 0, 6.2832); ctx.fill()
  }
  F.length = live
}

/* the cpu wave for d: data as a soft green area with a crisp top line, the selected
   peer (stage 2) as an accent line over a faint area, the dashed 16 ms budget with its
   label at the left, a tiny legend at the top-right. sqrt y-scale so 0.4 ms and 21 ms
   both read. Every sample pushed is a performance.now() measurement. */
function makeWaveD (canvas) {
  const CAP = 110, SMOOTH = 20, ctx = canvas.getContext('2d')
  let W = 0, H = 0
  const resize = () => { const d = dpr(); W = canvas.clientWidth || 540; H = canvas.clientHeight || 64; canvas.width = Math.round(W * d); canvas.height = Math.round(H * d); ctx.setTransform(d, 0, 0, d, 0, 0) }
  resize(); window.addEventListener('resize', () => { resize(); draw() })
  const main = { samples: [], raw: [] }, base = { samples: [], raw: [] }
  let self = true, label = 'data'
  const smooth = (s, ms) => { s.raw.push(ms); if (s.raw.length > SMOOTH) s.raw.shift(); let t = 0; for (const v of s.raw) t += v; const avg = t / s.raw.length; s.samples.push(avg); if (s.samples.length > CAP) s.samples.shift(); return avg }
  const yOf = (v, top) => H - 3 - Math.sqrt(Math.min(1, v / top)) * (H - 9)
  function path (s, top) { const step = W / (CAP - 1); ctx.beginPath(); for (let i = 0; i < s.samples.length; i++) { const x = i * step, y = yOf(s.samples[i], top); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y) } return s.samples.length }
  function area (s, top, fill) { const n = path(s, top); if (!n) return; ctx.lineTo((n - 1) * (W / (CAP - 1)), H); ctx.lineTo(0, H); ctx.closePath(); ctx.fillStyle = fill; ctx.fill() }
  function line (s, top, stroke, lw) { if (!path(s, top)) return; ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke() }
  function draw () {
    ctx.clearRect(0, 0, W, H)
    let top = 0.4
    for (const v of main.samples) if (v > top) top = v
    for (const v of base.samples) if (v > top) top = v
    top = Math.max(top, 17)
    const y16 = Math.round(yOf(16, top)) + 0.5
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, y16); ctx.lineTo(W, y16); ctx.stroke(); ctx.setLineDash([])
    area(base, top, 'rgba(103,219,161,0.16)'); line(base, top, COLOR.pos, 1.25)
    if (!self) { area(main, top, 'rgba(255,94,58,0.09)'); line(main, top, COLOR.accent, 1.25) }
    // the budget label and the legend sit just under the dashed line (it hugs the top on the
    // sqrt scale), haloed so a peer trace running over 16 ms stays legible through them
    const halo = (t, x, y) => { ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(12,12,13,0.85)'; ctx.strokeText(t, x, y); ctx.fillText(t, x, y) }
    const ly = y16 + 4
    ctx.font = `9px ${MONO}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = COLOR.faint; halo('16 ms', 6, ly)
    ctx.font = `500 9px ${MONO}`; ctx.textAlign = 'right'
    let x = W - 8
    if (!self) { const t = '● ' + label; ctx.fillStyle = COLOR.accent; halo(t, x, ly); x -= ctx.measureText(t).width + 12 }
    ctx.fillStyle = COLOR.pos; halo('● data', x, ly)
  }
  const p50 = s => { if (!s.samples.length) return 0; const a = s.samples.slice().sort((x, y) => x - y); return a[Math.floor((a.length - 1) * 0.5)] }
  return {
    push (mainMs, baseMs) { smooth(main, mainMs); smooth(base, baseMs); draw(); const pb = p50(base), pm = p50(self ? base : main); return { pm, pb, ratio: pb > 0.0005 ? pm / pb : 0 } },
    current () { const pb = p50(base), pm = p50(self ? base : main); return { pm, pb, ratio: pb > 0.0005 ? pm / pb : 0 } },
    reset (selfBase, name) { self = selfBase; label = name || 'data'; main.samples.length = main.raw.length = base.samples.length = base.raw.length = 0; draw() },
    draw,
  }
}

/* the deltas tape: the last eight row deltas the sink saw, newest at the right.
   Each print is a real UpdateDelta — key, path, the new leaf (and prev in the
   title) — so every span is attested 'runtime'. */
function makeTape (line, max = 8) {
  const items = []
  return {
    push (d, animate = true) {
      const field = d.path.length ? d.path[0] : (d.row.ask !== d.prev.ask ? 'ask' : 'bid')
      const next = d.row[field], prev = d.prev[field]
      const el = document.createElement('span'); el.className = 'rd-fill ' + (field === 'ask' ? 'up' : 'dn') + (animate ? ' in' : '')
      el.innerHTML = `<em>#${d.key}</em> <b>$${next.toFixed(2)}</b> <i>${field === 'ask' ? '▲' : '▼'}</i>`
      el.title = `update ${d.key} .${field} ${prev.toFixed(2)} → ${next.toFixed(2)}`
      el.setAttribute('data-attested', 'runtime')
      line.appendChild(el); items.push(el)
      while (items.length > max) items.shift().remove()
    },
  }
}

function initD (root) {
  const { $, batch, runtime, value } = api
  const sel = q('#race-lib-d'), prev = q('#race-prev-d'), next = q('#race-next-d'), pos = q('#race-pos-d')
  const rateIn = q('#race-rate-d'), rateOut = q('#race-rate-out-d'), toggle = q('#race-toggle-d')
  const card = q('#race-card-d')
  const nameEl = q('#race-name-d'), verEl = q('#race-ver-d'), tagEl = q('#race-tag-d'), cpuEl = q('#race-cpu-d'), ratioEl = q('#race-ratio-d')
  const nEl = q('#race-rows-d'), capNEl = q('#race-cap-n-d')
  const buildEl = q('#race-build-d'), buildStage = q('#race-build-stage-d'), buildMs = q('#race-build-ms-d'), buildBar = q('#race-build-bar-d')
  const brushCpuEl = q('#race-brush-cpu-d'), flKick = q('#race-fl-kick-d'), capFEl = q('#race-cap-f-d')
  const mdCard = q('#race-brush-card-d'), mdName = q('#race-md-name-d'), mdVer = q('#race-md-ver-d'), mdTag = q('#race-md-tag-d')
  const vsEl = q('#race-brush-vs-d'), baseBrushEl = q('#race-brush-base-d'), ratioBrushEl = q('#race-brush-ratio-d')
  const activeEl = q('#race-active-d'), totalEl = q('#race-total-d'), msEl = q('#race-ms-d'), p50El = q('#race-p50-d'), p95El = q('#race-p95-d'), nLatEl = q('#race-n-d')
  const fbuildEl = q('#race-fbuild-d'), fbuildStage = q('#race-fbuild-stage-d'), fbuildMs = q('#race-fbuild-ms-d'), fbuildBar = q('#race-fbuild-bar-d')
  const liquidEl = q('#race-liquid-d'), avgEl = q('#race-avg-d'), baseEl = q('#race-base-d'), tpsEl = q('#race-tps-d')
  const chartsHost = q('#race-charts-d'), tapeLine = q('#race-tape-d')
  for (const e of ENGINES) { const o = document.createElement('option'); o.value = e.id; o.textContent = e.label; sel.appendChild(o) }
  let idx = 0, eng = ENGINES[0]
  const rate = () => Math.round(Math.pow(10, +rateIn.value))
  const showRate = () => put(rateOut, fmtRate(rate()) + ' ticks/sec')   // the REQUESTED rate (a control setting, data-literal); the strip's TICKS / SEC is measured
  showRate(); rateIn.addEventListener('input', showRate)
  const chartWidths = () => {
    const cols = getComputedStyle(chartsHost).gridTemplateColumns.split(' ').length || 2
    const w = Math.max(100, Math.floor((chartsHost.clientWidth - 32 - 14.4 * (cols - 1)) / cols) - 20)
    return [w, w, w, w]
  }

  /* ---------- the engine side ---------- */
  const wl = makeWorkloadD(7, N_D)
  const ob = setupOrderbookD(q('#race-ob-d'))
  const wave = makeWaveD(q('#race-wave-d'))
  const tape = makeTape(tapeLine)
  const bidsFlat = new Float64Array(BINS), asksFlat = new Float64Array(BINS)
  const flat = (o, out) => { out.fill(0); for (const k in o) out[k] = o[k].value }
  let orders = null, liquid = null, avgBid = null, avgAsk = null, bids = null, asks = null
  let initial = null, gi = 0, step = 0, built = false, bootT0 = 0, bootMs = 0, genMs = 0
  const steps = {}   // per-step boot cost (ms) → window.__perf['race.boot.steps']
  const last = { d: null, seq: 0 }   // the newest row delta of the newest commit (from the sink)
  const onBuilt = []   // resolvers waiting for the source (a peer selected mid-build)
  /* the selected peer (stage 2): the live adapter { ingest, settle, view, dispose } or null
     while data is selected / a load is in flight / the load failed. selSeq supersedes a
     load that lands after the visitor has moved on. */
  let peer = null, selSeq = 0
  const SHAPE = { bins: BINS, bucketOf, thresh: THRESH }

  // the lazy, chunked build: rows are generated ≤ 8 ms per frame; then one engine
  // step per frame ($(), the four views, the sink) — each step is the real
  // constructor walk over N rows, narrated by the progress line
  const STEPS = [
    ['$(orders)', () => { orders = $(initial); initial = null; attest(nEl, orders.rowCount(), 'runtime'); attest(capNEl, orders.rowCount(), 'runtime') }],
    ['filter → length', () => { liquid = orders.filter(t => t.ask - t.bid > THRESH).length() }],
    ["avg('bid')", () => { avgBid = orders.avg('bid') }],
    ["avg('ask')", () => { avgAsk = orders.avg('ask') }],
    ['length(bucket) · bids', () => { bids = orders.length(t => bucketOf(t.bid)) }],
    ['length(bucket) · asks', () => { asks = orders.length(t => bucketOf(t.ask)) }],
    ['sink', () => {
      orders.sink({ apply (b) { const rows = b.rows; if (rows.length) { last.d = rows[rows.length - 1]; last.seq = b.seq } } })
      // one warm-up commit so every figure is live before the loop starts (REDUCED
      // motion never starts it): the same batch shape the loop uses
      applyTicks(Math.max(1, Math.round(rate() / 60)), performance.now())
      paintBook(performance.now())
    }],
  ]
  function buildStep (now) {
    if (!bootT0) { bootT0 = now; initial = {}; buildEl.hidden = false }
    if (gi < N_D) {
      const t0 = performance.now()
      while (gi < N_D && performance.now() - t0 < 8) { const to = Math.min(N_D, gi + 5000); wl.generate(initial, gi, to); gi = to }
      genMs += performance.now() - t0
      put(buildStage, 'generating rows')
      buildBar.style.transform = `scaleX(${(0.5 * gi / N_D).toFixed(3)})`
    } else if (step < STEPS.length) {
      const [label, run] = STEPS[step++]
      put(buildStage, label); const ts = performance.now(); run(); (steps[label] = performance.now() - ts)
      buildBar.style.transform = `scaleX(${(0.5 + 0.5 * step / STEPS.length).toFixed(3)})`
      if (step === STEPS.length) {
        built = true; bootMs = performance.now() - bootT0
        ;(window.__perf ||= {})['race.boot.ms'] = bootMs; window.__perf['race.rows'] = orders.rowCount(); window.__perf['race.boot.steps'] = { generate: genMs, ...steps }
        buildEl.hidden = true
        nEl.title = `built in ${Math.round(bootMs)} ms on this machine`
        for (const r of onBuilt.splice(0)) r()
      }
    }
    attest(buildMs, Math.round(performance.now() - bootT0) + ' ms', 'measured')
  }

  // k ticks → ONE batch() → the measured frame cost (settle + effects included);
  // then the SAME k ticks → the selected peer (ingest × k, settle once) in an
  // identical window → the peer's frame cost. Both windows are performance.now()
  // in this tab; the wave gets (peer, data) and the ratio is theirs.
  function applyTicks (k, now) {
    wl.ticks(k)
    const { TI, TF, TV } = wl
    const t0 = performance.now()
    batch(() => { for (let i = 0; i < k; i++) orders.get(TI[i]).set(TF[i] ? 'ask' : 'bid', TV[i]) })
    const ms = performance.now() - t0
    ;(window.__perf ||= {})['race.frame.ms'] = ms
    let pms = ms
    if (peer) {
      const t1 = performance.now()
      for (let i = 0; i < k; i++) peer.ingest(TI[i], TF[i] ? 'ask' : 'bid', TV[i])
      peer.settle()
      pms = performance.now() - t1
      window.__perf['race.peer.ms'] = pms
    }
    paintCpu(wave.push(pms, ms))
    // presentation of the commit's newest delta: a flash where it landed (sampled
    // so the chart sparkles, not strobes) and the tape's next print
    const d = last.d
    if (d && Math.random() < Math.min(0.6, k / 66)) { const f = d.path.length ? d.path[0] : 'ask'; ob.flashes.push({ bucket: bucketOf(d.row[f]), side: f === 'ask' ? 1 : -1, t: now }) }
    return ms
  }
  // pm = the selected engine's smoothed median ms/frame, pb = data's, ratio = pm / pb
  // (with a peer live) — the card's figure, the pane header's multiple, the strip's baseline
  function paintCpu ({ pm, pb, ratio }) {
    if (peer) {
      attest(cpuEl, fmtCpu(pm), 'measured'); cpuEl.classList.toggle('over', pm > 16)
      if (ratio > 0) { attest(ratioEl, fmtRatio(ratio) + ' data', 'measured'); attest(baseEl, `${fmtMs(pb)} (${fmtRatio(ratio)})`, 'measured') }
      else { dash(ratioEl); attest(baseEl, fmtMs(pb), 'measured') }
      return
    }
    if (eng.id === 'data') { attest(cpuEl, fmtCpu(pm), 'measured'); cpuEl.classList.toggle('over', pm > 16) }
    attest(baseEl, fmtMs(pb), 'measured')
  }
  function paintBook (now) {
    const L = liquid[value], A = avgBid[value], K = avgAsk[value]
    attest(liquidEl, L, 'runtime')
    attest(avgEl, A.toFixed(2), 'runtime')
    flat(bids[value], bidsFlat); flat(asks[value], asksFlat)
    renderOrderbookD(ob, bidsFlat, asksFlat, (A + K) / 2, K - A, now)   // the pill: two avg views
    // lockstep (the first paint after a mount, then every 20th): the peer's four derivations
    // over ITS copy must agree with data's views — the printed book is data's; this is the
    // probe's proof the peer did the same work on the same book (window.__perf['race.peer.lockstep'])
    if (peer && (++lockN === 1 || lockN % 20 === 0)) {
      const v = peer.view()
      let same = v.liquid === L && Math.abs(v.avg - A) < 1e-6
      for (let i = 0; same && i < BINS; i++) same = (v.bids[i] || 0) === bidsFlat[i] && (v.asks[i] || 0) === asksFlat[i]
      window.__perf['race.peer.lockstep'] = same
      if (!same) window.__perf['race.peer.lockstep.detail'] = { liquid: [L, v.liquid], avg: [A, v.avg], bids: [Array.from(bidsFlat), v.bids], asks: [Array.from(asksFlat), v.asks] }
    }
  }
  let lockN = 0

  /* ---------- the brushing card (stage 3): the real flights, the real graph ---------- */
  // the four charts exist (empty) from the start; the graph is built one step per frame
  // once the flights have arrived and the order book is up (race/brush.js)
  const lane = makeBrushLane({
    api, host: chartsHost, widths: chartWidths(), height: 104, style: { COLOR, MONO, dpr },
    onSource (source) {   // `$(flights)` just ran: the row count is the engine's
      const n = source.rowCount()
      flKick.textContent = ''
      const b = document.createElement('b'); b.id = 'race-fl-d'; attest(b, n, 'runtime')
      flKick.append(b, ' flight rows')
      attest(capFEl, n, 'runtime'); attest(totalEl, n, 'runtime')
    },
    onReady () {   // the graph is up, the seeded filter in: the counts are live; no brush measured yet
      attest(totalEl, lane.total(), 'runtime')
      const p = (window.__perf ||= {}); p['race.brush.active'] = lane.activeCount(); p['race.brush.total'] = lane.total(); p['race.brush.n'] = 0
      if (!lane.peer) paintDataRest()
      for (const r of onLaneReady.splice(0)) r(true)
    },
    onBrush: paintBrush,
  })
  const onLaneReady = []   // resolvers waiting for the brushing graph (a peer selected before the flights were built)
  const fl = makeFlightsLoader({ url: new URL('./data/flights.js', document.baseURI).href })
  window.__race = { brush: lane, book: () => ({ orders, liquid, avgBid, avgAsk, bids, asks }) }   // for probes only: the lane's nodes / stats, the book's handles (never read by the page itself)
  let flSteps = null, flStep = 0, flDone = false, flT0 = 0
  const flStepMs = {}
  // ms = this brush's write (settle + effects), stats = the session's p50 / p95 / n — all
  // performance.now() in this tab; the counts are the views' values. data's session is
  // recorded whatever is selected (the baseline); the card's figures are the SELECTED
  // engine's — data's, or the peer's own window / count / session under a peer
  function paintBrush ({ ms, stats, peer: pr }) {
    const p = (window.__perf ||= {})
    p['race.brush.ms'] = ms; p['race.brush.p50'] = stats.p50; p['race.brush.p95'] = stats.p95; p['race.brush.n'] = stats.n; p['race.brush.seq'] = stats.seq
    p['race.brush.active'] = lane.activeCount(); p['race.brush.total'] = lane.total()
    attest(totalEl, lane.total(), 'runtime')
    // the card's figures are the SELECTED engine's: data's under data, the peer's under a
    // mounted peer. A peer selected but not mounted (its import in flight, or failed →
    // "peer unavailable") gets NO figures — printing data's ms under its name would label
    // one engine's measurement as another's; only the count (the same in every engine) moves
    if (pr) paintPeerBrush(pr); else if (eng.id === 'data') paintDataFigures(ms, stats); else attest(activeEl, lane.activeCount(), 'runtime')
  }
  const hideVs = () => { vsEl.hidden = true; dash(baseBrushEl); dash(ratioBrushEl) }
  function paintDataFigures (ms, stats) {
    attest(brushCpuEl, fmtLat(stats.p50) + ' ms/brush', 'measured'); brushCpuEl.classList.toggle('over', stats.p50 > 16)
    attest(activeEl, lane.activeCount(), 'runtime')
    attest(msEl, fmtLat(ms), 'measured'); attest(p50El, fmtLat(stats.p50), 'measured'); attest(p95El, fmtLat(stats.p95), 'measured'); attest(nLatEl, stats.n, 'measured')
    hideVs()
  }
  // data selected, nothing brushed right now: its session's figures, or the dashes at rest
  function paintDataRest () {
    if (!lane.built) return
    if (lane.stats.n > 0) { paintDataFigures(lane.stats.last, lane.stats); return }
    attest(activeEl, lane.activeCount(), 'runtime'); attest(nLatEl, 0, 'measured')
    dash(msEl); dash(p50El); dash(p95El); dash(brushCpuEl); brushCpuEl.classList.remove('over'); hideVs()
  }
  // the peer's figures: ms = its window (brush + the forced read of its histograms + count),
  // stats = its own session; active = its count (asserted equal to data's — race.brush.lockstep);
  // base / ratio = data's p50 for the same brushes and the peer's p50 over it — all measured
  function paintPeerBrush ({ id, ms, stats, active, lockstep }) {
    attest(brushCpuEl, fmtLat(stats.p50) + ' ms/brush', 'measured'); brushCpuEl.classList.toggle('over', stats.p50 > 16)
    attest(activeEl, active, 'runtime')
    attest(msEl, fmtLat(ms), 'measured'); attest(p50El, fmtLat(stats.p50), 'measured'); attest(p95El, fmtLat(stats.p95), 'measured'); attest(nLatEl, stats.n, 'measured')
    if (stats.base != null && stats.ratio != null) { attest(baseBrushEl, fmtLat(stats.base), 'measured'); attest(ratioBrushEl, fmtRatioB(stats.ratio), 'measured'); vsEl.hidden = false } else hideVs()
    const p = (window.__perf ||= {})
    p['race.brush.peer'] = id; p['race.brush.peer.ms'] = ms; p['race.brush.peer.p50'] = stats.p50; p['race.brush.peer.p95'] = stats.p95; p['race.brush.peer.n'] = stats.n
    p['race.brush.peer.active'] = active; p['race.brush.peer.base'] = stats.base; p['race.brush.peer.ratio'] = stats.ratio
    if (lockstep) { p['race.brush.lockstep'] = lockstep.same; if (lockstep.same) delete p['race.brush.lockstep.detail']; else p['race.brush.lockstep.detail'] = lockstep.detail }
  }
  // a peer just mounted, nothing brushed under it yet: its session's figures if it has been
  // selected before this page-life, else the dashes at rest; the readout is its count
  function paintPeerRest ({ id, stats, active, lockstep }) {
    if (stats.n > 0) { paintPeerBrush({ id, ms: stats.last, stats, active, lockstep }); return }
    attest(activeEl, active, 'runtime'); attest(nLatEl, 0, 'measured')
    dash(msEl); dash(p50El); dash(p95El); dash(brushCpuEl); brushCpuEl.classList.remove('over'); hideVs()
    const p = (window.__perf ||= {})
    p['race.brush.peer'] = id; p['race.brush.peer.n'] = 0; p['race.brush.peer.active'] = active; delete p['race.brush.peer.ms']
    if (lockstep) { p['race.brush.lockstep'] = lockstep.same; if (lockstep.same) delete p['race.brush.lockstep.detail']; else p['race.brush.lockstep.detail'] = lockstep.detail }
  }
  const MB = b => (b / 1048576).toFixed(1)
  // the flights pipeline, one slice per frame: the worker's phases are mirrored into the
  // progress line; the row build and every engine step run here, one per frame
  function flightsStep (now) {
    const st = fl.st
    if (st.phase === 'idle') { fl.start(); flT0 = now; fbuildEl.hidden = false }
    let bar = 0
    if (st.phase === 'error') {
      flDone = true; put(fbuildStage, 'flights unavailable'); put(fbuildMs, ''); fbuildMs.removeAttribute('data-attested'); fbuildBar.style.transform = 'scaleX(0)'
      put(flKick, 'flights unavailable'); console.warn('[race] flights failed to load — the brushing card stays empty', st.error)
      ;(window.__perf ||= {})['race.flights.error'] = st.error
      for (const r of onLaneReady.splice(0)) r(false)
      return
    }
    if (st.phase === 'fetching') {
      put(fbuildStage, 'fetching')
      attest(fbuildMs, st.total ? `${MB(st.received)} of ${MB(st.total)} MB` : `${MB(st.received)} MB`, 'measured')
      bar = st.total ? 0.4 * st.received / st.total : 0
    } else if (st.phase === 'parsing' || st.phase === 'projecting') {
      put(fbuildStage, st.phase); attest(fbuildMs, Math.round(now - flT0) + ' ms', 'measured'); bar = st.phase === 'parsing' ? 0.42 : 0.47
    } else if (st.phase === 'building') {
      fl.step(6)
      put(fbuildStage, 'building rows'); attest(fbuildMs, `${fmt(st.i)} of ${fmt(st.n)} rows`, 'measured'); bar = 0.5 + 0.1 * st.i / st.n
    } else if (st.phase === 'ready') {
      if (!flSteps) flSteps = lane.steps(st.flights)
      const [label, run] = flSteps[flStep++]
      put(fbuildStage, label); const ts = performance.now(); run(); flStepMs[label] = performance.now() - ts
      attest(fbuildMs, Math.round(performance.now() - flT0) + ' ms', 'measured'); bar = 0.6 + 0.4 * flStep / flSteps.length
      if (flStep === flSteps.length) {
        flDone = true; fbuildEl.hidden = true
        const total = performance.now() - flT0
        const p = (window.__perf ||= {})
        p['race.flights.ms'] = total; p['race.flights.rows'] = lane.total(); p['race.flights.bytes'] = st.bytes
        p['race.flights.steps'] = { ...st.ms, ...flStepMs }
        flKick.title = `${MB(st.bytes)} MB fetched, parsed and built in ${Math.round(total)} ms on this machine`
      }
    }
    fbuildBar.style.transform = `scaleX(${bar.toFixed(3)})`
  }

  /* ---------- the peers: load on selection, run in lockstep with data ---------- */
  const loopLive = () => shown && built && visible && !paused && !document.hidden && !REDUCED
  async function mountPeer (id) {
    const seq = selSeq   // taken by select() → dropPeer(); a later selection supersedes this one
    if (!built) await new Promise(r => onBuilt.push(r))   // selected mid-build: wait for the source
    if (seq !== selSeq) return
    let e
    try {
      const t0 = performance.now()
      const make = await loadPeer(id)                      // the dynamic import (esm.sh) — the book keeps ticking meanwhile
      if (seq !== selSeq) return
      const t1 = performance.now()
      // clone + build in ONE synchronous stretch (no frame in between): the peer starts
      // from exactly the book data has at this instant, its own copy
      const book = structuredClone(orders.snapshot())
      e = make(book, orders.rowCount(), SHAPE)
      const t2 = performance.now()
      ;(window.__perf ||= {})['race.peer'] = id; window.__perf['race.peer.import.ms'] = t1 - t0; window.__perf['race.peer.build.ms'] = t2 - t1
      nameEl.title = `${eng.label} imported in ${Math.round(t1 - t0)} ms · built on ${fmt(orders.rowCount())} rows in ${Math.round(t2 - t1)} ms on this machine`
    } catch (err) {
      console.warn(`[race] ${id} failed to load — data keeps running`, err)
      if (seq !== selSeq) return
      put(tagEl, 'peer unavailable'); dash(cpuEl); dash(ratioEl)
      ;(window.__perf ||= {})['race.peer'] = null; window.__perf['race.peer.error'] = String(err?.message || err)
      return
    }
    peer = e
    wave.reset(false, eng.label)
    put(tagEl, eng.tag)
    // the loop fills the figures on its next frame; when it is not running (reduced motion,
    // paused, off-screen) one measured frame of the same shape fills them now
    if (!loopLive()) { applyTicks(Math.max(1, Math.round(rate() / 60)), performance.now()); paintBook(performance.now()) }
  }
  function dropPeer () {
    ++selSeq
    if (peer) { peer.dispose(); peer = null; lockN = 0; (window.__perf ||= {})['race.peer'] = null; delete window.__perf['race.peer.ms']; delete window.__perf['race.peer.lockstep'] }
    if (lane.peer) { lane.clearPeer(); const p = (window.__perf ||= {}); p['race.brush.peer'] = null; for (const k of ['race.brush.peer.ms', 'race.brush.peer.p50', 'race.brush.peer.p95', 'race.brush.peer.n', 'race.brush.peer.active', 'race.brush.peer.base', 'race.brush.peer.ratio', 'race.brush.lockstep', 'race.brush.lockstep.detail']) delete p[k] }
  }
  // a frame the tag line can paint in before a synchronous build (a hidden tab gets no rAF: the timer fallback)
  const paintFrame = () => new Promise(r => { let done = false; const go = () => { if (!done) { done = true; r() } }; requestAnimationFrame(() => setTimeout(go, 0)); setTimeout(go, 150) })
  /* the BRUSHING peer (race/brush-peers.js), mounted alongside the order-book peer under the
     same selection guard: import (deduped with the book's), wait for the brushing graph if
     the flights are still building, say "building …" for a frame, then ONE synchronous build
     over the same adopted rows seeded with data's bounds (measured → the name's title); the
     lane switches its charts / readout to the peer. A failed load prints "peer unavailable"
     and the card keeps data's histograms (its figures dashed). */
  async function mountBrushPeer (id) {
    const seq = selSeq
    try {
      const t0 = performance.now()
      const make = await loadBrushPeer(id)
      if (seq !== selSeq) return
      const t1 = performance.now()
      const ok = lane.built || await new Promise(r => onLaneReady.push(r))
      if (seq !== selSeq) return
      if (!ok) { put(mdTag, 'flights unavailable'); return }
      mdTag.textContent = `building ${eng.label} on `
      const b = document.createElement('b'); attest(b, lane.total(), 'runtime'); mdTag.append(b, ' rows …')
      await paintFrame()
      if (seq !== selSeq) return
      // the build window: the constructor AND the lane's first forced read of the four
      // histograms + count (a lazy library computes nothing until then) — it ends at `r.at`,
      // before the lane paints its charts
      const t2 = performance.now()
      const adapter = make(lane.rows(), lane.bounds())
      const r = lane.setPeer(id, adapter)
      const t3 = r.at
      const p = (window.__perf ||= {})
      p['race.brush.peer.import.ms'] = t1 - t0; p['race.brush.peer.build.ms'] = t3 - t2
      mdName.title = `${eng.label} imported in ${Math.round(t1 - t0)} ms · built on ${fmt(lane.total())} rows in ${Math.round(t3 - t2)} ms on this machine`
      put(mdTag, MD_TAG_D[eng.id] ?? eng.mdTag)
      // event-driven: the figures rest dashed (n 0) until the visitor's first drag, in every
      // motion setting — exactly as data's own card rests. (A mount-time "fill" brush of the
      // bounds the peer already holds was dropped: crossfilter re-applies an unchanged range
      // as a no-op and printed it as a 0.0 ms brush.)
      paintPeerRest(r)
    } catch (err) {
      console.warn(`[race] ${id} brushing lane failed to load — the card keeps data's histograms`, err)
      if (seq !== selSeq) return
      put(mdTag, 'peer unavailable'); dash(msEl); dash(p50El); dash(p95El); dash(brushCpuEl); brushCpuEl.classList.remove('over'); hideVs()
      ;(window.__perf ||= {})['race.brush.peer'] = null; window.__perf['race.brush.peer.error'] = String(err?.message || err)
    }
  }

  /* ---------- the carousel: data is live; a peer is imported and built on selection ---------- */
  function select (i) {
    idx = (i + ENGINES.length) % ENGINES.length; eng = ENGINES[idx]
    const isData = eng.id === 'data'
    dropPeer()
    sel.value = eng.id; put(pos, `${idx + 1} / ${ENGINES.length}`)
    card.classList.toggle('is-data', isData); mdCard.classList.toggle('is-data', isData)   // both cards follow the carousel
    put(nameEl, eng.label); nameEl.removeAttribute('title'); put(mdName, eng.label); mdName.removeAttribute('title')
    // the version: 'v4' is literal typography for data (the gallery idiom); a peer's is the
    // pin in the import map — the version this page actually pulls from esm.sh ('build')
    for (const el of [verEl, mdVer]) {
      if (isData) { put(el, 'v4'); el.setAttribute('data-literal', ''); el.removeAttribute('data-attested') }
      else { const v = peerVersion(eng.id); el.removeAttribute('data-literal'); if (v) attest(el, v, 'build'); else { put(el, ''); el.removeAttribute('data-attested') } }
    }
    put(tagEl, isData ? DATA_TAG : `loading ${eng.label} …`); put(mdTag, isData ? DATA_MD_TAG : `loading ${eng.label} …`)
    // the old race's per-engine safe rate: an O(N)/frame peer starts gentler
    rateIn.value = String(DEF_RATE[eng.id] ?? DEF_RATE.data); showRate()
    dash(cpuEl); dash(ratioEl)
    if (isData) {
      put(ratioEl, 'baseline'); wave.reset(true, 'data')
      // the loop's next frame fills the figure; when it is not running, one measured frame does
      if (built && !loopLive()) { applyTicks(Math.max(1, Math.round(rate() / 60)), performance.now()); paintBook(performance.now()) }
      paintDataRest()   // the brushing card returns to data's own session (dropPeer repainted data's histograms)
    } else {
      // the brushing card's slots are dashed until the peer's first brush (its own session, if
      // it has one from earlier this page, comes back at mount); the readout stays data's count
      if (lane.built) { dash(msEl); dash(p50El); dash(p95El); dash(brushCpuEl); brushCpuEl.classList.remove('over'); attest(nLatEl, 0, 'measured'); hideVs() }
      mountPeer(eng.id); mountBrushPeer(eng.id)
    }
  }

  /* ---------- the loop: shown × near/on screen × not paused × tab visible ---------- */
  let shown = !root.hidden, near = false, visible = false, paused = false, stopped = false, lastFrame = 0, frac = 0, tickAcc = 0, tickT0 = 0, fillIn = 300
  // a commit that throws (clause 4: a failing effect anywhere on the SHARED runtime surfaces as
  // an AggregateError from THIS batch) must not escape into the page's one rAF loop — that
  // freezes every section with its last figures still stamped 'measured'. The section stops
  // instead, says so, takes every measured figure off, and the toggle becomes ▶ retry.
  function stop (err) {
    stopped = true; paused = true; lastFrame = 0
    console.error('[race] stopped — a commit threw; the figures are off until ▶ retry', err)
    ;(window.__perf ||= {})['race.error'] = String(err?.message || err)
    dash(cpuEl); dash(ratioEl); dash(baseEl); dash(tpsEl)
    put(tagEl, 'stopped — a commit threw (see the console)')
    if (!built) { put(buildStage, 'stopped'); put(buildMs, ''); buildMs.removeAttribute('data-attested') }
    if (!flDone) { put(fbuildStage, 'stopped'); put(fbuildMs, ''); fbuildMs.removeAttribute('data-attested') }
    toggle.textContent = '▶ retry'
  }
  function frame (now) {
    if (stopped) return
    try { tick(now) } catch (err) { stop(err) }
  }
  function tick (now) {
    if (!shown || document.hidden) { lastFrame = 0; return }
    if (!built) { if (near) buildStep(now); return }
    if (near && !flDone) flightsStep(now)   // the flights: after the book, one slice per frame, whatever the motion setting
    if (!visible || paused || REDUCED) { lastFrame = 0; return }
    const dt = lastFrame ? Math.min(100, now - lastFrame) : 16.7
    // the ticks/sec window restarts only when the loop does (resume / back on screen); a long
    // gap that IS a frame's own cost (a peer over budget) stays in the window, so the strip
    // prints the rate actually applied under that peer, never a stale figure
    if (!lastFrame) { tickAcc = 0; tickT0 = now }
    lastFrame = now
    const owed = rate() * dt / 1000 + frac
    const k = Math.min(wl.CAP, Math.floor(owed)); frac = owed - k
    if (k > 0) { applyTicks(k, now); tickAcc += k }
    fillIn -= dt
    if (fillIn <= 0 && last.d) { fillIn = 160 + Math.random() * 380; tape.push(last.d, true) }
    paintBook(now)
    if (now - tickT0 >= 500) { attest(tpsEl, Math.round(tickAcc / (now - tickT0) * 1000), 'measured'); tickAcc = 0; tickT0 = now }
  }
  onFrame(frame)
  const relayout = () => { ob.resize(); if (built) paintBook(performance.now()); lane.resize(chartWidths()) }
  root.addEventListener('variantshow', () => { shown = true; relayout() })
  root.addEventListener('varianthide', () => { shown = false })
  // `near` is LIVE, not sticky: the chunked builds (rows, the engine steps, the flights
  // pipeline's main-thread slices) run only while the section is within 600 px of the
  // viewport — a reader who scrolled past pays none of their frames (the worker's fetch +
  // parse carry on off the main thread) and the build resumes when the section comes back
  new IntersectionObserver(es => { near = es.some(e => e.isIntersecting) }, { rootMargin: '600px 0px' }).observe(root)
  new IntersectionObserver(es => { visible = es.some(e => e.isIntersecting) }, { threshold: 0.02 }).observe(root)
  window.addEventListener('resize', relayout)

  select(0)
  attest(tpsEl, 0, 'measured')
  sel.addEventListener('change', () => select(ENGINES.findIndex(e => e.id === sel.value)))
  prev.addEventListener('click', () => select(idx - 1))
  next.addEventListener('click', () => select(idx + 1))
  toggle.addEventListener('click', () => {
    if (stopped) {   // ▶ retry after a stop: re-arm; a thrower still on the runtime stops it again
      stopped = false; paused = false; delete window.__perf?.['race.error']
      put(tagEl, eng.id === 'data' ? DATA_TAG : peer ? eng.tag : 'peer unavailable'); put(mdTag, eng.id === 'data' ? DATA_MD_TAG : lane.peer ? (MD_TAG_D[eng.id] ?? eng.mdTag) : 'peer unavailable'); toggle.textContent = '⏸ pause'; return
    }
    paused = !paused; toggle.textContent = paused ? '▶ resume' : '⏸ pause'; if (paused) attest(tpsEl, 0, 'measured')
  })
}

/* ---------- boot ---------- */
const roots = { a: q('#race [data-variant="a"]'), b: q('#race [data-variant="b"]'), c: q('#race [data-variant="c"]'), d: q('#race [data-variant="d"]') }
if (roots.a) initA(roots.a)
if (roots.b) initB(roots.b)
if (roots.c) initC(roots.c)
if (roots.d) initD(roots.d)
