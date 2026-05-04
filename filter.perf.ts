// @ts-nocheck
import { ok } from 'node:assert'
import { test } from 'node:test'
import { $, value } from './core.ts'
import { filter } from './filter.ts'

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

test('filter setup - 10000 rows', () => {
  const elapsed = measure(() => {
    const src = $(makeData(10000))
    filter(src, d => d.active)
  })
  console.log(`  filter setup 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500)
})

test('filter update - insert 1 row to 10000', () => {
  const src = $(makeData(10000))
  const f = filter(src, d => d.active)
  const elapsed = measure(() => {
    src.insert({ active: true, val: 99999 })
  })
  console.log(`  filter insert 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 50)
})

test('filter update - batch update 1000 rows in 10000', () => {
  const src = $(makeData(10000))
  const f = filter(src, d => d.active)
  let toggle = false
  const elapsed = measure(() => {
    toggle = !toggle
    for (let i = 0; i < 1000; i++) src[i].active = toggle
  })
  console.log(`  filter batch update 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500)
})
