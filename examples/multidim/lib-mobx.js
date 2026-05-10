// mobx row — proxy-based reactivity, no incremental aggregation. Filters
// are observable; histograms are computeds that walk all 231k rows on every
// invalidation; autoruns push their results into the imperative chart.
//
// Each chart's histogram depends on the OTHER 3 filters (so brushing the
// time chart invalidates delay/distance/date histograms, but not its own —
// matching the crossfilter idiom). The active-count computed depends on
// all 4. So one brush move on the time chart fires 4 computeds, each
// re-walking the 231k-row source.
//
// No rAF coalescing — `runInAction` per pointermove. mobx will fire its
// reactionScheduler synchronously, so the latency tracker records the full
// recomputation cost as part of the input → paint window.

import { observable, computed, autorun, runInAction, configure } from 'mobx'
import { createChart } from './chart.js'
import { renderTopList } from './top-list.js'

// Suppress the action warning — we do mutate observables outside of action
// functions briefly during the configure call's internal setup. The actual
// brush writes go through runInAction.
configure({ enforceActions: 'never' })

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
  name: 'mobx',
  version: '6.15.3',
  tag: 'observable filters + 4 chained computeds; no incremental aggregation',

  mount(chartsRoot, rawFlights, tracker, statsEls) {
    // Only filters are reactive. Rows don't change — wrapping 231k rows in
    // observable.object would dwarf the brush cost with one-time setup, and
    // it isn't needed for this workload.
    const filters = observable({
      time: [], delay: [], distance: [], date: [],
    })

    // Histogram for `name` — counts respecting all OTHER filters, bucketed
    // by `name`'s grouping function. Reads `filters[other]` for each other
    // dim, so mobx tracks dependencies on those (not on `filters[name]`
    // itself — exactly the cross-filter independence we want).
    function makeHistogram(name, def) {
      const acc = accessors[name]
      const others = NAMES.filter(n => n !== name)
      return computed(() => {
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
      })
    }

    const histograms = {}
    for (const def of CHART_DEFS) histograms[def.name] = makeHistogram(def.name, def)

    const activeCount = computed(() => {
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
    })

    const charts = {}
    for (const def of CHART_DEFS) {
      const chart = createChart(chartsRoot, def)
      charts[def.name] = chart
      chart.onMarkInput = () => tracker.markInput()
      chart.onRangeChange = (range) => {
        runInAction(() => { filters[def.name] = range })
      }
    }

    // autorun wires computed → DOM. Each autorun runs synchronously when
    // its observed inputs change.
    const disposers = chartsRoot._mobxDisposers = []
    for (const def of CHART_DEFS) {
      disposers.push(autorun(() => {
        const { bars, max } = histograms[def.name].get()
        charts[def.name].setBars(bars, max)
      }))
    }
    disposers.push(autorun(() => {
      statsEls.activeEl.textContent = activeCount.get().toLocaleString()
    }))
    statsEls.totalEl.textContent = rawFlights.length.toLocaleString()

    // Top 5 by delay desc — another full O(N) walk + O(K log K) sort per
    // filter change, on top of the four histograms and the active count.
    const top5 = computed(() => {
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
    })
    disposers.push(autorun(() => renderTopList(statsEls.topListEl, top5.get())))
  },
}
