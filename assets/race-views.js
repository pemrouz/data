/* Order-book viz for the home-page race carousel — a depth-chart staircase +
 * numerical price ladder, plus a cpu-per-frame wave that plots TWO series on
 * one canvas: the selected engine (accent) against the data baseline (green).
 *
 * Lifted and adapted from the retired examples/trades dashboard (its
 * setupOrderbook / renderOrderbook were the "order book style" we want) — the
 * price-bucket geometry is identical so the picture reads the same. The wave is
 * new: dual-series so a single carousel card still shows the gap directly.
 *
 * Inputs to renderOrderbook are PLAIN ARRAYS of per-bucket counts; every engine
 * flattens its own primitive's shape to that before calling in here, so this
 * module stays ignorant of any reactive library.
 *
 * Hand-written `.js`, no `.ts` sibling (see CLAUDE.md). */

export const PRICE_LO = 50
export const PRICE_HI = 100
export const PRICE_BINS = 15
export const MID_TARGET = 75
export const MID_BUCKET = priceBucket(MID_TARGET)
const PRICE_STEP = (PRICE_HI - PRICE_LO) / PRICE_BINS // price width of one bucket
// The depth chart plots an ABSOLUTE-price y-axis (not rank-from-center) so the
// whole book — walls and the dashed mid line — visibly walks up and down as the
// mid drifts. This is the price window it shows (the band the book actually
// occupies); the live mid stays comfortably inside it.
const VIEW_LO = 56, VIEW_HI = 94

export function priceBucket (p) {
  if (p <= PRICE_LO) return 0
  if (p >= PRICE_HI) return PRICE_BINS - 1
  return Math.floor((p - PRICE_LO) / (PRICE_HI - PRICE_LO) * PRICE_BINS)
}
export function bucketPrice (idx) {
  return PRICE_LO + (idx + 0.5) * (PRICE_HI - PRICE_LO) / PRICE_BINS
}

/* ------------------------------ order book ------------------------------ */
// Depth chart (canvas) left, numerical ladder right. Cumulative depth grows
// AWAY from the mid on each side; depth shares an x-scale across bid+ask so
// asymmetry is visible. Ladder is 7 ask rows · mid banner · 7 bid rows.
export function setupOrderbook (host) {
  const canvas = host.querySelector('canvas[data-target=depth]')
  const ladder = host.querySelector('[data-target=ladder]')
  const dpr = Math.max(1, window.devicePixelRatio || 1)
  const rect = canvas.getBoundingClientRect()
  const w = Math.max(120, Math.round(rect.width))
  const h = Math.max(120, Math.round(rect.height))
  canvas.width = w * dpr; canvas.height = h * dpr
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px'
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr)

  const askRows = [], bidRows = []
  const mkRow = (cls, bucket, arr) => {
    const row = document.createElement('div')
    row.className = `ob-row ${cls} is-empty`
    row.innerHTML = '<span class="ob-cell-price"></span><span class="ob-cell-qty"></span><span class="ob-cell-cum"></span>'
    ladder.appendChild(row)
    arr.push({ bucket, el: row, qtyEl: row.querySelector('.ob-cell-qty'), cumEl: row.querySelector('.ob-cell-cum'), priceEl: row.querySelector('.ob-cell-price') })
  }
  for (let i = PRICE_BINS - 1; i > MID_BUCKET; i--) mkRow('ob-row-ask', i, askRows)
  const midEl = document.createElement('div')
  midEl.className = 'ob-mid'
  midEl.innerHTML = `<span data-target="mid-price">$${bucketPrice(MID_BUCKET).toFixed(2)}</span><span class="ob-mid-spr" data-target="mid-spr">spread —</span>`
  ladder.appendChild(midEl)
  for (let i = MID_BUCKET - 1; i >= 0; i--) mkRow('ob-row-bid', i, bidRows)
  for (const r of askRows) r.priceEl.textContent = '$' + bucketPrice(r.bucket).toFixed(2)
  for (const r of bidRows) r.priceEl.textContent = '$' + bucketPrice(r.bucket).toFixed(2)

  return {
    ctx, w, h, askRows, bidRows,
    midPriceEl: midEl.querySelector('[data-target=mid-price]'),
    midSprEl: midEl.querySelector('[data-target=mid-spr]'),
    scaleRef: { v: 1 },
  }
}

export function renderOrderbook (state, bids, asks, mid) {
  const { ctx, w, h, askRows, bidRows, midPriceEl, midSprEl, scaleRef } = state

  let aCum = 0
  for (let i = askRows.length - 1; i >= 0; i--) {
    const r = askRows[i], v = asks[r.bucket] || 0
    aCum += v
    r.qtyEl.textContent = v > 0 ? v : '–'
    r.cumEl.textContent = aCum > 0 ? aCum : '–'
    const empty = v === 0
    if (r.el.classList.contains('is-empty') !== empty) r.el.classList.toggle('is-empty', empty)
  }
  let bCum = 0
  for (let i = 0; i < bidRows.length; i++) {
    const r = bidRows[i], v = bids[r.bucket] || 0
    bCum += v
    r.qtyEl.textContent = v > 0 ? v : '–'
    r.cumEl.textContent = bCum > 0 ? bCum : '–'
    const empty = v === 0
    if (r.el.classList.contains('is-empty') !== empty) r.el.classList.toggle('is-empty', empty)
  }

  // Live mid: the drifting market mid passed in by the driver (a bounded random
  // walk). Falls back to the book-derived weighted mid if none is supplied.
  // Spread stays book-derived (distance between the bid and ask masses).
  let bWS = 0, bWP = 0, aWS = 0, aWP = 0
  for (let i = 0; i < PRICE_BINS; i++) {
    const b = bids[i] || 0, a = asks[i] || 0
    if (b > 0) { bWS += b; bWP += b * bucketPrice(i) }
    if (a > 0) { aWS += a; aWP += a * bucketPrice(i) }
  }
  const bidMode = bWS > 0 ? bWP / bWS : MID_TARGET
  const askMode = aWS > 0 ? aWP / aWS : MID_TARGET
  const liveMid = (mid == null || !isFinite(mid)) ? (bidMode + askMode) / 2 : mid
  midPriceEl.textContent = '$' + liveMid.toFixed(2)
  midSprEl.textContent = 'spread $' + Math.max(0, askMode - bidMode).toFixed(2)

  // Depth chart on an ABSOLUTE-price y-axis: high price at top, low at bottom,
  // the live mid as a dashed line that GLIDES as the book walks. Cumulative
  // depth grows away from the mid on each side and extends left from the right
  // edge. Sticky x-scale (over the mid-split totals, so it tracks the bands the
  // chart actually draws) keeps widths from jittering frame-to-frame.
  let aDepth = 0, bDepth = 0
  for (let i = 0; i < PRICE_BINS; i++) {
    const c = bucketPrice(i)
    if (c > liveMid) aDepth += asks[i] || 0; else bDepth += bids[i] || 0
  }
  const maxCum = Math.max(aDepth, bDepth, 1)
  if (maxCum > scaleRef.v) scaleRef.v = maxCum
  else if (maxCum < scaleRef.v * 0.6) scaleRef.v = maxCum * 1.1 || 1
  const scale = scaleRef.v

  ctx.clearRect(0, 0, w, h)
  const inset = 6, usableW = w - inset
  const yFor = p => h * (1 - (Math.max(VIEW_LO, Math.min(VIEW_HI, p)) - VIEW_LO) / (VIEW_HI - VIEW_LO))
  const yMid = yFor(liveMid)

  // Asks: buckets priced above the mid, drawn upward from the mid line.
  ctx.fillStyle = 'rgba(255, 94, 58, 0.28)'; ctx.strokeStyle = '#ff5e3a'; ctx.lineWidth = 1.2
  drawSide(ctx, asks, 1, liveMid, yFor, yMid, scale, usableW, w)
  ctx.fillStyle = 'rgba(103, 219, 161, 0.28)'; ctx.strokeStyle = '#67dba1'
  drawSide(ctx, bids, -1, liveMid, yFor, yMid, scale, usableW, w)

  // Dashed mid line — rides the live mid up and down.
  ctx.strokeStyle = 'rgba(155, 155, 160, 0.5)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4])
  ctx.beginPath(); ctx.moveTo(0, yMid); ctx.lineTo(w, yMid); ctx.stroke(); ctx.setLineDash([])
}

// Draw one side of the depth chart on a price axis. dir = +1 for asks (above
// the mid, towards the top), -1 for bids (below, towards the bottom). Walks the
// buckets outward from the mid accumulating depth; each bucket is a horizontal
// step whose left edge x encodes cumulative size. Fills, then strokes the
// outline so the staircase reads cleanly.
function drawSide (ctx, counts, dir, mid, yFor, yMid, scale, usableW, w) {
  const order = []
  for (let i = 0; i < PRICE_BINS; i++) {
    const lo = PRICE_LO + i * PRICE_STEP, hi = lo + PRICE_STEP
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

/* -------------------------------- cpu wave ------------------------------- */
// Two filled series on one canvas — the selected engine (accent) and the data
// baseline (green) — sharing one y-scale, with a dashed 16ms (60fps) budget
// line. Each series carries a 20-frame rolling average so sub-quantum
// performance.now() resolution (100µs in non-isolated Chrome) doesn't make the
// trace binary. cpuEl gets the engine's smoothed p50; ratioEl gets ×-vs-data.
export function makeWave (canvas, cpuEl, ratioEl) {
  const CAP = 110, SMOOTH = 20
  const dpr = Math.max(1, window.devicePixelRatio || 1)
  const ctx = canvas.getContext('2d')
  const resize = () => {
    canvas.width = Math.round((canvas.clientWidth || 540) * dpr)
    canvas.height = Math.round((canvas.clientHeight || 72) * dpr)
  }
  resize(); window.addEventListener('resize', resize)

  const main = { samples: [], raw: [], stroke: '#ff5e3a', fill: 'rgba(255,94,58,0.20)' }
  const base = { samples: [], raw: [], stroke: '#67dba1', fill: 'rgba(103,219,161,0.16)' }

  const smooth = (series, ms) => {
    series.raw.push(ms); if (series.raw.length > SMOOTH) series.raw.shift()
    let s = 0; for (const v of series.raw) s += v
    const avg = s / series.raw.length
    series.samples.push(avg); if (series.samples.length > CAP) series.samples.shift()
    return avg
  }

  function drawSeries (series, top) {
    const w = canvas.width, h = canvas.height, n = series.samples.length
    if (!n) return
    const step = w / (CAP - 1)
    ctx.beginPath(); ctx.moveTo(0, h)
    for (let i = 0; i < n; i++) ctx.lineTo(i * step, h - Math.min(1, series.samples[i] / top) * (h - 4) - 2)
    ctx.lineTo((n - 1) * step, h); ctx.closePath()
    ctx.fillStyle = series.fill; ctx.fill()
    ctx.beginPath()
    for (let i = 0; i < n; i++) { const x = i * step, y = h - Math.min(1, series.samples[i] / top) * (h - 4) - 2; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y) }
    ctx.strokeStyle = series.stroke; ctx.lineWidth = 1.6 * dpr; ctx.lineJoin = 'round'; ctx.stroke()
  }

  function draw () {
    const w = canvas.width, h = canvas.height
    ctx.clearRect(0, 0, w, h)
    let top = 0.4
    for (const v of main.samples) if (v > top) top = v
    for (const v of base.samples) if (v > top) top = v
    top = Math.max(top, 17) // keep the 16ms line on-canvas while engines are cheap
    const y16 = h - (16 / top) * (h - 4) - 2
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.setLineDash([4 * dpr, 4 * dpr]); ctx.lineWidth = dpr
    ctx.beginPath(); ctx.moveTo(0, y16); ctx.lineTo(w, y16); ctx.stroke(); ctx.setLineDash([])
    drawSeries(base, top)
    drawSeries(main, top)
  }

  function p50 (series) {
    if (!series.samples.length) return 0
    const s = series.samples.slice().sort((a, b) => a - b)
    return s[Math.floor((s.length - 1) * 0.5)]
  }

  return {
    // mainMs = selected engine's frame cost; baseMs = data baseline (may equal main when data is selected)
    // returns the smoothed selected-vs-data ratio (p50/p50) so the caller can
    // show the same multiplier elsewhere (e.g. next to the baseline footer)
    push (mainMs, baseMs) {
      smooth(main, mainMs); smooth(base, baseMs)
      const pm = p50(main), pb = p50(base)
      if (cpuEl) { cpuEl.textContent = fmtCpu(pm); cpuEl.classList.toggle('over', pm > 16) }
      const ratio = pb > 0.0005 ? pm / pb : 0
      if (ratioEl) ratioEl.textContent = ratio > 0 ? fmtRatio(ratio) + ' data' : '—'
      draw()
      return ratio
    },
    reset () { main.samples.length = main.raw.length = base.samples.length = base.raw.length = 0; draw() },
  }
}

export function fmtCpu (ms) {
  if (ms < 0.001) return (ms * 1000).toFixed(2) + ' µs/frame'
  if (ms < 1) return (ms * 1000).toFixed(0) + ' µs/frame'
  return ms.toFixed(2) + ' ms/frame'
}

// "89×" / "3.4×" / "1.0×" — integer once it's into double digits
export function fmtRatio (r) { return (r >= 10 ? Math.round(r) : r.toFixed(1)) + '×' }
