// @ts-nocheck
import { ok } from 'node:assert'
import { $, value } from './full.ts'
import { test } from 'node:test'
import { data as flights500 } from './examples/crossfilter/flights500.js'
import { data as flights50000 } from './examples/crossfilter/flights50000.js'
import { gateMeasure as measure } from './perf/measure.ts'

const { min, max, floor } = Math

function deterministicRandom(o) {
  return 1 + Object.keys(o).map(Number).sort((a, b) => a - b).reduce((acc, k) => k > acc ? k : acc, -1)
}

function parseDate(d: string) {
  return new Date(2001,
    +d.substring(0, 2) - 1,
    +d.substring(2, 4),
    +d.substring(4, 6),
    +d.substring(6, 8)
  )
}

const byDay = d => floor(+d.date / 86400000) * 86400000
const byHour = d => floor(d.time)
const byTenMins = d => floor(d.delay / 10) * 10
const byFiftyMiles = d => floor(d.distance / 50) * 50
const formatDate = d => `${d.date.getMonth()}-${d.date.getDate()}-${d.date.getFullYear()}`

function buildGraph(data) {
  $.random = deterministicRandom

  const source = $(data)
  const flights = source.map(({ destination, origin, ...d }) => {
    const date = parseDate(d.date)
    const time = date.getHours() + date.getMinutes() / 60
    const delay = max(-60, min(149, +d.delay))
    const distance = min(1999, +d.distance)
    return { date, time, delay, distance, origin, destination }
  }).za('date', Infinity)

  const filters = $({
    delay: [],
    distance: [],
    time: [],
    date: [+new Date(2001, 0, 2), +new Date(2001, 2, 1)],
  })

  const byDelay = flights.between('delay', filters.delay)
  const byDistance = flights.between('distance', filters.distance)
  const byDate = flights.between('date', filters.date)
  const byTime = flights.between('time', filters.time)
  const active = byDate.intersect(byDistance, byDelay, byTime)

  const charts = {
    time: byDelay.intersect(byDistance, byDate).length(byHour),
    delay: byDistance.intersect(byDate, byTime).length(byTenMins),
    distance: byDelay.intersect(byDate, byTime).length(byFiftyMiles),
    date: byDelay.intersect(byDistance, byTime).length(byDay),
  }

  const list = active.limit(40).group(formatDate)

  return { flights, filters, active, charts, list }
}

function readViews({ active, charts, list }) {
  void active[value]
  void charts.time[value]
  void charts.delay[value]
  void charts.distance[value]
  void charts.date[value]
  void list[value]
}

// ── setup benchmarks ──────────────────────────────────────────────────────────

test('crossfilter setup - 500 flights', () => {
  const elapsed = measure(() => buildGraph(flights500))
  console.log(`  setup 500: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 200, `setup took ${elapsed.toFixed(2)}ms, threshold 200ms`)
})

test('crossfilter setup - 50000 flights', () => {
  const elapsed = measure(() => buildGraph(flights50000))
  console.log(`  setup 50000: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 5000, `setup took ${elapsed.toFixed(2)}ms, threshold 5000ms`)
})

// ── filter update benchmarks ──────────────────────────────────────────────────

test('crossfilter filter update - 500 flights', () => {
  const graph = buildGraph(flights500)
  let toggle = false
  const elapsed = measure(() => {
    toggle = !toggle
    graph.filters.delay[value] = toggle ? [-10, 60] : []
    readViews(graph)
  })
  console.log(`  filter update 500: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 50, `filter update took ${elapsed.toFixed(2)}ms, threshold 50ms`)
})

test('crossfilter filter update - 50000 flights', () => {
  const graph = buildGraph(flights50000)
  let toggle = false
  const elapsed = measure(() => {
    toggle = !toggle
    graph.filters.delay[value] = toggle ? [-10, 60] : []
    readViews(graph)
  })
  console.log(`  filter update 50000: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500, `filter update took ${elapsed.toFixed(2)}ms, threshold 500ms`)
})

// ── multi-filter update benchmark ────────────────────────────────────────────

// ── brush drag simulation ────────────────────────────────────────────────────
// Mimics 60 sequential pointermove events on the date brush — the real
// interactive workload that LimitValue rebuilds and intersect cascades hit.

test('crossfilter brush drag - 500 flights, 60 frames', () => {
  const graph = buildGraph(flights500)
  const start = +new Date(2001, 0, 5)
  const end = +new Date(2001, 1, 25)
  const elapsed = measure(() => {
    for (let i = 0; i < 60; i++) {
      const t = i / 59
      graph.filters.date[value] = [start, start + (end - start) * t]
      readViews(graph)
    }
  }, 3)
  console.log(`  brush drag 500 (60 frames): ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 500, `brush drag took ${elapsed.toFixed(2)}ms, threshold 500ms`)
})

// Slow-drag: 200 small filter increments. Each frame's batch is below the
// LimitValue large-batch threshold so the incremental path is exercised.
test('crossfilter slow brush - 50000 flights, 200 frames small deltas', () => {
  const graph = buildGraph(flights50000)
  // start narrow and widen by ~3 hours per frame
  const anchor = +new Date(2001, 0, 15)
  const elapsed = measure(() => {
    for (let i = 0; i < 200; i++) {
      const halfHours = i * 3
      graph.filters.date[value] = [anchor - halfHours * 3600 * 1000, anchor + halfHours * 3600 * 1000]
      readViews(graph)
    }
  }, 3)
  console.log(`  slow brush 50000 (200 frames): ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 5000, `slow brush took ${elapsed.toFixed(2)}ms, threshold 5000ms`)
})

test('crossfilter brush drag - 50000 flights, 60 frames', () => {
  const graph = buildGraph(flights50000)
  const start = +new Date(2001, 0, 5)
  const end = +new Date(2001, 1, 25)
  const elapsed = measure(() => {
    for (let i = 0; i < 60; i++) {
      const t = i / 59
      graph.filters.date[value] = [start, start + (end - start) * t]
      readViews(graph)
    }
  }, 3)
  console.log(`  brush drag 50000 (60 frames): ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 5000, `brush drag took ${elapsed.toFixed(2)}ms, threshold 5000ms`)
})

test('crossfilter multi-filter update - 500 flights', () => {
  const graph = buildGraph(flights500)
  let toggle = false
  const elapsed = measure(() => {
    toggle = !toggle
    if (toggle) {
      graph.filters.delay[value] = [-10, 60]
      graph.filters.distance[value] = [200, 1000]
      graph.filters.time[value] = [6, 20]
      graph.filters.date[value] = [+new Date(2001, 0, 15), +new Date(2001, 1, 15)]
    } else {
      graph.filters.delay[value] = []
      graph.filters.distance[value] = []
      graph.filters.time[value] = []
      graph.filters.date[value] = [+new Date(2001, 0, 2), +new Date(2001, 2, 1)]
    }
    readViews(graph)
  })
  console.log(`  multi-filter update 500: ${elapsed.toFixed(2)}ms`)
  ok(elapsed < 100, `multi-filter update took ${elapsed.toFixed(2)}ms, threshold 100ms`)
})

// patch() — the batched-cascade built-in. Its whole reason to exist is collapsing
// N per-row dispatches into ONE walk per sink (CLAUDE.md / the swarm example). A
// regression that re-fans-out patch into N dispatches is otherwise invisible.
// The honest, machine-independent guard counts DISPATCHES — not change records
// (patch still emits one record per changed row; it saves dispatch, not records).
// A bare tap(() => …) fires its fn exactly once per batched emit, so it counts
// the walks: patch([...M]) -> 1, M individual sets -> M.
test('patch - one dispatch per sink for a batched update', () => {
  const N = 5000, M = 500
  const seed = {}
  for (let i = 0; i < N; i++) seed[i] = { v: i }
  const src = $(seed)
  let dispatches = 0
  const tapView = src.tap(() => { dispatches++ }) // bare tap: one fn call per batched emit
  tapView.connect([]) // keep the chain alive (sinks are WeakRef-held)

  const pairs = []
  for (let i = 0; i < M; i++) { pairs.push(String(i)); pairs.push({ v: i + 1 }) }
  dispatches = 0
  src.patch(pairs)
  const patchDispatches = dispatches

  dispatches = 0
  for (let i = 0; i < M; i++) src[i].v = i + 2
  const loopDispatches = dispatches

  console.log(`  patch dispatches: ${patchDispatches} (vs ${loopDispatches} for ${M} individual sets)`)
  ok(patchDispatches === 1, `patch fanned out to ${patchDispatches} dispatches, expected 1`)
  ok(loopDispatches === M, `${M} sets produced ${loopDispatches} dispatches, expected ${M}`)
})

test('patch - batched throughput, M=500 in N=5000', () => {
  const N = 5000, M = 500
  const seed = {}
  for (let i = 0; i < N; i++) seed[i] = { v: i }
  const src = $(seed)
  const keep = src.tap(() => {}) // a real downstream so dispatch cost is exercised
  keep.connect([])
  let k = 1000
  const patchMs = measure(() => {
    const pairs = []
    for (let i = 0; i < M; i++) { pairs.push(String(i)); pairs.push({ v: k++ }) }
    src.patch(pairs)
  })
  const loopMs = measure(() => { for (let i = 0; i < M; i++) src[i].v = k++ })
  console.log(`  patch ${M}/${N}: ${patchMs.toFixed(2)}ms (vs ${loopMs.toFixed(2)}ms individual)`)
  ok(patchMs < 50, `patch ${M} took ${patchMs.toFixed(2)}ms, threshold 50ms`)
})
