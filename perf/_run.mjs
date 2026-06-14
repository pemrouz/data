// perf/_run.mjs — the one orchestrator behind `npm run perf:report`.
// Threads a single run-id through both stages and launches the sweep with
// --expose-gc (the gate `npm run perf` runs WITHOUT it; any global.gc() lives
// only here, never in the gate command).
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
// Second-resolution stamp + short random so back-to-back runs (e.g. accumulating
// history, or two runs in one minute) get distinct run dirs and distinct history
// lines instead of colliding on one minute-resolution id.
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const rand = Math.random().toString(36).slice(2, 5)
let commit = 'nogit'
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim()
} catch {}
const runId = `${stamp}Z-${commit}-${rand}`
const env = { ...process.env, PERF_RUN_ID: runId }
const run = (file, flags = []) =>
  execFileSync('node', [...flags, join(ROOT, 'perf', file)], { cwd: ROOT, env, stdio: 'inherit' })

console.log(`[perf:report] run ${runId}`)
run('run-report.ts', ['--experimental-strip-types', '--no-warnings', '--expose-gc'])
run('gen-report.mjs')
console.log('[perf:report] open examples/perf/ (npm run serve, then /examples/perf/)')
