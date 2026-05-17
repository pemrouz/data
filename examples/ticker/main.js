// Streaming-tick comparisons, side by side. One row per library; each
// receives identical batches from a shared synthetic generator and
// maintains three derived views (top movers, sector volumes, throughput)
// using its own reactive primitives. Per-row latency tracker records
// batch → next paint, displays rolling p50 / p95.

import { makeTicker } from './gen.js'
import { makeLatencyTracker } from './latency.js'

const WINDOW_N = 500_000  // rolling-window size for sector volume aggregate

const LIBS = [
  { src: './lib-data.js' },
  { src: './lib-crossfilter.js' },
  { src: './lib-mobx.js' },
  { src: './lib-rxjs.js' },
  { src: './lib-react.js' },
  { src: './lib-solid.js' },
  { src: './lib-preact.js' },
  { src: './lib-vue.js' },
  { src: './lib-svelte.js' },
]

const grid = document.querySelector('#rows')
const $rate = document.querySelector('#rate')
const $rateOut = document.querySelector('#rate-out')
const $symbolsOut = document.querySelector('#symbols-out')
const $windowOut = document.querySelector('#window-out')
const $toggle = document.querySelector('#toggle')

// Rate slider is log-scaled — slider value is log10(ticks/s), so the
// 2..5 range maps to 100..100,000 ticks/s. Most of the interesting perf
// gap appears between 1k and 50k.
function rateFromSlider() { return Math.round(Math.pow(10, +$rate.value)) }

const ticker = makeTicker({ batchIntervalMs: 60 })
ticker.setRate(rateFromSlider())

$rateOut.textContent = fmtRate(rateFromSlider())
$symbolsOut.textContent = String(ticker.universe.length)
$windowOut.textContent = WINDOW_N.toLocaleString()
document.querySelector('[data-stat=window]').textContent = WINDOW_N.toLocaleString()

$rate.addEventListener('input', () => {
  const r = rateFromSlider()
  ticker.setRate(r)
  $rateOut.textContent = fmtRate(r)
})

$toggle.addEventListener('click', () => {
  if (ticker.isRunning()) {
    ticker.stop()
    $toggle.textContent = 'resume'
    $toggle.dataset.paused = 'true'
  } else {
    ticker.start()
    $toggle.textContent = 'pause'
    $toggle.dataset.paused = 'false'
  }
})

// Mount every library row.
const handles = []
for (const { src } of LIBS) {
  let mod
  try {
    mod = await import(src)
  } catch (e) {
    console.error(`[${src}] import failed`, e)
    continue
  }
  const lib = mod.default
  const row = mountRow(lib)
  const tracker = makeLatencyTracker(row)
  try {
    const handle = lib.mount(row, tracker, {
      sectorOrder: ticker.sectors,
      symbolCount: ticker.universe.length,
      windowSize: WINDOW_N,
    })
    handles.push({ lib, row, tracker, handle, tps: 0, ticks: 0 })
  } catch (e) {
    console.error(`[${lib.name}] mount failed`, e)
    row.querySelector('.tk-tag').textContent = `failed to mount: ${e?.message ?? e}`
    row.classList.add('tk-failed')
  }
}

// Wire generator → every row's ingest. We send the same batch reference
// to each lib; libs MUST NOT mutate it. (data's $() reads the array but
// doesn't keep the reference; others either iterate or shallow-copy.)
//
// We time each lib.ingest call individually and hand the duration to the
// row's tracker. Compute time is ordering-independent — measuring the
// rAF-paint latency instead would charge the lib that runs first in this
// loop for everyone else's work (they'd all paint in the same rAF) and
// reduce later libs' samples to pure vsync wait. See latency.js.
let lastTpsT = performance.now()
ticker.onBatch((batch) => {
  for (const h of handles) {
    const t0 = performance.now()
    try { h.handle.ingest(batch) } catch (e) { console.error(`[${h.lib.name}] ingest failed`, e); h.row.classList.add('tk-failed') }
    h.tracker.sample(performance.now() - t0)
    h.ticks += batch.length
  }
})

// Throughput tape: each lib reports the actual count of ticks it processed
// per second, smoothed over ~500ms windows.
setInterval(() => {
  const now = performance.now()
  const dt = (now - lastTpsT) / 1000
  if (dt <= 0) return
  for (const h of handles) {
    const tps = h.ticks / dt
    h.ticks = 0
    const el = h.row.querySelector('[data-stat=tps] b')
    if (el) el.textContent = fmtTps(tps)
  }
  lastTpsT = now
}, 500)

// Pre-fill each lib's rolling window with the same synthetic stream.
// Without this peers walk a partially-empty window for the first ~100s
// at default rate (window fills organically), hiding the perf gap that's
// the whole point of this page. Both libs ingest the prefill untimed
// (the tracker only samples post-prefill batches), so the comparison
// starts at steady-state.
//
// Chunked + yielded so the page stays responsive — at 25k/chunk the
// slowest lib spends ~250ms per chunk, and the rAF between chunks
// repaints the progress label. ~5–10 s total wall-clock on a fresh load.
const PREFILL_TICKS = WINDOW_N
const PREFILL_CHUNK = 25_000

$toggle.textContent = 'filling window…'
$toggle.disabled = true
const prefill = ticker.synthesize(PREFILL_TICKS)
for (let i = 0; i < prefill.length; i += PREFILL_CHUNK) {
  const chunk = prefill.slice(i, Math.min(i + PREFILL_CHUNK, prefill.length))
  for (const h of handles) {
    try { h.handle.ingest(chunk) }
    catch (e) { console.error(`[${h.lib.name}] prefill failed`, e); h.row.classList.add('tk-failed') }
  }
  const done = Math.min(i + PREFILL_CHUNK, prefill.length)
  $toggle.textContent = `filling window… ${(done / PREFILL_TICKS * 100).toFixed(0)}%`
  await new Promise(r => setTimeout(r, 0))
}
$toggle.textContent = 'pause'
$toggle.disabled = false
$toggle.dataset.paused = 'false'

// Reset tps accounting now that prefill is done — h.ticks accumulates
// only from onBatch and prefill doesn't go through it, but lastTpsT is
// the timer baseline for tps and needs to match "live stream start".
lastTpsT = performance.now()

ticker.start()

function mountRow(lib) {
  const row = document.createElement('section')
  row.className = 'tk-row'
  row.dataset.lib = lib.name
  row.innerHTML = `
    <div class="tk-meta">
      <div class="tk-name">${escape(lib.name)} <span class="tk-version">${escape(lib.version)}</span></div>
      <div class="tk-tag">${escape(lib.tag || '')}</div>
    </div>
    <div class="tk-movers">
      <div class="tk-movers-h">top 3 / bottom 3</div>
      <ol class="tk-top-list" data-target="top"></ol>
      <div class="tk-movers-divider"></div>
      <ol class="tk-top-list" data-target="bottom"></ol>
    </div>
    <div class="tk-sectors" data-target="sectors">
      <div class="tk-sectors-h">sector volume (rolling window)</div>
    </div>
    <div class="tk-hist" data-target="hist">
      <div class="tk-hist-h">% change distribution</div>
      <div class="tk-hist-bars"></div>
      <div class="tk-hist-axis"><span>-5%</span><span>0</span><span>+5%</span></div>
    </div>
    <div class="tk-scalars" data-target="scalars">
      <div class="tk-st-row"><span class="tk-st-k">tot vol</span><span class="tk-st-v"><b data-scalar="totvol">—</b></span></div>
      <div class="tk-st-row"><span class="tk-st-k">avg %chg</span><span class="tk-st-v"><b data-scalar="avgpct">—</b><span class="tk-st-u">%</span></span></div>
    </div>
    <div class="tk-stats">
      <div class="tk-st-row"><span class="tk-st-k">tps</span><span class="tk-st-v" data-stat="tps"><b>—</b></span></div>
      <div class="tk-st-divider"></div>
      <div class="tk-st-row"><span class="tk-st-k" title="ingest p50">cpu p50</span><span class="tk-st-v"><b data-stat="p50">—</b><span class="tk-st-u">ms</span></span></div>
      <div class="tk-st-row"><span class="tk-st-k" title="ingest p95">cpu p95</span><span class="tk-st-v"><b data-stat="p95">—</b><span class="tk-st-u">ms</span></span></div>
    </div>
  `
  grid.appendChild(row)
  return row
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]))
}

function fmtRate(r) {
  if (r >= 1e6) return (r / 1e6).toFixed(1) + 'M'
  if (r >= 1e3) return (r / 1e3).toFixed(1) + 'k'
  return String(r)
}

function fmtTps(v) {
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k'
  return String(v | 0)
}
