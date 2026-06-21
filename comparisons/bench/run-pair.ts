// Helper: run a subset of benches by label. Used for re-running a few libraries
// at a different N without doing the full suite.
import { type BenchResult } from './measure.ts'
const fmt = (n: number) => n < 1 ? n.toFixed(3) : n.toFixed(2)
const labels = (process.argv[2] ?? '').split(',').filter(Boolean)
const map: Record<string, string> = {
  data: './data.bench.ts',
  crossfilter: './crossfilter.bench.ts',
  mobx: './mobx.bench.ts',
  rxjs: './rxjs.bench.ts',
  solid: './solid.bench.ts',
  preact: './preact.bench.ts',
  vue: './vue.bench.ts',
  svelte: './svelte.bench.ts',
  react: './react.bench.ts',
}
for (const label of labels) {
  const path = map[label]
  if (!path) { console.error(`unknown: ${label}`); continue }
  process.stderr.write(`▸ ${label} …\n`)
  const mod = await import(path)
  const r: BenchResult = await mod.default()
  const dash = r.dashboard != null ? `  dashboard=${fmt(r.dashboard)}ms` : ''
  console.log(`${r.name}@${r.version}: setup=${fmt(r.setup)}ms  single=${fmt(r.single)}ms  stream=${fmt(r.batch)}ms${dash}`)
}
