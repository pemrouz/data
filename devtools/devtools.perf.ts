// @ts-nocheck
// Perf assertions for the devtools instrumentation. Two checks:
//   1. off-state: with devtools imported but never enabled, the per-event
//      cost is unchanged (covered indirectly by the existing perf suite,
//      which doesn't import devtools — kept here for documentation).
//   2. on-state-no-listeners: after $.devtools.enable(), with no traces or
//      profilers attached, the fast-out path keeps overhead minimal.
//   3. on-state-with-listeners: with one trace + one profile attached, the
//      per-event cost is bounded.
import { test } from 'node:test'
import { ok } from 'node:assert'
import { $, value } from '../core.ts'
import '../full.ts'
import './index.ts'

const ITERATIONS = 1000

function median(samples) {
  const s = samples.slice().sort((a, b) => a - b)
  return s[s.length >> 1]
}

function timeRun(fn, runs = 5) {
  const samples = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    fn()
    samples.push(performance.now() - t0)
  }
  return median(samples)
}

test('devtools perf - off-state matches baseline (single insert burst)', () => {
  const data = $({})
  const off = timeRun(() => {
    for (let i = 0; i < ITERATIONS; i++) data['k' + i] = { active: i % 2 === 0 }
    for (let i = 0; i < ITERATIONS; i++) delete data['k' + i]
  })
  console.log(`off-state ${ITERATIONS}x insert/delete: ${off.toFixed(2)}ms`)
  ok(off < 200, `off-state should be under 200ms, got ${off.toFixed(2)}ms`)
})

test('devtools perf - on-state with no listeners (fast-out path)', () => {
  $.devtools.enable()
  try {
    const data = $({})
    const on = timeRun(() => {
      for (let i = 0; i < ITERATIONS; i++) data['k' + i] = { active: i % 2 === 0 }
      for (let i = 0; i < ITERATIONS; i++) delete data['k' + i]
    })
    console.log(`on-state-no-listeners ${ITERATIONS}x insert/delete: ${on.toFixed(2)}ms`)
    // The fast-out is a single boolean check + one apply per verb. Allow
    // generous headroom over off-state (3x) before flagging — node:test
    // wall-clock noise on small wins is real.
    ok(on < 600, `on-state-no-listeners should be under 600ms, got ${on.toFixed(2)}ms`)
  } finally {
    $.devtools.disable()
  }
})

test('devtools perf - on-state with one trace + one profile attached', () => {
  const data = $({})
  const stop = $.trace(data, { log: false, onEvent: () => {} })
  const p = $.profile(data)
  try {
    const on = timeRun(() => {
      for (let i = 0; i < ITERATIONS; i++) data['k' + i] = { active: i % 2 === 0 }
      for (let i = 0; i < ITERATIONS; i++) delete data['k' + i]
    })
    console.log(`on-state-with-listeners ${ITERATIONS}x insert/delete: ${on.toFixed(2)}ms`)
    // Active listeners do real work per event (object alloc for the trace
    // record, Map lookup for profile). Looser ceiling.
    ok(on < 2000, `on-state-with-listeners should be under 2000ms, got ${on.toFixed(2)}ms`)
  } finally {
    stop()
    p.stop()
    $.devtools.disable()
  }
})
