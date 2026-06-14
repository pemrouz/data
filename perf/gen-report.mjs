// perf/gen-report.mjs — collate the JSONL the sweep emitted into the single
// committed artifact the report page fetches, and append one capped line to the
// trend store. Mirrors comparisons/bench/operators/_gen-bench-md.mjs's
// read→derive→write shape, but emits JSON (not re-parsed markdown).
//
//   perf/results/<run-id>/*.jsonl  →  perf/perf.json
//                                  →  perf/history.jsonl  (last ≈100 runs)
//
// Run via `node perf/gen-report.mjs` (PERF_RUN_ID picks the run dir; falls back
// to the most recently modified one). gen-report is the SOLE writer of perf.json
// and history.jsonl.
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const RESULTS = join(ROOT, 'perf', 'results')
const OUT = join(ROOT, 'perf', 'perf.json')
const HISTORY = join(ROOT, 'perf', 'history.jsonl')
const HISTORY_CAP = 100

const TITLES = {
  ops: 'operators',
  H0: 'provenance',
  H1: 'complexity / scaling',
  H2: 'chain depth',
  H3: 'correctness',
  H4: 'interactive tail',
  H5: 'retention / gc',
  H6: 'self-regression',
  H7: 'cross-library',
}

function latestRun() {
  if (process.env.PERF_RUN_ID) return process.env.PERF_RUN_ID
  const dirs = readdirSync(RESULTS).filter(d => statSync(join(RESULTS, d)).isDirectory())
  if (!dirs.length) throw new Error('no run dirs under perf/results/ — run the sweep first')
  return dirs.sort((a, b) => statSync(join(RESULTS, b)).mtimeMs - statSync(join(RESULTS, a)).mtimeMs)[0]
}

function git(cmd, fallback) {
  try {
    return execSync(`git ${cmd}`, { cwd: ROOT }).toString().trim()
  } catch {
    return fallback
  }
}

const runId = latestRun()
const runDir = join(RESULTS, runId)
const meta = existsSync(join(runDir, '_meta.json'))
  ? JSON.parse(readFileSync(join(runDir, '_meta.json'), 'utf8'))
  : {}

const harnesses = {}
for (const file of readdirSync(runDir)) {
  if (!file.endsWith('.jsonl')) continue
  const key = file.replace(/\.jsonl$/, '')
  const rows = readFileSync(join(runDir, file), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l))
  harnesses[key] = { title: TITLES[key] || key, rows }
}

// H7 (cross-library) is generated separately from the committed
// operators/<op>/BENCHMARK.md tables (perf/gen-h7.mjs → perf/h7.jsonl), not from
// the per-sweep run dir — running the peer suite takes minutes, so it refreshes
// on the BENCHMARK.md cadence. Inject it so every perf.json carries the tile.
const H7_PATH = join(ROOT, 'perf', 'h7.jsonl')
if (existsSync(H7_PATH)) {
  const h7rows = readFileSync(H7_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  if (h7rows.length) harnesses.H7 = { title: TITLES.H7 || 'H7', rows: h7rows }
}

const run = {
  id: runId,
  commit: git('rev-parse --short HEAD', 'unknown'),
  branch: git('rev-parse --abbrev-ref HEAD', 'unknown'),
  dirty: git('status --porcelain', '') !== '',
  node: meta.node || process.version,
  gc: meta.gc ?? false,
  ts: meta.ts || Date.now(),
}

// Trend store: one capped line per run (point = each row's headline value).
// The durable changelog is perf/history.jsonl (git-log-friendly); the page gets
// the same recent tail EMBEDDED in perf.json, so it fetches one file for
// current-run + harnesses + history and computes the standardised columns.
// The whole standardisation keys on row id; a within-run collision would
// silently keep only the last sample, so assert uniqueness loudly.
const points = {}
for (const { rows } of Object.values(harnesses))
  for (const r of rows) {
    if (typeof r.value !== 'number') continue
    if (r.id in points) throw new Error(`duplicate row id within run: ${r.id}`)
    points[r.id] = r.value
  }
let history = existsSync(HISTORY)
  ? readFileSync(HISTORY, 'utf8').split('\n').filter(Boolean)
  : []
history.push(JSON.stringify({ run: { id: run.id, commit: run.commit, ts: run.ts }, points }))
history = history.slice(-HISTORY_CAP)
writeFileSync(HISTORY, history.join('\n') + '\n')

const embeddedHistory = history.slice(-40).map(l => JSON.parse(l))
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify({ schema: 1, run, harnesses, history: embeddedHistory }, null, 2) + '\n')

const nRows = Object.values(harnesses).reduce((n, h) => n + h.rows.length, 0)
console.log(
  `[gen-report] ${Object.keys(harnesses).length} harness(es), ${nRows} row(s) → perf/perf.json (run ${run.commit}${run.dirty ? '-dirty' : ''})`,
)
