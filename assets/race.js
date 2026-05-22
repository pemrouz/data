/* The live race — a single-card carousel over nine reactive engines, fed one
 * realistic order-book tick stream and rendered through the SAME order-book
 * viz (depth chart + ladder, see race-views.js). You flip through the engines
 * one at a time; the cpu-per-frame wave plots the selected engine against an
 * always-running data baseline so the gap is visible on one card.
 *
 * The honest bit — every engine settles ONCE PER FRAME (the real render
 * cadence), not once per tick:
 *   • data — incremental operators (length(bucket)×2, filter→length, avg).
 *     ingest is O(1) per tick; settle is a no-op read of already-maintained
 *     results. Runs as the baseline on every frame (it's basically free).
 *   • the eight peers — a version signal + four derivations that re-walk all
 *     N rows. We mutate plain state per tick (cheap) and fire the recompute
 *     exactly once per frame, so each peer pays one O(N) walk per frame. A
 *     per-tick recompute would be O(N)·rate and would lock the single main
 *     thread — neither honest about the render cadence nor survivable at
 *     N=150k. The book is bounded, so there's no rate at which the walk
 *     gets cheap; data's per-tick cost is the path it travels.
 *
 * On switching engines we drop the rate to a per-engine safe default so the
 * heavy ones (react/rxjs/svelte/crossfilter) don't stall on the first frames,
 * then let you push the slider back up.
 *
 * Hand-written `.js`, no `.ts` sibling (see CLAUDE.md). */

import { $, value } from 'data/full'
import { PRICE_BINS, priceBucket, setupOrderbook, renderOrderbook, makeWave, fmtRatio } from './race-views.js'

const N = 150000
const THRESHOLD = 24
const MID_TARGET = 75

// Carousel order: data first, then peers roughly fastest → heaviest. defRate
// is the log10 slider value to snap to on load (lower for the O(N)/frame
// libraries so the first frames don't stall).
const LIBS = [
  { id: 'data',        label: 'data',           ver: '0.x',    tag: 'length(bucket)×2 · filter→length · avg — O(1)/tick', defRate: 3.3 },
  { id: 'mobx',        label: 'MobX',           ver: '6.15.3', tag: 'observable.box + 4 computed · O(N)/frame',         defRate: 2.8 },
  { id: 'solid',       label: 'Solid',          ver: '1.9.12', tag: 'createSignal + 4 createMemo · O(N)/frame',         defRate: 2.8 },
  { id: 'preact',      label: 'Preact signals', ver: '1.14.1', tag: 'signal + 4 computed · O(N)/frame',                 defRate: 2.8 },
  { id: 'vue',         label: 'Vue reactivity', ver: '3.5.34', tag: 'shallowRef + 4 computed · O(N)/frame',             defRate: 2.8 },
  { id: 'crossfilter', label: 'crossfilter',    ver: '1.5.4',  tag: 'dimensions × groups · cf.remove() rebuilds O(N)/tick',  defRate: 1.8 },
  { id: 'svelte',      label: 'Svelte store',   ver: '5.55.5', tag: 'writable + 4 derived · O(N)/frame',                defRate: 2.3 },
  { id: 'rxjs',        label: 'RxJS',           ver: '7.8.2',  tag: 'Subject + 4 map() · O(N)/emit',                    defRate: 2.3 },
  { id: 'react',       label: 'React',          ver: '19.2.6', tag: 'useState + 4 useMemo + flushSync · O(N)/commit',   defRate: 2.2 },
]

/* ---------- workload: a drifting order book (three incommensurate sines) ---------- */
function lcg (seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x1_0000_0000 } }
const biasedHalfSpread = (r1, r2, scale) => 4 + Math.min(r1, r2) * scale // mode near the mid; floor keeps bid/ask out of bucket 7

function makeWorkload (seed = 7) {
  const r = lcg(seed), t0 = performance.now()
  const regime = () => {
    const t = (performance.now() - t0) / 1000
    return {
      mid: MID_TARGET + Math.sin(2 * Math.PI * t / 22) * 2,
      spread: 6 + (Math.sin(2 * Math.PI * t / 17) + 1) / 2 * 12,
      imbalance: Math.sin(2 * Math.PI * t / 13) * 0.25,
    }
  }
  const initial = () => {
    const reg = regime(), out = {}
    for (let i = 0; i < N; i++) { const hs = biasedHalfSpread(r(), r(), reg.spread); out[i] = { id: i, bid: reg.mid - hs, ask: reg.mid + hs } }
    return out
  }
  const nextTick = () => {
    const reg = regime(), idx = (r() * N) | 0
    const field = r() < (0.5 + reg.imbalance) ? 'ask' : 'bid'
    const hs = biasedHalfSpread(r(), r(), reg.spread)
    return { idx, field, newValue: field === 'bid' ? reg.mid - hs : reg.mid + hs }
  }
  return { initial, nextTick }
}

/* ---------- data engine (incremental, O(1)/tick) ---------- */
function makeDataEngine (initial) {
  const trades = $(structuredClone(initial))
  const liquid = trades.filter(t => t.ask - t.bid > THRESHOLD).length()
  const avgBid = trades.avg('bid')
  const bids = trades.length(t => priceBucket(t.bid))
  const asks = trades.length(t => priceBucket(t.ask))
  const flat = o => { const a = new Array(PRICE_BINS).fill(0); for (const k in o) { const b = o[k]; if (b) a[k] = b.value } return a }
  return {
    ingest (t) { const cur = trades[t.idx][value]; trades[t.idx] = { ...cur, [t.field]: t.newValue } },
    settle () { void liquid[value]; void avgBid[value]; void bids[value]; void asks[value] },
    view () { return { bids: flat(bids[value] || {}), asks: flat(asks[value] || {}), liquid: liquid[value] || 0, avg: avgBid[value] || 0 } },
  }
}

/* ---------- generic fine-grained signal engine (mobx / solid / preact / vue) ---------- */
// `prims` = { signal(v)->{get,set}, computed(fn)->read(), bump(fn) }. ingest
// only mutates plain state; settle bumps the version once and FORCE-reads all
// four derivations so the O(N) recompute lands inside the timed settle (lazy
// libs defer to the read; eager ones do it on the bump — captured either way).
function makeSignalEngine (prims, initial) {
  const trades = structuredClone(initial)
  const ver = prims.signal(0)
  const mk = fn => prims.computed(() => { ver.get(); return fn() })
  const liquid = mk(() => { let n = 0; for (let i = 0; i < N; i++) { const t = trades[i]; if (t.ask - t.bid > THRESHOLD) n++ } return n })
  const avg = mk(() => { let s = 0; for (let i = 0; i < N; i++) s += trades[i].bid; return s / N })
  const bids = mk(() => { const o = new Array(PRICE_BINS).fill(0); for (let i = 0; i < N; i++) o[priceBucket(trades[i].bid)]++; return o })
  const asks = mk(() => { const o = new Array(PRICE_BINS).fill(0); for (let i = 0; i < N; i++) o[priceBucket(trades[i].ask)]++; return o })
  const readers = [liquid, avg, bids, asks]
  return {
    ingest (t) { trades[t.idx] = { ...trades[t.idx], [t.field]: t.newValue } },
    settle () { prims.bump(() => ver.set(ver.get() + 1)); for (const rd of readers) rd() },
    view () { return { bids: bids(), asks: asks(), liquid: liquid(), avg: avg() } },
  }
}

async function loadPrims (name) {
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
  const { createSignal, createMemo, createRoot, batch } = await import('solid-js') // solid memos need a root owner
  let prims
  createRoot(() => { prims = { signal: v => { const [g, s] = createSignal(v); return { get: g, set: s } }, computed: fn => createMemo(fn), bump: batch } })
  return prims
}

/* ---------- rxjs engine (Subject + 4 map, fired once/frame) ---------- */
async function makeRxEngine (initial) {
  const { Subject } = await import('rxjs')
  const { map } = await import('rxjs/operators')
  const trades = structuredClone(initial)
  const tick$ = new Subject()
  let L = 0, A = 0, B = new Array(PRICE_BINS).fill(0), K = new Array(PRICE_BINS).fill(0)
  const subs = []
  subs.push(tick$.pipe(map(() => { let n = 0; for (let i = 0; i < N; i++) { const t = trades[i]; if (t.ask - t.bid > THRESHOLD) n++ } return n })).subscribe(v => { L = v }))
  subs.push(tick$.pipe(map(() => { let s = 0; for (let i = 0; i < N; i++) s += trades[i].bid; return s / N })).subscribe(v => { A = v }))
  subs.push(tick$.pipe(map(() => { const o = new Array(PRICE_BINS).fill(0); for (let i = 0; i < N; i++) o[priceBucket(trades[i].bid)]++; return o })).subscribe(v => { B = v }))
  subs.push(tick$.pipe(map(() => { const o = new Array(PRICE_BINS).fill(0); for (let i = 0; i < N; i++) o[priceBucket(trades[i].ask)]++; return o })).subscribe(v => { K = v }))
  return { _subs: subs, ingest (t) { trades[t.idx] = { ...trades[t.idx], [t.field]: t.newValue } }, settle () { tick$.next() }, view () { return { bids: B, asks: K, liquid: L, avg: A } } }
}

/* ---------- svelte/store engine (writable + 4 derived, fired once/frame) ---------- */
async function makeSvelteEngine (initial) {
  const { writable, derived } = await import('svelte/store')
  const trades = structuredClone(initial)
  const ver = writable(0)
  let L = 0, A = 0, B = new Array(PRICE_BINS).fill(0), K = new Array(PRICE_BINS).fill(0)
  const u = []
  u.push(derived(ver, () => { let n = 0; for (let i = 0; i < N; i++) { const t = trades[i]; if (t.ask - t.bid > THRESHOLD) n++ } return n }).subscribe(v => { L = v }))
  u.push(derived(ver, () => { let s = 0; for (let i = 0; i < N; i++) s += trades[i].bid; return s / N }).subscribe(v => { A = v }))
  u.push(derived(ver, () => { const o = new Array(PRICE_BINS).fill(0); for (let i = 0; i < N; i++) o[priceBucket(trades[i].bid)]++; return o }).subscribe(v => { B = v }))
  u.push(derived(ver, () => { const o = new Array(PRICE_BINS).fill(0); for (let i = 0; i < N; i++) o[priceBucket(trades[i].ask)]++; return o }).subscribe(v => { K = v }))
  return { _subs: u, ingest (t) { trades[t.idx] = { ...trades[t.idx], [t.field]: t.newValue } }, settle () { ver.update(v => v + 1) }, view () { return { bids: B, asks: K, liquid: L, avg: A } } }
}

/* ---------- react engine (headless root, 4 useMemo, flushSync once/frame) ---------- */
async function makeReactEngine (initial) {
  const React = (await import('react')).default
  const { createRoot } = await import('react-dom/client')
  const { flushSync } = await import('react-dom')
  const { useState, useRef, useMemo, useImperativeHandle, forwardRef } = React
  const App = forwardRef((_props, ref) => {
    const [, setV] = useState(0)
    const tr = useRef(null); if (tr.current == null) tr.current = structuredClone(initial)
    const liquid = useMemo(() => { let n = 0; const t = tr.current; for (let i = 0; i < N; i++) if (t[i].ask - t[i].bid > THRESHOLD) n++; return n })
    const avg = useMemo(() => { let s = 0; const t = tr.current; for (let i = 0; i < N; i++) s += t[i].bid; return s / N })
    const bids = useMemo(() => { const o = new Array(PRICE_BINS).fill(0); const t = tr.current; for (let i = 0; i < N; i++) o[priceBucket(t[i].bid)]++; return o })
    const asks = useMemo(() => { const o = new Array(PRICE_BINS).fill(0); const t = tr.current; for (let i = 0; i < N; i++) o[priceBucket(t[i].ask)]++; return o })
    useImperativeHandle(ref, () => ({
      ingest (tk) { const c = tr.current[tk.idx]; tr.current[tk.idx] = { ...c, [tk.field]: tk.newValue } },
      bump () { flushSync(() => setV(v => v + 1)) },
      view: () => ({ bids, asks, liquid, avg }),
    }), [bids, asks, liquid, avg])
    return null
  })
  const host = document.createElement('div')
  const root = createRoot(host)
  const ref = React.createRef()
  flushSync(() => root.render(React.createElement(App, { ref })))
  return { _root: root, ingest (t) { ref.current.ingest(t) }, settle () { ref.current.bump() }, view () { return ref.current.view() } }
}

/* ---------- crossfilter engine (dimensions/groups, incremental on add/remove) ---------- */
async function makeCrossfilterEngine (initial) {
  const crossfilter = (await import('crossfilter2')).default
  const trades = structuredClone(initial)
  const cf = crossfilter([])
  const rows = []; for (let i = 0; i < N; i++) rows.push(trades[i]); cf.add(rows)
  const idDim = cf.dimension(d => d.id)
  const bidDim = cf.dimension(d => priceBucket(d.bid)), askDim = cf.dimension(d => priceBucket(d.ask))
  const liqDim = cf.dimension(d => (d.ask - d.bid) > THRESHOLD ? 1 : 0)
  const bidG = bidDim.group().reduceCount(), askG = askDim.group().reduceCount(), liqG = liqDim.group().reduceCount()
  const avgAcc = cf.groupAll().reduce((a, d) => { a.sum += d.bid; a.n++; return a }, (a, d) => { a.sum -= d.bid; a.n--; return a }, () => ({ sum: 0, n: 0 }))
  return {
    ingest (t) { const nr = { ...trades[t.idx], [t.field]: t.newValue }; trades[t.idx] = nr; idDim.filter(t.idx); cf.remove(); idDim.filterAll(); cf.add([nr]) },
    settle () { /* groups update incrementally on remove+add */ },
    view () {
      const b = new Array(PRICE_BINS).fill(0); for (const { key, value: v } of bidG.all()) b[key] = v
      const a = new Array(PRICE_BINS).fill(0); for (const { key, value: v } of askG.all()) a[key] = v
      let L = 0; for (const { key, value: v } of liqG.all()) if (key === 1) L = v
      const av = avgAcc.value()
      return { bids: b, asks: a, liquid: L, avg: av.n ? av.sum / av.n : 0 }
    },
  }
}

async function loadEngine (id, initial) {
  if (id === 'data') return makeDataEngine(initial)
  if (id === 'rxjs') return makeRxEngine(initial)
  if (id === 'svelte') return makeSvelteEngine(initial)
  if (id === 'react') return makeReactEngine(initial)
  if (id === 'crossfilter') return makeCrossfilterEngine(initial)
  return makeSignalEngine(await loadPrims(id), initial)
}

/* ---------- the card ---------- */
function buildCard (lib) {
  const el = document.createElement('div')
  el.className = 'rcard' + (lib.id === 'data' ? ' is-data' : '')
  el.innerHTML = `
    <div class="rcard-head">
      <span class="rcard-name">${lib.label}<span class="rcard-ver">${lib.ver}</span></span>
      <span class="rcard-tag">${lib.tag}</span>
      <span class="rcard-cpu" data-k="cpu">—</span>
    </div>
    <div class="ob-body" data-target="ob">
      <canvas class="ob-depth" data-target="depth"></canvas>
      <div class="ob-ladder" data-target="ladder"><div class="ob-ladder-h"><span>price</span><span>qty</span><span>cum</span></div></div>
    </div>
    <div class="rcard-wave">
      <div class="pane-h">cpu per frame<span class="pane-h-sub"><b data-k="ratio">—</b> · dashed line = 16ms / 60fps budget</span></div>
      <canvas data-target="wave"></canvas>
    </div>
    <div class="rcard-foot">
      <div class="fstat"><span class="fstat-k">liquid orders</span><b class="fstat-v" data-k="liquid">—</b></div>
      <div class="fstat"><span class="fstat-k">avg bid</span><b class="fstat-v" data-k="avg">—</b></div>
      <div class="fstat"><span class="fstat-k">data baseline</span><b class="fstat-v fstat-base" data-k="base">—</b></div>
      <div class="fstat"><span class="fstat-k">ticks / sec</span><b class="fstat-v" data-k="tps">—</b></div>
    </div>`
  // NB: setupOrderbook / makeWave are called by the caller AFTER `el` is in the
  // DOM — they measure the canvas via getBoundingClientRect, which is 0 while
  // the element is detached (would lock the depth chart at its 120px minimum).
  return {
    el,
    cpu: el.querySelector('[data-k=cpu]'), ratio: el.querySelector('[data-k=ratio]'),
    liquid: el.querySelector('[data-k=liquid]'), avg: el.querySelector('[data-k=avg]'),
    base: el.querySelector('[data-k=base]'), tps: el.querySelector('[data-k=tps]'),
    obEl: el.querySelector('[data-target=ob]'),
    waveCanvas: el.querySelector('[data-target=wave]'),
  }
}

/* ---------- driver ---------- */
export async function createRace ({ grid, multidimHost, workloadSel, libSel, prevBtn, nextBtn, rateInput, rateOut, toggleBtn, statusEl, posEl }) {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  for (const lib of LIBS) { const o = document.createElement('option'); o.value = lib.id; o.textContent = lib.label; libSel.appendChild(o) }

  let idx = 0
  let dataEng, peerEng, refs, wave, nextTick, isDataSelected = false
  let running = false, raf = 0, lastT = 0, frac = 0, tickAcc = 0, tickT0 = 0

  const rate = () => Math.round(Math.pow(10, +rateInput.value))
  const fmtRate = r => r >= 1e3 ? (r / 1e3).toFixed(1) + 'k' : '' + r
  const showRate = () => { if (rateOut) rateOut.textContent = fmtRate(rate()) + ' ticks/sec' }
  showRate(); rateInput.addEventListener('input', showRate)

  function syncCarousel () {
    libSel.value = LIBS[idx].id
    if (posEl) posEl.textContent = `${idx + 1} / ${LIBS.length}`
  }

  async function mount (i) {
    stop()
    idx = (i + LIBS.length) % LIBS.length
    const lib = LIBS[idx]
    isDataSelected = lib.id === 'data'
    syncCarousel()
    rateInput.value = String(lib.defRate); showRate() // safe rate per engine on load
    if (statusEl) statusEl.textContent = `loading ${lib.label}…`

    // fresh workload + engines from the SAME initial book → exact lockstep
    const wl = makeWorkload(7)
    const init = wl.initial()
    nextTick = wl.nextTick
    dataEng = makeDataEngine(init)
    let pe
    try { pe = isDataSelected ? dataEng : await loadEngine(lib.id, init) }
    catch (e) { console.error(`[${lib.id}] load failed`, e); if (statusEl) statusEl.textContent = `failed to load ${lib.label}`; return }
    peerEng = pe

    grid.innerHTML = ''
    refs = buildCard(lib)
    grid.appendChild(refs.el) // append first so the canvases have a measured size
    refs.ob = setupOrderbook(refs.obEl)
    wave = makeWave(refs.waveCanvas, refs.cpu, refs.ratio)

    dataEng.settle(); if (!isDataSelected) peerEng.settle()
    drawCard()
    tickAcc = 0; tickT0 = performance.now()
    if (statusEl) statusEl.textContent = ''
    if (workloadSel.value === 'orderbook') { reduceMotion ? settleOnce() : start() }
  }

  function drawCard () {
    const v = peerEng.view()
    refs.liquid.textContent = (v.liquid || 0).toLocaleString()
    refs.avg.textContent = (v.avg || 0).toFixed(2)
    renderOrderbook(refs.ob, v.bids, v.asks)
  }

  // baseline footer: data's per-frame cost, with the selected-vs-data multiplier
  // in brackets (skipped when data itself is selected — the ratio is 1×)
  const fmtMs = ms => ms < 1 ? (ms * 1000).toFixed(0) + ' µs' : ms.toFixed(2) + ' ms'
  function setBase (dms, ratio) {
    refs.base.textContent = (!isDataSelected && ratio > 0) ? `${fmtMs(dms)} (${fmtRatio(ratio)})` : fmtMs(dms)
  }

  function settleOnce () {
    for (let i = 0; i < 600; i++) { const t = nextTick(); dataEng.ingest(t); if (!isDataSelected) peerEng.ingest(t) }
    let s = performance.now(); dataEng.settle(); const dms = performance.now() - s
    let pms = dms
    if (!isDataSelected) { s = performance.now(); peerEng.settle(); pms = performance.now() - s }
    setBase(dms, wave.push(pms, dms))
    drawCard()
  }

  function frame (now) {
    if (!running || !nextTick) return
    const dt = now - lastT; lastT = now
    const owed = rate() * Math.max(0, dt) / 1000 + frac
    const k = Math.min(8000, Math.max(0, Math.floor(owed))); frac = owed - k
    const batch = new Array(k); for (let i = 0; i < k; i++) batch[i] = nextTick()
    tickAcc += k

    // data baseline (always) — cheap O(Δ)
    let s = performance.now(); for (let i = 0; i < k; i++) dataEng.ingest(batch[i]); dataEng.settle(); const dms = performance.now() - s
    // selected engine
    let pms = dms
    if (!isDataSelected) { s = performance.now(); for (let i = 0; i < k; i++) peerEng.ingest(batch[i]); peerEng.settle(); pms = performance.now() - s }

    setBase(dms, wave.push(pms, dms))
    drawCard()

    if (now - tickT0 >= 500) { refs.tps.textContent = ((tickAcc / (now - tickT0)) * 1000 | 0).toLocaleString(); tickAcc = 0; tickT0 = now }
    raf = requestAnimationFrame(frame)
  }
  function start () { if (!running && nextTick && workloadSel.value === 'orderbook' && !reduceMotion) { running = true; lastT = performance.now(); raf = requestAnimationFrame(frame); if (toggleBtn) toggleBtn.textContent = '⏸ pause' } }
  function stop () { running = false; if (raf) cancelAnimationFrame(raf) }

  libSel.addEventListener('change', () => mount(LIBS.findIndex(l => l.id === libSel.value)))
  prevBtn.addEventListener('click', () => mount(idx - 1))
  nextBtn.addEventListener('click', () => mount(idx + 1))
  toggleBtn.addEventListener('click', () => { if (running) { stop(); toggleBtn.textContent = '▶ resume' } else start() })

  /* ---------- multidim workload: lazy iframe + loading bar ---------- */
  let mdLoaded = false
  workloadSel.addEventListener('change', () => {
    const peerCtrls = [libSel, prevBtn, nextBtn]
    if (workloadSel.value === 'multidim') {
      stop(); grid.hidden = true; multidimHost.hidden = false
      for (const c of peerCtrls) c.disabled = true; rateInput.disabled = toggleBtn.disabled = true
      if (!mdLoaded) {
        mdLoaded = true
        multidimHost.innerHTML = `
          <div class="md-loading" data-k="mdload">
            <div class="md-loading-txt">loading the full 231,083-row comparison — ~36&nbsp;MB across nine libraries…</div>
            <div class="md-bar"><div class="md-bar-fill"></div></div>
          </div>`
        const f = document.createElement('iframe')
        f.className = 'md-frame'; f.loading = 'lazy'; f.src = './examples/multidim/'
        f.title = 'multidim — brushable charts over 231k flight records across nine libraries'
        f.addEventListener('load', () => { const n = multidimHost.querySelector('[data-k=mdload]'); if (n) n.remove() })
        multidimHost.appendChild(f)
      }
    } else {
      multidimHost.hidden = true; grid.hidden = false
      for (const c of peerCtrls) c.disabled = false; rateInput.disabled = toggleBtn.disabled = false
      start()
    }
  })

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(es => { if (es[0].isIntersecting && workloadSel.value === 'orderbook') start(); else stop() }, { threshold: 0.05 }).observe(grid)
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (workloadSel.value === 'orderbook') start() })

  await mount(0)
}
