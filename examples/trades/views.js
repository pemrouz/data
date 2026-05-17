// Shared renderers for the trades dashboard. Every lib row consumes the
// same renderOrderbook(bids, asks) / fmtCpu surface so the comparison is
// strictly about reactive cost — not about DOM-layer differences.
//
// Inputs to renderOrderbook are PLAIN ARRAYS of bucket counts. Libraries
// whose primitive emits a different shape (e.g. data's `length(fn)` emits
// {[bucket]: {value: count}}) flatten at their own boundary before
// passing in here. Keeps this module ignorant of any reactive primitive.

import { PRICE_BINS, MID_BUCKET, MID_TARGET, bucketPrice, priceBucket } from './gen.js'

// ----------------------------- order book -------------------------------
// Depth chart (canvas) on the left, numerical ladder on the right.
// Cumulative depth grows AWAY from the mid on each side; the depth chart
// shares an x-scale across bid + ask so left/right asymmetry is visible.
// Ladder is fixed at 7 ask rows on top + mid banner + 7 bid rows.
//
// The mid banner displays a LIVE mid derived from the data (weighted
// average of bid and ask bucket prices), so it lags the regime by the
// rolling window's age — the same lag a real exchange's order-book mid
// shows when the underlying market moves.
export function setupOrderbook(host) {
  const canvas = host.querySelector('canvas[data-target=depth]')
  const ladder = host.querySelector('[data-target=ladder]')
  const rect = canvas.getBoundingClientRect()
  const dpr = Math.max(1, window.devicePixelRatio || 1)
  const w = Math.max(120, Math.round(rect.width))
  const h = Math.max(120, Math.round(rect.height))
  canvas.width = w * dpr
  canvas.height = h * dpr
  canvas.style.width = w + 'px'
  canvas.style.height = h + 'px'
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)

  const askRows = []
  const bidRows = []
  for (let i = PRICE_BINS - 1; i > MID_BUCKET; i--) {
    const row = document.createElement('div')
    row.className = 'ob-row ob-row-ask is-empty'
    row.innerHTML = `
      <span class="ob-cell-price"></span>
      <span class="ob-cell-qty"></span>
      <span class="ob-cell-cum"></span>
    `
    ladder.appendChild(row)
    askRows.push({
      bucket: i,
      el: row,
      qtyEl: row.querySelector('.ob-cell-qty'),
      cumEl: row.querySelector('.ob-cell-cum'),
      priceEl: row.querySelector('.ob-cell-price'),
    })
  }
  const midEl = document.createElement('div')
  midEl.className = 'ob-mid'
  midEl.innerHTML = `<span data-target="mid-price">$${bucketPrice(MID_BUCKET).toFixed(2)}</span><span class="ob-mid-spr" data-target="mid-spr">spread —</span>`
  ladder.appendChild(midEl)
  for (let i = MID_BUCKET - 1; i >= 0; i--) {
    const row = document.createElement('div')
    row.className = 'ob-row ob-row-bid is-empty'
    row.innerHTML = `
      <span class="ob-cell-price"></span>
      <span class="ob-cell-qty"></span>
      <span class="ob-cell-cum"></span>
    `
    ladder.appendChild(row)
    bidRows.push({
      bucket: i,
      el: row,
      qtyEl: row.querySelector('.ob-cell-qty'),
      cumEl: row.querySelector('.ob-cell-cum'),
      priceEl: row.querySelector('.ob-cell-price'),
    })
  }
  for (const r of askRows) r.priceEl.textContent = '$' + bucketPrice(r.bucket).toFixed(2)
  for (const r of bidRows) r.priceEl.textContent = '$' + bucketPrice(r.bucket).toFixed(2)

  return {
    ctx, w, h,
    askRows, bidRows,
    midPriceEl: midEl.querySelector('[data-target=mid-price]'),
    midSprEl: midEl.querySelector('[data-target=mid-spr]'),
    scaleRef: { v: 1 },
  }
}

export function renderOrderbook(state, bids, asks) {
  const { ctx, w, h, askRows, bidRows, midPriceEl, midSprEl, scaleRef } = state

  // Ladder cumulatives grow AWAY from the mid on each side.
  let aCum = 0, aTotal = 0
  for (let i = askRows.length - 1; i >= 0; i--) {
    const r = askRows[i]
    const v = asks[r.bucket] || 0
    aCum += v
    aTotal = aCum
    r.qtyEl.textContent = v > 0 ? v : '–'
    r.cumEl.textContent = aCum > 0 ? aCum : '–'
    const empty = v === 0
    if (r.el.classList.contains('is-empty') !== empty) r.el.classList.toggle('is-empty', empty)
  }
  let bCum = 0, bTotal = 0
  for (let i = 0; i < bidRows.length; i++) {
    const r = bidRows[i]
    const v = bids[r.bucket] || 0
    bCum += v
    bTotal = bCum
    r.qtyEl.textContent = v > 0 ? v : '–'
    r.cumEl.textContent = bCum > 0 ? bCum : '–'
    const empty = v === 0
    if (r.el.classList.contains('is-empty') !== empty) r.el.classList.toggle('is-empty', empty)
  }

  // Live mid + spread, both derived from data.
  let bidWS = 0, bidWP = 0, askWS = 0, askWP = 0
  for (let i = 0; i < PRICE_BINS; i++) {
    const b = bids[i] || 0
    const a = asks[i] || 0
    if (b > 0) { bidWS += b; bidWP += b * bucketPrice(i) }
    if (a > 0) { askWS += a; askWP += a * bucketPrice(i) }
  }
  const bidMode = bidWS > 0 ? bidWP / bidWS : MID_TARGET
  const askMode = askWS > 0 ? askWP / askWS : MID_TARGET
  const liveMid = (bidMode + askMode) / 2
  const spr = askMode - bidMode
  midPriceEl.textContent = '$' + liveMid.toFixed(2)
  midSprEl.textContent = 'spread $' + spr.toFixed(2)

  // Depth chart: shared x-scale, sticky max so it doesn't jitter.
  const maxCum = Math.max(aTotal, bTotal, 1)
  if (maxCum > scaleRef.v)             scaleRef.v = maxCum
  else if (maxCum < scaleRef.v * 0.6)  scaleRef.v = maxCum * 1.1 || 1
  const scale = scaleRef.v

  ctx.clearRect(0, 0, w, h)
  const halfH = h / 2
  const inset = 6
  const usableW = w - inset

  // Cumulative arrays, closest-to-mid first.
  const askCum = []
  let aSum = 0
  for (let i = MID_BUCKET + 1; i < PRICE_BINS; i++) { aSum += asks[i] || 0; askCum.push(aSum) }
  const bidCum = []
  let bSum = 0
  for (let i = MID_BUCKET - 1; i >= 0; i--) { bSum += bids[i] || 0; bidCum.push(bSum) }

  // Asks (top half).
  ctx.fillStyle = 'rgba(255, 94, 58, 0.28)'
  ctx.strokeStyle = '#ff5e3a'
  ctx.lineWidth = 1.2
  drawStair(ctx, askCum, scale, usableW, w, halfH, 0)
  ctx.fill()
  drawStair(ctx, askCum, scale, usableW, w, halfH, 0, true)
  ctx.stroke()

  // Bids (bottom half).
  ctx.fillStyle = 'rgba(110, 231, 168, 0.28)'
  ctx.strokeStyle = '#6ee7a8'
  drawStair(ctx, bidCum, scale, usableW, w, halfH, 1)
  ctx.fill()
  drawStair(ctx, bidCum, scale, usableW, w, halfH, 1, true)
  ctx.stroke()

  // Mid dashed line.
  ctx.strokeStyle = 'rgba(155, 155, 160, 0.45)'
  ctx.lineWidth = 1
  ctx.setLineDash([3, 4])
  ctx.beginPath()
  ctx.moveTo(0, halfH)
  ctx.lineTo(w, halfH)
  ctx.stroke()
  ctx.setLineDash([])
}

function drawStair(ctx, cum, scale, usableW, w, halfH, side, outlineOnly) {
  ctx.beginPath()
  ctx.moveTo(w, halfH)
  for (let i = 0; i < cum.length; i++) {
    const x = w - (cum[i] / scale) * usableW
    const yNear = side === 0 ? halfH - (i / cum.length) * halfH : halfH + (i / cum.length) * halfH
    const yFar  = side === 0 ? halfH - ((i + 1) / cum.length) * halfH : halfH + ((i + 1) / cum.length) * halfH
    ctx.lineTo(x, yNear)
    ctx.lineTo(x, yFar)
  }
  if (!outlineOnly) {
    ctx.lineTo(w, side === 0 ? 0 : halfH * 2)
    ctx.closePath()
  }
}

// ------------------------------ cpu wave --------------------------------
// performance.now() in Chrome resolves to 100µs unless the page is
// cross-origin isolated. Per-frame ingest+settle can be well below that,
// so raw samples bottom out at 0 or 100µs (binary). A 60-frame rolling
// average resolves the true sub-quantum cost; both wave canvas and cpu
// label read the smoothed value, so the visual stays clean at low rates.

const sharedMax = { value: 0 }
const allWaves = []

export function setupWaveform(canvas, palette, peakEl) {
  const rect = canvas.getBoundingClientRect()
  const dpr = Math.max(1, window.devicePixelRatio || 1)
  canvas.width = Math.round(rect.width * dpr) || 540
  canvas.height = Math.round(64 * dpr)
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)
  const samples = []
  const rawBuf = []
  const CAP = 200
  const SMOOTH_WINDOW = 60
  const stroke = palette === 'pos' ? '#6ee7a8' : '#ff5e3a'
  const fill   = palette === 'pos' ? 'rgba(110,231,168,0.15)' : 'rgba(255,94,58,0.18)'

  function draw() {
    const w = canvas.width / dpr
    const h = canvas.height / dpr
    ctx.clearRect(0, 0, w, h)
    if (!samples.length) return
    const max = Math.max(sharedMax.value, 0.001)
    const step = w / CAP
    ctx.beginPath()
    ctx.moveTo(0, h)
    for (let i = 0; i < samples.length; i++) {
      const x = i * step
      const y = h - Math.min(1, samples[i] / max) * (h - 4) - 2
      ctx.lineTo(x, y)
    }
    ctx.lineTo((samples.length - 1) * step, h)
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
    ctx.beginPath()
    for (let i = 0; i < samples.length; i++) {
      const x = i * step
      const y = h - Math.min(1, samples[i] / max) * (h - 4) - 2
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = stroke
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  const wave = {
    samples,
    latest: 0,
    push(ms) {
      rawBuf.push(ms)
      if (rawBuf.length > SMOOTH_WINDOW) rawBuf.shift()
      let s = 0
      for (let i = 0; i < rawBuf.length; i++) s += rawBuf[i]
      const smoothed = s / rawBuf.length
      wave.latest = smoothed
      samples.push(smoothed)
      if (samples.length > CAP) samples.shift()
      let localMax = 0
      for (let i = 0; i < samples.length; i++) if (samples[i] > localMax) localMax = samples[i]
      peakEl.textContent = fmtPeak(localMax)
      let m = 0
      for (const w of allWaves) {
        if (w._removed) continue
        for (let i = 0; i < w.samples.length; i++) if (w.samples[i] > m) m = w.samples[i]
      }
      sharedMax.value = m
      for (const w of allWaves) if (!w._removed) w._draw()
    },
    _draw: draw,
    _removed: false,
  }
  allWaves.push(wave)
  return wave
}

function fmtPeak(m) {
  if (m < 0.001) return (m * 1000).toFixed(2) + ' µs'
  if (m < 1)     return (m * 1000).toFixed(0) + ' µs'
  return m.toFixed(2) + ' ms'
}

export function fmtCpu(ms) {
  if (ms < 0.001) return (ms * 1000).toFixed(2) + ' µs / frame'
  if (ms < 1)     return (ms * 1000).toFixed(0) + ' µs / frame'
  return ms.toFixed(2) + ' ms / frame'
}
