// @ts-nocheck
// Cross-library comparison runner. Dynamic-imports each bench so a missing peer
// dependency is reported as "skipped" rather than crashing the whole run.
//
// Output: a markdown table on stdout (copy-paste into comparisons.html). Status
// messages and per-bench progress go to stderr to keep stdout clean.
//
// Usage:
//   npm run bench:compare
//   npm run bench:compare > /tmp/results.md
//
// The harness does not assert thresholds — it reports. Regressions in peer
// libraries should not fail this repo's CI.

import { type BenchResult } from './measure.ts'

const benches: ReadonlyArray<{ path: string, label: string }> = [
  { path: './data.bench.ts',         label: 'data' },
  { path: './crossfilter.bench.ts',  label: 'crossfilter' },
  { path: './mobx.bench.ts',         label: 'mobx' },
  { path: './rxjs.bench.ts',         label: 'rxjs' },
  { path: './solid.bench.ts',        label: 'solid' },
  { path: './preact.bench.ts',       label: 'preact-signals' },
  { path: './vue.bench.ts',          label: 'vue-reactivity' },
  { path: './svelte.bench.ts',       label: 'svelte-store' },
]

const log = (msg: string) => process.stderr.write(msg + '\n')

const fmt = (n: number) => n < 1 ? n.toFixed(3) : n.toFixed(2)

const results: BenchResult[] = []
const skipped: { label: string, reason: string }[] = []

log(`# bench:compare — node ${process.version}`)
log(`# gc available: ${(globalThis as any).gc ? 'yes' : 'no (run with --expose-gc)'}`)
log('')

for (const { path, label } of benches) {
  try {
    log(`▸ ${label} …`)
    const mod = await import(path)
    const r: BenchResult = await mod.default()
    results.push(r)
    log(`  ${r.name}@${r.version}: setup=${fmt(r.setup)}ms  single=${fmt(r.single)}ms  batch=${fmt(r.batch)}ms`)
  } catch (e: any) {
    const reason = e?.code === 'ERR_MODULE_NOT_FOUND'
      ? 'peer dependency not installed'
      : (e?.message ?? String(e))
    skipped.push({ label, reason })
    log(`  skipped (${reason})`)
  }
}

log('')
log('# results')
log('')

console.log('| Library | Version | Setup (ms) | Single update (ms) | Batch 1000 (ms) | Notes |')
console.log('|---|---|---:|---:|---:|---|')
for (const r of results) {
  console.log(`| ${r.name} | ${r.version} | ${fmt(r.setup)} | ${fmt(r.single)} | ${fmt(r.batch)} | ${r.notes ?? ''} |`)
}

if (skipped.length) {
  log('')
  log('# skipped')
  for (const s of skipped) log(`- ${s.label}: ${s.reason}`)
  log('')
  log('To install peers: npm install --save-dev crossfilter2 mobx rxjs solid-js @preact/signals-core @vue/reactivity svelte')
}
