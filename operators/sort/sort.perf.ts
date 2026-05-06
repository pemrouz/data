// @ts-nocheck
import { ok } from 'node:assert'
import { test } from 'node:test'
import { $, value } from '../../core.ts'
import { sort } from './index.ts'

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
  for (let i = 0; i < n; i++) obj[i] = { score: Math.random() * 1000, id: i }
  return obj
}

test('sort setup - 10000 rows top 100', () => {
  const elapsed = measure(() => {
    const src = $(makeData(10000))
    sort(src, 'score', 100)
  })
  console.log(`  sort setup 10k top-100: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500)
})

test('sort insert - 10000 rows top 100', () => {
  const src = $(makeData(10000))
  sort(src, 'score', 100)
  let i = 10000
  const elapsed = measure(() => {
    src.insert({ score: Math.random() * 1000, id: i++ })
  })
  console.log(`  sort insert 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 50)
})

// In-window rank change: pick the row currently at rank N-1 and bump its score
// past rank 0. This used to emit O(N) BU1 events for the whole rotation span;
// with BMV1 it is a single move event plus the column update.
test('sort rotate - 10000 rows top 100, in-window rank change', () => {
  const data = makeData(10000)
  const src = $(data)
  const res = sort(src, 'score', 100)
  const lastInWindow = res[value][res[value].length - 1].id
  const max = Math.max(...res[value].map(r => r.score))
  let bump = max + 1
  const elapsed = measure(() => {
    src[lastInWindow].score = bump++
  })
  console.log(`  sort rotate 10k top-100: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 50)
})
