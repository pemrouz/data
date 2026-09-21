// devtools/panel/ctx.ts — the shared panel context. One PanelCtx per
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

                                                 

                           
                                                             
                               
                  
                                                                            
                           
                                                                              
                                                                
 

const refreshables = new WeakMap                           ()

export function createCtx(runtime         , root     , doc     )           {
  let sel                = null
  const listeners = new Set                             ()
  const fns = new Set            ()
  const ctx           = {
    root,
    doc,
    runtime,
    select(id               )       {
      if (id === sel) return
      sel = id
      // Snapshot: a listener may unsubscribe (or select again) mid-dispatch.
      for (const cb of [...listeners]) cb(id)
    },
    selected()                {
      return sel
    },
    onSelect(cb                             )             {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    refresh()       {
      for (const fn of [...fns]) fn()
    },
  }
  refreshables.set(ctx, fns)
  return ctx
}

// Shell wiring only (panel/index.ts): hook a module's refresh into
// ctx.refresh(). Returns the unregister.
export function registerRefreshable(ctx          , fn            )             {
  const fns = refreshables.get(ctx)
  if (fns === undefined) throw new Error('data devtools: registerRefreshable requires a ctx from createCtx')
  fns.add(fn)
  return () => {
    fns.delete(fn)
  }
}
