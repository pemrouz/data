// @ts-nocheck
// @vue/reactivity — three chained computeds + dashboard adds two parallel
// computeds.

import { reactive, computed, effect } from '@vue/reactivity'
import { makeTrades, TICKS, THRESHOLD, TOP_K } from './workload.ts'
import { measure, pkgVersion, type BenchResult } from './measure.ts'

function buildSingle() {
  const trades = reactive(makeTrades())
  const withSpread = computed(() => {
    const out = new Array(trades.length)
    for (let i = 0; i < trades.length; i++) {
      const t = trades[i]
      out[i] = { id: t.id, spread: t.ask - t.bid }
    }
    return out
  })
  const filtered = computed(() => withSpread.value.filter(t => t.spread > THRESHOLD))
  const top = computed(() => [...filtered.value].sort((a, b) => b.spread - a.spread).slice(0, TOP_K))
  const runner = effect(() => { void top.value })
  return { trades, top, runner }
}

function buildDashboard() {
  const trades = reactive(makeTrades())
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
  const filtered = computed(() => withSpread.value.filter(t => t.spread > THRESHOLD))
  const top10 = computed(() => [...filtered.value].sort((a, b) => b.spread - a.spread).slice(0, TOP_K))
  const avgBid = computed(() => {
    let s = 0
    for (let i = 0; i < trades.length; i++) s += trades[i].bid
    return s / trades.length
  })
  const runner = effect(() => {
    void liquidCount.value
    void top10.value
    void avgBid.value
  })
  return { trades, liquidCount, top10, avgBid, runner }
}

function tick(trades, t) {
  trades[t.idx][t.field] = t.newValue
}

export default function bench(): BenchResult {
  const setup = measure(() => { buildSingle() })

  const single = (() => {
    const { trades, top } = buildSingle()
    let i = 0
    return measure(() => {
      tick(trades, TICKS[i++ % TICKS.length])
      void top.value
    })
  })()

  const stream = (() => {
    const { trades, top } = buildSingle()
    return measure(() => {
      for (let j = 0; j < TICKS.length; j++) {
        tick(trades, TICKS[j])
        void top.value
      }
    })
  })()

  const dashboard = (() => {
    const { trades, liquidCount, top10, avgBid } = buildDashboard()
    return measure(() => {
      for (let j = 0; j < TICKS.length; j++) {
        tick(trades, TICKS[j])
        void liquidCount.value
        void top10.value
        void avgBid.value
      }
    })
  })()

  return {
    name: 'vue-reactivity',
    version: pkgVersion('@vue/reactivity'),
    setup,
    single,
    batch: stream,
    dashboard,
    notes: 'reactive + chained computeds; dashboard = 3 parallel computeds',
  }
}
