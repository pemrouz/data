// Per-engine child of crossfilter-example.bench.ts — the crossfilter EXAMPLE
// workload (the real 231,083-row flights dataset, the example's real operator
// graph) built on ONE engine per process. Run only via the orchestrator:
//   node --experimental-strip-types --no-warnings --expose-gc \
//     v3/perf/crossfilter-example.bench.ts
//
// METHODOLOGY (inherited from m2-gate.ts — the three rules there each fixed a
// wrong verdict; do not regress them):
// 1. Every measured write is REAL: brush tuples are MONOTONIC within a sweep
//    (lo advances by a fixed stride) and carry a per-pass sub-stride offset so
//    no tuple ever repeats across the 10 warmup passes + the measured pass —
//    a repeated tuple would hit the engines' Object.is/equal-bounds no-op
//    guards and measure fiction.
// 2. One ENGINE per PROCESS: v2 and v3 sharing a process cross-pollute
//    builtin-access inline caches and shift ratios — an artifact real
//    deployments (one engine) never see. The parent spawns v2/v3 ABAB.
// 3. Deep warmup (10 full sweep passes at distinct offsets) before the
//    measured pass so fresh-process children reach top JIT tier; gc() before
//    each measured sweep — NOT per step (steps are sub-ms; per-step gc would
//    dominate) — then per-step times reported as median + p95, and the parent
//    takes the median of per-replicate v3/v2 ratios.
// 4. The 36MB flights.js import/parse and the engine-module import are
//    EXCLUDED from every measurement; setup_ms times only the graph build
//    from the already-parsed raw object. NOTE v2's za('date', Infinity)
//    full sort is PART of v2 setup — that is the honest example cost; the v3
//    graph carries no full sort.
//
// CHECKSUM: each measured step accumulates (step+1) * (active count +
// per-chart bucket-count sums) — cross-engine comparable (same rows selected
// implies equality). The 80-row list/days read is accumulated separately in
// `extra` and NOT compared: v2's limit(80) picks the first 80 in iteration
// order; v3's za('date', 80) is the true top-80 by date — they legitimately
// differ. Bars-path lengths also live in `extra` (they hinge on max-read
// timing mid-cascade, an intentionally engine-internal ordering).
//
// Env: FLIGHTS_N=<n> slices the first n rows (dev iteration); default full.
// Output: ONE JSON line on stdout (the orchestrator parses the last line).

type Raw = { date: string; delay: string; distance: string; origin: string; destination: string }
type Row = {
  date: Date
  time: number
  delay: number
  distance: number
  origin: string
  destination: string
}

const mode = process.argv[2]
if (mode !== 'v2' && mode !== 'v3') {
  console.error('usage: crossfilter-example.child.ts <v2|v3>')
  process.exit(2)
}

declare const gc: (() => void) | undefined
const gcSync = typeof gc === 'function' ? gc : null

const { max: mmax, min: mmin, floor } = Math

// ── shared parse — identical for both engines (the example's map fn) ─────────

function parseDate(s: string): Date {
  return new Date(
    2001,
    Number(s.substring(0, 2)) - 1,
    Number(s.substring(2, 4)),
    Number(s.substring(4, 6)),
    Number(s.substring(6, 8)),
  )
}

function parseRow(d: Raw): Row {
  const date = parseDate(d.date)
  const time = date.getHours() + date.getMinutes() / 60
  const delay = mmax(-60, mmin(149, d.delay as unknown as number)) // string coerces, as in the example
  const distance = mmin(1999, d.distance as unknown as number)
  return { date, time, delay, distance, origin: d.origin, destination: d.destination }
}

// ── the example's grouping / format helpers ───────────────────────────────────

const byDay = (d: Row) => floor(+d.date / 86400000) * 86400000
const byHour = (d: Row) => floor(d.time)
const byTenMins = (d: Row) => floor(d.delay / 10) * 10
const byFiftyMiles = (d: Row) => floor(d.distance / 50) * 50

const months = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const formatDate = (d: Row) =>
  months[d.date.getMonth()] + ' ' + d.date.getDate() + ', ' + d.date.getFullYear()

// poor man's linear scale + the example's bars() path builder (models the real
// per-frame render-input work — the SVG path string each chart hands the DOM)
function scale(i: readonly [number, number], o: readonly [number, number]): (v: number) => number {
  return function (v: number): number {
    if (i[1] === i[0]) return 0
    return o[0] + ((v - i[0]) / (i[1] - i[0])) * (o[1] - o[0])
  }
}

function bars(readMax: () => unknown, domain: readonly [number, number], width: number) {
  return function (groups: any): string {
    const m = readMax() as number | undefined
    if (m === undefined) return ''
    const height = 100
    const x = scale(domain, [0, width])
    const y = scale([0, m], [height, 0])
    let path = ''
    for (const i in groups) {
      const len = groups[i].value
      path += `M${x(+i)},${height}V${y(len)}h9V${height}`
    }
    return path
  }
}

const CHART_NAMES = ['time', 'delay', 'distance', 'date'] as const
const CHART_META: Record<string, { domain: readonly [number, number]; width: number }> = {
  time: { domain: [0, 24], width: 240 },
  delay: { domain: [-60, 150], width: 210 },
  distance: { domain: [0, 2000], width: 400 },
  date: { domain: [+new Date(2001, 0, 1), +new Date(2001, 3, 1)], width: 900 },
}

// ── engines ───────────────────────────────────────────────────────────────────

interface EngineApp {
  write(dim: 'date' | 'delay', lo: number, hi: number): void
  readCmp(): number // cross-engine comparable: active count + per-chart bucket sums
  readExtra(): number // NOT compared: bars path lengths + list/days row count
  keep: unknown[] // strong refs to every view (v2 sinks are WeakRef'd)
}

// The v2 example graph, verbatim (examples/crossfilter/index.html):
//   $(data).map(parse).za('date', Infinity) → between×4 (reactive bounds) →
//   intersect(dims) / intersect(dims, name).length(bucketFn) → max/to(bars) →
//   limit(80).group(formatDate) + length()
function buildV2(mod: any, raw: Record<string, Raw>): EngineApp {
  const { $, value } = mod
  const source = $(raw)
  const flights = source.map(parseRow).za('date', Infinity)
  const filters = $({
    delay: [],
    distance: [],
    time: [],
    date: [+new Date(2001, 1, 1), +new Date(2001, 2, 1)],
  })
  const dims = {
    delay: flights.between('delay', filters.delay),
    distance: flights.between('distance', filters.distance),
    date: flights.between('date', filters.date),
    time: flights.between('time', filters.time),
  }
  const active = flights.intersect(dims)
  const chartData: Record<string, any> = {
    time: flights.intersect(dims, 'time').length(byHour),
    delay: flights.intersect(dims, 'delay').length(byTenMins),
    distance: flights.intersect(dims, 'distance').length(byFiftyMiles),
    date: flights.intersect(dims, 'date').length(byDay),
  }
  const chartMax: Record<string, any> = {}
  const chartBars: Record<string, any> = {}
  for (const name of CHART_NAMES) {
    const meta = CHART_META[name]
    const mx = chartData[name].max('value')
    chartMax[name] = mx
    chartBars[name] = chartData[name].to(bars(() => mx[value], meta.domain, meta.width))
  }
  const list = active.limit(80).group(formatDate)
  const total = active.length()
  // perf-trap note: v2 proxy reads cost — scalars are read via x[value] once
  // per step into locals inside readCmp/readExtra.
  const fDate = filters.date
  const fDelay = filters.delay
  return {
    write(dim: 'date' | 'delay', lo: number, hi: number): void {
      // whole-tuple write — exactly what the example's raf writer commits
      if (dim === 'date') fDate[value] = [lo, hi]
      else fDelay[value] = [lo, hi]
    },
    readCmp(): number {
      let s = total[value] as number
      for (const name of CHART_NAMES) {
        const groups = chartData[name][value]
        for (const i in groups) s += groups[i].value
      }
      return s
    },
    readExtra(): number {
      let e = 0
      for (const name of CHART_NAMES) e += (chartBars[name][value] as string).length
      const days = list[value]
      for (const day in days) e += Object.keys(days[day]).length
      return e
    },
    keep: [source, flights, filters, dims, active, chartData, chartMax, chartBars, list, total],
  }
}

// The migrated v3 graph: NO za(Infinity) full sort (v3 doesn't need one);
// between binds the reactive bounds leaf via filters.get(dim) (betweenR —
// v3/ops/reactive.ts); charts use explicit leave-one-out intersects; the list
// is a bounded za('date', 80) window (the true top-80 by date) grouped by day.
function buildV3(mod: any, raw: Record<string, Raw>): EngineApp {
  const { $, value } = mod
  const flights = $(raw).map(parseRow)
  const filters = $({
    delay: [],
    distance: [],
    time: [],
    date: [+new Date(2001, 1, 1), +new Date(2001, 2, 1)],
  })
  const dims: Record<string, any> = {
    delay: flights.between('delay', filters.get('delay')),
    distance: flights.between('distance', filters.get('distance')),
    date: flights.between('date', filters.get('date')),
    time: flights.between('time', filters.get('time')),
  }
  const active = flights.intersect(dims.delay, dims.distance, dims.date, dims.time)
  const others = (name: string) =>
    Object.entries(dims).filter(([k]) => k !== name).map(([, v]) => v)
  const chartData: Record<string, any> = {
    time: flights.intersect(...others('time')).length(byHour),
    delay: flights.intersect(...others('delay')).length(byTenMins),
    distance: flights.intersect(...others('distance')).length(byFiftyMiles),
    date: flights.intersect(...others('date')).length(byDay),
  }
  const chartMax: Record<string, any> = {}
  const chartBars: Record<string, any> = {}
  for (const name of CHART_NAMES) {
    const meta = CHART_META[name]
    const mx = chartData[name].max('value')
    chartMax[name] = mx
    chartBars[name] = chartData[name].to(bars(() => mx[value], meta.domain, meta.width))
  }
  const recent = active.za('date', 80) // bounded window replaces limit(80)-over-iteration-order
  const byDay2 = recent.group(formatDate)
  const firstDate = (bucket: any) => +(Object.values(bucket)[0] as Row).date
  const days = byDay2.za((a: any, b: any) => firstDate(a) - firstDate(b))
  const total = active.length()
  return {
    write(dim: 'date' | 'delay', lo: number, hi: number): void {
      filters.set(dim, [lo, hi])
    },
    readCmp(): number {
      let s = total[value] as number
      for (const name of CHART_NAMES) {
        const groups = chartData[name][value] // materialized bucket map
        for (const i in groups) s += groups[i].value
      }
      return s
    },
    readExtra(): number {
      let e = 0
      for (const name of CHART_NAMES) e += (chartBars[name][value] as string).length
      const dayBuckets = days[value] as any[] // ordered array of buckets
      for (const b of dayBuckets) e += Object.keys(b).length
      return e
    },
    keep: [flights, filters, dims, active, chartData, chartMax, chartBars, recent, byDay2, days, total],
  }
}

// ── sweeps ────────────────────────────────────────────────────────────────────

interface SweepSpec {
  dim: 'date' | 'delay'
  domain: readonly [number, number]
  width: number
  steps: number
}

// date: ~10-day window, lo advancing across Jan–Mar 2001 (the data's span)
const DATE_SWEEP: SweepSpec = {
  dim: 'date',
  domain: [+new Date(2001, 0, 1), +new Date(2001, 3, 1)],
  width: 10 * 86400000,
  steps: 90,
}
// delay: 30-minute window across the example's [-60, 150] delay domain
const DELAY_SWEEP: SweepSpec = { dim: 'delay', domain: [-60, 150], width: 30, steps: 90 }

interface Acc {
  checksum: number
  extra: number
}

// One full sweep pass. `pass` shifts every tuple by pass*(stride/16) so no
// tuple ever repeats across the 10 warmup passes + the measured pass (rule 1).
function runSweep(app: EngineApp, spec: SweepSpec, pass: number, measured: boolean, acc: Acc): number[] {
  const span = spec.domain[1] - spec.domain[0]
  const stride = (span - spec.width) / spec.steps
  const offset = (stride / 16) * pass
  const times: number[] = []
  for (let i = 0; i < spec.steps; i++) {
    const lo = spec.domain[0] + offset + stride * i
    const hi = lo + spec.width
    if (measured) {
      const t0 = performance.now()
      app.write(spec.dim, lo, hi)
      const cmp = app.readCmp()
      const extra = app.readExtra()
      times.push(performance.now() - t0)
      acc.checksum += (i + 1) * cmp
      acc.extra += extra
    } else {
      // warmup exercises the identical write+read path (JIT parity), but
      // never touches the checksum (measured steps only)
      app.write(spec.dim, lo, hi)
      app.readCmp()
      app.readExtra()
    }
  }
  return times
}

function med(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[s.length >> 1]
}
function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]
}

// ── main ──────────────────────────────────────────────────────────────────────

// Dataset import/parse — EXCLUDED from all measurements (rule 4).
const flightsUrl = new URL('../../examples/crossfilter/flights.js', import.meta.url)
const { data: fullData } = await import(flightsUrl.href)
let raw: Record<string, Raw> = fullData
const envN = process.env.FLIGHTS_N
if (envN !== undefined && envN !== '') {
  const n = Number(envN)
  const sliced: Record<string, Raw> = {}
  for (let i = 0; i < n; i++) {
    const r = fullData[String(i)]
    if (r === undefined) break
    sliced[String(i)] = r
  }
  raw = sliced
}
const nRows = Object.keys(raw).length

// Engine-module import — also excluded from setup_ms.
const engineMod = mode === 'v2' ? await import('../../index.ts') : await import('../api/index.ts')

// setup: build the whole graph from the already-parsed raw object; record the
// end-of-setup RSS delta (informational memory — retained graph state).
gcSync?.()
const rss0 = process.memoryUsage().rss
const tSetup = performance.now()
const app = mode === 'v2' ? buildV2(engineMod, raw) : buildV3(engineMod, raw)
const setupMs = performance.now() - tSetup
gcSync?.()
const rss1 = process.memoryUsage().rss

const acc: Acc = { checksum: 0, extra: 0 }
const WARMUP_PASSES = 10

// brush_date: 10 warmup passes at distinct offsets, gc, then the measured pass
for (let p = 0; p < WARMUP_PASSES; p++) runSweep(app, DATE_SWEEP, p, false, acc)
gcSync?.()
const dateTimes = runSweep(app, DATE_SWEEP, WARMUP_PASSES, true, acc)

// brush_delay: same shape over the delay dimension (the date filter stays at
// its final measured position — deterministic and identical in both engines)
for (let p = 0; p < WARMUP_PASSES; p++) runSweep(app, DELAY_SWEEP, p, false, acc)
gcSync?.()
const delayTimes = runSweep(app, DELAY_SWEEP, WARMUP_PASSES, true, acc)

if (app.keep.length === 0) throw new Error('unreachable — keep retains the graph')

console.log(
  JSON.stringify({
    mode,
    rows: nRows,
    setup_ms: setupMs,
    rss_delta_mb: (rss1 - rss0) / 1048576,
    brush_date: { median_ms: med(dateTimes), p95_ms: p95(dateTimes) },
    brush_delay: { median_ms: med(delayTimes), p95_ms: p95(delayTimes) },
    checksum: acc.checksum,
    extra: acc.extra,
  }),
)
