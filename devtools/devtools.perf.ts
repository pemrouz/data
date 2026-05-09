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

test('devtools perf - cascade recorder attached, bounded overhead', () => {
  // The recorder allocates a frame object per patched verb call plus pushes
  // a parent index onto a stack. Per-event cost is comparable to the trace
  // listener (object alloc dominates); ceiling matches the trace+profile
  // case so a regression in either path lights up here.
  const data = $({})
  const filtered = data.filter(d => d.active)
  const counted = filtered.length()
  const rec = $.cascades(data, { maxCascades: 50 })
  try {
    const on = timeRun(() => {
      for (let i = 0; i < ITERATIONS; i++) data['k' + i] = { active: i % 2 === 0 }
      for (let i = 0; i < ITERATIONS; i++) delete data['k' + i]
    })
    console.log(`cascade-recorder ${ITERATIONS}x insert/delete: ${on.toFixed(2)}ms`)
    ok(on < 2000, `cascade-recorder should be under 2000ms, got ${on.toFixed(2)}ms`)
  } finally {
    rec.stop()
    $.devtools.disable()
  }
  ok(counted)
})

test('devtools perf - cascade recorder buffer cap holds memory bounded', async () => {
  // With a small cap, many distinct cascades should produce exactly `cap`
  // retained — this is the contract the panel relies on to render a
  // fixed-size list without growing memory unboundedly. Mutations need a
  // microtask yield between them (cascade-close runs in queueMicrotask
  // and sync mutations within a tick coalesce); 100 yields is plenty to
  // verify the cap of 25 is enforced.
  const data = $({})
  const rec = $.cascades(data, { maxCascades: 25 })
  try {
    for (let i = 0; i < 100; i++) {
      data['k' + i] = i
      await Promise.resolve()
    }
    const out = rec.report()
    ok(out.length === 25, `expected exactly 25 cascades, got ${out.length}`)
    // Newest preserved: last id should be the largest.
    const ids = out.map(c => c.id)
    ok(Math.max(...ids) === ids[ids.length - 1], 'newest cascade should be last')
  } finally {
    rec.stop()
    $.devtools.disable()
  }
})
