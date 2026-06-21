// MobX — pipeline split into three chained computeds, mirroring data's view
// graph. Dashboard adds two parallel computeds (liquidCount, avgBid) reading
// the same trades — three independent consumers, each with its own O(N) walk
// per tick.

import { observable, computed, runInAction, autorun } from 'mobx'
import { makeTrades, TICKS, THRESHOLD, TOP_K } from './workload.ts'
import { measure, pkgVersion, type BenchResult } from './measure.ts'

function buildSingle() {
  const trades = observable.array(
    makeTrades().map((t: any) => observable.object(t, {}, { deep: false })),
  )
  const withSpread = computed(() => {
    const out = new Array(trades.length)
    for (let i = 0; i < trades.length; i++) {
      const t = trades[i]
      out[i] = { id: t.id, spread: t.ask - t.bid }
    }
    return out
  })
  const filtered = computed(() => withSpread.get().filter((t: any) => t.spread > THRESHOLD))
  const top = computed(() => {
    const f = filtered.get()
    return [...f].sort((a: any, b: any) => b.spread - a.spread).slice(0, TOP_K)
  })
  const dispose = autorun(() => { void top.get() })
  return { trades, top, dispose }
}

function buildDashboard() {
  const trades = observable.array(
    makeTrades().map((t: any) => observable.object(t, {}, { deep: false })),
  )
  const liquidCount = computed(() => {
    let n = 0
    for (let i = 0; i < trades.length; i++) {
      const t = trades[i]
      if (t.ask - t.bid > THRESHOLD) n++
    }
    return n
  })
  const withSpread = computed(() => {
    const out = new Array(trades.length)
    for (let i = 0; i < trades.length; i++) {
      const t = trades[i]
      out[i] = { id: t.id, spread: t.ask - t.bid }
    }
    return out
  })
  const filtered = computed(() => withSpread.get().filter((t: any) => t.spread > THRESHOLD))
  const top10 = computed(() => {
    const f = filtered.get()
    return [...f].sort((a: any, b: any) => b.spread - a.spread).slice(0, TOP_K)
  })
  const avgBid = computed(() => {
    let s = 0
    for (let i = 0; i < trades.length; i++) s += trades[i].bid
    return s / trades.length
  })
  const dispose = autorun(() => {
    void liquidCount.get()
    void top10.get()
    void avgBid.get()
  })
  return { trades, liquidCount, top10, avgBid, dispose }
}

function tick(trades: any, t: any) {
  runInAction(() => { trades[t.idx][t.field] = t.newValue })
}

export default function bench(): BenchResult {
  const setup = measure(() => {
    const g = buildSingle()
    g.dispose()
  })

  const single = (() => {
    const { trades, top } = buildSingle()
    let i = 0
    return measure(() => {
      tick(trades, TICKS[i++ % TICKS.length])
      void top.get()
    })
  })()

  const stream = (() => {
    const { trades, top } = buildSingle()
    return measure(() => {
      for (let j = 0; j < TICKS.length; j++) {
        tick(trades, TICKS[j])
        void top.get()
      }
    })
  })()

  const dashboard = (() => {
    const { trades, liquidCount, top10, avgBid } = buildDashboard()
    return measure(() => {
      for (let j = 0; j < TICKS.length; j++) {
        tick(trades, TICKS[j])
        void liquidCount.get()
        void top10.get()
        void avgBid.get()
      }
    })
  })()

  return {
    name: 'mobx',
    version: pkgVersion('mobx'),
    setup,
    single,
    batch: stream,
    dashboard,
    notes: 'observable.array + chained computeds; dashboard = 3 parallel consumers',
  }
}
