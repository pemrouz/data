// @ts-nocheck
import { ok } from 'node:assert'
import { test } from 'node:test'
import { $, value } from '../../core.ts'
import { gateMeasure as measure } from '../../perf/measure.ts'
import { filter } from './index.ts'

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
