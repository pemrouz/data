// crossfilter row — the library's native strength is incremental
// per-group reduce after `cf.add(rows)` and `cf.remove()`. Sector volume
// fits that shape cleanly. The streaming model fights crossfilter on the
// rolling-window side: there's no "remove oldest tick" primitive — the
// closest is `cf.remove(predicate)` which walks every retained record on
// every call. With a 50k-tick window and a fresh batch every 60ms that's
// ~830k checks/sec just to maintain the window, and it scales linearly
// with WINDOW_N regardless of how small the actual delta is. This is the
// expected-and-honest cost of using a static-dimensional library on a
// stream — the comparison page exists to make exactly this kind of
// asymmetry visible.
//
// Top movers don't go through crossfilter: a per-tick "latest value per
// symbol" custom reduce can't reconstruct the previous-latest on remove
// (the row we're removing carries no information about who was second).
// We maintain a plain Map<symbol, {price, pctChg}> updated on each
// ingest tick — same pattern every non-data lib uses for the LWW-state
// half of the demo. Every per-batch render is one Object.values + sort
// over ~symbolCount entries (200), constant per batch.

import crossfilter from 'crossfilter2'
import { renderTopMovers, renderSectors } from './views.js'

export default {
  name: 'crossfilter',
  version: '1.5.4',
  tag: 'native dimension groups — cf.add + cf.remove(pred)',

  mount(row, tracker, opts) {
    const topEl = row.querySelector('[data-target=top]')
    const sectorEl = row.querySelector('[data-target=sectors]')

    const cf = crossfilter([])
    // Sector dimension + reduceSum is the canonical crossfilter idiom and
    // updates O(Δ) on add/remove. `.all()` returns [{key, value}, …] in
    // ascending key order; one walk per render to project into the flat
    // {SECTOR: volume} the renderer wants.
    const sectorDim = cf.dimension(d => d.sector)
    const sectorGroup = sectorDim.group().reduceSum(d => d.volume)

    // Per-symbol latest. Plain map — see header comment for why this
    // isn't a crossfilter group.
    const prices = new Map()

    let counter = 0
    const WINDOW = opts.windowSize
    // Stable monotonic id stamped onto each row (the generator's `time`
    // is monotonic-ish but not strictly increasing across batches; we use
    // our own counter so the window cutoff is unambiguous).
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
        renderTopMovers(topEl, arr)
        const totals = {}
        for (const { key, value } of sectorGroup.all()) totals[key] = value
        renderSectors(sectorEl, totals, sectorOrder)
        tracker.sampleRender(performance.now() - r0)
      })
    }

    renderTopMovers(topEl, [])
    renderSectors(sectorEl, {}, sectorOrder)

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
        // every retained record once per call; this is the O(WINDOW)
        // cost the header comment warns about. Skipping it (only running
        // the cull every K batches) would amortise but also overshoot
        // the documented window size, which would muddy the comparison.
        const cutoff = counter - WINDOW
        if (cutoff > 0) cf.remove(d => d.id < cutoff)
        scheduleRender()
      },
    }
  },
}
