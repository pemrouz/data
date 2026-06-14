// @ts-nocheck
import { ok } from 'node:assert'
import { test } from 'node:test'
import { $, value } from '../../core.ts'
import { between } from './index.ts'
import { gateMeasure as measure } from '../../perf/measure.ts'


function makeData(n) {
  const obj = {}
  for (let i = 0; i < n; i++) obj[i] = { val: Math.random() * 1000 }
  return obj
}

test('between setup - 10000 rows', () => {
  const elapsed = measure(() => {
    const src = $(makeData(10000))
    const bounds = $({ lo: 200, hi: 800 })
    between(src, 'val', [bounds.lo, bounds.hi])
  })
  console.log(`  between setup 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500)
})

test('between narrow filter - 10000 rows', () => {
  const src = $(makeData(10000))
  const bounds = $({ lo: 0, hi: 1000 })
  between(src, 'val', [bounds.lo, bounds.hi])
  const elapsed = measure(() => {
    bounds.lo = 400; bounds.hi = 600
    bounds.lo = 0;   bounds.hi = 1000
  })
  console.log(`  between narrow/widen 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 100)
})

// P1: insert/remove on an object source defer `sorted` maintenance (the same
// dirty-flag amortization BU2 uses) so each is O(1) instead of O(N) indexOf +
// splice per row. This is the births/deaths workload (e.g. an object-keyed
// population streaming inserts/removes with brushes only occasionally).
test('between insert churn - object 10k + 1000', () => {
  const src = $(makeData(10000))
  const bounds = $({ lo: 200, hi: 800 })
  between(src, 'val', [bounds.lo, bounds.hi])
  let id = 100000
  const elapsed = measure(() => {
    for (let i = 0; i < 1000; i++) (src as any).insert({ val: Math.random() * 1000 }, 'n' + (id++))
  }, 3)
  console.log(`  between insert churn obj +1000: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 50)
})

test('between remove churn - object 10k - 5×1000', () => {
  const src = $(makeData(10000))
  const bounds = $({ lo: 200, hi: 800 })
  between(src, 'val', [bounds.lo, bounds.hi])
  let base = 0
  const elapsed = measure(() => {
    for (let i = 0; i < 1000; i++) delete src[base + i]   // distinct keys per rep
    base += 1000
  }, 5)
  console.log(`  between remove churn obj -1000: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 50)
})
