// @ts-nocheck
// crossfilter2 — top-K via the spread dimension's `dim.top(K)`. Dashboard
// adds two parallel reductions (liquidCount via groupAll().reduceCount();
// avgBid via groupAll().reduce(...) for sum/count).

import crossfilter from 'crossfilter2'
import { makeTrades, TICKS, THRESHOLD, TOP_K } from './workload.ts'
import { measure, pkgVersion, type BenchResult } from './measure.ts'

function buildSingle(initRows) {
  const state = initRows.map(r => ({ ...r }))
  const cf = crossfilter(state)
  const dSpread = cf.dimension(d => d.ask - d.bid)
  dSpread.filterRange([THRESHOLD + 1e-9, Infinity])
  return { cf, dSpread, state }
}

function buildDashboard(initRows) {
  const state = initRows.map(r => ({ ...r }))
  const cf = crossfilter(state)
  const dSpread = cf.dimension(d => d.ask - d.bid)
  dSpread.filterRange([THRESHOLD + 1e-9, Infinity])
  const liquidCount = cf.groupAll().reduceCount()
  // avgBid via sum + count reducer; respects no filter (we want avg over the
  // whole source, not the filtered set — to mirror data's avg('bid'))
  const dAll = cf.dimension(() => 1)
  const sumCount = dAll.groupAll().reduce(
    (p, v) => { p.s += v.bid; p.n++; return p },
    (p, v) => { p.s -= v.bid; p.n--; return p },
    () => ({ s: 0, n: 0 }),
  )
  const avgBid = () => {
    const { s, n } = sumCount.value()
    return n ? s / n : 0
  }
  return { cf, dSpread, liquidCount, avgBid, state }
}

function tick(cf, state, t) {
  cf.remove(d => d.id === t.idx)
  state[t.idx] = { ...state[t.idx], [t.field]: t.newValue }
  cf.add([state[t.idx]])
}

export default function bench(): BenchResult {
  const initRows = makeTrades()
  const setup = measure(() => { buildSingle(initRows) })

  const single = (() => {
    const { cf, dSpread, state } = buildSingle(initRows)
    void dSpread.top(TOP_K)
    let i = 0
    return measure(() => {
      tick(cf, state, TICKS[i++ % TICKS.length])
      void dSpread.top(TOP_K)
    })
  })()

  const stream = (() => {
    const { cf, dSpread, state } = buildSingle(initRows)
    void dSpread.top(TOP_K)
    return measure(() => {
      for (let j = 0; j < TICKS.length; j++) {
        tick(cf, state, TICKS[j])
        void dSpread.top(TOP_K)
      }
    })
  })()

  const dashboard = (() => {
    const { cf, dSpread, liquidCount, avgBid, state } = buildDashboard(initRows)
    return measure(() => {
      for (let j = 0; j < TICKS.length; j++) {
        tick(cf, state, TICKS[j])
        void liquidCount.value()
        void dSpread.top(TOP_K)
        void avgBid()
      }
    })
  })()

  return {
    name: 'crossfilter',
    version: pkgVersion('crossfilter2'),
    setup,
    single,
    batch: stream,
    dashboard,
    notes: 'spread dimension + dim.top; dashboard adds groupAll counts/reduce',
  }
}
