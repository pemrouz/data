// crossfilter row — the original brushable-dimensions library, the only
// peer with native incremental aggregation here. One `crossfilter` instance
// over all 231k rows; one dimension per filter (time/delay/distance/date);
// each chart's bars come from `dim.group(binFn).all()` which inherently
// excludes its own dim's filter (the canonical crossfilter idiom).
//
// Brush wiring: `dim.filterRange([lo, hi])` on every range change; the lib
// updates all dimension indexes synchronously, after which we walk every
// chart's group to pull fresh bucket counts. No rAF coalescing — crossfilter
// is fast enough that per-pointermove writes don't get backed up.

import crossfilter from 'crossfilter2'
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

export default {
  name: 'crossfilter',
  version: '1.5.4',
  tag: 'native incremental dimensions — dim.filterRange + group.all',

  mount(chartsRoot, rawFlights, tracker, statsEls) {
    const cf = crossfilter(rawFlights)
    const dims = {}
    const groups = {}
    for (const def of CHART_DEFS) {
      dims[def.name] = cf.dimension(accessors[def.name])
      groups[def.name] = dims[def.name].group(def.group)
    }
    const allCount = cf.groupAll()

    // Sort dimension for the top-5 list. Negate so `dSort.top(K)` returns
    // top-K by descending delay. Crucially this dim has no own filter set,
    // so its `.top()` respects all 4 actual filters (crossfilter excludes
    // each dim's own filter from its own .top result).
    const dSort = cf.dimension(d => -d.delay)

    const charts = []
    for (const def of CHART_DEFS) {
      const chart = createChart(chartsRoot, def)
      charts.push({ chart, def })

      chart.onMarkInput = () => tracker.markInput()
      chart.onRangeChange = (range) => {
        if (range.length === 2) dims[def.name].filterRange(range)
        else dims[def.name].filterAll()
        // Every dim's `.all()` is up-to-date synchronously after a filter
        // mutation — walk all charts so cross-dim coupling shows.
        updateAll()
      }
    }

    function updateAll() {
      for (const { chart, def } of charts) {
        const bars = {}
        let max = 0
        for (const g of groups[def.name].all()) {
          if (g.value > 0) {
            bars[g.key] = g.value
            if (g.value > max) max = g.value
          }
        }
        chart.setBars(bars, max)
      }
      statsEls.activeEl.textContent = allCount.value().toLocaleString()
      renderTopList(statsEls.topListEl, dSort.top(5))
    }

    statsEls.totalEl.textContent = rawFlights.length.toLocaleString()
    updateAll()
  },
}
