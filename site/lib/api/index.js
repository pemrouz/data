// api — the public surface: $(value) returns a NON-CALLABLE, NON-THENABLE
// handle. Property sugar reads children for every name outside the versioned
// RESERVED set; get(key) is the total, collision-free child read; writes are
// METHODS ONLY (update/set/insert/remove/patch — bare assignment throws with
// guidance); operator methods are generated from the registry (one source of
// truth — drift is impossible); [value] reads the dense plain snapshot.
//
// Import order note: importing this module installs the operator modules
// (static imports, no side-effect registration protocol — tree-shakers see
// real imports).

import '../ops/rowops.js'
import '../ops/aggregate.js'
import '../ops/between.js'
import '../ops/setops.js'
import '../ops/bucket.js'
import '../ops/ordered.js'
import '../ops/misc.js'
import '../ops/quantile.js'

import { registry } from '../ops/registry.js'
import { Runtime } from '../kernel/runtime.js'
import { DataNode, SourceNode, attachSettled, leafAt } from '../kernel/node.js'
                                                           
import { RESERVED,                     } from '../contract/index.js'
                                                        
import { V2RecordSink, materialize,                 } from '../compat/v2-records.js'
import { currentScope } from '../kernel/scope.js'
import { installReactive } from '../ops/reactive.js'
import { mirror as makeMirror, MirrorNode, raf as rafWriter } from '../render/index.js'
import { ingest as seamIngest } from '../seam/index.js'

installReactive() // reactive value-slot args on gt/lt/gte/lte/za/az/top/limit/sum/avg

export { render, el, text, list, bind, component, boundary } from '../render/index.js'
export { HTML, SVG, normChildren } from '../render/builders.js'
export { h, Fragment, For, ErrorBoundary } from '../jsx/index.js'
// The component-lifecycle hook: registers a cleanup on the AMBIENT scope
// (a component invocation, a render mount) — see kernel/scope.ts.
export { onCleanup } from '../kernel/scope.js'
// The automatic-runtime verbs live on the MAIN entry too: dist/v3/jsx-runtime.js
// is a thin re-export of this bundle (see tsup.config.ts), so these names must
// exist here for that entry to forward — and classic/automatic interop shares
// one module instance either way.
export { jsx, jsxs, jsxDEV } from '../jsx/runtime.js'
export { ingest, fromAsync, exportContract, InMemoryBacking, lane, HOT, wireSink, mount } from '../seam/index.js'
// Devtools-support re-exports: dist/v3/devtools.js is emitted with every
// cross-boundary import rewritten to './index.js' (the jsx-runtime
// single-module-instance discipline — a duplicate kernel would break
// instanceof across bundles), so everything the devtools layer touches BY
// VALUE must be reachable from this entry. Not part of the consumer surface.
export { DataNode } from '../kernel/node.js'
export { Runtime } from '../kernel/runtime.js'
export { materialize } from '../compat/v2-records.js'
export { domLinks, liveLists } from '../render/index.js'

export const value = Symbol.for('data.v4.value')
export const node = Symbol.for('data.v4.node')

const defaultRuntime = new Runtime()
export function runtime()          {
  return defaultRuntime
}

export function batch   (fn         )    {
  return defaultRuntime.batch(fn)
}

// ── handle internals ─────────────────────────────────────────────────────────

                       
                     
                                                                          
                                                                 
                                
            
                                                                               
                                                                         
                                                                             
                                                                           
                                                
                                                                                      
                                                                                    
                                                                                  
 

const HANDLE = Symbol('data.v4.handle')

function reserved(name        )          {
  return RESERVED.has(name)
}

function readAt(state             )          {
  if (state.path.length === 0) {
    const n = state.node
    if (n.kind === 'scalar') return (n       ).value()
    return materialize(n.snapshot(), n.currentOrder())
  }
  const src = state.source 
  const key = state.path[0]          
  const row = src.get(key)
  return state.path.length === 1 ? row : leafAt(row, state.path.slice(1))
}

function childState(parent             , name        )              {
  if (parent.node.kind === 'scalar')
    throw new Error(`data: scalar views have no children (reading .${name})`)
  if (parent.source === null && parent.path.length === 0 && parent.node instanceof SourceNode) {
    // root source handle
    return { node: parent.node, source: parent.node, path: [name], children: null, dedup: null, methods: null }
  }
  if (parent.source !== null) {
    return { node: parent.node, source: parent.source, path: [...parent.path, name], children: null, dedup: null, methods: null }
  }
  // child of an operator view: readable snapshot projection, writes throw.
  // The path EXTENDS the parent's — a nested read (counts.get(tn).get('value'),
  // the length(fn)-bucket idiom) used to drop the parent segment and silently
  // read undefined; childRead already walks deep paths via leafAt.
  return {
    node: parent.node,
    source: null,
    path: [...parent.path, name],
    children: null,
    dedup: null,
    methods: null,
  }
}

function childRead(state             )          {
  if (state.source !== null) return readAt(state)
  // operator-view child: read through the materialized snapshot
  const snap = state.node.snapshot()
  const key = state.path[0]          
  const row = snap.has(key) ? snap.get(key) : snap.get(String(key)) ?? snap.get(Number(key))
  return state.path.length === 1 ? row : leafAt(row, state.path.slice(1))
}

// key coercion: array-born sources mint integer keys; property sugar always
// arrives as strings. A source with an order channel resolves numeric-looking
// names positionally? NO — positional addressing is a lens concern; the sugar
// addresses KEYS. For array-born sources a numeric-looking name addresses the
// minted integer key.
function coerceKey(state             , name        )         {
  const src = state.source
  if (src !== null && state.path.length === 0 && src.currentOrder() !== null && /^\d+$/.test(name))
    return Number(name)
  return name
}

const EMPTY_PATH       = Object.freeze([])                   

// W9: once-per-object deep freeze (cycle-safe; WeakSet cache added BEFORE
// recursion). Rows are immutable post-write by the path-copy law, so a
// frozen row stays valid forever.
const frozenSeen = new WeakSet        ()
function deepFreeze   (v   )    {
  if (v === null || typeof v !== 'object') return v
  if (frozenSeen.has(v          )) return v
  frozenSeen.add(v          )
  for (const k of Object.keys(v          )) deepFreeze((v       )[k])
  return Object.freeze(v)
}

// W14: the subtree-scoped record subscription. Subscribes the ROOT source
// and projects only the deltas touching state.path, re-keyed RELATIVE to the
// subtree: an edit at/below it emits its relative path; a write ABOVE it
// (ancestor replace, whole-row update, row add) diffs the subtree leaf and
// emits a root-relative update — or a remove when the leaf vanished (at the
// leaf layer absence ≡ undefined, clause 10c). Row-level removes emit
// {type:'remove', key:[]}. opts: origin (kernel suppression), clone
// (default v2-parity true), initial (default true: one opening
// {key:[], value: current} record).
function connectPath(
  state             ,
  out                             ,
  opts            ,
)                     {
  const src = state.source 
  const key = state.path[0]          
  const rest = state.path.slice(1)
  const clone = opts.clone === false ?    (v   ) => v :    (v   ) => (v === undefined ? v : (structuredClone(v)     ))
  // attachSettled: a mid-batch attach defers initial-record + connect to the
  // batch's commit (clause 7 — no half-applied snapshot, no redelivery).
  return attachSettled(src.runtime, () => {
  if (opts.initial !== false) out({ type: 'update', key: [], value: clone(readAt(state)) })
  return src.connect({
    wantsOrder: false,
    origin: opts.origin ?? null,
    apply(batch) {
      for (const d of batch.rows) {
        if (d.key !== key) continue
        if (d.op === 'remove') {
          const prevLeaf = leafAt(d.prev, rest)
          if (rest.length === 0 || prevLeaf !== undefined)
            out({ type: 'remove', key: [], value: clone(prevLeaf) })
          continue
        }
        if (d.op === 'add') {
          const leaf = leafAt(d.row, rest)
          out({ type: 'update', key: [], value: clone(leaf) })
          continue
        }
        // update: relate d.path to our subtree path (rest)
        const p = d.path
        let i = 0
        while (i < p.length && i < rest.length && String(p[i]) === String(rest[i])) i++
        if (i === rest.length) {
          // edit AT or BELOW the subtree — relative key path
          const rel = p.slice(rest.length).map(String)
          if (d.deleted === true) out({ type: 'remove', key: rel, value: clone(leafAt(d.prev, p)) })
          else out({ type: 'update', key: rel, value: clone(leafAt(d.row, p)) })
        } else if (i === p.length) {
          // write ABOVE the subtree (incl. whole-row path []) — diff our leaf
          const oldLeaf = leafAt(d.prev, rest)
          const newLeaf = leafAt(d.row, rest)
          if (Object.is(oldLeaf, newLeaf)) continue
          if (newLeaf === undefined) out({ type: 'remove', key: [], value: clone(oldLeaf) })
          else out({ type: 'update', key: [], value: clone(newLeaf) })
        } // else: disjoint sibling path — not ours
      }
    },
  })
  })
}

function writeTarget(state             )                                                   {
  if (state.source === null || state.path.length === 0)
    throw new Error(
      'data: this view is a derived projection — write through its source (operator views are read-only)',
    )
  return {
    src: state.source,
    key: state.path[0]          ,
    sub: state.path.length === 1 ? EMPTY_PATH : state.path.slice(1),
  }
}

// ── the built-in method surface (everything non-operator in RESERVED) ────────
//
// Methods are minted ONE AT A TIME on first access (the get trap caches them
// per state, so h.set === h.set and extraction keeps working) instead of as an
// eager 14-closure suite per handle — a leaf handle used once for
// get(k).remove() allocates exactly one closure.

const BUILTIN = new Set([
  'get', 'snapshot', 'update', 'set', 'insert', 'remove', 'patch', 'connect',
  'dispose', 'mirror', 'raf', 'first', 'last', 'ingest', 'sink', 'promote', 'each', 'rowCount',
])

function doUpdate(state             , v         )       {
  if (state.path.length === 0 && state.node instanceof SourceNode)
    throw new Error('data: whole-source update — write [value] semantics not yet supported; use per-key writes or batch()')
  const { src, key, sub } = writeTarget(state)
  src.write(key, sub, v)
}

function makeMethod(state             , name        )                          {
  switch (name) {
    case 'get':
      return (k                 ) => childHandle(state, String(k))
    case 'snapshot':
      // W9: snapshot({freeze: true}) hands out a SAFE value — the container
      // is fresh per call (as always) and every row is DEEP-FROZEN, so "give
      // the caller a value" stops costing a structuredClone of the resource.
      // Safe by the path-copy law: the kernel never mutates a row in place
      // (writes mint fresh objects along the written path and only READ
      // off-path subtrees), so freezing a store-held row can never break a
      // later write. Freeze is once-per-row (WeakSet-cached) — rows are
      // immutable post-write, so the cache never staleness-lies. Honest
      // consequence: those row OBJECTS stay frozen for every later reader
      // (they were never legally mutable — the freeze turns silent
      // corruption into a loud strict-mode throw).
      return (opts                       ) => {
        const v = readAt(state)
        return opts?.freeze === true ? deepFreeze(v) : v
      }
    case 'update':
      return (v         ) => doUpdate(state, v)
    case 'set':
      return (k         , v          ) => {
        // mirror repoint: mirrorHandle.set(otherViewHandle) — single object arg
        if (state.node instanceof MirrorNode && state.path.length === 0 && v === undefined && k !== null && typeof k === 'object') {
          state.node.set((k       )[node] ?? k)
          return
        }
        if (state.source !== null && state.path.length === 0) {
          state.source.write(coerceKey(state, String(k)), [], v)
          return
        }
        const { src, key, sub } = writeTarget(state)
        src.write(key, [...sub, String(k)], v)
      }
    case 'insert':
      return (v         , at         ) => {
        if (!(state.node instanceof SourceNode) || state.path.length > 0)
          throw new Error('data: insert() applies to a source root')
        return state.node.insert(v, at)
      }
    case 'remove':
      return () => {
        // Row detach at depth 1; nested FIELD deletion deeper (W3a) — the
        // property is removed from the row (enumeration changes; an absent
        // ancestor or un-owned leaf is an idempotent no-op, clause 10).
        const { src, key, sub } = writeTarget(state)
        src.remove(key, sub.length > 0 ? sub : undefined)
      }
    case 'patch':
      return (pairs                                                  ) => {
        if (!(state.node instanceof SourceNode) || state.path.length > 0)
          throw new Error('data: patch() applies to a source root')
        // Tuple-shape fail-fast BEFORE any write. v2's flat form
        // patch(['k1', v1, 'k2', v2]) is worse than a clean throw here: strings
        // are iterable, so destructuring a string element commits a GARBAGE row
        // char-wise ({ s:'t', o:'p' }) — silently for 2-char-key shapes.
        for (const p of pairs)
          if (!Array.isArray(p) || p.length !== 2)
            throw new Error(
              "data: patch() takes [key, row] TUPLE pairs — patch([[k1, v1], [k2, v2]]); v2's flat [k1, v1, k2, v2] array form is gone",
            )
        const src = state.node                   
        src.runtime.batch(() => {
          for (const [k, v] of pairs) src.write(coerceKey(state, String(k)), [], v)
        })
      }
    case 'connect':
      return (a         , b          , c          )                     => {
        const n = state.node
        if (state.path.length > 0) {
          // W14: PER-PATH connect — a subtree-scoped record subscription on a
          // SOURCE child (depth 1 = partition-scoped: fero's per-client
          // read() projections and spoke mirrors; deeper = the deep-scalar
          // emission mode). Records are RELATIVE to the subtree root.
          if (state.source === null)
            throw new Error('data: connect() on an operator-view child is not supported — connect the view and filter records')
          if (Array.isArray(a) && (b === undefined || (typeof b === 'object' && b !== null)))
            return connectPath(state, (r) => (a                    ).push(r), (b              ) ?? {})
          if (typeof a === 'object' && a !== null && typeof b === 'function')
            return connectPath(state, b                               , (c              ) ?? {})
          if (typeof a === 'object' && a !== null && typeof b === 'string') {
            const obj = a                           
            obj[b] = readAt(state)
            return connectPath(state, () => { obj[b] = readAt(state) }, { clone: false, initial: false })
          }
          throw new Error('data: connect(fn) is not a valid sink — use connect(anchor, fn), connect([]), or connect(obj, prop)')
        }
        // W2: the record forms take trailing options {origin, clone, initial} —
        // origin-token echo suppression and the clone-free/by-ref mode on the
        // PUBLIC surface (no more Symbol.for node reach-through for fero).
        // attachSettled on every root form: the sink constructor / mirror
        // seed reads the snapshot, so a mid-batch attach defers the whole
        // thing to the batch's commit (clause 7 — no overlap, no gap).
        if (Array.isArray(a) && (b === undefined || (typeof b === 'object' && b !== null))) {
          return attachSettled(n.runtime, () =>
            n.connect(new V2RecordSink(n, (r                ) => (a                    ).push(r), (b              ) ?? {})),
          )
        }
        if (typeof a === 'object' && a !== null && typeof b === 'function') {
          return attachSettled(n.runtime, () =>
            n.connect(new V2RecordSink(n, b                               , (c              ) ?? {})),
          )
        }
        if (typeof a === 'object' && a !== null && typeof b === 'string') {
          const obj = a                           
          return attachSettled(n.runtime, () => {
            obj[b] = readAt(state)
            return n.connect({
              wantsOrder: false,
              origin: null,
              apply: () => {
                obj[b] = readAt(state)
              },
            })
          })
        }
        throw new Error(
          'data: connect(fn) is not a valid sink — use connect(anchor, fn) for records, connect([]) for an array, or connect(obj, prop) to mirror',
        )
      }
    case 'dispose':
      return () => state.node.dispose()
    case 'mirror':
      return () => {
        if (state.path.length > 0) throw new Error('data: mirror() applies to a view, not a child path')
        return handleFor(makeMirror(state.node))
      }
    case 'raf':
      return () => rafWriter((v         ) => doUpdate(state, v))
    case 'first':
      return () => {
        if (state.path.length > 0) throw new Error('data: first() applies to a view, not a child path')
        const n = state.node
        const order = n.currentOrder()
        const k = order ? order[0] : n.snapshot().keys().next().value
        return childHandle(state, String(k ?? 0))
      }
    case 'last':
      return () => {
        if (state.path.length > 0) throw new Error('data: last() applies to a view, not a child path')
        const n = state.node
        const order = n.currentOrder()
        let k                    
        if (order) k = order[order.length - 1]
        else for (k of n.snapshot().keys());
        return childHandle(state, String(k ?? 0))
      }
    case 'ingest':
      return (records         , opts          ) => {
        if (!(state.node instanceof SourceNode) || state.path.length > 0)
          throw new Error('data: ingest() applies to a source root')
        return seamIngest(state.node, records       , opts       )
      }
    case 'each':
      // W9: the NO-COPY read protocol on the public handle — one-pass row
      // visitation without materializing a snapshot container (~5× the
      // copy-then-iterate cost at 10k rows; kernel node.each). Root views
      // only; contract: do NOT mutate the view inside fn.
      return (fn                                     ) => {
        if (state.path.length > 0) throw new Error('data: each() applies to a view, not a child path')
        if (state.node.kind === 'scalar') throw new Error('data: each() applies to collection views — read a scalar via [value]')
        state.node.each(fn)
      }
    case 'rowCount':
      // W9: live row count without a snapshot — O(1) on stores/materialized views.
      return () => {
        if (state.path.length > 0) throw new Error('data: rowCount() applies to a view, not a child path')
        if (state.node.kind === 'scalar') throw new Error('data: rowCount() applies to collection views')
        return state.node.rowCount()
      }
    case 'promote':
      // W11: pre-pay the adoption spike at boot (seed-then-serve flows).
      return () => {
        if (!(state.node instanceof SourceNode) || state.path.length > 0)
          throw new Error('data: promote() applies to a source root')
        state.node.promote()
      }
    case 'sink':
      // W2: the NATIVE batch subscription on the public surface — CommitBatch
      // by REFERENCE (zero clones; shared-immutable contract), origin-token
      // suppression, wantsOrder opt-in, optional init (snapshot-then-deltas,
      // clause 7) and synchronous dispose via the returned handle. This is
      // the hot-path shape fero's capture/serve rides — the documented
      // replacement for the Symbol.for('data.v4.node') reach-through.
      return (s   
                            
                              
                                                                                  
                                       
       )                     => {
        const n = state.node
        if (state.path.length > 0) throw new Error('data: sink() attaches to a view, not a child path')
        if (typeof s?.apply !== 'function') throw new Error('data: sink() takes { apply(batch), wantsOrder?, origin?, init? }')
        if (n.kind === 'scalar')
          throw new Error('data: sink() attaches to collection views — subscribe a scalar via connect(anchor, fn) records')
        // attachSettled: a mid-batch sink() defers init+connect to the
        // batch's commit (clause 7 — init is the settled state, the batch's
        // own deltas are not redelivered).
        return attachSettled(n.runtime, () => {
          if (s.init) s.init(n.snapshot(), n.currentOrder() ?? undefined)
          // Wrap rather than hand the user object to the kernel: the effect
          // loop reads entry.origin/wantsOrder per commit (keep them plain
          // data fields), and the runtime stamps bornSeq/dead on the entry.
          return n.connect({
            wantsOrder: s.wantsOrder === true,
            origin: s.origin ?? null,
            apply: (b) => s.apply(b),
          })
        })
      }
  }
  throw new Error(`data: makeMethod(${name}) — not a builtin`) // unreachable: gated by BUILTIN
}

// ── the proxy ────────────────────────────────────────────────────────────────
//
// ONE shared handler for every handle: the traps read the HandleState off the
// proxy TARGET (stamped at wrap time), so minting a handle allocates just the
// target + Proxy — no per-handle handler object or trap closures. Behavior is
// byte-identical to the per-handle handler it replaces.

function operatorCall(state             , prop        , def     )                          {
  return (...rawArgs           ) => {
    // Unwrap ROOT-view handle args to their nodes (set-ops take view
    // operands). CHILD handles pass through intact — a path-addressed
    // reactive param ("cfg.t") must keep its path; reactiveArg reads
    // the leaf through the handle's [value].
    const args = rawArgs.map((a) => {
      if (a === null || typeof a !== 'object') return a
      const st = (a       )[HANDLE]                           
      if (st !== undefined && st.path.length === 0 && (a       )[node] instanceof DataNode)
        return (a       )[node]
      return a
    })
    // length(fn) routes to the histogram (v2's length(fn) contract)
    const def2 = prop === 'length' && typeof args[0] === 'function' ? registry.get('lengthBuckets')  : def
    const key = def2.dedupKey ? def2.dedupKey(...args) : null
    if (key !== null && state.dedup !== null) {
      const hit = state.dedup.get(key)
      if (hit !== undefined) {
        // A disposed node is detached and frozen forever — handing it
        // back would silently return stale reads (the pivot-v3
        // dispose-then-rerequest footgun). Evict lazily and mint fresh.
        if (((hit       )[node]                 ).disposed) state.dedup.delete(key)
        else return hit
      }
    }
    const out = wrap({
      node: def2.create(state.node, ...args),
      source: null,
      path: [],
      children: null,
      dedup: null,
      methods: null,
    })
    if (key !== null) (state.dedup ??= new Map()).set(key, out)
    return out
  }
}

const SHARED_HANDLER                                                 = {
  get(t, prop, _r) {
    const state = t[HANDLE]               
    if (prop === value) return state.source !== null || state.path.length > 0 ? childRead(state) : readAt(state)
    if (prop === node) return state.node
    if (prop === HANDLE) return state
    if (prop === Symbol.toPrimitive || prop === 'toString')
      return () => `[data ${state.node.opName}#${state.node.id}${state.path.length ? ' .' + state.path.join('.') : ''}]`
    if (prop === 'toJSON') return () => readAt(state)
    if (prop === Symbol.iterator) {
      const snap = readAt(state)
      if (Array.isArray(snap)) return snap[Symbol.iterator].bind(snap)
      return function* () {
        if (snap && typeof snap === 'object') yield* Object.values(snap)
      }
    }
    // NOT thenable, NOT callable — a key literally named 'then' is data.
    if (typeof prop !== 'string') return undefined
    if (reserved(prop)) {
      if (BUILTIN.has(prop)) {
        const m = (state.methods ??= Object.create(null)                       )
        return (m[prop] ??= makeMethod(state, prop))
      }
      const def = registry.get(prop)
      if (def) {
        if (state.path.length > 0)
          throw new Error(
            `data: .${prop}(...) on a child path would operate on the OWNING view — chain operators off the view itself (child handles are addresses, not views)`,
          )
        return operatorCall(state, prop, def)
      }
      throw new Error(`data: reserved name ${prop} has no implementation yet`)
    }
    return childHandle(state, prop)
  },
  set(t, prop, _v) {
    if (prop === value)
      throw new Error('data: [value] whole-view assignment is a v2 idiom — use update()/set()/patch(); the pre-flip surface lives at data/v2')
    throw new Error(
      `data: bare assignment (.${String(prop)} =) is not the write surface — use .get(${JSON.stringify(String(prop))}).update(v) / .set(${JSON.stringify(String(prop))}, v) (types and runtime agree in v3)`,
    )
  },
  deleteProperty(t, prop) {
    throw new Error(`data: delete is not the write surface — use .get(${JSON.stringify(String(prop))}).remove()`)
  },
  has(t, prop) {
    const state = t[HANDLE]               
    if (typeof prop !== 'string') return prop === value || prop === node
    if (reserved(prop)) return true
    const snap = readAt(state)
    return snap != null && typeof snap === 'object' ? prop in (snap          ) : false
  },
  ownKeys(t) {
    const state = t[HANDLE]               
    const snap = readAt(state)
    return snap != null && typeof snap === 'object' ? Reflect.ownKeys(snap          ) : []
  },
  getOwnPropertyDescriptor(t, prop) {
    const state = t[HANDLE]               
    if (typeof prop !== 'string') return undefined
    const snap = readAt(state)
    if (snap != null && typeof snap === 'object' && prop in (snap          ))
      return { configurable: true, enumerable: true, value: (snap       )[prop] }
    return undefined
  },
}

function wrap(state             )      {
  const target = Object.create(null)                                    
  target[HANDLE] = state
  return new Proxy(target, SHARED_HANDLER)
}

function childHandle(state             , name        )      {
  const cache = (state.children ??= new Map())
  let child = cache.get(name)
  if (child === undefined) {
    const cs = childState(state, name)
    if (cs.source !== null && cs.path.length === 1) cs.path = [coerceKey(state, name)]
    child = wrap(cs)
    cache.set(name, child)
  }
  return child
}

// ── $ ────────────────────────────────────────────────────────────────────────

export function $                  (v               )      {
  // $(handle) fail-fast: SourceNode's constructor would walk Object.keys(v)
  // THROUGH the live proxy, minting a source whose rows are child-handle
  // proxies — membership frozen at construction, field reads leaking through
  // to live data, operator fns receiving proxies instead of rows. Silent
  // weirdness; point at the two things the caller could have meant.
  if (v !== null && typeof v === 'object' && (v       )[node] instanceof DataNode)
    throw new Error(
      'data: $(handle) would copy through the live proxy — use handle.mirror() for a re-pointable slot, or $(structuredClone(handle[value])) to fork a plain snapshot',
    )
  const src = new SourceNode(defaultRuntime, v       )
  void currentScope() // nodes self-register with the ambient scope in their ctor
  return wrap({ node: src, source: src, path: [], children: null, dedup: null, methods: null })
}

// Handles for raw nodes (used by tests / the render layer).
export function handleFor(n               )      {
  return wrap({ node: n, source: n instanceof SourceNode ? n : null, path: [], children: null, dedup: null, methods: null })
}
