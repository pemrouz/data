// M1 gate: single-tick write cost — self-contained (no external referent).
//
// HISTORY: this gate was born as an A/B against the v2 engine (v3 single-tick
// ≤ 1.15× v2, PLAN §10 M1). The v2 referent was RETIRED at the v4 root
// promotion (2026-08-03); the final recorded A/B on the dev machine was
// bare 0.65×, chain 0.77× of v2 — comfortably under the 1.15× gate, with the
// absolute medians bare ≈ 1.17 µs/write, chain ≈ 1.65 µs/write.
//
// What gates NOW:
// 1. chain/bare ratio ≤ 3.0 — machine-independent: the whole operator-chain
//    overhead (filter → sum riding a keyed field write) over a bare write.
//    Recorded steady-state ≈ 1.4×; a structural regression (an O(N) walk on
//    the delta path, a lost fast path) blows straight through 3.0.
// 2. absolute ceilings, dev-machine-calibrated with ~4× headroom: bare ≤ 5
//    µs/write, chain ≤ 8 µs/write. These absorb thermal/WSL variance but
//    catch order-of-magnitude regressions even if both cases regress
//    together (which the ratio alone would forgive).
//
// Methodology (kept from the A/B era): interleaved rounds, median-of-rounds,
// monotonic values so every measured write is REAL (never an Object.is
// no-op).
//
// Run: node --experimental-strip-types --no-warnings perf/m1-gate.ts

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

const { Runtime } = await import('../kernel/runtime.ts')
const { SourceNode } = await import('../kernel/node.ts')
const { filter } = await import('../ops/rowops.ts')
const { sum } = await import('../ops/aggregate.ts')

// ── fixtures (built once, mutated throughout — steady-state engines) ─────────
const rt = new Runtime()
const bareSrc = new SourceNode<Row>(rt, mk())
const rtc = new Runtime()
const chainSrc = new SourceNode<Row>(rtc, mk())
const north = filter(chainSrc, (r) => r.region === 'north')
const total = sum(north, 'val')

const CASES: [string, (i: number) => void][] = [
  ['bare', (i) => bareSrc.write(keys[i % N], ['val'], ++stamp)],
  ['chain', (i) => chainSrc.write(keys[i % N], ['val'], ++stamp)],
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

const bare = med(times[0])
const chain = med(times[1])
for (let c = 0; c < CASES.length; c++) {
  console.log(CASES[c][0].padEnd(6), med(times[c]).toFixed(3), 'µs/write')
}

// per-round ratios → median (adjacent samples share machine state)
const ratio = med(times[0].map((b, r) => times[1][r] / b))

console.log('---')
const RATIO_GATE = 3.0
const BARE_CEIL = 5
const CHAIN_CEIL = 8
console.log(`chain/bare ratio (median of ${ROUNDS} rounds) = ${ratio.toFixed(3)}  (gate ≤ ${RATIO_GATE})`)
console.log(`absolute: bare ${bare.toFixed(3)} µs (≤ ${BARE_CEIL})  chain ${chain.toFixed(3)} µs (≤ ${CHAIN_CEIL})`)
void total // keep the chain alive
if (ratio > RATIO_GATE || bare > BARE_CEIL || chain > CHAIN_CEIL) {
  console.error('FAIL: M1 single-tick gate exceeded')
  process.exit(1)
}
console.log('PASS: M1 single-tick within budget (chain overhead + absolute ceilings)')
