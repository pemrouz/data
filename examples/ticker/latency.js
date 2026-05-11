// Per-row compute tracker — total reactive work the lib does per render
// cycle. Two halves to capture:
//
//   sampleIngest(ms)  — main.js times each lib.ingest(batch) call.
//   sampleRender(ms)  — each lib's rAF render callback times itself
//                        (including any lazy computed reads inside it).
//
// On each sampleRender we close out a cycle: sample = (accumulated
// ingest time since last render) + render time. The accumulator
// matters because a rAF can coalesce multiple ingests — eager work
// happens N times, lazy work once. Summing both halves prevents the
// metric from quietly favouring "defer everything to rAF" patterns
// (which would otherwise look free here even though they do the same
// total CPU work).
//
// Bias notes:
//
//   The previous tracker measured "batch arrival → next paint" via an
//   end-of-task microtask, like the brush metric in examples/multidim.
//   That worked for multidim because each library responds to its own
//   input (a pointermove on its own chart). For ticker every library
//   sees the SAME batch in the same outer event loop and they all
//   paint in the same shared rAF cycle — so whichever lib went first
//   in the loop wore everyone's downstream wait as its own latency.
//   Compute time per cycle is ordering-independent: each lib's
//   ingest and each lib's render are isolated measurements of just
//   that lib's reactive cascade.
//
//   The intermediate "ingest only" metric (one commit ago) flipped
//   the bias the other way: libs that defer compute to rAF (mobx,
//   solid, vue, preact-signals, react) reported near-zero ingest time
//   while doing the actual O(WINDOW) walk inside the rAF callback
//   where it wasn't being timed. data's eager cascade landed
//   entirely inside ingest and looked expensive by comparison even
//   when the total CPU per cycle was similar or smaller.

export function makeLatencyTracker(rowEl, { window: capacity = 100 } = {}) {
  const samples = []
  let pendingIngest = 0   // accumulated ingest ms since the last render

  const p50El = rowEl.querySelector('[data-stat=p50]')
  const p95El = rowEl.querySelector('[data-stat=p95]')

  function sampleIngest(ms) { pendingIngest += ms }

  function sampleRender(ms) {
    samples.push(pendingIngest + ms)
    if (samples.length > capacity) samples.shift()
    pendingIngest = 0
    renderStats()
  }

  // Back-compat aliases. The original API had `markIngest` / `markUpdate`
  // (no-args) called from inside lib files; some rows still call them.
  // Treat them as no-ops — the real measurement happens via
  // sampleIngest (from main.js) and sampleRender (from each lib's rAF).
  function markIngest() {}
  function markUpdate() {}
  // `sample(ms)` was the public name during the ingest-only phase;
  // accept it as a synonym for sampleIngest so main.js doesn't
  // accidentally drop measurements during the rename.
  function sample(ms) { sampleIngest(ms) }

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
    pendingIngest = 0
    if (p50El) p50El.textContent = '—'
    if (p95El) p95El.textContent = '—'
  }

  return { sampleIngest, sampleRender, sample, markIngest, markUpdate, reset, samples }
}

function fmt(n) {
  if (n >= 100) return n.toFixed(0)
  if (n >= 10) return n.toFixed(1)
  return n.toFixed(2)
}
