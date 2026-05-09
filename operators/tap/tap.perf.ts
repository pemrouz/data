// @ts-nocheck
import { ok } from 'node:assert'
import { test } from 'node:test'
import { $ } from '../../core.ts'
import { tap } from './index.ts'

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

// tap fires fn(change) on every event AND structuredClones the value into
// the change record. The clone dominates per-event cost — the test exists
// mainly to flag accidental regressions in the clone-on-every-event path.
test('tap setup - 10000 rows', () => {
  const elapsed = measure(() => {
    const src = $(makeData(10000))
    let count = 0
    tap(src, () => { count++ })
  })
  console.log(`  tap setup 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 1000)
})

test('tap update - insert 1 row to 10000', () => {
  const src = $(makeData(10000))
  let count = 0
  tap(src, () => { count++ })
  let i = 10000
  const elapsed = measure(() => { src.insert({ active: true, val: i++ }) })
  console.log(`  tap insert 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 50)
})

test('tap update - batch update 1000 rows in 10000', () => {
  const src = $(makeData(10000))
  let count = 0
  tap(src, () => { count++ })
  let toggle = false
  const elapsed = measure(() => {
    toggle = !toggle
    for (let i = 0; i < 1000; i++) src[i].active = toggle
  })
  console.log(`  tap batch update 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500)
})
