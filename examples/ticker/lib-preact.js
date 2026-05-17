// preact-signals row — same imperative-state-behind-a-signal shape as
// mobx and solid. preact-signals' computeds are pull-based with
// fine-grained dep tracking; we expose a single version signal and let
// the computeds walk plain JS state when read.
//
//   version      = signal(0)
//   prices       = plain Map<symbol, …>
//   win          = plain Array<tick>
//   sectorTotals = computed(() => walk(win))
//   histogram    = computed(() => walk(win))
//   totalVol     = computed(() => walk(win))
//   avgPct       = computed(() => walk(win))
//   topMovers    = computed(() => sort(prices))
//   bottomMovers = computed(() => sort(prices))
//
// effect() pulls the computeds; we rAF-gate the actual render call.

import { signal, computed, effect } from '@preact/signals-core'
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
  name: 'preact-signals',
  version: '1.14.1',
  tag: 'signal version + 4 O(window) computed walks per render',

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

    const histogram = computed(() => {
      version.value
      const bins = new Array(HIST_BINS).fill(0)
      for (let i = 0; i < win.length; i++) bins[binIdx(win[i].pctChg)]++
      return bins
    })

    const totalVol = computed(() => {
      version.value
      let s = 0
      for (let i = 0; i < win.length; i++) s += win[i].volume
      return s
    })

    const avgPct = computed(() => {
      version.value
      if (!win.length) return undefined
      let s = 0
      for (let i = 0; i < win.length; i++) s += win[i].pctChg
      return s / win.length
    })

    const topMovers = computed(() => {
      version.value
      const arr = []
      for (const [symbol, info] of prices) arr.push({ symbol, price: info.price, pctChg: info.pctChg })
      arr.sort((a, b) => b.pctChg - a.pctChg)
      return arr.slice(0, 3)
    })

    const bottomMovers = computed(() => {
      version.value
      const arr = []
      for (const [symbol, info] of prices) arr.push({ symbol, price: info.price, pctChg: info.pctChg })
      arr.sort((a, b) => a.pctChg - b.pctChg)
      return arr.slice(0, 3)
    })

    let scheduled = false
    const dispose = effect(() => {
      sectorTotals.value; histogram.value; totalVol.value; avgPct.value
      topMovers.value; bottomMovers.value
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        const r0 = performance.now()
        renderSectors(sectorEl, sectorTotals.value, sectorOrder)
        renderHistogram(histEl, histogram.value)
        renderScalars(scalarsEl, totalVol.value, avgPct.value)
        renderTopMovers(topEl, topMovers.value)
        renderBottomMovers(bottomEl, bottomMovers.value)
        tracker.sampleRender(performance.now() - r0)
      })
    })
    row._preactDispose = dispose

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
        version.value = version.value + 1
      },
    }
  },
}
