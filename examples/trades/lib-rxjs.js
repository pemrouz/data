// rxjs row. tick$ is a Subject<void> that fires per ingest; each
// derivation is a `.pipe(map(...))` subscriber that walks the trades
// state when the subject emits. RxJS has no fine-grained dependency
// tracking and no incremental aggregate primitive — four parallel maps
// each walking the full N=10k on every emission is the realistic shape.
// At 1k tps that's 4k walks × 10k = 40M ops/s for the derivations alone.

import { Subject } from 'rxjs'
import { map } from 'rxjs/operators'
import { N, THRESHOLD, PRICE_BINS, priceBucket } from './gen.js'
import { renderOrderbook, setupOrderbook, setupWaveform, fmtCpu } from './views.js'

export default {
  name: 'rxjs',
  version: '7.8.2',
  tag: 'Subject<tick> + 4 map() walks · O(N) per emission',

  mount(card, opts) {
    const obEl   = card.querySelector('[data-target=ob]')
    const waveEl = card.querySelector('[data-target=wave]')
    const liqEl  = card.querySelector('[data-target=liquid]')
    const avgEl  = card.querySelector('[data-target=avg]')
    const peakEl = card.querySelector('[data-target=peak]')
    const cpuEl  = card.querySelector('.card-cpu')

    const trades = structuredClone(opts.initial)
    const tick$ = new Subject()

    let latestLiq = 0
    let latestAvg = 0
    let latestBids = new Array(PRICE_BINS).fill(0)
    let latestAsks = new Array(PRICE_BINS).fill(0)
    const subs = []

    subs.push(tick$.pipe(map(() => {
      let n = 0
      for (let i = 0; i < N; i++) { const t = trades[i]; if (t.ask - t.bid > THRESHOLD) n++ }
      return n
    })).subscribe(v => { latestLiq = v }))

    subs.push(tick$.pipe(map(() => {
      let s = 0
      for (let i = 0; i < N; i++) s += trades[i].bid
      return s / N
    })).subscribe(v => { latestAvg = v }))

    subs.push(tick$.pipe(map(() => {
      const out = new Array(PRICE_BINS).fill(0)
      for (let i = 0; i < N; i++) out[priceBucket(trades[i].bid)]++
      return out
    })).subscribe(v => { latestBids = v }))

    subs.push(tick$.pipe(map(() => {
      const out = new Array(PRICE_BINS).fill(0)
      for (let i = 0; i < N; i++) out[priceBucket(trades[i].ask)]++
      return out
    })).subscribe(v => { latestAsks = v }))
    card._rxSubs = subs

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
        avgEl.textContent = latestAvg.toFixed(2)
      })
    }

    return {
      ingest(tick) {
        const cur = trades[tick.idx]
        trades[tick.idx] = { ...cur, [tick.field]: tick.newValue }
        tick$.next()
        scheduleRender()
      },
      read() { /* maps fired during tick$.next(); latest* already set */ },
      pushSample(ms) { wave.push(ms); cpuEl.textContent = fmtCpu(wave.latest) },
      wave,
    }
  },
}
