// vue-reactivity row. Same shape as preact-signals: `ref<version>` +
// `computed` per derivation + `effect` to keep them live, render
// rAF-coalesced.

import { ref, computed, effect } from '@vue/reactivity'
import { N, THRESHOLD, PRICE_BINS, priceBucket } from './gen.js'
import { renderOrderbook, setupOrderbook, setupWaveform, fmtCpu } from './views.js'

export default {
  name: 'vue-reactivity',
  version: '3.5.34',
  tag: 'ref<version> + 4 computed walks · O(N) per get',

  mount(card, opts) {
    const obEl   = card.querySelector('[data-target=ob]')
    const waveEl = card.querySelector('[data-target=wave]')
    const liqEl  = card.querySelector('[data-target=liquid]')
    const avgEl  = card.querySelector('[data-target=avg]')
    const peakEl = card.querySelector('[data-target=peak]')
    const cpuEl  = card.querySelector('.card-cpu')

    const trades = structuredClone(opts.initial)
    const version = ref(0)
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
    const runner = effect(() => {
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
    card._vueRunner = runner

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
