// @ts-nocheck
// Graph tab: root selector + collapsible tree, rebuilt from $.graph() snapshots.
// Re-walks on rAF when the selected root mutates (via $.trace) so the tree
// reflects current state without flooding the panel during bursts.
//
// Layout modes:
//   - 'tree' (default) — collapsible <details> tree.
//   - 'dag'            — node-link layered diagram, deduped by view identity,
//                        rendered as positioned divs + an SVG edge layer.
//                        Useful when a node has multiple sinks (the tree
//                        view duplicates the subtree per path; the DAG
//                        shows it once with multiple outgoing edges).
import { $ as $core, value, view, ViewProxy, Operator } from '../../core.ts'
import { iterRoots, walk, classify, summarize } from '../walk.ts'
import { getPanelState, getPickedSink } from './state.ts'

export type GraphTabHandle = {
  render(container: HTMLElement): void
  dispose(): void
}

const $ = $core as any   // public devtools API methods are bolted onto $ at runtime

export function createGraphTab(): GraphTabHandle {
  const state = getPanelState()
  let traceDispose: (() => void) | null = null
  let rafQueued = false
  let lastContainer: HTMLElement | null = null
  let lastSelectedKey: string | null = null

  function selectedRoot() {
    const showInternal = state[value].showInternal
    const all = [...iterRoots({ internal: showInternal })]
    if (!all.length) return null
    const idx = state[value].selectedRootIdx ?? 0
    return all[Math.min(idx, all.length - 1)] ?? all[0]
  }

  function scheduleRewalk() {
    if (rafQueued) return
    rafQueued = true
    const raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (fn: any) => setTimeout(fn, 16)
    raf(() => {
      rafQueued = false
      if (lastContainer) render(lastContainer)
    })
  }

  function render(container: HTMLElement) {
    lastContainer = container
    container.innerHTML = ''
    const showInternal = state[value].showInternal
    const roots = [...iterRoots({ internal: showInternal })]

    // Toolbar: root selector + show-internal toggle.
    const toolbar = document.createElement('div')
    toolbar.className = 'gt-toolbar'
    container.appendChild(toolbar)

    const selectLabel = document.createElement('span')
    selectLabel.textContent = 'root: '
    selectLabel.className = 'gt-label'
    toolbar.appendChild(selectLabel)

    const select = document.createElement('select')
    select.className = 'gt-select'
    if (roots.length === 0) {
      const opt = document.createElement('option')
      opt.textContent = '(no live roots)'
      select.appendChild(opt)
      select.disabled = true
    } else {
      for (let i = 0; i < roots.length; i++) {
        const opt = document.createElement('option')
        opt.value = String(i)
        const v = roots[i].value
        opt.textContent = `#${i} ${summarizeForOption(v)}`
        select.appendChild(opt)
      }
      const idx = Math.min(state[value].selectedRootIdx ?? 0, roots.length - 1)
      select.value = String(idx)
    }
    select.addEventListener('change', () => {
      state.selectedRootIdx = Number(select.value)
      installTraceForRoot(roots[Number(select.value)])
      render(container)
    })
    toolbar.appendChild(select)

    const internalLabel = document.createElement('label')
    internalLabel.className = 'gt-checkbox'
    const internalBox = document.createElement('input')
    internalBox.type = 'checkbox'
    internalBox.checked = !!showInternal
    internalBox.addEventListener('change', () => {
      state.showInternal = !!internalBox.checked
      render(container)
    })
    internalLabel.appendChild(internalBox)
    internalLabel.appendChild(document.createTextNode(' show internal'))
    toolbar.appendChild(internalLabel)

    // Layout toggle: tree | DAG. Persists via state.graph.layout (added to
    // DEFAULT in state.ts). Default is 'tree' to preserve existing UX.
    const layoutLabel = document.createElement('label')
    layoutLabel.className = 'gt-checkbox'
    const layoutBox = document.createElement('input')
    layoutBox.type = 'checkbox'
    layoutBox.checked = state[value].graph?.layout === 'dag'
    layoutBox.addEventListener('change', () => {
      state.graph.layout = layoutBox.checked ? 'dag' : 'tree'
      render(container)
    })
    layoutLabel.appendChild(layoutBox)
    layoutLabel.appendChild(document.createTextNode(' DAG'))
    toolbar.appendChild(layoutLabel)

    // Tree.
    const treeRoot = document.createElement('div')
    treeRoot.className = 'gt-tree'
    container.appendChild(treeRoot)

    const sel = roots.length ? roots[Math.min(state[value].selectedRootIdx ?? 0, roots.length - 1)] : null
    if (!sel) {
      const empty = document.createElement('div')
      empty.className = 'empty'
      empty.textContent = 'No live roots — call $({...}) somewhere on the page.'
      treeRoot.appendChild(empty)
      return
    }

    if (lastSelectedKey !== keyOf(sel)) {
      installTraceForRoot(sel)
      lastSelectedKey = keyOf(sel)
    }

    const layout = state[value].graph?.layout ?? 'tree'
    if (layout === 'dag') {
      treeRoot.classList?.add?.('gt-dag-mode')
      renderDag(sel, treeRoot)
      return
    }

    const tree = walk(sel, { pickedSink: getPickedSink() })
    const wrap = renderNode(tree, [])
    treeRoot.appendChild(wrap)
    // If a node was tagged picked, scroll it into view after the DOM has
    // settled. Using rAF instead of a 0ms timeout keeps it inside the same
    // frame as the render so the user sees a single coherent change.
    const picked = wrap.querySelector?.('.gt-picked') as HTMLElement | null
    if (picked && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => { try { picked.scrollIntoView?.({ block: 'nearest' }) } catch {} })
    }
  }

  function installTraceForRoot(v: any) {
    if (traceDispose) { traceDispose(); traceDispose = null }
    if (!v) return
    const proxy = new ViewProxy(v)
    traceDispose = ($ as any).trace(proxy, {
      log: false,
      onEvent: scheduleRewalk,
    })
  }

  function dispose() {
    if (traceDispose) { traceDispose(); traceDispose = null }
    lastContainer = null
  }

  return { render, dispose }
}

function keyOf(v: any) { return (v.key || []).join('.') || '<root>' }

function summarizeForOption(v: unknown) {
  if (v === undefined) return 'undefined'
  if (v === null) return 'null'
  if (Array.isArray(v)) return `Array(${v.length})`
  if (typeof v === 'object') {
    const keys = Object.keys(v as object)
    return keys.length ? `{ ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', …' : ''} }` : '{}'
  }
  return String(v)
}

function renderNode(node: any, path: (string | number)[]): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'gt-node' + (node.picked ? ' gt-picked' : '')
  const hasChildren = (node.children?.length || 0) + (node.sinks?.length || 0) > 0
  if (hasChildren) {
    const det = document.createElement('details')
    // Auto-expand the top two levels and any branch on the path to a
    // picked node, so a freshly-picked sink is visible without manual
    // expansion.
    det.open = path.length < 2 || !!node.pickedAncestor
    const sum = document.createElement('summary')
    sum.appendChild(badge(node))
    sum.appendChild(label(node))
    det.appendChild(sum)
    const inner = document.createElement('div')
    inner.className = 'gt-children'
    for (const c of node.children || []) inner.appendChild(renderNode(c, [...path, c.name ?? '?']))
    for (const s of node.sinks || []) inner.appendChild(renderNode(s, [...path, s.kind]))
    det.appendChild(inner)
    wrap.appendChild(det)
  } else {
    wrap.appendChild(badge(node))
    wrap.appendChild(label(node))
  }
  return wrap
}

function badge(node: any): HTMLElement {
  const b = document.createElement('span')
  b.className = `gt-badge gt-${node.kind}`
  b.textContent = node.kind
  return b
}

function label(node: any): HTMLElement {
  const s = document.createElement('span')
  s.className = 'gt-rowlabel'
  const name = node.kind === 'operator' ? node.ctor : (node.name ?? '<root>')
  const valStr = node.value !== undefined ? ` = ${formatVal(node.value)}` : ''
  s.textContent = ` ${name}${valStr}`
  return s
}

function formatVal(v: any) {
  if (typeof v === 'string') return v
  return String(v)
}

// ─── DAG mode ──────────────────────────────────────────────────────────────
// Flat walker: produces { nodes, edges } where each view is one node and
// each parent→child / source→sink relationship is one edge. Deduped by
// view identity (Map<View, id>). Cycles are pruned by the same Map.
const NODE_W = 100
const NODE_H = 26
const COL_GAP = 20
const ROW_GAP = 22
const PAD = 10

function buildDag(rootView: any) {
  const nodes: any[] = []
  const edges: { from: number; to: number; kind: string }[] = []
  const seen = new Map<any, number>()

  function visit(viewObj: any, kind: string, ctor: string | null): number {
    if (seen.has(viewObj)) return seen.get(viewObj)!
    const id = nodes.length
    seen.set(viewObj, id)
    nodes.push({
      id,
      key: [...(viewObj.key || [])],
      name: viewObj.name,
      kind,
      ctor,
      value: summarize(viewObj.value),
    })
    // Named children — `data.foo` style sub-views.
    viewObj.each?.((_name: string, child: any) => {
      const cid = visit(child, 'child', null)
      edges.push({ from: id, to: cid, kind: 'child' })
    })
    // Sinks — operators (recurse into their internal view) or terminal
    // sinks (DOMSink, ArrSink, FunctionSink) which become leaf nodes.
    viewObj.sink?.((s: any) => {
      if (s instanceof Operator) {
        const sid = visit(s.view, 'operator', s.constructor.name)
        edges.push({ from: id, to: sid, kind: 'sink' })
      } else {
        const leafId = nodes.length
        nodes.push({
          id: leafId,
          key: [...(viewObj.key || [])],
          kind: classify(s),
          ctor: s.constructor?.name || 'anonymous',
        })
        edges.push({ from: id, to: leafId, kind: 'sink' })
      }
    })
    return id
  }
  visit(rootView, 'root', null)
  return { nodes, edges }
}

// BFS depth assignment from node 0 (the root). For nodes reachable along
// multiple paths, depth is the *minimum* — they sit at the shallowest
// position the graph allows, so edges visually fan downward.
function layoutDag(dag: { nodes: any[]; edges: any[] }) {
  const { nodes, edges } = dag
  const depth = new Array(nodes.length).fill(-1)
  const queue: number[] = [0]
  depth[0] = 0
  // Pre-build adjacency once instead of N scans of edges per node.
  const adj: number[][] = Array.from({ length: nodes.length }, () => [])
  for (const e of edges) adj[e.from].push(e.to)
  while (queue.length) {
    const i = queue.shift()!
    for (const j of adj[i]) {
      if (depth[j] === -1) { depth[j] = depth[i] + 1; queue.push(j) }
    }
  }
  // Group by depth, assign x-position by index within depth.
  const byDepth: number[][] = []
  for (let i = 0; i < nodes.length; i++) {
    const d = depth[i] === -1 ? 0 : depth[i]
    ;(byDepth[d] ||= []).push(i)
  }
  const positions = new Array(nodes.length)
  let maxDepth = 0
  for (let d = 0; d < byDepth.length; d++) {
    const row = byDepth[d] || []
    for (let col = 0; col < row.length; col++) {
      const i = row[col]
      positions[i] = {
        x: PAD + col * (NODE_W + COL_GAP),
        y: PAD + d * (NODE_H + ROW_GAP),
      }
    }
    if (d > maxDepth) maxDepth = d
  }
  const cols = byDepth.reduce((m, r) => Math.max(m, (r || []).length), 0)
  return {
    positions,
    width: PAD * 2 + cols * NODE_W + (cols - 1) * COL_GAP,
    height: PAD * 2 + (maxDepth + 1) * NODE_H + maxDepth * ROW_GAP,
  }
}

function renderDag(sel: any, container: HTMLElement) {
  const dag = buildDag(sel)
  const { positions, width, height } = layoutDag(dag)

  const wrap = document.createElement('div')
  wrap.className = 'gt-dag'
  wrap.style.position = 'relative'
  wrap.style.minWidth = `${width}px`
  wrap.style.minHeight = `${height}px`
  container.appendChild(wrap)

  // SVG edge layer below the nodes — pointer-events:none so node hover
  // still works through it.
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String(height))
  svg.setAttribute('class', 'gt-dag-edges')
  svg.style.position = 'absolute'
  svg.style.left = '0'
  svg.style.top = '0'
  svg.style.pointerEvents = 'none'
  wrap.appendChild(svg)

  for (const e of dag.edges) {
    const a = positions[e.from]
    const b = positions[e.to]
    if (!a || !b) continue
    const x1 = a.x + NODE_W / 2
    const y1 = a.y + NODE_H
    const x2 = b.x + NODE_W / 2
    const y2 = b.y
    // Smooth cubic so edges don't kink — mid-control points pull vertically.
    const cy = (y1 + y2) / 2
    const path = document.createElementNS(NS, 'path')
    path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${cy}, ${x2} ${cy}, ${x2} ${y2}`)
    path.setAttribute('class', `gt-dag-edge gt-dag-edge-${e.kind}`)
    path.setAttribute('fill', 'none')
    svg.appendChild(path)
  }

  // Node layer.
  for (let i = 0; i < dag.nodes.length; i++) {
    const n = dag.nodes[i]
    const p = positions[i] || { x: 0, y: 0 }
    const node = document.createElement('div')
    node.className = `gt-dag-node gt-${n.kind}`
    node.style.position = 'absolute'
    node.style.left = `${p.x}px`
    node.style.top = `${p.y}px`
    node.style.width = `${NODE_W}px`
    node.style.height = `${NODE_H}px`
    const lbl = n.kind === 'operator' ? n.ctor
              : n.kind === 'root'     ? '<root>'
              : n.kind === 'child'    ? (n.name ?? '?')
              :                          (n.ctor ?? n.kind)
    node.textContent = lbl
    node.title = `${n.kind}${n.ctor ? ' · ' + n.ctor : ''}${n.key?.length ? ' · ' + n.key.join('.') : ''}` +
                 (n.value !== undefined ? ` · ${n.value}` : '')
    wrap.appendChild(node)
  }
}
