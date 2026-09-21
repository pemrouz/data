// sections/devtools/smoke-a.js — variant a (NOT picked, untouched behaviour):
// the old slide-in dock over a tiny in-memory model of a five-node graph.
// Canned writes are APPLIED to the model and every view is recomputed;
// timings are invented. This file is the smoke that used to live in
// devtools.js — moved here so the picked variant's code path (devtools.js)
// carries none of it. Exported: mountSmokeA(section).

const SEG = ['Tree', 'DAG', 'Events']

// ── the model ────────────────────────────────────────────────────────────────
function freshRows() {
  return {
    t1: { sym: 'AAPL', side: 'buy',  qty: 200, px: 187.5 },
    t2: { sym: 'MSFT', side: 'sell', qty: 120, px: 411.2 },
    t3: { sym: 'AAPL', side: 'buy',  qty: 380, px: 182.4 },
    t4: { sym: 'NVDA', side: 'buy',  qty: 240, px: 191.9 },
  }
}
function median(xs) { // R type 7
  const a = [...xs].sort((p, q) => p - q)
  if (!a.length) return 0
  const h = (a.length - 1) / 2, lo = Math.floor(h), hi = Math.ceil(h)
  return a[lo] + (a[hi] - a[lo]) * (h - lo)
}
function views(rows) {
  const buys = Object.entries(rows).filter(([, r]) => r.side === 'buy')
  const largest = [...buys].sort((a, b) => b[1].qty - a[1].qty || (a[0] < b[0] ? -1 : 1)).slice(0, 2).map(([k]) => k)
  return {
    trades: Object.keys(rows),
    buys: buys.map(([k]) => k),
    largest,
    typical: median(buys.map(([, r]) => r.px)),
    volume: buys.reduce((s, [, r]) => s + r.qty, 0),
  }
}
const NODES = [
  { name: 'trades',  op: 'source', id: 1, kind: 'source',   h: 0, parents: [] },
  { name: 'buys',    op: 'filter', id: 2, kind: 'operator', h: 1, parents: [1] },
  { name: 'largest', op: 'za',     id: 3, kind: 'operator', h: 2, parents: [2] },
  { name: 'typical', op: 'median', id: 4, kind: 'scalar',   h: 2, parents: [2] },
  { name: 'volume',  op: 'sum',    id: 5, kind: 'scalar',   h: 2, parents: [2] },
]
const fmt = (n) => Number.isInteger(n) ? String(n) : (Math.round(n * 100) / 100).toString()
const valueOf = (v, name) => ({
  trades: `${v.trades.length} rows`, buys: `${v.buys.length} rows`,
  largest: `${v.largest.length} rows`, typical: fmt(v.typical), volume: fmt(v.volume),
})[name]
const longValue = (v, name) => ({
  trades: `{ ${v.trades.join(', ')} }`, buys: `{ ${v.buys.join(', ')} }`,
  largest: `[ ${v.largest.join(', ')} ]`, typical: fmt(v.typical), volume: fmt(v.volume),
})[name]

// The canned write script — each step mutates `rows` and describes itself the
// way facts.md prints a delta (`update t3 .qty 500 → 380`). Loops forever.
const SCRIPT = [
  { keys: ['t3'], w: (r) => { r.t3.qty = 395 },                          text: ['update', 't3', '.qty', '380 → 395'] },
  { keys: ['t1'], w: (r) => { r.t1.px = 188.1 },                         text: ['update', 't1', '.px', '187.5 → 188.1'] },
  { keys: ['t5'], w: (r) => { r.t5 = { sym: 'TSLA', side: 'buy', qty: 60, px: 121.3 } }, text: ['add', 't5', '', "{ sym: 'TSLA', side: 'buy', qty: 60, px: 121.3 }"] },
  { keys: ['t2'], w: (r) => { r.t2.side = 'buy' },                       text: ['update', 't2', '.side', "'sell' → 'buy'"] },
  { keys: ['t3'], w: (r) => { r.t3.qty = 380 },                          text: ['update', 't3', '.qty', '395 → 380'] },
  { keys: ['t5'], w: (r) => { delete r.t5 },                             text: ['remove', 't5', '', ''] },
  { keys: ['t1', 't4'], w: (r) => { r.t1.qty = 210; r.t4.qty = 230 },    text: ['batch', '', '', 'update t1 .qty 200 → 210 · update t4 .qty 240 → 230'] },
  { keys: ['t2'], w: (r) => { r.t2.side = 'sell' },                      text: ['update', 't2', '.side', "'buy' → 'sell'"] },
  { keys: ['t1'], w: (r) => { r.t1.px = 187.5 },                         text: ['update', 't1', '.px', '188.1 → 187.5'] },
  { keys: ['t1', 't4'], w: (r) => { r.t1.qty = 200; r.t4.qty = 240 },    text: ['batch', '', '', 'update t1 .qty 210 → 200 · update t4 .qty 230 → 240'] },
]

function rowDeltas(before, after, touched) {
  const inB = new Set(before), inA = new Set(after)
  let d = 0
  for (const k of inA) if (!inB.has(k)) d++
  for (const k of inB) if (!inA.has(k)) d++
  for (const k of touched) if (inB.has(k) && inA.has(k)) d++
  return d
}
function cascade(before, after, step) {
  const d = { trades: step.keys.length }
  d.buys = rowDeltas(before.buys, after.buys, step.keys)
  d.largest = rowDeltas(before.largest, after.largest, step.keys)
  d.typical = before.typical === after.typical ? 0 : 1
  d.volume = before.volume === after.volume ? 0 : 1
  const settled = [['trades', d.trades]]
  if (d.buys > 0) settled.push(['buys', d.buys], ['largest', d.largest], ['typical', d.typical], ['volume', d.volume])
  return settled
}
const rnd = (lo, hi) => lo + Math.random() * (hi - lo)
const ms2 = (x) => (Math.round(x * 100) / 100).toFixed(2)

// ── the dock ─────────────────────────────────────────────────────────────────
function buildDock(host, { mode, onClose }) {
  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
  host.replaceChildren()

  const head = h('div', 'dtd-head')
  const brand = h('span', 'dtd-brand'); brand.append(h('b', '', '$'), 'data · devtools'); head.append(brand)
  const live = h('span', 'dtd-live'); live.append(h('i'), 'live'); head.append(live)
  if (onClose) { const x = h('button', 'dtd-x', '✕'); x.title = 'close panel'; x.setAttribute('aria-label', 'close the inspector'); x.addEventListener('click', onClose); head.append(x) }
  host.append(head)

  const tabs = h('div', 'dtd-tabs'), seg = h('div', 'dtd-seg')
  const segBtns = {}
  for (const t of SEG) { const b = h('button', t === 'Tree' ? 'on' : '', t); b.type = 'button'; b.addEventListener('click', () => setTab(t)); seg.append(b); segBtns[t] = b }
  tabs.append(seg)
  const meta = h('span', 'dtd-meta'); meta.innerHTML = '<b>5</b> nodes · <b>2</b> sinks · h ≤ 2'; tabs.append(meta)
  host.append(tabs)

  const body = h('div', 'dtd-body')
  const graph = h('div', 'dtd-graph')
  const tree = h('div', 'dtd-tree'), dag = h('div', 'dtd-dag'); dag.hidden = true
  const insp = h('div', 'dtd-insp'); insp.hidden = true
  graph.append(tree, dag, insp)
  const events = h('div', 'dtd-events')
  const evHead = h('div', 'dtd-ev-head'); evHead.append('events · commits')
  const pauseBtn = h('button', '', '⏸ pause'); pauseBtn.type = 'button'
  const cnt = h('span', 'cnt', '0 seen')
  evHead.append(pauseBtn, cnt)
  const evList = h('div', 'dtd-ev-list')
  events.append(evHead, evList)
  body.append(graph, events)
  host.append(body)

  const foot = h('div', 'dtd-foot')
  const footL = h('span', '', 'waiting for the first commit…'), footR = h('span', 'r', '')
  foot.append(footL, footR); host.append(foot)

  let rows = freshRows(), v = views(rows), seq = 76, step = 0, seen = 0, selected = null, paused = false
  const nodeEls = new Map()

  for (const n of NODES) {
    const r = h('div', `dtd-row k-${n.kind}`)
    const nm = h('span', 'n')
    const caret = h('i', '', n.h === 0 ? '▾' : n.h === 1 ? '▾' : '·')
    nm.style.paddingLeft = `${12 + n.h * 14}px`
    const b = h('b', '', n.name)
    const s = h('s'); s.innerHTML = `<em>${n.op}</em>#${n.id}`
    nm.append(caret, b, s)
    const val = h('span', 'v', valueOf(v, n.name))
    const hh = h('span', 'h', `h${n.h}`)
    const ms = h('span', 'ms', '—')
    r.append(nm, val, hh, ms)
    r.addEventListener('click', () => select(n.name))
    tree.append(r)
    nodeEls.set(n.name, { row: r, ms, val })
  }
  const sinks = h('div', 'sinks'); sinks.innerHTML = `<em>2 sinks</em> · largest → render · volume → wireSink`
  tree.append(sinks)

  const NS = 'http://www.w3.org/2000/svg', W = 92, H = 30, GX = 42, GY = 12, PAD = 14
  const cols = [[], [], []]; for (const n of NODES) cols[n.h].push(n)
  const pos = new Map()
  const maxRows = Math.max(...cols.map((c) => c.length))
  const cw = PAD * 2 + 3 * W + 2 * GX, ch = PAD * 2 + 14 + maxRows * H + (maxRows - 1) * GY
  cols.forEach((c, ci) => c.forEach((n, ri) => {
    const colH = c.length * H + (c.length - 1) * GY
    pos.set(n.name, { x: PAD + ci * (W + GX), y: PAD + 14 + (ch - PAD * 2 - 14 - colH) / 2 + ri * (H + GY) })
  }))
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${cw} ${ch}`)
  ;['h0 · source', 'h1', 'h2'].forEach((t, i) => { const tx = document.createElementNS(NS, 'text'); tx.setAttribute('class', 'col'); tx.setAttribute('x', PAD + i * (W + GX)); tx.setAttribute('y', PAD + 2); tx.textContent = t.toUpperCase(); svg.append(tx) })
  const edges = new Map()
  for (const n of NODES) for (const p of n.parents) {
    const pn = NODES.find((m) => m.id === p), a = pos.get(pn.name), b = pos.get(n.name)
    const l = document.createElementNS(NS, 'line')
    l.setAttribute('x1', a.x + W); l.setAttribute('y1', a.y + H / 2); l.setAttribute('x2', b.x); l.setAttribute('y2', b.y + H / 2)
    svg.append(l); edges.set(n.name, l)
  }
  for (const n of NODES) {
    const p = pos.get(n.name)
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', `gnode k-${n.kind}`); g.setAttribute('transform', `translate(${p.x},${p.y})`)
    const rect = document.createElementNS(NS, 'rect'); rect.setAttribute('width', W); rect.setAttribute('height', H)
    const t1 = document.createElementNS(NS, 'text'); t1.setAttribute('x', 8); t1.setAttribute('y', 13); t1.textContent = `${n.op}#${n.id}`
    const t2 = document.createElementNS(NS, 'text'); t2.setAttribute('class', 'sub'); t2.setAttribute('x', 8); t2.setAttribute('y', 24); t2.textContent = n.name
    g.append(Object.assign(document.createElementNS(NS, 'title'), { textContent: `${n.op}#${n.id} · ${n.kind} · height ${n.h}` }))
    g.append(rect, t1, t2)
    g.addEventListener('click', () => select(n.name))
    svg.append(g)
    nodeEls.get(n.name).gnode = g
  }
  dag.append(svg)
  const legend = h('div', 'legend'); legend.innerHTML = '<span><i class="s"></i>source</span><span><i></i>operator</span><span><i class="c"></i>scalar</span>'; dag.append(legend)

  function select(name) {
    selected = selected === name ? null : name
    for (const [k, e] of nodeEls) { e.row.classList.toggle('on', k === selected); e.gnode.classList.toggle('on', k === selected) }
    renderInsp()
  }
  function renderInsp() {
    if (!selected) { insp.hidden = true; return }
    const n = NODES.find((m) => m.name === selected)
    const parents = n.parents.map((p) => { const m = NODES.find((q) => q.id === p); return `${m.op}#${m.id}` }).join(', ') || '—'
    insp.replaceChildren()
    const kv = (k, val, code) => { insp.append(h('span', 'k', k)); const s = h('span', 'val'); if (code) { const c = h('code', '', val); s.append(c) } else s.textContent = val; insp.append(s) }
    kv('inspect', `${n.name} · ${n.op}#${n.id} · ${n.kind} · height ${n.h}`)
    kv('parents', parents)
    kv('value', longValue(v, n.name), true)
    insp.hidden = false
  }

  let tab = 'Tree'
  function setTab(t) {
    tab = t
    for (const k of SEG) segBtns[k].classList.toggle('on', k === t)
    graph.hidden = t === 'Events'
    tree.hidden = t !== 'Tree'
    dag.hidden = t !== 'DAG'
    events.classList.toggle('is-full', t === 'Events')
  }
  if (mode === 'split') setTab('Tree')

  const flash = (el) => { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash') }
  function commit() {
    const s = SCRIPT[step % SCRIPT.length]; step++
    const before = v
    s.w(rows); v = views(rows)
    const chain = cascade(before, v, s)
    seq++; seen++
    const total = rnd(0.07, 0.31), per = chain.map(() => rnd(0.2, 1)), sum = per.reduce((a, b) => a + b, 0)
    for (const n of NODES) {
      const e = nodeEls.get(n.name), nv = valueOf(v, n.name)
      if (e.val.textContent !== nv) { e.val.textContent = nv; flash(e.val) }
      const idx = chain.findIndex(([k]) => k === n.name)
      if (idx >= 0) { e.ms.textContent = `${ms2(total * per[idx] / sum)} ms`; e.ms.classList.add('hot'); flash(e.ms); e.gnode.classList.remove('hot'); void e.gnode.getBoundingClientRect(); e.gnode.classList.add('hot') }
      else e.ms.classList.remove('hot')
      if (idx >= 0 && edges.get(n.name)) edges.get(n.name).classList.add('hot'); else edges.get(n.name)?.classList.remove('hot')
    }
    const ev = h('div', 'dtd-ev is-new')
    const l1 = h('div', 'l1'), l2 = h('div', 'l2')
    l1.append(h('span', 'seq', `seq ${seq}`))
    const w = h('span', 'w')
    const [verb, key, path, rest] = s.text
    const vs = h('s', '', verb); w.append(vs)
    if (key) w.append(' ', key)
    if (path) { const u = h('u', '', ' ' + path); w.append(u) }
    if (rest) w.append(' ' + rest)
    l1.append(w, h('span', 'ms', `${ms2(total)} ms`))
    chain.forEach(([k, d], i) => {
      if (i) l2.append(h('span', 'a', '→'))
      const b = h(d ? 'b' : 'span', d ? '' : 'z', `${k} ${d}Δ`); l2.append(b)
    })
    ev.append(l1, l2)
    evList.prepend(ev)
    while (evList.children.length > 24) evList.lastChild.remove()
    cnt.textContent = `${seen} seen`
    footL.innerHTML = `seq <b>${seq}</b> · ${chain.length} node${chain.length === 1 ? '' : 's'} settled · <b>${ms2(total)} ms</b>`
    footR.textContent = `origin local`
    flash(footL)
    if (selected) renderInsp()
  }

  let timer = 0, running = false, wanted = false
  function schedule() { timer = setTimeout(() => { if (!running) return; commit(); schedule() }, 1200 + Math.random() * 700) }
  function start() { wanted = true; if (running || paused) return; running = true; live.classList.remove('is-paused'); schedule() }
  function stop() { wanted = false; running = false; clearTimeout(timer); live.classList.add('is-paused') }
  pauseBtn.addEventListener('click', () => {
    paused = !paused
    pauseBtn.textContent = paused ? '▶ resume' : '⏸ pause'
    if (paused) { running = false; clearTimeout(timer); live.classList.add('is-paused') }
    else if (wanted) { running = false; start() }
  })
  const prime = () => { if (!evList.children.length) { commit(); commit(); commit(); commit() } }

  return { start: () => { prime(); start() }, stop }
}

// ── wiring (variant a only) ──────────────────────────────────────────────────
export function mountSmokeA(section) {
  const docVisible = () => document.visibilityState !== 'hidden'
  const va = section.querySelector('[data-variant="a"]')
  const btn = document.getElementById('devtools-mount-a')
  const status = document.getElementById('devtools-status-a')
  const dockA = document.getElementById('devtools-dock-a')
  if (!va || !btn || !status || !dockA) return
  let a = null, aOpen = false, aShown = !va.hidden
  const closeA = () => {
    aOpen = false
    a?.stop()
    dockA.classList.remove('is-open')
    setTimeout(() => { if (!aOpen) dockA.hidden = true }, 260)
    btn.disabled = false
    btn.textContent = 'mount the inspector on this page ▸'
    status.innerHTML = 'closed · <code>$.devtools.panel.open()</code> brings it back'
  }
  const openA = () => {
    if (!a) a = buildDock(dockA, { mode: 'tabs', onClose: closeA })
    aOpen = true
    btn.disabled = true
    btn.textContent = 'inspector mounted ✓'
    status.textContent = 'loading devtools/…'
    dockA.hidden = false
    requestAnimationFrame(() => requestAnimationFrame(() => dockA.classList.add('is-open')))
    setTimeout(() => {
      status.innerHTML = 'mounted · <b>5</b> nodes · <b>2</b> sinks · see the right-edge dock →'
      if (aShown && docVisible()) a.start()
    }, 320)
  }
  btn.addEventListener('click', () => { if (!aOpen) openA() })
  va.addEventListener('variantshow', () => { aShown = true; if (aOpen && docVisible()) a?.start() })
  va.addEventListener('varianthide', () => { aShown = false; a?.stop() })
  document.addEventListener('visibilitychange', () => { if (aOpen && aShown) { if (docVisible()) a?.start(); else a?.stop() } })
}
