// v3/devtools/panel/ctx.ts — the shared panel context. One PanelCtx per
// mounted panel: the shadow-root container + page document + the Runtime the
// graph reads from, a single selection channel (node id or null — every panel
// module renders FROM this, none keeps its own selection copy), and refresh()
// as the one "re-read live state" verb. Selection is by GRAPH NODE ID, not a
// live node reference — ids are what graph()/inspect() speak, and a disposed
// node's id simply stops resolving (no WeakRef bookkeeping here).
//
// refresh() fans out to refreshables registered by the shell wiring
// (panel/index.ts registers each mounted module's refresh). The registry is a
// module-private WeakMap keyed by ctx so the PanelCtx surface stays exactly
// the pinned interface — registerRefreshable is the one extra export.

import type { Runtime } from '../../api/index.ts'

export interface PanelCtx {
  root: any // panel container element INSIDE the shadow root
  doc: any // the page document
  runtime: Runtime
  select(id: number | null): void // select a graph node by id (null clears)
  selected(): number | null
  onSelect(cb: (id: number | null) => void): () => void // returns unsubscribe
  refresh(): void // re-render graph + inspector from live state
}

const refreshables = new WeakMap<PanelCtx, Set<() => void>>()

export function createCtx(runtime: Runtime, root: any, doc: any): PanelCtx {
  let sel: number | null = null
  const listeners = new Set<(id: number | null) => void>()
  const fns = new Set<() => void>()
  const ctx: PanelCtx = {
    root,
    doc,
    runtime,
    select(id: number | null): void {
      if (id === sel) return
      sel = id
      // Snapshot: a listener may unsubscribe (or select again) mid-dispatch.
      for (const cb of [...listeners]) cb(id)
    },
    selected(): number | null {
      return sel
    },
    onSelect(cb: (id: number | null) => void): () => void {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    refresh(): void {
      for (const fn of [...fns]) fn()
    },
  }
  refreshables.set(ctx, fns)
  return ctx
}

// Shell wiring only (panel/index.ts): hook a module's refresh into
// ctx.refresh(). Returns the unregister.
export function registerRefreshable(ctx: PanelCtx, fn: () => void): () => void {
  const fns = refreshables.get(ctx)
  if (fns === undefined) throw new Error('data devtools: registerRefreshable requires a ctx from createCtx')
  fns.add(fn)
  return () => {
    fns.delete(fn)
  }
}
