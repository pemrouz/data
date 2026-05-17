// @ts-nocheck
// Shared workload + types for per-operator benchmarks.
//
// Each operator file in this directory exports a default `OpBench` describing
// the operator under test plus an implementation per peer library. The runner
// (run-ops.ts) walks the directory and prints a markdown table.
//
// The workload is intentionally narrow: one operator on a single source. We're
// measuring the *per-tick reactive cost* of that operator across libraries,
// not the end-to-end pipeline (the existing run-all.ts covers that).
//
// Row shape is wide enough to support every operator without per-operator data
// shapes — each operator picks the columns it needs.

const _ENV_N = Number(process.env.BENCH_N)
export const N: number = Number.isFinite(_ENV_N) && _ENV_N > 0 ? _ENV_N : 10_000
export const TICK_COUNT = 1000
export const SEED = 42
export const TICK_SEED = 7

export type Row = {
  id: number
  val: number      // continuous, ~U[0, 100)
  val2: number     // second continuous, ~U[0, 100)
  cat: string      // categorical, one of 10 buckets
  active: boolean  // ~50% true
}

function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x1_0000_0000
  }
}

const CATS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']

export function makeRows(n: number = N, seed: number = SEED): Row[] {
  const rand = lcg(seed)
  const out: Row[] = new Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = {
      id: i,
      val: rand() * 100,
      val2: rand() * 100,
      cat: CATS[Math.floor(rand() * CATS.length)],
      active: rand() < 0.5,
    }
  }
  return out
}

// Each tick rewrites one column of one row to a fresh value from the same
// distribution. Some ticks cross the filter/range threshold, some don't —
// realistic and exercises both enter/leave and pure-update paths.
export type Tick = {
  idx: number
  field: 'val' | 'val2' | 'cat' | 'active'
  value: number | string | boolean
}

export function makeTicks(
  count: number = TICK_COUNT,
  n: number = N,
  seed: number = TICK_SEED,
  fields: ReadonlyArray<Tick['field']> = ['val'],
): Tick[] {
  const rand = lcg(seed)
  const out: Tick[] = new Array(count)
  for (let i = 0; i < count; i++) {
    const field = fields[Math.floor(rand() * fields.length)]
    let value: any
    if (field === 'cat') value = CATS[Math.floor(rand() * CATS.length)]
    else if (field === 'active') value = rand() < 0.5
    else value = rand() * 100
    out[i] = { idx: Math.floor(rand() * n), field, value }
  }
  return out
}

// Thresholds chosen so ~half of rows pass the predicate.
export const THRESHOLD = 50

// --- Result types ---------------------------------------------------------

export type Timings = {
  setup: number   // ms median, build the graph
  single: number  // ms median, one tick + read result
  batch: number   // ms median, all TICK_COUNT ticks + reads
}

export type Variant = {
  name: string
  version: string
  run: () => Promise<Timings> | Timings
}

export type OpBench = {
  operator: string
  notes?: string
  variants: Variant[]
}
