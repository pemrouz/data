// render — the KEYED render layer (plan §3.4, M4).
//
// What this module is:
// - a minimal ORDERED-CHILDREN element AST (el/text/rtext/list) — the ordered
//   children list kills the v2 single-static-slot trap: `el('span', null,
//   '# ', text(cur))` renders "# general", in order, because a static string
//   is just another child, not a last-wins slot on the node.
// - render(hostEl, ast) → RenderHandle: one Scope per mount; disposing the
//   handle tears every subscription/listener/row-scope down synchronously.
// - THE CENTERPIECE: the keyed list sink. A 'list' child bound to a
//   collection view maintains Map<RowKey, Element>. Per CommitBatch:
//     add    → build the row element (its own child Scope) and place it —
//              at its order position for ordered views (via the batch's
//              orderInsert), appended for unordered views
//     remove → element.remove() + dispose that row's Scope (listeners and
//              rtext subscriptions detach deterministically)
//     update → re-run ONLY the row's bindings: rowFn(newRow) is re-evaluated
//              and the row element's TEXT bindings are patched in place
//              (element identity preserved; per-binding surgical prop updates
//              come with the full builder DSL in M4.5)
//     orderMove → a REAL insertBefore of the EXISTING element — identity
//              (focus/selection/transitions) survives reorders by
//              construction; the v2 kanban/chat data-id workaround dies here.
// - mirror(view): the $(view)-swap replacement — a re-pointable view slot.
//   MirrorNode is an identity operator whose data parent can be swapped;
//   set(other) routes through a hidden control SourceNode (the between-bounds
//   pattern), so the swap is a REAL commit: one consolidated batch diffing
//   old vs new snapshot (removes, adds, updates only for keys whose row
//   reference changed) — downstream views and the DOM catch up surgically,
//   overlapping keys keep their elements.
// - raf(target): the coalescing writer — write(v) schedules ONE commit of the
//   latest value per animation frame (setTimeout(cb, 16) outside browsers);
//   flush() commits immediately and cancels the pending frame.
//
// Emission legality: MirrorNode emits per SCHEDULE.md clause 8 (≤1 delta per
// key; add only for not-live keys; no phantom updates — Object.is on the row
// reference; order script = removes at descending pre indices, then moves
// against the survivor array, then inserts at ascending final indices). Its
// tests wrap it in conform().
//
// M4.5 slice added for the crossfilter-v3 example (the first M5 migration):
// - SVG NAMESPACE: `el('svg', …)` switches to createElementNS and children
//   inherit the namespace (browser semantics), so charts are first-class.
// - REACTIVE PROPS: `bind(view, fn?)` as a prop value creates a per-binding
//   surgical attribute subscription — recompute on the view's commit, string-
//   normalized equality cutoff, setAttribute/removeAttribute only on real
//   change. A bare handle/node prop value auto-binds (fn = identity).
// - `text(view, fn?)` — rtext gained the optional format fn.
// - STRUCTURAL ROW REBUILD: patchRow now reports whether the row's shape
//   matched; on mismatch (child count / tag / kind changed — e.g. a group
//   bucket gaining a member) the list sink rebuilds that row in place (same
//   list position, old row scope disposed, fresh element). Shape-stable rows
//   keep element identity exactly as before.
//
// M4.5b component layer (the last M4.5b slice — component scopes):
// - COMPONENTS: `component(fn, props)` — a 'component' VNode. The fn is
//   invoked ONCE, at MOUNT, under its own child Scope (owned by the enclosing
//   scope — a row's component dies with the row, a mount's with the mount).
//   onCleanup() / node creation / raf() inside the fn land on that scope; the
//   output is normalized with the full child vocabulary (arrays flatten, null
//   renders nothing, a handle is reactive text). The JSX layer routes
//   function tags here, so `<MyComp/>` defers to mount.
// - ERROR BOUNDARIES: `boundary(child, fallback)` — a slot owning its
//   subtree's scope. Mount-phase errors (a component fn / binding read
//   throwing during materialization) are caught synchronously; EFFECT-phase
//   errors (a binding or row fn throwing inside a subscription callback)
//   route to the nearest enclosing boundary via ctx.boundary, and the swap is
//   deferred ONE MICROTASK — disposing/connecting subscriptions mid-effect-
//   iteration would splice the very effects array the kernel is walking.
//   fallback(err, reset) materializes with ctx.boundary = the OUTER boundary,
//   so a broken fallback escalates outward instead of looping. With no
//   boundary the kernel contract is unchanged (effect errors collect into the
//   commit's AggregateError); bindings only take the guarded closure when a
//   boundary encloses them — zero cost otherwise.
// - Row fns are deliberately NOT a scope: the list sink re-runs them on row
//   updates (re-run-to-patch), so lifecycle registrations would accumulate.
//   They run under runInScope(null, …), so onCleanup() in a bare row fn
//   throws deterministically — wrap row content in a component instead.
//
// Deliberately still NOT here: SSR targets. The AST shape is extensible (each
// kind is a tagged record) so that lands as new kinds, not a rewrite.

             
                                                         
                             
import { DataNode, SourceNode, reheight } from '../kernel/node.js'
                                                           
                                                   
import { Scope, currentScope, runInScope } from '../kernel/scope.js'
// Benign module cycle: builders.ts imports el/text from here — both sides
// only use the other's exports at CALL time (function declarations, hoisted).
import { normChildren } from './builders.js'

// The versioned handle symbols (Symbol.for — shared with api/index.ts without
// importing it, so the render layer stays kernel-only and layering is clean).
const NODE = Symbol.for('data.v4.node')
const VALUE = Symbol.for('data.v4.value')

// ── the AST ──────────────────────────────────────────────────────────────────

                         
                     
                      
                                                          
                                     
 
                           
                       
                    
 
                            
                        
                                                                           
                                                                               
 
                           
                       
                                                               
                                                  
 
                                
                            
                                                                                     
                                                   
 
                               
                           
                                                                                 
                                                                 
 
                                                                                           

// A reactive PROP value: `el('path', { d: bind(view, fn) })` — subscribes to
// the view, recomputes fn(read()) per commit, writes the attribute only when
// the normalized string actually changed. A bare handle prop value auto-binds.
                           
                       
                        
                                           
 
export function bind(view         , fn                      )           {
  return { kind: 'bind', view, fn: fn ?? null }
}

                                                                        

export function el(
  tag        ,
  props                                 ,
  ...children         
)         {
  const kids          = []
  for (const c of children) {
    if (c == null || c === false || c === true) continue
    if (typeof c === 'string' || typeof c === 'number') kids.push({ kind: 'text', s: String(c) })
    else kids.push(c)
  }
  return { kind: 'el', tag, props: props ?? null, children: kids }
}

export function text(view         , fn                      )            {
  return { kind: 'rtext', view, fn: fn ?? null }
}

export function list(view         , rowFn                                  )           {
  return { kind: 'list', view, rowFn }
}

// A component: fn is deferred to MOUNT and invoked once under its own child
// Scope — the home for onCleanup(), transient views, and raf() writers whose
// lifetime is "this piece of UI". The JSX layer routes function tags here.
export function component(
  fn                         ,
  props                                 ,
)                {
  if (typeof fn !== 'function')
    throw new Error('data/render: component(fn, props?) expects a function — got ' + typeof fn)
  return { kind: 'component', fn, props: props ?? {} }
}

// An error boundary: child mounts under a scope this slot owns; an error from
// the subtree (mount-phase or effect-phase) tears it down and mounts
// fallback(err, reset) in its place. reset() re-mounts the try child.
export function boundary(
  child         ,
  fallback                                              ,
)               {
  if (typeof fallback !== 'function')
    throw new Error(
      'data/render: boundary(child, fallback) expects a fallback FUNCTION (err, reset) => vnode',
    )
  return { kind: 'boundary', child, fallback }
}

// ── view unwrapping ──────────────────────────────────────────────────────────

function nodeOf(view     )                {
  if (view instanceof DataNode) return view
  const n = view?.[NODE]
  if (n instanceof DataNode) return n
  throw new Error('data/render: expected a view — a DataNode or a $ handle')
}

// A read thunk for text bindings: scalar nodes read value(); handles read
// [value] (works for child-path handles too — the subscription is on the
// owning node, and the string-equality cut-off below suppresses no-op writes).
function readerOf(view     )                {
  if (view instanceof DataNode) {
    if (view.kind === 'scalar') return () => (view       ).value()
    throw new Error(
      'data/render: text() over a raw collection node — pass a scalar view (sum/avg/…/to) or a handle',
    )
  }
  if (view != null && view[NODE] instanceof DataNode) return () => view[VALUE]
  throw new Error('data/render: text() expects a scalar view or a $ handle')
}

function toText(v         )         {
  return v == null ? '' : String(v)
}

// ── reactive attribute binding ───────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg'

function isBindProp(x         )                {
  return x !== null && typeof x === 'object' && (x       ).kind === 'bind' && 'view' in (x       )
}

function isView(x         )          {
  if (x instanceof DataNode) return true
  return x !== null && typeof x === 'object' && (x       )[NODE] instanceof DataNode
}

// Attribute value normalization: null/undefined/false remove the attribute,
// true sets the empty attribute, everything else stringifies.
function normAttr(v         )                {
  return v == null || v === false ? null : v === true ? '' : String(v)
}

// LIVE form props: for these, the DOM attribute is only the DEFAULT — once a
// user has interacted, the browser reads the PROPERTY (a checkbox that was
// clicked ignores setAttribute('checked')). When the element carries the
// property, write it directly; the attribute path remains for everything
// else (and for the test mock, whose El has no form properties).
function setProp(dom     , name        , v         )          {
  if ((name === 'checked' || name === 'value') && name in dom) {
    if (name === 'checked') dom.checked = v === true || v === ''
    else dom.value = v == null ? '' : String(v)
    return true
  }
  return false
}

function applyAttr(dom     , name        , next               )       {
  if (setProp(dom, name, next)) return
  if (next === null) dom.removeAttribute(name)
  else dom.setAttribute(name, next)
}

function bindAttr(
  dom     ,
  name        ,
  view         ,
  fn                              ,
  scope       ,
  boundary                     ,
)       {
  const read = readerOf(view)
  const compute = () => normAttr(fn === null ? read() : fn(read()))
  let last = compute()
  if (last !== null || name === 'checked' || name === 'value') applyAttr(dom, name, last)
  const run = () => {
    const next = compute()
    if (next === last) return // normalized-string cutoff — no redundant DOM writes
    last = next
    applyAttr(dom, name, next)
  }
  const sub = nodeOf(view).connect({
    wantsOrder: false,
    origin: null,
    // Guarded closure ONLY under a boundary — the no-boundary path is the
    // plain closure, zero added cost.
    apply: boundary === null ? run : () => guarded(run, boundary),
  })
  scope.add(sub)
}

// Effect-phase error routing: run fn; a throw goes to the boundary instead of
// escaping into the kernel's commit-error collection.
function guarded(fn            , boundary              )       {
  try {
    fn()
  } catch (e) {
    boundary.handle(e)
  }
}

// ── materialization ──────────────────────────────────────────────────────────

               
                   
                       
                                                                          
                                                                            
 

                   
              
          
                            
 

function materialize(v       , ctx     )          {
  switch (v.kind) {
    case 'text':
      return { vnode: v, dom: ctx.doc.createTextNode(v.s), children: null }
    case 'rtext': {
      const n = nodeOf(v.view)
      const raw = readerOf(v.view)
      const fmt = v.fn
      const read = fmt === null ? raw : () => fmt(raw())
      const tn = ctx.doc.createTextNode(toText(read()))
      const run = () => {
        const s = toText(read())
        if (s !== tn.textContent) tn.textContent = s
      }
      const b = ctx.boundary
      const sub = n.connect({
        wantsOrder: false,
        origin: null,
        apply: b === null ? run : () => guarded(run, b),
      })
      ctx.scope.add(sub) // idempotent if the ambient scope already caught it
      return { vnode: v, dom: tn, children: null }
    }
    case 'el': {
      // Namespace: <svg> switches to the SVG namespace; children inherit.
      const ns = v.tag === 'svg' ? SVG_NS : ctx.ns
      const dom = ns === null ? ctx.doc.createElement(v.tag) : ctx.doc.createElementNS(ns, v.tag)
      const kidCtx =
        ns === ctx.ns ? ctx : { doc: ctx.doc, scope: ctx.scope, ns, boundary: ctx.boundary }
      if (v.props !== null) {
        for (const k of Object.keys(v.props)) {
          const pv = v.props[k]
          if (k.startsWith('on') && typeof pv === 'function') {
            const evt = k.slice(2).toLowerCase()
            dom.addEventListener(evt, pv)
            ctx.scope.onDispose(() => dom.removeEventListener(evt, pv))
          } else if (isView(pv)) {
            // checked BEFORE isBindProp: probing .kind on a handle would
            // route through its proxy (a scalar handle throws on child reads)
            bindAttr(dom, k, pv, null, ctx.scope, ctx.boundary)
          } else if (isBindProp(pv)) {
            bindAttr(dom, k, pv.view, pv.fn, ctx.scope, ctx.boundary)
          } else if (pv != null && pv !== false) {
            dom.setAttribute(k, pv === true ? '' : String(pv))
          }
        }
      }
      const kids            = []
      for (const c of v.children) kids.push(mountChild(dom, c, kidCtx))
      return { vnode: v, dom, children: kids }
    }
    case 'list':
    case 'component':
    case 'boundary':
      // handled by mountChild (the 'el' child loop and render() at the root)
      throw new Error('data/render: internal — ' + v.kind + ' must be mounted by its host')
  }
}

// Mount one child VNode into host. Lists, components, and boundaries own
// their placement (host-mounted); everything else materializes then appends.
function mountChild(host     , c       , ctx     )          {
  if (c.kind === 'list') {
    const binding = new ListBinding(host, c, ctx)
    ctx.scope.add(binding)
    return { vnode: c, dom: binding.anchor, children: null }
  }
  if (c.kind === 'component') return mountComponent(host, c, ctx)
  if (c.kind === 'boundary') {
    const slot = new BoundarySlot(host, c, ctx)
    ctx.scope.add(slot)
    return { vnode: c, dom: slot.anchor, children: null }
  }
  const m = materialize(c, ctx)
  host.appendChild(m.dom)
  return m
}

// Invoke the component fn ONCE under its own child Scope (owned by the outer
// scope, so it disposes with its surroundings — row removal, boundary swap,
// render-handle dispose). The output is normalized with the full child
// vocabulary and mounted in place; a multi-root return (an array) expands.
// Exception-safe: a throw (from the fn or a later sibling's mount) disposes
// the component scope and removes the roots already placed in the host —
// otherwise an enclosing boundary's swap would leave ghost DOM and live
// subscriptions it cannot reach.
function mountComponent(host     , c               , ctx     )          {
  const compScope = new Scope(ctx.scope)
  const kids            = []
  try {
    const out = runInScope(compScope, () => c.fn(c.props))
    const kidCtx      = { doc: ctx.doc, scope: compScope, ns: ctx.ns, boundary: ctx.boundary }
    for (const k of normChildren([out])) kids.push(mountChild(host, k, kidCtx))
  } catch (e) {
    ctx.scope.delete(compScope)
    compScope.dispose()
    const doms        = []
    for (const m of kids) collectDoms(m, doms)
    for (const d of doms) d.remove()
    throw e
  }
  return { vnode: c, dom: null, children: kids }
}

// Top-level DOM nodes of a mounted subtree (a component Mounted has dom null
// and expands through its children).
function collectDoms(m         , out       )       {
  if (m.dom !== null) {
    out.push(m.dom)
    return
  }
  if (m.children !== null) for (const k of m.children) collectDoms(k, out)
}

// Row-update patching: re-run the row's TEXT bindings and STATIC props
// against the fresh rowFn output — a rowFn computing `class` from row data
// ("todo completed") patches surgically on update. rtext, nested lists, and
// bind()/handle props are self-updating (their own subscriptions) and are
// left untouched; listeners are bound ONCE at build (so a handler must read
// current row state through the source — `items.get(key)[value]` — not its
// captured row snapshot). Returns whether the shapes matched; a structural
// mismatch (kind / tag / child count changed — a rowFn whose SHAPE depends
// on the row) reports false and the list sink REBUILDS that row in place.
function staticProp(x         )          {
  return typeof x !== 'function' && !isView(x) && !isBindProp(x)
}

function patchProps(
  dom     ,
  prev                                          ,
  next                                          ,
)       {
  if (prev === next) return
  if (next !== null) {
    for (const k of Object.keys(next)) {
      if (k.startsWith('on')) continue
      const nv = next[k]
      if (!staticProp(nv)) continue
      const pv = prev !== null && k in prev ? prev[k] : undefined
      if (pv !== undefined && !staticProp(pv)) continue // was reactive: self-updating, leave it
      const na = normAttr(nv)
      if (normAttr(pv) !== na) applyAttr(dom, k, na)
    }
  }
  if (prev !== null) {
    for (const k of Object.keys(prev)) {
      if (k.startsWith('on') || !staticProp(prev[k])) continue
      if (next === null || !(k in next)) applyAttr(dom, k, null) // prop dropped
    }
  }
}

function patchRow(m         , v       )          {
  if (m.vnode.kind !== v.kind) return false
  if (v.kind === 'text') {
    if ((m.vnode            ).s !== v.s) m.dom.textContent = v.s
    m.vnode = v
    return true
  }
  if (v.kind === 'el') {
    const prev = m.vnode          
    if (prev.tag !== v.tag) return false
    const next = v.children
    if (m.children === null || m.children.length !== next.length) return false
    patchProps(m.dom, prev.props, v.props)
    for (let i = 0; i < next.length; i++) {
      if (!patchRow(m.children[i], next[i])) return false
    }
    m.vnode = v
    return true
  }
  if (v.kind === 'component') {
    // Identical fn + STRUCTURALLY-equal props → the mounted instance stands
    // (its bindings self-update). Anything else is a structural mismatch: a
    // fresh invocation under a fresh scope (row rebuild) is the correct
    // lifecycle, not a patch. Structural (not reference) equality matters
    // because a rowFn re-mints its records every update — a component whose
    // INPUTS didn't change must not rebuild the row (`<Chip>static</Chip>`
    // survives; `<Chip>{row.t}</Chip>` rebuilds only when row.t moved). A
    // component whose props embed the row (fresh reference per update) still
    // rebuilds — the fn consumed that row. Hot rows that must patch
    // surgically stay on plain elements + bindings.
    const prev = m.vnode                 
    return prev.fn === v.fn && propsEq(prev.props, v.props)
  }
  if (v.kind === 'boundary') {
    // Same structural rule; the fallback compares by REFERENCE — hoist it
    // out of the rowFn (a fresh closure per update would rebuild the row and
    // silently reset a displayed fallback to the try child).
    const prev = m.vnode                
    return prev.fallback === v.fallback && vnodeEq(prev.child, v.child)
  }
  return true // rtext / list: self-updating
}

// Structural VNode-record equality for the component/boundary patch decision.
// Records compare by shape; functions and views/handles must be REFERENCE-
// equal (a fresh closure means fresh inputs). Handles are identity-only and
// probed via the NODE symbol FIRST — reading .kind on a handle proxy would
// route through its child-path dispatch.
function vnodeEq(a         , b         )          {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!vnodeEq(a[i], b[i])) return false
    return true
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (a instanceof DataNode || b instanceof DataNode) return false // identity checked above
  if ((a       )[NODE] instanceof DataNode || (b       )[NODE] instanceof DataNode) return false
  const ka = (a       ).kind
  if (ka !== (b       ).kind) return false
  switch (ka) {
    case 'text':
      return (a            ).s === (b            ).s
    case 'el': {
      const ea = a          
      const eb = b          
      return ea.tag === eb.tag && propsEq(ea.props, eb.props) && vnodeEq(ea.children, eb.children)
    }
    case 'rtext':
      return (a             ).view === (b             ).view && (a             ).fn === (b             ).fn
    case 'bind':
      return (a            ).view === (b            ).view && (a            ).fn === (b            ).fn
    case 'list':
      return (a            ).view === (b            ).view && (a            ).rowFn === (b            ).rowFn
    case 'component':
      return (a                 ).fn === (b                 ).fn && propsEq((a                 ).props, (b                 ).props)
    case 'boundary':
      return (a                ).fallback === (b                ).fallback && vnodeEq((a                ).child, (b                ).child)
  }
  return false // plain objects (e.g. a row passed as a prop): identity only
}

function propsEq(
  a                                          ,
  b                                          ,
)          {
  if (a === b) return true
  if (a === null || b === null) return false
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) {
    if (!(k in b)) return false
    if (!vnodeEq(a[k], b[k])) return false // covers children arrays + nested records
  }
  return true
}

// ── error boundary slot ──────────────────────────────────────────────────────
// Owns the current subtree's Scope + top-level DOM nodes; anchored so a swap
// lands at the boundary's position even with later siblings. handle()/reset()
// defer the swap one microtask (see the module header for why); the initial
// mount catches synchronously (its partials' subscriptions were created in
// this same tick — disposing them only trims effects-array tails, never an
// entry a mid-flight effect iteration has yet to reach).

// A host facade redirecting appendChild to insertBefore(anchor): swap-time
// content (and any descendant list/boundary anchors) lands BEFORE the
// boundary anchor rather than at the end of the host.
function hostBefore(host     , anchor     )      {
  return {
    appendChild: (n     ) => host.insertBefore(n, anchor),
    insertBefore: (n     , ref     ) => host.insertBefore(n, ref ?? anchor),
  }
}

class BoundarySlot {
                   
                  
                           
                     
                             
                                    
                              // the CURRENT subtree's scope (try or fallback)
                      // the current subtree's top-level DOM nodes
                          // a swap is queued — further errors no-op until it lands
                           

  constructor(host     , vnode              , ctx     ) {
    this.host = host
    this.doc = ctx.doc
    this.ns = ctx.ns
    this.vnode = vnode
    this.outer = ctx.boundary
    this.scope = null
    this.doms = []
    this.broken = false
    this.disposed = false
    this.anchor = ctx.doc.createTextNode('')
    host.appendChild(this.anchor)
    try {
      this.mountTry()
    } catch (e) {
      // Only reachable when the TRY child threw and the fallback ALSO failed
      // with no outer boundary — the slot is stillborn; it isn't registered
      // on any scope yet, so it must self-clean its anchor.
      this.disposed = true
      this.anchor.remove()
      throw e
    }
  }

  // Materialize vs before the anchor under a fresh subtree scope. Runs the
  // whole mount inside runInScope(scope): connect()'s ambient-scope
  // registration must land on THIS scope, not on whatever scope was ambient
  // at mount time — pre-fix, the enclosing mount scope also caught every
  // subtree subscription handle and retained the torn-down subtree until
  // unmount. On a mount-phase throw the partials (scope + already-placed
  // doms) are torn down and the error rethrows to the caller.
          mountInto(vs         , asBoundary                     )       {
    const scope = new Scope(null)
    const doms        = []
    const ctx      = { doc: this.doc, scope, ns: this.ns, boundary: asBoundary }
    const facade = hostBefore(this.host, this.anchor)
    try {
      runInScope(scope, () => {
        for (const v of vs) collectDoms(mountChild(facade, v, ctx), doms)
      })
    } catch (e) {
      scope.dispose()
      for (const d of doms) d.remove()
      throw e
    }
    this.scope = scope
    this.doms = doms
  }

          mountTry()       {
    try {
      this.mountInto(normChildren([this.vnode.child]), this)
    } catch (e) {
      this.scope = null
      this.doms = []
      this.showFallback(e)
    }
  }

  // The fallback mounts with ctx.boundary = the OUTER boundary: its own
  // errors escalate outward. A fallback that throws while MOUNTING also
  // escalates (or rethrows at the top — an unhandled broken fallback should
  // be loud, not blank).
          showFallback(err         )       {
    try {
      const out = (0, this.vnode.fallback)(err, () => this.reset())
      this.mountInto(normChildren([out]), this.outer)
    } catch (e) {
      this.scope = null
      this.doms = []
      if (this.outer !== null) this.outer.handle(e)
      else throw e
    }
  }

  // Effect-phase entry point (guarded closures + the list sink route here).
  handle(err         )       {
    if (this.broken || this.disposed) return
    this.broken = true
    this.queueSwap(() => this.showFallback(err))
  }

  // Re-mount the try child (the fallback's retry hook). Deferred like
  // handle() — reset may be invoked from inside an effect.
  reset()       {
    if (this.broken || this.disposed) return
    this.broken = true
    this.queueSwap(() => this.mountTry())
  }

          queueSwap(run            )       {
    queueMicrotask(() => {
      if (this.disposed) return
      try {
        this.teardown()
        run()
      } finally {
        // broken resets even when the swap body rethrows (a failing cleanup,
        // a top-level fallback error) — otherwise the slot bricked while
        // callers still held a live reset handle.
        this.broken = false
      }
    })
  }

  // DOM removal proceeds even when a cleanup throws (Scope.dispose completes
  // its walk and rethrows an AggregateError at the end).
          teardown()       {
    const scope = this.scope
    this.scope = null
    const doms = this.doms
    this.doms = []
    try {
      scope?.dispose()
    } finally {
      for (const d of doms) d.remove()
    }
  }

  dispose()       {
    if (this.disposed) return
    this.disposed = true
    try {
      this.teardown()
    } finally {
      this.anchor.remove()
    }
  }
}

// ── devtools registry (zero-cost when unobserved) ────────────────────────────
// The DOM ↔ data seam the devtools layer builds fromDOM()/highlight()/badges
// on: row ELEMENT → { view, key } (set once per row build; WeakMap, so rows
// die naturally), plus the live ListBinding set so a view's row elements are
// enumerable (WeakMaps aren't). Nothing here is read by the render path
// itself — one WeakMap.set per row creation and one Set add/delete per list
// bind/dispose is the entire cost.
export const domLinks                                                        = new WeakMap()
export const liveLists                                                               = new Set()

// ── the keyed list sink ──────────────────────────────────────────────────────

// A row ROOT must resolve to ONE element — the keyed sink's unit of placement
// and identity (rec.el is inserted/moved/removed as the row). A component
// root is invoked here (own scope, owned by the row's) and must yield exactly
// one root; a boundary root can't keep rec.el stable across swaps, so it must
// be wrapped in an element.
function materializeRowRoot(v       , ctx     )          {
  if (v.kind === 'boundary')
    throw new Error(
      'data/render: a row fn returned boundary() as the row ROOT — the keyed list sink ' +
        'places one stable element per row and a swap would replace it. ' +
        'Wrap it in an element: el("div", null, boundary(…))',
    )
  if (v.kind === 'list')
    throw new Error(
      'data/render: a row fn returned list()/<For> as the row ROOT — the keyed list sink ' +
        'places one stable element per row. Nest it inside an element: el("div", null, list(…))',
    )
  if (v.kind === 'component') {
    const compScope = new Scope(ctx.scope)
    const out = runInScope(compScope, () => v.fn(v.props))
    const kids = normChildren([out])
    if (kids.length !== 1)
      throw new Error(
        `data/render: a component used as a row ROOT must return exactly ONE root vnode — ` +
          `got ${kids.length}. The keyed list sink places one stable element per row.`,
      )
    const inner = materializeRowRoot(kids[0], {
      doc: ctx.doc,
      scope: compScope,
      ns: ctx.ns,
      boundary: ctx.boundary,
    })
    return { vnode: v, dom: inner.dom, children: [inner] }
  }
  return materialize(v, ctx)
}

                  
             
         
              
                  
 

class ListBinding {
                   
                  
                            // inherited element namespace for row builds
                      // marker before which every row element is placed
                             
                                                 
                                   
                                 // mirror of the view's order channel
                                 
                                        // nearest enclosing error boundary
                           

  constructor(host     , vnode          , ctx     ) {
    this.host = host
    this.doc = ctx.doc
    this.ns = ctx.ns
    this.rowFn = vnode.rowFn
    this.view = nodeOf(vnode.view)
    this.recs = new Map()
    this.boundary = ctx.boundary
    this.disposed = false
    this.anchor = ctx.doc.createTextNode('')
    host.appendChild(this.anchor)

    // snapshot-then-deltas (SCHEDULE clause 7): init from the settled state
    // (+ currentOrder when the view is ordered), then apply every commit.
    const snap = this.view.snapshot()
    const ord = this.view.currentOrder()
    this.order = ord === null ? null : ord.slice()
    const keys = ord ?? [...snap.keys()]
    try {
      for (const k of keys) {
        const rec = this.buildRow(k, snap.get(k))
        this.recs.set(k, rec)
        this.host.insertBefore(rec.el, this.anchor)
      }
    } catch (e) {
      // Exception-safe construction: a mount-phase rowFn throw must leave no
      // ghosts — already-built rows (elements IN the real host, bindings in
      // the views' effects arrays) and the anchor are torn down before the
      // error reaches an enclosing boundary's catch, which cannot see them
      // (the binding was never registered on ctx.scope).
      for (const rec of this.recs.values()) {
        rec.scope.dispose()
        rec.el.remove()
      }
      this.recs.clear()
      this.anchor.remove()
      throw e
    }
    const b = this.boundary
    this.sub = this.view.connect({
      wantsOrder: true,
      origin: null,
      apply:
        b === null
          ? (batch                  ) => this.apply(batch)
          : (batch                  ) => {
              try {
                this.apply(batch)
              } catch (e) {
                b.handle(e)
              }
            },
    })
    ctx.scope.add(this.sub)
    liveLists.add(this)
  }

  // Each row owns a child Scope: its rtext/bind subscriptions and listeners
  // are registered there and die with the row (removeEventListener, finally).
  // The row FN runs under runInScope(null, …) — it re-runs on updates, so it
  // is not a scope; onCleanup() inside one throws (wrap in a component).
          buildRow(key        , row     )         {
    return this.buildRowFrom(
      runInScope(null, () => this.rowFn(row, key)),
      key,
    )
  }

          buildRowFrom(vnode       , key        )         {
    const rowScope = new Scope(null)
    let mounted         
    try {
      mounted = runInScope(rowScope, () =>
        materializeRowRoot(vnode, {
          doc: this.doc,
          scope: rowScope,
          ns: this.ns,
          boundary: this.boundary,
        }),
      )
    } catch (e) {
      // rowScope is unowned (Scope(null)) — a mid-build throw would orphan
      // the bindings already connected (they'd fire into a detached subtree
      // forever, and a guarded one could re-tear a healthy fallback). The
      // row element itself is still detached, so scope disposal suffices.
      rowScope.dispose()
      throw e
    }
    domLinks.set(mounted.dom, { view: this.view, key })
    return { key, el: mounted.dom, scope: rowScope, mounted }
  }

  apply(batch                  )       {
    if (this.disposed) return
    const placeLater           = []
    const ordered = this.order !== null || batch.order !== undefined

    // Row phase — membership + content.
    for (const d of batch.rows                            ) {
      switch (d.op) {
        case 'add': {
          const rec = this.buildRow(d.key, d.row)
          this.recs.set(d.key, rec)
          if (ordered) placeLater.push(rec) // placed by its orderInsert below
          else this.host.insertBefore(rec.el, this.anchor)
          break
        }
        case 'remove': {
          const rec = this.recs.get(d.key)
          if (rec === undefined) break
          this.recs.delete(d.key)
          rec.scope.dispose()
          rec.el.remove()
          break
        }
        case 'update': {
          const rec = this.recs.get(d.key)
          if (rec === undefined) break
          // Same null-scope discipline as buildRow: without it, an update
          // arriving while some scope is ambient (a write issued from inside
          // a component fn) would let a row fn's onCleanup register silently
          // on that foreign scope instead of throwing.
          const next = runInScope(null, () => this.rowFn(d.row, d.key))
          if (!patchRow(rec.mounted, next)) {
            // Structural change — rebuild the row IN PLACE (same list
            // position); the old row's scope (listeners, bindings) disposes.
            const fresh = this.buildRowFrom(next, d.key)
            this.host.insertBefore(fresh.el, rec.el)
            rec.el.remove()
            rec.scope.dispose()
            this.recs.set(d.key, fresh)
          }
          break
        }
      }
    }

    // Order phase — applied AFTER row deltas, in array order (the contract).
    if (batch.order !== undefined) {
      if (this.order === null) this.order = [] // view reveals itself as ordered
      const ord = this.order
      for (const od of batch.order                         ) {
        switch (od.op) {
          case 'orderRemove': {
            const i = ord[od.index] === od.key ? od.index : ord.indexOf(od.key)
            if (i >= 0) ord.splice(i, 1)
            break
          }
          case 'orderInsert': {
            const i = od.index < 0 ? 0 : od.index > ord.length ? ord.length : od.index
            ord.splice(i, 0, od.key)
            const rec = this.recs.get(od.key)
            if (rec !== undefined) this.host.insertBefore(rec.el, this.nextPlaced(i + 1))
            break
          }
          case 'orderMove': {
            const from =
              od.from !== undefined && ord[od.from] === od.key ? od.from : ord.indexOf(od.key)
            if (from < 0) break
            ord.splice(from, 1)
            const i = od.index < 0 ? 0 : od.index > ord.length ? ord.length : od.index
            ord.splice(i, 0, od.key)
            const rec = this.recs.get(od.key)
            // THE move: one real insertBefore of the EXISTING element.
            if (rec !== undefined) this.host.insertBefore(rec.el, this.nextPlaced(i + 1))
            break
          }
        }
      }
    }

    // Safety net: any added row the order channel didn't place (e.g. a mirror
    // that re-pointed from an ordered to an unordered parent) appends.
    for (const rec of placeLater) {
      if (rec.el.parentNode == null) this.host.insertBefore(rec.el, this.anchor)
    }
  }

  // First already-placed element at or after order position i (added-but-not-
  // yet-placed keys are skipped); the anchor closes the list.
          nextPlaced(i        )      {
    const ord = this.order 
    for (; i < ord.length; i++) {
      const rec = this.recs.get(ord[i])
      if (rec !== undefined && rec.el.parentNode != null) return rec.el
    }
    return this.anchor
  }

  dispose()       {
    if (this.disposed) return
    this.disposed = true
    liveLists.delete(this)
    this.sub.dispose()
    for (const rec of this.recs.values()) {
      rec.scope.dispose()
      rec.el.remove()
    }
    this.recs.clear()
    this.anchor.remove()
  }
}

// ── render ───────────────────────────────────────────────────────────────────

                               
                       
                 
 

export function render(host     , ast                          , _runtime          )               {
  const doc = (globalThis       ).document
  if (doc == null)
    throw new Error('data/render: no global document — a DOM (or the test mock) must be installed')
  const mount = new Scope(null) // one Scope per mount — owns everything below
  const tops        = []
  const ctx      = { doc, scope: mount, ns: null, boundary: null }
  runInScope(mount, () => {
    const vs = Array.isArray(ast) ? (ast                    ) : [ast         ]
    try {
      for (const v of vs) collectDoms(mountChild(host, v, ctx), tops)
    } catch (e) {
      // Exception-safe mount: an unboundaried throw (a component fn, a
      // binding's initial read) must not leave live subscriptions or
      // partially-mounted DOM behind — the caller gets no handle to dispose.
      mount.dispose()
      for (const t of tops) t.remove()
      throw e
    }
  })
  return {
    scope: mount,
    dispose() {
      mount.dispose() // subscriptions, listeners, row scopes, list bindings
      // tops includes list/boundary anchors already removed by their owner's
      // dispose — .remove() on a detached node is a no-op.
      for (const t of tops) t.remove()
    },
  }
}

// ── mirror() — the re-pointable view slot (the v2 $(view)-swap, done right) ──

const MKEY = 'g'

export class MirrorNode    extends DataNode    {
                               // materialized identity copy of the current parent
                                
                                  // hidden repoint-generation input (between-bounds pattern)
                     

  constructor(runtime         , parent             , ctl                    ) {
    super(runtime, 'operator', 'mirror', [parent, ctl])
    this.ctl = ctl
    this.gen = 0
    this.view = parent.snapshot()
    const o = parent.currentOrder()
    this.order = o === null ? null : o.slice()
  }

  snapshot()                 {
    if (this.runtime.midBatch) return this.parents[0].snapshot()                  
    return new Map(this.view)
  }

  hasRow(key        )          {
    if (this.runtime.midBatch) return super.hasRow(key)
    return this.view.has(key)
  }

  rowAt(key        )                {
    if (this.runtime.midBatch) return super.rowAt(key)
    return this.view.get(key)
  }

  each(fn                               )       {
    if (this.runtime.midBatch) return super.each(fn)
    for (const [k, v] of this.view) fn(k, v)
  }

  rowCount()         {
    if (this.runtime.midBatch) return super.rowCount()
    return this.view.size
  }

  currentOrder()                           {
    if (this.runtime.midBatch) return this.parents[0].currentOrder()
    return this.order
  }

  current()              {
    return this.parents[0]               
  }

  // Re-point at another view. The swap re-parents this node (children/height
  // bookkeeping) and then writes the hidden control source, so the diff is
  // emitted as a REAL commit: it consolidates with data writes in the same
  // batch(), gets a seq, and inherits re-entrancy handling for free.
  set(next     )       {
    const nextNode = nodeOf(next)               
    const cur = this.parents[0]
    if (nextNode === cur) return
    if (nextNode.kind === 'scalar')
      throw new Error('data: mirror.set() expects a collection view, got a scalar node')
    // Cycle check: walking the new parent's ancestry must never reach this
    // mirror (a mirror pointed at a view derived from itself would loop).
    const stack                  = [nextNode]
    while (stack.length > 0) {
      const n = stack.pop() 
      if (n === this) throw new Error('data: mirror.set() would create a cyclic view')
      for (const p of n.parents) stack.push(p)
    }
    const i = cur.children.indexOf(this)
    if (i >= 0) cur.children.splice(i, 1)
    ;(this.parents                   )[0] = nextNode
    nextNode.children.push(this)
    // Keep topological legality for future commits: height only ever grows,
    // and the growth PROPAGATES to descendants (reheight). Pre-fix, nodes
    // created downstream BEFORE a repoint kept their construction-time height
    // — a descendant could then settle BEFORE this mirror in a flush and read
    // its stale materialized view (the library-v3 PROBE A staleness; STATUS
    // gap 5, now closed).
    reheight(this)
    this.ctl.write(MKEY, [], ++this.gen)
  }

  dispose()       {
    super.dispose()
    this.ctl.dispose()
  }

  settle(seq        , origin             )                        {
    let dataBatch                        = null
    let repoint = false
    if (this.in0 !== null) {
      if (this.inFrom0 === this.ctl) repoint = true
      else if (this.inFrom0 === this.parents[0]) dataBatch = this.in0                  
    }
    if (this.inMore !== null) {
      for (const m of this.inMore) {
        if (m.from === this.ctl) repoint = true
        else if (m.from === this.parents[0]) dataBatch = m.batch                  
      }
    }
    if (repoint) return this.settleRepoint(seq, origin)
    if (dataBatch === null) return null

    // Identity forwarding: maintain the local copy, re-emit the parent's rows
    // and order deltas under this node's identity.
    for (const d of dataBatch.rows) {
      if (d.op === 'remove') this.view.delete(d.key)
      else this.view.set(d.key, d.row)
    }
    if (dataBatch.order !== undefined) {
      if (this.order === null) this.order = []
      applyOrderDeltas(this.order, dataBatch.order)
    }
    if (dataBatch.rows.length === 0 && dataBatch.order === undefined) return null
    return { seq, origin, rows: dataBatch.rows, order: dataBatch.order, scalar: undefined }
  }

  // The consolidated swap diff: old snapshot vs new snapshot — removes for
  // keys only in old, adds for keys only in new, updates ONLY for keys in
  // both whose row REFERENCE changed (Object.is — overlapping keys sharing a
  // row reference emit nothing, so downstream DOM keeps their elements).
  // A data batch from the new parent in the same commit is subsumed: the
  // parent has already settled (lower height), so its snapshot is current.
          settleRepoint(seq        , origin             )                        {
    const next = this.parents[0].snapshot()                  
    const rows                = []
    for (const [k, v] of this.view) {
      if (!next.has(k)) rows.push({ op: 'remove', key: k, prev: v })
    }
    for (const [k, v] of next) {
      if (this.view.has(k)) {
        const old = this.view.get(k)     
        if (!Object.is(old, v)) rows.push({ op: 'update', key: k, row: v, prev: old, path: [] })
      } else {
        rows.push({ op: 'add', key: k, row: v })
      }
    }
    const postO = this.parents[0].currentOrder()
    const postOrder = postO === null ? null : postO.slice()
    let order                          
    if (this.order !== null || postOrder !== null) {
      order = orderScript(this.order ?? [], postOrder ?? [])
      if (order.length === 0) order = undefined
    }
    this.view = next
    this.order = postOrder
    if (rows.length === 0 && order === undefined) return null
    return { seq, origin, rows, order, scalar: undefined }
  }
}

function applyOrderDeltas(ord          , deltas                       )       {
  for (const d of deltas) {
    if (d.op === 'orderInsert') ord.splice(d.index, 0, d.key)
    else if (d.op === 'orderRemove') ord.splice(d.index, 1)
    else {
      ord.splice(d.from          , 1)
      ord.splice(d.index, 0, d.key)
    }
  }
}

// Legal order script pre → post (SCHEDULE clause 8): removes at DESCENDING
// pre indices (each valid at application time), orderMove per surviving key
// against the survivor array (the OrderedView reconcile algorithm), then
// inserts at ASCENDING final indices.
function orderScript(pre                   , post                   )               {
  const preSet = new Set(pre)
  const postSet = new Set(post)
  const out               = []
  for (let i = pre.length - 1; i >= 0; i--) {
    if (!postSet.has(pre[i])) out.push({ op: 'orderRemove', key: pre[i], index: i })
  }
  const cur           = []
  for (const k of pre) if (postSet.has(k)) cur.push(k)
  const surv           = []
  for (const k of post) if (preSet.has(k)) surv.push(k)
  for (let i = 0; i < surv.length; i++) {
    if (cur[i] === surv[i]) continue
    const j = cur.indexOf(surv[i], i)
    out.push({ op: 'orderMove', key: surv[i], index: i, from: j })
    cur.splice(j, 1)
    cur.splice(i, 0, surv[i])
  }
  for (let i = 0; i < post.length; i++) {
    if (!preSet.has(post[i])) out.push({ op: 'orderInsert', key: post[i], index: i })
  }
  return out
}

export function mirror   (initial     )                {
  const parent = nodeOf(initial)               
  if (parent.kind === 'scalar')
    throw new Error('data: mirror() expects a collection view, got a scalar node')
  const ctl = new SourceNode        (parent.runtime, { [MKEY]: 0 }, 'mirror:ctl')
  return new MirrorNode   (parent.runtime, parent, ctl)
}

// ── raf() — the coalescing writer ────────────────────────────────────────────

                                         
              
               
                
 

// target: a commit function `(v) => …` or anything with `.update(v)` (a $
// child handle). write(v) schedules ONE commit of the LATEST value per
// animation frame; flush() commits immediately (pointerup wants the final
// position without an extra frame's latency); cancel() drops the pending
// value. Outside a browser the frame is setTimeout(cb, 16).
export function raf   (target                                           )               {
  const commit                 =
    typeof target === 'function' ? target : (v   ) => target.update(v)
  let pending = false
  let latest   
  let handle      = null
  const g      = globalThis
  const hasRaf = typeof g.requestAnimationFrame === 'function'
  const fire = () => {
    pending = false
    handle = null
    commit(latest)
  }
  const write = ((v   ) => {
    latest = v
    if (pending) return
    pending = true
    handle = hasRaf ? g.requestAnimationFrame(fire) : setTimeout(fire, 16)
  })                
  write.cancel = () => {
    if (!pending) return
    pending = false
    if (hasRaf) g.cancelAnimationFrame(handle)
    else clearTimeout(handle)
    handle = null
  }
  write.flush = () => {
    if (!pending) return
    write.cancel()
    commit(latest)
  }
  currentScope()?.onDispose(() => write.cancel())
  return write
}
