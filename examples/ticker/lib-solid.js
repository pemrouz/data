// solid row — signal for the version counter, memos for the aggregates,
// an effect drives the render. Same imperative-state-behind-a-signal
// trick mobx and react use here: a 500k-tick window doesn't belong inside
// a reactive primitive (the per-element proxy overhead would dwarf the
// per-batch cost) — observe a version counter and let memos walk plain
// state when invalidated.
//
//   [version, setVersion] = createSignal(0)
//   prices = plain Map<symbol, …>           // mutated externally
//   win    = plain Array<tick>              // mutated externally
//
//   sectorTotals = createMemo(() => walk(win))
//   histogram    = createMemo(() => walk(win))
//   totalVol     = createMemo(() => walk(win))
//   avgPct       = createMemo(() => walk(win))
//   topMovers    = createMemo(() => sort(prices))
//   bottomMovers = createMemo(() => sort(prices))
//
// Solid's effect-runs-on-create plus its tight memo dispatch makes this
// shape fast — fine-grained dep tracking means setVersion-triggered
// invalidations short-circuit through the memos and one effect. The
// dominant cost remains the four O(WINDOW) walks inside the window-derived
// memos, same as mobx.

import { createSignal, createMemo, createEffect, createRoot } from 'solid-js'
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
  name: 'solid',
  version: '1.9.12',
  tag: 'createSignal version + 4 memos walking the window',

  mount(row, tracker, opts) {
    const topEl     = row.querySelector('[data-target=top]')
    const bottomEl  = row.querySelector('[data-target=bottom]')
    const sectorEl  = row.querySelector('[data-target=sectors]')
    const histEl    = row.querySelector('[data-target=hist]')
    const scalarsEl = row.querySelector('[data-target=scalars]')

    const prices = new Map()
    const win = []
    const WINDOW = opts.windowSize
    const sectorOrder = opts.sectorOrder

    let scheduleAndCommit
    createRoot(() => {
      const [version, setVersion] = createSignal(0)

      const sectorTotals = createMemo(() => {
        version()
        const out = {}
        for (let i = 0; i < win.length; i++) {
          const t = win[i]
          out[t.sector] = (out[t.sector] || 0) + t.volume
        }
        return out
      })

      const histogram = createMemo(() => {
        version()
        const bins = new Array(HIST_BINS).fill(0)
        for (let i = 0; i < win.length; i++) bins[binIdx(win[i].pctChg)]++
        return bins
      })

      const totalVol = createMemo(() => {
        version()
        let s = 0
        for (let i = 0; i < win.length; i++) s += win[i].volume
        return s
      })

      const avgPct = createMemo(() => {
        version()
        if (!win.length) return undefined
        let s = 0
        for (let i = 0; i < win.length; i++) s += win[i].pctChg
        return s / win.length
      })

      const topMovers = createMemo(() => {
        version()
        const arr = []
        for (const [symbol, info] of prices) arr.push({ symbol, price: info.price, pctChg: info.pctChg })
        arr.sort((a, b) => b.pctChg - a.pctChg)
        return arr.slice(0, 3)
      })

      const bottomMovers = createMemo(() => {
        version()
        const arr = []
        for (const [symbol, info] of prices) arr.push({ symbol, price: info.price, pctChg: info.pctChg })
        arr.sort((a, b) => a.pctChg - b.pctChg)
        return arr.slice(0, 3)
      })

      let scheduled = false
      createEffect(() => {
        // Capture memo reads here for dep tracking; actual recompute
        // happens inside the rAF body so the work shows up in the timed
        // block (the same idiom multidim uses).
        sectorTotals(); histogram(); totalVol(); avgPct(); topMovers(); bottomMovers()
        if (scheduled) return
        scheduled = true
        requestAnimationFrame(() => {
          scheduled = false
          const r0 = performance.now()
          renderSectors(sectorEl, sectorTotals(), sectorOrder)
          renderHistogram(histEl, histogram())
          renderScalars(scalarsEl, totalVol(), avgPct())
          renderTopMovers(topEl, topMovers())
          renderBottomMovers(bottomEl, bottomMovers())
          tracker.sampleRender(performance.now() - r0)
        })
      })

      scheduleAndCommit = () => setVersion(v => v + 1)
    })

    renderTopMovers(topEl, [])
    renderBottomMovers(bottomEl, [])
    renderSectors(sectorEl, {}, sectorOrder)
    renderHistogram(histEl, new Array(HIST_BINS).fill(0))
    renderScalars(scalarsEl, undefined, undefined)

    return {
      ingest(batch) {
        for (let i = 0; i < batch.length; i++) {
          const t = batch[i]
          prices.set(t.symbol, { price: t.price, pctChg: t.pctChg })
          win.push(t)
        }
        if (win.length > WINDOW) win.splice(0, win.length - WINDOW)
        scheduleAndCommit()
      },
    }
  },
}
