// mobx row — proxy-based reactivity, no incremental aggregation. Mirrors
// the pattern lib-mobx.js in examples/multidim uses: don't observe every
// row (the 500k window would dwarf the per-batch reactive cost with proxy
// overhead and a realistic mobx codebase wouldn't either), observe a
// version signal and let `computed`s walk plain JS state when invalidated.
//
//   dataVersion = observable.box(0)
//   prices      = plain Map<symbol, {price, pctChg}>     // LWW
//   window      = plain Array<tick>                       // rolling
//
// Each derived view is its own `computed`. That's the natural mobx
// idiom — fusing them into a single computed-returning-a-tuple would
// trade reactivity granularity for a tighter inner loop, and isn't what
// real mobx code looks like. Per rAF, every computed whose deps have
// been invalidated re-walks `window` (or `prices`) once:
//
//   sectorTotals = computed(() => walk(window).groupBy(sector))
//   histogram    = computed(() => walk(window).bin(pctChg))
//   totalVol     = computed(() => walk(window).sum(volume))
//   avgPct       = computed(() => walk(window).sum(pctChg) / count)
//   topMovers    = computed(() => walk(prices).sort.slice(0, 3))
//   bottomMovers = computed(() => walk(prices).sort.slice(0, 3))
//
// Per ingest tick we set prices.set, push to window, splice the front if
// over-cap. After the loop, bump dataVersion in a runInAction so mobx
// fires one invalidation per batch, not one per tick.
//
// Render is rAF-coalesced just like every other row. The computed cost
// itself is O(4 × WINDOW + 2 × symbols log symbols) per frame — this is
// mobx's honest cost on this workload because the library has no
// primitive for "incrementally maintain a per-key sum (or histogram, or
// running sum, or running avg) across a sliding window."
//
// Window maintenance: window.splice(0, overflow) is O(N - overflow) per
// batch. At WINDOW=500k that's a ~499.7k element shift per batch (300-tick
// batch). The compute cost dominates anyway so the shift isn't the
// bottleneck, but it's part of the streaming-vs-static asymmetry.

import { observable, computed, runInAction, configure } from 'mobx'
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

configure({ enforceActions: 'never' })

export default {
  name: 'mobx',
  version: '6.15.3',
  tag: 'observable signal + 4 O(window) walks per frame',

  mount(row, tracker, opts) {
    const topEl     = row.querySelector('[data-target=top]')
    const bottomEl  = row.querySelector('[data-target=bottom]')
    const sectorEl  = row.querySelector('[data-target=sectors]')
    const histEl    = row.querySelector('[data-target=hist]')
    const scalarsEl = row.querySelector('[data-target=scalars]')

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

    const histogram = computed(() => {
      dataVersion.get()
      const bins = new Array(HIST_BINS).fill(0)
      for (let i = 0; i < win.length; i++) bins[binIdx(win[i].pctChg)]++
      return bins
    })

    const totalVol = computed(() => {
      dataVersion.get()
      let s = 0
      for (let i = 0; i < win.length; i++) s += win[i].volume
      return s
    })

    const avgPct = computed(() => {
      dataVersion.get()
      if (!win.length) return undefined
      let s = 0
      for (let i = 0; i < win.length; i++) s += win[i].pctChg
      return s / win.length
    })

    const topMovers = computed(() => {
      dataVersion.get()
      const arr = []
      for (const [symbol, info] of prices) arr.push({ symbol, price: info.price, pctChg: info.pctChg })
      arr.sort((a, b) => b.pctChg - a.pctChg)
      return arr.slice(0, 3)
    })

    const bottomMovers = computed(() => {
      dataVersion.get()
      const arr = []
      for (const [symbol, info] of prices) arr.push({ symbol, price: info.price, pctChg: info.pctChg })
      arr.sort((a, b) => a.pctChg - b.pctChg)
      return arr.slice(0, 3)
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
        renderTopMovers(topEl, topMovers.get())
        renderBottomMovers(bottomEl, bottomMovers.get())
        renderSectors(sectorEl, sectorTotals.get(), sectorOrder)
        renderHistogram(histEl, histogram.get())
        renderScalars(scalarsEl, totalVol.get(), avgPct.get())
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
