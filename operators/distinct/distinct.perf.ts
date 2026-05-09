// @ts-nocheck
import { ok } from 'node:assert'
import { test } from 'node:test'
import { $ } from '../../core.ts'
import { distinct } from './index.ts'

const REPS = 5
const measure = (fn, reps = REPS) => {
  const times = []
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now(); fn(); times.push(performance.now() - t0)
  }
  return [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)]
}

function makeData(n, categories = 100) {
  const obj = {}
  for (let i = 0; i < n; i++) obj[i] = { cat: i % categories, val: i }
  return obj
}

// distinct rebuilds O(n) on every upstream event. Setup at 10k is one
// rebuild; per-event cost is also one rebuild, so the threshold tracks
// "scan + Set inserts over n rows" — anything dramatically slower means
// the rebuild path regressed.
test('distinct setup - 10000 rows 100 categories', () => {
  const elapsed = measure(() => {
    const src = $(makeData(10000))
    distinct(src, r => r.cat)
  })
  console.log(`  distinct setup 10k/100cat: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500)
})

test('distinct update - insert 1 row to 10000', () => {
  const src = $(makeData(10000))
  distinct(src, r => r.cat)
  let i = 10000
  const elapsed = measure(() => {
    src.insert({ cat: i % 100, val: i }); i++
  })
  console.log(`  distinct insert 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 50)
})

test('distinct update - batch update 100 rows in 10000', () => {
  const src = $(makeData(10000))
  distinct(src, r => r.cat)
  const elapsed = measure(() => {
    for (let i = 0; i < 100; i++) src[i].val = i + 1
  })
  console.log(`  distinct batch update 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 1000)
})
