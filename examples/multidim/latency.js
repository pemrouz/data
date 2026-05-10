// Per-row brush latency tracker. Each pointermove timestamps the input;
// nested rAFs measure when the next frame finishes painting; the difference
// is what the user actually perceives. Rolling p50 / p95 over the last
// `window` samples; live-updates the row's stat displays.
//
// Why two rAFs: the first callback runs *before* paint of the next frame
// (browser's rendering steps); the second runs at the start of the frame
// after that, by which time the prior frame's paint completed. So
// `t_secondRAF - t_input` ≈ pointermove → first paint that included it.

export function makeLatencyTracker(rowEl, { window: capacity = 100 } = {}) {
  const samples = []
  let pending = []
  let scheduled = false

  const p50El = rowEl.querySelector('[data-stat=p50]')
  const p95El = rowEl.querySelector('[data-stat=p95]')
  const cntEl = rowEl.querySelector('[data-stat=count]')

  function markInput() {
    pending.push(performance.now())
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const t = performance.now()
        for (const start of pending) {
          samples.push(t - start)
          if (samples.length > capacity) samples.shift()
        }
        pending = []
        scheduled = false
        renderStats()
      })
    })
  }

  function renderStats() {
    if (!samples.length) return
    const sorted = samples.slice().sort((a, b) => a - b)
    const p50 = sorted[Math.floor((sorted.length - 1) * 0.5)]
    const p95 = sorted[Math.floor((sorted.length - 1) * 0.95)]
    if (p50El) p50El.textContent = fmt(p50)
    if (p95El) p95El.textContent = fmt(p95)
    if (cntEl) cntEl.textContent = String(samples.length)
  }

  function reset() {
    samples.length = 0
    if (p50El) p50El.textContent = '—'
    if (p95El) p95El.textContent = '—'
    if (cntEl) cntEl.textContent = '0'
  }

  return { markInput, reset, samples }
}

function fmt(n) {
  if (n >= 100) return n.toFixed(0)
  if (n >= 10) return n.toFixed(1)
  return n.toFixed(2)
}
