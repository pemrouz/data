// M2 gate: the two flagship interaction shapes — (a) the crossfilter BRUSH
// (between bounds sweep over 50k rows with a downstream count), (b) the
// swarm-style BATCH churn (100 whole-row writes per commit).
//
// HISTORY: born as a two-process A/B against the v2 engine (median ratio ≤
// 1.15×, one ENGINE per PROCESS to keep inline caches honest). The v2
// referent was RETIRED at the v4 root promotion (2026-08-03); the final
// recorded A/B on the dev machine was brush 1.11×, batch 0.76× of v2 —
// under the gate, absolute medians brush ≈ 0.49 ms/step, batch ≈ 0.085
// ms/commit. Single-process now (no A/B, no cross-pollution to avoid).
//
// What gates NOW: absolute ceilings, dev-machine-calibrated with ~5×
// headroom — brush ≤ 2.5 ms/step, batch ≤ 0.5 ms/commit. They absorb
// thermal/WSL variance but catch structural regressions (a lost incremental
// path turns a brush step O(N) and blows the ceiling immediately).
//
// Methodology kept: monotonic values (every write REAL), per-sample gc()
// (--expose-gc), median of rounds, deep warmup before any sample.
//
// Run: node --experimental-strip-types --no-warnings --expose-gc perf/m2-gate.ts

type Row = { region: string; val: number }
const N = 50_000
function mkObj(): Record<string, Row> {
  const o: Record<string, Row> = {}
  for (let i = 0; i < N; i++) o['k' + i] = { region: i % 2 ? 'north' : 'south', val: (i * 7919) % 100_000 }
  return o
}
function med(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[s.length >> 1]
}

declare const gc: (() => void) | undefined
const gcSync = typeof gc === 'function' ? gc : null

function measure(step: () => void, inner: number, rounds = 11): number {
  // Deep warmup: reach top JIT tier before any sample (a shallow warmup
  // under-measured by up to 2× in the A/B era; 10× inner reaches steady state).
  for (let i = 0; i < inner * 10; i++) step()
  const r: number[] = []
  for (let x = 0; x < rounds; x++) {
    if (gcSync) gcSync()
    const t0 = performance.now()
    for (let i = 0; i < inner; i++) step()
    r.push((performance.now() - t0) / inner)
  }
  return med(r)
}

const KEYS: string[] = []
for (let i = 0; i < N; i++) KEYS.push('k' + i)
let tick = 1
let sweep = 0

const { Runtime } = await import('../kernel/runtime.ts')
const { SourceNode } = await import('../kernel/node.ts')
const { length } = await import('../ops/aggregate.ts')
const { between } = await import('../ops/between.ts')
const { filter } = await import('../ops/rowops.ts')

// ── brush: between bounds sweep + downstream count ───────────────────────────
const brushMs = (() => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, mkObj())
  const range = between(src, 'val', [10_000, 60_000])
  const count = length(range)
  const ms = measure(() => {
    const lo = 10_000 + (sweep++ % 40) * 500
    range.setBounds([lo, lo + 50_000])
  }, 40)
  console.log(`brush  ${ms.toFixed(3)} ms/step   (count ${count.value()})`)
  return ms
})()

// ── batch: 100 whole-row writes per commit through a filter→count chain ──────
const batchMs = (() => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, mkObj())
  const count = length(filter(src, (r) => r.region === 'north'))
  const EMPTY: readonly (string | number)[] = []
  const ms = measure(() => {
    const base = (tick * 100) % N
    rt.batch(() => {
      for (let j = 0; j < 100; j++)
        src.write(KEYS[(base + j) % N], EMPTY, { region: (tick + j) % 3 ? 'north' : 'south', val: ++tick % 100_000 })
    })
  }, 30)
  console.log(`batch  ${ms.toFixed(3)} ms/commit (count ${count.value()})`)
  return ms
})()

console.log('---')
const BRUSH_CEIL = 2.5
const BATCH_CEIL = 0.5
if (brushMs > BRUSH_CEIL || batchMs > BATCH_CEIL || Number.isNaN(brushMs) || Number.isNaN(batchMs)) {
  console.error(`FAIL: M2 gate exceeded (brush ${brushMs.toFixed(3)} > ${BRUSH_CEIL} or batch ${batchMs.toFixed(3)} > ${BATCH_CEIL})`)
  process.exit(1)
}
console.log(`PASS: M2 flagship shapes within budget (brush ${brushMs.toFixed(3)} ≤ ${BRUSH_CEIL} ms, batch ${batchMs.toFixed(3)} ≤ ${BATCH_CEIL} ms)`)
