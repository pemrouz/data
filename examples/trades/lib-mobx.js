// mobx row. Same four derivations as data, but built from `computed`
// observables that re-walk the full 10k window on every get. dataVersion
// is an observable.box that ticks bump after each row replace —
// `dataVersion.get()` is the dependency that invalidates every computed
// when state changes.
//
// Whole-row replace (matches data's BU1 path) for apples-to-apples per-tick
// work. Mutating in place would let mobx pay less; the replace keeps the
// comparison honest. Same shape (plain Array<number>) returned from each
// computed so renderOrderbook handles all libs identically.

import { observable, computed, runInAction, configure } from 'mobx'
import { N, THRESHOLD, PRICE_BINS, priceBucket, makeInitial } from './gen.js'
import { renderOrderbook, setupOrderbook, setupWaveform, fmtCpu } from './views.js'

configure({ enforceActions: 'never' })

export default {
  name: 'mobx',
  version: '6.15.3',
  tag: 'observable.box<version> + 4 computeds · each walks 10k per get',

  mount(card, opts) {
    const obEl   = card.querySelector('[data-target=ob]')
    const waveEl = card.querySelector('[data-target=wave]')
    const liqEl  = card.querySelector('[data-target=liquid]')
    const avgEl  = card.querySelector('[data-target=avg]')
    const peakEl = card.querySelector('[data-target=peak]')
    const cpuEl  = card.querySelector('.card-cpu')

    const trades = structuredClone(opts.initial)
    const dataVersion = observable.box(0)
    const liquidCount = computed(() => {
      dataVersion.get()
      let n = 0
      for (let i = 0; i < N; i++) { const t = trades[i]; if (t.ask - t.bid > THRESHOLD) n++ }
      return n
    })
    const avgBid = computed(() => {
      dataVersion.get()
      let s = 0
      for (let i = 0; i < N; i++) s += trades[i].bid
      return s / N
    })
    const bids = computed(() => {
      dataVersion.get()
      const out = new Array(PRICE_BINS).fill(0)
      for (let i = 0; i < N; i++) out[priceBucket(trades[i].bid)]++
      return out
    })
    const asks = computed(() => {
      dataVersion.get()
      const out = new Array(PRICE_BINS).fill(0)
      for (let i = 0; i < N; i++) out[priceBucket(trades[i].ask)]++
      return out
    })

    const ob = setupOrderbook(obEl)
    const wave = setupWaveform(waveEl, 'accent', peakEl)

    let scheduled = false
    function scheduleRender() {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        renderOrderbook(ob, bids.get(), asks.get())
        liqEl.textContent = String(liquidCount.get())
        avgEl.textContent = avgBid.get().toFixed(2)
      })
    }

    return {
      ingest(tick) {
        trades[tick.idx] = { ...trades[tick.idx], [tick.field]: tick.newValue }
        runInAction(() => dataVersion.set(dataVersion.get() + 1))
        scheduleRender()
      },
      read() {
        void liquidCount.get(); void avgBid.get()
        void bids.get(); void asks.get()
      },
      pushSample(ms) { wave.push(ms); cpuEl.textContent = fmtCpu(wave.latest) },
      wave,
    }
  },
}
