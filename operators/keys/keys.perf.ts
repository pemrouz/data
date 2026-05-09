// @ts-nocheck
import { ok } from 'node:assert'
import { test } from 'node:test'
import { $ } from '../../core.ts'
import { keys, values } from './index.ts'

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

// keys/values are sugar over Object.keys / Object.values — both rebuild on
// every change. Native Object.keys is fast (engine-internal) so the
// thresholds are tighter than for the iter-based rebuilders.
test('keys setup - 10000 rows', () => {
  const elapsed = measure(() => {
    const src = $(makeData(10000))
    keys(src)
  })
  console.log(`  keys setup 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500)
})

test('keys update - insert 1 row to 10000', () => {
  const src = $(makeData(10000))
  keys(src)
  let i = 10000
  const elapsed = measure(() => { src.insert({ active: true, val: i++ }) })
  console.log(`  keys insert 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 50)
})

test('values setup - 10000 rows', () => {
  const elapsed = measure(() => {
    const src = $(makeData(10000))
    values(src)
  })
  console.log(`  values setup 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500)
})

test('values update - batch update 100 rows in 10000', () => {
  const src = $(makeData(10000))
  values(src)
  const elapsed = measure(() => {
    for (let i = 0; i < 100; i++) src[i].val = i + 1
  })
  console.log(`  values batch update 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 1000)
})
