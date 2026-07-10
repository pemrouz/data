// Operator perf CORPUS — v2 vs v3, informational REPORT (not a gate).
//
// The flip-time evidence: for EVERY v2 operator workload in perf/workloads.ts
// (the ONE definition of each operator's perf workload — the same closures the
// v2 gate asserts on and the v2 perf report re-measures), how does the v3
// engine compare on the setup / single-write / batch cases? One row per
// (operator, case); ops v3 lacks are SKIPPED with an explicit reason (no
// silent gaps).
//
// METHODOLOGY (m2-gate.ts's per-process orchestrator pattern; the full
// discipline is documented in corpus.child.ts's header):
// - one ENGINE per PROCESS; children spawned ABAB, REPS (env, default 5)
//   replicates per engine; per-row ratio = median of per-replicate v3/v2
//   ratios; medians shown are across replicates.
// - inside each child: benchMeasure sampling (1 discarded warmup rep + gc()
//   before each measured rep, median of the case's own rep count) — the same
//   rigor the v2 perf report uses, applied identically to both engines.
// - the v2 child runs perf/workloads.ts's REAL closures; the v3 child runs a
//   write-for-write mirror (same N, same seeded source data, same write
//   sequences, same selectivity — see the child's spec table).
// - EQUIVALENCE: on replicate 1 both children apply each case's write sequence
//   at EQ_N and checksum the derived view's END STATE; this orchestrator
//   asserts v2 ≡ v3 per case (normalizations for legitimately engine-different
//   shapes are documented at the child's `canon`/`EQ_NORM`).
// - NO threshold assertions. Exit non-zero ONLY on a child crash, a
//   cross-engine checksum mismatch, or structural corpus drift (a case
//   present/eq-comparable/timed in ONE engine only — a silently dropped row
//   would bias the summary, so drift is loud, never a footnote).
//
// Run (full sweep):  REPS=5 node --experimental-strip-types --no-warnings \
//                      --expose-gc v3/perf/corpus.bench.ts
// Dev iteration:     REPS=1 CASES=filter,between node ... (same command)
//                    CORPUS_N / CORPUS_EQ_N shrink the row counts (cases whose
//                    v2 closures hard-code absolute key ranges auto-skip below
//                    their minimum N — see the child's MIN_N table).
//
// ── RESULTS 2026-07-10 (full sweep, quiet box, REPS=5, N=10,000, node v26.1.0) ─
//
// READ THIS WITH THE WORKLOAD SHAPE IN MIND: the corpus is deliberately
// UNBATCHED write-for-write parity (1000 bare writes = 1000 v3 commits, where
// v2 dispatches each write directly) — the WORST framing for v3's
// commit/settle architecture, chosen because it is the apples-to-apples
// per-write comparison. The pattern inside the geomean:
// - SETUP dominates the slow rows (graph construction: tap 13.2x, to 6.5x,
//   filter 5.1x, except 3.5x, group 3.4x ...) — one-time costs, and the
//   biggest follow-up lever (node/param-source minting).
// - SINGLE-WRITE cases sit at parity or FAVOR v3: filter/single 1.01x,
//   map/insert 0.73x, length/insert 0.65x, gt-insert 0.71x, max-insert
//   0.47x, sum-insert 0.84x, keys 0.97x, distinct 0.95x.
// - v3's structural wins are large where v2 is architecturally worse:
//   sort/brush 0.25x, values/batch 0.006x (identity passthrough — documented
//   inherent difference), min-batch 0.38x, sum-column-move 0.66x,
//   between/setup 0.75x.
// - Named hotspots for follow-up: group/insert 10.96x, to/* 4.8-6.2x,
//   reduce/batch 1.8x, between/remove 3.8x.
// - REALISTIC (batched, re-reading) shapes are the m1/m2 gates and the
//   example benches, which all favor v3: m1 chain 0.74x, m2 brush ~0.97x /
//   batch ~0.78x, crossfilter example 0.25x/0.14x, swarm frames 0.26 ms.
//   Flip evidence = this table AND those, together.
//
// ### operator perf corpus — v2 vs v3 (informational)
//
// N=10,000 · 5 replicate(s) (ABAB, one engine per process) · inner sampling: benchMeasure (1 warmup + gc, median of each case's reps) · node v26.1.0
// cross-engine end-state equivalence: 42 case(s) compared at EQ_N=10,000 (2 write-sequence run(s)/case) — ALL EQUAL
//
// | operator | case | v2 median | v3 median | ratio (v3/v2) |
// |---|---|---|---|---|
// | filter | setup | 3.62 ms | 18.00 ms | 5.135× |
// | filter | single | 0.2769 ms | 0.2849 ms | 1.010× |
// | filter | batch | 5.90 ms | 8.11 ms | 1.090× |
// | map | setup | 6.08 ms | 19.92 ms | 3.259× |
// | map | insert | 0.2864 ms | 0.2418 ms | 0.733× |
// | to | setup | 2.02 ms | 16.27 ms | 6.511× |
// | to | insert | 1.05 ms | 4.96 ms | 4.774× |
// | to | batch | 476.5 ms | 3377.4 ms | 6.202× |
// | length | insert | 0.2250 ms | 0.1548 ms | 0.651× |
// | length(fn) | setup | 6.07 ms | 16.54 ms | 3.361× |
// | keys | setup | 6.72 ms | 15.05 ms | 2.146× |
// | keys | insert | 0.2395 ms | 0.2378 ms | 0.969× |
// | values | setup | 4.08 ms | 11.83 ms | 2.938× |
// | values | batch | 188.1 ms | 1.08 ms | 0.006× |
// | tap | setup | 0.9465 ms | 10.48 ms | 13.165× |
// | tap | insert | 0.4298 ms | 0.4271 ms | 1.149× |
// | tap | batch | 11.46 ms | 14.89 ms | 1.341× |
// | tap | bare | 6.61 ms | 5.96 ms | 0.967× |
// | distinct | setup | 17.28 ms | 31.58 ms | 1.960× |
// | distinct | insert | 0.2797 ms | 0.2807 ms | 0.952× |
// | distinct | batch | 0.6874 ms | 2.59 ms | 4.523× |
// | group | setup | 16.10 ms | 48.34 ms | 3.378× |
// | group | insert | 0.3384 ms | 3.30 ms | 10.962× |
// | group | churn | 0.1675 ms | 0.5198 ms | 3.103× |
// | compare | gt-setup | 5.59 ms | 20.47 ms | 3.315× |
// | compare | gt-insert | 0.2595 ms | 0.1717 ms | 0.708× |
// | compare | gt-batch | 7.86 ms | 9.15 ms | 1.091× |
// | compare | gt-threshold-move | 11.29 ms | 19.39 ms | 1.539× |
// | compare | lt-setup | 7.12 ms | 17.63 ms | 2.667× |
// | compare | gte-setup | 7.61 ms | 20.31 ms | 2.654× |
// | compare | lte-setup | 6.82 ms | 16.24 ms | 2.094× |
// | between | setup | 38.13 ms | 24.54 ms | 0.745× |
// | between | narrow | 10.78 ms | 24.75 ms | 2.368× |
// | between | insert | 4.72 ms | 10.47 ms | 2.376× |
// | between | remove | 4.61 ms | 13.09 ms | 3.844× |
// | sort | setup | 43.69 ms | 80.46 ms | 1.660× |
// | sort | insert | 0.3196 ms | 0.5681 ms | 1.594× |
// | sort | rotate | 0.4695 ms | 0.7735 ms | 1.743× |
// | sort | brush | 172.8 ms | 40.44 ms | 0.251× |
// | sort | window-move | 0.8315 ms | 1.04 ms | 1.530× |
// | aggregate | sum-setup | 15.62 ms | 23.68 ms | 1.589× |
// | aggregate | sum-insert | 0.2749 ms | 0.2508 ms | 0.842× |
// | aggregate | avg-batch | 8.95 ms | 10.21 ms | 1.545× |
// | aggregate | max-setup | 20.05 ms | 23.89 ms | 1.166× |
// | aggregate | max-insert | 0.5540 ms | 0.2619 ms | 0.473× |
// | aggregate | min-batch | 4.76 ms | 1.61 ms | 0.377× |
// | aggregate | some-setup | 16.27 ms | 26.13 ms | 1.470× |
// | aggregate | every-batch | 9.38 ms | 8.66 ms | 1.083× |
// | aggregate | sum-column-move | 27.08 ms | 19.52 ms | 0.660× |
// | union | setup | 36.16 ms | 56.09 ms | 1.578× |
// | union | churn | 8.86 ms | 13.52 ms | 1.500× |
// | union | insert | 6.64 ms | 9.05 ms | 1.451× |
// | intersect | setup | 26.62 ms | 32.85 ms | 1.077× |
// | intersect | churn | 7.46 ms | 14.75 ms | 1.964× |
// | except | setup | 7.16 ms | 24.58 ms | 3.490× |
// | except | insert-other | 4.79 ms | 6.56 ms | 1.304× |
// | except | remove-other | 4.13 ms | 12.22 ms | 2.869× |
// | reduce | setup | 5.14 ms | 19.85 ms | 2.767× |
// | reduce | insert | 3.42 ms | 3.92 ms | 1.301× |
// | reduce | batch | 153.7 ms | 286.8 ms | 1.796× |
// | reduce | inc-setup | 14.03 ms | 15.31 ms | 1.089× |
// | reduce | inc-insert | 0.2226 ms | 0.2122 ms | 0.975× |
// | reduce | inc-overwrite | 0.7286 ms | 0.6819 ms | 1.062× |
// | reduce | inc-remove | 0.5211 ms | 1.20 ms | 1.732× |
//
// summary: geometric-mean ratio **1.569×** over 64 rows · v3 faster on 14 (<1.0×), slower on 50 (>1.0×)
// worst 3 (v3/v2): tap/setup 13.17× · group/insert 10.96× · to/setup 6.51×
//
// skipped (no v3 counterpart / under-sized N):
// - reverse/*: v3 reserves `reverse` (unimplemented at the flip — throws "reserved name reverse has no implementation yet"); no counterpart to time
// - filter/value-move: v2's reactive equality-value filter('active', $(bool)) has no v3 operator counterpart — the v3 idiom (transient filter + mirror() + dispose(), MIGRATION §3.1/§5.2) is a structurally different graph, not comparable 1:1

import { spawnSync } from 'node:child_process'

interface EqRow { op: string; case: string; sum: string | null; note?: string }
interface TimingRow { op: string; case: string; label: string; ms: number; reps: number; batch?: number }
interface SkipRow { op: string; case: string; reason: string }
interface ChildOut {
  mode: string
  node: string
  n: number
  eqN: number
  eqWrites: number
  eq: EqRow[]
  timing: TimingRow[]
  skips: SkipRow[]
}

const childPath = new URL('./corpus.child.ts', import.meta.url).pathname
const REPS = Number(process.env.REPS ?? '5')

function runChild(mode: 'v2' | 'v3', withEq: boolean): ChildOut {
  const res = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', '--expose-gc', childPath, mode],
    {
      encoding: 'utf8',
      maxBuffer: 1 << 26,
      env: { ...process.env, CORPUS_EQ: withEq ? '1' : '0' },
    },
  )
  if (res.error) {
    console.error(`FAIL: could not spawn ${mode} child:`, res.error)
    process.exit(1)
  }
  if (res.status !== 0) {
    process.stderr.write(res.stdout ?? '')
    process.stderr.write(res.stderr ?? '')
    console.error(`FAIL: ${mode} child exited with status ${res.status}`)
    process.exit(1)
  }
  const lines = res.stdout.trim().split('\n')
  try {
    return JSON.parse(lines[lines.length - 1]) as ChildOut
  } catch {
    process.stderr.write(res.stdout)
    console.error(`FAIL: ${mode} child produced unparseable output`)
    process.exit(1)
    throw new Error('unreachable')
  }
}

function med(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[s.length >> 1]
}

// ── ABAB replicates (equivalence pass runs on replicate 1 only) ──────────────

const v2runs: ChildOut[] = []
const v3runs: ChildOut[] = []

for (let i = 0; i < REPS; i++) {
  const withEq = i === 0
  const t0 = performance.now()
  const a = runChild('v2', withEq)
  process.stderr.write(
    `rep ${i + 1}/${REPS} v2: ${a.timing.length} cases in ${((performance.now() - t0) / 1000).toFixed(1)}s\n`,
  )
  v2runs.push(a)
  const t1 = performance.now()
  const b = runChild('v3', withEq)
  process.stderr.write(
    `rep ${i + 1}/${REPS} v3: ${b.timing.length} cases in ${((performance.now() - t1) / 1000).toFixed(1)}s\n`,
  )
  v3runs.push(b)
}

// ── equivalence check (replicate 1) ──────────────────────────────────────────

// Structural drift (a case present/eq-comparable/timed in one engine only) is
// a HARD failure alongside checksum mismatches: an informational footnote
// would let a dropped row silently bias the summary.
const structural: string[] = []
const v2eq = new Map(v2runs[0].eq.map((r) => [`${r.op}/${r.case}`, r]))
const v3eq = new Map(v3runs[0].eq.map((r) => [`${r.op}/${r.case}`, r]))
let eqCompared = 0
const eqMismatches: string[] = []
for (const [id, a] of v2eq) {
  const b = v3eq.get(id)
  if (b === undefined) {
    structural.push(`eq: ${id} present in v2 only`)
    continue
  }
  if (a.sum === null && b.sum === null) continue // setup / under-N — n/a on both
  if (a.sum === null || b.sum === null) {
    structural.push(`eq: ${id} comparable in one engine only (v2=${a.sum}, v3=${b.sum})`)
    continue
  }
  eqCompared++
  if (a.sum !== b.sum) eqMismatches.push(`${id}: v2 ${a.sum} != v3 ${b.sum}`)
}
for (const id of v3eq.keys()) if (!v2eq.has(id)) structural.push(`eq: ${id} present in v3 only`)

if (eqMismatches.length > 0) {
  console.error(`FAIL: ${eqMismatches.length} cross-engine end-state checksum mismatch(es):`)
  for (const m of eqMismatches) console.error(`  ${m}`)
  console.error('(the engines produced different derived-view end states for the same write sequence)')
  process.exit(1)
}

// ── pair timing rows and build the report ────────────────────────────────────

const CLAMP_MS = 1e-4 // sub-resolution medians can measure 0; clamp for ratios

function seriesFor(runs: ChildOut[], id: string): number[] {
  const out: number[] = []
  for (const r of runs) {
    const row = r.timing.find((t) => `${t.op}/${t.case}` === id)
    if (row !== undefined) out.push(row.ms)
  }
  return out
}

interface ReportRow { id: string; label: string; kase: string; v2: number; v3: number; ratio: number }
const rows: ReportRow[] = []
for (const t of v2runs[0].timing) {
  const id = `${t.op}/${t.case}`
  const v2s = seriesFor(v2runs, id)
  const v3s = seriesFor(v3runs, id)
  if (v3s.length !== v2s.length || v2s.length === 0) {
    structural.push(`timing: ${id} not measured in both engines on every replicate`)
    continue
  }
  const ratios = v2s.map((v, i) => Math.max(v3s[i], CLAMP_MS) / Math.max(v, CLAMP_MS))
  rows.push({ id, label: t.label, kase: t.case, v2: med(v2s), v3: med(v3s), ratio: med(ratios) })
}
for (const t of v3runs[0].timing) {
  const id = `${t.op}/${t.case}`
  if (!v2runs[0].timing.some((r) => `${r.op}/${r.case}` === id))
    structural.push(`timing: ${id} measured in v3 only`)
}

if (structural.length > 0) {
  console.error(`FAIL: ${structural.length} structural corpus drift issue(s) — the v3 spec table no longer mirrors perf/workloads.ts case-for-case:`)
  for (const s of structural) console.error(`  ${s}`)
  process.exit(1)
}

const fmtMs = (x: number) => (x >= 100 ? x.toFixed(1) : x >= 1 ? x.toFixed(2) : x.toFixed(4))

const out: string[] = []
out.push('### operator perf corpus — v2 vs v3 (informational)')
out.push('')
out.push(
  `N=${v2runs[0].n.toLocaleString('en-US')} · ${REPS} replicate(s) (ABAB, one engine per process) · ` +
    `inner sampling: benchMeasure (1 warmup + gc, median of each case's reps) · node ${process.version}`,
)
out.push(
  `cross-engine end-state equivalence: ${eqCompared} case(s) compared at EQ_N=${v2runs[0].eqN.toLocaleString('en-US')} ` +
    `(${v2runs[0].eqWrites} write-sequence run(s)/case) — ALL EQUAL`,
)
out.push('')
out.push('| operator | case | v2 median | v3 median | ratio (v3/v2) |')
out.push('|---|---|---|---|---|')
for (const r of rows)
  out.push(`| ${r.label} | ${r.kase} | ${fmtMs(r.v2)} ms | ${fmtMs(r.v3)} ms | ${r.ratio.toFixed(3)}× |`)
out.push('')

const finite = rows.filter((r) => Number.isFinite(r.ratio) && r.ratio > 0)
const geo = Math.exp(finite.reduce((a, r) => a + Math.log(r.ratio), 0) / Math.max(finite.length, 1))
const slower = finite.filter((r) => r.ratio > 1)
const faster = finite.filter((r) => r.ratio < 1)
const worst = [...finite].sort((a, b) => b.ratio - a.ratio).slice(0, 3)
out.push(
  `summary: geometric-mean ratio **${geo.toFixed(3)}×** over ${finite.length} rows · ` +
    `v3 faster on ${faster.length} (<1.0×), slower on ${slower.length} (>1.0×)`,
)
out.push(`worst 3 (v3/v2): ${worst.map((r) => `${r.label}/${r.kase} ${r.ratio.toFixed(2)}×`).join(' · ')}`)
out.push('')

// Skip list — merged from both children (shared tables, so normally identical).
const skipMap = new Map<string, SkipRow>()
for (const s of [...v2runs[0].skips, ...v3runs[0].skips]) skipMap.set(`${s.op}/${s.case}`, s)
if (skipMap.size > 0) {
  out.push('skipped (no v3 counterpart / under-sized N):')
  for (const s of skipMap.values()) out.push(`- ${s.op}/${s.case}: ${s.reason}`)
  out.push('')
}

console.log(out.join('\n'))
