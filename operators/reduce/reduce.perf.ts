// @ts-nocheck
// Thin gate driver (Mode A) — workload lives in perf/workloads.ts. Cases:
//   setup / insert / batch          — general fold reduce(fn, init), O(n)/event
//   inc-setup / inc-insert          — incremental reduce(add, remove, init), O(Δ)
//   inc-overwrite                   — whole-slot BU1 via the per-key value cache
//   inc-remove                      — removes thread through `remove`, no rebuild
import { ok } from 'node:assert'
import { test } from 'node:test'
import { $, value } from '../../core.ts'
import { gateMeasure as measure } from '../../perf/measure.ts'
import { reduce } from '../../perf/workloads.ts'

for (const [name, w] of Object.entries(reduce.workloads())) {
  test(`reduce ${name} - ${reduce.N} rows`, () => {
    const elapsed = measure(w.run, w.reps)
    console.log(`  reduce ${name} ${reduce.N}: ${elapsed.toFixed(2)}ms`)
    ok(elapsed < w.gate, `reduce ${name}: ${elapsed.toFixed(2)}ms over ${w.gate}ms`)
  })
}

// ── Algorithmic-complexity guards (deterministic, NOT timing — see H1) ───────
// The timing cases above are sub-ms over 10k and can't tell the O(1) incremental
// path from the O(N) general re-fold. Count fold invocations per single insert:
// an exact, machine-independent measure of how many rows the delta touched. The
// report's H1 harness emits these same counts as a standing complexity instrument.
function buildVal(n) { const o = {}; for (let i = 0; i < n; i++) o[i] = { val: i }; return o }

test('reduce complexity - incremental insert folds O(1), not O(N)', () => {
  const N = 5000
  const src = $(buildVal(N))
  let calls = 0
  const r = src.reduce((acc, row) => { calls++; return acc + row.val }, (acc, row) => acc - row.val, 0)
  ok(typeof r[value] === 'number')   // setup fold already ran
  calls = 0
  src.insert({ val: N })
  console.log(`  reduce incremental insert: ${calls} add() call(s) over ${N} rows`)
  ok(calls <= 2)   // O(1): one add() for the inserted row (BI0 threads through add)
})

test('reduce complexity - general fold insert re-folds O(N)', () => {
  const N = 5000
  const src = $(buildVal(N))
  let calls = 0
  const r = src.reduce((acc, row) => { calls++; return acc + row.val }, 0)
  ok(typeof r[value] === 'number')
  calls = 0
  src.insert({ val: N })
  console.log(`  reduce general-fold insert: ${calls} fold() calls over ${N} rows`)
  // O(N): the 2-arg form is non-commutative in general, so every event rebuilds.
  ok(calls >= N && calls <= N + 5)
})
