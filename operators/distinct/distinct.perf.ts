// @ts-nocheck
import { ok } from 'node:assert'
import { test } from 'node:test'
import { gateMeasure as measure } from '../../perf/measure.ts'
import { distinct } from '../../perf/workloads.ts'

// Thin gate driver (Mode A) — workload lives in perf/workloads.ts.
for (const [name, w] of Object.entries(distinct.workloads())) {
  test(`distinct ${name} - ${distinct.N} rows`, () => {
    const elapsed = measure(w.run)
    console.log(`  distinct ${name} ${distinct.N}: ${elapsed.toFixed(2)}ms`)
    ok(elapsed < w.gate, `distinct ${name}: ${elapsed.toFixed(2)}ms over ${w.gate}ms`)
  })
}
