// Devtools overlay panel.
//
// Graph-first edge-anchored dock + slide-in inspector + Alt-hover badges,
// driven by the public devtools API exposed in devtools/index.ts
// ($.graph, $.inspect, $.trace, $.profile, $.fromDOM, $.cascades). Pure DOM,
// no framework dependency. The host is a closed shadow root so page CSS
// can't bleed in.
//
// Public entry points: mount(rootProxy?) auto-discovers the first live root
// when called without args. unmount() tears down. getShell() returns the
// live panel object ({ host, root, dock, destroy }) — used by
// $.devtools.panel.shell to expose the panel to test code / advanced
// scripting without having to walk through the closed shadow.
import { $, view, ViewProxy } from '../../core.ts'
import { iterRoots } from '../walk.ts'

// $.graph / $.inspect / $.trace / $.profile are attached when 'data/devtools'
// is imported (this panel is lazy-loaded from there, so they're guaranteed
// to be present by the time mount runs).

const TABS = ['inspect', 'events', 'profile']

// Module-level current-mount so mount() is idempotent and unmount() has
// something to tear down. `pollTimer` covers the common case where devtools
// is imported BEFORE the host app's first $() call (auto-mount fires while
// iterRoots is still empty) — we poll briefly until the first root appears.
let current: any = null
let pollTimer: any = null

export function mount(rootProxy?: any) {
  if (typeof document === 'undefined') return null
  if (current) return current
  if (!rootProxy) {
    const first = iterRoots().next().value
    if (first) rootProxy = new ViewProxy(first)
  }
  if (rootProxy) {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
    current = mountPanel({ rootProxy })
    return current
  }
  // No live roots yet. Poll up to ~5s — enough for a host app to wire up
  // its first proxy in normal page-load flows. If still nothing after that,
  // the user can call $.devtools.panel.open(proxy) explicitly.
  if (!pollTimer) {
    let tries = 0
    const tick = () => {
      pollTimer = null
      if (current) return                             // explicit mount won the race
      const r = iterRoots().next().value
      if (r) { current = mountPanel({ rootProxy: new ViewProxy(r) }); return }
      if (++tries < 100) pollTimer = setTimeout(tick, 50)
    }
    pollTimer = setTimeout(tick, 0)
  }
  return null
}

export function unmount() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
  if (!current) return
  try { current.destroy() } catch {}
  current = null
}

export function getShell() { return current }

function mountPanel({ rootProxy }: any) {
  const host = document.createElement('div')
  host.className = '__ripple_panel_host'
  document.body.appendChild(host)
  const root = host.attachShadow({ mode: 'closed' })
  root.appendChild(makeStyle())

  // ─── shell ────────────────────────────────────────────────────────────
  const dock = el('aside', 'dock')
  root.appendChild(dock)

  // Outer resize handle. The dock is anchored to the right edge of the
  // viewport; the handle sits on its LEFT edge so dragging leftward widens
  // the dock toward the page content. Persisted to localStorage so the user
  // doesn't have to re-resize on every reload.
  const DOCK_WIDTH_KEY = 'data-devtools-dock-width'
  const DOCK_MIN = 320
  const dockMax = () => Math.max(DOCK_MIN, window.innerWidth - 60)
  const savedWidth = (() => {
    const raw = parseInt(localStorage.getItem(DOCK_WIDTH_KEY) || '', 10)
    return Number.isFinite(raw) ? Math.max(DOCK_MIN, Math.min(dockMax(), raw)) : null
  })()
  if (savedWidth != null) dock.style.width = savedWidth + 'px'

  const dockResize = el('div', 'dock-resize')
  dockResize.title = 'drag to resize the dock'
  dock.appendChild(dockResize)
  // Pointer drag on the handle adjusts dock width. Dragging LEFT (negative dx)
  // widens the dock because the right edge stays pinned. CSS keeps the dock's
  // explicit inline width even after the inspector opens — the
  // `.with-inspector` width rule only applies when no inline width is set
  // (handled via a CSS variable fallback below).
  let dockResizeDrag: any = null
  dockResize.addEventListener('pointerdown', (e: any) => {
    dockResizeDrag = { startX: e.clientX, startW: dock.getBoundingClientRect().width }
    try { dockResize.setPointerCapture(e.pointerId) } catch {}
    dockResize.classList.add('dragging')
    e.preventDefault()
  })
  dockResize.addEventListener('pointermove', (e: any) => {
    if (!dockResizeDrag) return
    const dx = e.clientX - dockResizeDrag.startX
    const w = Math.max(DOCK_MIN, Math.min(dockMax(), dockResizeDrag.startW - dx))
    dock.style.width = w + 'px'
  })
  const endDockResize = (e: any) => {
    if (!dockResizeDrag) return
    dockResizeDrag = null
    dockResize.classList.remove('dragging')
    try { dockResize.releasePointerCapture(e.pointerId) } catch {}
    localStorage.setItem(DOCK_WIDTH_KEY, String(Math.round(dock.getBoundingClientRect().width)))
  }
  dockResize.addEventListener('pointerup',     endDockResize)
  dockResize.addEventListener('pointercancel', endDockResize)

  const header = el('div', 'dock-header')
  header.append(
    el('span', 'brand', { text: 'data devtools' }),
    (() => {
      const tools = el('div', 'tools')
      const hover = mkBtn('⊙', 'arm Alt-hover (or hold Alt)')
      const pick  = mkBtn('◎', 'pick a DOM element to find its view')
      const close = mkBtn('✕', 'close panel')
      tools.append(hover, pick, close)
      hover.addEventListener('click', () => altHover.toggleArm())
      pick.addEventListener('click', () => domPicker.toggleArm())
      // Route through the module-level unmount(), not the inner destroy()
      // directly: unmount() runs destroy() AND clears the module `current`, so a
      // subsequent panel.open()/mount() builds a fresh panel instead of
      // returning the dead shell (mount() early-returns `if (current)`).
      close.addEventListener('click', () => unmount())
      tools.dataset.role = 'tools'
      return tools
    })(),
  )
  dock.appendChild(header)

  // toolbar2: just Tree | DAG. Both render the reactive pipeline — chains of
  // operators rooted at the source view, with terminal sinks summarised into
  // a "→N" chip on each node. To see the DOM elements those chips represent,
  // click the node and look at the Bound DOM section of the inspector.
  const toolbar2 = el('div', 'dock-toolbar2')
  const layoutLabel = el('span', 'layout-pick-label', { text: 'layout:' })
  const seg = el('div', 'seg')
  const treeBtn = el('button', '',       { text: 'Tree' })
  const dagBtn  = el('button', 'active', { text: 'DAG'  })
  seg.append(treeBtn, dagBtn)
  toolbar2.append(layoutLabel, seg)
  dock.appendChild(toolbar2)
  // DAG is the default — it's the geometry the panel is designed around (the
  // graph-first edge-anchored dock). Tree stays one click away for users who
  // want the indented outline.
  let layout = 'dag'
  const setLayout = (next: any) => {
    layout = next
    treeBtn.classList.toggle('active', next === 'tree')
    dagBtn.classList.toggle('active', next === 'dag')
    dagView = { scale: null, tx: null, ty: null }   // auto-fit on (re-)entry
    rerenderGraph()
  }
  treeBtn.addEventListener('click', () => setLayout('tree'))
  dagBtn .addEventListener('click', () => setLayout('dag'))

  // Body wrapper: a flex row that holds the graph on the left and (optionally)
  // the inspector on the right. Using flex instead of grid because grid
  // auto-placement was bumping the inspector into a fourth row beneath the
  // graph on some layouts; flex row keeps them strictly side-by-side.
  const dockBody = el('div', 'dock-body')
  dock.appendChild(dockBody)
  const graphPane = el('div', 'graph-pane')
  dockBody.appendChild(graphPane)

  // ─── graph render ────────────────────────────────────────────────────
  let selectedView: any = null    // live View ref of the currently selected node — survives rerenders
  let focusedPath: any  = null    // DAG focus: slash-joined sink-index path; ancestors+descendants stay bright, others dim

  // Density controls — visible in DAG mode. Defaults trade information for
  // legibility: terminal sinks collapsed into a count, sibling children with
  // similar key shape clustered. User can toggle either off to see the raw
  // graph.
  let hideSinks    = true
  let heatmapMode  = false

  // Pan/zoom state for DAG mode. Hoisted out of renderDag so it survives the
  // frequent rerenders caused by trace events / heatmap ticks. Reset to null
  // means "auto-fit on next render"; once the user manually pans or zooms,
  // we capture the actual numbers and stop auto-fitting.
  let dagView: any = { scale: null, tx: null, ty: null }

  // Heat map for activity overlay. Keyed by node _key, value is the last
  // event timestamp (performance.now()). Color decays with age in render.
  // Trace subscription is installed lazily so the cost is only paid when the
  // user turns the heatmap on.
  const heat = new Map()
  let heatDispose: any = null
  let heatTick: any = null
  const startHeatmap = () => {
    if (heatDispose) return
    heatDispose = ($ as any).trace(rootProxy, {
      log: false,
      onEvent: (e: any) => {
        const k = (e.key || []).join('.') || '<root>'
        heat.set(k, performance.now())
        // Mark every ancestor as warm too so the path up to the root glows.
        // Cheap heuristic: prefix-set of the key.
        if (e.key && e.key.length) {
          for (let i = e.key.length - 1; i >= 0; i--) {
            const ak = e.key.slice(0, i).join('.') || '<root>'
            if (!heat.has(ak) || heat.get(ak) < performance.now() - 100) heat.set(ak, performance.now())
          }
        }
        scheduleRewalk()
      },
    })
    // Periodic tick so heat decay is visible even when nothing is firing.
    heatTick = setInterval(() => { if (layout === 'dag') rerenderGraph() }, 500)
  }
  const stopHeatmap = () => {
    if (heatDispose) { heatDispose(); heatDispose = null }
    if (heatTick)    { clearInterval(heatTick); heatTick = null }
    heat.clear()
  }

  let rwQueued = false
  const scheduleRewalk = () => {
    if (rwQueued) return
    rwQueued = true
    requestAnimationFrame(() => { rwQueued = false; rerenderGraph(); refreshInspector() })
  }

  const TERMINAL_KINDS = new Set(['dom', 'connect', 'linked-alias'])
  // Cycle nodes are walk.ts's marker for "this view was already visited
  // upstream" — treat them as leaves to avoid loops.

  // ────────────────────────────────────────────────────────────────────
  // Local graph walk — produces the same shape as $.graph(rootProxy) but
  // ALSO carries the live View object on every node as a non-enumerable
  // `_view` field. The inspector reads `_view` directly to find the exact
  // operator's downstream DOM bindings.
  //
  // Why we don't use $.graph(rootProxy):
  //   $.graph emits a serialisable snapshot — no live refs. Trying to map
  //   nodes back to live views by (kind, key, ctor) collides for every
  //   operator that shares a ctor (e.g. three different `.filter(...)`
  //   ops on `items` all hash to "operator|<root>|FilterValue"). With
  //   `_view` on each snapshot node, no lookup table is needed.
  // ────────────────────────────────────────────────────────────────────
  const summarizeValue = (v: any) => {
    if (v === null || v === undefined) return v
    const t = typeof v
    if (t === 'string') return v.length > 80 ? v.slice(0, 77) + '…' : v
    if (Array.isArray(v)) return `Array(${v.length})`
    if (t === 'object') return `{ keys: ${Object.keys(v).length} }`
    return String(v)
  }
  const classifyLocal = (s: any) => {
    const n = s?.constructor?.name
    if (n === 'DOMSink') return 'dom'
    if (n === 'ArrSink' || n === 'PropSink' || n === 'FunctionSink') return 'connect'
    return 'sink'
  }

  function walkGraph(rootProxy: any) {
    const rv = rootProxy?.[view]
    if (!rv) return null
    const seen = new WeakSet()
    const walk = (v: any, parent: any): any => {
      if (seen.has(v)) {
        return { key: [...v.key], kind: 'cycle', children: [], sinks: [], _view: v, _parent: parent }
      }
      seen.add(v)
      // LinkedView alias — don't recurse into the target.
      if ('src' in v && v.src && v.src !== v) {
        return {
          key: [...v.key], name: v.name, kind: 'linked-alias',
          aliasOf: v.src.key ? [...v.src.key] : [],
          children: [], sinks: [], _view: v, _parent: parent,
        }
      }
      const node: any = {
        key: [...v.key], name: v.name,
        kind: v.p ? 'child' : 'root',
        value: summarizeValue(v.value),
        children: [], sinks: [], _view: v, _parent: parent,
      }
      v.each?.((_n: any, child: any) => node.children.push(walk(child, node)))
      v.sink?.((s: any) => {
        if (s && typeof s === 'object' && s.view) {
          // Operator — recurse into its internal view, then re-tag.
          const opNode = walk(s.view, node)
          opNode.kind = 'operator'
          opNode.ctor = s.constructor.name
          node.sinks.push(opNode)
        } else if (s && typeof s === 'object') {
          // Terminal sink — DOMSink / PropSink / ArrSink / FunctionSink.
          node.sinks.push({
            key: [...v.key],
            kind: classifyLocal(s),
            ctor: s.constructor?.name || 'anonymous',
            children: [], sinks: [],
            _sink: s, _parent: node,
          })
        }
      })
      return node
    }
    return walk(rv, null)
  }

  // Operator ctor → method name (for the chain expression in the IDENTITY
  // card). We can't recover the original arg the user passed (`.filter(p)` —
  // p is a closure on the FilterValue instance), so the expression shows the
  // method shape only: `items.filter().length()`. The Live VALUE card gives
  // the user the actual filtered-data result.
  // Hoisted to module scope so `nodeLabel` (used by both the graph and the
  // chain builder) can route through the same table — otherwise the graph
  // would show ".filterstring()" while the IDENTITY card shows ".filter()".

  function buildChain(node: any) {
    const segments: any[] = []
    let cur = node
    while (cur) { segments.unshift(cur); cur = cur._parent }
    if (segments.length === 0) return '?'
    let s = ''
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      if (i === 0) s += seg.name || 'root'
      else if (seg.kind === 'operator')      s += `.${methodOfCtor(seg.ctor)}()`
      else if (seg.kind === 'child')         s += `.${seg.name ?? '?'}`
      else if (seg.kind === 'linked-alias')  s += `~>${(seg.aliasOf || []).join('.') || 'root'}`
      else if (seg.kind === 'cycle')         s += '↻'
      else                                   s += `[${seg.kind}]`
    }
    return s
  }

  function formatLiveValue(v: any, maxLen = 220): any {
    if (v === undefined) return 'undefined'
    if (v === null) return 'null'
    const t = typeof v
    if (t === 'string') {
      const trimmed = v.length > maxLen ? v.slice(0, maxLen) + '…' : v
      return JSON.stringify(trimmed)
    }
    if (t === 'number' || t === 'bigint' || t === 'boolean') return String(v)
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]'
      const previews = v.slice(0, 4).map(x => '  ' + formatLiveValue(x, 60))
      return `Array(${v.length}) [\n${previews.join(',\n')}${v.length > 4 ? ',\n  …' : ''}\n]`
    }
    if (t === 'object') {
      const keys = Object.keys(v)
      if (keys.length === 0) return '{}'
      const previews = keys.slice(0, 4).map(k => `  ${k}: ${formatLiveValue(v[k], 60)}`)
      return `{\n${previews.join(',\n')}${keys.length > 4 ? ',\n  …' : ''}\n}`
    }
    return String(v)
  }
  function valueTypeLabel(v: any) {
    if (v === undefined) return 'undefined'
    if (v === null)      return 'null'
    if (Array.isArray(v))return `Array(${v.length})`
    const t = typeof v
    if (t === 'object')  return `Object · ${Object.keys(v).length} key${Object.keys(v).length === 1 ? '' : 's'}`
    return t[0].toUpperCase() + t.slice(1)
  }

  // PropSink-as-DOM detection.
  //
  // Most reactive bindings in the render layer go through a PropSink, not
  // a DOMSink. For `strong.text(active)`, render/index.ts creates a `Text`
  // (subclass of `Prop`) and does `active.connect(this, 'set')` — that's a
  // PropSink whose `.obj` is the `Text` Prop instance and `.prop` is `'set'`.
  // The Prop instance carries `.parent` (the host DOM element) which is the
  // thing the user actually sees update. Same shape for `.attr`, `.class`,
  // `.style`, `.id`. Without unwrapping that, we'd mis-label every text /
  // attr / class binding as a "non-DOM connect" sink.
  function propSinkDomTarget(s: any) {
    if (!s || s.constructor?.name !== 'PropSink') return null
    const obj = s.obj
    if (!obj) return null
    // Prop subclasses all carry `.parent` = the host element after create().
    if (obj.parent && obj.parent.nodeType) {
      const ctor = obj.constructor?.name || ''
      // The Prop's `.name` is the user-supplied identifier (e.g. attribute
      // name); `.dom` for Text is the actual text node. We hand back the
      // host element so the user can flash it.
      let label: any
      switch (ctor) {
        case 'Text':  label = 'textContent';     break
        case 'Attr':  label = `[${obj.name}]`;   break
        case 'Class': label = `.${obj.name}`;    break
        case 'ID':    label = '#id';             break
        case 'Style': label = `style.${obj.name}`; break
        default:      label = `${ctor || 'prop'}.${s.prop}`
      }
      return { el: obj.parent, kind: ctor.toLowerCase() || 'prop', label }
    }
    // Manual case: user did `proxy.connect(realDomNode, 'textContent')`.
    if (obj.nodeType) return { el: obj, kind: 'prop', label: `.${s.prop}` }
    return null
  }

  // Recursively walk a live view's sinks, collecting every DOM-driving sink
  // (DOMSink iteration host, plus PropSinks whose target is a Prop attached
  // to a DOM element). FunctionSink / ArrSink stay in `others`.
  function collectBindings(liveView: any) {
    const dom: any[] = []        // { el, via, kind, label }
    const others: any[] = []     // { kind, ctor, via }
    if (!liveView) return { dom, others }
    const seen = new WeakSet()
    const recurse = (v: any, viaLabel: any) => {
      if (!v || seen.has(v)) return
      seen.add(v)
      v.sink?.((s: any) => {
        if (!s || typeof s !== 'object') return
        // 1) DOMSink — iteration host. The user-visible element is .parent.
        if (s.constructor?.name === 'DOMSink' && s.parent?.classList) {
          dom.push({ el: s.parent, via: viaLabel, kind: 'iteration', label: 'children iteration' })
          return
        }
        // 2) PropSink whose target ultimately writes to a DOM element.
        const propTarget = propSinkDomTarget(s)
        if (propTarget) {
          dom.push({ el: propTarget.el, via: viaLabel, kind: propTarget.kind, label: propTarget.label })
          return
        }
        // 3) Operator — recurse into its internal view.
        if (s.view) {
          const ctor = s.constructor?.name || 'op'
          const lbl  = viaLabel ? `${viaLabel} → ${ctor}` : ctor
          recurse(s.view, lbl)
          return
        }
        // 4) Other terminal sinks that don't drive DOM.
        const n = s.constructor?.name
        if (n === 'ArrSink' || n === 'PropSink' || n === 'FunctionSink') {
          others.push({ kind: 'connect', ctor: n, via: viaLabel })
        }
      })
    }
    recurse(liveView, '')
    return { dom, others }
  }

  const rerenderGraph = () => {
    graphPane.innerHTML = ''
    const tree = walkGraph(rootProxy)      // {key, kind, value, children, sinks, _view, ...}
    if (!tree) return
    if (layout === 'tree') graphPane.appendChild(renderTree(tree))
    else                   graphPane.appendChild(renderDag(tree))
  }

  // Shared helpers used by renderTree and renderDag.
  const isTerm = (n: any) => TERMINAL_KINDS.has(n.kind)
  // Recursively count terminal sinks beneath a graph node so a "→N" chip on
  // the immediate parent reflects the *real* terminal tally (across deeper
  // operators we may also be collapsing). Iterative to avoid stack issues
  // on deep chains.
  const termCountDeep = (n: any) => {
    let c = 0
    const stack = [n]
    while (stack.length) {
      const x = stack.pop()
      for (const s of x.sinks || []) {
        if (isTerm(s)) c++
        else stack.push(s)
      }
    }
    return c
  }

  function renderTree(node: any, depth = 0) {
    // Pipeline-only walk: children are intentionally skipped at every level
    // (root.children = items.[*], operator.children = filtered output rows).
    // The user wants Tree to show JUST the reactive pipeline — operators +
    // a terminal-count chip on each node — same shape Pipeline mode shows
    // horizontally. To inspect items.[*] sub-views, switch to Containment,
    // Swimlanes, or Progressive.
    const sinksAll = node.sinks || []
    const visibleSinks = hideSinks ? sinksAll.filter((s: any) => !TERMINAL_KINDS.has(s.kind)) : sinksAll
    let hiddenTerm = 0
    if (hideSinks) {
      for (const s of sinksAll) {
        if (TERMINAL_KINDS.has(s.kind)) { hiddenTerm++; hiddenTerm += termCountDeep(s) }
      }
    }

    const wrap = el('div', 'tnode' + (depth === 0 ? ' root' : ''))
    const row = el('div', 'tnode-row')
    ;(row as any)._view = node._view   // expando — used by markSelection to (re)highlight without rerender
    if (selectedView && selectedView === node._view) row.classList.add('selected')
    const hasKids = visibleSinks.length > 0
    if (hasKids) row.append(el('span', 'caret', { text: '▾' }))
    row.append(
      el('span', `kind kind-${node.kind}`, { text: shortKind(node) }),
      el('span', 'name',  { text: nodeLabel(node) }),
    )
    if (hiddenTerm > 0) {
      const chip = el('span', 'tnode-chip', { text: `→${hiddenTerm}` })
      chip.title = `${hiddenTerm} DOM/connect sink(s) — click the node, then look at the Bound DOM section in the inspector to see which elements they drive`
      row.append(chip)
    }
    row.addEventListener('click', (e: any) => {
      e.stopPropagation()
      selectedView = node._view
      openInspector(node)
      markSelection()
    })
    wrap.append(row)
    if (hasKids) {
      const kids = el('div', 'tnode-kids')
      for (const s of visibleSinks) kids.appendChild(renderTree(s, depth + 1))
      wrap.append(kids)
    }
    return wrap
  }

  // ════════════════════════════════════════════════════════════════════
  // DAG view — fresh implementation.
  //
  // Renders the reactive pipeline as a node-link graph: root + operator
  // chains. Terminal sinks (DOM / connect / linked-alias) are summarised
  // into a "→N" chip per node; structural children (items.[*]) are
  // intentionally skipped — same data shape as the Tree view, different
  // geometry (BFS-positioned node-link diagram with pan/zoom).
  //
  // Why tree-shaped walk with no dedup: every operator's internal view
  // typically lives at key=[], so a Map keyed by `.key.join('.')` collapses
  // every operator to one node — which is what made the previous DAG view
  // not work. walk.ts already returns a 'cycle' node for repeated views
  // (WeakSet keyed by view identity); we skip those. The first occurrence
  // of any shared operator becomes its visible position.
  // ════════════════════════════════════════════════════════════════════
  function renderDag(tree: any) {
    // ── 1. Walk ─────────────────────────────────────────────────────
    // Each node gets a stable _path (slash-joined sink-indices from root)
    // — used for selection + focus that survives rerenders.
    const nodes: any[] = []
    const edges: any[] = []
    const sinkChips = new Map()

    const visit = (n: any, depth: any, path: any): any => {
      if (n.kind === 'cycle') return null
      const id = nodes.length
      nodes.push({ ...n, _depth: depth, _path: path })

      let hidden = 0
      let sinkIdx = 0
      for (const s of n.sinks || []) {
        if (s.kind === 'cycle') continue
        if (hideSinks && TERMINAL_KINDS.has(s.kind)) {
          hidden++; hidden += termCountDeep(s)
          continue
        }
        const childId = visit(s, depth + 1, path ? `${path}/${sinkIdx}` : `${sinkIdx}`)
        if (childId != null) edges.push([id, childId])
        sinkIdx++
      }
      if (hidden > 0) sinkChips.set(id, hidden)
      return id
    }
    visit(tree, 0, '')
    if (nodes.length === 0) return el('div', 'dag-empty', { text: 'no operators on this root' })

    // ── 2. Layout (BFS by depth) ────────────────────────────────────
    const byDepth: any[] = []
    nodes.forEach((n, i) => { (byDepth[n._depth] ||= []).push(i) })
    const W = 100, H = 30, GX = 22, GY = 32, P = 16
    const pos: any[] = []
    byDepth.forEach((row, d) => {
      row.forEach((i: any, c: any) => { pos[i] = { x: P + c * (W + GX), y: P + d * (H + GY) } })
    })
    const cols = byDepth.reduce((m, r) => Math.max(m, (r || []).length), 0)
    const numRows = byDepth.length
    const contentW = P * 2 + cols * W + Math.max(0, cols - 1) * GX
    const contentH = P * 2 + numRows * H + Math.max(0, numRows - 1) * GY

    // ── 3. Focus set (ancestors + self + descendants of focusedPath) ─
    let focusSet: any = null
    if (focusedPath != null) {
      focusSet = new Set()
      nodes.forEach((n, i) => {
        if (n._path === focusedPath) focusSet.add(i)
        else if (n._path === '') focusSet.add(i)                                  // root always ancestor
        else if ((focusedPath + '/').startsWith(n._path + '/')) focusSet.add(i)   // strict ancestor
        else if (n._path.startsWith(focusedPath + '/')) focusSet.add(i)           // descendant
      })
    }

    // ── 4. DOM ──────────────────────────────────────────────────────
    const outer = el('div', 'dag-outer')
    const canvas = el('div', 'dag-canvas')
    Object.assign(canvas.style, { width: `${contentW}px`, height: `${contentH}px` })
    outer.appendChild(canvas)

    const NS = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('width', contentW as any); svg.setAttribute('height', contentH as any)
    svg.setAttribute('class', 'dag-edges')
    for (const [a, b] of edges) {
      const A = pos[a], B = pos[b]; if (!A || !B) continue
      const x1 = A.x + W / 2, y1 = A.y + H, x2 = B.x + W / 2, y2 = B.y, cy = (y1 + y2) / 2
      const p = document.createElementNS(NS, 'path')
      p.setAttribute('d', `M ${x1} ${y1} C ${x1} ${cy}, ${x2} ${cy}, ${x2} ${y2}`)
      if (focusSet && !(focusSet.has(a) && focusSet.has(b))) p.setAttribute('opacity', '0.08')
      svg.appendChild(p)
    }
    canvas.append(svg)

    const HEAT_WINDOW = 5000
    nodes.forEach((n, i) => {
      const p = pos[i] || { x: 0, y: 0 }
      const dimmed = focusSet && !focusSet.has(i)
      const isFocus = n._path === focusedPath
      const isSelected = selectedView && selectedView === n._view
      const cls = `dnode kind-${n.kind}`
        + (isSelected ? ' selected' : '')
        + (dimmed ? ' dimmed' : '')
        + (isFocus ? ' focus-root' : '')
      const node = el('div', cls)
      ;(node as any)._view = n._view   // expando — markSelection toggles .selected by identity match
      Object.assign(node.style, { left: `${p.x}px`, top: `${p.y}px`, width: `${W}px`, height: `${H}px` })

      if (heatmapMode) {
        const t = heat.get(nodeKeyOf(n))
        const age = t ? performance.now() - t : Infinity
        if (age > HEAT_WINDOW) node.style.opacity = '0.4'
        else {
          const h = 1 - age / HEAT_WINDOW
          node.style.boxShadow = `0 0 ${Math.round(2 + 12 * h)}px rgba(155,227,168,${0.25 + 0.55 * h})`
          node.style.borderColor = '#9be3a8'
        }
      }

      node.append(
        el('div', 'dnode-label', { text: nodeLabel(n) }),
        el('div', 'dnode-sub',   { text: shortKind(n) }),
      )
      const chipCount = sinkChips.get(i)
      if (chipCount) {
        const chip = el('span', 'dnode-chip', { text: `→${chipCount}` })
        chip.title = `${chipCount} DOM/connect sink(s). Click the node — the inspector's "Bound DOM" section shows each one.`
        node.append(chip)
      }

      node.title = `${nodeLabel(n)} · ${n.kind}${n.ctor ? ' · ' + n.ctor : ''}\nshift-click to focus`
      node.addEventListener('click', (e: any) => {
        e.stopPropagation()
        if (e.shiftKey) {
          focusedPath = (focusedPath === n._path) ? null : n._path
          rerenderGraph()
          return
        }
        selectedView = n._view
        openInspector(n)
        markSelection()
      })

      canvas.append(node)
    })

    // ── 5. Toolbar overlay ──────────────────────────────────────────
    const tools = el('div', 'dag-tools')
    const mkTool = (txt: any, title: any, fn: any) => {
      const b = el('button', '', { text: txt }); b.title = title
      b.addEventListener('click', (e: any) => { e.stopPropagation(); fn() })
      return b
    }
    const mkCheck = (label: any, checked: any, title: any, fn: any) => {
      const w = el('label', 'dag-check'); w.title = title
      const cb = el('input', '', { attrs: { type: 'checkbox' } })
      ;(cb as any).checked = checked
      cb.addEventListener('change', (e: any) => { e.stopPropagation(); fn((cb as any).checked) })
      w.append(cb, document.createTextNode(' ' + label))
      return w
    }

    tools.append(
      mkCheck('sinks', !hideSinks, 'show terminal sinks as nodes (off = collapsed to →N chip)', (v: any) => { hideSinks = !v; rerenderGraph() }),
      mkCheck('🔥', heatmapMode, 'colour nodes by recent activity', (v: any) => {
        heatmapMode = v
        if (heatmapMode) startHeatmap()
        else stopHeatmap()
        rerenderGraph()
      }),
      el('span', 'dag-sep'),
    )

    if (focusedPath != null) {
      const focusedNode = nodes.find(n => n._path === focusedPath)
      const lbl = focusedNode ? nodeLabel(focusedNode) : focusedPath
      const bc = el('span', 'dag-focus')
      bc.append(
        el('span', '', { text: 'focus: ' }),
        el('span', 'dag-focus-key', { text: lbl.length > 22 ? lbl.slice(0, 20) + '…' : lbl }),
      )
      const clear = mkTool('✕', 'clear focus', () => { focusedPath = null; rerenderGraph() })
      clear.classList.add('dag-focus-clear')
      bc.append(clear)
      tools.append(bc, el('span', 'dag-sep'))
    }

    const scaleLbl = el('span', 'dag-scale', { text: '100%' })
    tools.append(
      mkTool('⛶',   'fit to view',  () => fit()),
      mkTool('1:1', 'reset to 100%', () => { scale = 1; tx = 0; ty = 0; apply() }),
      mkTool('+',   'zoom in',      () => zoomAt(0.5, 0.5, 1.25)),
      mkTool('−',   'zoom out',     () => zoomAt(0.5, 0.5, 0.8)),
      scaleLbl,
    )
    outer.appendChild(tools)

    // ── 6. Pan + zoom ───────────────────────────────────────────────
    let scale = dagView.scale ?? 1
    let tx    = dagView.tx    ?? 0
    let ty    = dagView.ty    ?? 0
    const apply = () => {
      canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`
      scaleLbl.textContent = `${Math.round(scale * 100)}%`
      dagView.scale = scale; dagView.tx = tx; dagView.ty = ty
    }
    const fit = () => {
      const r = outer.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return
      const sx = (r.width  - 24) / contentW
      const sy = (r.height - 24) / contentH
      scale = Math.min(sx, sy, 1)
      tx = (r.width  - contentW * scale) / 2
      ty = (r.height - contentH * scale) / 2
      apply()
    }
    const zoomAt = (relX: any, relY: any, factor: any) => {
      const r = outer.getBoundingClientRect()
      const cx = r.width  * relX
      const cy = r.height * relY
      const ns = Math.max(0.15, Math.min(4, scale * factor))
      tx = cx - (cx - tx) * (ns / scale)
      ty = cy - (cy - ty) * (ns / scale)
      scale = ns
      apply()
    }

    let dragging = false, lastX = 0, lastY = 0, downAt: any = null
    outer.addEventListener('pointerdown', (e: any) => {
      if (e.target.closest('.dnode') || e.target.closest('.dag-tools')) return
      dragging = true; lastX = e.clientX; lastY = e.clientY
      downAt = { x: e.clientX, y: e.clientY }
      outer.setPointerCapture(e.pointerId)
      outer.classList.add('panning')
    })
    outer.addEventListener('pointermove', (e: any) => {
      if (!dragging) return
      tx += e.clientX - lastX; ty += e.clientY - lastY
      lastX = e.clientX; lastY = e.clientY
      apply()
    })
    const endPan = (e: any) => {
      if (!dragging) return
      dragging = false
      try { outer.releasePointerCapture(e.pointerId) } catch {}
      outer.classList.remove('panning')
    }
    outer.addEventListener('pointerup',     endPan)
    outer.addEventListener('pointercancel', endPan)
    outer.addEventListener('wheel', (e: any) => {
      e.preventDefault()
      const r = outer.getBoundingClientRect()
      const factor = e.deltaY > 0 ? 0.88 : 1.14
      zoomAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, factor)
    }, { passive: false })

    // Click empty canvas → clear focus.
    outer.addEventListener('click', (e: any) => {
      if (e.target.closest('.dnode') || e.target.closest('.dag-tools')) return
      const moved = downAt && (Math.abs(e.clientX - downAt.x) + Math.abs(e.clientY - downAt.y)) > 4
      if (moved) return
      if (focusedPath != null) { focusedPath = null; rerenderGraph() }
    })

    if (dagView.scale == null) requestAnimationFrame(fit)
    else apply()

    return outer
  }

  // Toggle .selected on Tree rows / DAG nodes by matching live View identity
  // — both views stamp `_view` on each rendered element so we can find the
  // selected one without a key lookup (operators sharing key=[] would clash).
  function markSelection() {
    for (const r of Array.from(root.querySelectorAll('.tnode-row'))) {
      r.classList.toggle('selected', selectedView != null && (r as any)._view === selectedView)
    }
    for (const r of Array.from(root.querySelectorAll('.dnode'))) {
      r.classList.toggle('selected', selectedView != null && (r as any)._view === selectedView)
    }
  }

  // Re-walk on mutation + record a small per-key event history that powers
  // the Inspect tab's Activity card. Ring buffer keeps the last 500 events;
  // older ones drop off, so memory is bounded and we can compute "X events
  // in the last 60s" without scanning forever.
  const EVENTS_MAX = 500
  const eventsRing: any[] = []                    // { t, verb, key (joined) }
  // `ringOffset` counts how many entries have been shifted off the front of
  // `eventsRing`. Consumers (the Events tab) track an ABSOLUTE index of how
  // many events they've drained; subtracting `ringOffset` gives the relative
  // index into the ring. Without this, a consumer that's caught up when the
  // ring is full would silently miss every subsequent event (push+shift
  // keeps the length at EVENTS_MAX, so `consumedIdx < ring.length` stays
  // false). See devtools-v2 ring-overflow regression test.
  const ringState = { offset: 0 }
  const lastEventByKey = new Map()         // key → t (most recent)
  // Fan-out set for the always-on trace. The Events tab subscribes here so it
  // sees the same stream as the Activity card without installing a second
  // `$.trace` subscription (which would either duplicate every event or, when
  // scoped to a single view, miss no-op operator cascades — see the comment
  // at the top of renderEventsTab).
  const evSubscribers = new Set()

  const traceDispose = ($ as any).trace(rootProxy, {
    log: false,
    onEvent: (e: any) => {
      const t  = performance.now()
      const k  = (e.key || []).join('.') || '<root>'
      const ev = { t, verb: e.verb, key: k }
      eventsRing.push(ev)
      if (eventsRing.length > EVENTS_MAX) { eventsRing.shift(); ringState.offset++ }
      lastEventByKey.set(k, t)
      for (const fn of evSubscribers) {
        try { (fn as any)(ev) } catch {}
      }
      scheduleRewalk()
    },
  })

  function eventsForKey(key: any, windowMs = 60_000) {
    const cutoff = performance.now() - windowMs
    const out = []
    for (let i = eventsRing.length - 1; i >= 0; i--) {
      const e = eventsRing[i]
      if (e.t < cutoff) break
      if (e.key === key) out.push(e)
    }
    return out
  }

  rerenderGraph()

  // ─── side-by-side inspector column ────────────────────────────────────
  // Inspector lives as a flex sibling of the graph pane. When opened, the
  // dock widens (graph stays its width, inspector adds 360px). When closed,
  // the dock shrinks back. No overlay — graph remains fully visible.
  // A vertical splitter between graph pane and inspector lets the user
  // redistribute width inside the dock; CSS hides it while the inspector
  // is closed (`.dock.with-inspector .splitter` is the visibility hook).
  const splitter = el('div', 'splitter')
  splitter.title = 'drag to resize'
  dockBody.append(splitter)
  const insp = el('section', 'inspector', { hidden: true })
  dockBody.append(insp)

  // Pointer-driven splitter drag: clamp inspector width to a usable range
  // (200–700px). The dock's total width stays fixed (840px when inspector
  // is open), so shrinking the inspector grows the graph pane via flex:1.
  let dragSplitter: any = null
  splitter.addEventListener('pointerdown', (e: any) => {
    if (insp.hidden) return
    dragSplitter = { startX: e.clientX, startW: insp.getBoundingClientRect().width }
    splitter.setPointerCapture(e.pointerId)
    splitter.classList.add('dragging')
    e.preventDefault()
  })
  splitter.addEventListener('pointermove', (e: any) => {
    if (!dragSplitter) return
    const dx = e.clientX - dragSplitter.startX
    const w = Math.max(200, Math.min(700, dragSplitter.startW - dx))
    insp.style.width = w + 'px'
  })
  const endDrag = (e: any) => {
    if (!dragSplitter) return
    dragSplitter = null
    splitter.classList.remove('dragging')
    try { splitter.releasePointerCapture(e.pointerId) } catch {}
  }
  splitter.addEventListener('pointerup',     endDrag)
  splitter.addEventListener('pointercancel', endDrag)
  insp.append(
    (() => {
      const h = el('header', 'insp-header')
      const t = el('span', 'insp-title', { text: '' })
      const x = mkBtn('Close ✕', 'close (Esc)')
      x.classList.add('close-btn')
      x.addEventListener('click', closeInspector)
      h.append(t, x)
      h.dataset.role = 'header'
      return h
    })(),
  )
  const inspTabs = el('nav', 'insp-tabs')
  const inspBody = el('div', 'insp-body')
  insp.append(inspTabs, inspBody)
  let activeTab = 'inspect'
  for (const name of TABS) {
    const b = el('button', name === activeTab ? 'active' : '', { text: name })
    b.addEventListener('click', () => { activeTab = name; renderInspectorBody(); markTabs() })
    inspTabs.append(b)
  }
  function markTabs() {
    inspTabs.querySelectorAll('button').forEach((b: any) => b.classList.toggle('active', b.textContent === activeTab))
  }

  let currentInspectNode: any = null
  let traceForInsp: any = null
  let profileHandle: any = null
  let profileTimer: any = null
  let evTickTimer: any  = null   // 1s tick that refreshes "X seconds ago" labels

  function openInspector(node: any) {
    currentInspectNode = node
    insp.hidden = false
    dock.classList.add('with-inspector')
    insp.querySelector('.insp-title').textContent = nodeLabel(node) + '  · ' + node.kind
    renderInspectorBody()
  }
  function closeInspector() {
    insp.hidden = true
    dock.classList.remove('with-inspector')
    selectedView = null; markSelection()
    currentInspectNode = null
    if (traceForInsp) { traceForInsp(); traceForInsp = null }
    if (profileHandle) { profileHandle.stop(); profileHandle = null }
    if (profileTimer) { clearInterval(profileTimer); profileTimer = null }
    if (evTickTimer)  { clearInterval(evTickTimer);  evTickTimer  = null }
  }
  // Only refresh the Inspect tab on the rAF rewalk tick. The Events and
  // Profile tabs manage their own update cadence (subscriber + 1s timer)
  // and would lose all their in-flight state (event counter, samples,
  // installed subscriber) if we tore them down on every cascade.
  function refreshInspector() {
    if (insp.hidden || !currentInspectNode) return
    if (activeTab !== 'inspect') return
    renderInspectorBody()
  }

  function renderInspectorBody() {
    inspBody.innerHTML = ''
    if (!currentInspectNode) return
    if (activeTab === 'inspect') return renderInspectTab()
    if (activeTab === 'events')  return renderEventsTab()
    if (activeTab === 'profile') return renderProfileTab()
  }

  function renderInspectTab() {
    if (traceForInsp) { traceForInsp(); traceForInsp = null }
    if (profileHandle) { profileHandle.stop(); profileHandle = null }
    if (profileTimer) { clearInterval(profileTimer); profileTimer = null }
    if (evTickTimer)  { clearInterval(evTickTimer);  evTickTimer  = null }
    const n = currentInspectNode
    const liveView  = n._view
    const liveValue = liveView?.value
    const nodeKey   = nodeKeyOf(n)

    const mkCard = (cls: any, title: any, populate: any) => {
      const card = el('div', `insp-card insp-card-${cls}`)
      card.append(el('div', 'card-title', { text: title }))
      const body = el('div', 'card-body')
      populate(body)
      card.append(body)
      return card
    }

    // ─── IDENTITY ──────────────────────────────────────────────────
    inspBody.append(mkCard('identity', 'IDENTITY', (body: any) => {
      body.append(
        el('div', 'card-headline', { text: buildChain(n) }),
        el('div', 'card-sub', { text: `${n.ctor || n.kind}${n.ctor ? ' · ' + n.kind : ''}` }),
      )
    }))

    // ─── CURRENT VALUE ─────────────────────────────────────────────
    inspBody.append(mkCard('value', 'CURRENT VALUE', (body: any) => {
      body.append(el('pre', 'card-value', { text: formatLiveValue(liveValue) }))
      const lastT = lastEventByKey.get(nodeKey)
      const ageSec = lastT ? (performance.now() - lastT) / 1000 : null
      const stab = ageSec == null         ? 'no events recorded'
                 : ageSec < 1             ? `just updated`
                 : ageSec < 60            ? `stable for ${ageSec.toFixed(1)}s`
                 : ageSec < 3600          ? `stable for ${Math.round(ageSec / 60)}m`
                 :                          'stable >1h'
      body.append(el('div', 'card-sub', { text: `${valueTypeLabel(liveValue)} · ${stab}` }))
    }))

    // ─── CONNECTIONS ───────────────────────────────────────────────
    inspBody.append(mkCard('connections', 'CONNECTIONS', (body: any) => {
      // Upstream
      const parent = n._parent
      const inRow = el('div', 'conn-row')
      inRow.append(
        el('span', 'conn-dir', { text: '↑ in' }),
        el('span', 'conn-detail', { text: parent ? buildChain(parent) : '(this is a root)' }),
      )
      body.append(inRow)
      // Downstream
      const bindings = collectBindings(liveView)
      const opSinks  = (n.sinks || []).filter((s: any) => s.kind === 'operator').length
      const outRow = el('div', 'conn-row')
      outRow.append(
        el('span', 'conn-dir', { text: '↓ out' }),
        el('span', 'conn-detail', {
          text: `${bindings.dom.length} DOM binding${bindings.dom.length === 1 ? '' : 's'}`
              + ` · ${opSinks} operator sink${opSinks === 1 ? '' : 's'}`
              + (bindings.others.length ? ` · ${bindings.others.length} other` : ''),
        }),
      )
      body.append(outRow)
    }))

    // ─── ACTIVITY ──────────────────────────────────────────────────
    inspBody.append(mkCard('activity', 'ACTIVITY', (body: any) => {
      const recent = eventsForKey(nodeKey, 60_000)
      body.append(el('div', 'card-stat', { text: `${recent.length} event${recent.length === 1 ? '' : 's'} in last 60s` }))
      if (recent.length > 0) {
        const verbCounts: any = {}
        for (const e of recent) verbCounts[e.verb] = (verbCounts[e.verb] || 0) + 1
        const verbsLine = el('div', 'card-verbs')
        for (const [v, c] of Object.entries(verbCounts).sort((a: any, b: any) => b[1] - a[1]).slice(0, 6)) {
          const klass = (v.startsWith('XU') || v.startsWith('BU')) ? 'update'
                     : (v.startsWith('BI')) ? 'insert'
                     : (v.startsWith('XR') || v.startsWith('BR')) ? 'remove'
                     : (v.startsWith('BMV')) ? 'move' : ''
          verbsLine.append(el('span', `verb-pill ${klass}`, { text: `${v}×${c}` }))
        }
        body.append(verbsLine)
        const last = recent[0]
        const ago = ((performance.now() - last.t) / 1000).toFixed(1)
        body.append(el('div', 'card-sub', { text: `most recent: ${last.verb} · ${ago}s ago` }))
      } else {
        body.append(el('div', 'card-sub', { text: 'no recent events on this key' }))
      }
    }))

    // ───────────── Bound DOM section ─────────────
    // The most useful thing to know about a view: where does it actually go
    // on the page? Walk the live view's sinks, collect every DOMSink's
    // parent element, render a clickable list with tag + class + text
    // preview. Click an entry to highlight + scroll-into-view.
    //
    // n._view is attached at walk time (walkGraph) so this works correctly
    // even when several operators share a (kind, key, ctor) signature.
    // (liveView already in scope from the top of renderInspectTab.)
    const bindings = collectBindings(liveView)
    const total = bindings.dom.length + bindings.others.length

    const section = el('div', 'bound-section')
    const head = el('div', 'bound-head')
    head.append(
      el('span', 'bound-title', { text: 'Bound DOM' }),
      el('span', 'bound-count', { text: total === 0 ? '(none)' : `(${bindings.dom.length} dom${bindings.others.length ? ` · ${bindings.others.length} other` : ''})` }),
    )
    if (bindings.dom.length > 0) {
      const allBtn = el('button', 'bound-all', { text: 'flash all' })
      allBtn.addEventListener('click', () => flashElements(bindings.dom.map((b: any) => b.el), 1500))
      head.append(allBtn)
    }
    section.append(head)

    if (!liveView) {
      const note = el('div', 'bound-note', { text: 'No live view found for this graph node. Try clicking a node that has a known kind/ctor.' })
      section.append(note)
    } else if (total === 0) {
      const note = el('div', 'bound-note', { text: 'No DOM elements are bound to this view yet.' })
      section.append(note)
    } else {
      const list = el('ul', 'bound-list')
      const MAX = 12
      for (const { el: target, via, kind, label } of bindings.dom.slice(0, MAX)) {
        const row = el('li', 'bound-row')
        const left = el('div', 'bound-left')
        const tagLine = el('div', 'bound-tagline')
        tagLine.append(
          el('span', 'bound-tag', { text: tagDescriptor(target) }),
          el('span', 'bound-prop', { text: ' · ' + (label || kind || '') }),
        )
        left.append(
          tagLine,
          el('span', 'bound-snippet', { text: textSnippet(target) }),
        )
        if (via) {
          left.append(el('div', 'bound-via', { text: `via ${via}` }))
        }
        const right = el('div', 'bound-right')
        const flashBtn = el('button', '', { text: 'flash' })
        flashBtn.addEventListener('click', (e: any) => { e.stopPropagation(); flashElements([target], 1200) })
        const scrollBtn = el('button', '', { text: 'scroll' })
        scrollBtn.addEventListener('click', (e: any) => {
          e.stopPropagation()
          try { target.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch {}
          flashElements([target], 1500)
        })
        right.append(flashBtn, scrollBtn)
        row.append(left, right)
        list.append(row)
      }
      if (bindings.dom.length > MAX) {
        list.append(el('li', 'bound-more', { text: `… and ${bindings.dom.length - MAX} more` }))
      }
      for (const o of bindings.others.slice(0, 5)) {
        const row = el('li', 'bound-row bound-other')
        row.append(
          el('span', 'bound-tag', { text: `[${o.ctor}]` }),
          el('span', 'bound-snippet', { text: `non-DOM sink${o.via ? ' · via ' + o.via : ''}` }),
        )
        list.append(row)
      }
      section.append(list)
    }
    inspBody.append(section)
  }

  // Pretty tag + class/id snippet for an element. Mirrors how browser
  // devtools show "div.foo#bar" so the user can mentally locate it.
  function tagDescriptor(el: any) {
    let s = el.tagName ? el.tagName.toLowerCase() : '?'
    if (el.id) s += '#' + el.id
    const cls = (el.className && typeof el.className === 'string') ? el.className.trim().split(/\s+/) : []
    if (cls.length) s += '.' + cls.slice(0, 2).join('.')
    if (cls.length > 2) s += `.+${cls.length - 2}`
    return s
  }
  function textSnippet(el: any) {
    let t = el.textContent || ''
    t = t.trim().replace(/\s+/g, ' ')
    if (!t) {
      // Try value for inputs
      if (el.value != null) t = String(el.value)
      else t = '(empty)'
    }
    return t.length > 38 ? `"${t.slice(0, 36)}…"` : `"${t}"`
  }
  // Flash bound DOM elements with a generation counter.
  //
  // The naive version (capture `prevOutline` per flash call, restore in
  // setTimeout) breaks under back-to-back flashes on the same element: the
  // second call captures the highlight outline left by the first call, so
  // its cleanup "restores" to the highlighted state. Result: the outline
  // never disappears.
  //
  // Instead, per element we remember the ORIGINAL outline (captured the
  // first time the element is flashed while idle), and a monotonically
  // increasing generation number. Each flash bumps the generation; only
  // the cleanup whose generation still matches the current generation
  // actually restores. WeakMap keeps state alive only as long as the
  // element is alive.
  const flashStates = new WeakMap()
  function flashElements(els: any, ms = 1200) {
    for (const el of els) {
      let state = flashStates.get(el)
      if (!state) {
        state = {
          origOutline:       el.style.outline       || '',
          origOutlineOffset: el.style.outlineOffset || '',
          gen: 0,
        }
        flashStates.set(el, state)
      }
      state.gen++
      const myGen = state.gen
      el.style.outline = '2px solid #9be3a8'
      el.style.outlineOffset = '2px'
      setTimeout(() => {
        const cur = flashStates.get(el)
        if (!cur || cur.gen !== myGen) return   // a later flash on this element superseded us
        el.style.outline       = cur.origOutline
        el.style.outlineOffset = cur.origOutlineOffset
        flashStates.delete(el)
      }, ms)
    }
  }

  // ─── Events tab — value timeline + activity ──────────────────────────
  //
  // Re-imagined from the old raw-verb log into something a user can read:
  //   - For scalar nodes (length / sum / aggregates / booleans / primitives)
  //     we plot the value over the last 60s as a step sparkline and list the
  //     most recent transitions as `prev → curr (verb)` lines.
  //   - For collection nodes (root / filter / group / arrays / objects) we
  //     show a 60s rollup of inserts / removes / updates, plus a per-row
  //     "heat" bar showing which children mutated the most.
  //
  // Data source: the GLOBAL `eventsRing` (populated by the always-on
  // `$.trace(rootProxy, …)` at panel init). We piggy-back on it via
  // `evSubscribers` so the Activity card and the Events tab see the same
  // stream — which is what the user expects ("if Inspect shows activity,
  // Events should too").
  //
  // Why not scope a per-tab `$.trace({[view]: liveView}, …)`? It's technically
  // more precise, but operator output views (length / sum / etc.) receive
  // *no-op* method calls when an upstream change doesn't move their value
  // (toggling `completed` doesn't change `items.length()` — length.BU1 runs
  // as a no-op and never calls `this.view.*`, so trace never fires). The
  // user-visible result: "I toggled, the Activity card lit up, but the
  // Events tab shows 0". Going through the global ring sidesteps that.
  //
  // Limitation: events are tagged with the SOURCE view's joined key. The
  // items root and every empty-key operator output (length / sum / aggregate)
  // all join to '<root>', so for those nodes the Events tab shows the
  // entire items-subtree activity. That matches what the Activity card does.
  function renderEventsTab() {
    if (profileHandle) { profileHandle.stop(); profileHandle = null }
    if (profileTimer)  { clearInterval(profileTimer); profileTimer = null }

    const n = currentInspectNode
    const liveView = n?._view
    if (!liveView) {
      inspBody.append(el('p', 'muted', { text: 'No live view bound — pick a node from the graph.' }))
      return
    }

    const v0 = liveView.value
    const t0 = typeof v0
    const isScalar  = v0 === null || v0 === undefined || t0 === 'number' || t0 === 'string' || t0 === 'boolean'
    const isNumeric = t0 === 'number' || t0 === 'boolean'

    // Match function: an event from the global ring belongs to this view if
    // its joined key is EQUAL to liveView's joined key (direct events on
    // the same key path), OR it descends from it (per-row mutations under
    // a collection view). For empty-key views (root / operators), the
    // descendant rule matches every event in the items subtree.
    const lvk = liveView.key.join('.') || '<root>'
    const matches = (k: any) => {
      if (k === lvk) return true
      if (lvk === '<root>') return true
      return k.startsWith(lvk + '.')
    }

    const ctrls = el('div', 'ev-controls')
    let paused = false
    const playBtn  = mkBtn('⏸ pause', 'pause/resume capture')
    const clearBtn = el('button', '', { text: 'clear' })
    const debugBadge = el('span', 'ev-debug', { text: '0 events' })
    ctrls.append(playBtn, clearBtn, debugBadge)
    inspBody.append(ctrls)
    const body = el('div', 'ev-body')
    inspBody.append(body)

    let totalSeen = 0
    const samples: any[]   = []   // scalar: { t, v, verb } — newest at end
    const eventsBuf: any[] = []   // collection: { t, verb, key, payload }
    if (isScalar) samples.push({ t: performance.now(), v: v0, verb: 'init' })

    // Show the resolved key+ctor in the badge so we don't have to guess what
    // the click actually selected.
    debugBadge.textContent = `key=${(liveView.key && liveView.key.length) ? liveView.key.join('.') : '<root>'} · ctor=${liveView.res?.constructor?.name || '?'} · 0 events`

    // Snapshot how far into the global ring we've already consumed, in
    // ABSOLUTE terms (count of events ever pushed). `ringState.offset` rises
    // whenever the ring overflows and shifts an entry off the front;
    // `ringState.offset + eventsRing.length` is the total ever pushed.
    // Tracking an absolute index means a consumer that's caught up when the
    // ring is full still picks up subsequent pushes correctly. We re-pull on
    // every render (subscriber tick OR 1s timer) so the events tab is robust
    // even if our fan-out subscriber misses a beat.
    let consumedAbsIdx = ringState.offset + eventsRing.length
    const drainRing = () => {
      let added = 0
      const totalPushed = ringState.offset + eventsRing.length
      // If overflow shifted past where we last looked, snap forward to the
      // oldest still-in-ring entry — losing a few events is better than an
      // infinite loop with negative indices.
      if (consumedAbsIdx < ringState.offset) consumedAbsIdx = ringState.offset
      for (; consumedAbsIdx < totalPushed; consumedAbsIdx++) {
        const ev = eventsRing[consumedAbsIdx - ringState.offset]
        if (!matches(ev.key)) continue
        added++
        if (isScalar) {
          samples.push({ t: ev.t, v: liveView.value, verb: ev.verb })
          if (samples.length > 500) samples.shift()
        } else {
          eventsBuf.push({ t: ev.t, verb: ev.verb, key: ev.key, payload: undefined })
          if (eventsBuf.length > 500) eventsBuf.shift()
        }
      }
      return added
    }
    // First render seeds with whatever's already in the ring so the user gets
    // instant context — rewind consumedAbsIdx to the oldest still-buffered
    // event, then drain forward.
    consumedAbsIdx = ringState.offset
    drainRing()

    playBtn.addEventListener('click', () => {
      paused = !paused
      playBtn.textContent = paused ? '▶ resume' : '⏸ pause'
    })
    clearBtn.addEventListener('click', () => {
      samples.length = 0
      eventsBuf.length = 0
      if (isScalar) samples.push({ t: performance.now(), v: liveView.value, verb: 'init' })
      totalSeen = 0
      debugBadge.textContent = '0 events'
      rerender()
    })

    let renderQ = false
    const rerender = () => {
      if (renderQ) return
      renderQ = true
      requestAnimationFrame(() => {
        renderQ = false
        body.innerHTML = ''
        if (isScalar) renderScalarTimeline(body, liveView, samples, isNumeric)
        else          renderCollectionActivity(body, liveView, eventsBuf)
      })
    }
    rerender()

    // Tick once a second so "Xs ago" labels stay fresh AND so we re-pull any
    // ring entries the subscriber may have missed. Belt-and-suspenders: if
    // anything were to silently drop our subscriber, the events tab would
    // still catch up within a second.
    if (evTickTimer) clearInterval(evTickTimer)
    evTickTimer = setInterval(() => {
      const added = drainRing()
      if (added > 0) {
        totalSeen += added
        debugBadge.textContent = `key=${lvk} · ctor=${liveView.res?.constructor?.name || '?'} · ${totalSeen} events`
      }
      rerender()
    }, 1000)

    // Hook into the global trace's subscriber list (set up at panel init).
    // The previous `traceForInsp = $.trace(…)` approach got dropped here
    // because the per-view scope didn't fire for operator-output views
    // whose internal verbs run as no-ops on upstream cascades.
    // Subscriber: nudge a rerender + drain on each event. drainRing owns the
    // buffer pushes — the subscriber just signals "something changed, pull".
    // This makes the path symmetric with the 1s tick and means a missed
    // fan-out is just a small latency hit, not lost events.
    if (traceForInsp) traceForInsp()
    debugBadge.title = `key=${lvk} · subscribers=${evSubscribers.size + 1}`
    const onEv = () => {
      const added = drainRing()
      if (!added) return
      if (paused) return
      totalSeen += added
      debugBadge.textContent = `key=${lvk} · ctor=${liveView.res?.constructor?.name || '?'} · ${totalSeen} events`
      rerender()
    }
    evSubscribers.add(onEv)
    traceForInsp = () => { evSubscribers.delete(onEv) }
  }

  function renderScalarTimeline(body: any, liveView: any, samples: any, isNumeric: any) {
    const NS = 'http://www.w3.org/2000/svg'
    const W = 320, H = 84, PL = 36, PR = 8, PT = 10, PB = 18
    const now = performance.now()
    const tMin = now - 60_000

    // Card 1: sparkline + current value
    const c1 = el('div', 'ev-card')
    const hdr = el('div', 'ev-card-title')
    hdr.append(
      el('span', '', { text: 'VALUE OVER TIME · LAST 60s' }),
      el('span', 'ev-card-current', { text: `now: ${formatValue(liveView.value)}` }),
    )
    c1.append(hdr)

    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('width',  W as any)
    svg.setAttribute('height', H as any)
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    svg.classList.add('ev-spark')

    const win = samples.filter((s: any) => s.t >= tMin)
    if (!isNumeric || win.length < 2) {
      const tx = document.createElementNS(NS, 'text')
      tx.setAttribute('x', W / 2 as any); tx.setAttribute('y', H / 2 + 4 as any)
      tx.setAttribute('text-anchor', 'middle'); tx.setAttribute('class', 'ev-spark-empty')
      tx.textContent = !isNumeric ? 'non-numeric value — see changes below' : 'watching for changes…'
      svg.appendChild(tx)
    } else {
      const nums = win.map((s: any) => Number(s.v))
      let vMin = Math.min(...nums), vMax = Math.max(...nums)
      if (vMin === vMax) { vMin -= 1; vMax += 1 }
      const xOf = (t: any) => PL + (Math.max(t, tMin) - tMin) / 60_000 * (W - PL - PR)
      const yOf = (v: any) => H - PB - ((Number(v) - vMin) / (vMax - vMin)) * (H - PT - PB)

      // Min/max gridlines + axis labels
      for (const { y, label } of [
        { y: yOf(vMax), label: formatValue(vMax) },
        { y: yOf(vMin), label: formatValue(vMin) },
      ]) {
        const ln = document.createElementNS(NS, 'line')
        ln.setAttribute('x1', PL as any); ln.setAttribute('x2', W - PR as any)
        ln.setAttribute('y1', y as any);  ln.setAttribute('y2', y as any)
        ln.setAttribute('class', 'ev-spark-grid')
        svg.appendChild(ln)
        const tx = document.createElementNS(NS, 'text')
        tx.setAttribute('x', PL - 4 as any); tx.setAttribute('y', y + 3 as any)
        tx.setAttribute('text-anchor', 'end'); tx.setAttribute('class', 'ev-spark-axis')
        tx.textContent = label
        svg.appendChild(tx)
      }

      // Step polyline (value is constant between samples)
      let d = ''
      for (let i = 0; i < win.length; i++) {
        const s = win[i]
        const x = xOf(s.t), y = yOf(s.v)
        if (i === 0) d += `M ${x} ${y}`
        else {
          const prev = win[i - 1]
          d += ` L ${x} ${yOf(prev.v)} L ${x} ${y}`
        }
      }
      const last = win[win.length - 1]
      d += ` L ${xOf(now)} ${yOf(last.v)}`

      const path = document.createElementNS(NS, 'path')
      path.setAttribute('d', d); path.setAttribute('class', 'ev-spark-line')
      svg.appendChild(path)

      const dot = document.createElementNS(NS, 'circle')
      dot.setAttribute('cx', xOf(now) as any); dot.setAttribute('cy', yOf(last.v) as any)
      dot.setAttribute('r', 3 as any); dot.setAttribute('class', 'ev-spark-dot')
      svg.appendChild(dot)
    }

    // X axis labels
    for (const [x, anchor, label] of [
      [PL,     'start', '60s ago'],
      [W - PR, 'end',   'now'],
    ]) {
      const tx = document.createElementNS(NS, 'text')
      tx.setAttribute('x', x as any); tx.setAttribute('y', H - 4 as any)
      tx.setAttribute('text-anchor', anchor as any); tx.setAttribute('class', 'ev-spark-axis')
      tx.textContent = label as any
      svg.appendChild(tx)
    }
    c1.append(svg)
    body.append(c1)

    // Card 2: last transitions (newest first)
    const c2 = el('div', 'ev-card')
    c2.append(el('div', 'ev-card-title', { text: 'LAST CHANGES' }))
    const real = samples.filter((s: any) => s.verb !== 'init')
    if (!real.length) {
      const empty = el('p', 'muted ev-empty', { text: "No changes yet — interact with the demo and they'll appear here." })
      c2.append(empty)
    } else {
      const ol = el('ol', 'ev-trans')
      const rev = real.slice().reverse()
      for (let i = 0; i < rev.length && i < 12; i++) {
        const s = rev[i]
        const idx = samples.indexOf(s)
        const prev = idx > 0 ? samples[idx - 1] : null
        const li = el('li', '')
        li.append(
          el('span', 'ev-trans-time',  { text: timeAgo(s.t) }),
          el('span', 'ev-trans-delta', { text: `${prev ? formatValue(prev.v) : '—'}  →  ${formatValue(s.v)}` }),
          el('span', `verb-pill ${verbClass(s.verb)}`, { text: friendlyVerb(s.verb) }),
        )
        ol.append(li)
      }
      c2.append(ol)
    }
    body.append(c2)
  }

  function renderCollectionActivity(body: any, liveView: any, eventsBuf: any) {
    const now = performance.now()
    const cutoff = now - 60_000
    const win = eventsBuf.filter((e: any) => e.t >= cutoff)

    let nIns = 0, nRem = 0, nUpd = 0, nMov = 0
    const perRow = new Map()
    for (const e of win) {
      const c = verbClass(e.verb)
      if      (c === 'insert') nIns++
      else if (c === 'remove') nRem++
      else if (c === 'update') nUpd++
      else if (c === 'move')   nMov++
      const r = perRow.get(e.key) || { key: e.key, ins: 0, rem: 0, upd: 0, mov: 0, last: 0 }
      if      (c === 'insert') r.ins++
      else if (c === 'remove') r.rem++
      else if (c === 'update') r.upd++
      else if (c === 'move')   r.mov++
      if (e.t > r.last) r.last = e.t
      perRow.set(e.key, r)
    }

    // Card 1: activity summary
    const c1 = el('div', 'ev-card')
    c1.append(el('div', 'ev-card-title', { text: 'ACTIVITY · LAST 60s' }))
    const summary = el('div', 'ev-summary')
    if (!nIns && !nRem && !nUpd && !nMov) {
      summary.append(el('span', 'muted', { text: 'No activity in the last 60s.' }))
    } else {
      summary.append(
        el('span', 'ev-stat ev-stat-insert', { text: `+${nIns} inserts` }),
        el('span', 'ev-stat ev-stat-remove', { text: `−${nRem} removes` }),
        el('span', 'ev-stat ev-stat-update', { text: `${nUpd} updates` }),
      )
      if (nMov) summary.append(el('span', 'ev-stat ev-stat-move', { text: `${nMov} moves` }))
    }
    c1.append(summary)
    body.append(c1)

    // Card 2: per-row heat
    const rows = [...perRow.values()].sort((a: any, b: any) => (b.ins + b.rem + b.upd + b.mov) - (a.ins + a.rem + a.upd + a.mov))
    if (rows.length) {
      const c2 = el('div', 'ev-card')
      c2.append(el('div', 'ev-card-title', { text: 'PER-ROW HEAT · TOP 8' }))
      const max = rows[0].ins + rows[0].rem + rows[0].upd + rows[0].mov
      const ul = el('ul', 'ev-heat')
      for (const r of rows.slice(0, 8)) {
        const total = r.ins + r.rem + r.upd + r.mov
        const bar = el('div', 'ev-heat-bar')
        const seg = (cls: any, n: any) => {
          if (!n) return
          const s = el('span', `ev-heat-seg ${cls}`)
          s.style.width = `${(n / max) * 100}%`
          bar.append(s)
        }
        seg('update', r.upd); seg('insert', r.ins); seg('remove', r.rem); seg('move', r.mov)
        const li = el('li', '')
        li.append(
          el('span', 'ev-heat-key',   { text: r.key }),
          bar,
          el('span', 'ev-heat-count', { text: String(total) }),
        )
        ul.append(li)
      }
      c2.append(ul)
      body.append(c2)
    }

    // Card 3: recent — last 20 raw events for the user who wants the detail
    if (win.length) {
      const c3 = el('div', 'ev-card')
      c3.append(el('div', 'ev-card-title', { text: 'RECENT CHANGES' }))
      const ol = el('ol', 'ev-recent')
      const rev = win.slice(-20).reverse()
      for (const e of rev) {
        const cls = verbClass(e.verb)
        const li = el('li', '')
        li.append(
          el('span', 'ev-trans-time',     { text: timeAgo(e.t) }),
          el('span', `verb-pill ${cls}`,  { text: friendlyVerb(e.verb) }),
          el('span', 'ev-recent-key',     { text: e.key }),
          el('span', 'ev-recent-payload', { text: e.payload === undefined ? '' : formatValue(e.payload) }),
        )
        ol.append(li)
      }
      c3.append(ol)
      body.append(c3)
    }
  }

  function renderProfileTab() {
    if (traceForInsp) { traceForInsp(); traceForInsp = null }
    if (evTickTimer)  { clearInterval(evTickTimer);  evTickTimer  = null }
    const ctrls = el('div', 'ev-controls')
    let running = false
    const playBtn = mkBtn('▶ start', 'start/stop profile')
    const status = el('span', 'muted', { text: 'idle' })
    ctrls.append(playBtn, status)
    inspBody.append(ctrls)
    const tableWrap = el('div', 'prof-wrap')
    inspBody.append(tableWrap)

    const refresh = () => {
      if (!profileHandle) return
      const r = profileHandle.report()
      tableWrap.innerHTML = ''
      const tbl = el('table', 'prof')
      const thead = el('thead', '')
      thead.innerHTML = '<tr><th>operator</th><th>calls</th><th>totalMs</th><th>avgMs</th></tr>'
      tbl.append(thead)
      const tbody = el('tbody', '')
      for (const row of r.byOperator || []) {
        const tr = el('tr', '')
        tr.append(
          el('td', '', { text: row.ctor || row.operator || '?' }),
          el('td', '', { text: String(row.calls ?? 0) }),
          el('td', '', { text: (row.totalMs ?? 0).toFixed(2) }),
          el('td', '', { text: ((row.totalMs || 0) / Math.max(1, row.calls || 1)).toFixed(3) }),
        )
        tbody.append(tr)
      }
      tbl.append(tbody)
      tableWrap.append(tbl)
      status.textContent = `events: ${r.totalEvents} · totalMs: ${(r.totalMs || 0).toFixed(2)}`
    }

    playBtn.addEventListener('click', () => {
      running = !running
      if (running) {
        profileHandle = ($ as any).profile(rootProxy)
        playBtn.textContent = '⏸ stop'
        status.textContent = 'recording…'
        profileTimer = setInterval(refresh, 500)
      } else {
        if (profileHandle) profileHandle.stop()
        profileHandle = null
        if (profileTimer) clearInterval(profileTimer); profileTimer = null
        playBtn.textContent = '▶ start'
        status.textContent = 'stopped'
      }
    })
  }

  // ─── Alt-hover badges + popover ──────────────────────────────────────
  const altHover = createAltHover(root, host)
  const domPicker = createDomPicker(root, (el: any) => {
    const proxy = ($ as any).fromDOM(el); if (!proxy) return
    // `proxy[view]` returns the underlying live View instance. `proxy[value]`
    // would return the raw snapshot data, which has no `.key` / `.constructor`
    // and never matches a node._view by identity — so the inspector would
    // silently fail to open. See devtools-panel picker regression test.
    const liveView = proxy[view]
    // 1) Try the current panel's walk (the common case — picker click on a
    //    DOM binding in the same reactive subtree the panel is rooted at).
    let match = findNodeByView(walkGraph(rootProxy), liveView)
    // 2) Fall back to a synthetic node. Apps that bind their DOM through a
    //    separate ViewProxy (e.g. todo-jsx's `selected = $(filters.all)` for
    //    its `<For>` source) end up with a view that isn't a sink of the
    //    panel's root, so the walk misses it. The inspector reads `_view`
    //    directly for identity / live value / connections / activity, so a
    //    fresh node with `_view: liveView` is enough; the chain expression
    //    will just say <root> instead of tracing back through the panel root.
    if (!match) {
      match = {
        key: liveView.key ? [...liveView.key] : [],
        name: liveView.name,
        kind: liveView.p ? 'child' : 'root',
        ctor: liveView.constructor?.name,
        value: liveView.value,
        children: [], sinks: [],
        _view: liveView, _parent: null,
      }
    }
    selectedView = liveView
    openInspector(match)
    markSelection()
  })

  // Esc closes inspector / unpins popover
  const onKey = (e: any) => { if (e.key === 'Escape') { if (!insp.hidden) closeInspector(); altHover.unpin() } }
  document.addEventListener('keydown', onKey)

  // ─── destroy ─────────────────────────────────────────────────────────
  function destroy() {
    if (traceDispose) traceDispose()
    if (traceForInsp) traceForInsp()
    if (profileHandle) profileHandle.stop()
    if (profileTimer) clearInterval(profileTimer)
    if (evTickTimer)  clearInterval(evTickTimer)
    stopHeatmap()
    altHover.destroy()
    domPicker.destroy()
    document.removeEventListener('keydown', onKey)
    host.remove()
  }

  return { destroy, root, host, dock }
}

// ============== helpers ==============
function el(tag: any, cls: any, opts: any = {}): any {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (opts.text != null) e.textContent = opts.text
  if (opts.hidden) e.hidden = true
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) e.setAttribute(k, v as any)
  return e
}
function mkBtn(text: any, title?: any) {
  const b = el('button', '', { text })
  if (title) b.title = title
  return b
}
function nodeKeyOf(node: any) { return (node.key && node.key.length) ? node.key.join('.') : (node.name || '<root>') }
const METHOD_OF = {
  FilterValue: 'filter', FilterStringValue: 'filter',
  FilterObjectValue: 'filter', FilterColumnValue: 'filter',
  BetweenValue: 'between',
  LengthValue: 'length', LengthFnValue: 'length',
  ZAColumnValue: 'za', ZANumberValue: 'za',
  AZColumnValue: 'az', AZNumberValue: 'az',
  LimitValue: 'limit',
  ToValue: 'to', MapValue: 'map',
  GroupValue: 'group',
  IntersectValue: 'intersect', UnionValue: 'union', ExceptValue: 'except',
  SumValue: 'sum', AvgValue: 'avg', MaxValue: 'max', MinValue: 'min',
  SomeValue: 'some', EveryValue: 'every',
  TapValue: 'tap',
  DistinctValue: 'distinct',
  ReduceValue: 'reduce',
  KeysValue: 'keys', ValuesValue: 'values',
  ReverseValue: 'reverse',
}
const methodOfCtor = (ctor: any) => (METHOD_OF as any)[ctor] || (ctor || '').replace(/Value$/, '').toLowerCase()
function nodeLabel(n: any) {
  if (n.kind === 'operator') return `.${methodOfCtor(n.ctor)}()`
  if (n.kind === 'root')     return '<root>'
  if (n.kind === 'child')    return n.name ?? '?'
  return n.ctor ?? n.kind
}
function shortKind(n: any) { return n.ctor || n.kind || '?' }
// Escape HTML metacharacters before interpolating app/user-controlled strings
// into an innerHTML template — key paths, constructor names, and formatted
// values are all derived from the inspected app's data (object property names,
// row ids, string values), so a value like `<img onerror=…>` would otherwise
// execute in the panel's (closed-shadow, but still same-origin) context.
function esc(s: any) {
  return String(s).replace(/[&<>"']/g, (c: any) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;')
}
function formatValue(v: any) {
  if (v === undefined) return 'undefined'
  if (v === null) return 'null'
  if (Array.isArray(v)) return `Array(${v.length})`
  if (typeof v === 'object') {
    const keys = Object.keys(v)
    if (!keys.length) return '{}'
    return `{ ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', …' : ''} }`
  }
  if (typeof v === 'string') return v.length > 40 ? `"${v.slice(0, 40)}…"` : `"${v}"`
  return String(v)
}
function stamp(t: any) {
  const d = new Date()
  return `${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`
}
function verbClass(v: any) {
  if (!v) return ''
  if (v.startsWith('XU') || v.startsWith('BU')) return 'update'
  if (v.startsWith('BI')) return 'insert'
  if (v.startsWith('XR') || v.startsWith('BR')) return 'remove'
  if (v.startsWith('BMV')) return 'move'
  return ''
}
// User-facing label for a raw verb. The verb codes (XU0/BU1/BI0…) are an
// internal protocol detail; the Events tab needs plain English.
function friendlyVerb(v: any) {
  if (!v || v === 'init') return ''
  if (v.startsWith('XU') || v.startsWith('BU')) return 'updated'
  if (v.startsWith('BI')) return 'inserted'
  if (v.startsWith('XR') || v.startsWith('BR')) return 'removed'
  if (v.startsWith('BMV')) return 'moved'
  return v
}
function timeAgo(t: any) {
  const dt = Math.max(0, (performance.now() - t) / 1000)
  if (dt < 1)    return 'just now'
  if (dt < 60)   return `${Math.floor(dt)}s ago`
  if (dt < 3600) return `${Math.floor(dt / 60)}m ago`
  return `${Math.floor(dt / 3600)}h ago`
}
function cssEsc(s: any) { return String(s).replace(/[^a-zA-Z0-9_-]/g, '_') }
function findNodeByView(node: any, liveView: any): any {
  if (!node) return null
  if (node._view === liveView) return node
  for (const c of node.children || []) { const f: any = findNodeByView(c, liveView); if (f) return f }
  for (const s of node.sinks    || []) { const f: any = findNodeByView(s, liveView); if (f) return f }
  return null
}

// ============== Alt-hover ==============
function createAltHover(panelRoot: any, panelHost: any) {
  let altHeld = false, armed = false, pinned = false, current: any = null
  const layer = document.createElement('div'); layer.className = '__rp_alt_layer'
  document.body.appendChild(layer)
  const popover = document.createElement('div'); popover.className = '__rp_alt_pop'; popover.hidden = true
  document.body.appendChild(popover)
  const layerStyle = document.createElement('style')
  layerStyle.textContent = `
    .__rp_alt_layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483600; }
    .__rp_alt_pop {
      position: fixed; min-width: 240px; max-width: 320px;
      background: #1a1a1a; color: #e6e6e6; border: 1px solid #9be3a8;
      border-radius: 4px; padding: 8px 10px; z-index: 2147483646;
      font: 11px/1.5 ui-monospace, Menlo, monospace;
      box-shadow: 0 4px 16px rgba(0,0,0,.55); pointer-events: none;
    }
    .__rp_alt_pop.pinned { border-color: #9bb3e3; pointer-events: auto; }
    .__rp_alt_pop .h {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      color: #9bb3e3; font-weight: 600; margin-bottom: 4px; word-break: break-all;
    }
    .__rp_alt_pop .h .x {
      background: transparent; color: #888; border: 1px solid #2a2a2a;
      border-radius: 3px; padding: 1px 6px; cursor: pointer; font: inherit; font-size: 11px;
    }
    .__rp_alt_pop .h .x:hover { color: #e6e6e6; border-color: #9be3a8; }
    .__rp_alt_pop dl { display: grid; grid-template-columns: 50px 1fr; gap: 2px 8px; margin: 0 0 4px; }
    .__rp_alt_pop dt { color: #888; }
    .__rp_alt_pop dd { margin: 0; color: #ddd; }
    .__rp_alt_pop .hint { color: #666; font-size: 10px; }
    .__rp_alt_badge {
      position: absolute;
      font: 10px/1 ui-monospace, monospace;
      background: #9be3a8; color: #0f0f0f;
      padding: 2px 5px; border-radius: 2px;
      pointer-events: none; white-space: nowrap;
      box-shadow: 0 2px 6px rgba(0,0,0,.5);
    }
    .__rp_alt_outline { outline: 1px dashed #9be3a8; outline-offset: 1px; }
    .__rp_alt_hovered { outline: 2px solid #9be3a8 !important; outline-offset: 1px; }
  `
  document.head.appendChild(layerStyle)

  function findReactiveAncestor(el: any) {
    while (el) {
      if (el === panelHost) return null
      if (el.__ripple_sink) return el
      el = el.parentElement
    }
    return null
  }
  function gatherTargets() {
    const out: any[] = []
    document.querySelectorAll('*').forEach((el: any) => {
      if (el.__ripple_sink && el !== panelHost && !panelHost.contains(el)) out.push(el)
    })
    return out
  }
  function renderBadges() {
    layer.innerHTML = ''
    for (const el of gatherTargets()) {
      el.classList.add('__rp_alt_outline')
      const r = el.getBoundingClientRect()
      if (r.width === 0) continue
      const proxy = ($ as any).fromDOM(el); if (!proxy) continue
      // `proxy[view]` is the live View. `proxy[value]` returns the raw data,
      // which has no `.key`/`.constructor` — so the badge would always show
      // "Object" and key '<root>' for every reactive element.
      const v = proxy[view]
      const ctor = v?.constructor?.name || 'View'
      const badge = document.createElement('div')
      badge.className = '__rp_alt_badge'
      const k = (v?.key && v.key.length) ? v.key.join('.') : '<root>'
      badge.textContent = `${k} · ${ctor}`
      badge.style.left = `${r.right - 6}px`
      badge.style.top  = `${r.top - 8}px`
      badge.style.transform = 'translate(-100%, 0)'
      layer.appendChild(badge)
    }
  }
  function clear() {
    layer.innerHTML = ''
    document.querySelectorAll('.__rp_alt_outline').forEach(e => e.classList.remove('__rp_alt_outline'))
    document.querySelectorAll('.__rp_alt_hovered').forEach(e => e.classList.remove('__rp_alt_hovered'))
    if (!pinned) popover.hidden = true
  }
  function isActive() { return altHeld || armed }

  function unpinAndHide() {
    pinned = false
    popover.classList.remove('pinned')
    popover.hidden = true
  }

  function updatePopover(el: any, x: any, y: any) {
    if (pinned) return
    const proxy = ($ as any).fromDOM(el); if (!proxy) { popover.hidden = true; return }
    // Same `proxy[view]` vs `proxy[value]` distinction as renderBadges above.
    const v = proxy[view]
    const ctor = v?.constructor?.name || 'View'
    const k = (v?.key && v.key.length) ? v.key.join('.') : '<root>'
    let sinkCount = 0
    v?.sink?.(() => { sinkCount++ })
    // esc() every app-derived interpolation — k (key path), ctor, and the
    // formatted value all come from inspected data (see esc's note). sinkCount
    // is a number, safe.
    popover.innerHTML = `
      <div class="h">
        <span>${esc(k)}</span>
        <button class="x" type="button" title="close (Esc)">✕</button>
      </div>
      <dl>
        <dt>ctor</dt><dd>${esc(ctor)}</dd>
        <dt>sinks</dt><dd>${sinkCount}</dd>
        <dt>value</dt><dd>${esc(formatValue(v?.value))}</dd>
      </dl>
      <div class="hint">click to pin · click ✕ or Esc to close · Alt-release clears</div>
    `
    const closeBtn = popover.querySelector('.x')
    if (closeBtn) closeBtn.addEventListener('click', (ev) => { ev.stopPropagation(); unpinAndHide() })
    popover.hidden = false
    const W = popover.offsetWidth || 280, H = popover.offsetHeight || 100
    const px = (x + 16 + W > innerWidth)  ? x - W - 16 : x + 16
    const py = (y + 16 + H > innerHeight) ? y - H - 16 : y + 16
    popover.style.left = `${Math.max(8, px)}px`
    popover.style.top  = `${Math.max(8, py)}px`
  }

  const isAltKey = (e: any) => e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight'
  const onKeydown = (e: any) => {
    if (isAltKey(e) && !altHeld) {
      altHeld = true
      if (!pinned) renderBadges()
      // Prevent the browser from activating its menu bar (Chrome/Firefox open
      // the menu on a bare Alt press, which steals focus and means keyup may
      // never fire on the document). Without this, a single tap of Alt would
      // leave altHeld permanently true.
      e.preventDefault()
    }
  }
  const onKeyup = (e: any) => {
    if (isAltKey(e)) {
      altHeld = false
      if (!armed) clear()
      e.preventDefault()
    }
  }
  const onMove = (e: any) => {
    // Defensive sync: trust e.altKey over our tracked altHeld whenever the
    // mouse moves. If a keyup was swallowed (window blur, menu activation,
    // alt-tab), we recover on the very next mousemove instead of staying stuck.
    if (e.altKey !== altHeld) {
      altHeld = e.altKey
      if (altHeld && !pinned) renderBadges()
      else if (!altHeld && !armed) clear()
    }
    if (!isActive()) return
    const t = findReactiveAncestor(e.target)
    document.querySelectorAll('.__rp_alt_hovered').forEach(x => x.classList.remove('__rp_alt_hovered'))
    if (t) {
      t.classList.add('__rp_alt_hovered')
      current = t
      updatePopover(t, e.clientX, e.clientY)
    } else {
      current = null
      if (!pinned) popover.hidden = true
    }
  }
  // Recover from window-blur (Alt-Tab, switching apps) so altHeld doesn't get
  // stuck "true" forever.
  const onBlur = () => { altHeld = false; if (!armed) clear() }
  const onClick = (e: any) => {
    if (!isActive()) return
    const t = findReactiveAncestor(e.target); if (!t) return
    if (pinned) { pinned = false; popover.classList.remove('pinned'); popover.hidden = true; return }
    pinned = true; popover.classList.add('pinned'); e.stopPropagation(); e.preventDefault()
  }
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('keyup',   onKeyup)
  document.addEventListener('mousemove', onMove)
  document.addEventListener('click',   onClick, true)
  window.addEventListener('blur', onBlur)

  let raf: any = null
  const refresh = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = null; if (isActive()) renderBadges() }) }
  window.addEventListener('scroll', refresh, true)
  window.addEventListener('resize', refresh)

  return {
    toggleArm() { armed = !armed; if (armed) renderBadges(); else if (!altHeld) clear() },
    unpin() { unpinAndHide() },
    destroy() {
      clear()
      layer.remove(); popover.remove(); layerStyle.remove()
      document.removeEventListener('keydown', onKeydown)
      document.removeEventListener('keyup',   onKeyup)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('click',   onClick, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('scroll', refresh, true) // were leaked on teardown
      window.removeEventListener('resize', refresh)
    },
  }
}

function createDomPicker(panelRoot: any, onPick: any) {
  let armed = false
  const onClick = (e: any) => {
    if (!armed) return
    e.preventDefault(); e.stopPropagation()
    armed = false; document.body.style.cursor = ''
    onPick(e.target)
  }
  document.addEventListener('click', onClick, true)
  return {
    toggleArm() { armed = !armed; document.body.style.cursor = armed ? 'crosshair' : '' },
    destroy() { document.removeEventListener('click', onClick, true) },
  }
}

// ============== styles (injected into shadow root) ==============
function makeStyle() {
  const s = document.createElement('style')
  s.textContent = `
:host { all: initial; }
.dock {
  position: fixed; top: 0; right: 0; bottom: 0; width: 480px;
  background: #1a1a1a; color: #e6e6e6;
  border-left: 1px solid #2a2a2a;
  font: 12px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI";
  display: flex; flex-direction: column;
  z-index: 2147483646;
}
.dock.with-inspector { width: 840px; }
/* Outer resize handle: a thin strip on the left edge. Inline width on .dock
   (set by the drag handler) overrides both the default 480px and the
   .with-inspector 840px — so once the user has resized, their choice
   persists across inspector open/close. No width transition on .dock: a
   .18s ease-out used to animate the auto-widen, but it also fired after
   each drag-end (committing the new inline width counted as a transition
   from the CSS-rule width), so the dock visibly snapped back partway after
   release. Keeping resize crisp matters more than animating one open. */
.dock-resize {
  position: absolute; top: 0; bottom: 0; left: -3px; width: 7px;
  cursor: col-resize; z-index: 5;
  background: transparent;
  transition: background .12s;
}
.dock-resize:hover,
.dock-resize.dragging { background: rgba(155, 227, 168, 0.35); }
.dock-body {
  flex: 1; min-height: 0;
  display: flex; flex-direction: row;
}
.dock-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; border-bottom: 1px solid #2a2a2a;
  font-weight: 600;
}
.brand { color: #9be3a8; letter-spacing: .03em; }
.tools { display: flex; gap: 4px; }
.tools button {
  width: 28px; height: 26px; background: transparent; color: #888;
  border: 1px solid transparent; border-radius: 4px; cursor: pointer;
  font: inherit;
}
.tools button:hover { color: #e6e6e6; background: #222; border-color: #2a2a2a; }
.dock-toolbar2 {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px; background: #222; border-bottom: 1px solid #2a2a2a;
}
.layout-pick-label { color: #888; font-size: 11px; }
.seg {
  margin-left: auto;
  display: inline-flex; gap: 0;
  border: 1px solid #2a2a2a; border-radius: 4px; overflow: hidden;
}
.seg button {
  background: transparent; color: #888; border: none;
  padding: 3px 12px; cursor: pointer; font: inherit; font-size: 11px;
}
.seg button:hover { color: #e6e6e6; }
.seg button.active { background: #1a1a1a; color: #9be3a8; }


.graph-pane { flex: 1; min-width: 0; overflow: auto; padding: 8px 4px; }
.tnode { padding-left: 0; }
.tnode-row {
  display: flex; align-items: center; gap: 8px;
  padding: 3px 8px; border-radius: 4px; cursor: pointer; user-select: none;
}
.tnode-row:hover { background: #222; }
.tnode-row.selected {
  background: #2d3a2d;
  box-shadow: inset 2px 0 0 #9be3a8;
}
.tnode-row.selected .name { color: #9be3a8; font-weight: 600; }
.tnode-row .caret { color: #888; width: 10px; }
.tnode-row .kind {
  font-size: 10px; padding: 1px 6px; border-radius: 2px;
  background: #2a2a2a; color: #888;
}
.tnode-row .kind-root     { background: #2d3a2d; color: #9be3a8; }
.tnode-row .kind-operator { background: #2d3447; color: #9bb3e3; }
.tnode-row .kind-child    { background: #2a2a2a; color: #ccc; }
.tnode-row .kind-dom      { background: #3a2d2d; color: #e39b9b; }
.tnode-row .kind-connect  { background: #3a3727; color: #e3c98e; }
.tnode-row .name { color: #ddd; }
.tnode-row.selected .name { color: #9be3a8; font-weight: 600; }
.tnode-row .sinks { margin-left: auto; color: #666; font-variant-numeric: tabular-nums; }
.tnode-chip {
  margin-left: auto;
  background: #5e7593; color: #0f0f0f;
  border-radius: 8px; padding: 0 6px;
  font: 10px ui-monospace, monospace; line-height: 14px;
}
.tnode-cluster-meta {
  margin-left: auto; color: #cce3a8;
  font: 10px ui-monospace, monospace;
}
.tnode-kids { padding-left: 16px; border-left: 1px dotted #2a2a2a; margin-left: 8px; }

/* dag — pan + zoom viewport */
.dag-outer {
  position: relative;
  width: 100%; height: 100%;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  background:
    /* faint dot grid so it's obvious you can pan */
    radial-gradient(circle, #2a2a2a 1px, transparent 1px) 0 0 / 24px 24px,
    #141414;
}
.dag-outer.panning { cursor: grabbing; }
.dag-canvas {
  position: absolute; left: 0; top: 0;
  transform-origin: 0 0;
  will-change: transform;
}
.dag-tools {
  position: absolute; top: 8px; right: 8px;
  display: flex; flex-wrap: wrap; gap: 4px; align-items: center;
  background: rgba(26,26,26,.92);
  border: 1px solid #2a2a2a; border-radius: 4px;
  padding: 3px 6px;
  z-index: 2;
  font: 11px ui-monospace, monospace;
  max-width: calc(100% - 16px);
}
.dag-tools button {
  background: transparent; color: #aaa;
  border: none; border-radius: 3px;
  min-width: 24px; height: 22px; cursor: pointer;
  font: inherit; padding: 0 4px;
}
.dag-tools button:hover { background: #222; color: #9be3a8; }
.dag-scale { color: #888; padding: 0 6px 0 4px; min-width: 38px; text-align: right; font-variant-numeric: tabular-nums; }
.dag-check {
  display: inline-flex; align-items: center; gap: 3px;
  color: #aaa; cursor: pointer; padding: 0 4px; user-select: none;
  white-space: nowrap;
}
.dag-check:hover { color: #9be3a8; }
.dag-check input { accent-color: #9be3a8; margin: 0; cursor: pointer; }
.dag-sep { display: inline-block; width: 1px; height: 14px; background: #2a2a2a; margin: 0 2px; }
.dag-focus {
  display: inline-flex; align-items: center; gap: 4px;
  color: #9be3a8; max-width: 240px; overflow: hidden;
  padding: 0 4px;
}
.dag-focus-key { color: #ddd; font-family: ui-monospace, monospace; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dag-focus-clear { color: #9be3a8 !important; }

.dag-edges { position: absolute; left: 0; top: 0; pointer-events: none; }
.dag-edges path { stroke: #5e7593; stroke-width: 1.2; fill: none; opacity: .8; }
.dnode {
  position: absolute; box-sizing: border-box;
  border: 1px solid #2a2a2a; border-radius: 3px;
  background: #1f1f1f; padding: 2px 4px; cursor: pointer;
  display: flex; flex-direction: column; justify-content: center;
  font-size: 10px; line-height: 1.1;
  /* No overflow:hidden — the →N chip is positioned outside the node bounds
     and was being clipped. The .dnode-label and .dnode-sub children each
     have their own overflow:hidden+ellipsis for text truncation. */
}
.dnode-label { color: #e6e6e6; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; font-size: 10px; }
.dnode-sub   { color: #888; font-size: 9px; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
.dnode.kind-root { background: #2d3a2d; border-color: #3a4f3a; }
.dnode.kind-root .dnode-label { color: #9be3a8; }
.dnode.kind-operator { background: #2d3447; border-color: #3a4760; }
.dnode.kind-operator .dnode-label { color: #9bb3e3; }
.dnode.kind-dom { background: #3a2d2d; border-color: #4d3a3a; }
.dnode.kind-dom .dnode-label { color: #e39b9b; }
.dnode.selected {
  box-shadow: 0 0 0 2px #9be3a8, 0 0 14px rgba(155,227,168,.55);
  z-index: 3;
  border-color: #9be3a8;
}
.dnode:hover { filter: brightness(1.3); z-index: 1; }
.dnode.dimmed { opacity: 0.12; }
.dnode.dimmed:hover { opacity: 0.4; }
.dnode.focus-root {
  box-shadow: 0 0 0 2px #9be3a8, 0 0 18px rgba(155,227,168,.55);
  z-index: 2;
}
.dnode.kind-cluster {
  background: repeating-linear-gradient(135deg, #1f2329, #1f2329 4px, #232730 4px, #232730 8px);
  border: 1px dashed #4a5b3a;
}
.dnode.kind-cluster .dnode-label { color: #cce3a8; }
.dnode.kind-cluster .dnode-sub   { color: #888; font-style: italic; }
.dnode-chip {
  position: absolute; right: -6px; top: -7px;
  background: #5e7593; color: #0f0f0f;
  border-radius: 8px; padding: 1px 5px;
  font: 9px ui-monospace, monospace;
  pointer-events: none;
  box-shadow: 0 1px 3px rgba(0,0,0,.5);
}
/* When focus is active, edges also dim — done with opacity on the SVG */
.dag-canvas .dag-edges path { transition: opacity .15s; }

/* inspector — side-by-side column inside the dock-body flex row */
.inspector {
  width: 360px; flex-shrink: 0;
  background: #161616;
  display: flex; flex-direction: column;
  min-width: 0; min-height: 0;
  animation: slideIn .18s ease-out;
}
.inspector[hidden] { display: none; }

/* Vertical splitter between graph pane and inspector. Hidden until the
   inspector is open. Slightly wider hover/active hit-area than the visible
   1px line so dragging doesn't require pixel precision. */
.splitter { display: none; }
.dock.with-inspector .splitter {
  display: block;
  flex-shrink: 0;
  width: 5px;
  background: #2a2a2a;
  cursor: col-resize;
  transition: background .12s;
}
.dock.with-inspector .splitter:hover,
.dock.with-inspector .splitter.dragging { background: #9be3a8; }
@keyframes slideIn { from { transform: translateX(8px); opacity: 0; } to { transform: none; opacity: 1; } }
.insp-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; border-bottom: 1px solid #2a2a2a;
  gap: 8px;
}
.insp-title {
  color: #9be3a8; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
}
.insp-header .close-btn {
  background: #2d3a2d; color: #9be3a8;
  border: 1px solid #3a4f3a; border-radius: 4px;
  padding: 4px 10px; cursor: pointer; font: inherit;
  flex-shrink: 0;
}
.insp-header .close-btn:hover { background: #3a4f3a; color: #e6e6e6; }
.insp-tabs { display: flex; border-bottom: 1px solid #2a2a2a; }
.insp-tabs button {
  flex: 1; background: transparent; color: #888; border: none;
  padding: 7px 4px; cursor: pointer; font-size: 11px;
  border-bottom: 2px solid transparent; text-transform: capitalize;
  font-family: inherit;
}
.insp-tabs button:hover { color: #e6e6e6; }
.insp-tabs button.active { color: #9be3a8; border-bottom-color: #9be3a8; }
.insp-body { flex: 1; overflow: auto; padding: 10px 12px; }
dl.kv { display: grid; grid-template-columns: 80px 1fr; gap: 6px 12px; margin: 0 0 12px; }
dl.kv dt { color: #888; }
dl.kv dd { margin: 0; word-break: break-word; color: #ddd; }
.actions button {
  background: #222; color: #ddd; border: 1px solid #2a2a2a;
  padding: 5px 10px; border-radius: 4px; cursor: pointer; font: inherit;
}
.actions button:hover { border-color: #9be3a8; color: #9be3a8; }

/* ─── Inspect tab — card stack ──────────────────────────────────── */
.insp-card {
  background: #131313; border: 1px solid #2a2a2a; border-radius: 6px;
  margin: 0 0 10px;
  overflow: hidden;
}
.insp-card .card-title {
  padding: 6px 10px;
  background: #181818;
  border-bottom: 1px solid #2a2a2a;
  color: #888; font-size: 10px;
  text-transform: uppercase; letter-spacing: .08em;
}
.insp-card .card-body { padding: 10px 12px; }

.insp-card-identity { border-color: #3a4f3a; }
.insp-card-identity .card-title { background: #1f2a20; color: #9be3a8; }
.insp-card-identity .card-headline {
  color: #9be3a8;
  font: 13px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 600;
  word-break: break-all;
}
.insp-card-identity .card-sub {
  color: #888; font-size: 11px; margin-top: 4px;
}

.insp-card-value pre.card-value {
  margin: 0;
  font: 12px/1.4 ui-monospace, monospace;
  color: #e6e6e6;
  background: #1a1a1a;
  border: 1px solid #2a2a2a; border-radius: 4px;
  padding: 8px 10px;
  max-height: 200px; overflow: auto;
  white-space: pre;
  tab-size: 2;
}
.insp-card-value .card-sub {
  color: #888; font-size: 11px; margin-top: 6px;
}

.insp-card-connections .conn-row {
  display: flex; align-items: center; gap: 10px;
  padding: 4px 0; font-size: 12px;
}
.insp-card-connections .conn-dir {
  color: #9bb3e3; font: 11px ui-monospace, monospace;
  width: 44px; flex-shrink: 0;
}
.insp-card-connections .conn-detail {
  color: #ddd; font: 11px ui-monospace, monospace; word-break: break-all;
}

.insp-card-activity .card-stat {
  color: #e6e6e6; font-size: 12px; margin-bottom: 6px;
  font-variant-numeric: tabular-nums;
}
.insp-card-activity .card-verbs {
  display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px;
}
.insp-card-activity .verb-pill {
  background: #2a2a2a; color: #888;
  font: 10px ui-monospace, monospace;
  padding: 1px 6px; border-radius: 8px;
}
.insp-card-activity .verb-pill.update { background: #2d3447; color: #9bb3e3; }
.insp-card-activity .verb-pill.insert { background: #2d3a2d; color: #9be3a8; }
.insp-card-activity .verb-pill.remove { background: #3a2d2d; color: #e39b9b; }
.insp-card-activity .verb-pill.move   { background: #3a3727; color: #e3c98e; }
.insp-card-activity .card-sub {
  color: #888; font-size: 11px;
}

/* ─── Bound DOM section inside the Inspect tab ──────────────────── */
.bound-section {
  margin: 0 0 14px;
  border: 1px solid #2a2a2a; border-radius: 6px;
  background: #131313;
}
.bound-head {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid #2a2a2a;
}
.bound-title {
  color: #9bb3e3; font-weight: 600; font-size: 11px;
  text-transform: uppercase; letter-spacing: .06em;
}
.bound-count { color: #888; font-size: 11px; flex: 1; }
.bound-all {
  background: #2d3a2d; color: #9be3a8;
  border: 1px solid #3a4f3a; border-radius: 3px;
  padding: 3px 8px; cursor: pointer; font: inherit; font-size: 11px;
}
.bound-all:hover { background: #3a4f3a; color: #e6e6e6; }
.bound-note {
  padding: 10px 12px; color: #888; font-style: italic; font-size: 11px;
}
.bound-list {
  list-style: none; padding: 4px 0; margin: 0;
  max-height: 280px; overflow: auto;
}
.bound-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px dashed #2a2a2a;
}
.bound-row:last-child { border-bottom: none; }
.bound-row:hover { background: #1f1f1f; }
.bound-left { flex: 1; min-width: 0; }
.bound-tagline { display: block; margin-bottom: 2px; }
.bound-tag {
  display: inline-block;
  font: 11px ui-monospace, monospace;
  color: #9be3a8;
}
.bound-prop {
  color: #9bb3e3; font: 10px ui-monospace, monospace;
}
.bound-snippet {
  color: #aaa; font-size: 11px;
  word-break: break-word;
}
.bound-via {
  color: #5e7593; font-size: 10px; font-family: ui-monospace, monospace;
  margin-top: 2px;
}
.bound-right { display: flex; gap: 4px; flex-shrink: 0; }
.bound-right button {
  background: #1a1a1a; color: #ccc;
  border: 1px solid #2a2a2a; border-radius: 3px;
  padding: 3px 8px; cursor: pointer; font: inherit; font-size: 10px;
}
.bound-right button:hover { border-color: #9be3a8; color: #9be3a8; }
.bound-other { opacity: 0.7; }
.bound-other .bound-tag { color: #e3c98e; }
.bound-more {
  padding: 6px 10px; color: #666; font-style: italic; font-size: 11px;
}
.__ripple_highlight { outline: 2px solid #9be3a8 !important; outline-offset: 2px; }
.ev-controls { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
.ev-controls button {
  background: #222; color: #ddd; border: 1px solid #2a2a2a;
  padding: 4px 10px; border-radius: 4px; cursor: pointer; font: inherit; font-size: 11px;
}
.ev-controls button:hover { border-color: #9be3a8; color: #9be3a8; }
.ev-debug {
  margin-left: auto; color: #888;
  font: 10px ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 240px;
}

/* ─── value timeline + collection activity (Events tab) ─────────── */
.ev-body { display: flex; flex-direction: column; gap: 0; }
.ev-card {
  background: #131313; border: 1px solid #2a2a2a; border-radius: 6px;
  margin: 0 0 10px;
  overflow: hidden;
}
.ev-card-title {
  padding: 6px 10px;
  background: #181818;
  border-bottom: 1px solid #2a2a2a;
  color: #888; text-transform: uppercase; font-size: 10px; letter-spacing: .08em;
  display: flex; align-items: center; justify-content: space-between;
}
.ev-card-current {
  color: #9be3a8; text-transform: none; letter-spacing: 0;
  font-size: 11px; font-family: ui-monospace, monospace;
}
.ev-empty { padding: 10px 12px; margin: 0; }

/* Sparkline */
.ev-spark { display: block; width: 100%; padding: 4px 8px 0; }
.ev-spark-grid  { stroke: #2a2a2a; stroke-dasharray: 2 3; }
.ev-spark-axis  { fill: #666; font: 9px ui-monospace, monospace; }
.ev-spark-line  { fill: none; stroke: #9be3a8; stroke-width: 1.5; stroke-linejoin: round; }
.ev-spark-dot   { fill: #9be3a8; }
.ev-spark-empty { fill: #666; font: 11px ui-sans-serif, system-ui; }

/* Transition / recent lists */
.ev-trans, .ev-recent { list-style: none; padding: 4px 10px 8px; margin: 0; }
.ev-trans li, .ev-recent li {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 0;
  border-bottom: 1px solid #1f1f1f;
  font-size: 11px;
}
.ev-trans li:last-child, .ev-recent li:last-child { border-bottom: none; }
.ev-trans-time { color: #666; width: 64px; flex-shrink: 0; font-variant-numeric: tabular-nums; }
.ev-trans-delta {
  flex: 1; color: #ddd; font-family: ui-monospace, monospace;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ev-recent-key {
  color: #ddd; font-family: ui-monospace, monospace; flex: 1;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ev-recent-payload {
  color: #888; font-family: ui-monospace, monospace; max-width: 140px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* Reusable verb pill (used here AND inside the Inspect-tab activity card) */
.verb-pill {
  font-size: 9px; text-transform: uppercase; letter-spacing: .04em;
  padding: 2px 6px; border-radius: 3px;
  background: #232323; color: #888;
  flex-shrink: 0;
}
.verb-pill.update { background: #2d3447; color: #9bb3e3; }
.verb-pill.insert { background: #2d3a2d; color: #9be3a8; }
.verb-pill.remove { background: #3a2d2d; color: #e39b9b; }
.verb-pill.move   { background: #3a3727; color: #e3c98e; }

/* Collection activity summary */
.ev-summary {
  padding: 10px 12px;
  display: flex; gap: 14px; flex-wrap: wrap;
  font-size: 12px; font-variant-numeric: tabular-nums;
}
.ev-stat-insert { color: #9be3a8; }
.ev-stat-remove { color: #e39b9b; }
.ev-stat-update { color: #9bb3e3; }
.ev-stat-move   { color: #e3c98e; }

/* Per-row heat bars */
.ev-heat { list-style: none; padding: 6px 10px 8px; margin: 0; }
.ev-heat li {
  display: flex; align-items: center; gap: 8px;
  padding: 3px 0; font-size: 11px;
}
.ev-heat-key {
  color: #ddd; width: 70px; flex-shrink: 0;
  font-family: ui-monospace, monospace;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ev-heat-bar {
  flex: 1; display: flex; height: 8px;
  background: #1f1f1f; border-radius: 2px; overflow: hidden;
}
.ev-heat-seg { display: block; height: 100%; }
.ev-heat-seg.update { background: #9bb3e3; }
.ev-heat-seg.insert { background: #9be3a8; }
.ev-heat-seg.remove { background: #e39b9b; }
.ev-heat-seg.move   { background: #e3c98e; }
.ev-heat-count {
  color: #888; width: 24px; text-align: right;
  flex-shrink: 0; font-variant-numeric: tabular-nums;
}
.prof-wrap { max-height: calc(100% - 40px); overflow: auto; }
table.prof { width: 100%; border-collapse: collapse; font-size: 11px; }
table.prof th, table.prof td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #2a2a2a; }
table.prof th { color: #888; font-weight: 500; background: #181818; position: sticky; top: 0; }
table.prof td:nth-child(n+2), table.prof th:nth-child(n+2) { text-align: right; font-variant-numeric: tabular-nums; }
.muted { color: #888; }
  `
  return s
}
