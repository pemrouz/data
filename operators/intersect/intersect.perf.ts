// @ts-nocheck
// Thin gate driver (Mode A) — workload lives in perf/workloads.ts. Per-source
// delta is O(affected rows) on the seeded bitmask; setup is O(rows × sources).
import { ok } from 'node:assert'
import { test } from 'node:test'
import { gateMeasure as measure } from '../../perf/measure.ts'
import { intersect } from '../../perf/workloads.ts'

for (const [name, w] of Object.entries(intersect.workloads())) {
  test(`intersect ${name} - 3 sources of ${intersect.N}`, () => {
    const elapsed = measure(w.run, w.reps)
    console.log(`  intersect ${name} ${intersect.N}x3: ${elapsed.toFixed(2)}ms`)
    ok(elapsed < w.gate, `intersect ${name}: ${elapsed.toFixed(2)}ms over ${w.gate}ms`)
  })
}
