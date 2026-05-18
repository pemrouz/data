// @ts-nocheck
// Regenerate operators/<op>/BENCHMARK.md tables and operators/BENCHMARK.md
// summary from a `bench:ops` markdown dump.
//
// Usage:
//   npm run bench:ops > /tmp/bench-final.md
//   node --experimental-strip-types comparisons/bench/operators/_gen-bench-md.mjs /tmp/bench-final.md
//
// Each per-operator BENCHMARK.md keeps its "How" / "Run X to refresh"
// prose intact — only the table block (delimited by the `| Library ... |`
// header through the trailing blank line) is replaced. The top-level
// summary at operators/BENCHMARK.md is regenerated wholesale.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const input = process.argv[2]
if (!input) { console.error('usage: _gen-bench-md.mjs <bench-output.md>'); process.exit(1) }

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..', '..')

// Parse bench markdown — extract { operator: [{lib, version, setup, single, batch}] }
const raw = readFileSync(input, 'utf8')
const blocks = raw.split(/^## /m).slice(1)  // drop pre-amble

// Map operator slug → sub-folder name + display title. The bench's operator
// titles include descriptors (e.g. "sort (top-K via za)") that we strip back
// to a simple slug.
const slugFor = (title) => {
  const t = title.toLowerCase()
  if (t.startsWith('aggregate')) return 'aggregate'
  if (t.startsWith('between')) return 'between'
  if (t.startsWith('compare')) return 'compare'
  if (t.startsWith('distinct')) return 'distinct'
  if (t.startsWith('except')) return 'except'
  if (t.startsWith('filter')) return 'filter'
  if (t.startsWith('group')) return 'group'
  if (t.startsWith('intersect')) return 'intersect'
  if (t.startsWith('keys')) return 'keys'
  if (t.startsWith('length')) return 'length'
  if (t.startsWith('map')) return 'map'
  if (t.startsWith('reduce')) return 'reduce'
  if (t.startsWith('reverse')) return 'reverse'
  if (t.startsWith('sort')) return 'sort'
  if (t.startsWith('tap')) return 'tap'
  if (t.startsWith('to ')) return 'to'
  if (t.startsWith('union')) return 'union'
  return null
}

const fmt = (n) => n == null ? '—' : (n < 1 ? n.toFixed(3) : n.toFixed(2))
const fmtMult = (m) => {
  if (m == null || !isFinite(m)) return '—'
  if (m >= 100) return `${m.toFixed(0)}×`
  if (m >= 10) return `${m.toFixed(1)}×`
  if (m >= 1) return `${m.toFixed(1)}×`
  return `${m.toFixed(2)}×`
}

const parsed = {}
for (const block of blocks) {
  if (block.startsWith('regressions')) break
  const lines = block.split('\n')
  const title = lines[0].trim()
  const slug = slugFor(title)
  if (!slug) continue
  const rows = []
  for (const line of lines) {
    const m = line.match(/^\| ([^|]+) \| ([^|]+) \|\s*([0-9.—-]+)\s*\|\s*([0-9.—-]+)\s*\|\s*([0-9.—-]+)\s*\|/)
    if (!m) continue
    const lib = m[1].trim()
    if (lib === 'Library') continue
    rows.push({
      lib,
      version: m[2].trim(),
      setup: parseFloat(m[3]),
      single: parseFloat(m[4]),
      batch: parseFloat(m[5]),
    })
  }
  if (!rows.length) continue
  parsed[slug] = { title, rows }
}

// Build new per-operator BENCHMARK.md tables, with multipliers
function rebuildTable(rows) {
  // Identify data row(s). Some ops (tap) have multiple data variants.
  const dataRow = rows.find(r => r.lib === 'data')
  if (!dataRow) return null
  const lines = []
  lines.push('| Library | Setup (ms) | Single (ms) | vs data | Batch 1000 (ms) | vs data |')
  lines.push('|---|---:|---:|---:|---:|---:|')
  for (const r of rows) {
    const sm = r.lib.startsWith('data') ? '—' : fmtMult(r.single / dataRow.single)
    const bm = r.lib.startsWith('data') ? '—' : fmtMult(r.batch / dataRow.batch)
    const single = r.lib === 'data' ? `**${fmt(r.single)}**` : fmt(r.single)
    const batch  = r.lib === 'data' ? `**${fmt(r.batch)}**`  : fmt(r.batch)
    const name = r.lib === 'data' ? '**data**' : r.lib
    lines.push(`| ${name} | ${fmt(r.setup)} | ${single} | ${sm} | ${batch} | ${bm} |`)
  }
  return lines.join('\n')
}

// Rewrite the table block inside an existing BENCHMARK.md.
function patchMd(path, newTable) {
  if (!existsSync(path)) return false
  const src = readFileSync(path, 'utf8')
  // Match "| Library | ... |\n|---|...|\n( row lines )*"
  const tableRe = /\| Library \|[\s\S]*?(?=\n\n|\n[a-zA-Z*#`])/
  const next = src.replace(tableRe, newTable + '\n')
  if (next === src) return false
  writeFileSync(path, next)
  return true
}

let touched = 0
for (const [slug, op] of Object.entries(parsed)) {
  const table = rebuildTable(op.rows)
  if (!table) continue
  const path = join(REPO, 'operators', slug, 'BENCHMARK.md')
  if (patchMd(path, table)) {
    console.log(`✓ updated ${path}`)
    touched++
  } else {
    console.log(`✗ skipped ${path} (no match or missing)`)
  }
}

// Generate the top-level operators/BENCHMARK.md summary
const summaryRows = Object.entries(parsed).map(([slug, op]) => {
  const dataRow = op.rows.find(r => r.lib === 'data')
  if (!dataRow) return null
  const peers = op.rows.filter(r => !r.lib.startsWith('data'))
  if (!peers.length) return null
  const singles = peers.map(r => r.single).sort((a, b) => a - b)
  const batches = peers.map(r => r.batch).sort((a, b) => a - b)
  return {
    slug,
    title: op.title,
    dataSingle: dataRow.single,
    dataBatch: dataRow.batch,
    pSingleLo: singles[0],
    pSingleHi: singles[singles.length - 1],
    pBatchLo: batches[0],
    pBatchHi: batches[batches.length - 1],
  }
}).filter(Boolean).sort((a, b) => a.slug.localeCompare(b.slug))

const summaryLines = []
summaryLines.push('# operators — benchmark summary')
summaryLines.push('')
summaryLines.push('Per-operator comparison rolled up across every peer measured in')
summaryLines.push('`bench:ops`. **Peer range** is the fastest-peer through slowest-peer')
summaryLines.push('time. **Multiplier** is `peer_time / data_time` — values > 1× mean')
summaryLines.push('the peer takes more time than `data`; values < 1× mean the peer is')
summaryLines.push('faster. Each operator\'s detailed table lives in')
summaryLines.push('`operators/<op>/BENCHMARK.md`.')
summaryLines.push('')
summaryLines.push('Generated by `node comparisons/bench/operators/_gen-bench-md.mjs` from a')
summaryLines.push('`bench:ops` markdown dump. Re-run after any operator-level perf change.')
summaryLines.push('')

summaryLines.push('## Single-tick (one row mutation + read)')
summaryLines.push('')
summaryLines.push('| Operator | data (ms) | Peer range (ms) | Multiplier range |')
summaryLines.push('|---|---:|---|---|')
for (const r of summaryRows) {
  const mLo = r.pSingleLo / r.dataSingle
  const mHi = r.pSingleHi / r.dataSingle
  const linked = `[${r.slug}](${r.slug}/BENCHMARK.md)`
  summaryLines.push(`| ${linked} | ${fmt(r.dataSingle)} | ${fmt(r.pSingleLo)} – ${fmt(r.pSingleHi)} | ${fmtMult(mLo)} – ${fmtMult(mHi)} |`)
}
summaryLines.push('')

summaryLines.push('## Batch (1000 ticks streamed back-to-back)')
summaryLines.push('')
summaryLines.push('| Operator | data (ms) | Peer range (ms) | Multiplier range |')
summaryLines.push('|---|---:|---|---|')
for (const r of summaryRows) {
  const mLo = r.pBatchLo / r.dataBatch
  const mHi = r.pBatchHi / r.dataBatch
  const linked = `[${r.slug}](${r.slug}/BENCHMARK.md)`
  summaryLines.push(`| ${linked} | ${fmt(r.dataBatch)} | ${fmt(r.pBatchLo)} – ${fmt(r.pBatchHi)} | ${fmtMult(mLo)} – ${fmtMult(mHi)} |`)
}
summaryLines.push('')

summaryLines.push('## Reading the multiplier')
summaryLines.push('')
summaryLines.push('- **> 1×** — peer is slower than `data` by that factor. Most rows.')
summaryLines.push('- **< 1×** — peer is faster than `data` (rare; flagged in the operator\'s')
summaryLines.push('  own BENCHMARK.md). At time of writing this applies to `length` single')
summaryLines.push('  and `to` single — both at the sub-µs scale where measurement noise')
summaryLines.push('  and signal-equality short-circuits in peer libs dominate. Both win on')
summaryLines.push('  the batch metric.')
summaryLines.push('')
summaryLines.push('## Refresh')
summaryLines.push('')
summaryLines.push('```sh')
summaryLines.push('npm run bench:ops > /tmp/bench.md')
summaryLines.push('node comparisons/bench/operators/_gen-bench-md.mjs /tmp/bench.md')
summaryLines.push('```')
summaryLines.push('')
summaryLines.push('Patches every `operators/<op>/BENCHMARK.md` table in place and')
summaryLines.push('regenerates this file.')

writeFileSync(join(REPO, 'operators', 'BENCHMARK.md'), summaryLines.join('\n') + '\n')
console.log(`✓ wrote operators/BENCHMARK.md (${summaryRows.length} operators)`)
console.log(`# updated ${touched} per-operator BENCHMARK.md files`)

// Also patch the BENCH:OPS:START/END block in comparisons.html so the
// landing site's per-operator table stays in sync with the markdown.
function htmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function buildHtmlTables(rows) {
  const lines = []
  lines.push('    <!-- BENCH:OPS:START — regenerated by comparisons/bench/operators/_gen-bench-md.mjs; do not edit by hand. -->')
  lines.push('    <h3 class="bench-ops-h">single-tick — one row mutation + read</h3>')
  lines.push('    <div class="scroll-x">')
  lines.push('    <table class="matrix bench-ops">')
  lines.push('      <thead>')
  lines.push('        <tr><th>operator</th><th class="num">data (ms)</th><th>peer range (ms)</th><th>multiplier range</th></tr>')
  lines.push('      </thead>')
  lines.push('      <tbody>')
  for (const r of rows) {
    const mLo = fmtMult(r.pSingleLo / r.dataSingle)
    const mHi = fmtMult(r.pSingleHi / r.dataSingle)
    lines.push(`        <tr><td><a href="./operators/${r.slug}/BENCHMARK.md">${htmlEscape(r.slug)}</a></td><td class="num">${fmt(r.dataSingle)}</td><td>${fmt(r.pSingleLo)}&nbsp;–&nbsp;${fmt(r.pSingleHi)}</td><td>${mLo}&nbsp;–&nbsp;${mHi}</td></tr>`)
  }
  lines.push('      </tbody>')
  lines.push('    </table>')
  lines.push('    </div>')
  lines.push('')
  lines.push('    <h3 class="bench-ops-h">batch — 1,000 ticks streamed back-to-back</h3>')
  lines.push('    <div class="scroll-x">')
  lines.push('    <table class="matrix bench-ops">')
  lines.push('      <thead>')
  lines.push('        <tr><th>operator</th><th class="num">data (ms)</th><th>peer range (ms)</th><th>multiplier range</th></tr>')
  lines.push('      </thead>')
  lines.push('      <tbody>')
  for (const r of rows) {
    const mLo = fmtMult(r.pBatchLo / r.dataBatch)
    const mHi = fmtMult(r.pBatchHi / r.dataBatch)
    lines.push(`        <tr><td><a href="./operators/${r.slug}/BENCHMARK.md">${htmlEscape(r.slug)}</a></td><td class="num">${fmt(r.dataBatch)}</td><td>${fmt(r.pBatchLo)}&nbsp;–&nbsp;${fmt(r.pBatchHi)}</td><td>${mLo}&nbsp;–&nbsp;${mHi}</td></tr>`)
  }
  lines.push('      </tbody>')
  lines.push('    </table>')
  lines.push('    </div>')
  lines.push('    <!-- BENCH:OPS:END -->')
  return lines.join('\n')
}

const htmlPath = join(REPO, 'comparisons.html')
if (existsSync(htmlPath)) {
  const src = readFileSync(htmlPath, 'utf8')
  const blockRe = /[ \t]*<!-- BENCH:OPS:START[\s\S]*?BENCH:OPS:END -->/
  if (blockRe.test(src)) {
    const next = src.replace(blockRe, buildHtmlTables(summaryRows))
    if (next !== src) {
      writeFileSync(htmlPath, next)
      console.log(`✓ patched comparisons.html bench block`)
    } else {
      console.log(`= comparisons.html bench block unchanged`)
    }
  } else {
    console.log(`✗ skipped comparisons.html (no BENCH:OPS:START/END markers)`)
  }
}
