// @ts-nocheck
import { ok } from 'node:assert'
import { test } from 'node:test'
import { $ } from '../../core.ts'
import { except } from './index.ts'
import { gateMeasure as measure } from '../../perf/measure.ts'


function makeData(start, n) {
  const obj = {}
  for (let i = 0; i < n; i++) obj[start + i] = `v${start + i}`
  return obj
}

// except keeps rows in p but not in `other`. Setup walks p once; per-event
// updates from either side are O(affected rows).
test('except setup - 10000 minus 5000', () => {
  const elapsed = measure(() => {
    const a = $(makeData(0, 10000))
    const b = $(makeData(0, 5000))
    except(a, b)
  })
  console.log(`  except setup 10k-5k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500)
})

// Inserting into `other` should drop matching rows from the output —
// exercises BI0 from other branch.
test('except update - insert 1000 into other', () => {
  const a = $(makeData(0, 10000))
  const b = $(makeData(0, 5000))
  except(a, b)
  let i = 5000
  const elapsed = measure(() => {
    for (let k = 0; k < 1000; k++) { b[i] = `v${i}`; i++ }
  })
  console.log(`  except insert other 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500)
})

// Removing from `other` re-admits rows that p still has — exercises BR1
// from other branch.
test('except update - remove 1000 from other', () => {
  const a = $(makeData(0, 10000))
  const b = $(makeData(0, 5000))
  except(a, b)
  const elapsed = measure(() => {
    for (let i = 0; i < 1000; i++) delete b[i]
  })
  console.log(`  except remove other 10k: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500)
})
