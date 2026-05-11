// preact-signals row — same imperative-state-behind-a-signal shape as
// mobx and solid. preact-signals' computeds are pull-based with
// fine-grained dep tracking; we expose a single version signal and let
// the computeds walk plain JS state when read.
//
//   version = signal(0)
//   prices  = plain Map<symbol, …>
//   win     = plain Array<tick>
//
//   sectorTotals = computed(() => { version.value; walk(win) })
//   topMovers    = computed(() => { version.value; sort(prices) })
//
// effect() pulls the computeds; we rAF-gate the actual render call.
// preact-signals doesn't have a built-in "batch this many writes"
// primitive needed here — `batch(() => …)` exists but our writes are
// outside reactive scope anyway, so we just bump version once per
// ingest batch.

import { signal, computed, effect } from '@preact/signals-core'
import { renderTopMovers, renderSectors } from './views.js'

export default {
  name: 'preact-signals',
  version: '1.14.1',
  tag: 'signal version + computed walks plain refs',

  mount(row, tracker, opts) {
    const topEl = row.querySelector('[data-target=top]')
    const sectorEl = row.querySelector('[data-target=sectors]')

    const prices = new Map()
    const win = []
    const WINDOW = opts.windowSize
    const sectorOrder = opts.sectorOrder

    const version = signal(0)

    const sectorTotals = computed(() => {
      version.value
      const out = {}
      for (let i = 0; i < win.length; i++) {
        const t = win[i]
        out[t.sector] = (out[t.sector] || 0) + t.volume
      }
      return out
    })

    const topMovers = computed(() => {
      version.value
      const arr = []
      for (const [symbol, info] of prices) arr.push({ symbol, price: info.price, pctChg: info.pctChg })
      arr.sort((a, b) => b.pctChg - a.pctChg)
      return arr
    })

    let scheduled = false
    const dispose = effect(() => {
      // Subscribe to both computeds via reads (preact-signals tracks
      // signal access inside an effect). Real .value read for the
      // compute work happens inside the rAF body so it's captured by
      // the timed block.
      sectorTotals.value; topMovers.value
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        const r0 = performance.now()
        renderSectors(sectorEl, sectorTotals.value, sectorOrder)
        renderTopMovers(topEl, topMovers.value)
        tracker.sampleRender(performance.now() - r0)
      })
    })
    row._preactDispose = dispose

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
        version.value = version.value + 1
      },
    }
  },
}
