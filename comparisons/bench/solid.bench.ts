// Solid.js — three chained createMemos for the top-K graph. Dashboard adds
// two parallel memos (liquidCount, avgBid) over the same per-row signals.

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

function makeCells() {
  return makeTrades().map((t: any) => {
    const [bid, setBid] = createSignal(t.bid)
    const [ask, setAsk] = createSignal(t.ask)
    return { id: t.id, bid, setBid, ask, setAsk }
  })
}

function buildSingle() {
  let cells: Cell[] = []
  let top = () => [] as any[]
  const dispose = createRoot((d: any) => {
    cells = makeCells()
    const withSpread = createMemo(() => {
      const out = new Array(cells.length)
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i]
        out[i] = { id: c.id, spread: c.ask() - c.bid() }
      }
      return out
    })
    const filtered = createMemo(() => withSpread().filter((t: any) => t.spread > THRESHOLD))
    const memo = createMemo(() => [...filtered()].sort((a: any, b: any) => b.spread - a.spread).slice(0, TOP_K))
    top = memo
    void memo()
    return d
  })
  return { cells, top, dispose }
}

function buildDashboard() {
  let cells: Cell[] = []
  let liquidCount = () => 0
  let top10 = () => [] as any[]
  let avgBid = () => 0
  const dispose = createRoot((d: any) => {
    cells = makeCells()
    liquidCount = createMemo(() => {
      let n = 0
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i]
        if (c.ask() - c.bid() > THRESHOLD) n++
      }
      return n
    })
    const withSpread = createMemo(() => {
      const out = new Array(cells.length)
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i]
        out[i] = { id: c.id, spread: c.ask() - c.bid() }
      }
      return out
    })
    const filtered = createMemo(() => withSpread().filter((t: any) => t.spread > THRESHOLD))
    top10 = createMemo(() => [...filtered()].sort((a: any, b: any) => b.spread - a.spread).slice(0, TOP_K))
    avgBid = createMemo(() => {
      let s = 0
      for (let i = 0; i < cells.length; i++) s += cells[i].bid()
      return s / cells.length
    })
    void liquidCount(); void top10(); void avgBid()
    return d
  })
  return { cells, liquidCount, top10, avgBid, dispose }
}

function tick(cells: any, t: any) {
  if (t.field === 'bid') cells[t.idx].setBid(t.newValue)
  else cells[t.idx].setAsk(t.newValue)
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
      void top()
    })
  })()

  const stream = (() => {
    const { cells, top } = buildSingle()
    return measure(() => {
      for (let j = 0; j < TICKS.length; j++) {
        tick(cells, TICKS[j])
        void top()
      }
    })
  })()

  const dashboard = (() => {
    const { cells, liquidCount, top10, avgBid } = buildDashboard()
    return measure(() => {
      for (let j = 0; j < TICKS.length; j++) {
        tick(cells, TICKS[j])
        void liquidCount()
        void top10()
        void avgBid()
      }
    })
  })()

  return {
    name: 'solid',
    version: pkgVersion('solid-js'),
    setup,
    single,
    batch: stream,
    dashboard,
    notes: 'per-row signals + chained memos; dashboard = 3 parallel memos',
  }
}
