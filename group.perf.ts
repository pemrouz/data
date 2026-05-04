// @ts-nocheck
import { ok } from 'node:assert'
import { test } from 'node:test'
import { $, value } from './core.ts'
import { group } from './group.ts'

const REPS = 5
const measure = (fn, reps = REPS) => {
  const times = []
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now(); fn(); times.push(performance.now() - t0)
  }
  return [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)]
}

function makeData(n, categories = 10) {
  const obj = {}
  for (let i = 0; i < n; i++) obj[i] = { cat: i % categories, val: i }
  return obj
}

test('group setup - 10000 rows 10 categories', () => {
  const elapsed = measure(() => {
    const src = $(makeData(10000))
    group(src, d => d.cat)
  })
  console.log(`  group setup 10k/10cat: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500)
})

test('group insert - 10000 rows', () => {
  const src = $(makeData(10000))
  group(src, d => d.cat)
  let i = 10000
  const elapsed = measure(() => {
    src.insert({ cat: i % 10, val: i }); i++
  })
  console.log(`  group insert 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 50)
})
