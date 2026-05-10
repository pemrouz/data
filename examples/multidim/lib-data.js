// `data` row — incremental aggregation over brushable filters.
// `between` builds a sorted index over each dimension; mutating a filter
// triggers a delta-only walk (rows entering/leaving the window) rather
// than a full O(N) re-aggregate. `intersect(dims, name)` is the dimension's
// view with all *other* filters applied (the crossfilter idiom). `length(fn)`
// is incremental too — adds/removes one bucket count per delta.
//
// Top-K shape: za the source by `delay` once at mount (231k rows pre-sorted
// — paid once, never again because the source never mutates), then
// `intersect(dims).limit(5)` is what runs per filter change. limit's per-
// delta cost is O(1) amortised; if a row in the visible top-5 leaves the
// active set, it walks `nextAfter` until it finds the next survivor and
// emits one BR1A + one BI0A. The tempting alternative —
// `intersect(dims).za('delay', 5)` — runs a sorted-index splice on every
// row delta and is O(active-set) per delta because the za bookkeeping
// re-keys all entries past the splice point. With ~1000 rows transitioning
// per pointermove against an active set of ~100k, that path was O(N²) per
// move and froze the page after a few brushes.

import { $, value } from 'data/full'
import { createChart } from './chart.js'
import { renderTopList } from './top-list.js'

const byHour       = d => Math.floor(d.time)
const byTenMins    = d => Math.floor(d.delay / 10) * 10
const byFiftyMiles = d => Math.floor(d.distance / 50) * 50
const byDay        = d => Math.floor(d.date / 86400000) * 86400000

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

export default {
  name: 'data',
  version: '1.0.0',
  tag: 'incremental — between + intersect + length + limit',

  mount(chartsRoot, rawFlights, tracker, statsEls) {
    // Sort by delay desc once. Source never mutates so this is a pure
    // setup cost; downstream operators see a sorted index of indices, and
    // `limit(5)` reads the highest-delay survivors directly off the front.
    const source = $(rawFlights).za('delay', Infinity)
    const filters = $({
      delay:    [],
      distance: [],
      time:     [],
      date:     [],
    })
    const dims = {
      delay:    source.between('delay',    filters.delay),
      distance: source.between('distance', filters.distance),
      date:     source.between('date',     filters.date),
      time:     source.between('time',     filters.time),
    }

    // Tap chains anchor on the receiver — drop the chain and tap unsubscribes
    // (see operators/tap/index.ts). Stash the tapped views on the row so the
    // chains live as long as the mounted row does.
    const chains = chartsRoot._chains = []

    for (const def of CHART_DEFS) {
      const chart = createChart(chartsRoot, def)
      const histogram = source.intersect(dims, def.name).length(def.group)
      const maxV = histogram.max('value')

      let writer = null
      chart.onMarkInput = () => tracker.markInput()
      chart.onUpdate    = () => tracker.markUpdate()
      chart.onRangeChange = (range) => {
        if (!writer) writer = filters[def.name].raf()
        writer(range)
      }

      const update = () => {
        const buckets = histogram[value]
        if (!buckets) return chart.setBars({}, 0)
        const flat = {}
        for (const k in buckets) flat[k] = buckets[k].value
        chart.setBars(flat, maxV[value] || 0)
      }
      // Tap on max — max republishes on every histogram change, so a single
      // tap covers both the bars and the y-scale.
      chains.push(maxV.tap(update))
      update()

      // Seed the brush from the initial filter (the date filter starts populated).
      const initial = filters[def.name][value]
      if (initial && initial.length === 2) chart.setRangeSilent(initial)
    }

    // Selected count + top-5: shared upstream `source.intersect(dims)` so the
    // intersect dispatch dedups (matches() compares the dims arg) and one
    // membership-update cascade feeds both views.
    const active = source.intersect(dims).length()
    const total = source.length()
    const top5  = source.intersect(dims).limit(5)

    const renderCount = () => {
      if (statsEls.activeEl) statsEls.activeEl.textContent = (active[value] ?? 0).toLocaleString()
      if (statsEls.totalEl) statsEls.totalEl.textContent = (total[value] ?? 0).toLocaleString()
    }
    chains.push(active.tap(renderCount))
    chains.push(total.tap(renderCount))
    chains.push(top5.tap(() => renderTopList(statsEls.topListEl, top5[value] || [])))
    renderCount()
  },
}
