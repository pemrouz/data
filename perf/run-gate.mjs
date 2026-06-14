// perf/run-gate.mjs — the gate runner behind `npm run perf`. Globs the *.perf.ts
// gate tests and runs them under `node --test`, replacing the old explicit
// 3-pattern file list in package.json (which silently ungated any new file —
// e.g. experiments/fusion/multidim-shape.perf.ts, render/*.perf.ts).
//
// SCOPE DECISION (documented, not accidental): experiments/ is deliberately
// EXCLUDED — experimental code, not a gate. Everything else carrying a *.perf.ts
// is gated, so a future render/core/perf test is picked up automatically instead
// of being forgotten. comparisons/ is included (a perf test there would be gated;
// its *.bench.ts files are not *.perf.ts and never ran here anyway).
import { globSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const patterns = [
  'index.perf.ts',
  'core.perf.ts',
  'operators/**/*.perf.ts',
  'render/**/*.perf.ts',
  'devtools/**/*.perf.ts',
  'comparisons/**/*.perf.ts',
  'perf/**/*.perf.ts',
]
const files = [...new Set(patterns.flatMap(p => globSync(p)))].sort()
if (!files.length) {
  console.error('[run-gate] no *.perf.ts files found')
  process.exit(1)
}
console.log(`[run-gate] ${files.length} gate file(s); experiments/ excluded by design`)
const res = spawnSync(
  'node',
  ['--experimental-strip-types', '--no-warnings', '--test', ...files],
  { stdio: 'inherit' },
)
process.exit(res.status ?? 1)
