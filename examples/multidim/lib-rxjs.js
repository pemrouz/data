// rxjs row — stream of filter snapshots, every snapshot re-runs all four
// histograms over the full 231k rows. No fine-grained dependency tracking
// (every subscriber gets every emission), so brushing one chart re-pipes
// all four chart histograms PLUS the active count — 5 × O(N) per move.
//
// Idiomatic rxjs shape: BehaviorSubject of the filter state, each chart's
// histogram is `subject.pipe(map(...))`. No auditTime/throttle — that would
// change the semantics; the latency tracker's job is to expose the cost
// of the natural shape.

import { BehaviorSubject } from 'rxjs'
import { map } from 'rxjs/operators'
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
  name: 'rxjs',
  version: '7.8.2',
  tag: 'BehaviorSubject of filters; every emission re-pipes all 5 derivations',

  mount(chartsRoot, rawFlights, tracker, statsEls) {
    const subject = new BehaviorSubject({
      time: [], delay: [], distance: [], date: [],
    })

    const subs = chartsRoot._rxSubs = []

    for (const def of CHART_DEFS) {
      const chart = createChart(chartsRoot, def)
      chart.onMarkInput = () => tracker.markInput()
      chart.onRangeChange = (range) => {
        subject.next({ ...subject.value, [def.name]: range })
      }

      const acc = accessors[def.name]
      const others = NAMES.filter(n => n !== def.name)
      const otherAccs = others.map(n => accessors[n])

      const hist$ = subject.pipe(map(filters => {
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
      }))

      subs.push(hist$.subscribe(({ bars, max }) => chart.setBars(bars, max)))
    }

    const active$ = subject.pipe(map(filters => {
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
    }))
    subs.push(active$.subscribe(n => {
      statsEls.activeEl.textContent = n.toLocaleString()
    }))
    statsEls.totalEl.textContent = rawFlights.length.toLocaleString()
  },
}
