// @ts-nocheck
// Thin gate driver (Mode A) — workload lives in perf/workloads.ts. The insert/
// remove churn cases (object source) carry a per-case `reps` because they
// CONSUME the source (distinct keys per rep) and defer `sorted` maintenance —
// the births/deaths workload, O(1) per row, not O(N) indexOf + splice.
import { ok } from 'node:assert'
import { test } from 'node:test'
import { gateMeasure as measure } from '../../perf/measure.ts'
import { between } from '../../perf/workloads.ts'

for (const [name, w] of Object.entries(between.workloads())) {
  test(`between ${name} - ${between.N} rows`, () => {
    const elapsed = measure(w.run, w.reps)
    console.log(`  between ${name} ${between.N}: ${elapsed.toFixed(2)}ms`)
    ok(elapsed < w.gate, `between ${name}: ${elapsed.toFixed(2)}ms over ${w.gate}ms`)
  })
}
