// @ts-nocheck
// perf/run-report.ts — standalone perf-REPORT sweep (NOT the ok() gate).
//
// Runs in its own process under
//   node --experimental-strip-types --expose-gc perf/run-report.ts
// so it can force GC and own its sampling without touching the gate *.perf.ts
// files (their medians are computed for ok() and thrown away; re-deriving them
// here is cheaper and safer than threading a survives-the-fork channel through
// 18 forked test workers). Emits universal rows via perf/record.ts; the
// collator perf/gen-report.mjs turns the JSONL into examples/perf/perf.json.
//
// Shipped so far (the two de-risking spikes):
//   Spike 1 — H1 filter-insert: a timing row + a DETERMINISTIC op-count
//             (predicate evals per insert). Proves the survives-the-fork
//             emission path end to end.
//   Spike 2 — H4 interactive-tail: a synthetic crossfilter-BRUSH cascade tail.
//             NB there is no requestAnimationFrame / real paint in node, so this
//             is a *synthetic cascade tail* (each frame = one bound-write → the
//             synchronous cascade settles), NOT a captured interactive paint
//             tail. It yields the per-frame array + p50/p95/p99/max + the
//             worst-frame attribution that the report's H4 tile renders.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { $, value } from '../full.ts'
import { measure, median } from '../comparisons/bench/measure.ts'
import { record, resultsDir } from './record.ts'

const pct = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]

// ---------------------------------------------------------------------------
// Backfill — the "ops" harness: a uniform setup / single / batch micro-bench
// over every operator, so the report fills out with the library's real perf
// surface (a fresh sweep this run — NOT a copy of the gate *.perf.ts numbers).
// Each op gives three rows; the report nests them harness → operator → case.
// ---------------------------------------------------------------------------
function makeSource(N) {
  const o = {}
  for (let i = 0; i < N; i++) o[i] = { v: (i * 733) % 1000, g: i % 12, w: (i * 277) % 500 }
  return o
}

// field = the row field a single/batch update mutates (drives the recompute).
const OPS = [
  { op: 'filter', field: 'v', make: s => s.filter(r => r.v > 500) },
  { op: 'map', field: 'v', make: s => s.map(r => r.v * 2) },
  { op: 'to', field: 'v', make: s => s.to(a => Object.keys(a).length) },
  { op: 'between', field: 'v', make: s => s.between('v', [200, 800]) },
  { op: 'gt', field: 'v', make: s => s.gt('v', 500) },
  { op: 'az', field: 'v', make: s => s.az('v') },
  { op: 'za(100)', field: 'v', make: s => s.za('v', 100) },
  { op: 'length', field: 'v', make: s => s.length() },
  { op: 'length(fn)', field: 'g', make: s => s.length(r => r.g) },
  { op: 'sum', field: 'v', make: s => s.sum('v') },
  { op: 'avg', field: 'v', make: s => s.avg('v') },
  { op: 'max', field: 'v', make: s => s.max('v') },
  { op: 'min', field: 'v', make: s => s.min('v') },
  { op: 'group', field: 'g', make: s => s.group(r => r.g) },
  { op: 'distinct', field: 'g', make: s => s.distinct(r => r.g) },
  { op: 'reduce', field: 'v', make: s => s.reduce((a, r) => a + r.v, 0) },
  { op: 'tap', field: 'v', make: s => s.tap(() => {}) },
  { op: 'reverse', field: 'v', make: s => s.reverse() },
  { op: 'keys', field: 'v', make: s => s.keys() },
]

function backfillOperators() {
  const N = 10_000, BATCH = 500
  const r4 = x => +x.toFixed(4)
  const emit = (op, kase, ms, dims) => record({
    id: `${op}/${kase}@N=${dims.N}`, harness: 'ops', group: op, op, case: kase,
    kind: 'timing', dir: 'down', unit: 'ms', value: r4(ms), dims, stats: { median: r4(ms) },
  })
  let n = 0
  for (const spec of OPS) {
    try {
      // setup: build source + view + sink each rep
      const setup = measure(() => {
        const v = spec.make($(makeSource(N)))
        try { v.connect([]) } catch {}
      })
      // one live graph for single + batch
      const s = $(makeSource(N))
      const v = spec.make(s)
      try { v.connect([]) } catch {}
      const ids = Object.keys(s[value])
      let i = 0
      const single = measure(() => { const k = ids[i++ % ids.length]; s[k][spec.field] = (i * 131) % 1000 })
      let j = 0
      const batch = measure(() => {
        for (let b = 0; b < BATCH; b++) { const k = ids[j++ % ids.length]; s[k][spec.field] = (j * 131) % 1000 }
      })
      emit(spec.op, 'setup', setup, { N })
      emit(spec.op, 'single', single, { N })
      emit(spec.op, 'batch', batch, { N, batch: BATCH })
      n += 3
    } catch (e) {
      console.log(`[backfill] ${spec.op} skipped: ${e.message}`)
    }
  }
  console.log(`[backfill] ${n} operator rows`)
}

// ---------------------------------------------------------------------------
// Spike 2 — H4: synthetic crossfilter-brush cascade tail
// ---------------------------------------------------------------------------
function h4BrushTail() {
  const N = 50_000
  const data = {}
  for (let i = 0; i < N; i++) data[i] = { x: (i * 733) % 1000, v: (i * 277) % 1000 }
  const src = $(data)

  // Reactive brush bounds + the real crossfilter shape: between → windowed sort
  // → count. Connect sinks so the whole cascade materializes each frame.
  const lo = $(450)
  const hi = $(550)
  const win = src.between('x', [lo, hi])
  const top = win.za('v', 100) // bounded windowed sort (descending top-100) — the churn/spike source
  const n = win.length()
  win.connect([])
  top.connect([])
  n.connect([])

  const frames = []
  const phases = []
  const frame = (phase, fn) => {
    const t0 = performance.now()
    fn()
    frames.push(performance.now() - t0)
    phases.push(phase)
  }

  // The FIRST brush pays between's lazy sort-index build → the cold spike.
  frame('cold-first', () => {
    lo[value] = 440
    hi[value] = 560
  })
  // Sustained drag: slide a fixed-width window across the whole domain.
  for (let i = 0; i < 200; i++) {
    const c = 100 + (i / 200) * 800
    frame('drag', () => {
      lo[value] = c - 50
      hi[value] = c + 50
    })
  }
  // Window-collapse: snap hi toward lo and back out — re-walk churn.
  for (let i = 0; i < 39; i++) {
    frame('collapse', () => {
      lo[value] = 500
      hi[value] = 500 + (i % 2 ? 2 : 400)
    })
  }

  const sorted = [...frames].sort((a, b) => a - b)
  const p50 = median(frames)
  const p95 = pct(sorted, 95)
  const p99 = pct(sorted, 99)
  const mx = sorted[sorted.length - 1]
  let wi = 0
  for (let i = 1; i < frames.length; i++) if (frames[i] > frames[wi]) wi = i
  const viol16 = frames.filter(f => f > 16).length
  const viol33 = frames.filter(f => f > 33).length

  // Attribution by phase — honest for a v1 synthetic tail: the worst frame's
  // phase points at the dominant operator/verb that owned it.
  const attrib =
    phases[wi] === 'cold-first'
      ? { op: 'between', verb: '_resort', note: 'cold sort-index build, first brush' }
      : phases[wi] === 'collapse'
      ? { op: 'between', verb: 'XU0', note: 'window-collapse re-walk' }
      : { op: 'za', verb: 'window', note: 'windowed top-K churn' }

  const r3 = x => +x.toFixed(3)
  record({
    id: 'tail/crossfilter-brush',
    harness: 'H4',
    op: 'between→za(100)→length',
    case: 'brush-240',
    kind: 'timing',
    dir: 'down', // lower is better
    unit: 'ms',
    value: r3(p99), // headline = p99
    dims: { N, frames: frames.length, synthetic: true, budget: 16 },
    stats: { p50: r3(p50), p95: r3(p95), p99: r3(p99), max: r3(mx) },
    viol16,
    viol33,
    frames: frames.map(r3),
    worst: { ms: r3(frames[wi]), at: wi, phase: phases[wi], ...attrib },
  })
}

console.log(`[run-report] sweeping (gc=${!!globalThis.gc})…`)
backfillOperators()
h4BrushTail()
// Sampling provenance the collator can't otherwise know (was GC forced?).
writeFileSync(
  join(resultsDir, '_meta.json'),
  JSON.stringify({ gc: !!globalThis.gc, node: process.version, ts: Date.now() }),
)
console.log(`[run-report] done — rows written under ${resultsDir}`)
