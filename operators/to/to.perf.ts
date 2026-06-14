// @ts-nocheck
import { ok } from 'node:assert'
import { test } from 'node:test'
import { $ } from '../../core.ts'
import { to } from './index.ts'
import { gateMeasure as measure } from '../../perf/measure.ts'


function makeData(n) {
  const obj = {}
  for (let i = 0; i < n; i++) obj[i] = { active: i % 2 === 0, val: i }
  return obj
}

// `to` collapses every upstream event to one fn(value, prev) call. The cost
// per event is whatever the projection fn does, plus a single XU0 publish.
// Use a non-trivial projection (count active rows) so the test reflects the
// realistic "derived scalar" use case rather than a constant-time identity.
test('to setup - 10000 rows', () => {
  const elapsed = measure(() => {
    const src = $(makeData(10000))
    to(src, d => Object.values(d).filter(r => r.active).length)
  })
  console.log(`  to setup 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500)
})

test('to update - insert 1 row to 10000', () => {
  const src = $(makeData(10000))
  to(src, d => Object.values(d).filter(r => r.active).length)
  let i = 10000
  const elapsed = measure(() => {
    src.insert({ active: true, val: i++ })
  })
  console.log(`  to insert 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 50)
})

test('to update - batch update 1000 rows in 10000', () => {
  const src = $(makeData(10000))
  to(src, d => Object.values(d).filter(r => r.active).length)
  let toggle = false
  const elapsed = measure(() => {
    toggle = !toggle
    for (let i = 0; i < 1000; i++) src[i].active = toggle
  })
  console.log(`  to batch update 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 2000)
})
