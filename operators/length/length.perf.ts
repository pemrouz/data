// @ts-nocheck
import { ok } from 'node:assert'
import { test } from 'node:test'
import { $, value } from '../../core.ts'
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

// ── Algorithmic-complexity guard (deterministic, NOT timing — see H1) ────────
// length(fn) buckets each row by a key fn. A single insert should call that fn
// exactly once (rebucket the one new row), not re-key all N. Counting key-fn
// invocations per insert is the machine-independent O(1) proof; the report's H1
// harness emits the same count as a standing instrument.
test('length(fn) complexity - insert rebuckets O(1), not O(N)', () => {
  const N = 5000
  const o = {}
  for (let i = 0; i < N; i++) o[i] = { bucket: i % 100 }
  const src = $(o)
  let calls = 0
  const l = src.length(d => { calls++; return d.bucket })
  l[value]   // setup bucketing already ran
  calls = 0
  src.insert({ bucket: 7 })
  console.log(`  length(fn) insert: ${calls} key-fn call(s) over ${N} rows`)
  ok(calls <= 2)   // O(1): one rebucket for the inserted row
})
