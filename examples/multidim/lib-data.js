// `data` row — the v3 engine: one reactive graph, and brushing is just a write.
// Each dimension is `between(col, filters.get(col))` — the bounds arg is a live
// child of ONE `filters` source, so a brush move is a single
// `filters.get(name).update(range)` and the update is an O(Δ) boundary walk
// (rows entering/leaving the window), never a re-aggregate. Each chart's
// histogram is an EXPLICIT leave-one-out `intersect(...otherDims)` — v3
// set-ops take view operands; the v2 `intersect(dimsObject, name)` object-map
// form throws at construction (v3/MIGRATION.md §3.8) — chained into
// `length(fn)`, which buckets incrementally into `{ value: N }` wrappers.
//
// Top-K shape: `active.za('delay', 5)` — a BOUNDED sort window maintained
// incrementally (v3/MIGRATION.md §3.4). The v2 file's trick — pre-sort the
// whole source by delay once at mount (`za('delay', Infinity)`) so that a
// cheap `intersect(dims).limit(5)` could read survivors off the front,
// because an unbounded za respliced O(active-set) per delta — is obsolete:
// v3's ordered maintenance keeps a bounded window in O(Δ), so the
// straightforward chain IS the fast chain.

import { $, value } from 'data' // bare entry = the v3 engine (v3/MIGRATION.md §6)
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
  version: '3.0.0',
  tag: 'incremental — reactive between bounds + leave-one-out intersect + length(fn) + bounded za',

  mount(chartsRoot, rawFlights, tracker, statsEls) {
    // Array-born source: rows get minted integer keys that flow through every
    // derivation — which is what lets the leave-one-out intersects match rows
    // across dims (v3 set algebra is by key, v3/MIGRATION.md §3.8). No
    // pre-sort — see the header; the bounded za below windows itself.
    const source = $(rawFlights)

    // One filter tuple per dimension, all in one reactive source; [] means
    // unfiltered. Each `between` takes `filters.get(name)` — a live child
    // handle — as its bounds, so brushing writes to `filters` and nothing
    // else. (The crossfilter-v3 idiom: examples/crossfilter-v3/main.js,
    // v3/MIGRATION.md §3.2.)
    const filters = $({
      delay:    [],
      distance: [],
      time:     [],
      date:     [],
    })
    const dims = {
      delay:    source.between('delay',    filters.get('delay')),
      distance: source.between('distance', filters.get('distance')),
      date:     source.between('date',     filters.get('date')),
      time:     source.between('time',     filters.get('time')),
    }

    // A chart counts flights passing every OTHER dimension's filter (so its
    // own brush never empties its own bars) — classic crossfilter, composed
    // explicitly from view operands (crossfilter-v3's `withoutDim`).
    const withoutDim = name =>
      Object.entries(dims).filter(([dim]) => dim !== name).map(([, view]) => view)

    // v3 references are STRONG — nothing unsubscribes by GC any more
    // (v3/MIGRATION.md §5.4). Stash every standing tap view and
    // SubscriptionHandle on the row so a future unmount can walk this and
    // dispose() the lot: a disposal manifest now, NOT the v2 WeakRef
    // GC-anchor hack this slot used to be.
    const chains = chartsRoot._chains = []

    for (const def of CHART_DEFS) {
      const chart = createChart(chartsRoot, def)
      const histogram = source.intersect(...withoutDim(def.name)).length(def.group)
      // y-scale: max over the `{ value: N }` bucket wrappers. Chaining an
      // aggregate directly over length(fn)'s buckets is the swarm-v3
      // precedent (its `some()` rides the same wrappers).
      const maxV = histogram.max('value')

      chart.onMarkInput = () => tracker.markInput()
      chart.onUpdate    = () => tracker.markUpdate()
      // Sync filter write — `.update()` on the bounds child is the v3 write
      // surface (v3/MIGRATION.md §2; the v2 `filters[name][value] = range`
      // form throws). We *could* coalesce with the child-handle writer
      // `filters.get(def.name).raf()` — crossfilter-v3 does, while dragging —
      // but each write here is ONE consolidated commit: between's O(Δ)
      // boundary walk + intersect O(Δ) + length(fn) O(Δ) + max over a few
      // hundred buckets + one post-settle tap effect, typically ~2-5ms.
      // The browser only paints at vsync, so extra commits between vsyncs
      // are overwritten anyway, and skipping the rAF wait keeps 5-10ms of
      // queueing "delay" out of the latency tracker that the user doesn't
      // actually perceive.
      chart.onRangeChange = (range) => { filters.get(def.name).update(range) }

      const update = () => {
        const buckets = histogram[value] || {}
        const flat = {}
        for (const k in buckets) flat[k] = buckets[k].value
        chart.setBars(flat, maxV[value] || 0)
      }
      // Tap the HISTOGRAM — not maxV, as the v2 row did. v3 scalars cut off
      // no-change emissions, so a brush that moves bars without moving the
      // peak would never republish maxV and the bars would go stale. A
      // parameterless tap fn fires ONCE per settled batch, as an effect
      // AFTER all operator state settles (v3/MIGRATION.md §3.10) — so the
      // maxV[value] read inside is already current, the same can't-lag-by-a-
      // commit guarantee crossfilter-v3 gets by deriving its peak inside
      // `to()`. tap also fires once at construction, so the bars seed
      // themselves — no manual first call.
      chains.push(histogram.tap(update))

      // Seed the brush from the initial filter, if one starts populated.
      const initial = filters.get(def.name)[value]
      if (initial && initial.length === 2) chart.setRangeSilent(initial)
    }

    // Selected count + top-5 share ONE full intersect — built once, chained
    // twice. (Explicit sharing through a const, the crossfilter-v3 `active`
    // idiom — no reliance on v2's matches() dedup.)
    const active = source.intersect(...Object.values(dims))
    const activeCount = active.length()
    const total = source.length()
    // Bounded top-5 by delay, maintained incrementally; [value] materializes
    // the window as an array in rank order (v3/MIGRATION.md §3.4) — exactly
    // the shape renderTopList wants.
    const top5 = active.za('delay', 5)

    const renderCount = () => {
      if (statsEls.activeEl) statsEls.activeEl.textContent = (activeCount[value] ?? 0).toLocaleString()
      if (statsEls.totalEl) statsEls.totalEl.textContent = (total[value] ?? 0).toLocaleString()
    }
    // connect(anchor, fn) is the verified scalar subscription (v3/MIGRATION.md
    // §3.5) — the anchor arg survives from v2's two-arg form but is only the
    // form discriminator now; lifetime belongs to the returned
    // SubscriptionHandle, which joins the disposal manifest. The sink emits
    // an initial whole-value record at connect time, so the counters seed
    // themselves too. (`total` never changes — the source never mutates —
    // but connecting it keeps the v2 row's shape.)
    chains.push(activeCount.connect(statsEls, renderCount))
    chains.push(total.connect(statsEls, renderCount))
    chains.push(top5.tap(() => renderTopList(statsEls.topListEl, top5[value] || [])))
  },
}
