/* The live race — an honest, configurable head-to-head.
 *
 * The SAME order-book tick stream feeds two engines, rendered through the SAME
 * function — only the reactive engine differs:
 *   • data — incremental operators (length(bucket) ×2, filter→length, avg).
 *            Each tick is O(1); the work happens in ingest.
 *   • a peer — a fine-grained signal library (MobX / Solid / Preact-signals /
 *            Vue-reactivity). A version signal + four computeds that re-walk
 *            the whole book. We settle ONCE per frame (the real render cadence)
 *            so the peer pays one O(N) walk per frame, not one per tick —
 *            honest, and it keeps the page smooth (per-tick settling would lock
 *            the single main thread and jank *both* sides).
 *
 * React / RxJS / Svelte-store / crossfilter aren't fine-grained reactive
 * libraries and either can't run smoothly here or aren't comparable live; the
 * full nine-library comparison is the multidim workload (toggle) and the
 * examples/ pages. The book is bounded, so there's no crossover.
 *
 * Hand-written `.js`, no `.ts` sibling (see CLAUDE.md). */

import { $, value } from 'data/full'

const N = 150000
const THRESHOLD = 8
const AXIS_HI = 86, AXIS_LO = 64
const LEVELS = AXIS_HI - AXIS_LO + 1
const bucket = p => Math.round(p)

const PEERS = {
  mobx:   { label: 'MobX',            sub: 'observable + 4 computeds · O(N)/frame' },
  solid:  { label: 'Solid',           sub: 'createSignal + 4 memos · O(N)/frame' },
  preact: { label: 'Preact signals',  sub: 'signal + 4 computeds · O(N)/frame' },
  vue:    { label: 'Vue reactivity',  sub: 'shallowRef + 4 computeds · O(N)/frame' },
}

/* ---------- workload: a drifting order book ---------- */
function mulberry32 (a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

function makeWorkload (seed = 7) {
  const r = mulberry32(seed)
  const t0 = performance.now()
  const regime = () => {
    const t = (performance.now() - t0) / 1000
    return { mid: 75 + Math.sin(2 * Math.PI * t / 9) * 7, spread: 5 + (Math.sin(2 * Math.PI * t / 6) + 1) / 2 * 11 }
  }
  const initial = () => {
    const reg = regime(), hs = reg.spread / 2, out = {}
    for (let i = 0; i < N; i++) { const j = (r() - 0.5) * reg.spread; out[i] = { id: i, bid: reg.mid - hs + j, ask: reg.mid + hs + j } }
    return out
  }
  const nextTick = () => {
    const reg = regime(), idx = (r() * N) | 0
    const field = r() < 0.5 ? 'ask' : 'bid'
    const hs = (reg.spread / 2) * (0.4 + r() * 1.2)
    return { idx, field, newValue: field === 'bid' ? reg.mid - hs : reg.mid + hs }
  }
  return { initial, nextTick }
}

/* ---------- data engine (incremental, O(1)/tick) ---------- */
function makeDataEngine (initial) {
  const trades = $(structuredClone(initial))
  const liquid = trades.filter(t => t.ask - t.bid > THRESHOLD).length()
  const avgBid = trades.avg('bid')
  const bids = trades.length(t => bucket(t.bid))
  const asks = trades.length(t => bucket(t.ask))
  const counts = v0 => { const v = v0[value] || {}, o = {}; for (const k in v) { const c = v[k]; o[k] = (c && c.value !== undefined) ? c.value : c } return o }
  return {
    ingest (t) { const cur = trades[t.idx][value]; trades[t.idx] = { ...cur, [t.field]: t.newValue } },
    read () { void liquid[value]; void avgBid[value]; void bids[value]; void asks[value] },
    view () { return { liquid: liquid[value] || 0, avgBid: avgBid[value] || 0, bids: counts(bids), asks: counts(asks) } },
  }
}

/* ---------- generic signal-peer engine (lazy, settles once/frame) ---------- */
// `prims` = { signal(v) -> {get,set}, computed(fn) -> read(), bump(fn) }.
// ingest only mutates the plain book; read() bumps the version once, so each
// peer recomputes its four walks exactly once per frame.
function makeSignalEngine (prims, initial) {
  const trades = structuredClone(initial)
  const ver = prims.signal(0)
  const mk = fn => prims.computed(() => { ver.get(); return fn() })
  const liquid = mk(() => { let n = 0; for (let i = 0; i < N; i++) { const t = trades[i]; if (t.ask - t.bid > THRESHOLD) n++ } return n })
  const avgBid = mk(() => { let s = 0; for (let i = 0; i < N; i++) s += trades[i].bid; return s / N })
  const bids = mk(() => { const o = {}; for (let i = 0; i < N; i++) { const b = bucket(trades[i].bid); o[b] = (o[b] || 0) + 1 } return o })
  const asks = mk(() => { const o = {}; for (let i = 0; i < N; i++) { const b = bucket(trades[i].ask); o[b] = (o[b] || 0) + 1 } return o })
  const readers = [liquid, avgBid, bids, asks]
  return {
    ingest (t) { trades[t.idx] = { ...trades[t.idx], [t.field]: t.newValue } },
    // bump the version, then FORCE-read all four computeds so the O(N) recompute
    // happens inside the timed read() — lazy libs (mobx/preact/vue) defer the
    // walk to the read, eager ones (solid) do it on the bump; either way it's
    // captured here, not in the untimed view() below.
    read () { prims.bump(() => ver.set(ver.get() + 1)); for (const rd of readers) rd() },
    view () { return { liquid: liquid(), avgBid: avgBid(), bids: bids(), asks: asks() } },
  }
}

async function loadPeer (name) {
  if (name === 'mobx') {
    const { observable, computed, runInAction } = await import('mobx')
    return { signal: v => { const b = observable.box(v); return { get: () => b.get(), set: x => b.set(x) } }, computed: fn => { const c = computed(fn); return () => c.get() }, bump: runInAction }
  }
  if (name === 'preact') {
    const { signal, computed, batch } = await import('@preact/signals-core')
    return { signal: v => { const s = signal(v); return { get: () => s.value, set: x => { s.value = x } } }, computed: fn => { const c = computed(fn); return () => c.value }, bump: batch }
  }
  if (name === 'vue') {
    const { shallowRef, computed } = await import('@vue/reactivity')
    return { signal: v => { const r = shallowRef(v); return { get: () => r.value, set: x => { r.value = x } } }, computed: fn => { const c = computed(fn); return () => c.value }, bump: fn => fn() }
  }
  // solid: memos must be created under a root owner
  const { createSignal, createMemo, createRoot, batch } = await import('solid-js')
  let prims
  createRoot(() => {
    prims = {
      signal: v => { const [g, s] = createSignal(v); return { get: g, set: s } },
      computed: fn => createMemo(fn),
      bump: batch,
    }
  })
  return prims
}

/* ---------- shared rendering: depth ladder + two scalars ---------- */
function buildPanel (role, label, sub) {
  const el = document.createElement('div')
  el.className = 'rpanel ' + (role === 'data' ? 'is-data' : 'is-peer')
  el.innerHTML = `
    <div class="rpanel-head">
      <div class="rname">${label}<span class="rsub">${sub}</span></div>
      <div class="rcost"><span class="rcost-num" data-k="cost">—</span><span class="rcost-lab">ms / frame</span></div>
    </div>
    <canvas class="rmeter" data-k="meter"></canvas>
    <div class="rscalars">
      <div class="rscalar"><span class="rscalar-num" data-k="liquid">—</span><span class="rscalar-lab">liquid orders</span></div>
      <div class="rscalar"><span class="rscalar-num" data-k="avg">—</span><span class="rscalar-lab">avg bid</span></div>
    </div>
    <div class="rladder" data-k="ladder"></div>`
  const ladder = el.querySelector('[data-k=ladder]')
  const rows = []
  for (let i = 0; i < LEVELS; i++) {
    const row = document.createElement('div'); row.className = 'rlvl'
    row.innerHTML = `<span class="rbidbar"><span class="rbidfill"></span></span><span class="rprice"></span><span class="raskbar"><span class="raskfill"></span></span>`
    ladder.appendChild(row)
    rows.push({ price: row.querySelector('.rprice'), bid: row.querySelector('.rbidfill'), ask: row.querySelector('.raskfill') })
  }
  return { el, cost: el.querySelector('[data-k=cost]'), meter: el.querySelector('[data-k=meter]'), liquid: el.querySelector('[data-k=liquid]'), avg: el.querySelector('[data-k=avg]'), rows }
}

function renderView (refs, v) {
  refs.liquid.textContent = v.liquid.toLocaleString()
  refs.avg.textContent = v.avgBid.toFixed(2)
  let max = 1
  for (let i = 0; i < LEVELS; i++) { const p = AXIS_HI - i; if ((v.bids[p] || 0) > max) max = v.bids[p]; if ((v.asks[p] || 0) > max) max = v.asks[p] }
  for (let i = 0; i < LEVELS; i++) {
    const p = AXIS_HI - i, r = refs.rows[i]
    r.price.textContent = p
    r.bid.style.width = ((v.bids[p] || 0) / max * 100) + '%'
    r.ask.style.width = ((v.asks[p] || 0) / max * 100) + '%'
  }
}

function makeMeter (canvas, bigEl) {
  const samples = [], CAP = 90, ctx = canvas.getContext('2d')
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const resize = () => { canvas.width = canvas.clientWidth * dpr; canvas.height = canvas.clientHeight * dpr }
  resize(); window.addEventListener('resize', resize)
  function push (ms) {
    samples.push(ms); if (samples.length > CAP) samples.shift()
    const s = samples.slice().sort((a, b) => a - b), p50 = s[Math.floor((s.length - 1) * 0.5)]
    bigEl.textContent = p50 >= 10 ? p50.toFixed(1) : p50.toFixed(2)
    bigEl.classList.toggle('over', p50 > 16)
    draw()
  }
  function draw () {
    const w = canvas.width, h = canvas.height; ctx.clearRect(0, 0, w, h)
    const top = Math.max(20.8, ...samples), y16 = h - (16 / top) * h
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.setLineDash([4 * dpr, 4 * dpr]); ctx.lineWidth = dpr
    ctx.beginPath(); ctx.moveTo(0, y16); ctx.lineTo(w, y16); ctx.stroke(); ctx.setLineDash([])
    const accent = getComputedStyle(canvas).getPropertyValue('--rc-line').trim() || '#ff5e3a'
    const step = w / (CAP - 1)
    ctx.beginPath()
    for (let i = 0; i < samples.length; i++) { const x = i * step, y = h - (samples[i] / top) * h; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y) }
    if (samples.length) { ctx.lineTo((samples.length - 1) * step, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fillStyle = accent + '22'; ctx.fill() }
    ctx.strokeStyle = accent; ctx.lineWidth = 1.8 * dpr; ctx.lineJoin = 'round'; ctx.beginPath()
    for (let i = 0; i < samples.length; i++) { const x = i * step, y = h - (samples[i] / top) * h; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y) }
    ctx.stroke()
  }
  return { push }
}

/* ---------- driver ---------- */
export async function createRace ({ grid, multidimHost, workloadSel, peerSel, rateInput, rateOut, toggleBtn, statusEl }) {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  for (const [k, { label }] of Object.entries(PEERS)) { const o = document.createElement('option'); o.value = k; o.textContent = label; peerSel.appendChild(o) }
  peerSel.value = 'mobx'

  let dataEng, peer, dataRefs, peerRefs, dataMeter, peerMeter, nextTick
  let running = false, raf = 0, lastT = 0, frac = 0

  const rate = () => Math.round(Math.pow(10, +rateInput.value))
  const fmtRate = r => r >= 1e3 ? (r / 1e3).toFixed(1) + 'k' : '' + r
  const showRate = () => { if (rateOut) rateOut.textContent = fmtRate(rate()) + ' ticks/sec' }
  showRate(); rateInput.addEventListener('input', showRate)

  async function mount (peerName) {
    stop()
    if (statusEl) statusEl.textContent = `loading ${PEERS[peerName].label}…`
    let prims
    try { prims = await loadPeer(peerName) } catch (e) { console.error(`[${peerName}] load failed`, e); if (statusEl) statusEl.textContent = `failed to load ${PEERS[peerName].label}`; return }
    // fresh workload + both engines from the SAME initial book → exact lockstep
    const wl = makeWorkload(7)
    const init = wl.initial()
    nextTick = wl.nextTick
    dataEng = makeDataEngine(init)
    peer = makeSignalEngine(prims, init)
    grid.innerHTML = ''
    dataRefs = buildPanel('data', 'data', 'length(bucket) ×2 · filter→length · avg — O(Δ)/tick')
    peerRefs = buildPanel('peer', PEERS[peerName].label, PEERS[peerName].sub)
    grid.append(dataRefs.el, peerRefs.el)
    dataMeter = makeMeter(dataRefs.meter, dataRefs.cost)
    peerMeter = makeMeter(peerRefs.meter, peerRefs.cost)
    // settle once so panels aren't empty
    dataEng.read(); peer.read(); renderView(dataRefs, dataEng.view()); renderView(peerRefs, peer.view())
    if (statusEl) statusEl.textContent = ''
    if (workloadSel.value === 'orderbook') { if (reduceMotion) settleOnce(); else start() }
  }

  function settleOnce () {
    for (let i = 0; i < 400; i++) { const t = nextTick(); dataEng.ingest(t); peer.ingest(t) }
    let s = performance.now(); dataEng.read(); dataMeter.push(performance.now() - s); renderView(dataRefs, dataEng.view())
    s = performance.now(); peer.read(); peerMeter.push(performance.now() - s); renderView(peerRefs, peer.view())
  }

  function frame (now) {
    if (!running || !nextTick) return
    const dt = now - lastT; lastT = now
    const owed = rate() * Math.max(0, dt) / 1000 + frac
    const k = Math.min(8000, Math.max(0, Math.floor(owed))); frac = owed - k
    const batch = new Array(k); for (let i = 0; i < k; i++) batch[i] = nextTick()
    let s = performance.now(); for (let i = 0; i < k; i++) dataEng.ingest(batch[i]); dataEng.read(); dataMeter.push(performance.now() - s); renderView(dataRefs, dataEng.view())
    s = performance.now(); for (let i = 0; i < k; i++) peer.ingest(batch[i]); peer.read(); peerMeter.push(performance.now() - s); renderView(peerRefs, peer.view())
    raf = requestAnimationFrame(frame)
  }
  function start () { if (!running && nextTick && workloadSel.value === 'orderbook' && !reduceMotion) { running = true; lastT = performance.now(); raf = requestAnimationFrame(frame) } }
  function stop () { running = false; if (raf) cancelAnimationFrame(raf) }

  peerSel.addEventListener('change', () => mount(peerSel.value))
  toggleBtn.addEventListener('click', () => { if (running) { stop(); toggleBtn.textContent = '▶ resume' } else { start(); toggleBtn.textContent = '⏸ pause' } })

  let mdLoaded = false
  workloadSel.addEventListener('change', () => {
    if (workloadSel.value === 'multidim') {
      stop(); grid.hidden = true; multidimHost.hidden = false
      peerSel.disabled = rateInput.disabled = toggleBtn.disabled = true
      if (!mdLoaded) {
        mdLoaded = true
        multidimHost.innerHTML = '<div class="md-note">loading the full 231,083-row comparison — ~36&nbsp;MB, all nine libraries…</div>'
        const f = document.createElement('iframe'); f.className = 'md-frame'; f.loading = 'lazy'; f.src = './examples/multidim/'
        f.title = 'multidim — brushable charts over 231k flight records across nine libraries'
        f.addEventListener('load', () => { const n = multidimHost.querySelector('.md-note'); if (n) n.remove() })
        multidimHost.appendChild(f)
      }
    } else {
      multidimHost.hidden = true; grid.hidden = false
      peerSel.disabled = rateInput.disabled = toggleBtn.disabled = false
      start()
    }
  })

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(es => { if (es[0].isIntersecting && workloadSel.value === 'orderbook') start(); else stop() }, { threshold: 0.05 }).observe(grid)
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start() })

  await mount('mobx')
}
