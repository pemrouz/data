// data row. Four reactive views over $({…}) — liquidCount, avgBid, plus
// two `length(fn)` views grouping trades by bid and ask price for the
// order book. Each BU1 tick costs O(1) per view via length(fn)'s
// internal `mapping` (old bucket--, new bucket++) and via the avg
// aggregate's running totals. peers walk the full 10k per get.
//
// Per tick we do a WHOLE-ROW REPLACE (BU1) rather than a deep field
// update (BU2). Reason: length(fn).BU2 is a no-op in the operator (no
// way for the framework to know the old bucket without the old value),
// so BU2 would leave per-bucket counts stale. BU1 carries [name, newRow]
// and length(fn).BU1 uses its internal `mapping` to decrement the old
// bucket + increment the new one in O(1). filter→length and avg handle
// BU1 identically to BU2 via RowOperator.loop / AggregateValue's tracked
// map, so the change is invisible to them.
//
// length(fn) emits {[bucket]: {value: count}} — each bucket is a tiny
// reactive container so downstream views can subscribe to one counter
// without re-rendering all buckets. We flatten to a plain
// [count, count, ...] array at the render boundary so renderOrderbook
// (shared with mobx and the seven peers) handles all libs uniformly.

import { $, value } from 'data/full'
import { THRESHOLD, PRICE_BINS, priceBucket } from './gen.js'
import { renderOrderbook, setupOrderbook, setupWaveform, fmtCpu } from './views.js'

function flattenLenFnObj(obj) {
  const out = new Array(PRICE_BINS).fill(0)
  for (const k in obj) {
    const bucket = obj[k]
    if (bucket) out[k] = bucket.value
  }
  return out
}

export default {
  name: 'data',
  version: '0.x',
  tag: '2× length(fn) + filter→length + avg · O(1) per tick',

  mount(card, opts) {
    const obEl   = card.querySelector('[data-target=ob]')
    const waveEl = card.querySelector('[data-target=wave]')
    const liqEl  = card.querySelector('[data-target=liquid]')
    const avgEl  = card.querySelector('[data-target=avg]')
    const peakEl = card.querySelector('[data-target=peak]')
    const cpuEl  = card.querySelector('.card-cpu')

    const trades = $(structuredClone(opts.initial))
    const liquidCount = trades.filter(t => t.ask - t.bid > THRESHOLD).length()
    const avgBid = trades.avg('bid')
    const bids = trades.length(t => priceBucket(t.bid))
    const asks = trades.length(t => priceBucket(t.ask))

    const ob = setupOrderbook(obEl)
    const wave = setupWaveform(waveEl, 'pos', peakEl)

    let scheduled = false
    function scheduleRender() {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        renderOrderbook(ob, flattenLenFnObj(bids[value] || {}), flattenLenFnObj(asks[value] || {}))
        liqEl.textContent = String(liquidCount[value] ?? 0)
        const av = avgBid[value]
        avgEl.textContent = av == null ? '—' : av.toFixed(2)
      })
    }
    // Hold references so the WeakRef-backed sinks don't get GC'd.
    card._chains = [
      liquidCount.tap(scheduleRender),
      avgBid.tap(scheduleRender),
      bids.tap(scheduleRender),
      asks.tap(scheduleRender),
    ]

    return {
      ingest(tick) {
        const cur = trades[tick.idx][value]
        trades[tick.idx] = { ...cur, [tick.field]: tick.newValue }
      },
      read() {
        void liquidCount[value]; void avgBid[value]
        void bids[value]; void asks[value]
      },
      pushSample(ms) { wave.push(ms); cpuEl.textContent = fmtCpu(wave.latest) },
      wave,
    }
  },
}
