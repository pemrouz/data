// @ts-nocheck
// Compare-operator perf: setup + single-row update + batch update at N=10k.
// Same shape as filter.perf.ts. The thresholds are guard rails — these
// operators are O(1) per row in setup, O(1) per BU1, and O(Δ) per batch.
//
// Why the headline gap with between: between() pays a sorted-index splice
// per BU2 on the watched column (O(log N) at best, O(N) under churn). gt/lt
// just classify each row independently. The thresholds below are well
// inside that gap so a regression toward sort-indexing will trip.
import { ok } from 'node:assert'
import { test } from 'node:test'
import { $, value } from '../../core.ts'
import { gt, lt, gte, lte } from './index.ts'

const REPS = 5
const measure = (fn, reps = REPS) => {
  const times = []
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now(); fn(); times.push(performance.now() - t0)
  }
  return [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)]
}

function makeData(n) {
  const obj = {}
  for (let i = 0; i < n; i++) obj[i] = { active: i % 2 === 0, val: i }
  return obj
}

test('gt setup - 10000 rows', () => {
  const elapsed = measure(() => {
    const src = $(makeData(10000))
    gt(src, 'val', 5000)
  })
  console.log(`  gt setup 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500)
})

test('gt update - insert 1 row to 10000', () => {
  const src = $(makeData(10000))
  const f = gt(src, 'val', 5000)
  const elapsed = measure(() => {
    src.insert({ active: true, val: 99999 })
  })
  console.log(`  gt insert 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 50)
})

test('gt update - batch column update across 1000 rows in 10000', () => {
  const src = $(makeData(10000))
  const f = gt(src, 'val', 5000)
  let bump = 0
  const elapsed = measure(() => {
    bump++
    // Shift 1000 row values across the threshold to drive membership flips.
    for (let i = 4500; i < 5500; i++) src[i].val = bump * 10000 + i
  })
  console.log(`  gt batch update 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500)
})

// Cover the other three so regressions in any one variant get caught.
test('lt / gte / lte setup - 10000 rows', () => {
  const e1 = measure(() => { const s = $(makeData(10000)); lt(s,  'val', 5000) })
  const e2 = measure(() => { const s = $(makeData(10000)); gte(s, 'val', 5000) })
  const e3 = measure(() => { const s = $(makeData(10000)); lte(s, 'val', 5000) })
  console.log(`  lt setup 10k: ${e1.toFixed(2)}ms, gte: ${e2.toFixed(2)}ms, lte: ${e3.toFixed(2)}ms`)
  ok(e1 < 500); ok(e2 < 500); ok(e3 < 500)
})
