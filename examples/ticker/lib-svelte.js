// svelte/store row — writable<number> as the version signal, derived<…>
// for aggregates that walk plain JS state. Same imperative-state-behind
// -a-signal pattern as every other peer here.
//
// Svelte 5's runes ($state / $derived) are component-only and aren't
// available outside .svelte files, so this row uses the runtime
// svelte/store API (writable / derived), which is the streaming-friendly
// surface a real svelte codebase would reach for outside a component.
//
//   version  = writable(0)
//   prices   = plain Map<…>
//   win      = plain Array<tick>
//
//   totals$  = derived(version, () => walk(win))
//   movers$  = derived(version, () => sort(prices))
//
// We subscribe in mount and rAF-coalesce the actual render call so the
// comparison stays on the reactive-propagation axis.

import { writable, derived } from 'svelte/store'
import { renderTopMovers, renderSectors } from './views.js'

export default {
  name: 'svelte/store',
  version: '5.55.5',
  tag: 'writable<version> + derived stores walking plain refs',

  mount(row, tracker, opts) {
    const topEl = row.querySelector('[data-target=top]')
    const sectorEl = row.querySelector('[data-target=sectors]')

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
    const movers$ = derived(version, () => {
      const arr = []
      for (const [symbol, info] of prices) arr.push({ symbol, price: info.price, pctChg: info.pctChg })
      arr.sort((a, b) => b.pctChg - a.pctChg)
      return arr
    })

    let latestTotals = {}
    let latestMovers = []
    let scheduled = false
    function scheduleRender() {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        renderSectors(sectorEl, latestTotals, sectorOrder)
        renderTopMovers(topEl, latestMovers)
        tracker.markUpdate()
      })
    }

    const unsubs = []
    unsubs.push(totals$.subscribe(v => { latestTotals = v; scheduleRender() }))
    unsubs.push(movers$.subscribe(v => { latestMovers = v; scheduleRender() }))
    row._svelteUnsubs = unsubs

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
        version.update(v => v + 1)
      },
    }
  },
}
