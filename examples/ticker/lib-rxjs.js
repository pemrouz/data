// rxjs row — Subject<batch> as the ingress stream. RxJS has no
// fine-grained dependency tracking and no incremental aggregate
// primitive (`scan` accumulates per-emission but it sees every event as
// opaque — it can't know an "insert" undoes a paired "remove" until you
// hand-write that logic), so the realistic shape is:
//
//   batch$ = new Subject()
//   window$ = batch$.pipe(scan((win, b) => [...win.slice(-(N - b.length)), ...b], []))
//   sectorTotals$ = window$.pipe(map(win => walk(win)))
//
// The `scan` reducer allocates a fresh window array per batch — that's
// idiomatic RxJS (state should be immutable so subscribers see consistent
// snapshots) and it's O(WINDOW) per batch. A purely-mutating
// scan-with-shared-array could be cheaper but it'd be unfair: it
// violates the contract RxJS users would expect, and the immutable
// shape is what most rxjs codebases would actually write.
//
// Top movers is the one place we DON'T go through rxjs: the per-symbol
// LWW map is a plain Map mutated on each ingest emission, then sorted on
// render. Wrapping prices in another scan with immutable updates would
// allocate a fresh Map<200 entries> per batch on top of everything else
// — every non-data peer here uses the same mutable-map pattern for this
// half of the demo.

import { Subject } from 'rxjs'
import { scan } from 'rxjs/operators'
import { renderTopMovers, renderSectors } from './views.js'

export default {
  name: 'rxjs',
  version: '7.8.2',
  tag: 'Subject<batch> + scan; immutable window per emission',

  mount(row, tracker, opts) {
    const topEl = row.querySelector('[data-target=top]')
    const sectorEl = row.querySelector('[data-target=sectors]')

    const batch$ = new Subject()
    const WINDOW = opts.windowSize
    const sectorOrder = opts.sectorOrder
    const prices = new Map()
    const subs = row._rxSubs = []

    // Rolling window via scan. The slice-and-spread is O(WINDOW) per batch
    // — that's the cost of "snapshot stays immutable so subscribers can
    // safely retain it". Mutating the previous accumulator in place would
    // make every downstream pipe step see a moving target.
    let latestWindow = []
    subs.push(batch$.pipe(
      scan((win, batch) => {
        const keep = win.length + batch.length > WINDOW
          ? win.slice(win.length + batch.length - WINDOW)
          : win
        return keep.length === 0 ? batch.slice() : keep.concat(batch)
      }, [])
    ).subscribe(win => { latestWindow = win }))

    let scheduled = false
    function scheduleRender() {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        const r0 = performance.now()
        const totals = {}
        for (let i = 0; i < latestWindow.length; i++) {
          const t = latestWindow[i]
          totals[t.sector] = (totals[t.sector] || 0) + t.volume
        }
        renderSectors(sectorEl, totals, sectorOrder)
        const arr = []
        for (const [symbol, info] of prices) arr.push({ symbol, price: info.price, pctChg: info.pctChg })
        arr.sort((a, b) => b.pctChg - a.pctChg)
        renderTopMovers(topEl, arr)
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
        }
        batch$.next(batch)
        scheduleRender()
      },
    }
  },
}
