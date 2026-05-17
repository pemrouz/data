// @ts-nocheck
// Per-operator comparison runner.
//
// Walks comparisons/bench/operators/*.bench.ts (excluding _shared.ts) and runs
// each operator's variants in turn. Prints a markdown section per operator
// with setup / single-tick / batch timings, sorted by single-tick speed so
// regressions for `data` are easy to spot.
//
// Usage:
//   npm run bench:ops
//   npm run bench:ops > /tmp/ops.md
//   BENCH_OPS=filter,map npm run bench:ops    # subset
//
// Progress goes to stderr; the markdown table goes to stdout.

import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { OpBench, Timings } from './_shared.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

const log = (msg: string) => process.stderr.write(msg + '\n')
const fmt = (n: number) => n < 1 ? n.toFixed(3) : n.toFixed(2)

const wanted = (process.env.BENCH_OPS ?? '').split(',').map(s => s.trim()).filter(Boolean)

const files = readdirSync(HERE)
  .filter(f => f.endsWith('.bench.ts') && !f.startsWith('_'))
  .sort()

type Row = { lib: string, version: string, setup: number, single: number, batch: number }
type OpResult = { operator: string, notes?: string, rows: Row[], skipped: { lib: string, reason: string }[] }

const results: OpResult[] = []

for (const f of files) {
  const opName = f.replace(/\.bench\.ts$/, '')
  if (wanted.length && !wanted.includes(opName)) continue
  log(`▸ ${opName} …`)
  let mod: { default: OpBench }
  try {
    mod = await import(join(HERE, f))
  } catch (e: any) {
    log(`  failed to load: ${e?.message ?? e}`)
    continue
  }
  const op = mod.default
  const rows: Row[] = []
  const skipped: { lib: string, reason: string }[] = []
  for (const v of op.variants) {
    try {
      const t = await v.run() as Timings
      rows.push({ lib: v.name, version: v.version, ...t })
      log(`  ${v.name}@${v.version}: setup=${fmt(t.setup)}  single=${fmt(t.single)}  batch=${fmt(t.batch)}`)
    } catch (e: any) {
      const reason = e?.code === 'ERR_MODULE_NOT_FOUND'
        ? 'peer dependency not installed'
        : (e?.message ?? String(e))
      skipped.push({ lib: v.name, reason })
      log(`  ${v.name}: skipped (${reason})`)
    }
  }
  results.push({ operator: op.operator, notes: op.notes, rows, skipped })
}

log('')

// Print markdown — one section per operator, rows sorted by single-tick time.
console.log(`# bench:ops — node ${process.version}`)
console.log('')
console.log('Per-operator comparison. Workload mutates one row per tick — `single` is')
console.log('one such tick; `batch` is TICK_COUNT (default 1000) ticks streamed back-')
console.log('to-back. Lower is better. Rows are sorted by single-tick time.')
console.log('')

for (const r of results) {
  console.log(`## ${r.operator}`)
  if (r.notes) console.log(`_${r.notes}_`)
  console.log('')
  console.log('| Library | Version | Setup (ms) | Single (ms) | Batch 1000 (ms) |')
  console.log('|---|---|---:|---:|---:|')
  const sorted = [...r.rows].sort((a, b) => a.single - b.single)
  for (const row of sorted) {
    const marker = row.lib === 'data' ? ' **`data`**' : ''
    console.log(`| ${row.lib}${marker ? '' : ''} | ${row.version} | ${fmt(row.setup)} | ${fmt(row.single)} | ${fmt(row.batch)} |`)
  }
  if (r.skipped.length) {
    console.log('')
    for (const s of r.skipped) console.log(`- skipped **${s.lib}**: ${s.reason}`)
  }
  console.log('')
}

// Regression summary: any operator where data isn't fastest on single OR batch.
const regressions: string[] = []
for (const r of results) {
  const dataRow = r.rows.find(x => x.lib === 'data')
  if (!dataRow) continue
  for (const row of r.rows) {
    if (row.lib === 'data') continue
    if (row.single < dataRow.single) {
      regressions.push(`- **${r.operator}** single: \`data\` (${fmt(dataRow.single)}ms) is slower than ${row.lib} (${fmt(row.single)}ms)`)
    }
    if (row.batch < dataRow.batch) {
      regressions.push(`- **${r.operator}** batch: \`data\` (${fmt(dataRow.batch)}ms) is slower than ${row.lib} (${fmt(row.batch)}ms)`)
    }
  }
}

if (regressions.length) {
  console.log('## regressions')
  console.log('')
  console.log('Cases where another lib outperforms `data`:')
  console.log('')
  for (const reg of regressions) console.log(reg)
} else {
  console.log('## regressions')
  console.log('')
  console.log('None — `data` is fastest on both single-tick and batch across every measured operator.')
}
