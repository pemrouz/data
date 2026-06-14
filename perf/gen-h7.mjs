// perf/gen-h7.mjs — H7 (cross-library) rows for the perf report, parsed from
// the committed operators/<op>/BENCHMARK.md tables (the source of truth for the
// peer comparison). Decoupled from the timing sweep on purpose: running
// bench:ops loads ~9 peer libraries and takes ~minutes, so H7 is refreshed on
// the SAME cadence as the BENCHMARK.md files (run `npm run bench:ops`, then
// `_gen-bench-md.mjs`, then this), NOT on every `npm run perf:report`.
//
//   operators/<op>/BENCHMARK.md  →  perf/h7.jsonl  (committed)
//
// gen-report.mjs reads perf/h7.jsonl (if present) and injects it as the H7
// harness into every perf.json, so the cross-library tile is always current to
// the last benchmark refresh without re-running the peer suite.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OPS_DIR = join(ROOT, 'operators')
const OUT = join(ROOT, 'perf', 'h7.jsonl')

// "**0.008**" → 0.008 ; "36.3×" → 36.3 ; "—" → null
const num = s => {
  const m = String(s).replace(/\*/g, '').replace(/×/g, '').trim()
  return m === '—' || m === '' ? null : parseFloat(m)
}

const rows = []
for (const op of readdirSync(OPS_DIR).sort()) {
  const md = join(OPS_DIR, op, 'BENCHMARK.md')
  if (!existsSync(md)) continue
  const lines = readFileSync(md, 'utf8').split('\n')
  const hi = lines.findIndex(l => /^\| Library \| Setup/.test(l))
  if (hi < 0) continue
  const peers = []
  let dataSingle = null, dataBatch = null
  for (let i = hi + 2; i < lines.length; i++) {        // +2 skips header + separator
    const l = lines[i].trim()
    if (!l.startsWith('|')) break
    const cells = l.split('|').slice(1, -1).map(c => c.trim())
    if (cells.length < 6) continue
    const lib = cells[0].replace(/\*/g, '').trim()
    const single = num(cells[2]), singleX = num(cells[3]), batch = num(cells[4]), batchX = num(cells[5])
    if (lib === 'data') { dataSingle = single; dataBatch = batch; continue }
    peers.push({ lib, single, singleX, batch, batchX })
  }
  if (!peers.length || dataSingle == null) continue
  // closest competitor = smallest single-tick "vs data" multiplier
  const closest = peers.reduce((a, b) => ((b.singleX ?? Infinity) < (a.singleX ?? Infinity) ? b : a))
  rows.push({
    id: `${op}/cross-lib`, harness: 'H7', group: op, op, case: 'cross-lib',
    kind: 'ratio', dir: 'up', unit: '×', value: closest.singleX,   // higher = bigger lead
    dims: { metric: 'single-tick', peers: peers.length, N: 10000 },
    stats: { 'data (ms)': dataSingle, closest: closest.lib, 'closest ×': closest.singleX, 'batch × (closest)': closest.batchX },
    // full ladder (data first), sorted fastest→slowest single-tick, for the tile
    peers: [{ lib: 'data', single: dataSingle, singleX: 1 }, ...peers].sort((a, b) => (a.single ?? 1e9) - (b.single ?? 1e9)),
    note: `data ${closest.singleX}× faster than ${closest.lib} (closest peer) on a single tick`,
  })
}

writeFileSync(OUT, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''))
console.log(`[gen-h7] ${rows.length} cross-library rows → perf/h7.jsonl`)
