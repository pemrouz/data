// @ts-nocheck
// Solid.js — three chained createMemos, mirroring data's view graph. Each tick
// dirties all three; reading `top()` pulls memo recomputes top → filtered →
// withSpread.

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
    const withSpread = createMemo(() => {
      const out = new Array(cells.length)
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i]
        out[i] = { id: c.id, spread: c.ask() - c.bid() }
      }
      return out
    })
    const filtered = createMemo(() => withSpread().filter(t => t.spread > THRESHOLD))
    const memo = createMemo(() => {
      const f = filtered()
      return [...f].sort((a, b) => b.spread - a.spread).slice(0, TOP_K)
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
    notes: 'three chained createMemos; per-row signals + 3× O(N) memo bodies',
  }
}
