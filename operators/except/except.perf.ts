// Thin gate driver (Mode A) — workload lives in perf/workloads.ts. except keeps
// rows in p but not in `other`; setup walks p once, per-event updates from
// either side are O(affected rows). insert-other drops matching rows (BI0 from
// other); remove-other re-admits rows p still has (BR1 from other).
import { ok } from 'node:assert'
import { test } from 'node:test'
import { gateMeasure as measure } from '../../perf/measure.ts'
import { except } from '../../perf/workloads.ts'

for (const [name, w] of Object.entries(except.workloads())) {
  test(`except ${name} - ${except.N} rows`, () => {
    const elapsed = measure(w.run, w.reps)
    console.log(`  except ${name} ${except.N}: ${elapsed.toFixed(2)}ms`)
    ok(elapsed < w.gate, `except ${name}: ${elapsed.toFixed(2)}ms over ${w.gate}ms`)
  })
}
