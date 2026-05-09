// @ts-nocheck
// MobX — pipeline split into three chained computeds, mirroring data's view
// graph. Each tick invalidates all three; reading `top.get()` recomputes
// `top → filtered → withSpread` in dependency order. Three full O(N) walks
// per tick instead of one fused inline loop.

import { observable, computed, runInAction, autorun } from 'mobx'
import { makeTrades, TICKS, THRESHOLD, TOP_K } from './workload.ts'
import { measure, pkgVersion, type BenchResult } from './measure.ts'

function build() {
  const trades = observable.array(
    makeTrades().map(t => observable.object(t, {}, { deep: false })),
  )
  const withSpread = computed(() => {
    const out = new Array(trades.length)
    for (let i = 0; i < trades.length; i++) {
      const t = trades[i]
      out[i] = { id: t.id, spread: t.ask - t.bid }
    }
    return out
  })
  const filtered = computed(() => withSpread.get().filter(t => t.spread > THRESHOLD))
  const top = computed(() => {
    const f = filtered.get()
    return [...f].sort((a, b) => b.spread - a.spread).slice(0, TOP_K)
  })
  let last = top.get()
  const dispose = autorun(() => { last = top.get() })
  return { trades, top, dispose, getLast: () => last }
}

function tick(trades, t) {
  runInAction(() => { trades[t.idx][t.field] = t.newValue })
}

export default function bench(): BenchResult {
  const setup = measure(() => {
    const g = build()
    g.dispose()
  })

  const single = (() => {
    const { trades, top } = build()
    let i = 0
    return measure(() => {
      tick(trades, TICKS[i++ % TICKS.length])
      void top.get()
    })
  })()

  const stream = (() => {
    const { trades, top } = build()
    return measure(() => {
      for (let j = 0; j < TICKS.length; j++) {
        tick(trades, TICKS[j])
        void top.get()
      }
    })
  })()

  return {
    name: 'mobx',
    version: pkgVersion('mobx'),
    setup,
    single,
    batch: stream,
    notes: 'three chained computeds (map / filter / sort+slice); 3× O(N) per tick',
  }
}
