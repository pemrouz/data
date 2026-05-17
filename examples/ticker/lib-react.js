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
// Why refs instead of useState for window+prices: a 500k-tick window
// stored in useState would force React to compare 500k objects on every
// setState (React only structurally compares the root references, but
// the realistic shape — using setState to "set" a new array each batch
// — would force a fresh array allocation per ingest, dwarfing the
// reactive cost). Refs sidestep this: mutation is invisible to React,
// so we bump a version counter (one integer setState) to signal "deps
// changed, recompute the memos".

import React, { useState, useRef, useMemo, useLayoutEffect, useImperativeHandle, forwardRef } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import {
  renderTopMovers,
  renderBottomMovers,
  renderSectors,
  renderHistogram,
  renderScalars,
} from './views.js'

const HIST_BINS = 10
const HIST_LO = -5
const HIST_HI = 5
function binIdx(pct) {
  if (pct <= HIST_LO) return 0
  if (pct >= HIST_HI) return HIST_BINS - 1
  return Math.floor((pct - HIST_LO) / (HIST_HI - HIST_LO) * HIST_BINS)
}

const App = forwardRef(function App({ topEl, bottomEl, sectorEl, histEl, scalarsEl, tracker, sectorOrder, windowSize }, ref) {
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
      // flushSync forces React to render synchronously inside this call
      // — without it, setVersion auto-batches and useMemo's O(WINDOW)
      // walks would happen in a microtask AFTER ingest returns, AFTER
      // main.js's sampleIngest has already captured a near-zero "ingest
      // sync" timing. See the longer comment in the previous revision
      // of this file for the full justification.
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
  })

  const histogram = useMemo(() => {
    const w = win.current
    const bins = new Array(HIST_BINS).fill(0)
    for (let i = 0; i < w.length; i++) bins[binIdx(w[i].pctChg)]++
    return bins
  })

  const totalVol = useMemo(() => {
    const w = win.current
    let s = 0
    for (let i = 0; i < w.length; i++) s += w[i].volume
    return s
  })

  const avgPct = useMemo(() => {
    const w = win.current
    if (!w.length) return undefined
    let s = 0
    for (let i = 0; i < w.length; i++) s += w[i].pctChg
    return s / w.length
  })

  const topMovers = useMemo(() => {
    const arr = []
    for (const [symbol, info] of prices.current) arr.push({ symbol, price: info.price, pctChg: info.pctChg })
    arr.sort((a, b) => b.pctChg - a.pctChg)
    return arr.slice(0, 3)
  })

  const bottomMovers = useMemo(() => {
    const arr = []
    for (const [symbol, info] of prices.current) arr.push({ symbol, price: info.price, pctChg: info.pctChg })
    arr.sort((a, b) => a.pctChg - b.pctChg)
    return arr.slice(0, 3)
  })

  useLayoutEffect(() => {
    const r0 = performance.now()
    renderSectors(sectorEl, sectorTotals, sectorOrder)
    renderHistogram(histEl, histogram)
    renderScalars(scalarsEl, totalVol, avgPct)
    renderTopMovers(topEl, topMovers)
    renderBottomMovers(bottomEl, bottomMovers)
    tracker.sampleRender(performance.now() - r0)
  })

  return null
})

export default {
  name: 'react',
  version: '19.2.6',
  tag: 'useState version → useMemo × 6 → useLayoutEffect render',

  mount(row, tracker, opts) {
    const topEl     = row.querySelector('[data-target=top]')
    const bottomEl  = row.querySelector('[data-target=bottom]')
    const sectorEl  = row.querySelector('[data-target=sectors]')
    const histEl    = row.querySelector('[data-target=hist]')
    const scalarsEl = row.querySelector('[data-target=scalars]')

    renderTopMovers(topEl, [])
    renderBottomMovers(bottomEl, [])
    renderSectors(sectorEl, {}, opts.sectorOrder)
    renderHistogram(histEl, new Array(HIST_BINS).fill(0))
    renderScalars(scalarsEl, undefined, undefined)

    const hidden = document.createElement('div')
    const root = createRoot(hidden)
    const ref = React.createRef()
    root.render(
      React.createElement(App, {
        ref,
        topEl, bottomEl, sectorEl, histEl, scalarsEl,
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
