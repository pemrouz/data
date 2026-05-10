// Multi-dimensional filtering, side by side. Loads the flights dataset once,
// then mounts a row per library — each does the same brushable 4-chart
// crossfilter view using its own reactive primitives. Per-row latency tracker
// records pointermove → next paint, displays rolling p50 / p95.

import { makeLatencyTracker } from './latency.js'

const { min, max, floor } = Math

// Library modules in the order they should appear on the page. Each is added
// in its own commit; this list grows as we add peer rows.
const LIBS = [
  { src: './lib-data.js' },
  { src: './lib-crossfilter.js' },
  { src: './lib-mobx.js' },
  { src: './lib-rxjs.js' },
  { src: './lib-react.js' },
  { src: './lib-solid.js' },
  { src: './lib-preact.js' },
]

const grid = document.querySelector('#rows')
const loader = document.querySelector('#loader')

const flights = await loadFlights()

for (const { src } of LIBS) {
  const mod = await import(src)
  const lib = mod.default
  const row = mountRow(lib)
  const tracker = makeLatencyTracker(row)
  try {
    lib.mount(row.querySelector('.mdf-charts'), flights, tracker, {
      activeEl: row.querySelector('[data-stat=active]'),
      totalEl:  row.querySelector('[data-stat=total]'),
    })
  } catch (e) {
    console.error(`[${lib.name}] mount failed`, e)
    row.querySelector('.mdf-tag').textContent = `failed to mount: ${e?.message ?? e}`
    row.classList.add('mdf-failed')
  }
}

dismissLoader()

function mountRow(lib) {
  const row = document.createElement('section')
  row.className = 'mdf-row'
  row.dataset.lib = lib.name
  row.innerHTML = `
    <div class="mdf-meta">
      <div class="mdf-name">${escape(lib.name)} <span class="mdf-version">${escape(lib.version)}</span></div>
      <div class="mdf-tag">${escape(lib.tag || '')}</div>
    </div>
    <div class="mdf-charts"></div>
    <div class="mdf-stats">
      <div class="mdf-count">
        <span data-stat="active">—</span><span class="mdf-dim"> / </span><span data-stat="total">—</span>
      </div>
      <div class="mdf-latency">
        <span class="mdf-lat-row"><span class="mdf-lat-k">p50</span><span class="mdf-lat-v"><b data-stat="p50">—</b><span class="mdf-lat-u">ms</span></span></span>
        <span class="mdf-lat-row"><span class="mdf-lat-k">p95</span><span class="mdf-lat-v"><b data-stat="p95">—</b><span class="mdf-lat-u">ms</span></span></span>
        <span class="mdf-lat-row"><span class="mdf-lat-k">n</span><span class="mdf-lat-v"><b data-stat="count">0</b></span></span>
      </div>
    </div>
  `
  grid.appendChild(row)
  return row
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]))
}

// Stream-fetch the dataset with live progress; identical loader UX to the
// crossfilter example. The script is large (~36 MB) and parsing it is slow,
// so we yield to the event loop after streaming completes so the bar paints.
async function loadFlights() {
  const $bar   = loader.querySelector('.loader-bar-fill')
  const $pct   = loader.querySelector('.loader-pct')
  const $bytes = loader.querySelector('.loader-bytes')
  const $rate  = loader.querySelector('.loader-rate')
  const $stat  = loader.querySelector('.loader-status')
  const fmtMB  = b => (b / 1048576).toFixed(1)

  const t0 = performance.now()
  const res = await fetch('../crossfilter/flights.js')
  const total = +res.headers.get('Content-Length') || 37313858

  if (!res.body || !res.body.getReader) {
    const text = await res.text()
    return parse(text)
  }

  const reader = res.body.getReader()
  const chunks = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.byteLength
    const pct = received / total
    const elapsed = (performance.now() - t0) / 1000
    $bar.style.width = `${(pct * 100).toFixed(1)}%`
    $pct.textContent = `${(pct * 100) | 0}%`
    $bytes.textContent = `${fmtMB(received)} / ${fmtMB(total)} MB`
    $rate.textContent = elapsed > 0.05 ? `${fmtMB(received / elapsed)} MB/s` : '…'
  }
  $bar.style.width = '100%'
  $pct.textContent = '100%'
  $stat.textContent = 'parsing'
  await new Promise(r => requestAnimationFrame(r))

  const url = URL.createObjectURL(new Blob(chunks, { type: 'application/javascript' }))
  const { data } = await import(url)
  URL.revokeObjectURL(url)

  $stat.textContent = 'projecting flights'
  await new Promise(r => requestAnimationFrame(r))
  return parse(data)
}

// Shared parse — every library row receives the same array of plain objects.
// The fields match the existing crossfilter example: date (Date), time (hours),
// delay (clamped), distance (clamped), origin, destination.
//
// flights.js exports `data` as an OBJECT keyed by index, not an array — the
// existing crossfilter example wraps that directly in `$()`. We materialise
// to a dense array here so peer libraries (which mostly want a real array)
// don't have to handle the keyed-object shape.
function parse(rows) {
  const flights = []
  for (const k in rows) {
    const d = rows[k]
    if (!d) continue
    const date = parseDate(d.date)
    const time = date.getHours() + date.getMinutes() / 60
    const delay = max(-60, min(149, d.delay))
    const distance = min(1999, d.distance)
    flights.push({ date, time, delay, distance, origin: d.origin, destination: d.destination })
  }
  return flights
}

function parseDate(d) {
  return new Date(2001,
    d.substring(0, 2) - 1,
    d.substring(2, 4),
    d.substring(4, 6),
    d.substring(6, 8))
}

function dismissLoader() {
  if (!loader) return
  loader.classList.add('done')
  setTimeout(() => loader.remove(), 360)
}
