// Multi-dimensional filtering, side by side. Loads the flights dataset once,
// then mounts a row per library — each does the same brushable 4-chart
// crossfilter view using its own reactive primitives. Per-row latency tracker
// records pointermove → next paint, displays rolling p50 / p95.
//
// `mountMultidim` is the reusable entry point: the standalone page (below) and
// the landing-page second panel both call it. Progress is reported through
// callbacks rather than touching a fixed loader, so the host owns the chrome.

import { makeLatencyTracker } from './latency.js'

const { min, max } = Math

// Library modules in the order they should appear. Each is added in its own
// commit; this list grows as we add peer rows.
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

// Mount one row per library into `rowsEl` — the standalone all-nine page.
// onProgress(pct, receivedMB, totalMB, rateMB) and onStatus(text) report dataset
// streaming/parsing; both optional.
export async function mountMultidim ({ rowsEl, onProgress, onStatus } = {}) {
  const flights = await loadFlights({ onProgress, onStatus })
  for (const { src } of LIBS) {
    await mountLibRow({ rowsEl, src, flights })
    // yield between rows so the page stays responsive while nine reactive
    // graphs over 231k rows come up (matters when embedded inline)
    await new Promise(r => requestAnimationFrame(r))
  }
}

// Mount a SINGLE library's row into `rowsEl`, over an already-loaded `flights`
// array. The landing page uses this to show one engine at a time, driven by the
// shared carousel; `src` resolves relative to this module (e.g. './lib-mobx.js').
export async function mountLibRow ({ rowsEl, src, flights }) {
  const mod = await import(src)
  const lib = mod.default
  const row = mountRow(rowsEl, lib)
  const tracker = makeLatencyTracker(row)
  try {
    lib.mount(row.querySelector('.mdf-charts'), flights, tracker, {
      activeEl:  row.querySelector('[data-stat=active]'),
      totalEl:   row.querySelector('[data-stat=total]'),
      topListEl: row.querySelector('.mdf-top-list'),
    })
  } catch (e) {
    console.error(`[${lib.name}] mount failed`, e)
    row.querySelector('.mdf-tag').textContent = `failed to mount: ${e?.message ?? e}`
    row.classList.add('mdf-failed')
  }
  return row
}

function mountRow (grid, lib) {
  const row = document.createElement('section')
  row.className = 'mdf-row'
  row.dataset.lib = lib.name
  row.innerHTML = `
    <div class="mdf-meta">
      <div class="mdf-name">${escape(lib.name)} <span class="mdf-version">${escape(lib.version)}</span></div>
      <div class="mdf-tag">${escape(lib.tag || '')}</div>
    </div>
    <div class="mdf-charts"></div>
    <div class="mdf-top"><ol class="mdf-top-list"></ol></div>
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

function escape (s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// Stream-fetch the dataset with live progress. The script is large (~36 MB) and
// parsing is slow, so we yield to the event loop after streaming so the host's
// progress bar paints. The dataset lives next to the crossfilter example; we
// resolve it relative to THIS module so the fetch works regardless of which
// page imported us.
export async function loadFlights ({ onProgress, onStatus } = {}) {
  const fmtMB = b => b / 1048576
  const t0 = performance.now()
  const res = await fetch(new URL('../crossfilter/flights.js', import.meta.url))
  const total = +res.headers.get('Content-Length') || 37313858

  if (!res.body || !res.body.getReader) return parse((await import(URL.createObjectURL(new Blob([await res.text()], { type: 'application/javascript' })))).data)

  const reader = res.body.getReader()
  const chunks = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.byteLength
    const elapsed = (performance.now() - t0) / 1000
    onProgress?.(received / total, fmtMB(received), fmtMB(total), elapsed > 0.05 ? fmtMB(received / elapsed) : 0)
  }
  onProgress?.(1, fmtMB(total), fmtMB(total), 0)
  onStatus?.('parsing')
  await new Promise(r => requestAnimationFrame(r))

  const url = URL.createObjectURL(new Blob(chunks, { type: 'application/javascript' }))
  const { data } = await import(url)
  URL.revokeObjectURL(url)

  onStatus?.('projecting flights')
  await new Promise(r => requestAnimationFrame(r))
  return parse(data)
}

// Shared parse — every library row receives the same array of plain objects:
// date (Date), time (hours), delay (clamped), distance (clamped), origin,
// destination. flights.js exports `data` as an OBJECT keyed by index; we
// materialise to a dense array so peer libraries get a real array.
function parse (rows) {
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

function parseDate (d) {
  return new Date(2001, d.substring(0, 2) - 1, d.substring(2, 4), d.substring(4, 6), d.substring(6, 8))
}

// ---- standalone page bootstrap (examples/multidim/index.html) ----
// Only runs when the standalone loader/rows markup is present; the embedded
// landing-page path calls mountMultidim() directly with its own chrome.
const standaloneRows = document.querySelector('#rows')
const standaloneLoader = document.querySelector('#loader')
if (standaloneRows && standaloneLoader) {
  const $bar = standaloneLoader.querySelector('.loader-bar-fill')
  const $pct = standaloneLoader.querySelector('.loader-pct')
  const $bytes = standaloneLoader.querySelector('.loader-bytes')
  const $rate = standaloneLoader.querySelector('.loader-rate')
  const $stat = standaloneLoader.querySelector('.loader-status')
  mountMultidim({
    rowsEl: standaloneRows,
    onProgress: (pct, recMB, totMB, rateMB) => {
      $bar.style.width = `${(pct * 100).toFixed(1)}%`
      $pct.textContent = `${(pct * 100) | 0}%`
      $bytes.textContent = `${recMB.toFixed(1)} / ${totMB.toFixed(1)} MB`
      $rate.textContent = rateMB > 0 ? `${rateMB.toFixed(1)} MB/s` : '…'
    },
    onStatus: s => { $stat.textContent = s },
  }).then(() => {
    standaloneLoader.classList.add('done')
    setTimeout(() => standaloneLoader.remove(), 360)
  })
}
