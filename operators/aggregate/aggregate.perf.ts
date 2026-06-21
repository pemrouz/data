import { ok } from 'node:assert'
import { test } from 'node:test'
import { $, value } from '../../core.ts'
import { some } from './index.ts'
import { gateMeasure as measure } from '../../perf/measure.ts'
import { aggregate } from '../../perf/workloads.ts'

// Thin gate driver (Mode A) for the TIMING cases (sum/avg/max/min/some/every) —
// workload lives in perf/workloads.ts, re-measured by perf/run-report.ts.
// sum/avg are O(1) per delta (running total + count); max/min recompute O(n)
// per publish; some/every track a true-count O(1) per delta. The wall-clock
// thresholds are loose (sub-ms over 10k) — they only catch gross regressions.
// The ALGORITHMIC guarantee is the deterministic projector-count pair BELOW,
// which is a count assertion, NOT a timing one, so it stays inline (it has no
// place in the timing-only workloads model).
for (const [name, w] of Object.entries(aggregate.workloads())) {
  test(`aggregate ${name} - ${aggregate.N} rows`, () => {
    const elapsed = measure(w.run, w.reps)
    console.log(`  aggregate ${name} ${aggregate.N}: ${elapsed.toFixed(2)}ms`)
    ok(elapsed < w.gate, `aggregate ${name}: ${elapsed.toFixed(2)}ms over ${w.gate}ms`)
  })
}

// ── Algorithmic-complexity guards (deterministic, jitter-proof) ────────────
// The wall-clock thresholds above are sub-ms over a 10k source, so they can't
// distinguish the O(1) incremental object path from the O(N) array rebuild —
// both pass any reasonable timer bar (finding #54: the per-op perf files only
// ever built OBJECT sources and the bars sat 50-800x above measured medians,
// so the suite "guarded almost nothing" on single-delta cases). These two
// pin the *work done* per single insert via an instrumented projector: some()
// calls its fn exactly once per projected row (AggregateValue._project), so
// counting fn invocations after one insert is an exact, machine-independent
// measure of how many rows the delta touched.

test('aggregate complexity - object source insert projects O(1), not O(N)', () => {
  const N = 5000
  const obj: any = {}
  for (let i = 0; i < N; i++) obj[i] = { active: true, val: i }
  const src = $(obj)
  let reads = 0
  const agg = some(src, (r: any) => { reads++; return r.active })
  ok((agg as any)[value] === true)   // setup fold already projected all N rows
  reads = 0                 // discard the construction fold
  src.insert({ active: true, val: N })
  console.log(`  some object insert: ${reads} projector call(s) over ${N} rows`)
  // BI0 over an object projects ONLY the inserted row — the incremental path.
  // If a regression routed objects through XU0 too, this would jump to ~N.
  ok(reads <= 2)
})

test('aggregate complexity - array source insert rebuilds O(N) (documents P7)', () => {
  const N = 5000
  const arr = []
  for (let i = 0; i < N; i++) arr.push({ active: true, val: i })
  const src = $(arr)
  let reads = 0
  const agg = some(src, (r: any) => { reads++; return r.active })
  ok((agg as any)[value] === true)
  reads = 0
  src.insert({ active: true, val: N })
  console.log(`  some array insert: ${reads} projector calls over ${N} rows (P7 rebuild)`)
  // BI0 over an array shifts positions, so it falls back to a single XU0
  // rebuild that re-projects every row (ISSUES.md P7 — correct over an
  // unsound incremental BH1/BF0). Guard it is exactly ONE rebuild: ~N+1
  // reads. Failing low (~1) means the array rebuild was silently dropped
  // (the C13/aggregate-desync class); failing high (>=2N) means a regression
  // rebuilt more than once per delta.
  ok(reads >= N && reads <= N + 5)
})
