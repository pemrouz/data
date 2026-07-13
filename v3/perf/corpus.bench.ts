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
// ── RESULTS 2026-07-13 (full sweep, quiet box, REPS=5, N=10,000, node v26.1.0) ─
//
// READ THIS WITH THE WORKLOAD SHAPE IN MIND: the corpus is deliberately
// UNBATCHED write-for-write parity (1000 bare writes = 1000 v3 commits, where
// v2 dispatches each write directly) — the WORST framing for v3's
// commit/settle architecture, chosen because it is the apples-to-apples
// per-write comparison. The pattern inside the geomean:
// - SETUP is the remaining slow class (tap 10.0x, to 7.8x, map 3.4x,
//   filter 3.2x ...) — one-time graph-construction costs. The 2026-07-13
//   hotspot pass removed the per-operator snapshot() Map copies (the
//   each()/rowCount() no-copy read protocol); the residual is EAGER STORE
//   INGESTION at $() (v2 lazily wraps a proxy; v3 builds the keyed store
//   up front) plus node minting — the M6 columnar/lazy-ingest item is the
//   structural lever, not more constructor shaving.
// - SINGLE-WRITE cases sit at parity or FAVOR v3: filter/single 1.12x,
//   map/insert 0.89x, length/insert 0.79x, gt-insert 0.75x, max-insert
//   0.50x, sum-insert 0.94x, keys 1.00x, to/insert 1.14x.
// - v3's structural wins are large where v2 is architecturally worse:
//   sort/brush 0.18x, values/batch 0.006x (identity passthrough — documented
//   inherent difference), between/setup 0.45x, min-batch 0.43x,
//   reduce/insert 0.43x, reduce/batch 0.55x, sum-column-move 0.66x.
// - THE 2026-07-13 HOTSPOT PASS (STATUS gap 8) closed the named per-write
//   outliers of the 2026-07-10 baseline: group/insert 10.96x → 2.45x
//   (maintained enumeration-order bucket key lists — numeric-ascending
//   object fills stay on V8 fast elements — plus an O(1) membership-size
//   changed-detector before the O(B) compare); to/insert 4.77x → 1.14x and
//   to/batch 6.20x → 0.99x (ToValueNode hands fn an incrementally-maintained
//   plain mirror instead of snapshot()+materialize per batch); reduce/batch
//   1.80x → 0.55x and reduce/insert 1.30x → 0.43x (the 2-arg fold folds via
//   the no-copy each() pass). The ~2x group residual is the v3 emission
//   contract itself: fresh immutable bucket objects per touch vs v2's
//   in-place bucket mutation — inherent, not a defect.
// - Remaining named rows for a future pass: distinct/batch 3.91x,
//   except/remove-other 3.03x, between/remove 2.81x, group/churn 2.78x,
//   union/intersect churn ~2.2-2.3x — all set-op/bucket write paths.
// - REALISTIC (batched, re-reading) shapes are the m1/m2 gates and the
//   example benches, which all favor v3: m1 chain 0.71x, m2 brush ~1.06x /
//   batch ~0.80x, crossfilter example 0.25x/0.14x, swarm frames 0.26 ms.
//   Flip evidence = this table AND those, together.
//
// ### operator perf corpus — v2 vs v3 (informational)
//
// N=10,000 · 5 replicate(s) (ABAB, one engine per process) · inner sampling: benchMeasure (1 warmup + gc, median of each case's reps) · node v26.1.0
// cross-engine end-state equivalence: 42 case(s) compared at EQ_N=10,000 (2 write-sequence run(s)/case) — ALL EQUAL
//
// | operator | case | v2 median | v3 median | ratio (v3/v2) |
// |---|---|---|---|---|
// | filter | setup | 1.55 ms | 5.15 ms | 3.184× |
// | filter | single | 0.1160 ms | 0.1348 ms | 1.124× |
// | filter | batch | 2.55 ms | 2.74 ms | 1.136× |
// | map | setup | 1.61 ms | 5.48 ms | 3.392× |
// | map | insert | 0.1177 ms | 0.1045 ms | 0.890× |
// | to | setup | 0.5351 ms | 4.86 ms | 7.772× |
// | to | insert | 0.3837 ms | 0.3680 ms | 1.138× |
// | to | batch | 166.8 ms | 170.7 ms | 0.992× |
// | length | insert | 0.0803 ms | 0.0637 ms | 0.793× |
// | length(fn) | setup | 1.92 ms | 5.84 ms | 2.597× |
// | keys | setup | 1.53 ms | 4.81 ms | 3.059× |
// | keys | insert | 0.0853 ms | 0.0868 ms | 0.996× |
// | values | setup | 1.10 ms | 3.90 ms | 2.968× |
// | values | batch | 58.17 ms | 0.3535 ms | 0.006× |
// | tap | setup | 0.2994 ms | 3.87 ms | 10.001× |
// | tap | insert | 0.1355 ms | 0.1494 ms | 1.050× |
// | tap | batch | 3.32 ms | 4.11 ms | 1.371× |
// | tap | bare | 2.21 ms | 2.43 ms | 1.184× |
// | distinct | setup | 4.40 ms | 7.98 ms | 1.700× |
// | distinct | insert | 0.0909 ms | 0.1106 ms | 1.180× |
// | distinct | batch | 0.2256 ms | 0.9559 ms | 3.908× |
// | group | setup | 4.99 ms | 9.72 ms | 1.947× |
// | group | insert | 0.1157 ms | 0.2796 ms | 2.448× |
// | group | churn | 0.0788 ms | 0.2140 ms | 2.777× |
// | compare | gt-setup | 1.91 ms | 5.03 ms | 2.351× |
// | compare | gt-insert | 0.0964 ms | 0.0753 ms | 0.749× |
// | compare | gt-batch | 2.90 ms | 2.73 ms | 0.942× |
// | compare | gt-threshold-move | 4.20 ms | 5.05 ms | 1.166× |
// | compare | lt-setup | 1.86 ms | 5.08 ms | 2.672× |
// | compare | gte-setup | 2.17 ms | 5.08 ms | 2.364× |
// | compare | lte-setup | 2.04 ms | 5.11 ms | 2.503× |
// | between | setup | 13.86 ms | 6.61 ms | 0.446× |
// | between | narrow | 3.53 ms | 5.61 ms | 1.656× |
// | between | insert | 2.42 ms | 3.09 ms | 1.469× |
// | between | remove | 1.28 ms | 3.67 ms | 2.811× |
// | sort | setup | 16.49 ms | 23.59 ms | 1.269× |
// | sort | insert | 0.1454 ms | 0.2119 ms | 1.468× |
// | sort | rotate | 0.1519 ms | 0.2504 ms | 1.459× |
// | sort | brush | 67.10 ms | 14.82 ms | 0.179× |
// | sort | window-move | 0.3106 ms | 0.4145 ms | 1.329× |
// | aggregate | sum-setup | 4.48 ms | 7.19 ms | 1.535× |
// | aggregate | sum-insert | 0.1013 ms | 0.1031 ms | 0.935× |
// | aggregate | avg-batch | 2.49 ms | 3.41 ms | 1.362× |
// | aggregate | max-setup | 6.29 ms | 6.02 ms | 0.843× |
// | aggregate | max-insert | 0.1796 ms | 0.0972 ms | 0.501× |
// | aggregate | min-batch | 1.52 ms | 0.6285 ms | 0.425× |
// | aggregate | some-setup | 4.67 ms | 5.70 ms | 1.212× |
// | aggregate | every-batch | 2.39 ms | 3.00 ms | 1.223× |
// | aggregate | sum-column-move | 7.61 ms | 4.47 ms | 0.661× |
// | union | setup | 12.04 ms | 20.43 ms | 1.696× |
// | union | churn | 2.72 ms | 5.81 ms | 2.233× |
// | union | insert | 1.75 ms | 3.04 ms | 1.821× |
// | intersect | setup | 10.38 ms | 10.44 ms | 0.947× |
// | intersect | churn | 2.42 ms | 5.06 ms | 2.282× |
// | except | setup | 2.30 ms | 7.33 ms | 3.255× |
// | except | insert-other | 1.58 ms | 2.22 ms | 1.406× |
// | except | remove-other | 1.15 ms | 3.41 ms | 3.029× |
// | reduce | setup | 1.84 ms | 4.14 ms | 2.431× |
// | reduce | insert | 1.14 ms | 0.5145 ms | 0.428× |
// | reduce | batch | 62.45 ms | 35.03 ms | 0.551× |
// | reduce | inc-setup | 4.18 ms | 4.19 ms | 1.126× |
// | reduce | inc-insert | 0.1015 ms | 0.0989 ms | 0.931× |
// | reduce | inc-overwrite | 0.2250 ms | 0.3582 ms | 1.412× |
// | reduce | inc-remove | 0.2629 ms | 0.3969 ms | 1.560× |
//
// summary: geometric-mean ratio **1.338×** over 64 rows · v3 faster on 18 (<1.0×), slower on 46 (>1.0×)
// worst 3 (v3/v2): tap/setup 10.00× · to/setup 7.77× · distinct/batch 3.91×
//
// skipped (no v3 counterpart / under-sized N):
// - reverse/*: v3 reserves `reverse` (unimplemented at the flip — throws "reserved name reverse has no implementation yet"); no counterpart to time
// - filter/value-move: v2's reactive equality-value filter('active', $(bool)) has no v3 operator counterpart — the v3 idiom (transient filter + mirror() + dispose(), MIGRATION §3.1/§5.2) is a structurally different graph, not comparable 1:1
//

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
