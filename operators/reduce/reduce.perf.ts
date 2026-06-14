// @ts-nocheck
import { ok } from 'node:assert'
import { test } from 'node:test'
import { $ } from '../../core.ts'
import { reduce } from './index.ts'
import { gateMeasure as measure } from '../../perf/measure.ts'


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

// Incremental form — `reduce(add, remove, init)`. Insert and remove
// thread through O(Δ); the headline guard is that inserting one row
// into a 10k source costs roughly the same as inserting into a 100-row
// one, where the full `reduce(fn, init)` form is O(n) on every event.
test('reduce.incremental setup - 10000 rows', () => {
  const elapsed = measure(() => {
    const src = $(makeData(10000))
    reduce(src,
      (acc, r) => acc + r.val,
      (acc, r) => acc - r.val,
      0,
    )
  })
  console.log(`  reduce.incremental setup 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500)
})

test('reduce.incremental update - insert 1 row to 10000 (O(1), not O(n))', () => {
  const src = $(makeData(10000))
  reduce(src,
    (acc, r) => acc + r.val,
    (acc, r) => acc - r.val,
    0,
  )
  let i = 10000
  const elapsed = measure(() => { src.insert({ active: true, val: i++ }) })
  console.log(`  reduce.incremental insert 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 5)                                // O(1) per insert; much
                                                 // tighter than the 50ms
                                                 // budget the full form has
})

// BU1 (whole-slot overwrite of an existing key) now threads through the
// per-key value cache: remove(old) + add(new), O(Δ). Before the cache it
// fell back to a full O(n) re-fold on every overwrite — so overwriting 100
// rows of a 10k source went from ~100×O(n) to ~100×O(1).
test('reduce.incremental update - overwrite 100 rows in 10000 (O(Δ), not O(n))', () => {
  const src = $(makeData(10000))
  reduce(src,
    (acc, r) => acc + r.val,
    (acc, r) => acc - r.val,
    0,
  )
  let j = 0
  const elapsed = measure(() => {
    for (let i = 0; i < 100; i++) src[i] = { active: true, val: 100000 + (j++) }
  })
  console.log(`  reduce.incremental overwrite 100 in 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 50)                               // O(Δ): 100 single-row deltas,
                                                 // not 100 full 10k re-folds
})

// Removal cost over an array source has a baseline overhead from
// Array.prototype.splice / RowOperator's shift bookkeeping that's
// independent of the reduce path — the guard is just "no full rebuild."
test('reduce.incremental update - remove 100 rows from 10000', () => {
  const src = $(makeData(10000))
  reduce(src,
    (acc, r) => acc + r.val,
    (acc, r) => acc - r.val,
    0,
  )
  const elapsed = measure(() => {
    for (let i = 0; i < 100; i++) delete src[9900 + i]
  })
  console.log(`  reduce.incremental remove 100 from 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 100)
})
