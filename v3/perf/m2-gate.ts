// M2 exit gate: the two flagship shapes vs v2 — (a) the crossfilter BRUSH
// (between bounds sweep over 50k rows with a downstream count), (b) the
// swarm-style BATCH churn (100 whole-row writes per commit). Gate: median
// ratio ≤ 1.15× at M2 (≤ 1.0× required by M5).
//
// METHODOLOGY (each iteration taught us something; keep all three rules):
// 1. Values are monotonic — every measured write is REAL (a draft that
//    repeated values measured the Object.is no-op path and passed on fiction).
// 2. One ENGINE per PROCESS: v2 and v3 sharing a process cross-pollute
//    builtin-access inline caches and shift the batch ratio +0.2..0.35 —
//    an artifact real deployments (one engine) never see. Verified: isolated
//    ABAB replicates give parity; the shared-process duel gave 1.24-1.35.
// 3. Per-sample gc() (--expose-gc) + medians: the engines allocate at
//    different rates, so GC otherwise lands asymmetrically inside samples.
// The parent process spawns each (engine, shape) 5x interleaved ABAB and
// gates on the median of per-replicate ratios.
//
// Run: node --experimental-strip-types --no-warnings --expose-gc v3/perf/m2-gate.ts

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
  // Deep warmup: fresh-process children must reach top JIT tier before any
  // sample (80-step warmup under-measured the engine with more hot functions
  // by up to 2x; 10x inner reaches steady state on both engines).
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

const mode = process.argv[2]

if (mode === undefined) {
  // ── orchestrator ───────────────────────────────────────────────────────────
  const { spawnSync } = await import('node:child_process')
  const self = new URL(import.meta.url).pathname
  const run = (m: string): { ms: number; count: number } => {
    const res = spawnSync(
      process.execPath,
      ['--experimental-strip-types', '--no-warnings', '--expose-gc', self, m],
      { encoding: 'utf8' },
    )
    if (res.status !== 0) {
      process.stderr.write(res.stdout + res.stderr)
      process.exit(1)
    }
    const ms = Number(res.stdout.match(/MS ([\d.]+)/)?.[1])
    const count = Number(res.stdout.match(/COUNT (\d+)/)?.[1])
    return { ms, count }
  }
  const REPS = 5
  const gate = (shape: 'brush' | 'batch'): number => {
    const ratios: number[] = []
    let v2ms = 0
    let v3ms = 0
    for (let i = 0; i < REPS; i++) {
      const a = run(`v2-${shape}`)
      const b = run(`v3-${shape}`)
      if (a.count !== b.count) {
        console.error(`FAIL: ${shape} count mismatch v2 ${a.count} vs v3 ${b.count}`)
        process.exit(1)
      }
      ratios.push(b.ms / a.ms)
      v2ms = a.ms
      v3ms = b.ms
    }
    const r = med(ratios)
    console.log(
      `${shape.padEnd(6)} v2 ${v2ms.toFixed(3)} ms  v3 ${v3ms.toFixed(3)} ms  ratios [${ratios.map((x) => x.toFixed(3)).join(', ')}] -> ${r.toFixed(3)}`,
    )
    return r
  }
  const rBrush = gate('brush')
  const rBatch = gate('batch')
  console.log('---')
  const GATE = 1.15
  if (rBrush > GATE || rBatch > GATE || Number.isNaN(rBrush) || Number.isNaN(rBatch)) {
    console.error(`FAIL: M2 gate exceeded (brush ${rBrush.toFixed(3)}, batch ${rBatch.toFixed(3)} > ${GATE})`)
    process.exit(1)
  }
  console.log(`PASS: M2 flagship shapes <= ${GATE}x v2 (brush ${rBrush.toFixed(3)}, batch ${rBatch.toFixed(3)})`)
} else if (mode === 'v2-brush' || mode === 'v2-batch') {
  // ── v2 child (imports ONLY v2) ─────────────────────────────────────────────
  const { $, value } = await import('../../index.ts')
  if (mode === 'v2-brush') {
    const src: any = $(mkObj())
    const ext: any = $([10_000, 60_000])
    const range = src.between('val', ext)
    const count = range.length()
    const ms = measure(() => {
      const lo = 10_000 + (sweep++ % 40) * 500
      ext[value] = [lo, lo + 50_000]
    }, 40)
    console.log(`MS ${ms.toFixed(4)}\nCOUNT ${count[value]}`)
  } else {
    const src: any = $(mkObj())
    const count = src.filter((r: Row) => r.region === 'north').length()
    const ms = measure(() => {
      const base = (tick * 100) % N
      const pairs: unknown[] = []
      for (let j = 0; j < 100; j++)
        pairs.push(KEYS[(base + j) % N], { region: (tick + j) % 3 ? 'north' : 'south', val: ++tick % 100_000 })
      src.patch(pairs)
    }, 30)
    console.log(`MS ${ms.toFixed(4)}\nCOUNT ${count[value]}`)
  }
} else {
  // ── v3 child (imports ONLY v3) ─────────────────────────────────────────────
  const { Runtime } = await import('../kernel/runtime.ts')
  const { SourceNode } = await import('../kernel/node.ts')
  const { length } = await import('../ops/aggregate.ts')
  if (mode === 'v3-brush') {
    const { between } = await import('../ops/between.ts')
    const rt = new Runtime()
    const src = new SourceNode<Row>(rt, mkObj())
    const range = between(src, 'val', [10_000, 60_000])
    const count = length(range)
    const ms = measure(() => {
      const lo = 10_000 + (sweep++ % 40) * 500
      range.setBounds([lo, lo + 50_000])
    }, 40)
    console.log(`MS ${ms.toFixed(4)}\nCOUNT ${count.value()}`)
  } else {
    const { filter } = await import('../ops/rowops.ts')
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
    console.log(`MS ${ms.toFixed(4)}\nCOUNT ${count.value()}`)
  }
}
