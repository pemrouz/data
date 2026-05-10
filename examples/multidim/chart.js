// Library-agnostic brushable histogram. Pure DOM/SVG, no reactivity. Each
// library row creates four of these, drives them imperatively (setBars,
// setRange), and listens on `onMarkInput` / `onRangeChange` to wire their
// own reactive state. Keeps the comparison focused on reactive update cost
// rather than DOM-layer differences across libraries.

const NS = 'http://www.w3.org/2000/svg'

export function createChart(parent, opts) {
  const { domain, width, ticks, format, round, bucketSize } = opts
  const margin = { top: 10, right: 10, bottom: 20, left: 10 }
  const height = 60
  const x = scale(domain, [0, width])
  const rx = scale([0, width], domain)
  const apply = round || (v => v)

  // host card
  const card = document.createElement('div')
  card.className = 'mdf-chart'
  parent.appendChild(card)

  const titleEl = document.createElement('div')
  titleEl.className = 'mdf-title'
  titleEl.textContent = opts.title
  const resetEl = document.createElement('a')
  resetEl.className = 'mdf-reset'
  resetEl.textContent = 'reset'
  resetEl.style.display = 'none'
  resetEl.addEventListener('click', () => api.setRange([]))
  titleEl.appendChild(resetEl)
  card.appendChild(titleEl)

  // svg
  const svg = el('svg', {
    width: width + margin.left + margin.right,
    height: height + margin.top + margin.bottom,
  })
  card.appendChild(svg)
  const g = el('g', { transform: `translate(${margin.left}, ${margin.top})` })
  svg.appendChild(g)

  // clip path for the foreground (highlighted) bars
  const clipId = 'mdf-clip-' + Math.random().toString(36).slice(2, 8)
  const clipPath = el('clipPath', { id: clipId })
  const clipRect = el('rect', { x: 0, y: 0, width: 0, height })
  clipPath.appendChild(clipRect)
  g.appendChild(clipPath)

  const bgPath = el('path', { class: 'mdf-bg' })
  const fgPath = el('path', { class: 'mdf-fg', 'clip-path': `url(#${clipId})` })
  g.appendChild(bgPath)
  g.appendChild(fgPath)

  // axis
  const axis = el('g', { class: 'mdf-axis', transform: `translate(0, ${height})` })
  g.appendChild(axis)
  axis.appendChild(el('path', { d: `M0.5,6V0.5H${width - 0.5}V6` }))
  for (const t of ticks) {
    const tg = el('g', { transform: `translate(${x(t)}, 0)` })
    tg.appendChild(el('line', { y2: 6 }))
    const txt = el('text', { y: 9, dy: '.71em', 'text-anchor': 'middle' })
    txt.textContent = format(t)
    tg.appendChild(txt)
    axis.appendChild(tg)
  }

  // brush
  const brush = el('g', { class: 'mdf-brush' })
  g.appendChild(brush)
  const bgClickHit = el('rect', { class: 'mdf-bg-hit', width, height })
  const extentRect = el('rect', { class: 'mdf-extent', x: 0, y: 0, width: 0, height })
  brush.appendChild(bgClickHit)
  brush.appendChild(extentRect)
  const handles = [0, 1].map(i => makeHandle(brush, i, height))

  // current state
  let currentRange = []   // [] = no filter

  // ─── mouse interaction ────────────────────────────────────────────────
  // Three drag modes: background (start new selection), extent (translate),
  // resize handles (move one edge). All fire onMarkInput on every move and
  // onRangeChange after applying the new range. Coalescing is the caller's
  // responsibility — we want every move recorded for latency tracking.

  // background drag: new selection
  let bgDown = false, bgInitial = 0, bgLeftRef = 0
  bgClickHit.addEventListener('pointerdown', e => {
    bgDown = true
    bgClickHit.setPointerCapture(e.pointerId)
    bgLeftRef = brush.getBoundingClientRect().left
    bgInitial = apply(rx(e.clientX - bgLeftRef))
    api.onMarkInput?.()
    fireRange([bgInitial, bgInitial])
  })
  bgClickHit.addEventListener('pointermove', e => {
    if (!bgDown) return
    const cur = apply(rx(e.clientX - bgLeftRef))
    api.onMarkInput?.()
    fireRange(cur > bgInitial ? [bgInitial, cur] : [cur, bgInitial])
  })
  bgClickHit.addEventListener('pointerup', e => {
    bgDown = false
    bgClickHit.releasePointerCapture?.(e.pointerId)
    if (currentRange.length === 2 && currentRange[0] === currentRange[1]) fireRange([])
  })

  // extent drag: translate
  let exDown = false, exInitial = 0, exBase = [0, 0], exLeftRef = 0
  extentRect.addEventListener('pointerdown', e => {
    if (!currentRange.length) return
    exDown = true
    extentRect.setPointerCapture(e.pointerId)
    exLeftRef = brush.getBoundingClientRect().left
    exInitial = rx(e.clientX - exLeftRef)
    exBase = [currentRange[0], currentRange[1]]
    e.stopPropagation()
  })
  extentRect.addEventListener('pointermove', e => {
    if (!exDown) return
    const cur = rx(e.clientX - exLeftRef)
    const delta = cur - exInitial
    const span = exBase[1] - exBase[0]
    let lo = exBase[0] + delta
    let hi = exBase[1] + delta
    if (lo < domain[0]) { lo = domain[0]; hi = lo + span }
    else if (hi > domain[1]) { hi = domain[1]; lo = hi - span }
    api.onMarkInput?.()
    fireRange([apply(lo), apply(hi)])
  })
  extentRect.addEventListener('pointerup', e => {
    exDown = false
    extentRect.releasePointerCapture?.(e.pointerId)
  })

  // resize handles
  for (const h of handles) {
    h.el.addEventListener('pointerdown', e => {
      h.down = true
      h.el.setPointerCapture(e.pointerId)
      h.leftRef = brush.getBoundingClientRect().left
      e.stopPropagation()
    })
    h.el.addEventListener('pointermove', e => {
      if (!h.down) return
      const cur = apply(rx(e.clientX - h.leftRef))
      const other = currentRange[1 - h.i]
      api.onMarkInput?.()
      fireRange(cur < other ? [cur, other] : [other, cur])
    })
    h.el.addEventListener('pointerup', e => {
      h.down = false
      h.el.releasePointerCapture?.(e.pointerId)
    })
  }

  function fireRange(r) {
    currentRange = r
    drawRange(r)
    api.onRangeChange?.(r)
  }

  function drawRange(r) {
    if (!r.length) {
      extentRect.setAttribute('width', 0)
      clipRect.setAttribute('width', 0)
      handles.forEach(h => h.g.style.display = 'none')
      resetEl.style.display = 'none'
      return
    }
    const lo = x(r[0]), hi = x(r[1])
    const w = hi - lo
    extentRect.setAttribute('x', lo)
    extentRect.setAttribute('width', w)
    clipRect.setAttribute('x', lo)
    clipRect.setAttribute('width', w)
    handles.forEach((h, i) => {
      h.g.setAttribute('transform', `translate(${x(r[i])}, 0)`)
      h.g.style.display = ''
    })
    resetEl.style.display = ''
  }

  function setBars(bars, max) {
    const path = barPath(bars, max, domain, width, height, bucketSize)
    bgPath.setAttribute('d', path)
    fgPath.setAttribute('d', path)
  }

  const api = {
    onMarkInput: null,
    onRangeChange: null,
    setBars,
    setRange(r) { fireRange(r) },
    setRangeSilent(r) { currentRange = r; drawRange(r) },
  }
  return api
}

function makeHandle(parent, i, height) {
  const d = i ? 1 : -1
  const y = height / 3
  const path = 'M' + (.5 * d) + ',' + y
    + 'A6,6 0 0 ' + i + ' ' + (6.5 * d) + ',' + (y + 6)
    + 'V' + (2 * y - 6)
    + 'A6,6 0 0 ' + i + ' ' + (.5 * d) + ',' + (2 * y) + 'Z'
    + 'M' + (2.5 * d) + ',' + (y + 8) + 'V' + (2 * y - 8)
    + 'M' + (4.5 * d) + ',' + (y + 8) + 'V' + (2 * y - 8)
  const g = el('g', { class: 'mdf-resize ' + (i ? 'mdf-e' : 'mdf-w') })
  g.style.display = 'none'
  const hit = el('rect', { x: -3, width: 6, height })
  const p = el('path', { d: path })
  g.appendChild(hit)
  g.appendChild(p)
  parent.appendChild(g)
  return { i, el: hit, g, down: false, leftRef: 0 }
}

function el(name, attrs = {}) {
  const e = document.createElementNS(NS, name)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  return e
}

export function scale(input, output) {
  return v => {
    if (input[1] === input[0]) return 0
    const m = (v - input[0]) / (input[1] - input[0])
    return output[0] + m * (output[1] - output[0])
  }
}

export function barPath(bars, max, domain, width, height, bucketSize = 1) {
  if (!max || max === 0) return ''
  const x = scale(domain, [0, width])
  const y = scale([0, max], [height, 0])
  // Bar width = one bucket-step in pixels minus a 1px gap. Floor & clamp so
  // tiny charts (24 hours in 110px) still render >= 1px bars.
  const bw = Math.max(1, Math.floor(x(domain[0] + bucketSize) - x(domain[0]) - 1))
  let path = ''
  for (const k in bars) {
    const len = bars[k]
    if (!len) continue
    path += `M${x(+k)},${height}V${y(len)}h${bw}V${height}`
  }
  return path
}
