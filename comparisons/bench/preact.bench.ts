// @preact/signals-core — three chained computeds + dashboard adds two
// parallel computeds (liquidCount, avgBid).

import { signal, computed, effect } from '@preact/signals-core'
import { makeTrades, TICKS, THRESHOLD, TOP_K } from './workload.ts'
import { measure, pkgVersion, type BenchResult } from './measure.ts'

function makeCells() {
  return makeTrades().map((t: any) => ({
    id: t.id,
    bid: signal(t.bid),
    ask: signal(t.ask),
  }))
}

function buildSingle() {
  const cells = makeCells()
  const withSpread = computed(() => {
    const out = new Array(cells.length)
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]
      out[i] = { id: c.id, spread: c.ask.value - c.bid.value }
    }
    return out
  })
  const filtered = computed(() => withSpread.value.filter((t: any) => t.spread > THRESHOLD))
  const top = computed(() => [...filtered.value].sort((a: any, b: any) => b.spread - a.spread).slice(0, TOP_K))
  const dispose = effect(() => { void top.value })
  return { cells, top, dispose }
}

function buildDashboard() {
  const cells = makeCells()
  const liquidCount = computed(() => {
    let n = 0
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]
      if (c.ask.value - c.bid.value > THRESHOLD) n++
    }
    return n
  })
  const withSpread = computed(() => {
    const out = new Array(cells.length)
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]
      out[i] = { id: c.id, spread: c.ask.value - c.bid.value }
    }
    return out
  })
  const filtered = computed(() => withSpread.value.filter((t: any) => t.spread > THRESHOLD))
  const top10 = computed(() => [...filtered.value].sort((a: any, b: any) => b.spread - a.spread).slice(0, TOP_K))
  const avgBid = computed(() => {
    let s = 0
    for (let i = 0; i < cells.length; i++) s += cells[i].bid.value
    return s / cells.length
  })
  const dispose = effect(() => {
    void liquidCount.value
    void top10.value
    void avgBid.value
  })
  return { cells, liquidCount, top10, avgBid, dispose }
}

function tick(cells: any, t: any) {
  if (t.field === 'bid') cells[t.idx].bid.value = t.newValue
  else cells[t.idx].ask.value = t.newValue
}

export default function bench(): BenchResult {
  const setup = measure(() => {
    const g = buildSingle()
    g.dispose()
  })

  const single = (() => {
    const { cells, top } = buildSingle()
    let i = 0
    return measure(() => {
      tick(cells, TICKS[i++ % TICKS.length])
      void top.value
    })
  })()

  const stream = (() => {
    const { cells, top } = buildSingle()
    return measure(() => {
      for (let j = 0; j < TICKS.length; j++) {
        tick(cells, TICKS[j])
        void top.value
      }
    })
  })()

  const dashboard = (() => {
    const { cells, liquidCount, top10, avgBid } = buildDashboard()
    return measure(() => {
      for (let j = 0; j < TICKS.length; j++) {
        tick(cells, TICKS[j])
        void liquidCount.value
        void top10.value
        void avgBid.value
      }
    })
  })()

  return {
    name: 'preact-signals',
    version: pkgVersion('@preact/signals-core'),
    setup,
    single,
    batch: stream,
    dashboard,
    notes: 'per-row signals + chained computeds; dashboard = 3 parallel computeds',
  }
}
