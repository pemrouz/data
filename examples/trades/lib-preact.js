// preact-signals row. Same four derivations as mobx, expressed as
// pull-based `computed` over a plain trades array + `signal<version>`.
// `effect()` pulls the computeds to keep them subscribed; render is
// rAF-coalesced so the comparison is the cost of the reactive walks,
// not the cost of writing to the DOM.

import { signal, computed, effect } from '@preact/signals-core'
import { N, THRESHOLD, PRICE_BINS, priceBucket } from './gen.js'
import { renderOrderbook, setupOrderbook, setupWaveform, fmtCpu } from './views.js'

export default {
  name: 'preact-signals',
  version: '1.14.1',
  tag: 'signal<version> + 4 computed walks · O(N) per get',

  mount(card, opts) {
    const obEl   = card.querySelector('[data-target=ob]')
    const waveEl = card.querySelector('[data-target=wave]')
    const liqEl  = card.querySelector('[data-target=liquid]')
    const avgEl  = card.querySelector('[data-target=avg]')
    const peakEl = card.querySelector('[data-target=peak]')
    const cpuEl  = card.querySelector('.card-cpu')

    const trades = structuredClone(opts.initial)
    const version = signal(0)
    const liquidCount = computed(() => {
      version.value
      let n = 0
      for (let i = 0; i < N; i++) { const t = trades[i]; if (t.ask - t.bid > THRESHOLD) n++ }
      return n
    })
    const avgBid = computed(() => {
      version.value
      let s = 0
      for (let i = 0; i < N; i++) s += trades[i].bid
      return s / N
    })
    const bids = computed(() => {
      version.value
      const out = new Array(PRICE_BINS).fill(0)
      for (let i = 0; i < N; i++) out[priceBucket(trades[i].bid)]++
      return out
    })
    const asks = computed(() => {
      version.value
      const out = new Array(PRICE_BINS).fill(0)
      for (let i = 0; i < N; i++) out[priceBucket(trades[i].ask)]++
      return out
    })

    const ob = setupOrderbook(obEl)
    const wave = setupWaveform(waveEl, 'accent', peakEl)

    let scheduled = false
    const dispose = effect(() => {
      // Subscribe to all four — pulls happen inside the rAF body so the
      // reads land in the timed window. Reads of computeds outside the
      // effect's tracking context don't trigger recompute on the same
      // version, but here the effect re-runs whenever any of them does.
      liquidCount.value; avgBid.value; bids.value; asks.value
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        renderOrderbook(ob, bids.value, asks.value)
        liqEl.textContent = String(liquidCount.value)
        avgEl.textContent = avgBid.value.toFixed(2)
      })
    })
    card._preactDispose = dispose

    return {
      ingest(tick) {
        const cur = trades[tick.idx]
        trades[tick.idx] = { ...cur, [tick.field]: tick.newValue }
        version.value = version.value + 1
      },
      read() { void liquidCount.value; void avgBid.value; void bids.value; void asks.value },
      pushSample(ms) { wave.push(ms); cpuEl.textContent = fmtCpu(wave.latest) },
      wave,
    }
  },
}
