// `data` row — six parallel incremental views over the streaming tape.
// All four source-window aggregates (sector volume, pctChg histogram, total
// volume, avg %change) are O(Δ) per tick via the incremental reduce /
// sum / avg primitives. Peer-lib rows must walk the rolling-window array
// once per render for each derivation; data only threads the per-tick
// delta through each view's add/remove (or O(1) sum/avg update).
//
//   prices  = $({})   — per-symbol LWW state, one row per symbol.
//                       za('pctChg', 3) maintains the top gainers,
//                       az('pctChg', 3) maintains the bottom losers,
//                       both via an internal 200-key sorted index.
//
//   source  = $({})   — fixed-size rolling window keyed by an
//                       ever-incrementing counter. Each ingest writes
//                       source[c] = t and deletes source[c - WINDOW]
//                       once the window fills. All four downstream
//                       aggregates see the same insert/remove deltas.
//
//   sectorTotals = source.reduce(add, remove, () => ({}))
//                     — incremental fold by sector; per-tick cost is
//                       two hashtable bumps.
//
//   histogram    = source.reduce(add, remove, () => Array(10).fill(0))
//                     — pctChg bucketed into 10 bins of width 1%, range
//                       [-5%, +5%]. Each tick increments one bin on add,
//                       decrements one on remove.
//
//   totalVol     = source.sum('volume')   — O(1) running total.
//   avgPct       = source.avg('pctChg')   — O(1) running sum + count.
//
// Every aggregate read goes through a bare 0-arg tap so the cascade fires
// only once per source emit, regardless of the row count touched. Render
// is rAF-coalesced (one frame = one sample). At 100k ticks/s with a 500k
// window, peer rows do ~4 × 500k iters per rAF; data does O(Δ × views)
// per tick — the gap widens with both rate and window size.

import { $, value } from 'data/full'
import {
  renderTopMovers,
  renderBottomMovers,
  renderSectors,
  renderHistogram,
  renderScalars,
} from './views.js'

const HIST_BINS = 10
const HIST_LO = -5
const HIST_HI = 5

// Map pctChg into a bin index. Out-of-range values clamp to the edge bin
// rather than dropping — the demo cares about every tick contributing to
// some bar so peer libs can't accidentally short-circuit.
function binIdx(pct) {
  if (pct <= HIST_LO) return 0
  if (pct >= HIST_HI) return HIST_BINS - 1
  return Math.floor((pct - HIST_LO) / (HIST_HI - HIST_LO) * HIST_BINS)
}

export default {
  name: 'data',
  version: '1.0.0',
  tag: 'incremental — reduce(add, remove) × N + sum/avg + za/az',

  mount(row, tracker, opts) {
    const topEl     = row.querySelector('[data-target=top]')
    const bottomEl  = row.querySelector('[data-target=bottom]')
    const sectorEl  = row.querySelector('[data-target=sectors]')
    const histEl    = row.querySelector('[data-target=hist]')
    const scalarsEl = row.querySelector('[data-target=scalars]')

    const prices = $({})
    const source = $({})

    let counter = 0
    const WINDOW = opts.windowSize

    const sectorTotals = source.reduce(
      (acc, t) => { acc[t.sector] = (acc[t.sector] || 0) + t.volume; return acc },
      (acc, t) => { acc[t.sector] = (acc[t.sector] || 0) - t.volume; return acc },
      () => ({}),
    )

    const histogram = source.reduce(
      (acc, t) => { acc[binIdx(t.pctChg)]++; return acc },
      (acc, t) => { acc[binIdx(t.pctChg)]--; return acc },
      () => new Array(HIST_BINS).fill(0),
    )

    const totalVol = source.sum('volume')
    const avgPct   = source.avg('pctChg')
    const topGain  = prices.za('pctChg', 3)
    const topLose  = prices.az('pctChg', 3)

    // Chain anchors: taps need a strong ref or the WeakRef in the sink
    // graph drops them. Stash on the row so they live as long as it does.
    const chains = row._chains = []

    // One rAF for all six renders: keeps cycle accounting clean for the
    // compute tracker (one render = one sample). Any tap can request the
    // rAF; whichever runs second sees `scheduled === true` and skips.
    let scheduled = false
    const scheduleRender = () => {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        const r0 = performance.now()
        renderTopMovers(topEl, topGain[value] || [])
        renderBottomMovers(bottomEl, topLose[value] || [])
        renderSectors(sectorEl, sectorTotals[value] || {}, opts.sectorOrder)
        renderHistogram(histEl, histogram[value] || new Array(HIST_BINS).fill(0))
        renderScalars(scalarsEl, totalVol[value], avgPct[value])
        tracker.sampleRender(performance.now() - r0)
      })
    }
    chains.push(topGain.tap(scheduleRender))
    chains.push(topLose.tap(scheduleRender))
    chains.push(sectorTotals.tap(scheduleRender))
    chains.push(histogram.tap(scheduleRender))
    chains.push(totalVol.tap(scheduleRender))
    chains.push(avgPct.tap(scheduleRender))

    // Seed empty.
    renderTopMovers(topEl, [])
    renderBottomMovers(bottomEl, [])
    renderSectors(sectorEl, {}, opts.sectorOrder)
    renderHistogram(histEl, new Array(HIST_BINS).fill(0))
    renderScalars(scalarsEl, undefined, undefined)

    return {
      ingest(batch) {
        for (let i = 0; i < batch.length; i++) {
          const t = batch[i]
          prices[t.symbol] = { symbol: t.symbol, price: t.price, pctChg: t.pctChg }
          if (counter >= WINDOW) delete source[counter - WINDOW]
          source[counter++] = t
        }
      },
    }
  },
}
