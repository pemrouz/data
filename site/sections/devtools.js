/* sections/devtools.js — §04 See your graph.
   b (THE PICK) · REAL. This section builds its own five-node graph on the
     page's runtime —
       trades  = $({ t1…t5 })          source
       buys    = trades.filter(buy)    rowop
       largest = buys.za('qty', 2)     ordered (top-2)
       typical = buys.median('px')     scalar (R-7)
       volume  = buys.sum('qty')       scalar
     — and a scripted writer issues REAL writes (update / add / remove / a
     batch) every ~1.5 s while the card is shown, on screen and the tab is
     visible. Everything the inline dock prints is engine-produced or measured
     in this tab:
       Tree   ← import('data/devtools').graph(trades) (id · op · height) +
                rowCount() / [value] (the two scalar cells are render-layer
                text() sinks) + the per-node ms of the latest CommitInfo;
       DAG    ← the same graph's nodes + edges list, columned by height;
       Events ← runtime().onCommit: seq · the delta printed from trades.sink ·
                the cascade (deltas per node, settle order) · Σ ms (kernel
                performance.now around each settle, summed);
       footer ← the latest commit's seq · nodes settled · Σ ms · origin.
     "open the real panel ▸" lazy-imports data/devtools-panel and mounts the
     REAL closed-shadow dock (mountPanel) on the right edge; click again closes.
     NOTE: while this card's onCommit hook is live the kernel measures per-node
     ms for EVERY commit on the page runtime (hooks.size > 0) — the hook is
     dropped whenever the card is off-screen / hidden.
   a (not picked, untouched) · ./devtools/smoke-a.js — the old canned dock. */
import { api, attest, put, REDUCED } from '../engine.js'
import { mountSmokeA } from './devtools/smoke-a.js'

const { $, value, node, render, text, runtime } = api
const { graph } = await import('data/devtools')

const section = document.getElementById('devtools')
const SEG = ['Tree', 'DAG', 'Events']
const rt = runtime()
const ORIGIN = Symbol('writer')

/* ---------- the five-node graph (this section's own, on the page runtime) ---------- */
const trades = $({
  t1: { sym: 'AAPL', side: 'buy',  qty: 200, px: 187.5 },
  t2: { sym: 'MSFT', side: 'sell', qty: 120, px: 411.2 },
  t3: { sym: 'AAPL', side: 'buy',  qty: 380, px: 182.4 },
  t4: { sym: 'NVDA', side: 'buy',  qty: 240, px: 191.9 },
  t5: { sym: 'TSLA', side: 'buy',  qty: 60,  px: 121.3 },
})
const buys = trades.filter((r) => r.side === 'buy')
const largest = buys.za('qty', 2)
const typical = buys.median('px')
const volume = buys.sum('qty')
const H = { trades, buys, largest, typical, volume }
const NAMES = new Map(Object.entries(H).map(([name, h]) => [h[node].id, name]))
const ORDER = ['trades', 'buys', 'largest', 'typical', 'volume']

/* ---------- the scripted writer: real writes, cycles back to the start ---------- */
const one = (w) => () => rt.withOrigin(ORIGIN, w)
const many = (w) => () => rt.batch(w, ORIGIN)
const SCRIPT = [
  one(() => trades.t3.qty.update(395)),
  one(() => trades.t1.px.update(188.1)),
  one(() => trades.set('t6', { sym: 'META', side: 'buy', qty: 310, px: 512.9 })),
  one(() => trades.t2.side.update('buy')),
  one(() => trades.t3.qty.update(380)),
  one(() => trades.get('t6').remove()),
  many(() => { trades.t1.qty.update(210); trades.t4.qty.update(225) }),
  one(() => trades.t2.side.update('sell')),
  one(() => trades.t1.px.update(187.5)),
  many(() => { trades.t1.qty.update(200); trades.t4.qty.update(240) }),
]
let step = 0
const write = () => { SCRIPT[step % SCRIPT.length](); step++ }

/* ---------- formatting ---------- */
const fmtVal = (v) => typeof v === 'number' ? (Number.isInteger(v) ? String(v) : (Math.round(v * 100) / 100).toString()) : typeof v === 'string' ? `'${v}'` : String(v)
const rowText = (r) => `{ ${Object.entries(r).map(([k, v]) => `${k}: ${fmtVal(v)}`).join(', ')} }`
const leaf = (v, path) => { let c = v; for (const p of path) { if (c == null) return undefined; c = c[p] } return c }
// the tab's clock quantum (performance.now granularity), measured once: a
// settle that reads 0 ms is printed as "< quantum" rather than an invented digit
const QUANTUM = (() => {
  let q = Infinity
  const t0 = performance.now()
  // ≤ 5 ticks, and never more than ~25 ms of busy-wait under a deliberately coarse clock
  for (let i = 0; i < 5; i++) { const a = performance.now(); let b = a; while (b === a) b = performance.now(); q = Math.min(q, b - a); if (b - t0 > 25) break }
  return Number(q.toPrecision(2))
})()
const msText = (x) => x > 0 ? `${x.toFixed(2)} ms` : `<${QUANTUM} ms`
// Σ over n settles: the kernel's sum of readings; when every reading is below the
// quantum the only honest bound is n × quantum, not one quantum
const sumText = (x, n) => x > 0 ? `${x.toFixed(2)} ms` : `<${Number((QUANTUM * Math.max(1, n)).toPrecision(2))} ms`

// one row delta → [verb, key, path, rest] in facts.md's spelling
function deltaText(d) {
  if (d.op === 'add') return ['add', String(d.key), '', rowText(d.row)]
  if (d.op === 'remove') return ['remove', String(d.key), '', '']
  if (d.path.length > 0) return ['update', String(d.key), '.' + d.path.join('.'), `${fmtVal(leaf(d.prev, d.path))} → ${fmtVal(leaf(d.row, d.path))}`]
  const parts = []
  for (const k of new Set([...Object.keys(d.prev ?? {}), ...Object.keys(d.row ?? {})]))
    if (!Object.is(d.prev?.[k], d.row?.[k])) parts.push(`.${k} ${fmtVal(d.prev?.[k])} → ${fmtVal(d.row?.[k])}`)
  return ['update', String(d.key), '', parts.join(' · ')]
}

/* ---------- the inline dock (variant b) ---------- */
function buildDock(host) {
  const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e }
  const at = (el, v, tier = 'runtime') => { attest(el, v, tier); return el }
  host.replaceChildren()

  // header
  const head = h('div', 'dtd-head')
  const brand = h('span', 'dtd-brand'); brand.append(h('b', '', '$'), 'data · devtools'); head.append(brand)
  const live = h('span', 'dtd-live'); live.append(h('i'), 'live'); head.append(live)
  host.append(head)

  // tabs + the header counts (from the graph)
  const tabs = h('div', 'dtd-tabs'), seg = h('div', 'dtd-seg')
  const segBtns = {}
  for (const t of SEG) { const b = h('button', t === 'Tree' ? 'on' : '', t); b.type = 'button'; b.addEventListener('click', () => setTab(t)); seg.append(b); segBtns[t] = b }
  tabs.append(seg)
  const meta = h('span', 'dtd-meta')
  const mNodes = h('b'), mSinks = h('b'), mH = h('b')
  meta.append(mNodes, ' nodes · ', mSinks, ' sinks · h ≤ ', mH)
  tabs.append(meta)
  host.append(tabs)

  // body
  const body = h('div', 'dtd-body')
  const graphPane = h('div', 'dtd-graph')
  const tree = h('div', 'dtd-tree'), dag = h('div', 'dtd-dag'); dag.hidden = true
  const insp = h('div', 'dtd-insp'); insp.hidden = true
  graphPane.append(tree, dag, insp)
  const events = h('div', 'dtd-events')
  const evHead = h('div', 'dtd-ev-head'); evHead.append('events · commits')
  const pauseBtn = h('button', '', '⏸ pause'); pauseBtn.type = 'button'
  const cnt = h('span', 'cnt')
  evHead.append(pauseBtn, cnt)
  const evList = h('div', 'dtd-ev-list')
  events.append(evHead, evList)
  body.append(graphPane, events)
  host.append(body)

  // footer ticker
  const foot = h('div', 'dtd-foot')
  const footL = h('span'), footR = h('span', 'r')
  const fSeq = h('b'), fN = h('b'), fMs = h('b')
  footL.append('seq ', fSeq, ' · ', fN, ' nodes settled · ', fMs)
  foot.append(footL, footR); host.append(foot)

  // ── the graph, as the engine reports it (filtered to this section's five ids) ──
  let sub = { nodes: [], edges: [] }, byId = new Map()
  function readGraph() {
    const g = graph(trades)
    const nodes = g.nodes.filter((n) => NAMES.has(n.id)).sort((a, b) => a.height - b.height || a.id - b.id)
    const edges = g.edges.filter((e) => NAMES.has(e.from) && NAMES.has(e.to))
    sub = { nodes, edges }
    byId = new Map(nodes.map((n) => [n.id, n]))
    return sub
  }
  readGraph()
  const liveSinks = () => ORDER.reduce((n, name) => n + H[name][node].effects.filter((e) => e.dead !== true).length, 0)
  const infoOf = (name) => byId.get(H[name][node].id)

  // ── tree rows: name (ours) · op#id · rows/value · height · ms ──
  const nodeEls = new Map() // name → { row, val, hh, ms, id, gnode? }
  const hasKids = (id) => sub.edges.some((e) => e.from === id)
  for (const name of ORDER) {
    const n = infoOf(name)
    const r = h('div', `dtd-row k-${n.kind}`)
    const nm = h('span', 'n')
    const caret = h('i', '', hasKids(n.id) ? '▾' : '·')
    nm.style.paddingLeft = `${12 + n.height * 14}px`
    const s = h('s'); const em = h('em', '', n.op); const id = at(h('span', 'id'), `#${n.id}`)
    s.append(em, id)
    nm.append(caret, h('b', '', name), s)
    const val = h('span', 'v')
    const hh = at(h('span', 'h'), `h${n.height}`)
    const ms = h('span', 'ms')
    r.append(nm, val, hh, ms)
    r.addEventListener('click', () => select(name))
    tree.append(r)
    nodeEls.set(name, { row: r, val, hh, ms, id, em })
  }
  // the two scalar cells are REAL render-layer sinks: text(view, fmt)
  const scalarCache = new Map()
  for (const name of ['typical', 'volume']) {
    const cell = nodeEls.get(name).val
    cell.setAttribute('data-attested', 'runtime')
    render(cell, text(H[name], fmtVal))
    scalarCache.set(name, cell.textContent)
  }
  const sinksLine = h('div', 'sinks')
  const sinksN = h('em')
  sinksLine.append(sinksN, ' · trades → sink · typical → text · volume → text')
  tree.append(sinksLine)

  // ── DAG (svg): one column per height, boxes 92×30, edges from the edge list ──
  const NS = 'http://www.w3.org/2000/svg', W = 92, Hh = 30, GX = 42, GY = 12, PAD = 14
  const edgeEls = new Map() // to-name → line
  function buildDag() {
    dag.replaceChildren()
    const maxH = Math.max(...sub.nodes.map((n) => n.height))
    const cols = Array.from({ length: maxH + 1 }, () => [])
    for (const n of sub.nodes) cols[n.height].push(n)
    const pos = new Map()
    const maxRows = Math.max(...cols.map((c) => c.length))
    const cw = PAD * 2 + cols.length * W + (cols.length - 1) * GX, ch = PAD * 2 + 14 + maxRows * Hh + (maxRows - 1) * GY
    cols.forEach((c, ci) => c.forEach((n, ri) => {
      const colH = c.length * Hh + (c.length - 1) * GY
      pos.set(n.id, { x: PAD + ci * (W + GX), y: PAD + 14 + (ch - PAD * 2 - 14 - colH) / 2 + ri * (Hh + GY) })
    }))
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${cw} ${ch}`)
    cols.forEach((c, i) => {
      const tx = document.createElementNS(NS, 'text'); tx.setAttribute('class', 'col'); tx.setAttribute('x', PAD + i * (W + GX)); tx.setAttribute('y', PAD + 2)
      at(tx, (`h${i}` + (c.some((n) => n.kind === 'source') ? ' · source' : '')).toUpperCase())
      svg.append(tx)
    })
    edgeEls.clear()
    for (const e of sub.edges) {
      const a = pos.get(e.from), b = pos.get(e.to)
      const l = document.createElementNS(NS, 'line')
      l.setAttribute('x1', a.x + W); l.setAttribute('y1', a.y + Hh / 2); l.setAttribute('x2', b.x); l.setAttribute('y2', b.y + Hh / 2)
      svg.append(l); edgeEls.set(NAMES.get(e.to), l)
    }
    for (const n of sub.nodes) {
      const name = NAMES.get(n.id), p = pos.get(n.id)
      const g = document.createElementNS(NS, 'g'); g.setAttribute('class', `gnode k-${n.kind}`); g.setAttribute('transform', `translate(${p.x},${p.y})`)
      const rect = document.createElementNS(NS, 'rect'); rect.setAttribute('width', W); rect.setAttribute('height', Hh)
      const t1 = document.createElementNS(NS, 'text'); t1.setAttribute('x', 8); t1.setAttribute('y', 13); at(t1, `${n.op}#${n.id}`)
      const t2 = document.createElementNS(NS, 'text'); t2.setAttribute('class', 'sub'); t2.setAttribute('x', 8); t2.setAttribute('y', 24); t2.textContent = name
      const title = document.createElementNS(NS, 'title'); at(title, `${n.op}#${n.id} · ${n.kind} · height ${n.height}`)
      g.append(title, rect, t1, t2)
      g.addEventListener('click', () => select(name))
      svg.append(g)
      nodeEls.get(name).gnode = g
    }
    dag.append(svg)
    const legend = h('div', 'legend'); legend.innerHTML = '<span><i class="s"></i>source</span><span><i></i>operator</span><span><i class="c"></i>scalar</span>'; dag.append(legend)
  }
  buildDag()

  // header counts + structural cells, re-read from the graph
  function refreshGraph() {
    const before = sub.nodes.map((n) => `${n.id}:${n.height}`).join()
    readGraph()
    if (sub.nodes.map((n) => `${n.id}:${n.height}`).join() !== before) buildDag()
    at(mNodes, sub.nodes.length); at(mSinks, liveSinks()); at(mH, Math.max(...sub.nodes.map((n) => n.height)))
    at(sinksN, `${liveSinks()} sinks`)
    for (const name of ORDER) {
      const n = infoOf(name), e = nodeEls.get(name)
      at(e.id, `#${n.id}`); at(e.hh, `h${n.height}`); put(e.em, n.op)
    }
  }

  // ── selection → inspect strip ──
  let selected = null
  function select(name) {
    selected = selected === name ? null : name
    for (const [k, e] of nodeEls) { e.row.classList.toggle('on', k === selected); e.gnode?.classList.toggle('on', k === selected) }
    renderInsp()
  }
  const longValue = (name) => {
    const hd = H[name]
    if (name === 'largest') return `[ ${hd[node].currentOrder().join(', ')} ]`
    if (hd[node].kind === 'scalar') return fmtVal(hd[value])
    return `{ ${Object.keys(hd[value]).join(', ')} }`
  }
  function renderInsp() {
    if (!selected) { insp.hidden = true; return }
    const n = infoOf(selected)
    const parents = n.parents.map((p) => { const m = byId.get(p); return m ? `${m.op}#${m.id}` : `#${p}` }).join(', ') || 'none'
    insp.replaceChildren()
    const kv = (k, v, code) => {
      insp.append(h('span', 'k', k))
      const s = h('span', 'val')
      if (code) s.append(at(h('code'), v)); else at(s, v)
      insp.append(s)
    }
    kv('inspect', `${selected} · ${n.op}#${n.id} · ${n.kind} · height ${n.height}`)
    kv('parents', parents)
    kv('value', longValue(selected), true)
    insp.hidden = false
  }

  // ── tabs ──
  function setTab(t) {
    for (const k of SEG) segBtns[k].classList.toggle('on', k === t)
    // a pane revealed later must not replay the flashes of commits it never showed
    for (const el of host.querySelectorAll('.flash, .gnode.hot, line.hot')) el.classList.remove('flash', 'hot')
    graphPane.hidden = t === 'Events'
    tree.hidden = t !== 'Tree'
    dag.hidden = t !== 'DAG'
    events.classList.toggle('is-full', t === 'Events')
  }
  setTab('Tree')

  // ── the two engine feeds: trades.sink (the delta) + runtime().onCommit (the cascade) ──
  const flash = (el) => { if (REDUCED) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash') }
  let lastWrite = { seq: -1, rows: [] }
  trades.sink({ apply(b) { lastWrite = { seq: b.seq, rows: b.rows } } })

  let seen = 0
  function onCommit(c) {
    const mine = c.nodes.filter((s) => NAMES.has(s.id))
    if (mine.length === 0) return
    seen++
    refreshGraph()
    // tree: rows / value cells + per-node ms from THIS CommitInfo
    const settled = new Map(mine.map((s) => [NAMES.get(s.id), s]))
    let total = 0
    for (const name of ORDER) {
      const e = nodeEls.get(name), hd = H[name]
      if (hd[node].kind !== 'scalar') {
        const nv = `${hd.rowCount()} rows`
        if (e.val.textContent !== nv) { at(e.val, nv); flash(e.val) }
      } else if (e.val.textContent !== scalarCache.get(name)) { scalarCache.set(name, e.val.textContent); flash(e.val) }
      const s = settled.get(name)
      if (s) {
        total += s.ms
        at(e.ms, msText(s.ms), 'measured'); e.ms.classList.add('hot'); flash(e.ms)
        if (e.gnode) { e.gnode.classList.remove('hot'); if (!REDUCED) void e.gnode.getBoundingClientRect(); e.gnode.classList.add('hot') }
        edgeEls.get(name)?.classList.add('hot')
      } else { e.ms.classList.remove('hot'); e.gnode?.classList.remove('hot'); edgeEls.get(name)?.classList.remove('hot') }
    }
    // events line: seq · the delta (from trades.sink) · Σ ms · the cascade
    const ev = h('div', 'dtd-ev is-new')
    const l1 = h('div', 'l1'), l2 = h('div', 'l2')
    l1.append(at(h('span', 'seq'), `seq ${c.seq}`))
    const w = h('span', 'w'); w.setAttribute('data-attested', 'runtime')
    const rows = lastWrite.seq === c.seq ? lastWrite.rows : []
    if (rows.length > 1) {
      w.append(h('s', '', 'batch'), ' ' + rows.map((d) => { const [verb, key, path, rest] = deltaText(d); return [verb, key, path, rest].filter(Boolean).join(' ') }).join(' · '))
    } else if (rows.length === 1) {
      const [verb, key, path, rest] = deltaText(rows[0])
      w.append(h('s', '', verb), ' ' + key)
      if (path) w.append(h('u', '', ' ' + path))
      if (rest) w.append(' ' + rest)
    } else w.append(h('s', '', 'downstream'), ' commit')
    l1.append(w, at(h('span', 'ms'), sumText(total, mine.length), 'measured'))
    mine.forEach((s, i) => {
      if (i) l2.append(h('span', 'a', '→'))
      l2.append(at(h('b'), `${NAMES.get(s.id)} ${s.deltas}Δ`))
    })
    for (const name of ORDER) if (!settled.has(name)) { l2.append(h('span', 'a', '→')); l2.append(at(h('span', 'z'), `${name} 0Δ`)) }
    ev.append(l1, l2)
    evList.prepend(ev)
    while (evList.children.length > 24) evList.lastChild.remove()
    at(cnt, `${seen} seen`)
    at(fSeq, c.seq); at(fN, mine.length); at(fMs, sumText(total, mine.length), 'measured')
    put(footR, `origin ${c.origin.description ?? 'anonymous'}`)
    flash(footL)
    if (selected) renderInsp()
  }
  // the row-count cells are written from the hook; while it is off (off-screen /
  // hidden) an outside write to `trades` would leave them behind the engine (the two
  // scalar cells are render sinks and never lag) — so re-read them whenever the hook
  // comes back, before the next commit
  function refreshCells() {
    refreshGraph()
    for (const name of ORDER) {
      const e = nodeEls.get(name), hd = H[name]
      if (hd[node].kind !== 'scalar') { const nv = `${hd.rowCount()} rows`; if (e.val.textContent !== nv) at(e.val, nv) }
    }
    if (selected) renderInsp()
  }
  let hook = null
  const hookOn = () => { if (!hook) { hook = rt.onCommit(onCommit); refreshCells() } }
  const hookOff = () => { if (hook) { hook.dispose(); hook = null } }

  // ── the writer (paused when hidden / off-screen / tab hidden / ⏸) ──
  let timer = 0, running = false, wanted = false, paused = false
  function schedule() { timer = setTimeout(() => { if (!running) return; write(); schedule() }, 1200 + Math.random() * 700) }
  function start() { wanted = true; hookOn(); if (running || paused) return; running = true; live.classList.remove('is-paused'); schedule() }
  function stop() { wanted = false; running = false; clearTimeout(timer); hookOff(); live.classList.add('is-paused') }
  pauseBtn.addEventListener('click', () => {
    paused = !paused
    pauseBtn.textContent = paused ? '▶ resume' : '⏸ pause'
    if (paused) { running = false; clearTimeout(timer); live.classList.add('is-paused') }
    else if (wanted) { running = false; start() }
  })

  // prime on load: four real commits so every node has settled at least once
  // (the ms column is never '—') and the events pane is never empty
  hookOn()
  for (let i = 0; i < 4; i++) write()
  live.classList.add('is-paused')

  return { start, stop }
}

/* ---------- wiring ---------- */
if (section) {
  const docVisible = () => document.visibilityState !== 'hidden'
  const vb = section.querySelector('[data-variant="b"]')
  const dockB = document.getElementById('devtools-dock-b')
  const b = buildDock(dockB)
  let bShown = !vb.hidden, bOnScreen = false
  const syncB = () => { if (bShown && bOnScreen && docVisible()) b.start(); else b.stop() }
  vb.addEventListener('variantshow', () => { bShown = true; syncB() })
  vb.addEventListener('varianthide', () => { bShown = false; syncB() })
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => { bOnScreen = es.some((e) => e.isIntersecting); syncB() }, { rootMargin: '120px' }).observe(dockB)
  } else { bOnScreen = true; syncB() }
  document.addEventListener('visibilitychange', syncB)

  // "open the real panel ▸": the REAL dock (devtools/panel/, closed shadow, right edge)
  const openBtn = document.getElementById('devtools-open-b')
  const pStatus = document.getElementById('devtools-panel-status-b')
  let panel = null, loading = false
  const panelOpen = () => !!document.querySelector('[data-v3-devtools]')
  const syncPanel = () => {
    const open = panelOpen()
    put(openBtn, open ? 'close the real panel ✕' : 'open the real panel ▸')
    if (!loading) put(pStatus, open ? 'docked on the right edge · the whole page runtime · click again or ✕ to close' : panel ? 'closed · the console API stays' : 'lazy — devtools/panel/ loads on click')
  }
  openBtn.addEventListener('click', async () => {
    if (loading) return
    if (!panel) {
      loading = true; openBtn.disabled = true; put(pStatus, 'loading devtools/panel/…')
      try { const m = await import('data/devtools-panel'); panel = m.mountPanel({ open: true }) }
      finally { loading = false; openBtn.disabled = false }
    } else if (panelOpen()) panel.close()
    else panel.open()
    syncPanel()
  })
  new MutationObserver(syncPanel).observe(document.body, { childList: true })
  syncPanel()

  // a · the old smoke dock (not picked; untouched)
  mountSmokeA(section)

  // probes
  window.__devtoolsSection = { trades, buys, largest, typical, volume, ids: [...NAMES.keys()], write }
}
