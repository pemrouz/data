import { ok } from 'node:assert'
import { test } from 'node:test'
import { gateMeasure as measure } from '../../perf/measure.ts'
import { tap } from '../../perf/workloads.ts'

// Thin gate driver (Mode A) — workload lives in perf/workloads.ts. Cases:
// setup / insert / batch (1-arg full TapValue, clones) / bare (0-arg TapBareValue).
for (const [name, w] of Object.entries(tap.workloads())) {
  test(`tap ${name} - ${tap.N} rows`, () => {
    const elapsed = measure(w.run)
    console.log(`  tap ${name} ${tap.N}: ${elapsed.toFixed(2)}ms`)
    ok(elapsed < w.gate, `tap ${name}: ${elapsed.toFixed(2)}ms over ${w.gate}ms`)
  })
}
