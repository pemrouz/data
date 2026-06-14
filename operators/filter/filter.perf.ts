// @ts-nocheck
import { ok } from 'node:assert'
import { test } from 'node:test'
import { gateMeasure as measure } from '../../perf/measure.ts'
import { filter } from '../../perf/workloads.ts'

// Thin gate driver (Mode A): the workload — source builder, setup/single/batch
// closures, and each closure's threshold — lives in perf/workloads.ts, the ONE
// definition the report (perf/run-report.ts) re-measures too. So a report row
// can never be a number no gate asserted. Keep ok() here (the gate's whole job).
for (const [name, w] of Object.entries(filter.workloads())) {
  test(`filter ${name} - ${filter.N} rows`, () => {
    const elapsed = measure(w.run)
    console.log(`  filter ${name} ${filter.N}: ${elapsed.toFixed(2)}ms`)
    ok(elapsed < w.gate, `filter ${name}: ${elapsed.toFixed(2)}ms over ${w.gate}ms`)
  })
}
