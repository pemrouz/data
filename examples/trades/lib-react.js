// react row. Same imperative-state-behind-a-signal pattern as the ticker
// peer: refs for the mutable trades table, a useState version counter as
// the re-render trigger, useMemo for the four derived aggregates,
// useLayoutEffect to push results into the shared DOM renderers.
// The component returns null — it's a state container, not visible UI.
//
// flushSync forces React to render synchronously inside ingest. Without
// it, setVersion auto-batches and useMemo's O(N) walks happen in a
// microtask AFTER ingest returns — and the timed block in main.js would
// already have ended, registering a near-zero "ingest sync" cost while
// the real work shows up untimed on the next frame.
//
// useLayoutEffect (not useEffect) so the DOM writes land between commit
// and paint, in the same window every other peer's render callback runs
// in. Without that the latency tracker would show a phantom +16ms.

import React, { useState, useRef, useMemo, useLayoutEffect, useImperativeHandle, forwardRef } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { N, THRESHOLD, PRICE_BINS, priceBucket } from './gen.js'
import { renderOrderbook, setupOrderbook, setupWaveform, fmtCpu } from './views.js'

const App = forwardRef(function App({ obEl, waveEl, liqEl, avgEl, peakEl, cpuEl, initial, card }, ref) {
  const [, setVersion] = useState(0)
  const trades = useRef(null)
  if (trades.current == null) trades.current = structuredClone(initial)
  const ob = useRef(null)
  const wave = useRef(null)
  if (ob.current == null) ob.current = setupOrderbook(obEl)
  if (wave.current == null) wave.current = setupWaveform(waveEl, 'accent', peakEl)

  useImperativeHandle(ref, () => ({
    ingest(tick) {
      const tr = trades.current
      const cur = tr[tick.idx]
      tr[tick.idx] = { ...cur, [tick.field]: tick.newValue }
      flushSync(() => setVersion(v => v + 1))
    },
    pushSample(ms) {
      wave.current.push(ms)
      cpuEl.textContent = fmtCpu(wave.current.latest)
    },
    wave: wave.current,
  }), [])

  const liquidCount = useMemo(() => {
    const tr = trades.current
    let n = 0
    for (let i = 0; i < N; i++) { const t = tr[i]; if (t.ask - t.bid > THRESHOLD) n++ }
    return n
  })
  const avgBid = useMemo(() => {
    const tr = trades.current
    let s = 0
    for (let i = 0; i < N; i++) s += tr[i].bid
    return s / N
  })
  const bids = useMemo(() => {
    const tr = trades.current
    const out = new Array(PRICE_BINS).fill(0)
    for (let i = 0; i < N; i++) out[priceBucket(tr[i].bid)]++
    return out
  })
  const asks = useMemo(() => {
    const tr = trades.current
    const out = new Array(PRICE_BINS).fill(0)
    for (let i = 0; i < N; i++) out[priceBucket(tr[i].ask)]++
    return out
  })

  useLayoutEffect(() => {
    renderOrderbook(ob.current, bids, asks)
    liqEl.textContent = String(liquidCount)
    avgEl.textContent = avgBid.toFixed(2)
  })

  return null
})

export default {
  name: 'react',
  version: '19.2.6',
  tag: 'useState<version> + 4 useMemo walks + useLayoutEffect',

  mount(card, opts) {
    const obEl   = card.querySelector('[data-target=ob]')
    const waveEl = card.querySelector('[data-target=wave]')
    const liqEl  = card.querySelector('[data-target=liquid]')
    const avgEl  = card.querySelector('[data-target=avg]')
    const peakEl = card.querySelector('[data-target=peak]')
    const cpuEl  = card.querySelector('.card-cpu')

    const hidden = document.createElement('div')
    const root = createRoot(hidden)
    const ref = React.createRef()
    root.render(
      React.createElement(App, {
        ref,
        obEl, waveEl, liqEl, avgEl, peakEl, cpuEl,
        initial: opts.initial,
        card,
      })
    )
    card._reactRoot = root

    return {
      ingest(tick) {
        if (ref.current) ref.current.ingest(tick)
      },
      read() { /* useMemo + useLayoutEffect already ran in ingest's flushSync */ },
      pushSample(ms) {
        if (ref.current) ref.current.pushSample(ms)
      },
      get wave() { return ref.current?.wave },
    }
  },
}
