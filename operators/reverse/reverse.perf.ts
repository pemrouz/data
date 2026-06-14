// @ts-nocheck
import { ok } from 'node:assert'
import { test } from 'node:test'
import { $ } from '../../core.ts'
import { reverse } from './index.ts'
import { gateMeasure as measure } from '../../perf/measure.ts'


function makeData(n) {
  const obj = {}
  for (let i = 0; i < n; i++) obj[i] = { active: i % 2 === 0, val: i }
  return obj
}

// reverse rebuilds via Array#filter+reverse on every upstream event. O(n)
// per change. If incremental BR1A/BI0A semantics are added later (per the
// rationale comment on ReverseValue), the per-event threshold here is the
// budget that should drop sharply.
test('reverse setup - 10000 rows', () => {
  const elapsed = measure(() => {
    const src = $(makeData(10000))
    reverse(src)
  })
  console.log(`  reverse setup 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500)
})

test('reverse update - insert 1 row to 10000', () => {
  const src = $(makeData(10000))
  reverse(src)
  let i = 10000
  const elapsed = measure(() => { src.insert({ active: true, val: i++ }) })
  console.log(`  reverse insert 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 50)
})

test('reverse update - batch update 100 rows in 10000', () => {
  const src = $(makeData(10000))
  reverse(src)
  const elapsed = measure(() => {
    for (let i = 0; i < 100; i++) src[i].val = i + 1
  })
  console.log(`  reverse batch update 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 1000)
})
