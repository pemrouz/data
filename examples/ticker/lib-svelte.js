// svelte/store row — writable<number> as the version signal, derived<…>
// for aggregates that walk plain JS state. Same imperative-state-behind
// -a-signal pattern as every other peer here.
//
// Svelte 5's runes ($state / $derived) are component-only and aren't
// available outside .svelte files, so this row uses the runtime
// svelte/store API (writable / derived), which is the streaming-friendly
// surface a real svelte codebase would reach for outside a component.
//
//   version       = writable(0)
//   prices        = plain Map<…>
//   win           = plain Array<tick>
//
//   sectorTotals$ = derived(version, () => walk(win))
//   histogram$    = derived(version, () => walk(win))
//   totalVol$     = derived(version, () => walk(win))
//   avgPct$       = derived(version, () => walk(win))
//   topMovers$    = derived(version, () => sort(prices))
//   bottomMovers$ = derived(version, () => sort(prices))
//
// We subscribe in mount and rAF-coalesce the actual render call so the
// comparison stays on the reactive-propagation axis. svelte/store fires
// derived callbacks eagerly during the subscriber notification path —
// which runs inside the `version.update(...)` call from ingest. That
// means the O(WINDOW) walks happen *inside* the ingest call's
// wall-clock, and main.js's sampleIngest already captures them. The rAF
// render below is just the DOM write.

import { writable, derived } from 'svelte/store'
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
  name: 'svelte/store',
  version: '5.55.5',
  tag: 'writable<version> + 4 derived stores walking the window',

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

    const version = writable(0)

    const totals$ = derived(version, () => {
      const out = {}
      for (let i = 0; i < win.length; i++) {
        const t = win[i]
        out[t.sector] = (out[t.sector] || 0) + t.volume
      }
      return out
    })
    const hist$ = derived(version, () => {
      const bins = new Array(HIST_BINS).fill(0)
      for (let i = 0; i < win.length; i++) bins[binIdx(win[i].pctChg)]++
      return bins
    })
    const totVol$ = derived(version, () => {
      let s = 0
      for (let i = 0; i < win.length; i++) s += win[i].volume
      return s
    })
    const avgPct$ = derived(version, () => {
      if (!win.length) return undefined
      let s = 0
      for (let i = 0; i < win.length; i++) s += win[i].pctChg
      return s / win.length
    })
    const top$ = derived(version, () => {
      const arr = []
      for (const [symbol, info] of prices) arr.push({ symbol, price: info.price, pctChg: info.pctChg })
      arr.sort((a, b) => b.pctChg - a.pctChg)
      return arr.slice(0, 3)
    })
    const bot$ = derived(version, () => {
      const arr = []
      for (const [symbol, info] of prices) arr.push({ symbol, price: info.price, pctChg: info.pctChg })
      arr.sort((a, b) => a.pctChg - b.pctChg)
      return arr.slice(0, 3)
    })

    let latestTotals = {}
    let latestHist = new Array(HIST_BINS).fill(0)
    let latestTotVol = undefined
    let latestAvgPct = undefined
    let latestTop = []
    let latestBot = []

    let scheduled = false
    function scheduleRender() {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        const r0 = performance.now()
        renderSectors(sectorEl, latestTotals, sectorOrder)
        renderHistogram(histEl, latestHist)
        renderScalars(scalarsEl, latestTotVol, latestAvgPct)
        renderTopMovers(topEl, latestTop)
        renderBottomMovers(bottomEl, latestBot)
        tracker.sampleRender(performance.now() - r0)
      })
    }

    const unsubs = []
    unsubs.push(totals$.subscribe(v => { latestTotals = v; scheduleRender() }))
    unsubs.push(hist$.subscribe(v => { latestHist = v; scheduleRender() }))
    unsubs.push(totVol$.subscribe(v => { latestTotVol = v; scheduleRender() }))
    unsubs.push(avgPct$.subscribe(v => { latestAvgPct = v; scheduleRender() }))
    unsubs.push(top$.subscribe(v => { latestTop = v; scheduleRender() }))
    unsubs.push(bot$.subscribe(v => { latestBot = v; scheduleRender() }))
    row._svelteUnsubs = unsubs

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
        version.update(v => v + 1)
      },
    }
  },
}
