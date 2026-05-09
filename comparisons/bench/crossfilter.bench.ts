// @ts-nocheck
// crossfilter2 — `spread` dimension with filterRange to drop low spreads;
// `dSpread.top(K)` walks the sorted dimension from the top until it has K
// records (incremental, doesn't rescan the whole index). Mutations remain
// remove(predicate) + add(rows) — crossfilter has no in-place mutation.

import crossfilter from 'crossfilter2'
import { makeTrades, TICKS, THRESHOLD, TOP_K } from './workload.ts'
import { measure, pkgVersion, type BenchResult } from './measure.ts'

function build(initRows) {
  const state = initRows.map(r => ({ ...r }))
  const cf = crossfilter(state)
  const dSpread = cf.dimension(d => d.ask - d.bid)
  dSpread.filterRange([THRESHOLD + 1e-9, Infinity])
  return { cf, dSpread, state }
}

function tick(cf, state, t) {
  cf.remove(d => d.id === t.idx)
  state[t.idx] = { ...state[t.idx], [t.field]: t.newValue }
  cf.add([state[t.idx]])
}

export default function bench(): BenchResult {
  const initRows = makeTrades()
  const setup = measure(() => { build(initRows) })

  const single = (() => {
    const { cf, dSpread, state } = build(initRows)
    void dSpread.top(TOP_K)
    let i = 0
    return measure(() => {
      tick(cf, state, TICKS[i++ % TICKS.length])
      void dSpread.top(TOP_K)
    })
  })()

  const stream = (() => {
    const { cf, dSpread, state } = build(initRows)
    void dSpread.top(TOP_K)
    return measure(() => {
      for (let j = 0; j < TICKS.length; j++) {
        tick(cf, state, TICKS[j])
        void dSpread.top(TOP_K)
      }
    })
  })()

  return {
    name: 'crossfilter',
    version: pkgVersion('crossfilter2'),
    setup,
    single,
    batch: stream,
    notes: 'spread dimension + dim.top(K); remove + add per tick (no in-place)',
  }
}
