// Per-row brush latency tracker. Measures `pointermove → first chart update
// that reflects it` — i.e. how long the user waits between moving the mouse
// and seeing the brush respond. Rolling p50 / p95 over the last `window`
// samples; live-updates the row's stat displays.
//
// Why this metric and not "input → next paint":
//
//   The earlier dual-rAF approach measured `pointermove → next post-paint
//   frame`, which sounds right but two things bias it badly:
//
//   1. requestAnimationFrame timing isn't anchored to vsync the way you'd
//      hope — on high-refresh displays a nested rAF pair can complete in
//      <5ms, dragging every measurement toward zero independent of what
//      the library actually did.
//
//   2. With high-rate pointer events (1000Hz mice / trackpads) and a slow
//      library that batches updates per frame, many pointermoves arrive
//      *late* in a batch — close to the eventual paint. They report sub-
//      millisecond latency even though the brush is visibly stuttering,
//      because the *individual* input did happen close to a paint, even
//      if no chart update for that specific input ever rendered.
//
// Measuring `input → chart-update` instead is direct: the chart helper
// notifies us via `markUpdate` every time `setBars` runs (which is
// exactly when the SVG path mutates). Inputs that piled up behind a slow
// reactive cascade get high latencies because they wait for their cascade
// to fire. Sync libs that update on every pointermove get tiny latencies.
// React's useLayoutEffect path goes through React's reconciler before
// touching the chart, so its cost shows up here directly.
//
// Multiple charts per row → each setBars notifies; we only credit the
// first one in a batch (the rest are within microseconds anyway).

export function makeLatencyTracker(rowEl, { window: capacity = 100 } = {}) {
  const samples = []
  let pending = []

  const p50El = rowEl.querySelector('[data-stat=p50]')
  const p95El = rowEl.querySelector('[data-stat=p95]')
  const cntEl = rowEl.querySelector('[data-stat=count]')

  function markInput() {
    const t = performance.now()
    // Drop stale entries — a click without drag (or any input that didn't
    // produce a chart update) leaves a timestamp in pending. The next
    // session's first markUpdate would otherwise charge it a huge fake
    // latency. 500ms gives a brushing session generous head-room.
    if (pending.length && t - pending[0] > 500) pending = []
    pending.push(t)
  }

  function markUpdate() {
    if (!pending.length) return
    const t = performance.now()
    for (const start of pending) {
      samples.push(t - start)
      if (samples.length > capacity) samples.shift()
    }
    pending = []
    renderStats()
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
    pending = []
    if (p50El) p50El.textContent = '—'
    if (p95El) p95El.textContent = '—'
    if (cntEl) cntEl.textContent = '0'
  }

  return { markInput, markUpdate, reset, samples }
}

function fmt(n) {
  if (n >= 100) return n.toFixed(0)
  if (n >= 10) return n.toFixed(1)
  return n.toFixed(2)
}
