// @ts-nocheck
// Solid.js — per-row signals + createMemo computing top-K. Imports
// solid-js/dist/solid.js explicitly because the default `node` export
// resolves to the SSR build (signals are inert there).

import { createSignal, createMemo, createRoot } from 'solid-js/dist/solid.js'
import { makeTrades, TICKS, THRESHOLD, TOP_K } from './workload.ts'
import { measure, pkgVersion, type BenchResult } from './measure.ts'

type Cell = {
  id: number
  bid: () => number
  setBid: (n: number) => void
  ask: () => number
  setAsk: (n: number) => void
}

function build() {
  let cells: Cell[] = []
  let top = () => [] as any[]
  let last: any[] = []
  const dispose = createRoot(d => {
    cells = makeTrades().map(t => {
      const [bid, setBid] = createSignal(t.bid)
      const [ask, setAsk] = createSignal(t.ask)
      return { id: t.id, bid, setBid, ask, setAsk }
    })
    const memo = createMemo(() => {
      const out = []
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i]
        const spread = c.ask() - c.bid()
        if (spread > THRESHOLD) out.push({ id: c.id, spread })
      }
      out.sort((a, b) => b.spread - a.spread)
      return out.slice(0, TOP_K)
    })
    top = memo
    last = memo()
    return d
  })
  return { cells, top, dispose, getLast: () => last }
}

function tick(cells, t) {
  if (t.field === 'bid') cells[t.idx].setBid(t.newValue)
  else cells[t.idx].setAsk(t.newValue)
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
      void top()
    })
  })()

  const stream = (() => {
    const { cells, top } = build()
    return measure(() => {
      for (let j = 0; j < TICKS.length; j++) {
        tick(cells, TICKS[j])
        void top()
      }
    })
  })()

  return {
    name: 'solid',
    version: pkgVersion('solid-js'),
    setup,
    single,
    batch: stream,
    notes: 'per-row signals + memo; full filter + sort + slice per recompute',
  }
}
