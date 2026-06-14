// @ts-nocheck
import { ok } from 'node:assert'
import { test } from 'node:test'
import { gateMeasure as measure } from '../../perf/measure.ts'
import { length, lengthFn } from '../../perf/workloads.ts'

// Thin gate driver (Mode A) — workloads live in perf/workloads.ts. This file
// drives BOTH the scalar count (`length`) and the bucketed `length(fn)`.
for (const spec of [length, lengthFn]) {
  for (const [name, w] of Object.entries(spec.workloads())) {
    test(`${spec.label} ${name} - ${spec.N} rows`, () => {
      const elapsed = measure(w.run)
      console.log(`  ${spec.label} ${name} ${spec.N}: ${elapsed.toFixed(2)}ms`)
      ok(elapsed < w.gate, `${spec.label} ${name}: ${elapsed.toFixed(2)}ms over ${w.gate}ms`)
    })
  }
}
