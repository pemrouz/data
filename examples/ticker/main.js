// Streaming-tick comparisons, side by side. One row per library; each
// receives identical batches from a shared synthetic generator and
// maintains three derived views (top movers, sector volumes, throughput)
// using its own reactive primitives. Per-row latency tracker records
// batch → next paint, displays rolling p50 / p95.

import { makeTicker } from './gen.js'
import { makeLatencyTracker } from './latency.js'

const WINDOW_N = 50_000  // rolling-window size for sector volume aggregate

const LIBS = [
  { src: './lib-data.js' },
  { src: './lib-crossfilter.js' },
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
let lastTpsT = performance.now()
ticker.onBatch((batch) => {
  for (const h of handles) {
    h.tracker.markIngest()
    try { h.handle.ingest(batch) } catch (e) { console.error(`[${h.lib.name}] ingest failed`, e); h.row.classList.add('tk-failed') }
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
    <div class="tk-top">
      <div class="tk-top-h">top movers</div>
      <ol class="tk-top-list" data-target="top"></ol>
    </div>
    <div class="tk-sectors" data-target="sectors">
      <div class="tk-sectors-h">sector volume (rolling window)</div>
    </div>
    <div class="tk-stats">
      <div class="tk-st-row"><span class="tk-st-k">tps</span><span class="tk-st-v" data-stat="tps"><b>—</b></span></div>
      <div class="tk-st-divider"></div>
      <div class="tk-st-row"><span class="tk-st-k">p50</span><span class="tk-st-v"><b data-stat="p50">—</b><span class="tk-st-u">ms</span></span></div>
      <div class="tk-st-row"><span class="tk-st-k">p95</span><span class="tk-st-v"><b data-stat="p95">—</b><span class="tk-st-u">ms</span></span></div>
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
