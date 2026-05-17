// solid row. createSignal for the version counter, createMemo per
// derivation, createEffect to keep them subscribed. createRoot to give
// the reactive graph an explicit owner so it isn't auto-disposed
// when the calling context exits.

import { createSignal, createMemo, createEffect, createRoot } from 'solid-js'
import { N, THRESHOLD, PRICE_BINS, priceBucket } from './gen.js'
import { renderOrderbook, setupOrderbook, setupWaveform, fmtCpu } from './views.js'

export default {
  name: 'solid',
  version: '1.9.12',
  tag: 'createSignal<version> + 4 memos · O(N) per get',

  mount(card, opts) {
    const obEl   = card.querySelector('[data-target=ob]')
    const waveEl = card.querySelector('[data-target=wave]')
    const liqEl  = card.querySelector('[data-target=liquid]')
    const avgEl  = card.querySelector('[data-target=avg]')
    const peakEl = card.querySelector('[data-target=peak]')
    const cpuEl  = card.querySelector('.card-cpu')

    const trades = structuredClone(opts.initial)

    let setVersionRef
    let liquidCountRef, avgBidRef, bidsRef, asksRef

    createRoot(() => {
      const [version, setVersion] = createSignal(0)
      setVersionRef = setVersion

      const liquidCount = createMemo(() => {
        version()
        let n = 0
        for (let i = 0; i < N; i++) { const t = trades[i]; if (t.ask - t.bid > THRESHOLD) n++ }
        return n
      })
      const avgBid = createMemo(() => {
        version()
        let s = 0
        for (let i = 0; i < N; i++) s += trades[i].bid
        return s / N
      })
      const bids = createMemo(() => {
        version()
        const out = new Array(PRICE_BINS).fill(0)
        for (let i = 0; i < N; i++) out[priceBucket(trades[i].bid)]++
        return out
      })
      const asks = createMemo(() => {
        version()
        const out = new Array(PRICE_BINS).fill(0)
        for (let i = 0; i < N; i++) out[priceBucket(trades[i].ask)]++
        return out
      })

      liquidCountRef = liquidCount
      avgBidRef     = avgBid
      bidsRef       = bids
      asksRef       = asks

      const ob = setupOrderbook(obEl)
      const wave = setupWaveform(waveEl, 'accent', peakEl)
      card._solidWave = wave
      card._solidCpuEl = cpuEl
      card._solidLiqEl = liqEl
      card._solidAvgEl = avgEl
      card._solidOb = ob

      let scheduled = false
      createEffect(() => {
        liquidCount(); avgBid(); bids(); asks()
        if (scheduled) return
        scheduled = true
        requestAnimationFrame(() => {
          scheduled = false
          renderOrderbook(ob, bids(), asks())
          liqEl.textContent = String(liquidCount())
          avgEl.textContent = avgBid().toFixed(2)
        })
      })
    })

    return {
      ingest(tick) {
        const cur = trades[tick.idx]
        trades[tick.idx] = { ...cur, [tick.field]: tick.newValue }
        setVersionRef(v => v + 1)
      },
      read() { void liquidCountRef(); void avgBidRef(); void bidsRef(); void asksRef() },
      pushSample(ms) {
        card._solidWave.push(ms)
        card._solidCpuEl.textContent = fmtCpu(card._solidWave.latest)
      },
      wave: card._solidWave,
    }
  },
}
