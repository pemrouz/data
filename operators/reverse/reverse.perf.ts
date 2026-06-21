import { ok } from 'node:assert'
import { test } from 'node:test'
import { gateMeasure as measure } from '../../perf/measure.ts'
import { reverse } from '../../perf/workloads.ts'

// Thin gate driver (Mode A) — workload lives in perf/workloads.ts.
for (const [name, w] of Object.entries(reverse.workloads())) {
  test(`reverse ${name} - ${reverse.N} rows`, () => {
    const elapsed = measure(w.run)
    console.log(`  reverse ${name} ${reverse.N}: ${elapsed.toFixed(2)}ms`)
    ok(elapsed < w.gate, `reverse ${name}: ${elapsed.toFixed(2)}ms over ${w.gate}ms`)
  })
}
