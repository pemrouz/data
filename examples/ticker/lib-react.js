// react row — refs for the mutable window + prices map, a version
// counter in useState as the re-render trigger, useMemo for the derived
// aggregates, useLayoutEffect to push the result into the shared DOM
// renderers. The component returns null; it's a state container.
//
// Why useLayoutEffect, not useEffect: useEffect runs *after* the browser
// paints, so any DOM write inside it lands in the NEXT paint, not the
// one the latency tracker is timing. useLayoutEffect runs synchronously
// between commit and paint — same window every other peer's "render"
// callback runs in. Same fix multidim's react row already documents.
//
// Why refs instead of useState for window+prices: a 50k-tick window
// stored in useState would force React to compare 50k objects on every
// setState (React only structurally compares the root references, but
// the realistic shape — using setState to "set" a new array each batch
// — would force a fresh array allocation per ingest, dwarfing the
// reactive cost). Refs sidestep this: mutation is invisible to React,
// so we bump a version counter (one integer setState) to signal "deps
// changed, recompute the memos".
//
// Why React 18+ automatic batching makes per-tick setState fine: even
// at 1000s of ticks per batch, the surrounding ingest call is one
// macrotask; React batches all setState calls in it into one render. No
// `unstable_batchedUpdates` needed for setState from a non-React
// event-handler context in React 19.

import React, { useState, useRef, useMemo, useLayoutEffect, useImperativeHandle, forwardRef } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { renderTopMovers, renderSectors } from './views.js'

const App = forwardRef(function App({ topEl, sectorEl, tracker, sectorOrder, windowSize }, ref) {
  const [, setVersion] = useState(0)
  const win = useRef([])
  const prices = useRef(new Map())

  useImperativeHandle(ref, () => ({
    ingest(batch) {
      const w = win.current
      const p = prices.current
      for (let i = 0; i < batch.length; i++) {
        const t = batch[i]
        p.set(t.symbol, { price: t.price, pctChg: t.pctChg })
        w.push(t)
      }
      if (w.length > windowSize) w.splice(0, w.length - windowSize)
      // flushSync forces React to render synchronously inside this call.
      // Without it, setVersion is auto-batched (React 18 default for any
      // setState outside a React event handler — and our ingest is
      // triggered from a setInterval, not a React event). The render
      // phase, including useMemo's O(WINDOW) walk, would otherwise run
      // in a microtask AFTER ingest returns, AFTER main.js's sampleIngest
      // has already captured a near-zero "ingest sync" timing, and
      // wouldn't show up in the cpu p50 metric. The useLayoutEffect body
      // (timed by sampleRender) only covers the DOM writes — not the
      // useMemo recompute that ran BEFORE it.
      //
      // Trade-off: a real React app would accept the batching (multiple
      // batches → one render, smoother under load) rather than reach for
      // flushSync. We force sync here so the per-batch CPU cost is
      // measured the same way every other lib's per-batch CPU cost is
      // measured. The number reported is what React's reactive layer
      // ACTUALLY costs per batch — just made visible.
      flushSync(() => setVersion(v => v + 1))
    },
  }), [windowSize])

  const sectorTotals = useMemo(() => {
    const out = {}
    const w = win.current
    for (let i = 0; i < w.length; i++) {
      const t = w[i]
      out[t.sector] = (out[t.sector] || 0) + t.volume
    }
    return out
    // setVersion bump invalidates this memo. We intentionally omit the
    // ref from deps — the eslint rule would suggest [version, win] but
    // win.current is the *same* ref across renders so it'd never
    // re-trigger; version is what changes.
  })

  const topMovers = useMemo(() => {
    const arr = []
    for (const [symbol, info] of prices.current) {
      arr.push({ symbol, price: info.price, pctChg: info.pctChg })
    }
    arr.sort((a, b) => b.pctChg - a.pctChg)
    return arr
  })

  // With flushSync above, the render phase + commit + useLayoutEffect
  // all run inside the same `setVersion` call. main.js's sampleIngest
  // captures all of that — useMemo recompute is between render() and
  // useLayoutEffect, and useLayoutEffect itself runs synchronously
  // before paint. So sampleRender here is just the DOM writes (cheap
  // and parallel to every other peer's rAF body cost).
  useLayoutEffect(() => {
    const r0 = performance.now()
    renderSectors(sectorEl, sectorTotals, sectorOrder)
    renderTopMovers(topEl, topMovers)
    tracker.sampleRender(performance.now() - r0)
  })

  return null
})

export default {
  name: 'react',
  version: '19.2.6',
  tag: 'useState version → useMemo aggregates → useLayoutEffect render',

  mount(row, tracker, opts) {
    const topEl = row.querySelector('[data-target=top]')
    const sectorEl = row.querySelector('[data-target=sectors]')

    renderTopMovers(topEl, [])
    renderSectors(sectorEl, {}, opts.sectorOrder)

    const hidden = document.createElement('div')
    const root = createRoot(hidden)
    const ref = React.createRef()
    root.render(
      React.createElement(App, {
        ref,
        topEl,
        sectorEl,
        tracker,
        sectorOrder: opts.sectorOrder,
        windowSize: opts.windowSize,
      })
    )
    row._reactRoot = root

    return {
      ingest(batch) {
        // First batch may arrive before useImperativeHandle has run —
        // drop it silently rather than crash. The next batch comes in
        // ~60ms and the handle will be live by then.
        if (ref.current) ref.current.ingest(batch)
      },
    }
  },
}
