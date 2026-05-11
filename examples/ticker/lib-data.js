// `data` row — fully incremental tick processing.
//
//   prices  = $({})   — per-symbol LWW state. Each tick writes
//                       prices[t.symbol] = {symbol, price, pctChg}.
//                       za('pctChg', 5) maintains the top-5 gainers
//                       view via an internal sorted index; one BU1
//                       cascade per tick, O(log symbols) reposition.
//
//   source  = $({})   — fixed-size rolling window keyed by an
//                       ever-incrementing counter. Each ingest writes
//                       source[c] = t and deletes source[c - WINDOW]
//                       once the window fills. The window's size is
//                       maintained by the ingest, not by an operator,
//                       so all downstream views see exactly the same
//                       insert/remove deltas (1 of each per tick after
//                       the window fills).
//
//   sectorTotals = source.reduce(add, remove, () => ({}))
//                     — incremental fold. The 3-arg reduce form is
//                       *invertible*: add(acc, tick) bumps
//                       acc[sector] by volume; remove(acc, tick)
//                       subtracts. Per-tick cost: 2 hashtable lookups,
//                       no walks. The tempting alternative —
//                       source.group('sector').sum('volume') — would
//                       need a per-group sub-view at each sector key;
//                       the 3-arg reduce gives us the same answer
//                       directly into a flat object the renderer can
//                       consume.
//
// Both top-movers and sector-totals reads are routed through bare-tap
// callbacks (0-arg fn → TapBareValue path); we rAF-coalesce the actual
// DOM write because at high tick rates the cascade fires once per
// `prices[symbol] = …` and we don't want N DOM renders per ingest
// batch. Every peer row does the same rAF gating for the fairest
// comparison — the perf comparison is in the reactive *propagation*
// cost, not the DOM write cost.

import { $, value } from 'data/full'
import { renderTopMovers, renderSectors } from './views.js'

export default {
  name: 'data',
  version: '1.0.0',
  tag: 'incremental — za + reduce(add, remove, init)',

  mount(row, tracker, opts) {
    const topEl = row.querySelector('[data-target=top]')
    const sectorEl = row.querySelector('[data-target=sectors]')

    const prices = $({})
    const source = $({})

    let counter = 0
    const WINDOW = opts.windowSize

    const sectorTotals = source.reduce(
      (acc, t) => { acc[t.sector] = (acc[t.sector] || 0) + t.volume; return acc },
      (acc, t) => { acc[t.sector] = (acc[t.sector] || 0) - t.volume; return acc },
      () => ({})
    )

    const topGainers = prices.za('pctChg', 5)

    // Chain anchors: taps need a strong ref or the WeakRef in the sink
    // graph drops them. Stash on the row so they live as long as it does.
    const chains = row._chains = []

    let topScheduled = false
    const renderTop = () => {
      if (topScheduled) return
      topScheduled = true
      requestAnimationFrame(() => {
        topScheduled = false
        renderTopMovers(topEl, topGainers[value] || [])
        tracker.markUpdate()
      })
    }
    chains.push(topGainers.tap(renderTop))

    let secScheduled = false
    const renderSec = () => {
      if (secScheduled) return
      secScheduled = true
      requestAnimationFrame(() => {
        secScheduled = false
        renderSectors(sectorEl, sectorTotals[value] || {}, opts.sectorOrder)
        tracker.markUpdate()
      })
    }
    chains.push(sectorTotals.tap(renderSec))

    // Seed empty.
    renderTopMovers(topEl, [])
    renderSectors(sectorEl, {}, opts.sectorOrder)

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
