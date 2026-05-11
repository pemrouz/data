// Per-row brush latency tracker. Measures `latest pointermove → end of the
// JS task that contains the chart updates` — i.e. when the browser is
// finally ready to paint everything the filter change caused. Rolling p50
// / p95 over the last `window` samples; live-updates the row's stat
// displays.
//
// Why end-of-task and not first-setBars:
//
//   An earlier version recorded the sample on the first `markUpdate` call
//   (= first setBars in the cascade). That works for libs where all
//   chart updates happen close together — crossfilter (sub-ms per group),
//   the data lib (incremental everything, ~5ms cascade), React (single
//   commit phase under useLayoutEffect). It breaks for libs that
//   re-evaluate each chart's histogram from scratch in sequence:
//   vue-reactivity, mobx, preact-signals and rxjs all walk the 231k-row
//   source once per histogram (4 histograms + active + top5 = 6 passes).
//   The *first* chart's setBars fires after one pass (~10-20ms); the
//   remaining 5 passes spill over another 50-100ms before the browser
//   gets to paint. The user perceives the row as "slow" because they
//   see the brush stutter through the remaining updates; the metric
//   saw only the first update and reported a misleadingly fast number.
//
//   Solution: on the first `markUpdate` of a cascade, schedule a
//   microtask. Microtasks run *after* the current macrotask returns —
//   i.e. after every synchronous setBars in this filter-change cascade,
//   after React's commit phase, after vue's last effect, etc. The
//   sample is recorded then. The window is `microtask_fire_time -
//   latest_pending_input`, which captures the full per-cascade cost
//   regardless of how many sequential setBars happened inside it.
//
//   For libs that do schedule their work onto a later frame
//   (effectively async) — none in the current peer pool, but a future
//   addition might — the microtask would fire before any setBars
//   landed and miss the cascade entirely. If that becomes relevant
//   we'd swap microtask for `requestAnimationFrame(() =>
//   queueMicrotask(...))` to bridge across the next frame's task.
//
// Per-paint freshness (the previous bias fix): we still credit only
// the most recent pending input — older pointermoves were superseded
// by newer ones before any paint could have reflected them. Charging
// them latency would be charging queue depth, not perceived
// responsiveness.

export function makeLatencyTracker(rowEl, { window: capacity = 100 } = {}) {
  const samples = []
  let pending = []
  let cascadeScheduled = false

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
    if (!pending.length || cascadeScheduled) return
    cascadeScheduled = true
    // Microtask: runs after this macrotask (the cascade) completes. By
    // then every synchronous setBars / effect / commit in the cascade
    // has finished — which is the moment the browser can paint.
    queueMicrotask(() => {
      const t = performance.now()
      const latest = pending[pending.length - 1]
      samples.push(t - latest)
      if (samples.length > capacity) samples.shift()
      pending = []
      cascadeScheduled = false
      renderStats()
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
    pending = []
    cascadeScheduled = false
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
