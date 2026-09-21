/* sections/race/brush.js — the brushing card on the REAL engine (stage 3, variant d).
 *
 * The old multidim data lane (ref/multidim/lib-data.js), re-shaped for v4:
 *   source  = $(flights)                                   array-born, minted int keys
 *   filters = $({ time: [], delay: [], distance: [], date: [] })
 *   dims.X  = source.between(X, filters.get(X))             reactive bounds — a brush is
 *                                                           ONE filters.get(X).update([lo, hi])
 *   hist.X  = source.intersect(...the other three dims).length(binX)   leave-one-out
 *   active  = source.intersect(all four dims);  count = active.length()
 * A brush write lands as two synchronous commits inside update() — the filters commit,
 * whose effect (the reactive-arg binder) writes the between's hidden bounds source, then
 * the bounds commit: between's O(Δ) boundary walk → the intersects → the histograms →
 * the taps. performance.now() around update() is therefore the whole settle, effects
 * included; that is the ms/brush figure. The histograms' bars are the buckets' values
 * (`{ [bucket]: { value: N } }` wrappers, read AFTER the write returns); the readout is
 * count[value] and source.rowCount().
 *
 * The drag writes on EVERY pointer move: the bound is the pointer's position snapped to
 * the column's value resolution (a minute of the hour, a unit of delay / distance, a
 * minute of the date) — never to a bin. Bin-snapped steps (the picked look's original)
 * made every step a whole-bin jump — ~13k rows (6% of N) on the busy hours, the walkers'
 * break-even against an O(Δ) engine; a per-pixel step crosses ~1k rows. The band is drawn
 * where the pointer is.
 *
 * Everything heavy is handed back to the caller as STEPS (label + fn) to run one per
 * frame behind the progress line — each is the real constructor walk over N rows, or
 * one measured commit. The four "indexing" steps are one bounds update() per
 * dimension: between builds its sorted index lazily on the first bounds walk, so
 * without them the visitor's FIRST brush on each chart would pay an O(N log N) sort.
 * The three unseeded dims are written their column's DOMAIN [d0, d1] (every row lies
 * inside it, so zero rows cross — but the bounds differ from the constructed (−∞, ∞),
 * so the walk runs and sorts; a null / [] write is (−∞, ∞) again and between returns
 * before its lazy sort, leaving the index unbuilt); the seeded dim's lower bound is
 * moved half a value resolution out and back (no row lies in that gap). None emits a
 * row delta (the driver asserts count === rowCount / the seeded count afterwards) and
 * none is counted as a brush — and a later reset / plain click on an unbrushed chart
 * is the same-bounds skip, never a counted no-op.
 *
 * The PEER slot (race/brush-peers.js): the carousel mounts the selected library's own
 * brushing lane here — built over the same adopted rows, seeded with the bounds data
 * holds. data's write always runs first (its ms keeps feeding the data-baseline
 * session); then, with a peer mounted, the SAME bounds go through the peer in an
 * identical performance.now() window — brush(), the forced read of its four
 * histograms and its count — and the charts draw from the peer's dense bins, the
 * readout from its count. Each peer keeps its own session (samples, p50 / p95 / n)
 * for the page's life, plus data's ms for the same brushes (the "data p50 · N×"
 * line); lockstep() compares the peer's count and all four histograms with data's.
 * Nothing in this file prints a number; the caller attests what it reads. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr']
const DAY = 86400000
const JAN1 = Date.UTC(2001, 0, 1)
// one bucketing formula per dimension: bucket(value) is what crossfilter's group key takes,
// bin(row) is what data's length(bin) and the peers' walks take — the same function.
// res = the column's value resolution (time = hh + mm/60, delay / distance integers, date whole
// minutes in ms): no two values lie closer, so a bound moved by HALF of it crosses no row —
// the seeded dim's indexing step and crossfilter's [lo, hi) nudge both lean on that.
// snap(v) = the pointer's value on that grid, by the worker's own formulas (time = hh + mi/60,
// date = whole minutes) so a bound is bit-identical to the rows' values — data's inclusive
// [lo, hi] and crossfilter's [lo, hi + res/2) then select the same rows for any bound
const dim = (name, bucket, rest) => ({ name, bucket, bin: t => bucket(t[name]), ...rest })
export const DEFS = [
  dim('time', v => Math.floor(v), { title: 'hour', domain: [0, 24], step: 1, res: 1 / 60, ticks: [0, 6, 12, 18, 24], fmt: String, snap: v => { const hh = Math.floor(v); return hh + Math.round((v - hh) * 60) / 60 } }),
  dim('delay', v => Math.floor(v / 10) * 10, { title: 'delay', domain: [-60, 150], step: 10, res: 1, ticks: [-60, 0, 60, 120], fmt: String, snap: v => Math.round(v) }),
  dim('distance', v => Math.floor(v / 50) * 50, { title: 'distance', domain: [0, 2000], step: 50, res: 1, ticks: [0, 1000, 2000], fmt: String, snap: v => Math.round(v) }),
  dim('date', v => Math.floor(v / DAY) * DAY, { title: 'date', domain: [JAN1, Date.UTC(2001, 3, 1)], step: DAY, res: 60000,
    ticks: [JAN1, Date.UTC(2001, 1, 1), Date.UTC(2001, 2, 1), Date.UTC(2001, 3, 1)],
    fmt: t => MONTHS[new Date(t).getUTCMonth()], snap: v => Math.round(v / 60000) * 60000 }),
]
export const INITIAL_BRUSH = { name: 'time', range: [6, 11] }

/* ---------- one chart: the d painter (hairline axis, accent band + grips) ---------- */
function makeChart (host, def, width, H, onRange, { COLOR, MONO, dpr }) {
  const M = { top: 8, right: 10, bottom: 18, left: 10 }
  const card = document.createElement('div'); card.className = 'rb-chart'
  const title = document.createElement('div'); title.className = 'rb-title'; title.textContent = def.title
  const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'rb-reset'; reset.textContent = 'reset'; reset.hidden = true
  title.appendChild(reset)
  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-label', `${def.title} histogram — drag to brush`)
  card.append(title, canvas); host.appendChild(card)
  const ctx = canvas.getContext('2d')
  const [d0, d1] = def.domain
  const n = Math.round((d1 - d0) / def.step)
  let W = width, range = null, ready = false
  let bins = new Float64Array(n), fg = bins, yMax = 1
  const x = v => (v - d0) / (d1 - d0) * W
  const rx = px => d0 + px / W * (d1 - d0)
  function size (w) {
    W = Math.max(60, Math.round(w)); const d = dpr()
    canvas.style.width = (W + M.left + M.right) + 'px'; canvas.style.height = (H + M.top + M.bottom) + 'px'
    canvas.width = (W + M.left + M.right) * d; canvas.height = (H + M.top + M.bottom) * d
    ctx.setTransform(d, 0, 0, d, M.left, M.top)
  }
  size(W)
  function bars (arr, lo, hi) {
    for (let i = 0; i < n; i++) {
      const x0 = x(d0 + i * def.step), x1 = x(d0 + (i + 1) * def.step)
      if (x1 <= lo || x0 >= hi) continue
      const bx0 = Math.max(x0, lo), bx1 = Math.min(x1, hi)
      const bh = arr[i] / yMax * H
      if (bh <= 0) continue
      ctx.fillRect(bx0, H - bh, Math.max(0.6, bx1 - bx0 - (x1 - x0 > 3 ? 1 : 0.25)), bh)
    }
  }
  function draw () {
    ctx.clearRect(-M.left, -M.top, W + M.left + M.right, H + M.top + M.bottom)
    ctx.fillStyle = '#2a2a30'; bars(bins, -1, W + 1)
    ctx.fillStyle = COLOR.accent
    if (range) bars(fg, x(range[0]), x(range[1])); else bars(fg, -1, W + 1)
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, H + 0.5); ctx.lineTo(W, H + 0.5); ctx.stroke()
    ctx.fillStyle = COLOR.faint; ctx.font = `9px ${MONO}`; ctx.textBaseline = 'top'
    def.ticks.forEach((t, i) => {
      const tx = Math.round(x(t)) + 0.5
      ctx.beginPath(); ctx.moveTo(tx, H + 1); ctx.lineTo(tx, H + 5); ctx.stroke()
      ctx.textAlign = i === 0 ? 'left' : i === def.ticks.length - 1 ? 'right' : 'center'
      ctx.fillText(def.fmt(t), tx, H + 8)
    })
    if (range) {
      const lo = Math.round(x(range[0])) + 0.5, hi = Math.round(x(range[1])) - 0.5
      ctx.fillStyle = 'rgba(255,94,58,0.11)'; ctx.fillRect(lo, 0, Math.max(0, hi - lo), H)
      ctx.strokeStyle = COLOR.accent; ctx.lineWidth = 1.5
      for (const hx of [lo, hi]) { ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, H); ctx.stroke() }
      ctx.fillStyle = COLOR.accent
      for (const hx of [lo, hi]) {
        const gx = hx - 2.5, gy = H / 2 - 7, gw = 5, gh = 14, r = 2.5
        ctx.beginPath(); ctx.moveTo(gx + r, gy); ctx.lineTo(gx + gw - r, gy); ctx.arcTo(gx + gw, gy, gx + gw, gy + r, r); ctx.lineTo(gx + gw, gy + gh - r); ctx.arcTo(gx + gw, gy + gh, gx + gw - r, gy + gh, r); ctx.lineTo(gx + r, gy + gh); ctx.arcTo(gx, gy + gh, gx, gy + gh - r, r); ctx.lineTo(gx, gy + r); ctx.arcTo(gx, gy, gx + r, gy, r); ctx.closePath(); ctx.fill()
      }
    }
  }
  // fire = the visitor moved it → the engine write; false = a silent visual seed.
  // A range collapsed to a point MID-DRAG is transient: the band hides but nothing is
  // written (the next move writes the real range, or the release writes the reset) —
  // writing the domain for a transient point would re-admit every row for one frame.
  let drag = null
  function setRange (r, fire = true) {
    const collapsed = !!r && r[1] <= r[0]
    range = r && !collapsed ? r : null
    reset.hidden = !range
    draw()
    if (fire && !(collapsed && drag)) onRange(def.name, range)
  }
  reset.addEventListener('click', () => { if (ready) setRange(null) })
  // three drag modes, as the old chart.js: new selection, translate the extent, resize an
  // edge (the fixed edge is captured at press — the range may collapse to null mid-drag).
  // The value is the pointer's position on the column's value grid (def.snap), written on
  // every move; a move that stays on the same value is skipped by the lane (same bounds)
  const px = e => e.clientX - canvas.getBoundingClientRect().left - M.left
  canvas.addEventListener('pointerdown', e => {
    if (!ready || (e.pointerType === 'mouse' && e.button !== 0)) return
    const p = px(e)
    if (range) {
      const lo = x(range[0]), hi = x(range[1])
      if (Math.abs(p - lo) <= 6) drag = { mode: 'resize', other: range[1] }
      else if (Math.abs(p - hi) <= 6) drag = { mode: 'resize', other: range[0] }
      else if (p > lo && p < hi) drag = { mode: 'move', p0: rx(p), base: [range[0], range[1]] }
    }
    if (!drag) { const v = def.snap(rx(Math.max(0, Math.min(W, p)))); drag = { mode: 'new', v0: v }; setRange([v, v]) }
    canvas.setPointerCapture(e.pointerId); e.preventDefault()
  })
  canvas.addEventListener('pointermove', e => {
    if (!drag) return
    const p = Math.max(0, Math.min(W, px(e))), v = def.snap(rx(p))
    if (drag.mode === 'new') setRange(v > drag.v0 ? [drag.v0, v] : [v, drag.v0])
    else if (drag.mode === 'resize') { const other = drag.other; setRange(v < other ? [v, other] : [other, v]) }
    else {
      const span = drag.base[1] - drag.base[0]
      let lo = drag.base[0] + (rx(p) - drag.p0), hi = lo + span
      if (lo < d0) { lo = d0; hi = lo + span } else if (hi > d1) { hi = d1; lo = hi - span }
      setRange([def.snap(lo), def.snap(hi)])
    }
  })
  // release: a brush that ended collapsed (or a plain click) is a reset — written now
  const up = e => { if (!drag) return; drag = null; canvas.releasePointerCapture?.(e.pointerId); if (!range) onRange(def.name, null) }
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up)
  draw()
  return {
    def, canvas, n, draw, size, setRange,
    get range () { return range },
    // the full histogram (the unbrushed totals) — the dim background bars + the y scale
    setBins (b) { bins = b; fg = b; yMax = 1; for (const v of b) if (v > yMax) yMax = v; ready = true; draw() },
    setFg (arr) { fg = arr; draw() },
  }
}

/* ---------- the lane ---------- */
export function makeBrushLane ({ api, host, widths, height = 104, style, onBrush, onSource, onReady }) {
  const { $, value } = api
  const charts = DEFS.map((def, i) => makeChart(host, def, widths[i], height, (name, range) => brush(name, range), style))
  const byName = Object.fromEntries(charts.map(c => [c.def.name, c]))
  let source = null, filters = null, count = null, active = null, rows = null
  const dims = {}, hist = {}
  const dirty = {}
  const fg = Object.fromEntries(charts.map(c => [c.def.name, new Float64Array(c.n)]))
  const written = {}   // the last bounds written per dim (a no-op write is never issued nor counted)
  let built = false
  const samples = []   // every counted brush's ms, this session (data — the baseline, whatever is selected)
  const stats = { last: null, p50: null, p95: null, n: 0, seq: 0 }
  const pct = (sorted, p) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]   // nearest-rank
  const sortedCopy = a => a.slice().sort((x, y) => x - y)
  /* the mounted peer: { id, adapter, hist: { name: Float64Array }, active, session } or null.
     A peer's session lives for the page (re-selecting it resumes its stats): `samples` = every
     timed peer brush, `base` = data's ms for the SAME brushes, index for index (a peer brush
     only ever follows a data write that moved the bounds; nothing else is timed) */
  let peer = null
  const sessions = new Map()
  const mkSession = () => ({ samples: [], base: [], stats: { last: null, p50: null, p95: null, n: 0, base: null, ratio: null } })

  // bucket key → bin index; `{ [String(bucket)]: { value: N } }` → a dense Float64Array
  const flatInto = (def, obj, out) => {
    out.fill(0)
    for (const k in obj) { const i = Math.round((+k - def.domain[0]) / def.step); if (i >= 0 && i < out.length) out[i] = obj[k].value }
  }
  // repaint the charts whose histogram emitted this commit (the taps set the flags)
  function repaint () {
    for (const c of charts) {
      if (!dirty[c.def.name]) continue
      dirty[c.def.name] = false
      flatInto(c.def, hist[c.def.name][value], fg[c.def.name])
      c.setFg(fg[c.def.name])
    }
  }
  // every chart from data's histograms (a peer dropped) — the bars are the views' values
  function repaintAll () { for (const c of charts) { dirty[c.def.name] = false; flatInto(c.def, hist[c.def.name][value], fg[c.def.name]); c.setFg(fg[c.def.name]) } }
  const same = (a, b) => a === b || (a && b && a[0] === b[0] && a[1] === b[1])
  // the write, always data's. bounds = [lo, hi] (the full domain when unfiltered). Returns the
  // measured ms, or null when the bounds did not move (nothing is written, nothing is counted).
  function write (name, bounds) {
    if (same(written[name], bounds)) return null
    written[name] = bounds
    const t0 = performance.now()
    filters.get(name).update(bounds)
    const ms = performance.now() - t0
    stats.seq = api.runtime().seq
    return ms
  }
  /* the peer's brush in the SAME kind of window as data's write: brush() + the forced read
     of the four histograms + the count (lazy libraries recompute on the read, eager ones in
     brush() — the O(N) walks land inside either way). dataMs = data's ms for the SAME brush
     (every peer brush follows a data write that moved the bounds — nothing else is ever
     timed). Repaints the charts whose histogram a brush changes (leave-one-out: never the
     brushed chart's own) from the peer's bins, records the peer's session and returns the
     figures the caller attests. */
  function peerBrush (name, bounds, dataMs) {
    const { adapter, session } = peer
    const t0 = performance.now()
    adapter.brush(name, bounds)
    for (const c of charts) peer.hist[c.def.name] = adapter.hist(c.def.name)
    peer.active = adapter.active()
    const ms = performance.now() - t0
    session.samples.push(ms); session.base.push(dataMs)
    const st = session.stats, sorted = sortedCopy(session.samples)
    st.last = ms; st.p50 = pct(sorted, 0.5); st.p95 = pct(sorted, 0.95); st.n = session.samples.length
    st.base = pct(sortedCopy(session.base), 0.5); st.ratio = st.base > 0.0005 ? st.p50 / st.base : null
    for (const c of charts) { dirty[c.def.name] = false; if (c.def.name !== name) c.setFg(peer.hist[c.def.name]) }
    return { id: peer.id, ms, stats: st, active: peer.active, lockstep: lockstep() }
  }
  function clearPeer () { if (!peer) return; const a = peer.adapter; peer = null; a.dispose(); if (built) repaintAll() }
  function brush (name, range) {
    if (!built) return
    const def = byName[name].def
    const bounds = range ? [range[0], range[1]] : def.domain
    const ms = write(name, bounds)
    if (ms === null) return
    samples.push(ms)
    const sorted = sortedCopy(samples)
    stats.last = ms; stats.p50 = pct(sorted, 0.5); stats.p95 = pct(sorted, 0.95); stats.n = samples.length
    const pr = peer ? peerBrush(name, bounds, ms) : null
    if (!pr) repaint()
    onBrush?.({ name, range, ms, stats, peer: pr })
  }
  // the probe's proof the peer did the same work on the same rows: its count and all four
  // dense histograms must equal data's (count[value], hist[value] flattened)
  function lockstep () {
    if (!peer || !built) return null
    const c = count[value]
    let same = peer.active === c
    const detail = { active: [c, peer.active], hist: {} }
    for (const ch of charts) {
      const name = ch.def.name, d = new Float64Array(ch.n); flatInto(ch.def, hist[name][value], d)
      const p = peer.hist[name]
      let eq = !!p && p.length === d.length
      for (let i = 0; eq && i < d.length; i++) eq = p[i] === d[i]
      if (!eq) { same = false; detail.hist[name] = { data: Array.from(d), peer: p ? Array.from(p) : null } }
    }
    return { same, detail: same ? null : detail }
  }

  // the build: one step per frame (the caller narrates each label and times each fn).
  // The initial brush (hour 6–11) is the old lib-data seeding idiom — a filter the
  // `filters` source STARTS with, so between('time') constructs already filtered and
  // nothing is written or cascaded: at rest no brush has been measured (n = 0) and
  // the ms slots stay dashed until the visitor's first drag.
  function steps (flights) {
    const S = []
    const seed = { time: [], delay: [], distance: [], date: [], [INITIAL_BRUSH.name]: INITIAL_BRUSH.range.slice() }
    S.push(['$(flights)', () => { rows = flights; source = $(flights); onSource?.(source) }])
    S.push(['filters', () => { filters = $(seed); written[INITIAL_BRUSH.name] = INITIAL_BRUSH.range.slice() }])
    for (const def of DEFS) S.push([`between('${def.name}')`, () => { dims[def.name] = source.between(def.name, filters.get(def.name)) }])
    for (const def of DEFS) {
      const others = () => DEFS.filter(d => d !== def).map(d => dims[d.name])
      S.push([`intersect · ${def.title}`, () => { hist[def.name] = source.intersect(...others()) }])
      S.push([`length(bin) · ${def.title}`, () => { hist[def.name] = hist[def.name].length(def.bin) }])
    }
    S.push(['intersect · all four', () => { active = source.intersect(...DEFS.map(d => dims[d.name])) }])
    S.push(['length()', () => { count = active.length() }])
    S.push(['tap × 4', () => {
      for (const c of charts) {
        const name = c.def.name
        hist[name].tap(() => { dirty[name] = true })   // fires once now, then once per commit, as an effect
        // the background bars: each chart's histogram as constructed (its own dimension
        // unbrushed — the leave-one-out shape never empties its own bars)
        const bg = new Float64Array(c.n); flatInto(c.def, hist[name][value], bg); c.setBins(bg)
        dirty[name] = false
      }
      byName[INITIAL_BRUSH.name].setRange(INITIAL_BRUSH.range, false)   // the band, silently: the filter is already in
    }])
    // the seeded dim is indexed too — not by a domain write (a real re-select) but by moving
    // its lower bound HALF a value resolution out and back: no time value lies in [6 − 1/120, 6),
    // so both writes cross zero rows and emit no row delta, while the first walk builds the
    // sorted index. Without this the visitor's FIRST hour drag would pay the sort (~50–80 ms
    // here) and, under a peer, the "data p50 · N×" line would charge it to data's brush — the
    // peers' equivalent one-time cost (crossfilter's dimension sort, the walkers' first five
    // walks) is charged to their build, so data's must be charged to its build as well
    // The unseeded dims: their domain, not null — null is [] is (−∞, ∞), the bounds they were
    // constructed with, and between's walk returns on equal bounds BEFORE its lazy resort
    // (the index stayed empty and the first delay / distance / date brush paid the sort —
    // 70–270 ms printed as a brush). [d0, d1] differs, so the walk sorts; no row lies
    // outside it, so nothing crosses; and written[name] now equals the domain, so a reset
    // or a plain click on an unbrushed chart is skipped as the same bounds.
    for (const def of DEFS) {
      if (def.name !== INITIAL_BRUSH.name) S.push([`indexing · ${def.title}`, () => { write(def.name, def.domain.slice()) }])
      else S.push([`indexing · ${def.title}`, () => { const r = INITIAL_BRUSH.range; write(def.name, [r[0] - def.res / 2, r[1]]); write(def.name, r.slice()) }])
    }
    S.push(['ready', () => { built = true; onReady?.() }])
    return S
  }

  return {
    charts, steps, brush, stats, samples,
    get built () { return built },
    get peer () { return peer },
    activeCount () { return count[value] },
    total () { return source.rowCount() },
    rows () { return rows },
    // the [lo, hi] each dimension currently holds in data's filters — a peer's seed
    bounds () { return Object.fromEntries(DEFS.map(d => [d.name, (written[d.name] ?? d.domain).slice()])) },
    ranges () { return Object.fromEntries(charts.map(c => [c.def.name, c.range])) },
    resize (ws) { charts.forEach((c, i) => { c.size(ws[i]); c.draw() }) },
    nodes () { return { source, filters, dims, hist, active, count } },
    lockstep,
    /* mount a built adapter: its four histograms + count are read (the lane's FIRST forced
       read — a lazy library computes nothing before it), `at` = performance.now() right after
       those reads (the caller's build window ends there, before any canvas paints), then the
       charts switch to ITS histograms and the readout to its count; returns the session it
       resumes (or starts) and the lockstep verdict of its seed */
    setPeer (id, adapter) {
      if (peer) clearPeer()
      const session = sessions.get(id) ?? mkSession(); sessions.set(id, session)
      peer = { id, adapter, hist: {}, active: 0, session }
      for (const c of charts) peer.hist[c.def.name] = adapter.hist(c.def.name)
      peer.active = adapter.active()
      const at = performance.now()
      for (const c of charts) { dirty[c.def.name] = false; c.setFg(peer.hist[c.def.name]) }
      return { id, stats: session.stats, active: peer.active, lockstep: lockstep(), at }
    },
    clearPeer,
  }
}
