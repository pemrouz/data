// @ts-nocheck
// @vue/reactivity — reactive(rows) deep-proxies; computed walks + sorts.

import { reactive, computed, effect } from '@vue/reactivity'
import { makeTrades, TICKS, THRESHOLD, TOP_K } from './workload.ts'
import { measure, pkgVersion, type BenchResult } from './measure.ts'

function build() {
  const trades = reactive(makeTrades())
  const top = computed(() => {
    const out = []
    for (let i = 0; i < trades.length; i++) {
      const t = trades[i]
      const spread = t.ask - t.bid
      if (spread > THRESHOLD) out.push({ id: t.id, spread })
    }
    out.sort((a, b) => b.spread - a.spread)
    return out.slice(0, TOP_K)
  })
  let last: any[] = []
  const runner = effect(() => { last = top.value })
  return { trades, top, runner, getLast: () => last }
}

function tick(trades, t) {
  trades[t.idx][t.field] = t.newValue
}

export default function bench(): BenchResult {
  const setup = measure(() => { build() })

  const single = (() => {
    const { trades, top } = build()
    let i = 0
    return measure(() => {
      tick(trades, TICKS[i++ % TICKS.length])
      void top.value
    })
  })()

  const stream = (() => {
    const { trades, top } = build()
    return measure(() => {
      for (let j = 0; j < TICKS.length; j++) {
        tick(trades, TICKS[j])
        void top.value
      }
    })
  })()

  return {
    name: 'vue-reactivity',
    version: pkgVersion('@vue/reactivity'),
    setup,
    single,
    batch: stream,
    notes: 'reactive(rows) + computed; full filter + sort + slice per recompute',
  }
}
