// Crossfilter EXAMPLE workload — v2 vs v3, informational REPORT (not a gate).
//
// Replicates the real examples/crossfilter/ app over the real 231,083-row
// flights dataset: the example's exact v2 chain ($(data).map(parse)
// .za('date', Infinity) → between×4 with reactive bounds → intersect(dims) /
// leave-one-out chart intersects → length(bucketFn) → max('value') +
// to(bars) SVG-path builders → limit(80).group(formatDate) + length()) against
// the migrated v3 chain (no full sort; betweenR reactive bounds via
// filters.get(dim); explicit leave-one-out intersects; a bounded
// za('date', 80) window → group(formatDate) → za(byFirstDate) list).
//
// METHODOLOGY (m2-gate.ts's per-process orchestrator pattern — see the child's
// header for the full discipline):
// - one ENGINE per PROCESS; children spawned ABAB, REPS (env, default 5)
//   replicates per engine; ratio = median of per-replicate v3/v2 ratios
// - each child: 36MB dataset import/parse EXCLUDED; deep 10× sweep warmup;
//   gc() before each measured sweep (per-sample, not per sub-ms step);
//   per-step times → median + p95; monotonic never-repeating brush tuples so
//   no write ever hits the Object.is no-op path
// - NO threshold assertions. Exit non-zero ONLY on a child crash or a
//   cross-engine checksum mismatch (checksum = active count + per-chart
//   bucket-count sums per measured step — both engines must select exactly
//   the same rows). The 80-row list is deliberately excluded from the
//   cross-engine checksum: v2's limit(80) is iteration-order-dependent while
//   v3's za('date', 80) is the true top-80 by date — they legitimately differ.
//
// Run (full):        node --experimental-strip-types --no-warnings --expose-gc \
//                      v3/perf/crossfilter-example.bench.ts
// Dev iteration:     FLIGHTS_N=20000 REPS=1 node ... (same command)
//
// ── RESULTS 2026-07-06 (full 231,083 rows, 5 reps, node v26.1.0, WSL2) ───────
// Supersedes the 2026-07-05 table below. Taken AFTER perf(v3/setops) 09adf4a
// (direct parent queries — the mask/prows mirrors died) and
// perf(examples/crossfilter-v3) d63563c (array-born source → minted integer
// keys; the same change is in this bench's v3 child).
//
//   | workload          | v2 median      | v3 median      | ratio (v3/v2) |
//   |-------------------|----------------|----------------|---------------|
//   | setup             | 7769.9 ms      | 5922.5 ms      | 0.616×        |
//   | setup RSS delta   | 166.5 MB       | 237.8 MB       | 1.396×        |
//   | brush_date median | 204.6 ms/step  | 64.2 ms/step   | 0.254×        |
//   | brush_date p95    | 443.8 ms/step  | 104.7 ms/step  | 0.210×        |
//   | brush_delay median| 103.5 ms/step  | 17.7 ms/step   | 0.141×        |
//   | brush_delay p95   | 374.7 ms/step  | 213.9 ms/step  | 0.492×        |
//
// Checksums v2 ≡ v3 (1596228503) on every replicate. vs the 2026-07-05 run:
// v3 setup 8322 → 5923 ms (now 0.62× of v2, was parity), RSS delta 407.7 →
// 237.8 MB (2.45× → 1.40× of v2 — the setops mirrors were the bulk of the
// overhang), brush_date p95 0.251× → 0.210×, brush_delay 0.153× → 0.141×.
// Box note: only rep 1 ran on a fully quiet box (reps 2–5 shared the box with
// test/commit activity; ABAB interleaving keeps the RATIOS honest but inflates
// absolute medians). The quiet-rep-1 absolutes — v3 date 25.9 ms/step, delay
// 10.6 ms/step — are the uncontended floor, approaching the native
// crossfilter2 library measured at 20.9 ms/step on the same box/data/sweep.
//
// ── RESULTS 2026-07-05 (full 231,083 rows, 5 reps, node v26.1.0, WSL2) ───────
// Taken AFTER perf(v3/ordered) 693cd0e — the quadratic this bench surfaced
// (pre-fix, the v3 date sweep did not finish in 30+ CPU-minutes).
//
//   | workload          | v2 median      | v3 median      | ratio (v3/v2) |
//   |-------------------|----------------|----------------|---------------|
//   | setup             | 8085.4 ms      | 8322.4 ms      | 1.052×        |
//   | setup RSS delta   | 166.7 MB       | 407.7 MB       | 2.449×        |
//   | brush_date median | 262.2 ms/step  | 64.1 ms/step   | 0.244×        |
//   | brush_date p95    | 468.4 ms/step  | 117.7 ms/step  | 0.251×        |
//   | brush_delay median| 141.4 ms/step  | 19.9 ms/step   | 0.153×        |
//   | brush_delay p95   | 388.3 ms/step  | 286.2 ms/step  | 0.738×        |
//
// Checksums v2 ≡ v3 (1596228503) on every replicate. Read: brushes 4.1× /
// 6.5× faster at the median; setup parity (v2's includes its za(∞) full
// sort). The 2.4× RSS is the known per-node full-mirror cost (map cache +
// 4 between row-mirrors + intersect prows) — logged in STATUS gaps; the M6
// columnar backing is the planned answer.

import { spawnSync } from 'node:child_process'

interface SweepResult {
  median_ms: number
  p95_ms: number
}
interface ChildResult {
  mode: string
  rows: number
  setup_ms: number
  rss_delta_mb: number
  brush_date: SweepResult
  brush_delay: SweepResult
  checksum: number
  extra: number
}

const childPath = new URL('./crossfilter-example.child.ts', import.meta.url).pathname
const REPS = Number(process.env.REPS ?? '5')

function runChild(mode: 'v2' | 'v3'): ChildResult {
  const res = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', '--expose-gc', childPath, mode],
    { encoding: 'utf8', maxBuffer: 1 << 26 },
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
  const last = lines[lines.length - 1]
  try {
    return JSON.parse(last) as ChildResult
  } catch {
    process.stderr.write(res.stdout)
    console.error(`FAIL: ${mode} child produced unparseable output`)
    process.exit(1)
  }
}

function med(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[s.length >> 1]
}

// ── ABAB replicates ───────────────────────────────────────────────────────────

const v2runs: ChildResult[] = []
const v3runs: ChildResult[] = []
const issues: string[] = []

for (let i = 0; i < REPS; i++) {
  const a = runChild('v2')
  v2runs.push(a)
  process.stderr.write(
    `rep ${i + 1}/${REPS} v2: setup ${a.setup_ms.toFixed(0)} ms, date ${a.brush_date.median_ms.toFixed(3)} ms/step, delay ${a.brush_delay.median_ms.toFixed(3)} ms/step\n`,
  )
  const b = runChild('v3')
  v3runs.push(b)
  process.stderr.write(
    `rep ${i + 1}/${REPS} v3: setup ${b.setup_ms.toFixed(0)} ms, date ${b.brush_date.median_ms.toFixed(3)} ms/step, delay ${b.brush_delay.median_ms.toFixed(3)} ms/step\n`,
  )
  if (a.checksum !== b.checksum) {
    console.error(
      `FAIL: cross-engine checksum mismatch at rep ${i + 1} — v2 ${a.checksum} vs v3 ${b.checksum} (the engines selected different rows)`,
    )
    process.exit(1)
  }
}

// Intra-engine determinism (informational — the workload is fully deterministic,
// so any drift here flags a real nondeterminism bug in an engine).
for (const [name, runs] of [['v2', v2runs], ['v3', v3runs]] as const) {
  const cs = new Set(runs.map((r) => r.checksum))
  if (cs.size > 1) issues.push(`${name} checksum drifted across reps: ${[...cs].join(', ')}`)
  const ex = new Set(runs.map((r) => r.extra))
  if (ex.size > 1) issues.push(`${name} extra (list/bars) accumulator drifted across reps: ${[...ex].join(', ')}`)
}

// ── report ────────────────────────────────────────────────────────────────────

interface RowSpec {
  label: string
  unit: string
  get: (r: ChildResult) => number
}
const rows: RowSpec[] = [
  { label: 'setup', unit: 'ms', get: (r) => r.setup_ms },
  { label: 'setup RSS delta', unit: 'MB', get: (r) => r.rss_delta_mb },
  { label: 'brush_date median', unit: 'ms/step', get: (r) => r.brush_date.median_ms },
  { label: 'brush_date p95', unit: 'ms/step', get: (r) => r.brush_date.p95_ms },
  { label: 'brush_delay median', unit: 'ms/step', get: (r) => r.brush_delay.median_ms },
  { label: 'brush_delay p95', unit: 'ms/step', get: (r) => r.brush_delay.p95_ms },
]

function fmt(x: number): string {
  return Math.abs(x) >= 100 ? x.toFixed(1) : x.toFixed(3)
}

const ratioOf: Record<string, number> = {}
const lines: string[] = []
lines.push(`### crossfilter example workload — v2 vs v3 (informational)`)
lines.push('')
lines.push(
  `rows: ${v2runs[0].rows.toLocaleString('en-US')} · reps: ${REPS} (ABAB, one engine per process) · node ${process.version}`,
)
lines.push('')
lines.push(`| workload | v2 median | v3 median | ratio (v3/v2) |`)
lines.push(`|---|---|---|---|`)
for (const spec of rows) {
  const v2s = v2runs.map(spec.get)
  const v3s = v3runs.map(spec.get)
  const ratios = v2s.map((v, i) => v3s[i] / v)
  const ok = v2s.every((v) => Number.isFinite(v) && v > 0)
  const ratio = ok ? med(ratios) : NaN
  ratioOf[spec.label] = ratio
  lines.push(
    `| ${spec.label} | ${fmt(med(v2s))} ${spec.unit} | ${fmt(med(v3s))} ${spec.unit} | ${Number.isFinite(ratio) ? ratio.toFixed(3) + '×' : 'n/a'} |`,
  )
}
lines.push('')
lines.push(`- checksums match: v2 ≡ v3 ≡ \`${v2runs[0].checksum}\` on every replicate`)
lines.push(
  `  (active count + per-chart bucket-count sums per measured step — both engines select exactly the same rows).`,
)
lines.push(
  `- v2 setup INCLUDES the example's \`za('date', Infinity)\` full sort of all rows — the honest example cost; the v3 graph has no full sort.`,
)
lines.push(
  `- the 80-row list is EXCLUDED from the cross-engine checksum: v2's \`limit(80)\` is iteration-order-dependent, v3's \`za('date', 80)\` is the true top-80 by date — they legitimately differ (each engine's list read is deterministic across reps and folded into its own \`extra\` accumulator instead).`,
)
lines.push(`- RSS delta is informational (gc'd retained graph state after setup); report, not a gate.`)
if (issues.length > 0) {
  lines.push('')
  lines.push(`issues:`)
  for (const s of issues) lines.push(`- ${s}`)
}

console.log(lines.join('\n'))
