// @ts-nocheck
// Thin gate driver (Mode A) — workload lives in perf/workloads.ts. Cases:
//   setup / insert / batch          — general fold reduce(fn, init), O(n)/event
//   inc-setup / inc-insert          — incremental reduce(add, remove, init), O(Δ)
//   inc-overwrite                   — whole-slot BU1 via the per-key value cache
//   inc-remove                      — removes thread through `remove`, no rebuild
import { ok } from 'node:assert'
import { test } from 'node:test'
import { gateMeasure as measure } from '../../perf/measure.ts'
import { reduce } from '../../perf/workloads.ts'

for (const [name, w] of Object.entries(reduce.workloads())) {
  test(`reduce ${name} - ${reduce.N} rows`, () => {
    const elapsed = measure(w.run, w.reps)
    console.log(`  reduce ${name} ${reduce.N}: ${elapsed.toFixed(2)}ms`)
    ok(elapsed < w.gate, `reduce ${name}: ${elapsed.toFixed(2)}ms over ${w.gate}ms`)
  })
}
