// @vue/reactivity row — same shape as preact-signals / solid / mobx.
// `ref(0)` plays the version-signal role; `computed(() => …)` walks
// plain refs when the version changes; `effect(() => …)` pulls the
// computeds and triggers rAF-coalesced render.
//
//   version = ref(0)
//   prices  = plain Map<…>
//   win     = plain Array<tick>
//   sectorTotals = computed(() => { version.value; walk(win) })
//   topMovers    = computed(() => { version.value; sort(prices) })
//
// Per-batch we bump version once after mutating the plain refs. vue's
// reactivity batches the schedulers but we still gate the actual DOM
// write inside the effect on a rAF flag for parity with every other
// row.

import { ref, computed, effect } from '@vue/reactivity'
import { renderTopMovers, renderSectors } from './views.js'

export default {
  name: 'vue-reactivity',
  version: '3.5.34',
  tag: 'ref<version> + computed walks plain refs',

  mount(row, tracker, opts) {
    const topEl = row.querySelector('[data-target=top]')
    const sectorEl = row.querySelector('[data-target=sectors]')

    const prices = new Map()
    const win = []
    const WINDOW = opts.windowSize
    const sectorOrder = opts.sectorOrder

    const version = ref(0)

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
    const runner = effect(() => {
      // Read computeds inside the effect to subscribe; real recompute
      // work happens in the timed rAF body below.
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
    row._vueRunner = runner

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
