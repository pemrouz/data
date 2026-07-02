// M1 exit gate: v3 single-tick ≤ 1.15× v2 on the filter/aggregate shape
// (plans/v3/PLAN.md §10 M1 row). Same machine, same workload.
//
// Methodology: INTERLEAVED rounds (v2 and v3 sampled adjacently under the
// same JIT/GC/thermal state), per-round v3/v2 ratios, median-of-ratios
// verdict. Sequential single-median comparisons were swinging ±50% between
// runs on this machine — ratios from adjacent samples are the stable signal.
// Values are monotonic so every measured write is REAL (never an
// Object.is no-op).
//
// Run: node --experimental-strip-types --no-warnings v3/perf/m1-gate.ts

type Row = { region: string; val: number }
const N = 10_000
function mk(): Record<string, Row> {
  const o: Record<string, Row> = {}
  for (let i = 0; i < N; i++) o['k' + i] = { region: i % 2 ? 'north' : 'south', val: i }
  return o
}
const keys: string[] = []
for (let i = 0; i < N; i++) keys.push('k' + i)
let stamp = 1

const { $ } = await import('../../index.ts')
const { Runtime } = await import('../kernel/runtime.ts')
const { SourceNode } = await import('../kernel/node.ts')
const { filter } = await import('../ops/rowops.ts')
const { sum } = await import('../ops/aggregate.ts')

// ── fixtures (built once, mutated throughout — steady-state engines) ─────────
const v2src: any = $(mk())
const v2csrc: any = $(mk())
const v2north = v2csrc.filter((r: Row) => r.region === 'north')
const v2total = v2north.sum('val')

const rt3 = new Runtime()
const v3src = new SourceNode<Row>(rt3, mk())
const rt3c = new Runtime()
const v3csrc = new SourceNode<Row>(rt3c, mk())
const v3north = filter(v3csrc, (r) => r.region === 'north')
const v3total = sum(v3north, 'val')

const CASES: [string, (i: number) => void][] = [
  ['v2 bare', (i) => { v2src[keys[i % N]].val = ++stamp }],
  ['v3 bare', (i) => v3src.write(keys[i % N], ['val'], ++stamp)],
  ['v2 chain', (i) => { v2csrc[keys[i % N]].val = ++stamp }],
  ['v3 chain', (i) => v3csrc.write(keys[i % N], ['val'], ++stamp)],
]

const INNER = 8000
const ROUNDS = 11

function sample(fn: (i: number) => void): number {
  const t0 = performance.now()
  for (let i = 0; i < INNER; i++) fn(i)
  return ((performance.now() - t0) * 1000) / INNER
}

// global warmup: every case JIT-hot before any measurement
for (const [, fn] of CASES) for (let i = 0; i < 2 * INNER; i++) fn(i)

const times: number[][] = CASES.map(() => [])
for (let r = 0; r < ROUNDS; r++) {
  for (let c = 0; c < CASES.length; c++) times[c].push(sample(CASES[c][1]))
}

function med(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[s.length >> 1]
}

for (let c = 0; c < CASES.length; c++) {
  console.log(CASES[c][0].padEnd(10), med(times[c]).toFixed(3), 'µs/write')
}

// per-round ratios → median (adjacent samples share machine state)
const bareRatios = times[0].map((v2, r) => times[1][r] / v2)
const chainRatios = times[2].map((v2, r) => times[3][r] / v2)
const rBare = med(bareRatios)
const rChain = med(chainRatios)

console.log('---')
const GATE = 1.15
console.log(`bare  ratio v3/v2 (median of ${ROUNDS} rounds) = ${rBare.toFixed(3)}  (gate ≤ ${GATE})`)
console.log(`chain ratio v3/v2 (median of ${ROUNDS} rounds) = ${rChain.toFixed(3)}  (gate ≤ ${GATE})`)
// keep the graph alive against v2's WeakRef lifetime + v3 scope-less refs
void v2total; void v3total
if (rBare > GATE || rChain > GATE) {
  console.error('FAIL: M1 single-tick gate exceeded')
  process.exit(1)
}
console.log('PASS: M1 single-tick ≤ 1.15× v2')
