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
// ── 2026-07-28 M6 PHASE 2 movement (adopted-object store) — geomean 0.940× ──
//
// The adopted-object backing landed ($(obj) keeps the caller's object as the
// row table + lazy Object.keys; keySlot/slots built by one-shot promote() on
// the first structural write; reverse() adopts arrival order without the
// comparator sort). Full REPS=5 sweep, 67 rows, eq 44/44 ALL EQUAL:
// geometric mean 1.223× → 0.940× — v3 is now FASTER than v2 on the corpus
// geomean. The setup class largely closed: tap/setup 12.5× → 1.13×,
// values/setup → 0.24× (v3 ahead), filter/setup 3.34× → 1.99×, to/setup
// 9.9× → ~3× (noise-borderline: v2's sub-ms denominator halves run to run),
// map/setup 4.0× → 1.90×. What remains >2× is NODE-STATE construction, not
// ingestion (cpu-profiled): reverse/setup 4.18× ≈ OrderedView's rows/tie
// Map fills (M6 Phase 5 deletes them), keys 2.35× / length(fn) 2.89× ≈ the
// same per-node materialization family, group/insert 2.50× / between,
// setops remove-side ≈ the standing two-phase-commit floor. Per-write rows
// moved within the box-noise envelope of the 07-27 table (this box's v2
// absolutes swing 40%+ run-to-run; the between rows were same-box
// A/B-verified no-mechanism under Phase 1). The promote spike is gated in
// commit.bench.ts (first structural write after adopt, N=10k: ~4 ms < 5 ms
// budget). Full table re-baseline lands with M6 Phase 6; the 07-27 table
// below remains the standing pre-M6 baseline.
//
// ── RESULTS 2026-07-27 (full sweep, quiet box, REPS=5, N=10,000, node v26.1.0) ─
//
// READ THIS WITH THE WORKLOAD SHAPE IN MIND: the corpus is deliberately
// UNBATCHED write-for-write parity (1000 bare writes = 1000 v3 commits, where
// v2 dispatches each write directly) — the WORST framing for v3's
// commit/settle architecture, chosen because it is the apples-to-apples
// per-write comparison. The pattern inside the geomean:
// - SETUP is the remaining slow class (tap 12.5x, to 9.9x, reverse 5.4x,
//   length(fn) 4.3x ...) — one-time graph construction; v3 ABSOLUTES kept
//   improving across the two hotspot passes while v2's sub-ms denominators
//   shrank faster on a quiet box, so the RATIOS read worse than the trend.
//   The residual is EAGER STORE INGESTION at $() plus node minting — the M6
//   columnar/lazy-ingest item is the structural lever.
// - SINGLE-WRITE cases sit at parity or FAVOR v3: filter/single 1.17x,
//   map/insert 0.88x, length/insert 0.91x, gt-insert 0.73x, max-insert
//   0.50x, sum-insert 0.87x, tap/insert 1.00x, distinct/insert 0.97x,
//   sort/insert 0.98x, keys 1.05x.
// - v3's structural wins: sort/brush 0.14x, values/batch 0.006x,
//   reverse/batch 0.008x (v2 rebuilds the whole reversed array per update;
//   v3 forwards cmp-blind updates O(1)), min-batch 0.30x, reduce/insert
//   0.32x, reduce/batch 0.52x, sum-column-move 0.63x, between/setup 0.50x.
// - THE 2026-07-27 HOTSPOT PASS 2 (STATUS gap 8, second round — diagnosis by
//   a read-only agent panel, fixes commit a134649..11a271d): distinct/batch
//   3.91x → 1.29x (settle-time touched cut-offs — a non-projection update or
//   an occupied-bucket admit provably can't move the exposed value, so the
//   O(holders) _exposed rescan is skipped); union/churn 2.23x → 1.42x and
//   intersect/churn 2.28x → 1.85x (setops single-delta fast path — a
//   suppressed outcome allocates nothing — plus scratch reuse and each()
//   seeding); group/churn 2.78x → 2.00x (ordered window-untouched early-out);
//   between/remove 2.81x → 2.42x and except/remove-other 3.03x → 2.61x (the
//   API handle de-fat: shared proxy handler + lazy per-verb methods + lazy
//   caches took a fresh-key get(k).remove() from ~30 allocations to ~6-8).
//   sort/insert 1.47x → 0.98x came free from the reverse work (the unbounded
//   single-delta fast path, commit b43db87).
// - What remains, and why: group/insert 2.39x is the fresh-immutable-bucket
//   emission contract vs v2's in-place mutation (inherent, documented);
//   the remove-side residuals (between/remove 2.42x, except/remove-other
//   2.61x, group/churn 2.00x) measure a full two-phase commit against v2's
//   bare delete-plus-dirty-flag dispatch — the honest per-commit floor at
//   this framing; setup rows are the M6 class above.
// - REALISTIC (batched, re-reading) shapes are the m1/m2 gates and the
//   example benches, which all favor v3: m1 chain ~0.70x, m2 brush ~1.05x /
//   batch ~0.72x, crossfilter example 0.25x/0.14x, swarm frames 0.26 ms.
//   Flip evidence = this table AND those, together.
//
// ### operator perf corpus — v2 vs v3 (informational)
//
// N=10,000 · 5 replicate(s) (ABAB, one engine per process) · inner sampling: benchMeasure (1 warmup + gc, median of each case's reps) · node v26.1.0
// cross-engine end-state equivalence: 44 case(s) compared at EQ_N=10,000 (2 write-sequence run(s)/case) — ALL EQUAL
//
// | operator | case | v2 median | v3 median | ratio (v3/v2) |
// |---|---|---|---|---|
// | filter | setup | 1.25 ms | 4.59 ms | 3.340× |
// | filter | single | 0.0870 ms | 0.1339 ms | 1.173× |
// | filter | batch | 1.97 ms | 2.28 ms | 1.112× |
// | map | setup | 1.44 ms | 5.50 ms | 4.029× |
// | map | insert | 0.0987 ms | 0.0852 ms | 0.881× |
// | to | setup | 0.4628 ms | 4.40 ms | 9.859× |
// | to | insert | 0.3371 ms | 0.3690 ms | 1.168× |
// | to | batch | 144.7 ms | 152.3 ms | 1.068× |
// | length | insert | 0.0673 ms | 0.0619 ms | 0.911× |
// | length(fn) | setup | 1.14 ms | 4.92 ms | 4.346× |
// | keys | setup | 1.32 ms | 4.22 ms | 4.012× |
// | keys | insert | 0.0736 ms | 0.0822 ms | 1.045× |
// | values | setup | 0.9658 ms | 3.06 ms | 3.340× |
// | values | batch | 51.81 ms | 0.3174 ms | 0.006× |
// | tap | setup | 0.2421 ms | 3.32 ms | 12.475× |
// | tap | insert | 0.1296 ms | 0.1290 ms | 0.995× |
// | tap | batch | 3.17 ms | 3.57 ms | 1.126× |
// | tap | bare | 1.76 ms | 1.86 ms | 1.054× |
// | reverse | setup | 1.10 ms | 6.34 ms | 5.422× |
// | reverse | insert | 0.0965 ms | 0.1727 ms | 1.776× |
// | reverse | batch | 44.77 ms | 0.3756 ms | 0.008× |
// | distinct | setup | 4.55 ms | 7.53 ms | 1.684× |
// | distinct | insert | 0.0898 ms | 0.0715 ms | 0.965× |
// | distinct | batch | 0.2395 ms | 0.3124 ms | 1.292× |
// | group | setup | 4.50 ms | 8.23 ms | 1.938× |
// | group | insert | 0.1116 ms | 0.2673 ms | 2.392× |
// | group | churn | 0.0690 ms | 0.1312 ms | 2.001× |
// | compare | gt-setup | 1.56 ms | 5.22 ms | 2.997× |
// | compare | gt-insert | 0.0925 ms | 0.0674 ms | 0.729× |
// | compare | gt-batch | 2.22 ms | 2.16 ms | 1.013× |
// | compare | gt-threshold-move | 3.75 ms | 4.59 ms | 1.250× |
// | compare | lt-setup | 1.71 ms | 4.53 ms | 2.496× |
// | compare | gte-setup | 1.94 ms | 4.45 ms | 2.293× |
// | compare | lte-setup | 1.73 ms | 5.41 ms | 2.539× |
// | between | setup | 12.36 ms | 6.36 ms | 0.498× |
// | between | narrow | 2.20 ms | 4.98 ms | 2.277× |
// | between | insert | 2.23 ms | 3.23 ms | 1.450× |
// | between | remove | 1.10 ms | 2.69 ms | 2.420× |
// | sort | setup | 13.11 ms | 18.91 ms | 1.456× |
// | sort | insert | 0.1242 ms | 0.1129 ms | 0.984× |
// | sort | rotate | 0.1247 ms | 0.2140 ms | 1.663× |
// | sort | brush | 62.57 ms | 9.29 ms | 0.141× |
// | sort | window-move | 0.2804 ms | 0.3649 ms | 1.202× |
// | aggregate | sum-setup | 4.12 ms | 5.07 ms | 1.250× |
// | aggregate | sum-insert | 0.0964 ms | 0.0817 ms | 0.874× |
// | aggregate | avg-batch | 2.52 ms | 2.75 ms | 1.052× |
// | aggregate | max-setup | 5.12 ms | 5.04 ms | 0.958× |
// | aggregate | max-insert | 0.1625 ms | 0.0819 ms | 0.504× |
// | aggregate | min-batch | 2.01 ms | 0.5105 ms | 0.301× |
// | aggregate | some-setup | 4.68 ms | 5.39 ms | 1.112× |
// | aggregate | every-batch | 2.18 ms | 2.56 ms | 1.100× |
// | aggregate | sum-column-move | 6.62 ms | 4.39 ms | 0.627× |
// | union | setup | 10.65 ms | 16.55 ms | 1.435× |
// | union | churn | 2.71 ms | 3.66 ms | 1.420× |
// | union | insert | 1.56 ms | 2.47 ms | 1.580× |
// | intersect | setup | 4.65 ms | 8.54 ms | 1.756× |
// | intersect | churn | 2.05 ms | 3.92 ms | 1.849× |
// | except | setup | 2.04 ms | 5.93 ms | 2.870× |
// | except | insert-other | 1.40 ms | 1.95 ms | 1.394× |
// | except | remove-other | 0.9687 ms | 2.52 ms | 2.606× |
// | reduce | setup | 1.54 ms | 3.79 ms | 2.555× |
// | reduce | insert | 1.02 ms | 0.3366 ms | 0.320× |
// | reduce | batch | 55.51 ms | 28.37 ms | 0.520× |
// | reduce | inc-setup | 3.68 ms | 3.55 ms | 0.965× |
// | reduce | inc-insert | 0.0901 ms | 0.0795 ms | 0.919× |
// | reduce | inc-overwrite | 0.2174 ms | 0.2408 ms | 1.160× |
// | reduce | inc-remove | 0.2278 ms | 0.2698 ms | 1.262× |
//
// summary: geometric-mean ratio **1.223×** over 67 rows · v3 faster on 19 (<1.0×), slower on 48 (>1.0×)
// worst 3 (v3/v2): tap/setup 12.47× · to/setup 9.86× · reverse/setup 5.42×
//
// skipped (no v3 counterpart / under-sized N):
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
