// @ts-nocheck
// Synthetic perf test mimicking the multidim/crossfilter hot path:
//   source (N rows) → between(dim) → intersect(dims, exceptDim) → length(group)
// repeated for 4 dimensions. Brushing one `between` extent triggers a
// cascade through the 3 sibling intersects (the 4th's intersect excludes
// this dim) and on into 4 length(group) operators.
//
// Compares two pipelines on the same workload:
//   A. Baseline: existing intersect → length, two operators.
//   B. Fused:    experimental intersectLength operator (one operator).

import { test } from 'node:test'
import { ok } from 'node:assert'
import { $, value } from '../../full.ts' // also registers operator dispatch
import { intersectLength } from './intersect-length-fused.ts'

const REPS = 7
const measure = (fn, reps = REPS) => {
  const times = []
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now(); fn(); times.push(performance.now() - t0)
  }
  times.sort((a, b) => a - b)
  return {
    median: times[Math.floor(times.length / 2)],
    min: times[0],
    max: times[times.length - 1],
  }
}

const N = 50_000

function makeRows() {
  // Deterministic synthetic flights-shaped data: 4 numeric dims with
  // overlapping distributions so brushes have meaningful boundary churn.
  const out = []
  for (let i = 0; i < N; i++) {
    out.push({
      delay: ((i * 9301 + 49297) % 233280) / 233280 * 200 - 50, // -50..150
      distance: ((i * 49297 + 9301) % 233280) / 233280 * 2000,  // 0..2000
      time: ((i * 7919 + 1) % 233280) / 233280 * 24,            // 0..24
      date: ((i * 6151 + 11) % 233280) / 233280 * 86400000 * 90, // 0..90 days
    })
  }
  return out
}

const byHour       = d => Math.floor(d.time)
const byTenMins    = d => Math.floor(d.delay / 10) * 10
const byFiftyMiles = d => Math.floor(d.distance / 50) * 50
const byDay        = d => Math.floor(d.date / 86400000) * 86400000

const DIMS = [
  { name: 'time',     col: 'time',     full: [0, 24],         group: byHour },
  { name: 'delay',    col: 'delay',    full: [-60, 150],      group: byTenMins },
  { name: 'distance', col: 'distance', full: [0, 2000],       group: byFiftyMiles },
  { name: 'date',     col: 'date',     full: [0, 86400000*90], group: byDay },
]

// Drive a sequence of brush ranges on dim `target`. Each step is a small
// shrink-then-expand pattern to force boundary churn in *both* directions.
function brushSequence(target) {
  const [lo, hi] = target.full
  const span = hi - lo
  const steps = []
  // 20 steps simulating a slow drag of the right-edge handle.
  for (let i = 0; i < 20; i++) {
    const r = hi - (i / 20) * (span * 0.6)
    steps.push([lo, r])
  }
  // 20 steps dragging back out
  for (let i = 0; i < 20; i++) {
    const r = (hi - (span * 0.6)) + (i / 20) * (span * 0.6)
    steps.push([lo, r])
  }
  return steps
}

const SINKS = [] // keep alive

function buildBaseline(rows) {
  const source = $(rows)
  const filters = $({ time: [], delay: [], distance: [], date: [] })
  const dims = {}
  for (const d of DIMS) dims[d.name] = source.between(d.col, filters[d.name])
  // 4 chart histograms — each excludes its own dim.
  const sinks = []
  for (const d of DIMS) {
    const h = source.intersect(dims, d.name).length(d.group)
    sinks.push(h.connect([])) // keep alive + observe
  }
  // Active count + top5 share `intersect(dims)` via dedup.
  sinks.push(source.intersect(dims).length().connect([]))
  SINKS.push(sinks)
  return { source, filters }
}

function buildFused(rows) {
  const source = $(rows)
  const filters = $({ time: [], delay: [], distance: [], date: [] })
  const dims = {}
  for (const d of DIMS) dims[d.name] = source.between(d.col, filters[d.name])
  const sinks = []
  for (const d of DIMS) {
    const h = intersectLength(source, dims, d.name, d.group)
    sinks.push(h.connect([]))
  }
  // Match the baseline's active count too (reuse existing chain — the
  // intersect+length fusion is for histograms, not the scalar count).
  sinks.push(source.intersect(dims).length().connect([]))
  SINKS.push(sinks)
  return { source, filters }
}

function brushAll(filters, target) {
  const seq = brushSequence(target)
  for (const range of seq) {
    filters[target.name] = range
  }
}

// SETUP cost
test('multidim shape — setup baseline', () => {
  const rows = makeRows()
  const r = measure(() => buildBaseline(rows))
  console.log(`  baseline setup ${N} rows × 4 dims: median=${r.median.toFixed(2)}ms min=${r.min.toFixed(2)} max=${r.max.toFixed(2)}`)
  ok(r.median < 5000)
})

test('multidim shape — setup fused', () => {
  const rows = makeRows()
  const r = measure(() => buildFused(rows))
  console.log(`  fused    setup ${N} rows × 4 dims: median=${r.median.toFixed(2)}ms min=${r.min.toFixed(2)} max=${r.max.toFixed(2)}`)
  ok(r.median < 5000)
})

// BRUSH cost — the hot path.
for (const target of DIMS) {
  test(`multidim shape — brush ${target.name} baseline`, () => {
    const rows = makeRows()
    const { filters } = buildBaseline(rows)
    // Warm-up brush to settle filter / index state
    filters[target.name] = [target.full[0], target.full[1] * 0.7]
    filters[target.name] = target.full

    const r = measure(() => brushAll(filters, target))
    console.log(`  baseline brush ${target.name.padEnd(8)} (40 steps): median=${r.median.toFixed(2)}ms min=${r.min.toFixed(2)} max=${r.max.toFixed(2)}`)
    ok(r.median < 5000)
  })

  test(`multidim shape — brush ${target.name} fused`, () => {
    const rows = makeRows()
    const { filters } = buildFused(rows)
    filters[target.name] = [target.full[0], target.full[1] * 0.7]
    filters[target.name] = target.full

    const r = measure(() => brushAll(filters, target))
    console.log(`  fused    brush ${target.name.padEnd(8)} (40 steps): median=${r.median.toFixed(2)}ms min=${r.min.toFixed(2)} max=${r.max.toFixed(2)}`)
    ok(r.median < 5000)
  })
}
