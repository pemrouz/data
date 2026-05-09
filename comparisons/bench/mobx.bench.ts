// @ts-nocheck
// MobX — observable.array of observable.objects; `computed` filters and
// sorts/slices to top K. Each tick = one mutation in runInAction; reading the
// computed forces the full sort + slice.

import { observable, computed, runInAction, autorun } from 'mobx'
import { makeTrades, TICKS, THRESHOLD, TOP_K } from './workload.ts'
import { measure, pkgVersion, type BenchResult } from './measure.ts'

function build() {
  const trades = observable.array(
    makeTrades().map(t => observable.object(t, {}, { deep: false })),
  )
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
    notes: 'observable.array + computed; full filter + sort + slice per tick',
  }
}
