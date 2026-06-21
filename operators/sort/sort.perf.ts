// Thin gate driver (Mode A) — workload lives in perf/workloads.ts. Cases:
//   setup  — bounded top-100 build
//   insert — one row into the bounded window
//   rotate — in-window rank change (single BMV1 move, not O(N) BU1 span)
//   brush  — bounded top-100 over a between, ~half leave/re-enter in one batch
//            (the faceted-library rating brush; the per-row churn path is >2000ms)
import { ok } from 'node:assert'
import { test } from 'node:test'
import { gateMeasure as measure } from '../../perf/measure.ts'
import { sort } from '../../perf/workloads.ts'

for (const [name, w] of Object.entries(sort.workloads())) {
  test(`sort ${name} - ${sort.N} rows`, () => {
    const elapsed = measure(w.run, w.reps)
    console.log(`  sort ${name} ${sort.N}: ${elapsed.toFixed(2)}ms`)
    ok(elapsed < w.gate, `sort ${name}: ${elapsed.toFixed(2)}ms over ${w.gate}ms`)
  })
}
