// M3 replication gate (W7b/c): the corpus row that never existed — fero's
// EXACT inbound shape, gated.
//
// The workload is replication apply: interleaved update/insert/remove
// records arriving in frame-runs, applied into a source carrying one
// record-consumer sink + one filter→sum chain (fero: the capture/serve sink
// and a derived projection). The referent is fero's terminal apply TODAY —
// v2's `[view].res.update/insert/remove` per record (log/index.ts
// applyRecord) with a FunctionSink attached (v2 clones per emission; that is
// fero's current, measured cost). The candidate is the v4 hot lane
// (seam.lane(), zero reshape) applied per frame of 16 — the D1 migration
// design (fero batches inbound per frame-run, never per record).
//
// GATE: median-of-interleaved-ratios (m1 methodology: adjacent samples, same
// JIT/GC state, monotonic values, fresh insert keys — never the no-op lane)
// v4-frame16 / v2-per-record ≤ 1.15.
//
// INFORMATIONAL (the W7c remove-floor statement, printed every run):
//   v4 per-record (batch-of-1)   — the honest two-phase-commit floor at the
//                                  unbatched framing (corpus: remove rows
//                                  2.4-2.6× v2 there);
//   v4 frame-512                 — how batching amortizes it.
// The number to read: frame-16 already recovers the floor (fero's realistic
// small frame), frame-512 is gravy. If v4-rec/v2-rec drifts far above the
// corpus remove-floor band, something regressed in the commit path.
//
// Run: node --experimental-strip-types --no-warnings v4/perf/m3-replication.ts

type Row = { region: string; val: number }
const N = 10_000

const { $, view } = await import('../../index.ts')
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
// inserted key — steady live-set). One shared script; every engine replays
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

// ── engines (steady-state fixtures, mutated throughout) ──────────────────────
// v2: fero's terminal apply — [view].res per record + FunctionSink + chain.
const v2src: any = $(mk())
const v2res = v2src[view].res
let v2sink = 0
v2src.connect({}, () => v2sink++)
const v2total = v2src.filter((r: Row) => r.region === 'north').sum('val')

// v4 engines — one per lane so EVERY engine replays the IDENTICAL script
// exactly once (a shared source would double-apply the informational lanes).
function mkV4() {
  const rt = new Runtime()
  const src4 = new SourceNode<Row>(rt, mk())
  let sinkN = 0
  src4.connect({ wantsOrder: false, origin: null, apply: () => sinkN++ })
  const total = sum(filter(src4, (r: Row) => r.region === 'north'), 'val')
  return { src: src4, total, sink: () => sinkN, lane: lane(src4) }
}
const e16 = mkV4()
const eRec = mkV4()
const e512 = mkV4()

function v2apply(op: Op): void {
  if (op.t === 0) v2res.update(op.v, [op.k, 'val'])
  else if (op.t === 1) v2res.update({ region: 'north', val: op.v }, [op.k])
  else v2res.remove([op.k])
}

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

const applyV2 = (ops: Op[]) => {
  for (let i = 0; i < ops.length; i++) v2apply(ops[i])
}
const applyFramed = (e: ReturnType<typeof mkV4>, size: number) => (ops: Op[]) => {
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
  ['v2 res/rec', applyV2],
  ['v4 lane/frame16', applyFramed(e16, 16)],
  ['v4 lane/rec', applyFramed(eRec, 1)],
  ['v4 lane/frame512', applyFramed(e512, 512)],
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
const ratios: number[] = []
const info = { rec: [] as number[], f512: [] as number[], v2: [] as number[], f16: [] as number[] }
for (let r = 0; r < ROUNDS; r++) {
  const ops = script() // ONE script per round; every engine replays it
  const v2t = sample(CASES[0][1], ops)
  const f16 = sample(CASES[1][1], ops)
  const rec = sample(CASES[2][1], ops)
  const f512 = sample(CASES[3][1], ops)
  ratios.push(f16 / v2t)
  info.v2.push(v2t)
  info.f16.push(f16)
  info.rec.push(rec / v2t)
  info.f512.push(f512 / v2t)
}
const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1]

// State equality: all four engines replayed the identical script — their
// live sets and derived chains must agree exactly (guards a silently-
// diverging lane long before any ratio matters).
{
  const { value } = await import('../../index.ts')
  const v2snap = v2src[value] as Record<string, Row>
  const v2keys = Object.keys(v2snap)
  for (const [name, e] of [['frame16', e16], ['rec', eRec], ['frame512', e512]] as const) {
    const v4snap = e.src.snapshot()
    if (v2keys.length !== v4snap.size)
      throw new Error(`state divergence (${name}): v2 ${v2keys.length} rows vs v4 ${v4snap.size}`)
    for (const k of v2keys) {
      const a4 = v4snap.get(k) as Row
      const a2 = v2snap[k]
      if (a2.val !== a4.val || a2.region !== a4.region)
        throw new Error(`state divergence (${name}) at ${k}: v2 ${JSON.stringify(a2)} vs v4 ${JSON.stringify(a4)}`)
    }
    const t2 = v2total[value]
    const t4 = (e.total as any).value()
    if (t2 !== t4) throw new Error(`derived divergence (${name}): v2 sum ${t2} vs v4 sum ${t4}`)
  }
}

console.log(
  `v2 res/rec ${med(info.v2).toFixed(3)} µs/rec   v4 lane/frame16 ${med(info.f16).toFixed(3)} µs/rec`,
)
console.log(
  `ratios v4-frame16/v2 ${ratios.map((x) => x.toFixed(3)).join(' ')} -> median ${med(ratios).toFixed(3)}  (gate ≤ 1.15)`,
)
console.log(
  `informational: v4 lane/rec ${med(info.rec).toFixed(3)}× v2 (the unbatched two-phase floor); v4 frame512 ${med(info.f512).toFixed(3)}× v2 — frame-16 batching is the D1 design and the floor recovery`,
)
if (med(ratios) > 1.15) {
  console.log(`FAIL: M3 replication gate exceeded (${med(ratios).toFixed(3)} > 1.15)`)
  process.exit(1)
}
console.log(`PASS: M3 replication shape ≤ 1.15× fero's v2 terminal apply (sinks ${v2sink}/${e16.sink()})`)
