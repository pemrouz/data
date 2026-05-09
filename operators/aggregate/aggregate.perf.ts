// @ts-nocheck
import { ok } from 'node:assert'
import { test } from 'node:test'
import { $ } from '../../core.ts'
import { sum, avg, max, min, some, every } from './index.ts'

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

// sum/avg are O(1) per delta (running total + count); a single update only
// pays the per-event sink overhead, not an O(n) scan.
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
  ok(elapsed < 50)
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
  ok(elapsed < 50)
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
