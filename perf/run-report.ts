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
import { benchMeasure as measure, median } from './measure.ts'
import * as WL from './workloads.ts'
import { record, resultsDir } from './record.ts'

const pct = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]

// ---------------------------------------------------------------------------
// Backfill — the "ops" harness: every operator's gate workload, re-measured.
// EVERY operator now lives in perf/workloads.ts (Mode A): the report measures
// the SAME setup/single/batch closures the gate *.perf.ts asserts on, with
// report rigor (benchMeasure: warmup + gc), so no report row is a number no
// gate asserted. The old parallel {v,g,w} uniform sweep was retired once the
// last operator (reduce) migrated. The report nests rows harness → op → case.
// ---------------------------------------------------------------------------
function backfillOperators() {
  const r4 = x => +x.toFixed(4)
  const emit = (op, kase, ms, dims) => record({
    id: `${op}/${kase}@N=${dims.N}`, harness: 'ops', group: op, op, case: kase,
    kind: 'timing', dir: 'down', unit: 'ms', value: r4(ms), dims, stats: { median: r4(ms) },
  })
  let n = 0
  for (const [name, spec] of Object.entries(WL)) {
    try {
      for (const [kase, w] of Object.entries(spec.workloads())) {
        emit(spec.label ?? name, kase, measure(w.run, w.reps), { N: spec.N, ...(w.batch ? { batch: w.batch } : {}) })
        n++
      }
    } catch (e) {
      console.log(`[backfill] ${spec.label ?? name} (workload) skipped: ${e.message}`)
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

// ---------------------------------------------------------------------------
// H1 — complexity / scaling: the DETERMINISTIC op-count per single insert.
// The timing rows above are sub-ms over 10k and can't tell an O(1) incremental
// delta from an O(N) rebuild (both finish instantly). This instrument counts
// projector / fold / key-fn invocations after ONE insert — a machine-
// independent, jitter-proof measure of how many rows the delta actually
// touched. It pairs each operator's incremental path (≈1 op) against the naive
// path (≈N ops) so the report shows the algorithmic guarantee, not just a
// wall-clock that happens to be fast today. dir:down (fewer ops is better);
// kind:count (the report bands any drift as real, no run-noise clamp).
// ---------------------------------------------------------------------------
function h1Complexity() {
  const N = 5000
  const emit = (op, kase, count, note) => record({
    id: `${op}/${kase}@N=${N}`, harness: 'H1', group: op, op, case: kase,
    kind: 'count', dir: 'down', unit: 'ops', value: count,
    dims: { N }, stats: { count }, instrument: { readsPerInsert: count, 'reads/N': +(count / N).toFixed(4) }, note,
  })
  const obj = build => { const o = {}; for (let i = 0; i < N; i++) o[i] = build(i); return o }
  // aggregate: object insert is O(1) (BI0 projects one row); array insert is the
  // O(N) XU0 rebuild (P7 — positions shift, no sound incremental path).
  {
    let c = 0; const s = $(obj(i => ({ active: true, val: i }))); const a = s.some(r => { c++; return r.active }); a[value]; c = 0
    s.insert({ active: true, val: N }); emit('aggregate', 'object-insert', c, 'O(1) incremental BI0')
  }
  {
    let c = 0; const arr = []; for (let i = 0; i < N; i++) arr.push({ active: true, val: i }); const s = $(arr)
    const a = s.some(r => { c++; return r.active }); a[value]; c = 0
    s.insert({ active: true, val: N }); emit('aggregate', 'array-insert', c, 'O(N) XU0 rebuild (P7)')
  }
  // reduce: incremental form add()s once; the general fold re-folds all N.
  {
    let c = 0; const s = $(obj(i => ({ val: i }))); const a = s.reduce((acc, r) => { c++; return acc + r.val }, (acc, r) => acc - r.val, 0); a[value]; c = 0
    s.insert({ val: N }); emit('reduce', 'inc-insert', c, 'O(1) incremental add()')
  }
  {
    let c = 0; const s = $(obj(i => ({ val: i }))); const a = s.reduce((acc, r) => { c++; return acc + r.val }, 0); a[value]; c = 0
    s.insert({ val: N }); emit('reduce', 'full-insert', c, 'O(N) general re-fold')
  }
  // length(fn): one rebucket key-fn call per inserted row.
  {
    let c = 0; const s = $(obj(i => ({ bucket: i % 100 }))); const l = s.length(d => { c++; return d.bucket }); l[value]; c = 0
    s.insert({ bucket: 7 }); emit('length(fn)', 'rebucket-insert', c, 'O(1) one rebucket')
  }
  console.log('[h1] 5 complexity-count rows')
}

console.log(`[run-report] sweeping (gc=${!!globalThis.gc})…`)
backfillOperators()
h1Complexity()
h4BrushTail()
// Sampling provenance the collator can't otherwise know (was GC forced?).
writeFileSync(
  join(resultsDir, '_meta.json'),
  JSON.stringify({ gc: !!globalThis.gc, node: process.version, ts: Date.now() }),
)
console.log(`[run-report] done — rows written under ${resultsDir}`)
