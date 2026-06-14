// @ts-nocheck
import { ok } from 'node:assert'
import { test } from 'node:test'
import { $, value } from '../../core.ts'
import { sum, avg, max, min, some, every } from './index.ts'
import { gateMeasure as measure } from '../../perf/measure.ts'


function makeData(n) {
  const obj = {}
  for (let i = 0; i < n; i++) obj[i] = { active: i % 2 === 0, val: i }
  return obj
}

// sum/avg are O(1) per delta (running total + count); a single update only
// pays the per-event sink overhead, not an O(n) scan — but ONLY over an
// OBJECT source. Over an ARRAY source a structural insert/remove shifts
// positions, so BI0/BR1 fall back to a full XU0 rebuild (O(N), ISSUES.md P7).
// The wall-clock thresholds below can't tell those apart (both finish in
// well under a ms on a 10k source), so the algorithmic-complexity guard is
// the deterministic projector-call-count pair at the BOTTOM of this file —
// that is what actually pins "O(1) per delta over an object". Keep both:
// call-counts for complexity, loose timing for gross wall-clock regressions.
test('sum setup - 10000 rows', () => {
  const elapsed = measure(() => {
    const src = $(makeData(10000))
    sum(src, 'val')
  })
  console.log(`  sum setup 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500)
})

test('sum update - insert 1 row to 10000', () => {
  const src = $(makeData(10000))
  sum(src, 'val')
  let i = 10000
  const elapsed = measure(() => { src.insert({ active: true, val: i++ }) })
  console.log(`  sum insert 10k: ${elapsed.toFixed(2)}ms`)
  // O(1) per delta over an object — measured median ~0.1ms; 10ms keeps ~100x
  // headroom (jitter-safe on slow CI) while still flagging a gross regression.
  ok(elapsed < 10)
})

test('avg update - batch update 1000 rows in 10000', () => {
  const src = $(makeData(10000))
  avg(src, 'val')
  const elapsed = measure(() => {
    for (let i = 0; i < 1000; i++) src[i].val = i + 1
  })
  console.log(`  avg batch update 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500)
})

// max/min recompute O(n) over the tracked map per publish — each update pays
// a full scan. Batch tests deliberately stay small so the threshold is tight
// enough to catch a regression without flaking on slow CI.
test('max setup - 10000 rows', () => {
  const elapsed = measure(() => {
    const src = $(makeData(10000))
    max(src, 'val')
  })
  console.log(`  max setup 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500)
})

test('max update - insert 1 row to 10000', () => {
  const src = $(makeData(10000))
  max(src, 'val')
  let i = 10000
  const elapsed = measure(() => { src.insert({ active: true, val: i++ }) })
  console.log(`  max insert 10k: ${elapsed.toFixed(2)}ms`)
  // max/min scan the tracked f64 array per publish — O(N) over 10k is still
  // sub-ms; 10ms keeps generous headroom while tightening the old 50ms bar.
  ok(elapsed < 10)
})

test('min update - batch update 100 rows in 10000', () => {
  const src = $(makeData(10000))
  min(src, 'val')
  const elapsed = measure(() => {
    for (let i = 0; i < 100; i++) src[i].val = i + 1
  })
  console.log(`  min batch update 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500)
})

// some/every track a true-count over the tracked map; O(1) per delta like
// sum. The fn runs once per affected row, not per tracked row.
test('some setup - 10000 rows', () => {
  const elapsed = measure(() => {
    const src = $(makeData(10000))
    some(src, r => r.active)
  })
  console.log(`  some setup 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500)
})

test('every update - batch update 1000 rows in 10000', () => {
  const src = $(makeData(10000))
  every(src, r => r.active)
  let toggle = false
  const elapsed = measure(() => {
    toggle = !toggle
    for (let i = 0; i < 1000; i++) src[i].active = toggle
  })
  console.log(`  every batch update 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500)
})

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
  const obj = {}
  for (let i = 0; i < N; i++) obj[i] = { active: true, val: i }
  const src = $(obj)
  let reads = 0
  const agg = some(src, r => { reads++; return r.active })
  ok(agg[value] === true)   // setup fold already projected all N rows
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
  const agg = some(src, r => { reads++; return r.active })
  ok(agg[value] === true)
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
