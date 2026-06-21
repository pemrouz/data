// Thin gate driver (Mode A) — workload (gt/lt/gte/lte cases + thresholds) lives
// in perf/workloads.ts, which perf/run-report.ts re-measures too.
//
// Why the headline gap with between: between() pays a sorted-index splice per
// BU2 on the watched column (O(log N) at best, O(N) under churn). gt/lt just
// classify each row independently. The thresholds are well inside that gap so a
// regression toward sort-indexing will trip.
import { ok } from 'node:assert'
import { test } from 'node:test'
import { gateMeasure as measure } from '../../perf/measure.ts'
import { compare } from '../../perf/workloads.ts'

for (const [name, w] of Object.entries(compare.workloads())) {
  test(`compare ${name} - ${compare.N} rows`, () => {
    const elapsed = measure(w.run, w.reps)
    console.log(`  compare ${name} ${compare.N}: ${elapsed.toFixed(2)}ms`)
    ok(elapsed < w.gate, `compare ${name}: ${elapsed.toFixed(2)}ms over ${w.gate}ms`)
  })
}
