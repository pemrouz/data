// M3 replication gate (W7b/c): the hot ingest lane under fero's frame-run
// shape — a deterministic 60/20/20 update/insert/remove stream applied
// through lane() at three framings (16 records/frame — fero's realistic
// inbound; 1/frame — the unbatched two-phase floor; 512/frame — the batch
// amortization ceiling), each riding one native sink + one filter→sum chain.
//
// HISTORY: born as the corpus row that never existed — v4 lane vs fero's v2
// terminal apply ([view].res per record), gate ≤ 1.15×. The v2 referent was
// RETIRED at the v4 root promotion (2026-08-03); the final recorded A/B on
// the dev machine was frame-16 at 0.151× of the v2 path (µs/rec ≈ 0.79 vs
// 6.07) — the lane beat the referent by ~6.6×, with per-rec (batch-of-1) at
// ~0.53× and frame-512 at ~0.13×.
//
// What gates NOW:
// 1. absolute ceiling, dev-machine-calibrated: frame-16 ≤ 3.0 µs/rec.
//    Observed 0.79–1.55 µs/rec across runs on this machine (WSL wall-clock
//    variance is real); the retired v2 referent sat at ~6 µs/rec, so 3.0
//    still catches that regression class, a lost lane fast path, or an
//    accidental per-record reshape/allocation.
// 2. CROSS-LANE STATE EQUALITY: all three framings replay the IDENTICAL
//    script, so their live sets and derived sums must agree exactly — a
//    silently-diverging lane fails long before any ratio matters.
//
// Run: node --experimental-strip-types --no-warnings perf/m3-replication.ts

type Row = { region: string; val: number }
const N = 10_000

const { Runtime } = await import('../kernel/runtime.ts')
const { SourceNode } = await import('../kernel/node.ts')
const { filter } = await import('../ops/rowops.ts')
const { sum } = await import('../ops/aggregate.ts')
const { lane, HOT } = await import('../seam/index.ts')

function mk(): Record<string, Row> {
  const o: Record<string, Row> = {}
  for (let i = 0; i < N; i++) o['k' + i] = { region: i % 2 ? 'north' : 'south', val: i }
  return o
}

// ── the deterministic replication stream ─────────────────────────────────────
// 60% field updates (monotonic — always a real write), 20% inserts (fresh
// minted keys — the source grows), 20% removes (the oldest previously
// inserted key — steady live-set). One shared script; every lane replays
// the identical sequence, so final states must be deep-equal (asserted).
let stamp = 1
let mintSeq = 0
let reapSeq = 0
type Op = { t: 0 | 1 | 2; k: string; path: boolean; v: number }
function nextOp(i: number): Op {
  const r = i % 10
  if (r < 6) return { t: 0, k: 'k' + (i % N), path: true, v: ++stamp }
  if (r < 8) return { t: 1, k: 'm' + mintSeq++, path: false, v: ++stamp }
  return { t: 2, k: 'm' + Math.min(reapSeq++, mintSeq - 1), path: false, v: 0 }
}

// One engine per framing so EVERY lane replays the IDENTICAL script exactly
// once (a shared source would double-apply).
function mkEngine() {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, mk())
  let sinkN = 0
  src.connect({ wantsOrder: false, origin: null, apply: () => sinkN++ })
  const total = sum(filter(src, (r: Row) => r.region === 'north'), 'val')
  return { src, total, sink: () => sinkN, lane: lane(src) }
}
const e16 = mkEngine()
const eRec = mkEngine()
const e512 = mkEngine()

const hotOf = (op: Op) =>
  op.t === 0
    ? { type: HOT.update, key: [op.k, 'val'], value: op.v }
    : op.t === 1
      ? { type: HOT.insert, key: [op.k], value: { region: 'north', val: op.v } }
      : { type: HOT.remove, key: [op.k] }

const RECS = 2000 // records per script
let scriptSeq = 0
function script(): Op[] {
  const ops: Op[] = []
  for (let i = 0; i < RECS; i++) ops.push(nextOp(scriptSeq * RECS + i))
  scriptSeq++
  return ops
}

const applyFramed = (e: ReturnType<typeof mkEngine>, size: number) => (ops: Op[]) => {
  const frame: any[] = []
  for (let i = 0; i < ops.length; i++) {
    frame.push(hotOf(ops[i]))
    if (frame.length === size) {
      e.lane(frame)
      frame.length = 0
    }
  }
  if (frame.length) e.lane(frame)
}
const CASES: [string, (ops: Op[]) => void][] = [
  ['lane/frame16', applyFramed(e16, 16)],
  ['lane/rec', applyFramed(eRec, 1)],
  ['lane/frame512', applyFramed(e512, 512)],
]

function sample(fn: (ops: Op[]) => void, ops: Op[]): number {
  const t0 = performance.now()
  fn(ops)
  return ((performance.now() - t0) * 1000) / ops.length // µs/record
}

// Warmup: two scripts through EVERY engine (JIT-hot, identical states kept).
for (let w = 0; w < 2; w++) {
  const ops = script()
  for (const [, fn] of CASES) fn(ops)
}

const ROUNDS = 11
const info = { f16: [] as number[], rec: [] as number[], f512: [] as number[] }
for (let r = 0; r < ROUNDS; r++) {
  const ops = script() // ONE script per round; every lane replays it
  info.f16.push(sample(CASES[0][1], ops))
  info.rec.push(sample(CASES[1][1], ops))
  info.f512.push(sample(CASES[2][1], ops))
}
const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1]

// Cross-lane state equality: the three lanes replayed the identical script —
// live sets and derived chains must agree exactly (guards a silently-
// diverging lane long before any timing matters).
{
  const ref = e16.src.snapshot()
  for (const [name, e] of [['rec', eRec], ['frame512', e512]] as const) {
    const snap = e.src.snapshot()
    if (ref.size !== snap.size) throw new Error(`state divergence (${name}): ${ref.size} rows vs ${snap.size}`)
    for (const [k, a] of ref) {
      const b = snap.get(k) as Row
      if (a.val !== b.val || a.region !== b.region)
        throw new Error(`state divergence (${name}) at ${String(k)}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
    }
    const t16 = (e16.total as any).value()
    const tb = (e.total as any).value()
    if (t16 !== tb) throw new Error(`derived divergence (${name}): sum ${t16} vs ${tb}`)
  }
}

const f16 = med(info.f16)
console.log(`lane/frame16 ${f16.toFixed(3)} µs/rec   lane/rec ${med(info.rec).toFixed(3)}   lane/frame512 ${med(info.f512).toFixed(3)}`)
console.log('---')
const CEIL = 3.0
console.log(`frame-16 ceiling ${f16.toFixed(3)} µs/rec (gate ≤ ${CEIL}); frame-16 batching is the D1 design point`)
if (f16 > CEIL) {
  console.log(`FAIL: M3 replication gate exceeded (${f16.toFixed(3)} > ${CEIL})`)
  process.exit(1)
}
console.log(`PASS: M3 replication lane within budget (three framings state-equal; sinks ${e16.sink()})`)
