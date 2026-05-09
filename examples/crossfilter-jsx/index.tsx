/** @jsx h */
/** @jsxFrag Fragment */
// @ts-nocheck
// JSX port of examples/crossfilter/. Same data flow, same brush logic, same
// reactive bindings — only the template is rewritten in JSX. Exercises the
// pieces the simpler todo-jsx port doesn't:
//   - SVG namespace dispatch (svg/path/rect/g/clipPath/line/text)
//   - reactive attribute values (rect width/x bound to ViewProxy filter ranges)
//   - mid-tree function children for imperative DOM wiring (the brush handler)
//   - dynamic per-key iteration for both static objects (the charts table) and
//     reactive views (flightsByDate groups)
// `data/full` re-exports JSX helpers alongside the core/HTML surface so we
// pull them all from a single bundle — see jsx/index.ts and full.ts for
// why cross-bundle imports would break NodeProxy `instanceof` checks.
import { $, render, value, h, Fragment } from 'data/full'

const data = await loadFlights()

const { min, max, floor } = Math
const { keys } = Object

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const pad = (d: string) => d.length === 1 ? ('0' + d) : d
const formatDistance = (d: any) => d === undefined ? undefined : d.toLocaleString() + ' mi.'
const formatChange = (d: any) => d === undefined ? undefined : (d < 0 ? '' : '+') + d + 'min.'
const formatTime = (d: any) => d === undefined ? undefined
  : pad('' + (d.getHours() % 12)) + ':' + pad('' + d.getMinutes()) +
    (d.getHours() > 12 ? ' PM' : ' AM')
const formatDate = (d: any) =>
  months[d.date.getMonth()] + ' ' + d.date.getDate() + ', ' + d.date.getFullYear()

const byDay = (d: any) => floor(d.date / 86400000) * 86400000
const byHour = (d: any) => floor(d.time)
const byTenMins = (d: any) => floor(d.delay / 10) * 10
const byFiftyMiles = (d: any) => floor(d.distance / 50) * 50

const source = $(data)
const flights = (window as any).flights = source.map(({ destination, origin, ...d }: any) => {
  const date = parseDate(d.date)
  const time = date.getHours() + date.getMinutes() / 60
  const delay = max(-60, min(149, d.delay))
  const distance = min(1999, d.distance)
  return { date, time, delay, distance, origin, destination }
}).za('date', Infinity)

const filters = (window as any).filters = $({
  delay: [],
  distance: [],
  time: [],
  date: [+new Date(2001, 1, 1), +new Date(2001, 2, 1)],
})

const dims: any = (window as any).dims = {
  delay:    flights.between('delay',    filters.delay),
  distance: flights.between('distance', filters.distance),
  date:     flights.between('date',     filters.date),
  time:     flights.between('time',     filters.time),
}
const active = (window as any).x = flights.intersect(dims)
;(window as any).v = value

const charts: any = (window as any).charts = {
  time: {
    title: 'Time of Day',
    data: flights.intersect(dims, 'time').length(byHour),
    domain: [0, 24], width: 240,
    ticks: [0, 5, 10, 15, 20], format: String,
  },
  delay: {
    title: 'Arrival Delay (min.)',
    data: flights.intersect(dims, 'delay').length(byTenMins),
    domain: [-60, 150], width: 210,
    ticks: [-60, -30, 0, 30, 60, 90, 120, 150], format: String,
  },
  distance: {
    title: 'Distance (mi.)',
    data: flights.intersect(dims, 'distance').length(byFiftyMiles),
    domain: [0, 2000], width: 400,
    ticks: [0, 500, 1000, 1500, 2000], format: String,
  },
  date: {
    title: 'Date',
    data: flights.intersect(dims, 'date').length(byDay),
    domain: [+new Date(2001, 0, 1), +new Date(2001, 3, 1)], width: 900,
    ticks: [+new Date(2001, 0, 1), +new Date(2001, 1, 1), +new Date(2001, 2, 1), +new Date(2001, 3, 1)],
    format: (t: any) => months[new Date(t).getMonth()],
    round: (t: any) => Math.round(t / 86400000) * 86400000,
  },
}

const flightsByDate = (window as any).ac =
  ((window as any).limit = active.limit(80)).group(formatDate)

render(document.body, (
  <body>
    <h1>crossfilter</h1>
    <h2>fast multidimensional filtering for coordinated views.</h2>
    <p>
      This page recreates Square's classic Crossfilter demo, but where the original ships a purpose-built multidimensional filter, here every chart, the data table, and the totals counter is a reactive view derived from the same flights source —{' '}
      <code>flights.between('delay', filters.delay).intersect(date, time).length(byHour)</code>
      {' '}and so on. Brushing a chart mutates a filter range; dependent views recompute incrementally and the DOM bindings catch up on their own, with no scheduler or manual invalidation. Click and drag on any chart below.
    </p>

    <aside>
      <span>{active.length()}</span>
      <span> of </span>
      <span>{flights.length()}</span>
      <span> flights selected.</span>
    </aside>

    <div id="charts">
      {/* `charts` is a static object, not a ViewProxy — Node.add stores it as
          `static`, then the parent generates one row per key calling `chart`
          as the row template. Same exact path the builder DSL uses for
          `div.chart(charts, chart)`. */}
      <div className="chart">{[charts, chart]}</div>
    </div>

    <div className="list">
      {/* flightsByDate is a ViewProxy (group output). Two nested data binds —
          outer over date groups, inner over flights within each group. The
          row fn returns a Fragment of children that the pre-shaped row node
          consumes; NodeProxy.apply auto-spreads the array so this is
          equivalent to multiple positional args. */}
      <div className="date">{[flightsByDate, (node: any, flights: any, day: any) => node(
        <Fragment>
          <div className="day">{day}</div>
          <div className="flight">{[flights, (node: any, flight: any) => node(
            <Fragment>
              <div className="time">{flight.date.to(formatTime)}</div>
              <div className="origin">{flight.origin}</div>
              <div className="destination">{flight.destination}</div>
              <div className="distance">{flight.distance.to(formatDistance)}</div>
              <div className="delay" class={{ early: flight.delay.to((d: any) => d < 0) }}>
                {flight.delay.to(formatChange)}
              </div>
            </Fragment>
          )]}</div>
        </Fragment>
      )]}</div>
    </div>

    <footer>
      Sample data:{' '}
      <a href="http://stat-computing.org/dataexpo/2009/">ASA Data Expo</a>
      {' '}(US domestic flights, January 2001).
    </footer>
  </body>
))

dismissLoader()

// When embedded in the landing page, post our content height to the parent so
// it can size the iframe to fit. Avoids a visible scrollbar and the "table
// cut off below the fold" problem.
if (window !== window.top) {
  let queued = false
  const post = () => {
    queued = false
    const h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
    window.parent.postMessage({ type: 'crossfilter-height', height: h }, '*')
  }
  const queue = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(post)
  }
  new ResizeObserver(queue).observe(document.body)
  window.addEventListener('load', queue)
}

// ---------------------------------------------------------------------------

function chart(node: any, c: any, name: string) {
  const { data, title, domain, width, ticks, format, round } = c
  const clipId = `clip-${name}`
  const clip_path = `url(#${clipId})`
  const margin = { top: 10, right: 10, bottom: 20, left: 10 }
  const height = 100
  const x = scale(domain, [0, width])
  const rx = scale([0, width], domain)
  const maxRef = data.max('value')
  const filter = filters[name]
  const range = filter.to(([lo = domain[0], hi = domain[1]] = []) => [lo, hi])
  const extent = range.to(([lo, hi]: any) => x(hi) - x(lo))
  const start = range[0].to((d: any) => x(d))
  const barPath = data.to(bars(maxRef, domain, width, name))
  const reset = () => (filters[name] = [])

  let exDown = false, exInitial = 0, exBase = [0, 0], exLeftRef = 0, exWrite: any

  // Two siblings under the chart row: the title block and the SVG. NodeProxy.apply
  // auto-spreads the Fragment, so this is equivalent to multiple positional args.
  return node(
    <Fragment>
      <div className="title">
        {title}
        <a className="reset"
           style={{ display: filter.to((f: any) => f?.length ? '' : 'none') }}
           onClick={reset}>reset</a>
      </div>
      <svg width={width + margin.left + margin.right}
           height={height + margin.top + margin.bottom}>
        <g transform="translate(10, 10)">
          <clipPath id={clipId}>
            <rect x={start} height={height} width={extent} />
          </clipPath>

          <path className="background bar" d={barPath} />
          <path className="foreground bar" d={barPath} clip-path={clip_path} />

          <g className="axis" transform={`translate(0, ${height})`}>
            <path className="domain" d={`M0.5,6V0.5H${width - 0.5}V6`} />
            {ticks.map((t: any) => (
              <g className="tick" transform={`translate(${x(t)}, 0)`}>
                <line y2={6} />
                <text y={9} dy=".71em" text-anchor="middle">{format(t)}</text>
              </g>
            ))}
          </g>

          {/* Brush: a `<g class="brush">` with a function-child that wires up
              the background pointer handlers, plus rect/resize children. The
              function-child compiles to a positional argument that Node.add
              treats as a row generator (sets node.fn) — Node.generate runs
              it on first render so `background(proxy, …)` extends the proxy
              with .on(...) calls. Identical to the builder's
              `g.brush(node => background(...))(rects...)` pattern. */}
          <g className="brush">
            {(n: any) => background(n, filter, rx, width, height, round)}
            <rect className="background" width={width} height={height} />
            <rect className="extent"
                  x={start} height={height}
                  width={filter.to((d: any) => d.length ? extent[value] : 0)}
                  onPointerDown={function (this: any, d: any) {
                    if (!filter[value]?.length) return
                    exDown = true
                    this.setPointerCapture(d.pointerId)
                    exLeftRef = this.parentNode.getBoundingClientRect().left
                    exInitial = rx(d.x - exLeftRef)
                    exBase = [filter.first()[value], filter.last()[value]]
                    exWrite = filter.raf()
                    d.stopPropagation()
                  }}
                  onPointerMove={function (this: any, d: any) {
                    if (!exDown) return
                    const cur = rx(d.x - exLeftRef)
                    const delta = cur - exInitial
                    const span = exBase[1] - exBase[0]
                    let lo = exBase[0] + delta
                    let hi = exBase[1] + delta
                    if (lo < domain[0]) { lo = domain[0]; hi = lo + span }
                    else if (hi > domain[1]) { hi = domain[1]; lo = hi - span }
                    if (round) { lo = round(lo); hi = round(hi) }
                    exWrite([lo, hi])
                  }}
                  onPointerUp={function (this: any, d: any) {
                    exDown = false
                    this.releasePointerCapture?.(d.pointerId)
                    exWrite?.flush()
                  }} />
            {[0, 1].map(resizeHandle(filter, domain, x, rx, round))}
          </g>
        </g>
      </svg>
    </Fragment>
  )
}

function background(node: any, filter: any, rx: any, width: number, height: number, round: any) {
  let down = false
  let initial: any
  let write: any
  const c = (el: any, { x }: any) => rx(x - el.getBoundingClientRect().left)
  const apply = round || ((v: any) => v)

  return node
    .on('pointerdown', function (this: any, d: any) {
      down = true
      initial = apply(c(this, d))
      write = filter.raf()
      filter[value] = [initial, initial]
    })
    .on('pointermove', function (this: any, d: any) {
      if (down) {
        const new_val = apply(c(this, d))
        write(new_val > initial ? [initial, new_val] : [new_val, initial])
      }
    })
    .on('pointerup', (d: any) => {
      down = false
      write?.flush()
      if (filter.first()[value] === filter.last()[value]) filter[value] = []
    })
}

function resizeHandle(filtersArr: any, initial: any, x: any, rx: any, round: any) {
  return function (i: number) {
    let down = false
    let write: any
    let leftRef = 0
    const translate = (d = initial[i]) => `translate(${x(d)}, 0)`
    const filter = filtersArr[i]
    const apply = round || ((v: any) => v)
    const height = 100
    const classes = ['w', 'e']
    const d = i ? 1 : -1
    const y = height / 3
    const resizePath = 'M' + (.5 * d) + ',' + y
      + 'A6,6 0 0 ' + i + ' ' + (6.5 * d) + ',' + (y + 6)
      + 'V' + (2 * y - 6)
      + 'A6,6 0 0 ' + i + ' ' + (.5 * d) + ',' + (2 * y)
      + 'Z'
      + 'M' + (2.5 * d) + ',' + (y + 8) + 'V' + (2 * y - 8)
      + 'M' + (4.5 * d) + ',' + (y + 8) + 'V' + (2 * y - 8)

    return (
      <g class={`resize ${classes[i]}`}
         transform={filter.to(translate)}
         style={{ display: filter.to((d: any) => d ? '' : 'none') }}
         onPointerDown={function (this: any, ev: any) {
           down = true
           this.setPointerCapture(ev.pointerId)
           leftRef = this.parentNode.getBoundingClientRect().left
           write = filtersArr.raf()
           ev.stopPropagation()
         }}
         onPointerMove={function (this: any, e: any) {
           if (!down) return
           const cur = apply(rx(e.x - leftRef))
           const other = filtersArr[1 - i][value]
           write(cur < other ? [cur, other] : [other, cur])
         }}
         onPointerUp={function (this: any, ev: any) {
           down = false
           this.releasePointerCapture?.(ev.pointerId)
           write?.flush()
         }}>
        <rect x={-3} width={6} height={height} style={{ visibility: 'hidden' }} />
        <path d={resizePath} />
      </g>
    )
  }
}

function parseDate(d: string) {
  return new Date(2001,
    +d.substring(0, 2) - 1,
    +d.substring(2, 4),
    +d.substring(4, 6),
    +d.substring(6, 8))
}

// SVG bar path. Same shape as the existing crossfilter — `groups` is the
// length-by-bucket output; we read groups[i].value for each bucket.
function bars(maxRef: any, domain: any, width: number, name: string) {
  return function (groups: any) {
    if (maxRef[value] === undefined) return ''
    const height = 100
    const x = scale(domain, [0, width])
    const y = scale([0, maxRef[value]], [height, 0])
    let path = ''
    for (const i in groups) {
      const len = groups[i].value
      path += `M${x(+i)},${height}V${y(len)}h9V${height}`
    }
    return path
  }
}

function scale(i: number[], o: number[]) {
  return function (v: number) {
    if (i[1] === i[0]) return 0
    const irange = i[1] - i[0]
    const orange = o[1] - o[0]
    const m = (v - i[0]) / irange
    return o[0] + m * orange
  }
}

async function loadFlights() {
  const loader = document.getElementById('loader') as any
  const $bar = loader?.querySelector('.loader-bar-fill')
  const $pct = loader?.querySelector('.loader-pct')
  const $bytes = loader?.querySelector('.loader-bytes')
  const $rate = loader?.querySelector('.loader-rate')
  const $stat = loader?.querySelector('.loader-status')
  const fmtMB = (b: number) => (b / 1048576).toFixed(1)

  const t0 = performance.now()
  const res = await fetch('../crossfilter/flights.js')
  const total = +res.headers.get('Content-Length')! || 37313858

  if (!res.body || !res.body.getReader) {
    const text = await res.text()
    if ($bar) $bar.style.width = '100%'
    if ($pct) $pct.textContent = '100%'
    if ($bytes) $bytes.textContent = `${fmtMB(total)} / ${fmtMB(total)} MB`
    const url = URL.createObjectURL(new Blob([text], { type: 'application/javascript' }))
    const { data } = await import(url)
    URL.revokeObjectURL(url)
    return data
  }

  const reader = res.body.getReader()
  const chunks: any[] = []
  let received = 0

  while (true) {
    const { done, value: chunk } = await reader.read()
    if (done) break
    chunks.push(chunk)
    received += chunk.byteLength
    const pct = received / total
    const elapsed = (performance.now() - t0) / 1000
    if ($bar) $bar.style.width = `${(pct * 100).toFixed(1)}%`
    if ($pct) $pct.textContent = `${(pct * 100) | 0}%`
    if ($bytes) $bytes.textContent = `${fmtMB(received)} / ${fmtMB(total)} MB`
    if ($rate) $rate.textContent = elapsed > 0.05 ? `${fmtMB(received / elapsed)} MB/s` : '…'
  }

  if ($bar) $bar.style.width = '100%'
  if ($pct) $pct.textContent = '100%'
  if ($stat) $stat.textContent = 'parsing'
  await new Promise(r => requestAnimationFrame(r))

  const url = URL.createObjectURL(new Blob(chunks, { type: 'application/javascript' }))
  const { data } = await import(url)
  URL.revokeObjectURL(url)
  return data
}

function dismissLoader() {
  const loader = document.getElementById('loader')
  if (!loader) return
  loader.classList.add('done')
  setTimeout(() => loader.remove(), 360)
}
