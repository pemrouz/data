// @ts-nocheck
import { ok } from 'node:assert'
import { test } from 'node:test'
import { $ } from '../../core.ts'
import { union } from './index.ts'
import { gateMeasure as measure } from '../../perf/measure.ts'


function makeData(start, n) {
  const obj = {}
  for (let i = 0; i < n; i++) obj[start + i] = `v${start + i}`
  return obj
}

// union mirrors intersect's bitmask layout — per-source delta is O(affected
// rows) once setup has seeded the bitmask map. Setup is O(rows × sources).
test('union setup - 3 sources of 10000 (overlapping)', () => {
  const elapsed = measure(() => {
    const a = $(makeData(0, 10000))
    const b = $(makeData(5000, 10000))
    const c = $(makeData(10000, 10000))
    union(a, b, c)
  })
  console.log(`  union setup 10k x3: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500)
})

test('union update - remove 1000 from b', () => {
  const a = $(makeData(0, 10000))
  const b = $(makeData(5000, 10000))
  const c = $(makeData(10000, 10000))
  union(a, b, c)
  const elapsed = measure(() => {
    for (let i = 0; i < 1000; i++) delete b[5000 + i]
    for (let i = 0; i < 1000; i++) b[5000 + i] = `v${5000 + i}`
  })
  console.log(`  union churn 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500)
})

test('union update - insert 1000 fresh rows into a', () => {
  const a = $(makeData(0, 10000))
  const b = $(makeData(5000, 10000))
  const c = $(makeData(10000, 10000))
  union(a, b, c)
  let i = 25000
  const elapsed = measure(() => {
    for (let k = 0; k < 1000; k++) { a[i] = `v${i}`; i++ }
  })
  console.log(`  union insert 10k+1000: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500)
})
