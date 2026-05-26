// @ts-nocheck
// Verify the fused intersect-length operator emits the same histogram as
// the baseline `source.intersect(dims, except).length(fn)` chain across a
// range of mutations: setup, simple brush, multi-dim brush sequence, and
// row-level updates.

import { test } from 'node:test'
import { deepStrictEqual as same } from 'node:assert'
import { $, value } from '../../full.ts'
import { intersectLength } from './intersect-length-fused.ts'

function makeRows(n) {
  const out = []
  for (let i = 0; i < n; i++) {
    out.push({
      delay: ((i * 9301 + 49297) % 233280) / 233280 * 200 - 50,
      distance: ((i * 49297 + 9301) % 233280) / 233280 * 2000,
      time: ((i * 7919 + 1) % 233280) / 233280 * 24,
      date: ((i * 6151 + 11) % 233280) / 233280 * 86400000 * 90,
    })
  }
  return out
}

const byHour       = d => Math.floor(d.time)
const byTenMins    = d => Math.floor(d.delay / 10) * 10
const byFiftyMiles = d => Math.floor(d.distance / 50) * 50

const flatten = h => {
  const o = {}
  for (const k in h) if (h[k]?.value > 0) o[k] = h[k].value
  return o
}

function build(rows) {
  const a = $(rows.slice())
  const filtersA = $({ time: [], delay: [], distance: [], date: [] })
  const dimsA = {
    time:     a.between('time',     filtersA.time),
    delay:    a.between('delay',    filtersA.delay),
    distance: a.between('distance', filtersA.distance),
    date:     a.between('date',     filtersA.date),
  }
  const baseline = a.intersect(dimsA, 'delay').length(byTenMins)

  const b = $(rows.slice())
  const filtersB = $({ time: [], delay: [], distance: [], date: [] })
  const dimsB = {
    time:     b.between('time',     filtersB.time),
    delay:    b.between('delay',    filtersB.delay),
    distance: b.between('distance', filtersB.distance),
    date:     b.between('date',     filtersB.date),
  }
  const fused = intersectLength(b, dimsB, 'delay', byTenMins)

  // Keep alive
  baseline.connect([])
  fused.connect([])

  return { a, b, filtersA, filtersB, baseline, fused }
}

test('fusion equals baseline — initial state', () => {
  const { baseline, fused } = build(makeRows(2000))
  same(flatten(baseline[value]), flatten(fused[value]))
})

test('fusion equals baseline — single brush', () => {
  const { filtersA, filtersB, baseline, fused } = build(makeRows(2000))
  filtersA.time = [6, 18]
  filtersB.time = [6, 18]
  same(flatten(baseline[value]), flatten(fused[value]))
})

test('fusion equals baseline — multi-dim brush sequence', () => {
  const { filtersA, filtersB, baseline, fused } = build(makeRows(3000))
  const seq = [
    ['time', [6, 22]],
    ['distance', [200, 1500]],
    ['date', [0, 86400000 * 30]],
    ['time', [10, 14]],
    ['distance', [500, 1500]],
    ['time', [0, 24]],   // unfilter
    ['distance', [0, 2000]], // unfilter
  ]
  for (const [name, range] of seq) {
    filtersA[name] = range
    filtersB[name] = range
    same(flatten(baseline[value]), flatten(fused[value]),
      `mismatch after brush ${name}=${range}`)
  }
})

test('fusion equals baseline — leave-one-out (brushing the excluded dim must NOT shift the histogram)', () => {
  // intersect(dims, 'delay') excludes the delay dim — so brushing delay
  // should leave the histogram (which is bucketed by delay) unchanged.
  const { filtersA, filtersB, baseline, fused } = build(makeRows(2000))
  const before = flatten(baseline[value])
  filtersA.delay = [0, 50]
  filtersB.delay = [0, 50]
  same(flatten(baseline[value]), before, 'baseline shifted on excluded-dim brush!')
  same(flatten(fused[value]), before, 'fused shifted on excluded-dim brush!')
})

test('fusion equals baseline — row updates via BU1', () => {
  const { a, b, filtersA, filtersB, baseline, fused } = build(makeRows(500))
  filtersA.time = [6, 18]
  filtersB.time = [6, 18]
  // Mutate a row's delay (the bucket key) — should move it between buckets.
  for (let i = 0; i < 50; i++) {
    a[i].delay = i * 3 - 30
    b[i].delay = i * 3 - 30
  }
  same(flatten(baseline[value]), flatten(fused[value]))
})
