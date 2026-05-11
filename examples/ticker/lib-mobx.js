// mobx row — proxy-based reactivity, no incremental aggregation. Mirrors
// the pattern lib-mobx.js in examples/multidim uses: don't observe every
// row (the 50k window would dwarf the per-batch reactive cost with proxy
// overhead and a realistic mobx codebase wouldn't either), observe a
// version signal and let `computed`s walk plain JS state when invalidated.
//
//   dataVersion = observable.box(0)
//   prices      = plain Map<symbol, {price, pctChg}>     // LWW
//   window      = plain Array<tick>                       // rolling
//
//   sectorTotals = computed(() => { dataVersion.get(); walk(window) })
//   topMovers    = computed(() => { dataVersion.get(); walk(prices)+sort })
//
// Per ingest tick we set prices.set, push to window, splice the front if
// over-cap. After the loop, bump dataVersion in a runInAction so mobx
// fires one invalidation per batch, not one per tick.
//
// Render is rAF-coalesced just like every other row. The computed cost
// itself is O(WINDOW + symbols log symbols) per frame — this is mobx's
// honest cost on this workload because the library has no primitive for
// "incrementally maintain a per-key sum across a sliding window".
//
// Window maintenance: window.splice(0, overflow) is O(N - overflow) per
// batch. At WINDOW=50k that's a ~49.7k element shift per batch (300-tick
// batch). The compute cost dominates anyway so the shift isn't the
// bottleneck, but it's part of the streaming-vs-static asymmetry.

import { observable, computed, runInAction, configure } from 'mobx'
import { renderTopMovers, renderSectors } from './views.js'

configure({ enforceActions: 'never' })

export default {
  name: 'mobx',
  version: '6.15.3',
  tag: 'observable signal + O(window) computed walks per frame',

  mount(row, tracker, opts) {
    const topEl = row.querySelector('[data-target=top]')
    const sectorEl = row.querySelector('[data-target=sectors]')

    const dataVersion = observable.box(0)
    const prices = new Map()
    const win = []
    const WINDOW = opts.windowSize
    const sectorOrder = opts.sectorOrder

    const sectorTotals = computed(() => {
      dataVersion.get()
      const out = {}
      for (let i = 0; i < win.length; i++) {
        const t = win[i]
        out[t.sector] = (out[t.sector] || 0) + t.volume
      }
      return out
    })

    const topMovers = computed(() => {
      dataVersion.get()
      const arr = []
      for (const [symbol, info] of prices) arr.push({ symbol, price: info.price, pctChg: info.pctChg })
      arr.sort((a, b) => b.pctChg - a.pctChg)
      return arr
    })

    let scheduled = false
    function scheduleRender() {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        const r0 = performance.now()
        // .get() forces the mobx computed to recompute if its deps
        // invalidated since the last read — that's the bulk of the
        // work this lib does per cycle, and it MUST be inside the
        // timed block to be counted.
        renderSectors(sectorEl, sectorTotals.get(), sectorOrder)
        renderTopMovers(topEl, topMovers.get())
        tracker.sampleRender(performance.now() - r0)
      })
    }

    renderTopMovers(topEl, [])
    renderSectors(sectorEl, {}, sectorOrder)

    return {
      ingest(batch) {
        for (let i = 0; i < batch.length; i++) {
          const t = batch[i]
          prices.set(t.symbol, { price: t.price, pctChg: t.pctChg })
          win.push(t)
        }
        if (win.length > WINDOW) win.splice(0, win.length - WINDOW)
        runInAction(() => dataVersion.set(dataVersion.get() + 1))
        scheduleRender()
      },
    }
  },
}
