// v3/devtools/panel/index.ts — the panel shell: host element + closed shadow
// root, right-edge dock, resize handle, toolbar, and the graph/inspector/
// picker wiring. The v2 panel's dock UX (closed shadow so page CSS can't
// bleed in; left-edge drag handle; width persisted to localStorage), re-cut
// over the v3 PanelCtx: one selection channel, modules render from ctx state.
//
// Lifecycle: mountPanel builds the shell ONCE (module singleton — a second
// call returns the live handle, the v2 double-dock guard). open() attaches
// the host to doc.body and mounts the modules; close() destroys the modules
// (their onCommit subscriptions die with them) and detaches the host — the
// handle survives close/open cycles, so `shell` is stable for tests.
//
// Shadow fallback: attachShadow is feature-detected at runtime. Where it is
// missing (the node mock DOM), the shell is an OPEN container div marked
// data-v3-devtools-shell inside the host — same tree shape, no isolation.
// Browsers always take the closed-shadow path.
//
// Mock-DOM discipline: appendChild-only, dynamic styles via
// setAttribute('style') (the dock's ONLY inline style is its width — all
// static styling lives in the one <style> below), optional-call guards on
// pointer capture / preventDefault. Width is tracked in a variable, never
// read back from the DOM.

import { createCtx, registerRefreshable } from './ctx.ts'
import type { PanelCtx } from './ctx.ts'
import { mountGraph } from './graph.ts'
import { mountInspector } from './inspector.ts'
import { mountPicker } from './picker.ts'
import { resolveNode } from '../index.ts'
import { runtime as defaultRuntime } from '../../api/index.ts'

const WIDTH_KEY = 'data-v3-devtools-dock-width'
const WIDTH_DEFAULT = 420
const WIDTH_MIN = 280
const WIDTH_MAX_FRAC = 0.8 // of viewport width

interface PanelHandle {
  open(target?: unknown): void
  close(): void
  shell: any
}

let current: PanelHandle | null = null

export function mountPanel(opts: { open?: boolean } = {}): PanelHandle {
  if (current !== null) {
    if (opts.open !== false) current.open()
    return current
  }
  const doc: any = document

  const el = (tag: string, cls: string, text?: string): any => {
    const e = doc.createElement(tag)
    if (cls !== '') e.setAttribute('class', cls)
    if (text !== undefined) e.textContent = text
    return e
  }

  // ── host + shell ────────────────────────────────────────────────────────────
  const host = el('div', '')
  host.setAttribute('data-v3-devtools', '')
  let shell: any
  if (typeof host.attachShadow === 'function') {
    shell = host.attachShadow({ mode: 'closed' })
  } else {
    shell = el('div', '')
    shell.setAttribute('data-v3-devtools-shell', '')
    host.appendChild(shell)
  }
  const style = doc.createElement('style')
  style.textContent = CSS_TEXT
  shell.appendChild(style)

  const dock = el('aside', 'dock')
  shell.appendChild(dock)

  // ── width + resize handle ───────────────────────────────────────────────────
  const maxWidth = (): number =>
    typeof window !== 'undefined' && typeof (window as any).innerWidth === 'number'
      ? Math.max(WIDTH_MIN, Math.floor((window as any).innerWidth * WIDTH_MAX_FRAC))
      : 1600
  const clampW = (w: number): number => Math.max(WIDTH_MIN, Math.min(maxWidth(), w))
  let width = WIDTH_DEFAULT
  try {
    const raw = parseInt(localStorage.getItem(WIDTH_KEY) ?? '', 10)
    if (Number.isFinite(raw)) width = raw
  } catch {} // storage denied (sandboxed iframe) → session-only width
  const applyWidth = (): void => {
    width = clampW(width)
    dock.setAttribute('style', `width:${width}px`)
  }
  applyWidth()

  const handle = el('div', 'dock-resize')
  handle.title = 'drag to resize'
  dock.appendChild(handle)
  // The dock is pinned to the right edge, so dragging LEFT (negative dx)
  // widens it. Width persists on release, not per-move.
  let drag: { x: number; w: number } | null = null
  handle.addEventListener('pointerdown', (e: any) => {
    drag = { x: e.clientX ?? 0, w: width }
    try {
      handle.setPointerCapture?.(e.pointerId)
    } catch {}
    e?.preventDefault?.()
  })
  handle.addEventListener('pointermove', (e: any) => {
    if (drag === null) return
    width = drag.w - ((e.clientX ?? 0) - drag.x)
    applyWidth()
  })
  const endDrag = (e: any): void => {
    if (drag === null) return
    drag = null
    try {
      handle.releasePointerCapture?.(e.pointerId)
    } catch {}
    try {
      localStorage.setItem(WIDTH_KEY, String(Math.round(width)))
    } catch {}
  }
  handle.addEventListener('pointerup', endDrag)
  handle.addEventListener('pointercancel', endDrag)

  // ── toolbar ─────────────────────────────────────────────────────────────────
  const header = el('div', 'dock-header')
  header.appendChild(el('span', 'brand', 'data devtools'))
  const tools = el('div', 'tools') // picker mounts its button(s) here
  const closeBtn = el('button', '', '✕')
  closeBtn.title = 'close panel'
  closeBtn.addEventListener('click', () => handleObj.close())
  header.appendChild(tools)
  header.appendChild(closeBtn)
  dock.appendChild(header)

  // ── content: graph over inspector (flex column; inspector slides in) ───────
  const body = el('div', 'dock-body')
  const graphHost = el('div', 'graph-host')
  const inspHost = el('div', 'insp-host')
  inspHost.setAttribute('style', 'display:none')
  body.appendChild(graphHost)
  body.appendChild(inspHost)
  dock.appendChild(body)

  const ctx: PanelCtx = createCtx(defaultRuntime(), dock, doc)

  // ── module lifecycle ────────────────────────────────────────────────────────
  let graphCtl: { refresh(): void; destroy(): void } | null = null
  let inspCtl: { refresh(): void; destroy(): void } | null = null
  let pickCtl: { destroy(): void } | null = null
  let unregs: (() => void)[] = []
  let attached = false

  const unSelect = ctx.onSelect((id: number | null) => {
    inspHost.setAttribute('style', id === null ? 'display:none' : '')
    if (id !== null) inspCtl?.refresh()
  })

  const mountParts = (): void => {
    if (graphCtl !== null) return
    graphCtl = mountGraph(ctx, graphHost)
    inspCtl = mountInspector(ctx, inspHost)
    pickCtl = mountPicker(ctx, tools)
    unregs.push(registerRefreshable(ctx, () => graphCtl!.refresh()))
    unregs.push(registerRefreshable(ctx, () => inspCtl!.refresh()))
  }

  const handleObj: PanelHandle = {
    open(target?: unknown): void {
      if (!attached) {
        doc.body.appendChild(host)
        attached = true
      }
      mountParts()
      if (target !== undefined && target !== null) ctx.select(resolveNode(target).id)
      ctx.refresh()
    },
    close(): void {
      graphCtl?.destroy()
      inspCtl?.destroy()
      pickCtl?.destroy()
      graphCtl = inspCtl = null
      pickCtl = null
      for (const u of unregs) u()
      unregs = []
      ctx.select(null)
      if (attached) {
        host.remove()
        attached = false
      }
    },
    shell,
  }
  void unSelect // lives as long as the singleton shell

  current = handleObj
  if (opts.open !== false) {
    handleObj.open()
    // One settle refresh: a page that imports devtools BEFORE building its
    // graph shows nodes without needing a first commit.
    setTimeout(() => {
      if (graphCtl !== null) ctx.refresh()
    }, 250)
  }
  return handleObj
}

// ── styles — one sheet inside the shadow; the v2 panel's dark/compact look,
// monospace throughout (the v3 cut). Accent #9be3a8; kind hues mirror v2's
// root/operator/connect trio as source/operator/scalar. ──────────────────────
const CSS_TEXT = `
:host { all: initial; }
.dock {
  position: fixed; top: 0; right: 0; bottom: 0; width: ${WIDTH_DEFAULT}px;
  background: #1a1a1a; color: #e6e6e6;
  border-left: 1px solid #2a2a2a;
  font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  display: flex; flex-direction: column;
  z-index: 2147483646;
  box-sizing: border-box;
}
.dock-resize {
  position: absolute; top: 0; bottom: 0; left: -3px; width: 7px;
  cursor: col-resize; z-index: 5; background: transparent;
  transition: background .12s;
}
.dock-resize:hover { background: rgba(155,227,168,.35); }
.dock-header {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px; border-bottom: 1px solid #2a2a2a;
  flex-shrink: 0;
}
.brand { color: #9be3a8; font-weight: 600; letter-spacing: .03em; margin-right: auto; }
.tools { display: flex; gap: 4px; }
.dock-header button {
  min-width: 26px; height: 24px; background: transparent; color: #888;
  border: 1px solid transparent; border-radius: 4px; cursor: pointer;
  font: inherit; padding: 0 5px;
}
.dock-header button:hover { color: #e6e6e6; background: #222; border-color: #2a2a2a; }
.dock-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.graph-host { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.insp-host {
  flex-shrink: 0; max-height: 46%; overflow: auto;
  background: #161616; border-top: 1px solid #2a2a2a;
  animation: v3slide .18s ease-out;
}
@keyframes v3slide { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }

/* graph toolbar */
.gtools {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 10px; background: #222; border-bottom: 1px solid #2a2a2a;
  flex-shrink: 0; font-size: 11px;
}
.gseg { display: inline-flex; border: 1px solid #2a2a2a; border-radius: 4px; overflow: hidden; }
.gseg button {
  background: transparent; color: #888; border: none;
  padding: 3px 12px; cursor: pointer; font: inherit; font-size: 11px;
}
.gseg button:hover { color: #e6e6e6; }
.gseg button.active { background: #1a1a1a; color: #9be3a8; }
.gfit {
  background: transparent; color: #888; border: none; border-radius: 3px;
  min-width: 24px; height: 22px; cursor: pointer; font: inherit;
  margin-left: auto;
}
.gfit:hover { background: #1a1a1a; color: #9be3a8; }
.gscale { color: #888; min-width: 38px; text-align: right; font-variant-numeric: tabular-nums; }

/* graph viewport — pan + zoom */
.gouter {
  position: relative; flex: 1; min-height: 0; overflow: hidden;
  cursor: grab; touch-action: none;
  background: radial-gradient(circle, #2a2a2a 1px, transparent 1px) 0 0 / 24px 24px, #141414;
}
.gcanvas { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
.gedges { position: absolute; left: 0; top: 0; pointer-events: none; }
.gedges line { stroke: #5e7593; stroke-width: 1.2; opacity: .8; }
.gempty { padding: 16px; color: #666; }
.gnode {
  position: absolute; box-sizing: border-box;
  border: 1px solid #2a2a2a; border-radius: 3px;
  background: #1f1f1f; padding: 2px 5px; cursor: pointer;
  display: flex; flex-direction: column; justify-content: center;
  font-size: 10px; line-height: 1.15;
}
.gnode:hover { filter: brightness(1.3); z-index: 1; }
.gnode-label { color: #e6e6e6; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
.gnode-sub { color: #888; font-size: 9px; white-space: nowrap; }
.gnode.kind-source { background: #2d3a2d; border-color: #3a4f3a; }
.gnode.kind-source .gnode-label { color: #9be3a8; }
.gnode.kind-operator { background: #2d3447; border-color: #3a4760; }
.gnode.kind-operator .gnode-label { color: #9bb3e3; }
.gnode.kind-scalar { background: #3a3727; border-color: #55502f; }
.gnode.kind-scalar .gnode-label { color: #e3c98e; }
.gnode.selected {
  box-shadow: 0 0 0 2px #9be3a8, 0 0 14px rgba(155,227,168,.55);
  border-color: #9be3a8; z-index: 3;
}

/* picker (◎) armed state */
.dock-header button[aria-pressed="true"] { color: #e3b341; border-color: #e3b341; background: #222; }

/* inspector — tabs */
.insp-tabs { display: flex; border-bottom: 1px solid #2a2a2a; }
.insp-tab {
  flex: 1; background: transparent; color: #888; border: none;
  padding: 7px 4px; cursor: pointer; font: inherit; font-size: 11px;
  border-bottom: 2px solid transparent; text-transform: capitalize;
}
.insp-tab:hover { color: #e6e6e6; }
.insp-tab.active { color: #9be3a8; border-bottom-color: #9be3a8; }
.insp-body { padding: 10px 12px; }
.insp-empty { margin: 0; font-style: italic; font-size: 11px; }
.muted { color: #888; }

/* inspector — card stack (Inspect tab) */
.insp-card {
  background: #131313; border: 1px solid #2a2a2a; border-radius: 6px;
  margin: 0 0 10px; overflow: hidden;
}
.card-title {
  padding: 6px 10px; background: #181818; border-bottom: 1px solid #2a2a2a;
  color: #888; font-size: 10px; text-transform: uppercase; letter-spacing: .08em;
}
.card-body { padding: 10px 12px; }
.insp-card-identity { border-color: #3a4f3a; }
.insp-card-identity .card-title { background: #1f2a20; color: #9be3a8; }
.card-headline { color: #9be3a8; font-size: 13px; font-weight: 600; word-break: break-all; }
.card-sub { color: #888; font-size: 11px; margin-top: 4px; }
pre.card-value {
  margin: 0; font: inherit; color: #e6e6e6;
  background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 4px;
  padding: 8px 10px; max-height: 200px; overflow: auto; white-space: pre; tab-size: 2;
}
.conn-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 4px 0; font-size: 11px; }
.conn-dir { color: #9bb3e3; width: 44px; flex-shrink: 0; }
.conn-detail { word-break: break-all; }
.conn-chip {
  background: #222; color: #ddd; border: 1px solid #2a2a2a;
  padding: 2px 8px; border-radius: 8px; cursor: pointer; font: inherit; font-size: 10px;
}
.conn-chip:hover { border-color: #9be3a8; color: #9be3a8; }

/* inspector — Events / Profile shared controls */
.ev-controls { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
.ev-controls button {
  background: #222; color: #ddd; border: 1px solid #2a2a2a;
  padding: 4px 10px; border-radius: 4px; cursor: pointer; font: inherit; font-size: 11px;
}
.ev-controls button:hover { border-color: #9be3a8; color: #9be3a8; }
.ev-badge { margin-left: auto; color: #888; font-size: 10px; font-variant-numeric: tabular-nums; white-space: nowrap; }

/* inspector — Events feed */
.ev-feed { list-style: none; padding: 0; margin: 0; }
.ev-row { border-bottom: 1px solid #1f1f1f; font-size: 11px; }
.ev-row-head { padding: 4px 0; cursor: pointer; color: #ddd; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ev-row-head:hover { color: #9be3a8; }
.ev-row-detail { padding: 2px 0 6px 12px; border-left: 2px solid #2a2a2a; margin-bottom: 4px; }
.ev-detail-line { color: #888; font-size: 10px; padding: 1px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ev-cascade { color: #9bb3e3; }
.ev-after { color: #e3c98e; }

/* inspector — Profile table */
.prof-status { font-size: 11px; font-variant-numeric: tabular-nums; }
.prof-wrap { overflow: auto; }
table.prof { width: 100%; border-collapse: collapse; font-size: 11px; }
table.prof th, table.prof td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #2a2a2a; }
table.prof th { color: #888; font-weight: 500; background: #181818; }
table.prof td:nth-child(n+2), table.prof th:nth-child(n+2) { text-align: right; font-variant-numeric: tabular-nums; }
.prof-sel td:first-child { color: #9be3a8; }
.prof-all td { color: #888; }
`
