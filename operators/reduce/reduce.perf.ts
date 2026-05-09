// @ts-nocheck
import { ok } from 'node:assert'
import { test } from 'node:test'
import { $ } from '../../core.ts'
import { reduce } from './index.ts'

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

// reduce rebuilds O(n) on every upstream event (general fold; no incremental
// path because the fn is non-commutative in general). For commutative ops
// users should pick `sum`/`avg` etc; this perf test guards the rebuild path.
test('reduce setup - 10000 rows', () => {
  const elapsed = measure(() => {
    const src = $(makeData(10000))
    reduce(src, (acc, r) => acc + r.val, 0)
  })
  console.log(`  reduce setup 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500)
})

test('reduce update - insert 1 row to 10000', () => {
  const src = $(makeData(10000))
  reduce(src, (acc, r) => acc + r.val, 0)
  let i = 10000
  const elapsed = measure(() => { src.insert({ active: true, val: i++ }) })
  console.log(`  reduce insert 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 50)
})

test('reduce update - batch update 100 rows in 10000', () => {
  const src = $(makeData(10000))
  reduce(src, (acc, r) => acc + r.val, 0)
  const elapsed = measure(() => {
    for (let i = 0; i < 100; i++) src[i].val = i + 1
  })
  console.log(`  reduce batch update 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 1000)
})
