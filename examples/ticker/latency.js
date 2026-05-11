// Per-row ingest latency. Measures "tick batch arrived → next paint can
// happen" — the same end-of-task pattern multidim uses, just keyed on a
// batch instead of a pointermove.
//
// Why the microtask trick (copied from examples/multidim/latency.js):
//   Some libs run all their derived views synchronously inside the
//   ingest call; some (vue-reactivity, mobx with scheduled reactions)
//   push some work into microtasks within the same macrotask. Recording
//   on the *first* downstream update would credit only the prompt path
//   and under-report the others. By scheduling a microtask in markIngest
//   and reading performance.now() then, we capture the full cascade
//   regardless of internal scheduling.
//
// Two adapters vs multidim:
//   1. The "input" is the moment the generator hands us a batch — we
//      record one timestamp per batch, not per tick. The perceptually
//      relevant number is "how long after the batch arrived was the page
//      ready to paint", not "how long per individual tick".
//   2. No coalescing of stale inputs — every batch is distinct (it's the
//      lib's job to keep up). If markIngest never gets a corresponding
//      cascade (lib silently dropped the work), we'll see queue depth
//      growing in `pending`; we surface that as a separate "behind"
//      indicator rather than poisoning the latency number with infinite
//      samples.

export function makeLatencyTracker(rowEl, { window: capacity = 100 } = {}) {
  const samples = []
  let pendingStart = -1       // perf.now() of the most recent ingest
  let pendingCount = 0        // ingests not yet observed by a paint
  let cascadeScheduled = false

  const p50El = rowEl.querySelector('[data-stat=p50]')
  const p95El = rowEl.querySelector('[data-stat=p95]')

  function markIngest() {
    pendingStart = performance.now()
    pendingCount++
  }

  // Libraries call this once per render pass (any DOM-touching update is
  // fine; the tap callback in lib-data.js, the React commit, etc.).
  function markUpdate() {
    if (pendingStart < 0 || cascadeScheduled) return
    cascadeScheduled = true
    queueMicrotask(() => {
      const t = performance.now()
      samples.push(t - pendingStart)
      if (samples.length > capacity) samples.shift()
      pendingStart = -1
      pendingCount = 0
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
  }

  function reset() {
    samples.length = 0
    pendingStart = -1
    pendingCount = 0
    cascadeScheduled = false
    if (p50El) p50El.textContent = '—'
    if (p95El) p95El.textContent = '—'
  }

  return { markIngest, markUpdate, reset, samples, get behind() { return pendingCount } }
}

function fmt(n) {
  if (n >= 100) return n.toFixed(0)
  if (n >= 10) return n.toFixed(1)
  return n.toFixed(2)
}
