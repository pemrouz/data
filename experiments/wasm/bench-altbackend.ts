// Alt-backend bench — does a columnar-in-WASM backend with serializable
// predicates ("filter('col','val')" rather than "filter(fn)") beat
//   (a) the lib operating on JS row objects with its own serializable-arg
//       operators ("src.between('spread',[T,Inf]).{length(),max('spread')}"),
//       and
//   (b) the same algorithm written in JS over typed-array columns?
//
// Workload mirrors comparisons/bench/workload.ts shape: trades with bid/ask,
// derive spread = ask - bid, filter spread >= THRESHOLD, observe count and
// max(spread). 1000 single-row ticks, each settling.
//
// Three paths exercised, all reading both `count` and `max`:
//   lib            — the existing library, serializable-args chain over rows-as-object.
//   js-columnar    — hand-rolled columnar in Float64Array, JS scan/update.
//   wasm-columnar  — same data layout living in WASM linear memory; bulk ops
//                    dispatch to wasm kernels (filter_gt_f64, max_masked_f64);
//                    incremental ticks stay in JS (single typed-array write is
//                    cheaper than a wasm crossing for an O(1) op).
//
// Four scenarios:
//   setup           — build the chain / backend for N rows.
//   tick            — single row update, settle both views.
//   batch           — 1000 ticks, final read.
//   threshold-change — rebuild mask + scalars after a bounds shift (the
//                      "bulk re-eval" path that lets WASM amortize).

import '../../full.ts'  // registers operator dispatch on $
import { $, value } from '../../full.ts'
import { loadKernels } from './loader.ts'
import { ColumnarJsBackend, ColumnarWasmBackend, type AltBackend } from './alt-backend/columnar.ts'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// --- Workload ---

function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x1_0000_0000
  }
}

const SIZES = [10_000, 100_000] as const
const TICKS = 1000
const THRESHOLD = 1.0
const NEW_THRESHOLD = 0.7  // shifts ~10% more rows into the qualifying set
const ROW_SEED = 42
const TICK_SEED = 7

interface Row { id: number, bid: number, ask: number, spread: number }
function makeRows(n: number): Row[] {
  const rand = lcg(ROW_SEED)
  const out: Row[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const bid = 50 + rand() * 50
    const ask = bid + rand() * 2
    out[i] = { id: i, bid, ask, spread: ask - bid }
  }
  return out
}

interface Tick { idx: number, field: 'bid' | 'ask', newValue: number }
function makeTicks(count: number, n: number): Tick[] {
  const rand = lcg(TICK_SEED)
  const out: Tick[] = new Array(count)
  for (let i = 0; i < count; i++) {
    out[i] = {
      idx: Math.floor(rand() * n),
      field: rand() < 0.5 ? 'bid' : 'ask',
      newValue: 50 + rand() * 50,
    }
  }
  return out
}

// --- Path: lib over JS row objects with serializable args ---

class LibPath {
  src: any; filt: any; cnt: any; mx: any
  rows: Row[]
  threshold: number
  setup(rows: Row[], threshold: number) {
    this.rows = rows
    this.threshold = threshold
    const obj: Record<number, Row> = {}
    for (let i = 0; i < rows.length; i++) obj[i] = rows[i]
    this.src = $(obj)
    this.filt = this.src.between('spread', [threshold, Infinity])
    this.cnt = this.filt.length()
    this.mx = this.filt.max('spread')
    void this.cnt[value]; void this.mx[value]
  }
  tick(idx: number, field: 'bid' | 'ask', val: number) {
    const r = this.src[idx]
    r[field] = val
    // Consumer updates the spread column (same as columnar backends do).
    if (field === 'bid') r.spread = r.ask - val
    else r.spread = val - r.bid
  }
  read() { return { count: this.cnt[value], max: this.mx[value] } }
  setThreshold(t: number) {
    this.threshold = t
    // `between` with literal bounds captures them at creation — the way to
    // "change threshold" is to rebuild the chain. (The reactive-bounds form
    // exists for ViewProxy args; we keep the literal-args form because that's
    // what's actually serializable.)
    this.filt = this.src.between('spread', [t, Infinity])
    this.cnt = this.filt.length()
    this.mx = this.filt.max('spread')
    void this.cnt[value]; void this.mx[value]
  }
}

// --- Timing helpers ---

const REPS = 5
const WARMUP = 1
function median(arr: number[]) { const s = [...arr].sort((a, b) => a - b); return s[s.length >> 1] }

// For a one-shot measurement that may be sub-microsecond, inflate INNER calls
// until each measurement spans ≥1ms. Returns median of REPS measurements as
// the per-call time in µs.
function timeRepeated(label: string, fn: () => void): number {
  let inner = 1
  while (true) {
    const t0 = performance.now()
    for (let i = 0; i < inner; i++) fn()
    const t = performance.now() - t0
    if (t >= 1 || inner >= 1_000_000) break
    inner = Math.max(2, Math.floor(inner * (2 / Math.max(t, 0.05))))
  }
  for (let w = 0; w < WARMUP; w++) for (let i = 0; i < inner; i++) fn()
  const samples: number[] = []
  for (let r = 0; r < REPS; r++) {
    const t0 = performance.now()
    for (let i = 0; i < inner; i++) fn()
    samples.push(performance.now() - t0)
  }
  return (median(samples) * 1000) / inner   // µs
}

// One-shot timing (build the whole world, time once, throw away). For setup
// and batch where each measurement is expensive and we want REPS independent
// trials. Returns median in ms.
function timeOnce(makeAndRun: () => number): number {
  const samples: number[] = []
  for (let w = 0; w < WARMUP; w++) makeAndRun()
  for (let r = 0; r < REPS; r++) samples.push(makeAndRun())
  return median(samples)
}

// --- Build per-path scenario runners ---

type Path = 'lib' | 'js-columnar' | 'wasm-columnar'
type Scenario = 'setup' | 'tick' | 'batch' | 'threshold-change'

function makeBackend(path: Path, kernels: ReturnType<typeof loadKernels>): AltBackend | LibPath {
  if (path === 'lib') return new LibPath()
  if (path === 'js-columnar') return new ColumnarJsBackend()
  return new ColumnarWasmBackend(kernels)
}

function readBoth(b: AltBackend | LibPath): { count: number, max: number } {
  if (b instanceof LibPath) return b.read()
  return { count: b.getCount(), max: b.getMax() }
}

function runScenario(path: Path, scenario: Scenario, n: number, ticks: Tick[]): number {
  // Each path needs its own kernel instance to avoid wasm-memory aliasing
  // between successive wasm-columnar runs. `freshRows()` is critical for the
  // lib path: it mutates row objects in place, so reps would otherwise carry
  // state across iterations and inflate variance ~100×.
  const kernels = loadKernels()
  kernels.ensureBytes(n * 32 + 65536)  // headroom for 4 cols + mask + slack
  const freshRows = () => makeRows(n)

  if (scenario === 'setup') {
    return timeOnce(() => {
      const rows = freshRows()
      const b = makeBackend(path, kernels)
      const t0 = performance.now()
      b.setup(rows, THRESHOLD)
      void readBoth(b)
      return performance.now() - t0
    })
  }

  if (scenario === 'tick') {
    const samples: number[] = []
    for (let w = 0; w < WARMUP; w++) {
      const b = makeBackend(path, kernels)
      b.setup(freshRows(), THRESHOLD)
      void readBoth(b)
      for (let i = 0; i < ticks.length; i++) {
        const t = ticks[i]; (b as any).tick(t.idx, t.field, t.newValue)
      }
      void readBoth(b)
    }
    for (let r = 0; r < REPS; r++) {
      const b = makeBackend(path, kernels)
      b.setup(freshRows(), THRESHOLD)
      void readBoth(b)
      const t0 = performance.now()
      for (let i = 0; i < ticks.length; i++) {
        const t = ticks[i]
        ;(b as any).tick(t.idx, t.field, t.newValue)
        void readBoth(b)
      }
      samples.push(performance.now() - t0)
    }
    return (median(samples) * 1000) / ticks.length   // µs/tick
  }

  if (scenario === 'batch') {
    return timeOnce(() => {
      const rows = freshRows()
      const b = makeBackend(path, kernels)
      b.setup(rows, THRESHOLD)
      void readBoth(b)
      const t0 = performance.now()
      for (let i = 0; i < ticks.length; i++) {
        const t = ticks[i]; (b as any).tick(t.idx, t.field, t.newValue)
      }
      void readBoth(b)
      return performance.now() - t0
    })
  }

  // threshold-change: built once, then time a single full re-eval.
  return timeOnce(() => {
    const rows = freshRows()
    const b = makeBackend(path, kernels)
    b.setup(rows, THRESHOLD)
    void readBoth(b)
    const t0 = performance.now()
    ;(b as any).setThreshold(NEW_THRESHOLD)
    void readBoth(b)
    return performance.now() - t0
  })
}

// --- Correctness check before benching ---

function correctness(n: number) {
  const kernels = loadKernels()
  kernels.ensureBytes(n * 32 + 65536)
  const rows = makeRows(n)
  const ticks = makeTicks(TICKS, n)
  const paths: Path[] = ['lib', 'js-columnar', 'wasm-columnar']
  const results = paths.map(p => {
    const b = makeBackend(p, kernels)
    b.setup(rows, THRESHOLD)
    for (const t of ticks) (b as any).tick(t.idx, t.field, t.newValue)
    return { path: p, ...readBoth(b) }
  })
  const ref = results[0]
  // Lib path stores ints losslessly in f64 — but the floating-point order of
  // ops differs, so allow a tiny tolerance on max comparison.
  const ok = results.every(r =>
    r.count === ref.count && Math.abs(r.max - ref.max) < 1e-9,
  )
  if (!ok) {
    console.error('Correctness MISMATCH:')
    for (const r of results) console.error('  ', r)
    process.exit(1)
  }
  console.log(`Correctness ✓ (N=${n.toLocaleString()}): count=${ref.count}, max=${ref.max.toFixed(6)}`)
}

// --- Main ---

console.log(`# Alt-backend bench: serializable predicates + columnar storage`)
console.log(`# node ${process.version}, N ∈ {${SIZES.map(n => n.toLocaleString()).join(', ')}}, ticks=${TICKS}, threshold=${THRESHOLD}\n`)

for (const n of SIZES) correctness(n)
console.log()

interface Row2 { n: number, scenario: Scenario, lib: number, jsColumnar: number, wasmColumnar: number }
const rows: Row2[] = []
const PATHS: Path[] = ['lib', 'js-columnar', 'wasm-columnar']
const SCENARIOS: Scenario[] = ['setup', 'tick', 'batch', 'threshold-change']

for (const n of SIZES) {
  const ticks = makeTicks(TICKS, n)
  for (const s of SCENARIOS) {
    const r: any = { n, scenario: s }
    for (const p of PATHS) {
      const v = runScenario(p, s, n, ticks)
      r[p === 'lib' ? 'lib' : p === 'js-columnar' ? 'jsColumnar' : 'wasmColumnar'] = v
      const unit = s === 'tick' ? 'µs/tick' : 'ms'
      console.log(`  N=${n.toLocaleString().padStart(8)}  ${s.padEnd(18)} ${p.padEnd(14)} ${v.toFixed(2)} ${unit}`)
    }
    rows.push(r)
  }
}

// --- Render ---

const lines: string[] = []
const writeLine = (s: string) => { lines.push(s); console.log(s) }

writeLine('')
writeLine(`# Alt-backend bench results (node ${process.version})`)
writeLine('')
writeLine(`Generated by \`experiments/wasm/bench-altbackend.ts\`. Median of ${REPS} runs after ${WARMUP} warmup.`)
writeLine('')
writeLine(`Workload: ${TICKS} single-row ticks on Trades-shaped rows. Filter \`spread >= ${THRESHOLD}\`. Observe \`count\` and \`max(spread)\`.`)
writeLine('')
writeLine(`Scenarios:`)
writeLine(`- **setup** — build chain/backend for N rows. Unit: ms.`)
writeLine(`- **tick** — one row mutation + read both outputs. Unit: µs/tick.`)
writeLine(`- **batch** — ${TICKS} ticks, read only at end. Unit: ms.`)
writeLine(`- **threshold-change** — bounds shift, full re-eval of mask + scalars. Unit: ms.`)
writeLine('')

for (const n of SIZES) {
  writeLine(`## N = ${n.toLocaleString()}`)
  writeLine('')
  writeLine(`| Scenario | unit | lib (serializable args, JS-object rows) | js-columnar (typed) | wasm-columnar | js-cl/lib | wasm/js-cl |`)
  writeLine(`|---|---|---:|---:|---:|---:|---:|`)
  for (const s of SCENARIOS) {
    const r = rows.find(x => x.n === n && x.scenario === s)!
    const unit = s === 'tick' ? 'µs/tick' : 'ms'
    const lib = r.lib, jsc = r.jsColumnar, wsc = r.wasmColumnar
    writeLine(`| ${s} | ${unit} | ${lib.toFixed(2)} | ${jsc.toFixed(2)} | ${wsc.toFixed(2)} | ${(lib / jsc).toFixed(2)}× | ${(jsc / wsc).toFixed(2)}× |`)
  }
  writeLine('')
}

writeLine(`The two ratio columns isolate where the wins come from: \`js-cl/lib\` is the cost the lib's row-object storage imposes vs columnar layout, holding the algorithm fixed (declarative everywhere); \`wasm/js-cl\` is WASM's marginal contribution over the same algorithm written in JS.`)
writeLine('')

const outPath = resolve(dirname(fileURLToPath(import.meta.url)), 'results-altbackend.md')
writeFileSync(outPath, lines.join('\n'))
console.log(`\n[written: ${outPath}]`)
