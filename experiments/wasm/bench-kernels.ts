// Layer 1 microbenchmark — does WASM beat a tight JS loop, and at what N?
//
// Three kernels (max, between, bitmask-and) × five N values × five modes:
//
//   js-naive       — JS over an array of objects (the shape the lib actually
//                    holds: `arr[i].col`). Includes property-access cost.
//   js-typed       — JS over a pre-built Float64Array / Uint32Array. The
//                    ceiling JS can reach with already-columnar data.
//   wasm-warm      — data already in wasm linear memory; just call the export.
//   wasm-load      — copy a pre-built typed array into wasm memory, then call.
//   wasm-extract   — extract column from object array directly into wasm
//                    memory (one element-wise loop), then call. THIS is the
//                    actually-realistic mode for the library: rows live as
//                    JS objects, so any WASM strategy has to extract per call.
//
// Reported metric: median ns/element across 9 timed runs (after 3 warmup
// runs). For small N where one call is too short to time accurately, we
// inflate INNER (calls per measurement) until each measurement spans ≥1ms.

import { loadKernels } from './loader.ts'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const SIZES = [100, 1_000, 10_000, 100_000, 1_000_000] as const
const WARMUP = 3
const REPS = 9

const k = loadKernels()
// Reserve enough memory for our largest case.
//   max:     8 * 1M = 8MB src
//   between: 8 * 1M src + 4 * 1M idx = 12MB
//   bitmask: 4 * (1M/32) * 2 = 256KB
// Plus offsets + slack → 24MB.
k.ensureBytes(24 * 1024 * 1024)

type Measurement = { mode: string, kernel: string, n: number, nsPerElem: number, totalMs: number, inner: number }

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b)
  return s[s.length >> 1]
}

// Adaptive timing: pick INNER such that one measurement ~1-3ms. Returns
// (median time across REPS measurements) / inner / n in ns/elem.
function bench(label: string, kernel: string, n: number, fn: () => void): Measurement {
  // Calibrate inner count. Start at 1; double until ≥1ms.
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
  const med = median(samples)
  return { mode: label, kernel, n, totalMs: med, inner, nsPerElem: (med * 1e6) / (inner * n) }
}

// LCG for reproducible inputs (mirrors workload.ts style).
function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x1_0000_0000
  }
}

// === Build inputs of every size up-front, so bench loops don't pay setup ===

interface Inputs {
  n: number
  // For max/between
  objs: Array<{ id: number, val: number }>            // shape the lib has
  typed: Float64Array                                   // ceiling JS path
  lo: number; hi: number                                // range bounds for between
  // For bitmask
  bitsLen: number                                       // u32 word count
  aBits: Uint32Array
  bBits: Uint32Array
}

function buildInputs(n: number): Inputs {
  const rand = lcg(42 + n)
  const objs = new Array<{ id: number, val: number }>(n)
  const typed = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    // values in [0, 100)
    const v = rand() * 100
    objs[i] = { id: i, val: v }
    typed[i] = v
  }
  const bitsLen = Math.ceil(n / 32)
  const aBits = new Uint32Array(bitsLen)
  const bBits = new Uint32Array(bitsLen)
  for (let i = 0; i < bitsLen; i++) {
    aBits[i] = (rand() * 0x1_0000_0000) >>> 0
    bBits[i] = (rand() * 0x1_0000_0000) >>> 0
  }
  return { n, objs, typed, lo: 30, hi: 70, bitsLen, aBits, bBits }
}

// === JS reference implementations ===

function js_max_naive(objs: Array<{ val: number }>): number {
  let m = -Infinity
  for (let i = 0; i < objs.length; i++) {
    const v = objs[i].val
    if (v > m) m = v
  }
  return m
}

function js_max_typed(arr: Float64Array): number {
  let m = -Infinity
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]
    if (v > m) m = v
  }
  return m
}

function js_between_naive(objs: Array<{ val: number }>, lo: number, hi: number, out: Uint32Array): number {
  let k = 0
  for (let i = 0; i < objs.length; i++) {
    const v = objs[i].val
    if (v >= lo && v <= hi) out[k++] = i
  }
  return k
}

function js_between_typed(arr: Float64Array, lo: number, hi: number, out: Uint32Array): number {
  let k = 0
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]
    if (v >= lo && v <= hi) out[k++] = i
  }
  return k
}

function popcnt32(x: number): number {
  x = x - ((x >>> 1) & 0x55555555)
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  x = (x + (x >>> 4)) & 0x0f0f0f0f
  return (Math.imul(x, 0x01010101) >>> 24)
}

function js_bitmask_and(a: Uint32Array, b: Uint32Array): number {
  let count = 0
  const len = a.length
  for (let i = 0; i < len; i++) count += popcnt32(a[i] & b[i])
  return count
}

// === Bench ===

const results: Measurement[] = []

for (const n of SIZES) {
  const inp = buildInputs(n)

  // ---- max ----
  results.push(bench('js-naive', 'max', n, () => { js_max_naive(inp.objs) }))
  results.push(bench('js-typed', 'max', n, () => { js_max_typed(inp.typed) }))
  // wasm-warm: load typed once into wasm memory at offset 0
  k.ensureBytes(n * 8)
  k.f64View().set(inp.typed, 0)
  results.push(bench('wasm-warm', 'max', n, () => { k.max_f64(0, n) }))
  // wasm-load: copy a pre-built typed array on each call
  results.push(bench('wasm-load', 'max', n, () => {
    k.f64View().set(inp.typed, 0)
    k.max_f64(0, n)
  }))
  // wasm-extract: extract column from objects directly into wasm memory
  results.push(bench('wasm-extract', 'max', n, () => {
    const view = k.f64View()
    for (let i = 0; i < inp.objs.length; i++) view[i] = inp.objs[i].val
    k.max_f64(0, n)
  }))

  // ---- between ----
  // Layout: src at offset 0 (n*8 bytes), out indices at offset n*8 (n*4 bytes).
  k.ensureBytes(n * 8 + n * 4)
  k.f64View().set(inp.typed, 0)
  const outU32 = new Uint32Array(n)
  results.push(bench('js-naive', 'between', n, () => { js_between_naive(inp.objs, inp.lo, inp.hi, outU32) }))
  results.push(bench('js-typed', 'between', n, () => { js_between_typed(inp.typed, inp.lo, inp.hi, outU32) }))
  // wasm-warm: src already in memory at 0; out at byteOffset (n*8)
  results.push(bench('wasm-warm', 'between', n, () => { k.between_f64(0, n, inp.lo, inp.hi, n * 8) }))
  results.push(bench('wasm-load', 'between', n, () => {
    k.f64View().set(inp.typed, 0)
    k.between_f64(0, n, inp.lo, inp.hi, n * 8)
  }))
  results.push(bench('wasm-extract', 'between', n, () => {
    const view = k.f64View()
    for (let i = 0; i < inp.objs.length; i++) view[i] = inp.objs[i].val
    k.between_f64(0, n, inp.lo, inp.hi, n * 8)
  }))

  // ---- bitmask ----
  // Layout: a at 0 (bitsLen*4 bytes), b at bitsLen*4 bytes.
  const bytesA = inp.bitsLen * 4
  k.ensureBytes(bytesA * 2)
  k.u32View().set(inp.aBits, 0)
  k.u32View().set(inp.bBits, inp.bitsLen)
  // For bitmask the "n" we report is bits, not words. ns/elem is per-bit cost.
  results.push(bench('js-naive', 'bitmask', n, () => { js_bitmask_and(inp.aBits, inp.bBits) }))
  results.push(bench('js-typed', 'bitmask', n, () => { js_bitmask_and(inp.aBits, inp.bBits) }))
  results.push(bench('wasm-warm', 'bitmask', n, () => { k.bitmask_and(0, bytesA, inp.bitsLen) }))
  results.push(bench('wasm-load', 'bitmask', n, () => {
    k.u32View().set(inp.aBits, 0)
    k.u32View().set(inp.bBits, inp.bitsLen)
    k.bitmask_and(0, bytesA, inp.bitsLen)
  }))
  // For bitmask, "extract" doesn't apply — bitsets are already typed; the
  // realistic cost is just `set()`-into-wasm, which is wasm-load.
  results.push(bench('wasm-extract', 'bitmask', n, () => {
    k.u32View().set(inp.aBits, 0)
    k.u32View().set(inp.bBits, inp.bitsLen)
    k.bitmask_and(0, bytesA, inp.bitsLen)
  }))
}

// === Render ===

const fmt = (n: number) => n < 10 ? n.toFixed(2) : n < 1000 ? n.toFixed(1) : n.toFixed(0)

const lines: string[] = []
const writeLine = (s: string) => { lines.push(s); console.log(s) }

writeLine(`# Layer 1 — kernel microbench (node ${process.version})`)
writeLine('')
writeLine(`Generated by \`experiments/wasm/bench-kernels.ts\`. Median of ${REPS} runs after ${WARMUP} warmups; inner-loop count auto-calibrated to ≥1ms per measurement.`)
writeLine('')
writeLine(`Metric: ns per element. Lower is better. WASM "wins" only when it beats \`js-typed\` (the ceiling JS can reach with already-columnar data).`)
writeLine('')

const kernels = ['max', 'between', 'bitmask']
const modes = ['js-naive', 'js-typed', 'wasm-warm', 'wasm-load', 'wasm-extract']

for (const kernel of kernels) {
  writeLine(`## ${kernel}`)
  writeLine('')
  writeLine('| N | ' + modes.join(' | ') + ' |')
  writeLine('|---:|' + modes.map(() => '---:').join('|') + '|')
  for (const n of SIZES) {
    const row = [n.toLocaleString()]
    for (const mode of modes) {
      const r = results.find(x => x.kernel === kernel && x.mode === mode && x.n === n)!
      row.push(fmt(r.nsPerElem))
    }
    writeLine('| ' + row.join(' | ') + ' |')
  }
  writeLine('')
  // Crossover: realistic mode (wasm-extract) vs realistic JS path (js-naive,
  // since the lib's data lives as objects, not typed arrays).
  const cross = SIZES.find(n => {
    const we = results.find(x => x.kernel === kernel && x.mode === 'wasm-extract' && x.n === n)!
    const jn = results.find(x => x.kernel === kernel && x.mode === 'js-naive' && x.n === n)!
    return we.nsPerElem < jn.nsPerElem
  })
  writeLine(`Crossover (realistic): \`wasm-extract\` first beats \`js-naive\` at N = **${cross ?? 'never (in range)'}**. The realistic comparison is "extract+call wasm" vs "loop over JS objects" — the actually-deployable swap.`)
  writeLine('')
}

// Boundary cost — wasm-warm vs wasm-load gives the per-call data-marshalling overhead.
// Express as fixed µs added per call.
writeLine('## Boundary cost')
writeLine('')
writeLine('The gap between `wasm-warm` and `wasm-load` is the cost of mirroring a typed array into wasm memory each call. Useful to know because every realistic integration in this library has to pay it.')
writeLine('')
writeLine('| Kernel | N | wasm-warm (µs/call) | wasm-load (µs/call) | Δ marshalling (µs/call) |')
writeLine('|---|---:|---:|---:|---:|')
for (const kernel of kernels) {
  for (const n of SIZES) {
    const ww = results.find(x => x.kernel === kernel && x.mode === 'wasm-warm' && x.n === n)!
    const wl = results.find(x => x.kernel === kernel && x.mode === 'wasm-load' && x.n === n)!
    const wwUs = (ww.totalMs * 1000) / ww.inner
    const wlUs = (wl.totalMs * 1000) / wl.inner
    writeLine(`| ${kernel} | ${n.toLocaleString()} | ${fmt(wwUs)} | ${fmt(wlUs)} | ${fmt(wlUs - wwUs)} |`)
  }
}
writeLine('')

// Save to disk too.
const outPath = resolve(dirname(fileURLToPath(import.meta.url)), 'results-kernels.md')
writeFileSync(outPath, lines.join('\n'))
console.log(`\n[written: ${outPath}]`)
