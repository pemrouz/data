// crossfilter row. The library's native strength is incremental
// per-group reduce on add/remove. We model each tick as a (remove,
// add) pair: the old row leaves via an id-dimension filter, the new row
// is added. All four derivations are native dimensions/groups —
// bid-bucket count, ask-bucket count, "spread > THRESHOLD" bool group,
// and groupAll(sum,count) for avg bid — so each derivation updates
// O(log N) per tick rather than walking the full N.
//
// Removing via idDim.filter(idx) + cf.remove() uses the dimension's
// sorted index instead of cf.remove(predicate)'s O(N) walk. Same row
// shape as data/mobx so the bid/ask views feed renderOrderbook
// uniformly after a small flatten of the group.all() result.

import crossfilter from 'crossfilter2'
import { N, THRESHOLD, PRICE_BINS, priceBucket } from './gen.js'
import { renderOrderbook, setupOrderbook, setupWaveform, fmtCpu } from './views.js'

export default {
  name: 'crossfilter',
  version: '1.5.4',
  tag: 'native dimensions × groups · incremental on add/remove',

  mount(card, opts) {
    const obEl   = card.querySelector('[data-target=ob]')
    const waveEl = card.querySelector('[data-target=wave]')
    const liqEl  = card.querySelector('[data-target=liquid]')
    const avgEl  = card.querySelector('[data-target=avg]')
    const peakEl = card.querySelector('[data-target=peak]')
    const cpuEl  = card.querySelector('.card-cpu')

    // crossfilter doesn't update records in place — every tick is a
    // (remove old, add new) pair. We maintain a parallel `trades` map
    // so ingest knows the current bid/ask of the row being replaced.
    const trades = structuredClone(opts.initial)
    const cf = crossfilter([])
    const initialRows = []
    for (let i = 0; i < N; i++) initialRows.push(trades[i])
    cf.add(initialRows)

    const idDim         = cf.dimension(d => d.id)
    const bidBucketDim  = cf.dimension(d => priceBucket(d.bid))
    const askBucketDim  = cf.dimension(d => priceBucket(d.ask))
    const liquidBoolDim = cf.dimension(d => (d.ask - d.bid) > THRESHOLD ? 1 : 0)
    const bidBucketGroup  = bidBucketDim.group().reduceCount()
    const askBucketGroup  = askBucketDim.group().reduceCount()
    const liquidBoolGroup = liquidBoolDim.group().reduceCount()
    const avgBidAcc = cf.groupAll().reduce(
      (acc, d) => { acc.sum += d.bid; acc.n += 1; return acc },
      (acc, d) => { acc.sum -= d.bid; acc.n -= 1; return acc },
      () => ({ sum: 0, n: 0 }),
    )

    const ob = setupOrderbook(obEl)
    const wave = setupWaveform(waveEl, 'accent', peakEl)

    let scheduled = false
    function scheduleRender() {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        const bids = new Array(PRICE_BINS).fill(0)
        for (const { key, value } of bidBucketGroup.all()) bids[key] = value
        const asks = new Array(PRICE_BINS).fill(0)
        for (const { key, value } of askBucketGroup.all()) asks[key] = value
        renderOrderbook(ob, bids, asks)
        let liquid = 0
        for (const { key, value } of liquidBoolGroup.all()) if (key === 1) liquid = value
        liqEl.textContent = String(liquid)
        const av = avgBidAcc.value()
        avgEl.textContent = av.n ? (av.sum / av.n).toFixed(2) : '—'
      })
    }

    return {
      ingest(tick) {
        const cur = trades[tick.idx]
        const newRow = { ...cur, [tick.field]: tick.newValue }
        trades[tick.idx] = newRow
        // Filter by id, remove the (single) matching record, unfilter.
        idDim.filter(tick.idx)
        cf.remove()
        idDim.filterAll()
        cf.add([newRow])
      },
      read() { /* dim groups already updated incrementally on remove+add */ },
      pushSample(ms) {
        wave.push(ms)
        cpuEl.textContent = fmtCpu(wave.latest)
        scheduleRender()
      },
      wave,
    }
  },
}
