// solid row — per-filter signals + memos. Each histogram memo reads only
// the THREE other filters' signals, so brushing one chart invalidates
// exactly 3 histograms + active count, not the brushed chart's own
// histogram. This is the fine-grained dependency tracking Solid is built
// around — closer to mobx's selectivity than to React's whole-component
// re-render.
//
// Memo bodies still walk all 231k rows because there's no incremental
// aggregation primitive — same shape as the bench's chained-memo
// trades-pipeline measurement.

import { createSignal, createMemo, createEffect, createRoot } from 'solid-js'
import { createChart } from './chart.js'

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

export default {
  name: 'solid',
  version: '1.9.12',
  tag: 'per-filter signals + memos; fine-grained dep tracking, O(N) memo bodies',

  mount(chartsRoot, rawFlights, tracker, statsEls) {
    createRoot(() => {
      // One signal per filter so the dependency graph can dedup precisely:
      // changing time() leaves the time histogram (which never read time())
      // un-invalidated.
      const sigs = {}
      for (const name of NAMES) sigs[name] = createSignal([])

      const histograms = {}
      for (const def of CHART_DEFS) {
        const acc = accessors[def.name]
        const others = NAMES.filter(n => n !== def.name)
        const otherAccs = others.map(n => accessors[n])
        histograms[def.name] = createMemo(() => {
          const ranges = others.map(n => sigs[n][0]())
          const bars = {}
          let max = 0
          for (let i = 0; i < rawFlights.length; i++) {
            const d = rawFlights[i]
            let pass = true
            for (let j = 0; j < others.length; j++) {
              if (!inRange(otherAccs[j](d), ranges[j])) { pass = false; break }
            }
            if (!pass) continue
            const k = def.group(acc(d))
            const v = (bars[k] || 0) + 1
            bars[k] = v
            if (v > max) max = v
          }
          return { bars, max }
        })
      }

      const activeCount = createMemo(() => {
        const ranges = NAMES.map(n => sigs[n][0]())
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
      })

      for (const def of CHART_DEFS) {
        const chart = createChart(chartsRoot, def)
        chart.onMarkInput = () => tracker.markInput()
        chart.onRangeChange = (range) => sigs[def.name][1](range)
        createEffect(() => {
          const { bars, max } = histograms[def.name]()
          chart.setBars(bars, max)
        })
      }
      createEffect(() => {
        statsEls.activeEl.textContent = activeCount().toLocaleString()
      })
      statsEls.totalEl.textContent = rawFlights.length.toLocaleString()
    })
  },
}
