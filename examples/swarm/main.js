// Swarm — a live agent-simulation control room.
//
// A SIRS epidemic over ~50k moving agents runs in plain JS (sim.js). A reactive
// analytics deck rides alongside it, maintained INCREMENTALLY by `data`: the
// cost of the whole deck is proportional to the events that fired this frame
// (flips + cell crossings + band crossings — a few thousand), never to the
// population. The killer property is coexistence — a 50k-agent sim AND a live
// deck sharing one frame budget — plus a brush you can drag over the population
// while the population churns underneath it.
//
// Two-tier discipline (mirrors the datagrid / metrics contract):
//   • plain JS owns the O(N) hot core — physics, transmission, the canvas paint.
//   • `data` owns the analytics — every panel is an O(Δ) incremental view.
// Fixed-slot panels (SIR bars, energy histogram, leaderboard, tiles, cloud)
// PAINT once per frame by reading already-maintained aggregates. The cohort
// TABLE uses render() so each row is surgically updated — an agent flipping
// S→I inside your brush rewrites one badge; agents entering/leaving the brush
// insert/remove one <li> — element identity, focus and scroll survive.

import { $, value, render, HTML } from 'data'
import { createSim } from './sim.js'

const { ul, li, span } = HTML

const params = new URLSearchParams(location.search)
const N = +params.get('n') || 12000
const GRID = 16

const sim = createSim({ n: N, grid: GRID, seed: 7 })
const NB = sim.bands
const BANDW = 100 / NB

// ── the reactive population proxy ──────────────────────────────────────────
// Rows are { state:'S'|'I'|'R', gx, gy, energy }. Every per-frame mutation is a
// BU2 on an exact path like ['1234','state'] — only sinks on that path fire.
const pop = $(sim.rows())

// SIR counts — length(fn) keyed by state. A flip is one BU1: decrement the old
// bucket, increment the new. Never a rescan. (Read counts as `.S.value`.)
const states = pop.length((a) => a.state)

// Energy histogram — length(fn) keyed by band. One bucket moves per band cross.
const ebands = pop.length((a) => {
  const b = (a.energy / BANDW) | 0
  return b < 0 ? 0 : b >= NB ? NB - 1 : b
})

// Region infection leaderboard — filter is a RowOperator (re-runs the predicate
// for one row per flip, O(1)); length(fn) keeps per-cell infected counts.
const regionInf = pop.filter('state', 'I').length((a) => a.gy * GRID + a.gx)

// Outbreak alarm — a boolean aggregate straight off the per-cell counts: the
// LED lights the frame any region's infected count crosses OUTBREAK. some()
// tracks a true-count, so this is O(buckets) only when the leaderboard
// republishes (once per frame thanks to the batched patch), not per agent.
const OUTBREAK = 22
const outbreak = regionInf.some((cell) => cell.value >= OUTBREAK)

// Mean-energy headline — avg is O(1) per delta (running total + count). The
// population is fixed in this prototype, so we don't pay a length() sink for it.
const avgE = pop.avg('energy')

// Brushed cohort — two reactive range dims intersected (the crossfilter idiom),
// here over a CHURNING source. between.BU2 → _replaceRow re-checks membership
// against the live bounds and emits BI0/BR1 the instant an agent crosses the
// box edge, so the cohort updates even with a stationary brush.
const sel = $({ gx: [8, 15], gy: [8, 15] })
const dims = {
  gx: pop.between('gx', sel.gx),
  gy: pop.between('gy', sel.gy),
}
const cohort = pop.intersect(dims)
const cohortN = cohort.length()
const cohortE = cohort.avg('energy')
const cohortTable = cohort.limit(120) // limit keeps the rendered DOM ≤ 120 rows

// ── DOM scaffold ───────────────────────────────────────────────────────────
const $$ = (sel) => document.querySelector(sel)
const cloud = $$('#cloud')
const CW = (cloud.width = 600)
const CH = (cloud.height = 600)
const ctx = cloud.getContext('2d')
const img = ctx.createImageData(CW, CH)
const buf = new Uint32Array(img.data.buffer)
const BG = 0xff14161b
// 0xAABBGGRR (little-endian): S green, I orange, R blue
const COLOR = [0xff6ac43e, 0xff3a7aff, 0xffff7b4a]

// ── once-per-frame painters (read maintained aggregates, write the DOM) ──────
function paintCloud() {
  buf.fill(BG)
  const { x, y, state } = sim
  // plot susceptible/recovered first, infected last so the wavefront sits on top
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) {
      const st = state[i]
      if (pass === 0 ? st === 1 : st !== 1) continue
      const px = (x[i] * CW) | 0
      const py = (y[i] * CH) | 0
      const c = COLOR[st]
      const o = py * CW + px
      buf[o] = c
      if (px + 1 < CW) buf[o + 1] = c
      if (py + 1 < CH) buf[o + CW] = c
    }
  }
  ctx.putImageData(img, 0, 0)
}

const sirEls = {
  S: { bar: $$('#sir-S .bar'), n: $$('#sir-S .n') },
  I: { bar: $$('#sir-I .bar'), n: $$('#sir-I .n') },
  R: { bar: $$('#sir-R .bar'), n: $$('#sir-R .n') },
}
function paintSIR() {
  const b = states[value] || {}
  const s = b.S?.value || 0
  const i = b.I?.value || 0
  const r = b.R?.value || 0
  const tot = s + i + r || 1
  sirEls.S.bar.style.width = (s / tot) * 100 + '%'; sirEls.S.n.textContent = s.toLocaleString()
  sirEls.I.bar.style.width = (i / tot) * 100 + '%'; sirEls.I.n.textContent = i.toLocaleString()
  sirEls.R.bar.style.width = (r / tot) * 100 + '%'; sirEls.R.n.textContent = r.toLocaleString()
}

const histEl = $$('#hist')
const histBars = Array.from({ length: NB }, () => {
  const d = document.createElement('div')
  d.className = 'hbar'
  histEl.appendChild(d)
  return d
})
function paintEnergy() {
  const b = ebands[value] || {}
  let max = 1
  for (let k = 0; k < NB; k++) { const c = b[k]?.value || 0; if (c > max) max = c }
  for (let k = 0; k < NB; k++) {
    histBars[k].style.height = ((b[k]?.value || 0) / max) * 100 + '%'
  }
}

const boardEl = $$('#leaderboard')
const LROWS = 12
// persistent leaderboard rows — updated in place each frame (no per-frame DOM
// churn / innerHTML reparse, which dominated the paint at higher N)
const lrows = Array.from({ length: LROWS }, () => {
  const row = document.createElement('div')
  row.className = 'lrow'
  row.innerHTML = '<span class="lcell"></span><span class="lbar"></span><span class="ln"></span>'
  boardEl.appendChild(row)
  return { row, cell: row.children[0], bar: row.children[1], n: row.children[2] }
})
const top = [] // reused scratch
function paintLeaderboard() {
  const b = regionInf[value] || {}
  top.length = 0
  for (const k in b) { const c = b[k]?.value || 0; if (c > 0) top.push(+k, c) }
  // partial selection sort for the top LROWS (top is flat [cell, count, …])
  const n = top.length / 2
  const shown = Math.min(LROWS, n)
  for (let s = 0; s < shown; s++) {
    let best = s
    for (let j = s + 1; j < n; j++) if (top[j * 2 + 1] > top[best * 2 + 1]) best = j
    if (best !== s) {
      const c0 = top[s * 2], c1 = top[s * 2 + 1]
      top[s * 2] = top[best * 2]; top[s * 2 + 1] = top[best * 2 + 1]
      top[best * 2] = c0; top[best * 2 + 1] = c1
    }
  }
  const max = shown ? top[1] : 1
  for (let r = 0; r < LROWS; r++) {
    const lr = lrows[r]
    if (r < shown) {
      const cell = top[r * 2], c = top[r * 2 + 1]
      lr.cell.textContent = `R${(cell / GRID) | 0}·${cell % GRID}`
      lr.bar.style.width = (c / max) * 100 + '%'
      lr.n.textContent = c
      lr.row.style.visibility = ''
    } else if (lr.row.style.visibility !== 'hidden') {
      lr.row.style.visibility = 'hidden'
    }
  }
}

const tiles = {
  pop: $$('#t-pop'),
  inf: $$('#t-inf'),
  energy: $$('#t-energy'),
  cohort: $$('#t-cohort'),
  cohortE: $$('#t-cohort-e'),
}
const alarmEl = $$('#alarm')
function paintTiles() {
  const b = states[value] || {}
  const s = b.S?.value || 0
  const inf = b.I?.value || 0
  const r = b.R?.value || 0
  const tot = s + inf + r
  tiles.pop.textContent = tot.toLocaleString()
  tiles.inf.textContent = tot ? ((inf / tot) * 100).toFixed(1) + '%' : '—'
  tiles.energy.textContent = (avgE[value] ?? 0).toFixed(1)
  tiles.cohort.textContent = (cohortN[value] || 0).toLocaleString()
  tiles.cohortE.textContent = cohortN[value] ? (cohortE[value] ?? 0).toFixed(1) : '—'
  alarmEl.classList.toggle('lit', !!outbreak[value])
}

// ── the cohort table — the render() showcase (surgical per-row updates) ──────
render(
  $$('#cohort-rows'),
  ul.cohort_list(
    li.cohort_row(cohortTable, (node, row, key) =>
      node
        .attr('data-state', row.state) // live recolor as the agent flips inside the brush
        .nodes(
          span.cid.text('#' + key),
          span.cstate.text(row.state),
          span.ccell.text(row.gx.to((gx) => `${row.gy[value]}·${gx}`)),
          span.cenergy.text(row.energy.to((e) => (e | 0) + ''))
        )
    )
  )
)

// ── brush interaction ────────────────────────────────────────────────────
// Drag a box on the cloud → a contiguous gx/gy cell range. We stash it and
// commit once per frame so `between` pays at most one _resort() per frame even
// while you drag over a churning source.
const brushEl = $$('#brush')
let pendingBrush = null
let drag = null

function cellRangeFromPx(x0, y0, x1, y1) {
  const rect = cloud.getBoundingClientRect()
  const fx0 = Math.min(x0, x1) - rect.left, fx1 = Math.max(x0, x1) - rect.left
  const fy0 = Math.min(y0, y1) - rect.top, fy1 = Math.max(y0, y1) - rect.top
  const c = (v, span) => Math.max(0, Math.min(GRID - 1, ((v / span) * GRID) | 0))
  return {
    gx: [c(fx0, rect.width), c(fx1, rect.width)],
    gy: [c(fy0, rect.height), c(fy1, rect.height)],
  }
}
function drawBrushBox(gx, gy) {
  const rect = cloud.getBoundingClientRect()
  const cellW = rect.width / GRID, cellH = rect.height / GRID
  brushEl.style.left = gx[0] * cellW + 'px'
  brushEl.style.top = gy[0] * cellH + 'px'
  brushEl.style.width = (gx[1] - gx[0] + 1) * cellW + 'px'
  brushEl.style.height = (gy[1] - gy[0] + 1) * cellH + 'px'
  brushEl.hidden = false
}
cloud.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY }
  cloud.setPointerCapture(e.pointerId)
})
cloud.addEventListener('pointermove', (e) => {
  if (!drag) return
  const r = cellRangeFromPx(drag.x, drag.y, e.clientX, e.clientY)
  pendingBrush = r
  drawBrushBox(r.gx, r.gy)
})
cloud.addEventListener('pointerup', () => { drag = null })
// seed the initial brush box
drawBrushBox(sel.gx[value], sel.gy[value])

// ── the frame loop ──────────────────────────────────────────────────────────
const hud = {
  n: $$('#hud-n'),
  ev: $$('#hud-ev'),
  fps: $$('#hud-fps'),
  ms: $$('#hud-ms'),
}
hud.n.textContent = N.toLocaleString()

let frames = 0
let fpsT = performance.now()
let fps = 0
const patch = [] // reused [id, row, …] buffer drained into pop.patch each frame

function frame() {
  // 1) commit a coalesced brush move (≤ one between resort per frame)
  if (pendingBrush) {
    sel.gx[value] = pendingBrush.gx
    sel.gy[value] = pendingBrush.gy
    pendingBrush = null
  }

  // 2) advance the sim (plain-JS physics) — fills the change buffers
  const t0 = performance.now()
  sim.step(1)
  const physMs = performance.now() - t0

  // 3) the bridge: one batched whole-row patch for every dirty agent. The
  //    operators see a single BU1 carrying all the changed rows — length(fn)
  //    rebuckets each flip, avg runs its delta, between re-checks brush
  //    membership — so the per-frame cost is one dispatch per sink, not one
  //    per agent. (patch pairs are [id, row, id, row, …].)
  const { dirty, state, gx, gy, eband, SC, BANDW } = sim
  const t1 = performance.now()
  for (let k = 0; k < dirty.length; k++) {
    const id = dirty[k]
    patch.push('' + id, { state: SC[state[id]], gx: gx[id], gy: gy[id], energy: eband[id] * BANDW })
  }
  if (patch.length) { pop.patch(patch); patch.length = 0 }
  const castMs = performance.now() - t1
  const events = dirty.length

  // 4) paint the fixed-slot panels once, from the maintained aggregates
  paintCloud()
  paintSIR()
  paintEnergy()
  paintLeaderboard()
  paintTiles()

  // 5) HUD
  frames++
  const now = performance.now()
  if (now - fpsT >= 500) { fps = Math.round((frames * 1000) / (now - fpsT)); frames = 0; fpsT = now }
  hud.ev.textContent = events.toLocaleString()
  hud.fps.textContent = fps
  hud.ms.textContent = `${castMs.toFixed(1)} react · ${physMs.toFixed(1)} phys`

  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
