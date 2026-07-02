// Commit-machinery absolute-cost tracker (informational — the DECIDING M1
// gate is the v2-relative ratio in m1-gate.ts; see the note at the bottom).
// Kept because absolute drifts are visible here before they show in ratios.
//
// Run: node --experimental-strip-types --no-warnings v3/perf/commit.bench.ts

import { Runtime } from '../kernel/runtime.ts'
import { SourceNode } from '../kernel/node.ts'
import { filter } from '../ops/rowops.ts'
import { sum } from '../ops/aggregate.ts'

type Row = { region: string; val: number }

// Monotonic value stamp: guarantees every measured write is a REAL write
// (an earlier version repeated values across samples, so after warmup most
// writes hit the Object.is no-op path and the gate passed on fiction).
let stamp = 1
const next = () => ++stamp

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[s.length >> 1]
}

// Per-write cost of a shape, sampled as batches of `inner` writes.
function measure(label: string, setup: () => (i: number) => void, inner = 2000, samples = 9): number {
  const run = setup()
  // warmup
  for (let i = 0; i < inner; i++) run(i)
  const per: number[] = []
  for (let s = 0; s < samples; s++) {
    const t0 = performance.now()
    for (let i = 0; i < inner; i++) run(i)
    per.push(((performance.now() - t0) * 1000) / inner) // µs per write
  }
  const m = median(per)
  console.log(`${label.padEnd(58)} ${m.toFixed(3)} µs/write`)
  return m
}

const N = 10_000
const mkRows = (): Record<string, Row> => {
  const o: Record<string, Row> = {}
  for (let i = 0; i < N; i++) o['k' + i] = { region: i % 2 ? 'north' : 'south', val: i }
  return o
}

// 0. Raw baseline: what an equivalent hand-write costs with NO reactive
//    machinery (Map lookup + path-copy + Map set). The gate is the OVERHEAD
//    of the commit machinery over this.
const raw = measure('raw baseline: Map get + path-copy + Map set (no engine)', () => {
  const store = new Map<string, Row>()
  for (const [k, v] of Object.entries(mkRows())) store.set(k, v)
  return (i) => {
    const k = 'k' + (i % N)
    const prev = store.get(k)!
    const v = next()
    if (!Object.is(prev.val, v)) store.set(k, { ...prev, val: v })
  }
})

// 1. Bare single-field write on a source with NO consumers.
//    (write → path-copy → consolidate → settle → empty fanout)
const bare = measure('bare write, source only (write + commit machinery)', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, mkRows())
  return (i) => src.write('k' + (i % N), ['val'], next())
})

// 1b. Batched source-only (localizes batched-path cost vs case 3).
const batchedBare = measure('batched write (100/commit), source only', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, mkRows())
  let n = 0
  return (i) => {
    if (n === 0) {
      rt.batch(() => {
        const base = (i * 7919) % N // spread batches across the key space
        for (let j = 0; j < 100; j++) src.write('k' + ((base + j) % N), ['val'], next())
      })
    }
    n = (n + 1) % 100
  }
})

// 2. Same write through a filter → sum chain (the M1 flagship shape).
const chain = measure('single write through filter → sum chain', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, mkRows())
  const north = filter(src, (r) => r.region === 'north')
  sum(north, 'val') // held by scope-less graph via parent strong ref
  return (i) => src.write('k' + (i % N), ['val'], next())
})

// 3. Batched writes (100 per commit) through the same chain, per-write cost.
const batched = measure('batched write (100/commit) through filter → sum', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, mkRows())
  const north = filter(src, (r) => r.region === 'north')
  sum(north, 'val')
  let n = 0
  return (i) => {
    if (n === 0) {
      rt.batch(() => {
        const base = (i * 7919) % N
        for (let j = 0; j < 100; j++) src.write('k' + ((base + j) % N), ['val'], next())
      })
    }
    n = (n + 1) % 100 // amortize: only every 100th call commits (cost / 100 per write)
  }
})

console.log('---')
// Informational: the plan's ≤1µs machinery budget turned out to be
// reference-hardware-relative (this box's raw Map+copy write alone costs
// ~1µs). The DECIDING M1 gate is the v2-relative ratio in m1-gate.ts; this
// file tracks absolute costs so drifts are visible in isolation.
const overhead = bare - raw
console.log(
  `machinery overhead = bare ${bare.toFixed(3)} − raw ${raw.toFixed(3)} = ${overhead.toFixed(3)} µs ` +
  `(chain ${chain.toFixed(3)}, batched-bare ${batchedBare.toFixed(3)}, batched-chain ${batched.toFixed(3)} µs/write)`,
)
