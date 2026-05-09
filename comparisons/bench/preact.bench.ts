// @ts-nocheck
// @preact/signals-core — three chained computeds, mirroring data's view graph.

import { signal, computed, effect } from '@preact/signals-core'
import { makeTrades, TICKS, THRESHOLD, TOP_K } from './workload.ts'
import { measure, pkgVersion, type BenchResult } from './measure.ts'

function build() {
  const cells = makeTrades().map(t => ({
    id: t.id,
    bid: signal(t.bid),
    ask: signal(t.ask),
  }))
  const withSpread = computed(() => {
    const out = new Array(cells.length)
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]
      out[i] = { id: c.id, spread: c.ask.value - c.bid.value }
    }
    return out
  })
  const filtered = computed(() => withSpread.value.filter(t => t.spread > THRESHOLD))
  const top = computed(() => {
    const f = filtered.value
    return [...f].sort((a, b) => b.spread - a.spread).slice(0, TOP_K)
  })
  let last: any[] = []
  const dispose = effect(() => { last = top.value })
  return { cells, top, dispose, getLast: () => last }
}

function tick(cells, t) {
  if (t.field === 'bid') cells[t.idx].bid.value = t.newValue
  else cells[t.idx].ask.value = t.newValue
}

export default function bench(): BenchResult {
  const setup = measure(() => {
    const g = build()
    g.dispose()
  })

  const single = (() => {
    const { cells, top } = build()
    let i = 0
    return measure(() => {
      tick(cells, TICKS[i++ % TICKS.length])
      void top.value
    })
  })()

  const stream = (() => {
    const { cells, top } = build()
    return measure(() => {
      for (let j = 0; j < TICKS.length; j++) {
        tick(cells, TICKS[j])
        void top.value
      }
    })
  })()

  return {
    name: 'preact-signals',
    version: pkgVersion('@preact/signals-core'),
    setup,
    single,
    batch: stream,
    notes: 'three chained computeds; per-row signals + 3× O(N) per recompute',
  }
}
