// M4 budgets gate (W8): the numbers fero extends its alloc gates across the
// seam with — DOCUMENTED, then GATED, in fero's own RB style.
//
// Sections (all measured here, every run):
//   B1 RETENTION per ingested record — fresh inserts through lane(), batch
//      512 and batch 16: net heap growth after full GC per record. This is
//      the number fero's RB1/RB2 (≤512/≤640 B/record on its kernel inbound
//      path) extends across the seam: kernel + store + delta machinery
//      together must stay inside the SAME budgets (batch-independence
//      included — small frames must not balloon retention).
//   B2 UPDATE residual — an update-only workload retains ~nothing: net heap
//      per record after GC ≤ 64 B (a leak on the steady-state path turns
//      this red long before RSS graphs would).
//   B3 Nth-SINK marginal cost — one write into a source with 1 vs 33
//      attached by-ref sinks: the marginal per-sink per-commit cost, gated
//      as a ratio (33 sinks ≤ 2.5× the 1-sink write) and printed as
//      µs/sink/commit for fero's 1.15×-class ratio gates to budget against.
//   B4 ORIGIN-SUPPRESSION cost — 32 same-origin (suppressed) sinks vs 0
//      sinks: suppression is ONE identity compare per sink per commit
//      (SCHEDULE clause 6); gated ≤ 1.35× the sink-free write.
//   B5 onCommit ZERO-COST-UNHOOKED — writes on a runtime whose hook was
//      attached-then-disposed vs one never hooked: ≤ 1.15× (dispose leaves
//      zero residue; the per-node timing instrumentation arms ONLY while a
//      hook is live — the contract fero's [diagnostics] ratio gates need).
//
// Methodology: interleaved rounds + median-of-ratios for the time gates (m1
// discipline), full-GC fencing for the retention gates, monotonic values,
// fresh keys per round. Run with --expose-gc.
//
// Run: node --experimental-strip-types --no-warnings --expose-gc v4/perf/m4-budgets.ts

const { Runtime } = await import('../kernel/runtime.ts')
const { SourceNode } = await import('../kernel/node.ts')
const { lane, HOT } = await import('../seam/index.ts')

declare const global: any
if (typeof global.gc !== 'function') {
  console.error('m4-budgets: run with --expose-gc')
  process.exit(1)
}
const heap = (): number => {
  global.gc()
  global.gc()
  return process.memoryUsage().heapUsed
}
const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1]

type Row = { region: string; val: number }
let stamp = 1
let mint = 0

// ── B1: retention per fresh-insert record, batch 512 and batch 16 ────────────
function retention(batch: number, records: number): number {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, {})
  src.connect({ wantsOrder: false, origin: null, apply: () => {} })
  const l = lane(src)
  // warm the lane/store shapes so first-call allocations don't bill the budget
  l([{ type: HOT.insert, key: ['warm'], value: { region: 'w', val: 0 } }])
  src.remove('warm')
  const h0 = heap()
  const frame: any[] = []
  for (let i = 0; i < records; i++) {
    frame.push({ type: HOT.insert, key: ['r' + mint++], value: { region: i % 2 ? 'north' : 'south', val: ++stamp } })
    if (frame.length === batch) {
      l(frame)
      frame.length = 0
    }
  }
  if (frame.length) l(frame)
  const h1 = heap()
  return (h1 - h0) / records
}

const RECS = 20_000
const b512 = retention(512, RECS)
const b16 = retention(16, RECS)

// ── B2: update-only residual (steady-state leak detector) ────────────────────
function updateResidual(records: number): number {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, {})
  const l = lane(src)
  const keys: string[] = []
  for (let i = 0; i < 1000; i++) keys.push('u' + i)
  l(keys.map((k) => ({ type: HOT.insert, key: [k], value: { region: 'north', val: 0 } })))
  src.connect({ wantsOrder: false, origin: null, apply: () => {} })
  const h0 = heap()
  const frame: any[] = []
  for (let i = 0; i < records; i++) {
    frame.push({ type: HOT.update, key: [keys[i % 1000], 'val'], value: ++stamp })
    if (frame.length === 16) {
      l(frame)
      frame.length = 0
    }
  }
  if (frame.length) l(frame)
  const h1 = heap()
  return (h1 - h0) / records
}
const resid = updateResidual(50_000)

// ── B3/B4/B5: interleaved time ratios ────────────────────────────────────────
function mkTimed(sinks: number, origin: symbol | null): { src: InstanceType<typeof SourceNode<Row>>; keys: string[] } {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, {})
  const keys: string[] = []
  for (let i = 0; i < 1000; i++) {
    keys.push('t' + i)
    src.write('t' + i, [], { region: 'north', val: i })
  }
  for (let i = 0; i < sinks; i++) src.connect({ wantsOrder: false, origin, apply: () => {} })
  return { src, keys }
}

const mine = Symbol('me')
const one = mkTimed(1, null)
const many = mkTimed(33, null)
const none = mkTimed(0, null)
const suppressed = mkTimed(32, mine)

// B5 runtimes: never-hooked vs attached-then-disposed vs live hook.
const b5a = mkTimed(1, null)
const b5b = mkTimed(1, null)
const b5c = mkTimed(1, null)
const disposedHook = b5b.src.runtime.onCommit(() => {})
disposedHook.dispose()
let hookCalls = 0
b5c.src.runtime.onCommit(() => hookCalls++)

const INNER = 8000
function tWrites(t: { src: any; keys: string[] }, origin: symbol | null): number {
  const t0 = performance.now()
  if (origin) {
    t.src.runtime.withOrigin(origin, () => {
      for (let i = 0; i < INNER; i++) t.src.write(t.keys[i % 1000], ['val'], ++stamp)
    })
  } else {
    for (let i = 0; i < INNER; i++) t.src.write(t.keys[i % 1000], ['val'], ++stamp)
  }
  return ((performance.now() - t0) * 1000) / INNER
}

// warmup
for (const t of [one, many, none, suppressed, b5a, b5b, b5c]) tWrites(t, null)
tWrites(suppressed, mine)

const ROUNDS = 11
const r33: number[] = []
const rSupp: number[] = []
const rDisposed: number[] = []
const perSink: number[] = []
let liveHookCost = 0
for (let r = 0; r < ROUNDS; r++) {
  const t1 = tWrites(one, null)
  const t33 = tWrites(many, null)
  const t0s = tWrites(none, null)
  const tSup = tWrites(suppressed, mine)
  const tA = tWrites(b5a, null)
  const tB = tWrites(b5b, null)
  const tC = tWrites(b5c, null)
  r33.push(t33 / t1)
  rSupp.push(tSup / t0s)
  rDisposed.push(tB / tA)
  perSink.push((t33 - t1) / 32)
  liveHookCost = tC / tA
}

// ── report + gates ───────────────────────────────────────────────────────────
console.log(`B1 retention  batch512 ${b512.toFixed(1)} B/rec (gate ≤ 512)   batch16 ${b16.toFixed(1)} B/rec (gate ≤ 640)`)
console.log(`B2 update residual ${resid.toFixed(2)} B/rec (gate ≤ 64)`)
console.log(`B3 33-sink/1-sink write ${med(r33).toFixed(3)} (gate ≤ 2.5)   marginal ${Math.max(0, med(perSink)).toFixed(4)} µs/sink/commit`)
console.log(`B4 32-suppressed-sinks/0-sinks ${med(rSupp).toFixed(3)} (gate ≤ 1.35)`)
console.log(`B5 disposed-hook/never-hooked ${med(rDisposed).toFixed(3)} (gate ≤ 1.15)   live-hook ${liveHookCost.toFixed(3)}× (informational; calls ${hookCalls})`)

const fails: string[] = []
if (b512 > 512) fails.push(`B1/512: ${b512.toFixed(1)} > 512`)
if (b16 > 640) fails.push(`B1/16: ${b16.toFixed(1)} > 640`)
if (resid > 64) fails.push(`B2: ${resid.toFixed(2)} > 64`)
if (med(r33) > 2.5) fails.push(`B3: ${med(r33).toFixed(3)} > 2.5`)
if (med(rSupp) > 1.35) fails.push(`B4: ${med(rSupp).toFixed(3)} > 1.35`)
if (med(rDisposed) > 1.15) fails.push(`B5: ${med(rDisposed).toFixed(3)} > 1.15`)
if (fails.length) {
  console.log(`FAIL: M4 budgets exceeded — ${fails.join('; ')}`)
  process.exit(1)
}
console.log('PASS: M4 budgets — the seam numbers fero extends its RB gates with')
