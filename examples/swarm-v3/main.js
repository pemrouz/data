// Swarm — the live agent-simulation control room, on the v3 engine.
//
// The same demo as ../swarm: a SIRS epidemic over ~12k moving agents runs in
// plain JS (the ENGINE-AGNOSTIC ../swarm/sim.js — one sim, two consumers), and
// a reactive analytics deck rides alongside it, maintained INCREMENTALLY by
// data/v3. The deck's cost is proportional to the events that fired this frame
// (state flips + cell crossings + band crossings), never to the population.
//
// Two-tier discipline (the story this example tells):
//   • plain JS owns the O(N) hot core — physics, transmission, the canvas paint.
//   • data/v3 owns the analytics — every panel is an O(events) incremental view.
//
// THE BRIDGE — the patch-throughput showcase: each frame, the sim's dirty list
// (only the agents that changed something discrete) drains into ONE
// pop.patch([[id, row], …]) — v3 patch pairs are [key, row] TUPLES and the
// whole patch is ONE commit, so every deck view settles exactly once per frame
// with a single consolidated batch (≤1 delta per row), not once per agent.
// Measured at the data level: a 2000-row patch through this entire deck
// settles in ~3.4ms median (node, 12k agents).
//
// v2 → v3 mappings worth reading:
//   pop[id].state = …  patch loop      →  pop.patch(pairs), one commit
//   filter('state','I')                →  filter(a => a.state === 'I') (predicate-only)
//   intersect({gx: between, gy: …})    →  intersect(dimGx, dimGy) (view operands)
//   sel.gx[value] = bounds per frame   →  sel.get('gx').raf() coalescing writers
//   render(li(view, (node, row) =>     →  list(view, row => li(…)) — rowFn gets
//     …reactive .to() bindings…)          PLAIN row snapshots: no .to(), no
//                                         transient-undefined guards
// Views are DENSE (no sparse-undefined holes), so the fixed-slot painters read
// [value] snapshots without densify/guard ceremony.

import { $, value, render, list, HTML } from 'data/v3'
import { createSim } from '../swarm/sim.js'

const { ul, li, span } = HTML

const params = new URLSearchParams(location.search)
const N = +params.get('n') || 12000
const GRID = 16

const sim = createSim({ n: N, grid: GRID, seed: 7 })
const NB = sim.bands
const BANDW = 100 / NB

// ── the reactive population ─────────────────────────────────────────────────
// Array-born source: agent i gets MINTED INTEGER KEY i, so a patch pair's key
// IS the agent id and every derived view keeps that id (v3 ordered/derived
// views carry source row keys — no v2 positional/data-id read-back anywhere).
// Rows are { state:'S'|'I'|'R', gx, gy, energy }.
const pop = $(sim.rows())

// SIR counts — length(fn) histogram keyed by state. A flip moves one bucket
// pair: decrement the old {value:N}, increment the new. Never a rescan.
const states = pop.length((a) => a.state)

// Energy histogram — length(fn) keyed by band. One bucket moves per crossing;
// emptied buckets persist at {value:0} (stable zero-height bars).
const ebands = pop.length((a) => {
  const b = (a.energy / BANDW) | 0
  return b < 0 ? 0 : b >= NB ? NB - 1 : b
})

// Region infection leaderboard — v3 filter is PREDICATE-ONLY (the v2
// filter('state','I') form is gone); it re-classifies one row per delta, and
// length(fn) keeps the per-cell infected counts incrementally.
const regionInf = pop.filter((a) => a.state === 'I').length((a) => a.gy * GRID + a.gx)

// Outbreak alarm — some() chained straight over the histogram: a bucket view
// is a view like any other (only its CHILDREN are path addresses), so the
// boolean aggregate tracks a true-count over the {value:N} rows in O(1) per
// touched bucket. Verified both directions against a plain-JS oracle.
const OUTBREAK = 22
const outbreak = regionInf.some((cell) => cell.value >= OUTBREAK)

// Mean-energy headline — avg is O(1) per delta (running total + count).
// v3 contract: an empty set reads undefined (the paint guards with ?? 0).
const avgE = pop.avg('energy')

// Brushed cohort — two REACTIVE-BOUNDS range dims intersected (the crossfilter
// idiom over a churning source). sel is a plain reactive source of bound
// tuples; between('gx', sel.get('gx')) binds the child handle as live bounds,
// so a brush write is just sel.get('gx').update([lo, hi]) and the walk admits/
// evicts only the rows that crossed a boundary. Data churn re-checks membership
// per delta, so the cohort updates even with a stationary brush.
const sel = $({ gx: [8, 15], gy: [8, 15] })
const dims = {
  gx: pop.between('gx', sel.get('gx')),
  gy: pop.between('gy', sel.get('gy')),
}
// v3 intersect takes VIEW OPERANDS (the v2 object-map form is gone). pop is
// the primary, so the exposed rows keep pop's canonical row identity.
const cohort = pop.intersect(dims.gx, dims.gy)
const cohortN = cohort.length()
const cohortE = cohort.avg('energy')
const cohortTable = cohort.limit(120) // keeps the rendered DOM ≤ 120 rows

// ── DOM scaffold ─────────────────────────────────────────────────────────────
const $$ = (s) => document.querySelector(s)
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
// churn / innerHTML reparse)
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

// ── the cohort table — the keyed list sink (surgical per-row updates) ────────
// rowFn receives a PLAIN row snapshot + the row's key (the agent id — v3 views
// keep source keys, so no data-id read-back). An agent flipping S→I inside the
// brush is one update delta: the sink patches this row's data-state attribute
// and text cells in place — element identity, focus and scroll survive. Agents
// entering/leaving the brush insert/remove one <li>.
render(
  $$('#cohort-rows'),
  ul.cohort_list(
    list(cohortTable, (a, id) =>
      li.cohort_row({ 'data-state': a.state },
        span.cid('#' + id),
        span.cstate(a.state),
        span.ccell(`${a.gy}·${a.gx}`),
        span.cenergy(String(a.energy | 0)),
      ),
    ),
  ),
)

// ── brush interaction ────────────────────────────────────────────────────────
// Drag a box on the cloud → a contiguous gx/gy cell range, written through the
// built-in raf() coalescing writers: a fast drag commits at most one bounds
// walk per dim per frame even while the population churns underneath; flush()
// on pointerup lands the final box without an extra frame's latency.
const writeGx = sel.get('gx').raf()
const writeGy = sel.get('gy').raf()
const brushEl = $$('#brush')
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
  writeGx(r.gx)
  writeGy(r.gy)
  drawBrushBox(r.gx, r.gy)
})
cloud.addEventListener('pointerup', () => {
  drag = null
  writeGx.flush()
  writeGy.flush()
})
// seed the initial brush box
drawBrushBox(sel.get('gx')[value], sel.get('gy')[value])

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
const pairs = [] // reused [[id, row], …] buffer drained into pop.patch each frame

function frame() {
  // 1) advance the sim (plain-JS physics) — fills the dirty list
  const t0 = performance.now()
  sim.step(1)
  const physMs = performance.now() - t0

  // 2) THE BRIDGE: one batched whole-row patch for every dirty agent — v3
  //    patch pairs are [key, row] tuples applied as ONE commit. Every deck
  //    view settles once against a single consolidated batch: the histograms
  //    move only the touched buckets, avg runs its per-row delta, the betweens
  //    re-check brush membership per changed row, intersect flips only the
  //    keys whose membership moved, and the ≤120-row window reconciles once.
  const { dirty, state, gx, gy, eband, SC, BANDW } = sim
  const t1 = performance.now()
  for (let k = 0; k < dirty.length; k++) {
    const id = dirty[k]
    pairs.push([id, { state: SC[state[id]], gx: gx[id], gy: gy[id], energy: eband[id] * BANDW }])
  }
  if (pairs.length) { pop.patch(pairs); pairs.length = 0 }
  const castMs = performance.now() - t1
  const events = dirty.length

  // 3) paint the fixed-slot panels once, from the maintained aggregates
  paintCloud()
  paintSIR()
  paintEnergy()
  paintLeaderboard()
  paintTiles()

  // 4) HUD
  frames++
  const now = performance.now()
  if (now - fpsT >= 500) { fps = Math.round((frames * 1000) / (now - fpsT)); frames = 0; fpsT = now }
  hud.ev.textContent = events.toLocaleString()
  hud.fps.textContent = fps
  hud.ms.textContent = `${castMs.toFixed(1)} react · ${physMs.toFixed(1)} phys`

  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

// debug / test hooks
window.__swarm = {
  pop, sim, sel, dims, states, ebands, regionInf, outbreak, avgE,
  cohort, cohortN, cohortE, cohortTable, value,
}
