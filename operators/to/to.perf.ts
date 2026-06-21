import { ok } from 'node:assert'
import { test } from 'node:test'
import { gateMeasure as measure } from '../../perf/measure.ts'
import { to } from '../../perf/workloads.ts'

// Thin gate driver (Mode A) — workload lives in perf/workloads.ts.
for (const [name, w] of Object.entries(to.workloads())) {
  test(`to ${name} - ${to.N} rows`, () => {
    const elapsed = measure(w.run)
    console.log(`  to ${name} ${to.N}: ${elapsed.toFixed(2)}ms`)
    ok(elapsed < w.gate, `to ${name}: ${elapsed.toFixed(2)}ms over ${w.gate}ms`)
  })
}
