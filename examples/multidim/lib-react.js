// react row — useState for filters, useMemo for the four histograms +
// active count, useEffect to push results into the imperative chart helper.
// React renders nothing to the DOM (returns null); the component is purely a
// state container so the chart drawing is identical to every other row.
//
// Each filter mutation calls `setFilters(prev => ({ ...prev, [name]: range }))`,
// which replaces the filters object reference — every useMemo's dep array
// becomes !== to its previous value, so all 5 memos re-compute (the histogram
// for the brushed dim too, even though its body doesn't depend on its own
// filter — there's no per-key dependency tracking in React's reactivity).

import React, { useState, useMemo, useRef, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { createChart } from './chart.js'
import { renderTopList } from './top-list.js'

const byHour       = d => Math.floor(d)
const byTenMins    = d => Math.floor(d / 10) * 10
const byFiftyMiles = d => Math.floor(d / 50) * 50
const byDay        = d => Math.floor(d / 86400000) * 86400000

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const CHART_DEFS = [
  { name: 'time',     title: 'time',     domain: [0, 24],     width: 110, ticks: [0, 6, 12, 18, 24], format: String, group: byHour,       bucketSize: 1 },
  { name: 'delay',    title: 'delay',    domain: [-60, 150],  width: 110, ticks: [-60, 0, 60, 120],   format: String, group: byTenMins,    bucketSize: 10 },
  { name: 'distance', title: 'distance', domain: [0, 2000],   width: 110, ticks: [0, 1000, 2000],     format: String, group: byFiftyMiles, bucketSize: 50 },
  { name: 'date',     title: 'date',     domain: [+new Date(2001, 0, 1), +new Date(2001, 3, 1)], width: 220,
    ticks: [+new Date(2001, 0, 1), +new Date(2001, 1, 1), +new Date(2001, 2, 1), +new Date(2001, 3, 1)],
    format: t => months[new Date(t).getMonth()], group: byDay, bucketSize: 86400000,
    round: t => Math.round(t / 86400000) * 86400000 },
]

const accessors = {
  time:     d => d.time,
  delay:    d => d.delay,
  distance: d => d.distance,
  date:     d => +d.date,
}

const NAMES = ['time', 'delay', 'distance', 'date']

function inRange(v, range) {
  return !range || range.length === 0 || (v >= range[0] && v <= range[1])
}

function computeHistogram(def, filters, rawFlights) {
  const acc = accessors[def.name]
  const others = NAMES.filter(n => n !== def.name)
  const ranges = others.map(n => filters[n])
  const accs   = others.map(n => accessors[n])
  const bars = {}
  let max = 0
  for (let i = 0; i < rawFlights.length; i++) {
    const d = rawFlights[i]
    let pass = true
    for (let j = 0; j < others.length; j++) {
      if (!inRange(accs[j](d), ranges[j])) { pass = false; break }
    }
    if (!pass) continue
    const k = def.group(acc(d))
    const v = (bars[k] || 0) + 1
    bars[k] = v
    if (v > max) max = v
  }
  return { bars, max }
}

function computeActive(filters, rawFlights) {
  const ranges = NAMES.map(n => filters[n])
  const accs   = NAMES.map(n => accessors[n])
  let n = 0
  for (let i = 0; i < rawFlights.length; i++) {
    const d = rawFlights[i]
    let pass = true
    for (let j = 0; j < NAMES.length; j++) {
      if (!inRange(accs[j](d), ranges[j])) { pass = false; break }
    }
    if (pass) n++
  }
  return n
}

function App({ rawFlights, tracker, chartsRoot, statsEls }) {
  const [filters, setFilters] = useState({
    time: [], delay: [], distance: [], date: [],
  })
  const charts = useRef(null)

  // Lazy chart creation. useRef-guarded so a (hypothetical) double-mount
  // doesn't double-create — the imperative chart appends real DOM nodes.
  if (!charts.current) {
    charts.current = {}
    for (const def of CHART_DEFS) {
      const chart = createChart(chartsRoot, def)
      chart.onMarkInput = () => tracker.markInput()
      chart.onRangeChange = (range) => {
        setFilters(prev => ({ ...prev, [def.name]: range }))
      }
      charts.current[def.name] = chart
    }
    statsEls.totalEl.textContent = rawFlights.length.toLocaleString()
  }

  const histograms = useMemo(() => {
    const out = {}
    for (const def of CHART_DEFS) out[def.name] = computeHistogram(def, filters, rawFlights)
    return out
  }, [filters])

  const activeCount = useMemo(() => computeActive(filters, rawFlights), [filters])
  const top5 = useMemo(() => computeTop5(filters, rawFlights), [filters])

  useEffect(() => {
    for (const def of CHART_DEFS) {
      const { bars, max } = histograms[def.name]
      charts.current[def.name].setBars(bars, max)
    }
    statsEls.activeEl.textContent = activeCount.toLocaleString()
    renderTopList(statsEls.topListEl, top5)
  })

  return null
}

function computeTop5(filters, rawFlights) {
  const ranges = NAMES.map(n => filters[n])
  const accs   = NAMES.map(n => accessors[n])
  const passing = []
  for (let i = 0; i < rawFlights.length; i++) {
    const d = rawFlights[i]
    let pass = true
    for (let j = 0; j < NAMES.length; j++) {
      if (!inRange(accs[j](d), ranges[j])) { pass = false; break }
    }
    if (pass) passing.push(d)
  }
  passing.sort((a, b) => b.delay - a.delay)
  return passing.slice(0, 5)
}

export default {
  name: 'react',
  version: '19.2.6',
  tag: 'useState filters → useMemo histograms → useEffect to imperative chart',

  mount(chartsRoot, rawFlights, tracker, statsEls) {
    // Hidden root — the component returns null; we drive the visible chart
    // imperatively from inside useEffect. React is just the state container.
    const hidden = document.createElement('div')
    const root = createRoot(hidden)
    root.render(React.createElement(App, { rawFlights, tracker, chartsRoot, statsEls }))
    chartsRoot._reactRoot = root
  },
}
