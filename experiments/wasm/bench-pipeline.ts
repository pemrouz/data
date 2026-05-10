// Layer 2 pipeline benchmark — does the kernel-level WASM win translate to
// a real reactive pipeline?
//
// Workload: 50 000 rows × 1 000 ticks of single-row updates × `.max('val')`.
// Each tick mutates one row's `val`; the max view re-publishes via either:
//   (a) the existing JS path: O(n) scan over Object.values(tracked)
//   (b) the WASM path: f64 write into wasm memory + WASM max_f64 over the slice.
//
// Both paths see identical mutations and produce identical max values
// (verified at end). The relevant metric is total elapsed time for the 1000
// ticks; setup time is reported but excluded from the headline number.

import '../../full.ts'   // registers operator dispatch on $
import { $, value } from '../../full.ts'
import { loadKernels } from './loader.ts'
import { wasmMax, typedMax } from './operators/aggregate-wasm.ts'

// --- Workload (mirrors comparisons/bench/workload.ts in style) ---

function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x1_0000_0000
  }
}

const N_DEFAULT = 50_000
const TICKS = 1000
const ROW_SEED = 42
const TICK_SEED = 7
const N = Number(process.env.BENCH_N || N_DEFAULT)

type Row = { id: number, val: number }
function makeRows(n: number): Row[] {
  const rand = lcg(ROW_SEED)
  const out: Row[] = new Array(n)
  for (let i = 0; i < n; i++) out[i] = { id: i, val: rand() * 100 }
  return out
}
type Tick = { idx: number, newVal: number }
function makeTicks(count: number, n: number): Tick[] {
  const rand = lcg(TICK_SEED)
  const out: Tick[] = new Array(count)
  for (let i = 0; i < count; i++) out[i] = { idx: Math.floor(rand() * n), newVal: rand() * 100 }
  return out
}

const TICKS_LIST = makeTicks(TICKS, N)

// --- Run one path ---

interface Run { setup: number, total: number, perTick: number, finalMax: number }

function runJs(): Run {
  const rows = makeRows(N)
  const t0 = performance.now()
  const data = $(rows)
  const m = data.max('val')
  // Force settle so XU0 fan-out runs.
  let lastVal = m[value]
  // Connect a sink so each publish event is observed (mirrors a UI binding).
  const sink: any[] = []
  m.connect(sink)
  const tSetup = performance.now() - t0

  const t1 = performance.now()
  for (let i = 0; i < TICKS_LIST.length; i++) {
    const t = TICKS_LIST[i]
    data[t.idx].val = t.newVal
  }
  const tTotal = performance.now() - t1
  lastVal = m[value]
  return { setup: tSetup, total: tTotal, perTick: tTotal / TICKS, finalMax: lastVal }
}

function runWith(makeOp: (data: any) => any): Run {
  const rows = makeRows(N)
  const t0 = performance.now()
  const data = $(rows)
  const m = makeOp(data)
  let lastVal = m[value]
  const sink: any[] = []
  m.connect(sink)
  const tSetup = performance.now() - t0

  const t1 = performance.now()
  for (let i = 0; i < TICKS_LIST.length; i++) {
    const t = TICKS_LIST[i]
    data[t.idx].val = t.newVal
  }
  const tTotal = performance.now() - t1
  lastVal = m[value]
  return { setup: tSetup, total: tTotal, perTick: tTotal / TICKS, finalMax: lastVal }
}

// --- Median of N runs ---

const REPS = 5
const WARMUP = 1

function median(arr: number[]) { const s = [...arr].sort((a, b) => a - b); return s[s.length >> 1] }

const k = loadKernels()
// Warm the wasm side once with a no-op call.
k.ensureBytes(8 * Math.max(N, 65536))

console.log(`# Layer 2 — pipeline bench: max('val') over ${N.toLocaleString()} rows × ${TICKS} ticks`)
console.log(`# node ${process.version}`)
console.log()

const paths = [
  // Current `MaxValue` maintains a parallel `Float64Array` indexed by a
  // `key→slot` map and scans contiguous f64 memory in `_publish`. Falls back
  // to `Map.values()` iteration when any non-numeric value arrives. See
  // experiments/wasm/README.md for the journey from `Object.values` (12-19×
  // slower) and `Map.values()` (3-6× slower).
  { label: 'JS aggregate (current — Float64Array + Map fallback)', make: (data: any) => data.max('val') },
  { label: 'JS-typed aggregate (experiment, packed Float64Array, JS scan)', make: (data: any) => typedMax(k)(data, 'val') },
  { label: 'WASM aggregate (experiment, packed Float64Array, wasm kernel)', make: (data: any) => wasmMax(k)(data, 'val') },
] as const

for (let w = 0; w < WARMUP; w++) for (const p of paths) runWith(p.make)

const allRuns = paths.map(p => ({ label: p.label, runs: [] as Run[] }))
for (let r = 0; r < REPS; r++) {
  for (let i = 0; i < paths.length; i++) allRuns[i].runs.push(runWith(paths[i].make))
}

const meds = allRuns.map(r => ({
  label: r.label,
  setup: median(r.runs.map(x => x.setup)),
  total: median(r.runs.map(x => x.total)),
  finalMax: r.runs[0].finalMax,
  raw: r.runs.map(x => x.total),
}))

// Correctness: all three paths must produce the same max.
const refMax = meds[0].finalMax
const correctness = meds.every(m => m.finalMax === refMax)
  ? 'all paths produced identical max ✓'
  : 'MISMATCH: ' + meds.map(m => `${m.label}=${m.finalMax}`).join(', ')

console.log(`| Path | Setup (ms) | Total ${TICKS} ticks (ms) | Per tick (µs) | vs JS |`)
console.log('|---|---:|---:|---:|---:|')
const jsMedTotal = meds[0].total
for (const m of meds) {
  const speedup = jsMedTotal / m.total
  console.log(`| ${m.label} | ${m.setup.toFixed(1)} | ${m.total.toFixed(1)} | ${(m.total * 1000 / TICKS).toFixed(1)} | ${speedup.toFixed(2)}× |`)
}
console.log()
console.log(`Correctness: ${correctness}`)
console.log()
for (const m of meds) console.log(`  ${m.label.padEnd(60)}  raw: [${m.raw.map(x => x.toFixed(1)).join(', ')}] ms`)

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const outPath = resolve(dirname(fileURLToPath(import.meta.url)), 'results-pipeline.md')
const lines = [
  `# Layer 2 — pipeline bench: \`max('val')\` over ${N.toLocaleString()} rows × ${TICKS} ticks`,
  '',
  `Generated by \`experiments/wasm/bench-pipeline.ts\`. Median of ${REPS} runs after ${WARMUP} warmup. All paths see identical row mutations.`,
  '',
  `| Path | Setup (ms) | Total ${TICKS} ticks (ms) | Per tick (µs) | vs JS |`,
  '|---|---:|---:|---:|---:|',
  ...meds.map(m => `| ${m.label} | ${m.setup.toFixed(1)} | ${m.total.toFixed(1)} | ${(m.total * 1000 / TICKS).toFixed(1)} | ${(jsMedTotal / m.total).toFixed(2)}× |`),
  '',
  `**Correctness:** ${correctness}`,
  '',
  `**Raw per-run totals (ms):**`,
  ...meds.map(m => `- ${m.label}: [${m.raw.map(x => x.toFixed(1)).join(', ')}]`),
]
writeFileSync(outPath, lines.join('\n'))
console.log(`\n[written: ${outPath}]`)
