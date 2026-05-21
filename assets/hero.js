/* Hero + explainer diagrams — the centerpiece.
 *
 * A real `data` pipeline over 10,000 rows: source → filter → map → za → DOM.
 * One edit to one row walks exactly one path. The glow and the op-counter are
 * driven by REAL `.tap()`s on each operator (the 0-arg "fire once per emit"
 * path), so the animation is the library reporting its own work — not a
 * scripted fake. The source is genuinely 10,000 rows; only the 8-row top-K
 * output is in the DOM.
 *
 * Two mounts share one `buildDiagram` factory:
 *   #hero-diagram      — auto-loops on a calm cadence (S1)
 *   #explainer-diagram — steps one edit at a time on click, annotated (S2)
 *
 * Honors prefers-reduced-motion and pauses when hidden / off-screen.
 * Hand-written `.js` with no `.ts` sibling (see CLAUDE.md). */

import { $, value, render, HTML } from './feed.js'

const { div, span } = HTML
const SVGNS = 'http://www.w3.org/2000/svg'
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

const el = (name, attrs = {}) => {
  const n = document.createElementNS(SVGNS, name)
  for (const k in attrs) n.setAttribute(k, attrs[k])
  return n
}

/* ---------- one reusable diagram over a real pipeline ---------- */

const N = 10000

function makePipeline () {
  const rows = Array.from({ length: N }, (_, i) => ({ id: i, v: +(Math.random() * 100).toFixed(1) }))
  const src    = $(rows)
  const passed = src.filter(r => r && r.v > 50)
  const mapped = passed.map(r => ({ id: r.id, v: r.v, w: +(r.v * 2).toFixed(1) }))
  const topK   = mapped.za('w', 8)
  return { src, passed, mapped, topK }
}

/* Lay out the DAG inside `svg`, wire the DOM leaves to `topK`, and return a
 * controller: `.fire(stages, leafId)` lights a path; `.ops` is the live $()
 * op-counter; `.markFns` are the per-stage tap callbacks. */
function buildDiagram (svg, topK) {
  const VBW = 960, VBH = 380, midY = 190
  svg.setAttribute('viewBox', `0 0 ${VBW} ${VBH}`)
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  svg.classList.add('hero-svg')

  // node anchors (x = horizontal flow)
  const NODE_W = 132, NODE_H = 52
  const stageX = { filter: 300, map: 478, sort: 656 }
  const srcCx = 96, leafX = 832

  const layers = {
    edges:  el('g', { class: 'hd-edges' }),
    active: el('g', { class: 'hd-active' }),
    nodes:  el('g', { class: 'hd-nodes' }),
    dots:   el('g', { class: 'hd-dots' }),
  }

  // source dot grid — a visual sample of N rows (one lights per edit)
  const COLS = 5, ROWS = 8, gx0 = 52, gy0 = 64, gdx = 22, gdy = 32
  const dotPos = []
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const cx = gx0 + c * gdx, cy = gy0 + r * gdy
    dotPos.push([cx, cy])
    layers.dots.appendChild(el('circle', { class: 'hd-dot', cx, cy, r: 3.2 }))
  }
  const dotEls = Array.from(layers.dots.children)

  // static bundle edges (dim) — source → filter → map → sort → DOM
  const bundle = (x1, y1, x2, y2) => layers.edges.appendChild(
    el('path', { class: 'hd-edge', d: `M${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}` })
  )
  bundle(srcCx + 36, midY, stageX.filter - NODE_W / 2, midY)
  bundle(stageX.filter + NODE_W / 2, midY, stageX.map - NODE_W / 2, midY)
  bundle(stageX.map + NODE_W / 2, midY, stageX.sort - NODE_W / 2, midY)
  bundle(stageX.sort + NODE_W / 2, midY, leafX - 8, midY)

  // operator nodes
  const nodeEls = {}
  const addNode = (key, label, sub, cx) => {
    const x = cx - NODE_W / 2, y = midY - NODE_H / 2
    const grp = el('g', { class: 'hd-node', 'data-stage': key })
    grp.appendChild(el('rect', { x, y, width: NODE_W, height: NODE_H, rx: 8, class: 'hd-node-box' }))
    const t1 = el('text', { x: cx, y: midY - 4, 'text-anchor': 'middle', class: 'hd-node-label' }); t1.textContent = label
    const t2 = el('text', { x: cx, y: midY + 14, 'text-anchor': 'middle', class: 'hd-node-sub' }); t2.textContent = sub
    grp.append(t1, t2)
    layers.nodes.appendChild(grp)
    nodeEls[key] = grp
  }
  addNode('source', '$(rows)', `N = ${N.toLocaleString()}`, srcCx)
  // override source node to sit over the dot grid as a labelled frame
  nodeEls.source.querySelector('.hd-node-box').setAttribute('width', 0) // hide box; dots are the source
  nodeEls.source.querySelector('.hd-node-label').setAttribute('y', 44)
  nodeEls.source.querySelector('.hd-node-label').setAttribute('x', srcCx)
  nodeEls.source.querySelector('.hd-node-sub').setAttribute('y', VBH - 36)
  nodeEls.source.querySelector('.hd-node-sub').setAttribute('x', srcCx)

  addNode('filter', '.filter()', 'v > 50', stageX.filter)
  addNode('map',    '.map()',    'w = v·2', stageX.map)
  addNode('sort',   ".za('w', 8)", 'top 8', stageX.sort)

  // DOM sink label
  const sinkLabel = el('text', { x: leafX + 52, y: 44, 'text-anchor': 'middle', class: 'hd-node-sub' })
  sinkLabel.textContent = 'render → DOM'
  layers.nodes.appendChild(sinkLabel)

  svg.append(layers.edges, layers.active, layers.nodes, layers.dots)

  // DOM leaves: a real reactive list bound to topK, placed beside the SVG via
  // a foreignObject so element identity / surgical updates are genuine.
  const fo = el('foreignObject', { x: leafX, y: 60, width: VBW - leafX - 8, height: VBH - 96 })
  const leafHost = document.createElement('div')
  leafHost.className = 'hd-leaves'
  fo.appendChild(leafHost)
  svg.appendChild(fo)
  render(leafHost, div(
    div.hd_leaf(topK, (node, row) => node.attr('data-leaf-id', row.id)(
      span.hd_leaf_id.text(row.id.to(v => '#' + v)),
      span.hd_leaf_w.text(row.w.to(v => v.toFixed(1))),
    ))
  ))

  const ops = $(0)

  // mark fns wired to real taps; each lights a node + bumps the counter
  const fadeTimers = {}
  function lightNode (key) {
    const n = nodeEls[key]
    if (!n) return
    n.classList.add('lit')
    clearTimeout(fadeTimers[key])
    fadeTimers[key] = setTimeout(() => n.classList.remove('lit'), 900)
  }
  const markFns = {
    source: () => { ops[value] = ops[value] + 1; lightNode('source') },
    filter: () => { ops[value] = ops[value] + 1; lightNode('filter') },
    map:    () => { ops[value] = ops[value] + 1; lightNode('map') },
    sort:   () => { ops[value] = ops[value] + 1; lightNode('sort') },
  }

  // active path overlay: a traveling pulse from a source dot through the
  // spine to one leaf. Visual layer; the counter above is the real signal.
  function fire (leafId) {
    // light a representative source dot
    const di = leafId % dotEls.length
    dotEls.forEach(d => d.classList.remove('lit'))
    const dot = dotEls[di]; dot.classList.add('lit')
    const [dx, dy] = dotPos[di]
    setTimeout(() => dot.classList.remove('lit'), 900)

    // build the path: source dot → filter → map → sort → leaf row
    const leafEl = leafHost.querySelector(`[data-leaf-id="${leafId}"]`)
    const leafY = leafEl
      ? 60 + leafEl.offsetTop + leafEl.offsetHeight / 2
      : midY
    const pts = [
      [dx, dy],
      [stageX.filter - NODE_W / 2, midY], [stageX.filter + NODE_W / 2, midY],
      [stageX.map - NODE_W / 2, midY],    [stageX.map + NODE_W / 2, midY],
      [stageX.sort - NODE_W / 2, midY],   [stageX.sort + NODE_W / 2, midY],
      [leafX - 4, leafY],
    ]
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ')
    const path = el('path', { class: 'hd-active-path', d })
    layers.active.appendChild(path)
    if (leafEl) {
      leafEl.classList.remove('flash'); void leafEl.offsetWidth; leafEl.classList.add('flash')
    }
    if (reduceMotion) {
      setTimeout(() => path.remove(), 600)
      return
    }
    const len = path.getTotalLength()
    path.style.strokeDasharray = `${len}`
    path.style.strokeDashoffset = `${len}`
    const anim = path.animate(
      [{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
      { duration: 900, easing: 'cubic-bezier(.4,0,.2,1)' }
    )
    anim.onfinish = () => {
      path.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 360, fill: 'forwards' })
        .onfinish = () => path.remove()
    }
  }

  return { ops, markFns, fire }
}

/* ---------- S1: auto-looping hero ---------- */

const heroSvg = document.getElementById('hero-diagram')
if (heroSvg) {
  const pipe = makePipeline()
  const ctrl = buildDiagram(heroSvg, pipe.topK)

  // wire real taps
  pipe.src.tap(ctrl.markFns.source)
  pipe.passed.tap(ctrl.markFns.filter)
  pipe.mapped.tap(ctrl.markFns.map)
  pipe.topK.tap(ctrl.markFns.sort)

  // bind the op-counter readout (a real $() view)
  const opsEl = document.getElementById('hero-ops')
  if (opsEl) { opsEl.textContent = ''; render(opsEl, span.text(ctrl.ops.to(n => n.toLocaleString()))) }

  function bumpMember () {
    const members = pipe.topK[value]
    if (!members || !members.length) return
    const m = members[(Math.random() * members.length) | 0]
    if (!m) return
    const nextV = Math.min(100, m.v + 1 + Math.random() * 6)
    pipe.src[m.id].v = +nextV.toFixed(1)
    ctrl.fire(m.id)
  }

  let timer = null, onScreen = true
  const tick = () => { if (!document.hidden && onScreen) bumpMember() }
  function start () { if (!timer && !reduceMotion) timer = setInterval(tick, 2200) }
  function stop () { if (timer) { clearInterval(timer); timer = null } }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(es => {
      onScreen = es[0].isIntersecting
      if (onScreen) start(); else stop()
    }, { threshold: 0.15 }).observe(heroSvg)
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start() })

  if (reduceMotion) bumpMember()   // one static lit frame
  else start()
}

/* ---------- S2: steppable explainer ---------- */

const expSvg = document.getElementById('explainer-diagram')
if (expSvg) {
  const pipe = makePipeline()
  const ctrl = buildDiagram(expSvg, pipe.topK)
  pipe.src.tap(ctrl.markFns.source)
  pipe.passed.tap(ctrl.markFns.filter)
  pipe.mapped.tap(ctrl.markFns.map)
  pipe.topK.tap(ctrl.markFns.sort)

  const opsEl = document.getElementById('explainer-ops')
  if (opsEl) { opsEl.textContent = ''; render(opsEl, span.text(ctrl.ops.to(n => n.toLocaleString()))) }

  const pathEl = document.getElementById('explainer-path')
  const btn = document.getElementById('explainer-step')
  if (btn) btn.addEventListener('click', () => {
    const members = pipe.topK[value]
    if (!members || !members.length) return
    const m = members[(Math.random() * members.length) | 0]
    if (!m) return
    const nextV = Math.min(100, m.v + 1 + Math.random() * 6)
    if (pathEl) pathEl.textContent = `src[${m.id}].v = ${nextV.toFixed(1)}`
    pipe.src[m.id].v = +nextV.toFixed(1)
    ctrl.fire(m.id)
  })
}
