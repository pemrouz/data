// svelte/store row. Svelte 5's runes ($state / $derived) are component-
// only and aren't available outside .svelte files, so this row uses the
// runtime svelte/store API (writable / derived), which is the
// streaming-friendly surface a real svelte codebase would reach for
// outside a component context.
//
//   version$       = writable(0)
//   liquidCount$   = derived(version, walk(trades))
//   avgBid$        = derived(version, walk(trades))
//   bids$          = derived(version, walk(trades))
//   asks$          = derived(version, walk(trades))
//
// svelte/store fires derived callbacks eagerly during the subscriber
// notification path — which runs inside the `version.update(...)` call
// from ingest. So O(N) walks happen *inside* the ingest call's wall-
// clock, captured by the per-frame timing. rAF render just commits the
// latest snapshots into the DOM.

import { writable, derived } from 'svelte/store'
import { N, THRESHOLD, PRICE_BINS, priceBucket } from './gen.js'
import { renderOrderbook, setupOrderbook, setupWaveform, fmtCpu } from './views.js'

export default {
  name: 'svelte/store',
  version: '5.55.5',
  tag: 'writable<version> + 4 derived stores · O(N) per fire',

  mount(card, opts) {
    const obEl   = card.querySelector('[data-target=ob]')
    const waveEl = card.querySelector('[data-target=wave]')
    const liqEl  = card.querySelector('[data-target=liquid]')
    const avgEl  = card.querySelector('[data-target=avg]')
    const peakEl = card.querySelector('[data-target=peak]')
    const cpuEl  = card.querySelector('.card-cpu')

    const trades = structuredClone(opts.initial)
    const version = writable(0)

    const liquidCount$ = derived(version, () => {
      let n = 0
      for (let i = 0; i < N; i++) { const t = trades[i]; if (t.ask - t.bid > THRESHOLD) n++ }
      return n
    })
    const avgBid$ = derived(version, () => {
      let s = 0
      for (let i = 0; i < N; i++) s += trades[i].bid
      return s / N
    })
    const bids$ = derived(version, () => {
      const out = new Array(PRICE_BINS).fill(0)
      for (let i = 0; i < N; i++) out[priceBucket(trades[i].bid)]++
      return out
    })
    const asks$ = derived(version, () => {
      const out = new Array(PRICE_BINS).fill(0)
      for (let i = 0; i < N; i++) out[priceBucket(trades[i].ask)]++
      return out
    })

    let latestLiq = 0
    let latestAvg = 0
    let latestBids = new Array(PRICE_BINS).fill(0)
    let latestAsks = new Array(PRICE_BINS).fill(0)
    const unsubs = []
    unsubs.push(liquidCount$.subscribe(v => { latestLiq = v }))
    unsubs.push(avgBid$.subscribe(v => { latestAvg = v }))
    unsubs.push(bids$.subscribe(v => { latestBids = v }))
    unsubs.push(asks$.subscribe(v => { latestAsks = v }))
    card._svelteUnsubs = unsubs

    const ob = setupOrderbook(obEl)
    const wave = setupWaveform(waveEl, 'accent', peakEl)

    let scheduled = false
    function scheduleRender() {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        renderOrderbook(ob, latestBids, latestAsks)
        liqEl.textContent = String(latestLiq)
        avgEl.textContent = (latestAvg ?? 0).toFixed(2)
      })
    }

    return {
      ingest(tick) {
        const cur = trades[tick.idx]
        trades[tick.idx] = { ...cur, [tick.field]: tick.newValue }
        version.update(v => v + 1)
        scheduleRender()
      },
      read() { /* svelte/store walks ran during version.update; latest* already set */ },
      pushSample(ms) { wave.push(ms); cpuEl.textContent = fmtCpu(wave.latest) },
      wave,
    }
  },
}
