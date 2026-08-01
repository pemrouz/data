// v3/devtools/panel/graph.ts — the node-link graph view. Renders graph()
// (the kernel's live registry projection — plain data, no live node refs) as
// height-columned boxes with SVG edges. This is the v2 panel's DAG pane
// re-cut for v3's flat GraphInfo: no tree walk, no sink chips — the kernel
// already gives id/op/kind/height/parents for every live node.
//
// Liveness: a runtime.onCommit subscription schedules ONE rebuild per
// animation frame (setTimeout 16 outside browsers) — commits during a busy
// frame coalesce; the subscription also keeps the kernel's per-node stats on,
// which the inspector's profile numbers ride on for free. ctx.refresh()
// reaches here through the shell's registerRefreshable wiring.
//
// Rebuild-not-patch: refresh() reconstructs the canvas children. At panel
// scale (tens of nodes) a rebuild is cheaper than diffing, and it makes
// selection rings / mode flips / disposals all fall out of one code path.
// Pan/zoom state lives OUTSIDE the rebuild so it survives refreshes.
//
// Mock-DOM discipline (shared with panel/index.ts): appendChild-only (no
// append()), styles via setAttribute('style'), optional-call guards on
// getBoundingClientRect/setPointerCapture/preventDefault/closest — the render
// mock implements none of them.

import type { PanelCtx } from './ctx.ts'
import { graph } from '../index.ts'

const NODE_W = 96
const NODE_H = 30
const GAP_X = 44
const GAP_Y = 10
const PAD = 16
const SCALE_MIN = 0.25
const SCALE_MAX = 2.5
const SVG_NS = 'http://www.w3.org/2000/svg'

const frame: (fn: () => void) => void =
  typeof requestAnimationFrame === 'function' ? (fn) => requestAnimationFrame(fn) : (fn) => setTimeout(fn, 16)

export function mountGraph(ctx: PanelCtx, host: any): { refresh(): void; destroy(): void } {
  const doc = ctx.doc
  const el = (tag: string, cls: string, text?: string): any => {
    const e = doc.createElement(tag)
    if (cls !== '') e.setAttribute('class', cls)
    if (text !== undefined) e.textContent = text
    return e
  }

  // tree = dedupe multi-parent edges to the FIRST parent (an outline);
  // dag = every edge (the real dependency shape). DAG is the default — it is
  // what the kernel graph IS; tree stays one click away (the v2 discipline).
  let mode: 'tree' | 'dag' = 'dag'
  // scale null = auto-fit on the next rebuild that can measure the viewport;
  // once the user pans/zooms we keep their numbers across rebuilds.
  const view = { scale: null as number | null, tx: 0, ty: 0 }
  let contentW = 0
  let contentH = 0

  // ── scaffold (built once; refresh rebuilds canvas children only) ────────────
  const tools = el('div', 'gtools')
  const seg = el('div', 'gseg')
  const treeBtn = el('button', '', 'Tree')
  const dagBtn = el('button', 'active', 'DAG')
  seg.appendChild(treeBtn)
  seg.appendChild(dagBtn)
  tools.appendChild(seg)
  const fitBtn = el('button', 'gfit', '⛶')
  fitBtn.title = 'fit to view'
  tools.appendChild(fitBtn)
  const scaleLbl = el('span', 'gscale', '100%')
  tools.appendChild(scaleLbl)

  const outer = el('div', 'gouter')
  const canvas = el('div', 'gcanvas')
  outer.appendChild(canvas)
  host.appendChild(tools)
  host.appendChild(outer)

  const applyView = (): void => {
    const s = view.scale ?? 1
    canvas.setAttribute(
      'style',
      `width:${contentW}px;height:${contentH}px;transform:translate(${view.tx}px,${view.ty}px) scale(${s})`,
    )
    scaleLbl.textContent = `${Math.round(s * 100)}%`
  }

  const fit = (): void => {
    const r = outer.getBoundingClientRect?.()
    if (r === undefined || r.width === 0 || r.height === 0 || contentW === 0) return
    const s = Math.min((r.width - 16) / contentW, (r.height - 16) / contentH, 1)
    view.scale = Math.max(SCALE_MIN, s)
    view.tx = Math.max(0, (r.width - contentW * view.scale) / 2)
    view.ty = Math.max(0, (r.height - contentH * view.scale) / 2)
    applyView()
  }

  const setMode = (next: 'tree' | 'dag'): void => {
    if (mode === next) return
    mode = next
    treeBtn.setAttribute('class', next === 'tree' ? 'active' : '')
    dagBtn.setAttribute('class', next === 'dag' ? 'active' : '')
    refresh()
  }
  treeBtn.addEventListener('click', () => setMode('tree'))
  dagBtn.addEventListener('click', () => setMode('dag'))
  fitBtn.addEventListener('click', () => fit())

  // ── rebuild ─────────────────────────────────────────────────────────────────
  const refresh = (): void => {
    const g = graph(ctx.runtime)
    // .children is an indexable list in both the real DOM and the render mock
    // (the mock has no firstChild).
    while (canvas.children.length > 0) canvas.removeChild(canvas.children[canvas.children.length - 1])
    if (g.nodes.length === 0) {
      canvas.appendChild(el('div', 'gempty', 'no live nodes — build a $ chain'))
      contentW = 0
      contentH = 0
      applyView()
      return
    }

    // Columns by height (height IS depth — the kernel maintains it); sparse
    // heights compact to consecutive columns. Row order within a column = id
    // (creation order) so positions are stable across rebuilds.
    const heights = [...new Set(g.nodes.map((n) => n.height))].sort((a, b) => a - b)
    const colOf = new Map<number, number>()
    heights.forEach((h, i) => colOf.set(h, i))
    const rows = new Map<number, number>() // column → next free row
    const pos = new Map<number, { x: number; y: number }>()
    for (const n of [...g.nodes].sort((a, b) => a.id - b.id)) {
      const c = colOf.get(n.height)!
      const r = rows.get(c) ?? 0
      rows.set(c, r + 1)
      pos.set(n.id, { x: PAD + c * (NODE_W + GAP_X), y: PAD + r * (NODE_H + GAP_Y) })
    }
    const maxRows = Math.max(...rows.values())
    contentW = PAD * 2 + heights.length * NODE_W + (heights.length - 1) * GAP_X
    contentH = PAD * 2 + maxRows * NODE_H + (maxRows - 1) * GAP_Y

    // Edges: parent right-center → child left-center. Tree mode keeps only
    // the first parent of a multi-parent node (set-ops, between bounds).
    const svg = doc.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('class', 'gedges')
    svg.setAttribute('width', String(contentW))
    svg.setAttribute('height', String(contentH))
    for (const n of g.nodes) {
      const parents = mode === 'tree' && n.parents.length > 1 ? [n.parents[0]] : n.parents
      for (const p of parents) {
        const a = pos.get(p)
        const b = pos.get(n.id)
        if (a === undefined || b === undefined) continue // parent already disposed
        const line = doc.createElementNS(SVG_NS, 'line')
        line.setAttribute('x1', String(a.x + NODE_W))
        line.setAttribute('y1', String(a.y + NODE_H / 2))
        line.setAttribute('x2', String(b.x))
        line.setAttribute('y2', String(b.y + NODE_H / 2))
        svg.appendChild(line)
      }
    }
    canvas.appendChild(svg)

    const sel = ctx.selected()
    for (const n of g.nodes) {
      const p = pos.get(n.id)!
      const box = el('div', `gnode kind-${n.kind}` + (n.id === sel ? ' selected' : ''))
      box.setAttribute('style', `left:${p.x}px;top:${p.y}px;width:${NODE_W}px;height:${NODE_H}px`)
      box.setAttribute('data-node-id', String(n.id))
      box.title = `${n.op}#${n.id} · ${n.kind} · height ${n.height}`
      box.appendChild(el('div', 'gnode-label', `${n.op}#${n.id}`))
      box.appendChild(el('div', 'gnode-sub', n.kind))
      box.addEventListener('click', (e: any) => {
        e?.stopPropagation?.()
        ctx.select(n.id)
      })
      canvas.appendChild(box)
    }

    if (view.scale === null) {
      view.scale = 1
      frame(fit) // measure after layout; no-op where rects are unavailable
    }
    applyView()
  }

  // ── pan (drag background) + zoom (wheel) ───────────────────────────────────
  let pan: { x: number; y: number } | null = null
  let moved = false
  outer.addEventListener('pointerdown', (e: any) => {
    if (e?.target?.closest?.('.gnode') != null || e?.target?.closest?.('.gtools') != null) return
    pan = { x: e.clientX ?? 0, y: e.clientY ?? 0 }
    moved = false
    try {
      outer.setPointerCapture?.(e.pointerId)
    } catch {}
  })
  outer.addEventListener('pointermove', (e: any) => {
    if (pan === null) return
    const dx = (e.clientX ?? 0) - pan.x
    const dy = (e.clientY ?? 0) - pan.y
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true
    view.tx += dx
    view.ty += dy
    pan = { x: e.clientX ?? 0, y: e.clientY ?? 0 }
    applyView()
  })
  const endPan = (e: any): void => {
    if (pan === null) return
    pan = null
    try {
      outer.releasePointerCapture?.(e.pointerId)
    } catch {}
  }
  outer.addEventListener('pointerup', endPan)
  outer.addEventListener('pointercancel', endPan)
  // Click on empty background (not a drag) clears the selection — the one
  // deselect gesture; the shell folds the inspector away on select(null).
  outer.addEventListener('click', (e: any) => {
    if (e?.target?.closest?.('.gnode') != null || e?.target?.closest?.('.gtools') != null) return
    if (moved) return
    ctx.select(null)
  })
  outer.addEventListener(
    'wheel',
    (e: any) => {
      e?.preventDefault?.()
      const factor = (e.deltaY ?? 0) > 0 ? 0.88 : 1.14
      const cur = view.scale ?? 1
      const next = Math.max(SCALE_MIN, Math.min(SCALE_MAX, cur * factor))
      const r = outer.getBoundingClientRect?.() ?? { left: 0, top: 0 }
      const cx = (e.clientX ?? 0) - r.left
      const cy = (e.clientY ?? 0) - r.top
      view.tx = cx - (cx - view.tx) * (next / cur)
      view.ty = cy - (cy - view.ty) * (next / cur)
      view.scale = next
      applyView()
    },
    { passive: false },
  )

  // ── liveness ────────────────────────────────────────────────────────────────
  let queued = false
  let dead = false
  const schedule = (): void => {
    if (queued) return
    queued = true
    frame(() => {
      queued = false
      if (!dead) refresh()
    })
  }
  const commitSub = ctx.runtime.onCommit(() => schedule())
  const unSelect = ctx.onSelect(() => refresh()) // move the ring

  refresh()

  return {
    refresh,
    destroy(): void {
      dead = true
      commitSub.dispose()
      unSelect()
      if (tools.parentNode != null) host.removeChild(tools)
      if (outer.parentNode != null) host.removeChild(outer)
    },
  }
}
