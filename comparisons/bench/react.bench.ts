// @ts-nocheck
// react + react-test-renderer — useState(trades) + chained useMemo, then a
// dashboard with three parallel useMemos. Idiomatic React reactivity: setState
// replaces the array reference; useMemo skips work when deps are
// reference-equal, recomputes when they change.
//
// We use react-test-renderer (no DOM) so the same runtime that runs in
// production handles state + memo dependency tracking. Each tick goes through
// `act()` so the render flushes synchronously and the new memo result is
// readable inside the timed region.
//
// React 19 marks react-test-renderer deprecated; the runtime is still correct.

import './react-act-env.ts'
import React, { useState, useMemo } from 'react'
import TestRenderer from 'react-test-renderer'
import { makeTrades, TICKS, THRESHOLD, TOP_K } from './workload.ts'
import { measure, pkgVersion, type BenchResult } from './measure.ts'

const { act, create } = TestRenderer
const h = React.createElement

function makeSingle() {
  let setTradesRef: (fn: any) => void
  let topRef: any
  function App() {
    const [trades, setTrades] = useState(makeTrades)
    const withSpread = useMemo(
      () => trades.map(t => ({ id: t.id, spread: t.ask - t.bid })),
      [trades],
    )
    const filtered = useMemo(
      () => withSpread.filter(t => t.spread > THRESHOLD),
      [withSpread],
    )
    const top = useMemo(
      () => [...filtered].sort((a, b) => b.spread - a.spread).slice(0, TOP_K),
      [filtered],
    )
    setTradesRef = setTrades
    topRef = top
    return null
  }
  return {
    App,
    setTrades: (fn: any) => setTradesRef(fn),
    getTop: () => topRef,
  }
}

function makeDashboard() {
  let setTradesRef: (fn: any) => void
  const out: any = {}
  function App() {
    const [trades, setTrades] = useState(makeTrades)
    const liquidCount = useMemo(() => {
      let n = 0
      for (let i = 0; i < trades.length; i++) {
        const t = trades[i]
        if (t.ask - t.bid > THRESHOLD) n++
      }
      return n
    }, [trades])
    const withSpread = useMemo(
      () => trades.map(t => ({ id: t.id, spread: t.ask - t.bid })),
      [trades],
    )
    const filtered = useMemo(
      () => withSpread.filter(t => t.spread > THRESHOLD),
      [withSpread],
    )
    const top10 = useMemo(
      () => [...filtered].sort((a, b) => b.spread - a.spread).slice(0, TOP_K),
      [filtered],
    )
    const avgBid = useMemo(() => {
      let s = 0
      for (let i = 0; i < trades.length; i++) s += trades[i].bid
      return s / trades.length
    }, [trades])
    setTradesRef = setTrades
    out.liquidCount = liquidCount
    out.top10 = top10
    out.avgBid = avgBid
    return null
  }
  return {
    App,
    setTrades: (fn: any) => setTradesRef(fn),
    read: out,
  }
}

function buildSingle() {
  const m = makeSingle()
  let renderer: any
  act(() => { renderer = create(h(m.App)) })
  return { ...m, renderer }
}

function buildDashboard() {
  const m = makeDashboard()
  let renderer: any
  act(() => { renderer = create(h(m.App)) })
  return { ...m, renderer }
}

function tick(setTrades, t) {
  act(() => {
    setTrades((prev: any[]) => {
      const next = prev.slice()
      next[t.idx] = { ...next[t.idx], [t.field]: t.newValue }
      return next
    })
  })
}

export default function bench(): BenchResult {
  const setup = measure(() => {
    const g = buildSingle()
    act(() => { g.renderer.unmount() })
  })

  const single = (() => {
    const { setTrades, getTop } = buildSingle()
    let i = 0
    return measure(() => {
      tick(setTrades, TICKS[i++ % TICKS.length])
      void getTop()
    })
  })()

  const stream = (() => {
    const { setTrades, getTop } = buildSingle()
    return measure(() => {
      for (let j = 0; j < TICKS.length; j++) {
        tick(setTrades, TICKS[j])
        void getTop()
      }
    })
  })()

  const dashboard = (() => {
    const { setTrades, read } = buildDashboard()
    return measure(() => {
      for (let j = 0; j < TICKS.length; j++) {
        tick(setTrades, TICKS[j])
        void read.liquidCount
        void read.top10
        void read.avgBid
      }
    })
  })()

  return {
    name: 'react',
    version: pkgVersion('react'),
    setup,
    single,
    batch: stream,
    dashboard,
    notes: 'useState + useMemo chain; setState replaces array reference, full chain re-runs each tick',
  }
}
