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
// ── RESULTS (placeholder — fill from the full sweep) ─────────────────────────
// (run the full sweep on a QUIET box — REPS=5, default N=10000 — and paste the
// printed markdown table + summary + skip list here, dated, node version
// noted. Until then the numbers below any older date are the standing record.)

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
