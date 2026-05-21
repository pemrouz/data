/* The live race — an honest head-to-head over a streaming order book.
 *
 * A book of 10,000 limit orders. Each tick replaces one order's bid or ask.
 * The SAME tick stream is fed, tick-for-tick, to two engines:
 *   • data  — incremental: trades.length(bucket(bid)) / length(bucket(ask))
 *             grouped counts, filter→length for the liquid count, avg('bid').
 *             Each tick is O(1): two bucket counters move, the aggregates step.
 *   • mobx  — the idiomatic signal approach: a version box + computeds that
 *             re-walk all 10,000 orders on every frame. O(N) per frame.
 *
 * Both maintain the same four views and render through the SAME function into
 * identical panels, so rendering cost is equal — the only on-screen difference
 * is the reactive engine. Per-frame cost = time(ingest + read) for that engine,
 * the ordering-independent metric the nine-library comparison uses
 * (examples/trades). Unlike a growing window, the book is bounded at 10k rows,
 * so there is no crossover: data stays cheap and the peer stays expensive at
 * every rate. Nothing is faked — MobX is a real library doing the natural thing.
 *
 * Hand-written `.js`, no `.ts` sibling (see CLAUDE.md). */

import { $, value } from 'data/full'
import { observable, computed, runInAction } from 'mobx'

const N = 200000
const THRESHOLD = 8            // an order is "liquid" when ask - bid > THRESHOLD
const AXIS_HI = 86, AXIS_LO = 64           // fixed price axis for the depth ladder
const LEVELS = AXIS_HI - AXIS_LO + 1       // one row per integer price
const bucket = p => Math.round(p)

/* ---------- workload: a drifting order book ---------- */

function mulberry32 (a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeWorkload (seed = 7) {
  const r = mulberry32(seed)
  const t0 = performance.now()
  // a brisk regime so the book visibly drifts and breathes within the fixed
  // axis — mid sweeps ~±7 over 9s, the spread opens and closes over 6s.
  const regime = () => {
    const t = (performance.now() - t0) / 1000
    return {
      mid: 75 + Math.sin(2 * Math.PI * t / 9) * 7,
      spread: 5 + (Math.sin(2 * Math.PI * t / 6) + 1) / 2 * 11,
      imbalance: Math.sin(2 * Math.PI * t / 11) * 0.25,
    }
  }
  const initial = () => {
    const reg = regime(), hs = reg.spread / 2, out = {}
    for (let i = 0; i < N; i++) {
      const jitter = (r() - 0.5) * reg.spread
      out[i] = { id: i, bid: reg.mid - hs + jitter, ask: reg.mid + hs + jitter }
    }
    return out
  }
  const nextTick = () => {
    const reg = regime()
    const idx = (r() * N) | 0
    const field = r() < (0.5 + reg.imbalance) ? 'ask' : 'bid'
    const hs = (reg.spread / 2) * (0.4 + r() * 1.2)
    const newValue = field === 'bid' ? reg.mid - hs : reg.mid + hs
    return { idx, field, newValue }
  }
  return { initial, nextTick, regime }
}

/* ---------- engine: data (incremental, O(1) per tick) ---------- */

function makeDataEngine (initial) {
  const trades = $(structuredClone(initial))
  const liquid = trades.filter(t => t.ask - t.bid > THRESHOLD).length()
  const avgBid = trades.avg('bid')
  const bids = trades.length(t => bucket(t.bid))
  const asks = trades.length(t => bucket(t.ask))
  const counts = view => {
    const v = view[value] || {}, out = {}
    for (const k in v) { const c = v[k]; out[k] = (c && c.value !== undefined) ? c.value : c }
    return out
  }
  return {
    ingest (tick) {
      const cur = trades[tick.idx][value]
      trades[tick.idx] = { ...cur, [tick.field]: tick.newValue }
    },
    read () { void liquid[value]; void avgBid[value]; void bids[value]; void asks[value] },
    view () { return { liquid: liquid[value] || 0, avgBid: avgBid[value] || 0, bids: counts(bids), asks: counts(asks) } },
  }
}

/* ---------- engine: mobx (computeds re-walk all N, O(N) per frame) ---------- */

function makeMobxEngine (initial) {
  const trades = structuredClone(initial)
  const ver = observable.box(0)
  const liquid = computed(() => { ver.get(); let n = 0; for (let i = 0; i < N; i++) { const t = trades[i]; if (t.ask - t.bid > THRESHOLD) n++ } return n })
  const avgBid = computed(() => { ver.get(); let s = 0; for (let i = 0; i < N; i++) s += trades[i].bid; return s / N })
  const bids = computed(() => { ver.get(); const o = {}; for (let i = 0; i < N; i++) { const b = bucket(trades[i].bid); o[b] = (o[b] || 0) + 1 } return o })
  const asks = computed(() => { ver.get(); const o = {}; for (let i = 0; i < N; i++) { const b = bucket(trades[i].ask); o[b] = (o[b] || 0) + 1 } return o })
  return {
    ingest (tick) {
      trades[tick.idx] = { ...trades[tick.idx], [tick.field]: tick.newValue }
      runInAction(() => ver.set(ver.get() + 1))
    },
    read () { void liquid.get(); void avgBid.get(); void bids.get(); void asks.get() },
    view () { return { liquid: liquid.get(), avgBid: avgBid.get(), bids: bids.get(), asks: asks.get() } },
  }
}

/* ---------- shared rendering: a depth ladder + two scalars ---------- */

const fmtBid = v => v.toFixed(2)

function buildPanelDOM (panel) {
  panel.innerHTML = `
    <div class="rc-scalars">
      <div class="rc-scalar"><span class="rc-scalar-num" data-k="liquid">—</span><span class="rc-scalar-lab">liquid orders</span></div>
      <div class="rc-scalar"><span class="rc-scalar-num" data-k="avg">—</span><span class="rc-scalar-lab">avg bid</span></div>
    </div>
    <div class="rc-ladder" data-k="ladder"></div>`
  const ladder = panel.querySelector('[data-k=ladder]')
  const rows = []
  for (let i = 0; i < LEVELS; i++) {
    const row = document.createElement('div')
    row.className = 'rc-lvl'
    row.innerHTML = `<span class="rc-bidbar"><span class="rc-bidfill"></span></span><span class="rc-price"></span><span class="rc-askbar"><span class="rc-askfill"></span></span>`
    ladder.appendChild(row)
    rows.push({ row, price: row.querySelector('.rc-price'), bid: row.querySelector('.rc-bidfill'), ask: row.querySelector('.rc-askfill') })
  }
  return { liquid: panel.querySelector('[data-k=liquid]'), avg: panel.querySelector('[data-k=avg]'), rows }
}

function renderView (refs, v) {
  refs.liquid.textContent = v.liquid.toLocaleString()
  refs.avg.textContent = fmtBid(v.avgBid)
  // FIXED price axis (AXIS_HI..AXIS_LO). The book slides and the spread breathes
  // across these rows as the regime drifts — that's the visible motion.
  let max = 1
  for (let i = 0; i < LEVELS; i++) {
    const p = AXIS_HI - i
    const bq = v.bids[p] || 0, aq = v.asks[p] || 0
    if (bq > max) max = bq
    if (aq > max) max = aq
  }
  for (let i = 0; i < LEVELS; i++) {
    const p = AXIS_HI - i
    const bq = v.bids[p] || 0, aq = v.asks[p] || 0
    const r = refs.rows[i]
    r.price.textContent = p
    r.bid.style.width = (bq / max * 100) + '%'
    r.ask.style.width = (aq / max * 100) + '%'
  }
}

/* ---------- per-engine cost meter (rolling p50, sparkline) ---------- */

function makeMeter (canvas, bigEl) {
  const samples = []
  const CAP = 90
  const ctx = canvas.getContext('2d')
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const resize = () => { canvas.width = canvas.clientWidth * dpr; canvas.height = canvas.clientHeight * dpr }
  resize(); window.addEventListener('resize', resize)
  function push (ms) {
    samples.push(ms)
    if (samples.length > CAP) samples.shift()
    const sorted = samples.slice().sort((a, b) => a - b)
    const p50 = sorted[Math.floor((sorted.length - 1) * 0.5)]
    bigEl.textContent = p50 >= 10 ? p50.toFixed(1) : p50.toFixed(2)
    bigEl.classList.toggle('over', p50 > 16)
    draw()
  }
  function draw () {
    const w = canvas.width, h = canvas.height
    ctx.clearRect(0, 0, w, h)
    const cap = 16
    const top = Math.max(cap * 1.3, ...samples)
    const y16 = h - (cap / top) * h
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.setLineDash([4 * dpr, 4 * dpr]); ctx.lineWidth = dpr
    ctx.beginPath(); ctx.moveTo(0, y16); ctx.lineTo(w, y16); ctx.stroke(); ctx.setLineDash([])
    const accent = getComputedStyle(canvas).getPropertyValue('--rc-line').trim() || '#ff5e3a'
    const step = w / (CAP - 1)
    // filled area under the line so the stream reads at a glance
    ctx.beginPath()
    for (let i = 0; i < samples.length; i++) {
      const x = i * step, y = h - (samples[i] / top) * h
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
    }
    if (samples.length) {
      ctx.lineTo((samples.length - 1) * step, h); ctx.lineTo(0, h); ctx.closePath()
      ctx.fillStyle = accent + '24'; ctx.fill()
    }
    // the line itself
    ctx.strokeStyle = accent; ctx.lineWidth = 1.8 * dpr; ctx.lineJoin = 'round'
    ctx.beginPath()
    for (let i = 0; i < samples.length; i++) {
      const x = i * step, y = h - (samples[i] / top) * h
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
    }
    ctx.stroke()
  }
  return { push, reset () { samples.length = 0; bigEl.textContent = '—' } }
}

/* ---------- driver ---------- */

export function createRace ({ dataPanel, peerPanel, dataMeter, dataBig, peerMeter, peerBig, rateInput, rateOut, statusEl, toggleBtn }) {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  const wl = makeWorkload()
  const initial = wl.initial()
  const data = makeDataEngine(initial)
  const peer = makeMobxEngine(initial)
  const dataRefs = buildPanelDOM(dataPanel)
  const peerRefs = buildPanelDOM(peerPanel)
  const dataM = makeMeter(dataMeter, dataBig)
  const peerM = makeMeter(peerMeter, peerBig)

  const rate = () => Math.round(Math.pow(10, +rateInput.value))
  const showRate = () => { if (rateOut) rateOut.textContent = rate().toLocaleString() + ' ticks/sec' }
  showRate(); rateInput.addEventListener('input', showRate)

  // settle once so panels aren't empty before the loop starts
  data.read(); peer.read()
  renderView(dataRefs, data.view()); renderView(peerRefs, peer.view())
  if (statusEl) statusEl.textContent = ''

  let running = false, raf = 0, lastT = 0, frac = 0
  function frame (now) {
    if (!running) return
    const dt = now - lastT; lastT = now
    const owed = rate() * Math.max(0, dt) / 1000 + frac
    // clamp: never negative (rAF timestamp can precede start()'s clock read),
    // and cap a catch-up burst after the tab was backgrounded.
    const k = Math.min(5000, Math.max(0, Math.floor(owed))); frac = owed - k

    // one batch, fed identically to both engines — same ticks, same workload
    const batch = new Array(k)
    for (let i = 0; i < k; i++) batch[i] = wl.nextTick()

    let t0 = performance.now()
    for (let i = 0; i < k; i++) data.ingest(batch[i])
    data.read()
    dataM.push(performance.now() - t0)
    renderView(dataRefs, data.view())

    t0 = performance.now()
    for (let i = 0; i < k; i++) peer.ingest(batch[i])
    peer.read()
    peerM.push(performance.now() - t0)
    renderView(peerRefs, peer.view())

    raf = requestAnimationFrame(frame)
  }
  const start = () => { if (!running) { running = true; lastT = performance.now(); raf = requestAnimationFrame(frame) } }
  const stop = () => { running = false; if (raf) cancelAnimationFrame(raf) }

  if (toggleBtn) toggleBtn.addEventListener('click', () => {
    if (running) { stop(); toggleBtn.textContent = '▶ resume' } else { start(); toggleBtn.textContent = '⏸ pause' }
  })
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(es => { if (es[0].isIntersecting && !reduceMotion) start(); else stop() }, { threshold: 0.1 }).observe(dataPanel)
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (!reduceMotion) start() })

  if (reduceMotion) {
    for (let i = 0; i < 200; i++) { const t = wl.nextTick(); data.ingest(t); peer.ingest(t) }
    let t0 = performance.now(); data.read(); dataM.push(performance.now() - t0); renderView(dataRefs, data.view())
    t0 = performance.now(); peer.read(); peerM.push(performance.now() - t0); renderView(peerRefs, peer.view())
  } else {
    start()
  }
}
