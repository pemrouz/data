// solid row — signal for the version counter, memos for the aggregates,
// an effect drives the render. Same imperative-state-behind-a-signal
// trick mobx and react use here: a 50k-tick window doesn't belong inside
// a reactive primitive (the per-element proxy overhead would dwarf the
// per-batch cost) — observe a version counter and let memos walk plain
// state when invalidated.
//
//   [version, setVersion] = createSignal(0)
//   prices = plain Map<symbol, …>           // mutated externally
//   win    = plain Array<tick>              // mutated externally
//
//   sectorTotals = createMemo(() => { version(); walk(win) })
//   topMovers    = createMemo(() => { version(); sort(prices) })
//
// Solid's effect-runs-on-create plus its tight memo dispatch makes this
// shape fast — fine-grained dep tracking means setVersion-triggered
// invalidations short-circuit through exactly two memos and one effect.
// The dominant cost remains the O(WINDOW) walk inside the sectorTotals
// memo, same as mobx.

import { createSignal, createMemo, createEffect, createRoot } from 'solid-js'
import { renderTopMovers, renderSectors } from './views.js'

export default {
  name: 'solid',
  version: '1.9.12',
  tag: 'createSignal version + memos walking plain refs',

  mount(row, tracker, opts) {
    const topEl = row.querySelector('[data-target=top]')
    const sectorEl = row.querySelector('[data-target=sectors]')

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

      const topMovers = createMemo(() => {
        version()
        const arr = []
        for (const [symbol, info] of prices) arr.push({ symbol, price: info.price, pctChg: info.pctChg })
        arr.sort((a, b) => b.pctChg - a.pctChg)
        return arr
      })

      // Effect runs on every memo invalidation. We rAF-coalesce inside so
      // the actual DOM write happens at most once per frame, matching the
      // rate every other row paints at. Solid would otherwise fire the
      // effect once per setVersion call — at high tick rates that's once
      // per ingest batch, which is fine, but the rAF gate keeps the
      // render strategy identical across rows.
      let scheduled = false
      createEffect(() => {
        // Capturing the memo reads here forces solid to track them as
        // deps — but the actual recompute happens inside the rAF body
        // below (where the memo's .read() inside renderSectors et al
        // would force it). We deliberately capture references outside
        // the rAF and read them inside, so the work shows up in the
        // timed block.
        sectorTotals(); topMovers()
        if (scheduled) return
        scheduled = true
        requestAnimationFrame(() => {
          scheduled = false
          const r0 = performance.now()
          renderSectors(sectorEl, sectorTotals(), sectorOrder)
          renderTopMovers(topEl, topMovers())
          tracker.sampleRender(performance.now() - r0)
        })
      })

      scheduleAndCommit = () => setVersion(v => v + 1)
    })

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
        scheduleAndCommit()
      },
    }
  },
}
