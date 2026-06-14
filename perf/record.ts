// @ts-nocheck
// perf/record.ts — durable emission side-channel for the perf REPORT.
//
// Each record() appends ONE JSON line to perf/results/<run-id>/<harness>.jsonl.
// There is deliberately NO module-level buffer and NO end-of-run flush: an
// immediate append is durable under ABNORMAL exit (a failing ok() that aborts
// the worker, process.exit, OOM, a signal) — a buffered writer flushed at exit
// would lose its rows there. (`node --test` forks a worker per file and those
// workers DO run user exit/beforeExit listeners on Node 26 — the immediate
// append just doesn't need them.) The report sweeps run in their own process
// (perf/run-report.ts) and use this same API, so there is one way to emit a row.
//
// The run-id is threaded in by perf/_run.mjs via PERF_RUN_ID so every stage
// (sweep + collate) shares one results dir; run directly and it falls back to a
// local-<ts> dir. The collator perf/gen-report.mjs globs the dir into perf.json.
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))) // perf/ -> repo root

export const runId = process.env.PERF_RUN_ID || `local-${Date.now()}`
export const resultsDir = join(ROOT, 'perf', 'results', runId)
mkdirSync(resultsDir, { recursive: true })

// One universal row shape — see perf/run-report.ts header and the report page.
// Per-harness specialization lives under `dims`, never a new top-level field.
//   { id, harness, op, case, kind:'timing'|'count'|'bool'|'ratio'|'attr',
//     unit, value, dims:{…}, stats?:{…}, instrument?:{…}, frames?:[…] }
export function record(row) {
  const harness = row.harness || 'misc'
  appendFileSync(join(resultsDir, `${harness}.jsonl`), JSON.stringify(row) + '\n')
}
