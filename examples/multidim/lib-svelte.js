// svelte/store row — `writable` per filter, `derived` over the OTHER 3
// stores per histogram. svelte/store is the runtime-only API; svelte 5
// runes (`$state`/`$derived`) need the compiler and aren't headless-friendly,
// so this row uses the same store API the existing comparisons.html bench
// uses for the same reason.
//
// Each `derived` lists exactly the stores it reads, so brushing time leaves
// the time histogram un-recomputed. Subscribe callbacks fire synchronously
// on store updates (no scheduler).

import { writable, derived } from 'svelte/store'
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
  name: 'svelte-store',
  version: '5.55.5',
  tag: 'writable + derived; subscribe-driven; runtime-only Svelte primitive',

  mount(chartsRoot, rawFlights, tracker, statsEls) {
    const filters = {}
    for (const name of NAMES) filters[name] = writable([])

    const histograms = {}
    for (const def of CHART_DEFS) {
      const acc = accessors[def.name]
      const others = NAMES.filter(n => n !== def.name)
      const otherStores = others.map(n => filters[n])
      const otherAccs = others.map(n => accessors[n])
      histograms[def.name] = derived(otherStores, ranges => {
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

    const allStores = NAMES.map(n => filters[n])
    const allAccs = NAMES.map(n => accessors[n])
    const activeCount = derived(allStores, ranges => {
      let n = 0
      for (let i = 0; i < rawFlights.length; i++) {
        const d = rawFlights[i]
        let pass = true
        for (let j = 0; j < NAMES.length; j++) {
          if (!inRange(allAccs[j](d), ranges[j])) { pass = false; break }
        }
        if (pass) n++
      }
      return n
    })

    const unsubs = chartsRoot._svelteUnsubs = []
    for (const def of CHART_DEFS) {
      const chart = createChart(chartsRoot, def)
      chart.onMarkInput = () => tracker.markInput()
      chart.onRangeChange = (range) => filters[def.name].set(range)
      unsubs.push(histograms[def.name].subscribe(({ bars, max }) => {
        chart.setBars(bars, max)
      }))
    }
    unsubs.push(activeCount.subscribe(n => {
      statsEls.activeEl.textContent = n.toLocaleString()
    }))
    statsEls.totalEl.textContent = rawFlights.length.toLocaleString()
  },
}
