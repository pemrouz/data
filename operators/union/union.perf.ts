// @ts-nocheck
// Thin gate driver (Mode A) — workload lives in perf/workloads.ts. union mirrors
// intersect's bitmask layout — per-source delta is O(affected rows) once setup
// has seeded the bitmask map; setup is O(rows × sources).
import { ok } from 'node:assert'
import { test } from 'node:test'
import { gateMeasure as measure } from '../../perf/measure.ts'
import { union } from '../../perf/workloads.ts'

for (const [name, w] of Object.entries(union.workloads())) {
  test(`union ${name} - 3 sources of ${union.N}`, () => {
    const elapsed = measure(w.run, w.reps)
    console.log(`  union ${name} ${union.N}x3: ${elapsed.toFixed(2)}ms`)
    ok(elapsed < w.gate, `union ${name}: ${elapsed.toFixed(2)}ms over ${w.gate}ms`)
  })
}
