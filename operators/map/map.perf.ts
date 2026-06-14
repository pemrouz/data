// @ts-nocheck
import { ok } from 'node:assert'
import { test } from 'node:test'
import { gateMeasure as measure } from '../../perf/measure.ts'
import { map } from '../../perf/workloads.ts'

// Thin gate driver (Mode A): the workload — source builder, cases, thresholds —
// lives in perf/workloads.ts, the ONE definition perf/run-report.ts re-measures
// too, so a report row can never be a number no gate asserted. ok() stays here.
for (const [name, w] of Object.entries(map.workloads())) {
  test(`map ${name} - ${map.N} rows`, () => {
    const elapsed = measure(w.run)
    console.log(`  map ${name} ${map.N}: ${elapsed.toFixed(2)}ms`)
    ok(elapsed < w.gate, `map ${name}: ${elapsed.toFixed(2)}ms over ${w.gate}ms`)
  })
}
