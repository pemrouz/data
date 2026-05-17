// rxjs row — Subject<batch> as the ingress stream. RxJS has no
// fine-grained dependency tracking and no incremental aggregate
// primitive (`scan` accumulates per-emission but it sees every event as
// opaque — it can't know an "insert" undoes a paired "remove" until you
// hand-write that logic), so the realistic shape is:
//
//   batch$        = new Subject()
//   window$       = batch$.pipe(scan((win, b) => [...win.slice(-(N - b.length)), ...b], []))
//   sectorTotals$ = window$.pipe(map(win => walk(win).groupBy(sector)))
//   histogram$    = window$.pipe(map(win => walk(win).bin(pctChg)))
//   totalVol$     = window$.pipe(map(win => walk(win).sum(volume)))
//   avgPct$       = window$.pipe(map(win => walk(win).avg(pctChg)))
//
// Four parallel `map` operators each walk the freshly-allocated window.
// In a realistic codebase you'd probably keep them as separate streams
// so subscribers can react to each independently; fusing them into one
// `map(win => ({...}))` would amortise the walk but lose granularity.
//
// Top + bottom movers are the one place we DON'T go through rxjs: the
// per-symbol LWW map is a plain Map mutated on each ingest emission,
// then sorted on render. Wrapping prices in another scan with immutable
// updates would allocate a fresh Map<200 entries> per batch on top of
// everything else.

import { Subject } from 'rxjs'
import { scan, map } from 'rxjs/operators'
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
  name: 'rxjs',
  version: '7.8.2',
  tag: 'Subject<batch> + scan + 4 map() walks per emission',

  mount(row, tracker, opts) {
    const topEl     = row.querySelector('[data-target=top]')
    const bottomEl  = row.querySelector('[data-target=bottom]')
    const sectorEl  = row.querySelector('[data-target=sectors]')
    const histEl    = row.querySelector('[data-target=hist]')
    const scalarsEl = row.querySelector('[data-target=scalars]')

    const batch$ = new Subject()
    const WINDOW = opts.windowSize
    const sectorOrder = opts.sectorOrder
    const prices = new Map()
    const subs = row._rxSubs = []

    // Rolling window via scan. The slice-and-spread is O(WINDOW) per batch
    // — that's the cost of "snapshot stays immutable so subscribers can
    // safely retain it."
    const window$ = batch$.pipe(
      scan((win, batch) => {
        const keep = win.length + batch.length > WINDOW
          ? win.slice(win.length + batch.length - WINDOW)
          : win
        return keep.length === 0 ? batch.slice() : keep.concat(batch)
      }, [])
    )

    let latestSectorTotals = {}
    let latestHist = new Array(HIST_BINS).fill(0)
    let latestTotalVol = undefined
    let latestAvgPct = undefined

    subs.push(window$.pipe(map(win => {
      const out = {}
      for (let i = 0; i < win.length; i++) {
        const t = win[i]
        out[t.sector] = (out[t.sector] || 0) + t.volume
      }
      return out
    })).subscribe(v => { latestSectorTotals = v }))

    subs.push(window$.pipe(map(win => {
      const bins = new Array(HIST_BINS).fill(0)
      for (let i = 0; i < win.length; i++) bins[binIdx(win[i].pctChg)]++
      return bins
    })).subscribe(v => { latestHist = v }))

    subs.push(window$.pipe(map(win => {
      let s = 0
      for (let i = 0; i < win.length; i++) s += win[i].volume
      return s
    })).subscribe(v => { latestTotalVol = v }))

    subs.push(window$.pipe(map(win => {
      if (!win.length) return undefined
      let s = 0
      for (let i = 0; i < win.length; i++) s += win[i].pctChg
      return s / win.length
    })).subscribe(v => { latestAvgPct = v }))

    let scheduled = false
    function scheduleRender() {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        const r0 = performance.now()
        renderSectors(sectorEl, latestSectorTotals, sectorOrder)
        renderHistogram(histEl, latestHist)
        renderScalars(scalarsEl, latestTotalVol, latestAvgPct)
        const arr = []
        for (const [symbol, info] of prices) arr.push({ symbol, price: info.price, pctChg: info.pctChg })
        arr.sort((a, b) => b.pctChg - a.pctChg)
        renderTopMovers(topEl, arr.slice(0, 3))
        arr.sort((a, b) => a.pctChg - b.pctChg)
        renderBottomMovers(bottomEl, arr.slice(0, 3))
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
        }
        batch$.next(batch)
        scheduleRender()
      },
    }
  },
}
