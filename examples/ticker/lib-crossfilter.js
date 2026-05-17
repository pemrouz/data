// crossfilter row — the library's native strength is incremental
// per-group reduce after `cf.add(rows)` and `cf.remove()`. Sector volume,
// the pctChg-bin histogram, the running total volume, and the running
// sum-and-count behind avg %change all fit that shape cleanly: a
// dimension + group per derivation, updated O(Δ) on add/remove.
//
// The streaming model fights crossfilter on the rolling-window side:
// there's no "remove oldest tick" primitive — the closest is
// `cf.remove(predicate)` which walks every retained record on every call.
// With a 500k-tick window and a fresh batch every 60ms that's ~8M
// checks/sec just to maintain the window, scaling linearly with WINDOW_N
// regardless of how small the actual delta is. This is the expected-and-
// honest cost of using a static-dimensional library on a stream — the
// comparison page exists to make exactly this kind of asymmetry visible.
//
// Top + bottom movers don't go through crossfilter: a per-tick "latest
// value per symbol" custom reduce can't reconstruct the previous-latest
// on remove (the row we're removing carries no information about who was
// second). We maintain a plain Map<symbol, {price, pctChg}> updated on
// each ingest tick — same pattern every non-data lib uses for the
// LWW-state half of the demo. Per-batch render sorts ~symbolCount entries
// (200) twice (asc + desc), constant per batch.

import crossfilter from 'crossfilter2'
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
function binIdx(pct) {
  if (pct <= HIST_LO) return 0
  if (pct >= HIST_HI) return HIST_BINS - 1
  return Math.floor((pct - HIST_LO) / (HIST_HI - HIST_LO) * HIST_BINS)
}

export default {
  name: 'crossfilter',
  version: '1.5.4',
  tag: 'native dimensions × groups — incremental per derivation',

  mount(row, tracker, opts) {
    const topEl     = row.querySelector('[data-target=top]')
    const bottomEl  = row.querySelector('[data-target=bottom]')
    const sectorEl  = row.querySelector('[data-target=sectors]')
    const histEl    = row.querySelector('[data-target=hist]')
    const scalarsEl = row.querySelector('[data-target=scalars]')

    const cf = crossfilter([])
    // Sector dimension + reduceSum is the canonical crossfilter idiom and
    // updates O(Δ) on add/remove. `.all()` returns [{key, value}, …] in
    // ascending key order.
    const sectorDim   = cf.dimension(d => d.sector)
    const sectorGroup = sectorDim.group().reduceSum(d => d.volume)

    // pctChg-bin dimension + reduceCount → 10-bucket histogram, all
    // incremental.
    const binDim   = cf.dimension(d => binIdx(d.pctChg))
    const binGroup = binDim.group().reduceCount()

    // Scalar aggregates via groupAll — one accumulator over the whole
    // (unfiltered) record set. Total volume is a sum; avg %change needs
    // a custom reduce that tracks sum + count so we can divide on read.
    const totalVolGroup = cf.groupAll().reduceSum(d => d.volume)
    const avgPctGroup = cf.groupAll().reduce(
      (acc, d) => { acc.sum += d.pctChg; acc.n += 1; return acc },
      (acc, d) => { acc.sum -= d.pctChg; acc.n -= 1; return acc },
      () => ({ sum: 0, n: 0 }),
    )

    // Per-symbol latest. Plain map — see header comment.
    const prices = new Map()

    let counter = 0
    const WINDOW = opts.windowSize
    let tagged = null

    const sectorOrder = opts.sectorOrder

    let scheduled = false
    function scheduleRender() {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        const r0 = performance.now()

        const arr = []
        for (const [symbol, info] of prices) arr.push({ symbol, price: info.price, pctChg: info.pctChg })
        arr.sort((a, b) => b.pctChg - a.pctChg)
        renderTopMovers(topEl, arr.slice(0, 3))
        arr.sort((a, b) => a.pctChg - b.pctChg)
        renderBottomMovers(bottomEl, arr.slice(0, 3))

        const totals = {}
        for (const { key, value } of sectorGroup.all()) totals[key] = value
        renderSectors(sectorEl, totals, sectorOrder)

        const bins = new Array(HIST_BINS).fill(0)
        for (const { key, value } of binGroup.all()) bins[key] = value
        renderHistogram(histEl, bins)

        const avg = avgPctGroup.value()
        renderScalars(scalarsEl, totalVolGroup.value(), avg.n ? avg.sum / avg.n : undefined)

        tracker.sampleRender(performance.now() - r0)
      })
    }

    renderTopMovers(topEl, [])
    renderBottomMovers(bottomEl, [])
    renderSectors(sectorEl, {}, sectorOrder)
    renderHistogram(histEl, new Array(HIST_BINS).fill(0))
    renderScalars(scalarsEl, undefined, undefined)

    return {
      ingest(batch) {
        // Tag rows in place. The generator emits a fresh array each batch
        // so it's safe to mutate; if a future change makes the batch
        // immutable we'd have to copy here, paying allocation cost.
        tagged = new Array(batch.length)
        for (let i = 0; i < batch.length; i++) {
          const t = batch[i]
          tagged[i] = { ...t, id: counter++ }
          prices.set(t.symbol, { price: t.price, pctChg: t.pctChg })
        }
        cf.add(tagged)
        // Rolling-window cull. The cutoff is the lowest id we want to
        // *keep*; predicate is "id < cutoff" — those rows leave. Walks
        // every retained record once per call; this is the O(WINDOW) cost
        // the header comment warns about.
        const cutoff = counter - WINDOW
        if (cutoff > 0) cf.remove(d => d.id < cutoff)
        scheduleRender()
      },
    }
  },
}
