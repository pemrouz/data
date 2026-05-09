// @ts-nocheck
// `data` (this library). Pipeline:
//
//   src.map(t => ({...t, spread: t.ask - t.bid}))
//      .filter(t => t.spread > THRESHOLD)
//      .za('spread', TOP_K)
//
// Three incremental stages compounding. On a `bid`/`ask` tick:
//   • map.process recomputes `spread` for one row, emits one BU1.
//   • filter.process re-evaluates the predicate for that row only.
//   • za keeps a sorted index by `spread`; repositions the row's entry in the
//     index (O(log N) bisect) and decides whether the change crosses the top-K
//     window — at most one insert + one remove on the visible set.
// No O(N) walk anywhere. Source is object-keyed for the same reason as before.

import { $, value } from '../../full.ts'
import { makeTrades, TICKS, THRESHOLD, TOP_K } from './workload.ts'
import { measure, pkgVersion, type BenchResult } from './measure.ts'

function toObj(rows) {
  const obj = {}
  for (let i = 0; i < rows.length; i++) obj[i] = rows[i]
  return obj
}

function build() {
  const src = $(toObj(makeTrades()))
  const top = src
    .map(t => ({ ...t, spread: t.ask - t.bid }))
    .filter(t => t.spread > THRESHOLD)
    .za('spread', TOP_K)
  return { src, top }
}

function tick(src, t) {
  src[t.idx][t.field] = t.newValue
}

export default function bench(): BenchResult {
  const setup = measure(() => { build() })

  const single = (() => {
    const { src, top } = build()
    void top[value]
    let i = 0
    return measure(() => {
      tick(src, TICKS[i++ % TICKS.length])
      void top[value]
    })
  })()

  const stream = (() => {
    const { src, top } = build()
    void top[value]
    return measure(() => {
      for (let j = 0; j < TICKS.length; j++) {
        tick(src, TICKS[j])
        void top[value]
      }
    })
  })()

  return {
    name: 'data',
    version: pkgVersion('data') !== 'unknown' ? pkgVersion('data') : '1.0.0',
    setup,
    single,
    batch: stream,
    notes: 'map + filter + za(K); per-tick: O(1) map/filter + O(log N) bisect',
  }
}
