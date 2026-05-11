// Per-row brush latency tracker. Measures `latest pointermove → first chart
// update that reflects it` — i.e. how stale is each paint relative to the
// user's most recent input position. Rolling p50 / p95 over the last
// `window` samples; live-updates the row's stat displays.
//
// Why "latest input → paint" and not "every input → paint":
//
//   An earlier version of this tracker recorded one sample *per pending
//   pointermove* when a paint fired. For an rAF-coalesced library (data:
//   `filters[name].raf()` defers the write to the next frame) that means
//   a single paint records 2-16 samples — one per pointermove that
//   piled up since the previous paint. The oldest sample in each batch
//   carries `≈ rAF wait + cascade` of "wait time" even though the input
//   it represents was *superseded* by newer pointermoves before any
//   paint reflecting it could have rendered. The user only ever
//   perceives the latest input being reflected (that's why the brush
//   feels smooth), but the old p95 kept reporting the queue-depth tail.
//
//   Synchronous libraries (crossfilter and friends) wrote filters on
//   every pointermove, so K=1 per paint and the old metric matched
//   per-paint freshness incidentally. The bias kicked in only for
//   batched libraries — i.e. the comparison was unfair.
//
//   The per-paint-freshness metric is honest for both: each paint
//   records exactly one sample, `paint_time - newest_pending_input`.
//   Sync libs see the same numbers as before (K=1). Batched libs no
//   longer pay for inputs that were already overwritten before any
//   paint could have shown them.
//
// requestAnimationFrame timing notes: rAF doesn't anchor to vsync as
// reliably as you'd hope on high-refresh displays. The metric here
// doesn't depend on it — `markUpdate` fires when `setBars` actually
// mutates the SVG path, which is direct.
//
// Multiple charts per row → each setBars notifies; we only credit the
// first one in a batch (subsequent setBars calls in the same cascade
// find `pending` empty after the first one cleared it).

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
    // Per-paint freshness: only credit the most recent input. Older
    // pendings were superseded — they never had a paint that reflected
    // *them* specifically; the user moved on before that paint could
    // have rendered. Charging them latency would be charging queue
    // depth, not perceived responsiveness.
    const latest = pending[pending.length - 1]
    samples.push(t - latest)
    if (samples.length > capacity) samples.shift()
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
