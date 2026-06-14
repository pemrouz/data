// @ts-nocheck
import { ok } from 'node:assert'
import { test } from 'node:test'
import { gateMeasure as measure } from '../../perf/measure.ts'
import { group } from '../../perf/workloads.ts'

// Thin gate driver (Mode A) — workload lives in perf/workloads.ts. The `churn`
// case is the limit→group window composition the array-source restructure targeted.
for (const [name, w] of Object.entries(group.workloads())) {
  test(`group ${name} - ${group.N} rows`, () => {
    const elapsed = measure(w.run)
    console.log(`  group ${name} ${group.N}: ${elapsed.toFixed(2)}ms`)
    ok(elapsed < w.gate, `group ${name}: ${elapsed.toFixed(2)}ms over ${w.gate}ms`)
  })
}
