// `data` (this library). Two graph shapes:
//
//   single-view (used by `setup`, `single`, `batch`):
//     trades.map((t: any) => ({...t, spread: t.ask - t.bid}))
//           .filter((t: any) => t.spread > THRESHOLD)
//           .za('spread', TOP_K)
//
//   dashboard (used by `dashboard`):
//     three independent views off the same source —
//       liquidCount = trades.filter((t: any) => t.ask - t.bid > THRESHOLD).length()
//       top10       = trades.map(...).filter(...).za('spread', TOP_K)
//       avgBid      = trades.avg('bid')   // O(1) per delta — running mean
//     each tick must settle all three.

import { $, value } from '../../full.ts'
import { makeTrades, TICKS, THRESHOLD, TOP_K } from './workload.ts'
import { measure, pkgVersion, type BenchResult } from './measure.ts'

function toObj(rows: any) {
  const obj: any = {}
  for (let i = 0; i < rows.length; i++) obj[i] = rows[i]
  return obj
}

function buildSingle() {
  const src = $(toObj(makeTrades()))
  const top = src
    .map((t: any) => ({ ...t, spread: t.ask - t.bid }))
    .filter((t: any) => t.spread > THRESHOLD)
    .za('spread', TOP_K)
  return { src, top }
}

function buildDashboard() {
  const src = $(toObj(makeTrades()))
  const liquidCount = src
    .filter((t: any) => t.ask - t.bid > THRESHOLD)
    .length()
  const top10 = src
    .map((t: any) => ({ ...t, spread: t.ask - t.bid }))
    .filter((t: any) => t.spread > THRESHOLD)
    .za('spread', TOP_K)
  const avgBid = src.avg('bid')
  return { src, liquidCount, top10, avgBid }
}

function tick(src: any, t: any) {
  src[t.idx][t.field] = t.newValue
}

export default function bench(): BenchResult {
  const setup = measure(() => { buildSingle() })

  const single = (() => {
    const { src, top } = buildSingle()
    void top[value]
    let i = 0
    return measure(() => {
      tick(src, TICKS[i++ % TICKS.length])
      void top[value]
    })
  })()

  const stream = (() => {
    const { src, top } = buildSingle()
    void top[value]
    return measure(() => {
      for (let j = 0; j < TICKS.length; j++) {
        tick(src, TICKS[j])
        void top[value]
      }
    })
  })()

  const dashboard = (() => {
    const { src, liquidCount, top10, avgBid } = buildDashboard()
    void liquidCount[value]
    void top10[value]
    void avgBid[value]
    return measure(() => {
      for (let j = 0; j < TICKS.length; j++) {
        tick(src, TICKS[j])
        void liquidCount[value]
        void top10[value]
        void avgBid[value]
      }
    })
  })()

  return {
    name: 'data',
    version: pkgVersion('data') !== 'unknown' ? pkgVersion('data') : '1.0.0',
    setup,
    single,
    batch: stream,
    dashboard,
    notes: 'map+filter+za chain; dashboard = liquidCount + top10 + avg(bid) settled per tick',
  }
}
