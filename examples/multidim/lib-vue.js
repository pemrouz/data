// vue-reactivity row — `reactive` proxy of the filters object, `computed`
// histograms, `effect` to drive the imperative chart helper. Property-level
// dependency tracking, like solid/preact-signals: brushing one chart
// invalidates exactly the 3 OTHER histograms + active count.
//
// Mutations replace property values rather than the whole object, so vue's
// proxy invalidates per-key precisely. `effect` is the synchronous primitive
// from @vue/reactivity (not the Vue runtime's scheduled `watchEffect`); we
// want synchronous propagation so latency is captured in one pointermove →
// paint window.

import { reactive, computed, effect } from '@vue/reactivity'
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

export default {
  name: 'vue-reactivity',
  version: '3.5.34',
  tag: 'reactive proxy + computed; per-key tracking via Proxy',

  mount(chartsRoot, rawFlights, tracker, statsEls) {
    const filters = reactive({
      time: [], delay: [], distance: [], date: [],
    })

    const histograms = {}
    for (const def of CHART_DEFS) {
      const acc = accessors[def.name]
      const others = NAMES.filter(n => n !== def.name)
      const otherAccs = others.map(n => accessors[n])
      histograms[def.name] = computed(() => {
        const ranges = others.map(n => filters[n])
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

    const stops = chartsRoot._vueStops = []
    for (const def of CHART_DEFS) {
      const chart = createChart(chartsRoot, def)
      chart.onMarkInput = () => tracker.markInput()
      chart.onRangeChange = (range) => { filters[def.name] = range }
      stops.push(effect(() => {
        const { bars, max } = histograms[def.name].value
        chart.setBars(bars, max)
      }))
    }
    stops.push(effect(() => {
      statsEls.activeEl.textContent = activeCount.value.toLocaleString()
    }))
    statsEls.totalEl.textContent = rawFlights.length.toLocaleString()

    // Top 5 by delay desc — additional computed + effect.
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
    stops.push(effect(() => renderTopList(statsEls.topListEl, top5.value)))
  },
}
