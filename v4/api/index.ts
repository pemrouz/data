// v3/api — the public surface: $(value) returns a NON-CALLABLE, NON-THENABLE
// handle. Property sugar reads children for every name outside the versioned
// RESERVED set; get(key) is the total, collision-free child read; writes are
// METHODS ONLY (update/set/insert/remove/patch — bare assignment throws with
// guidance); operator methods are generated from the registry (one source of
// truth — drift is impossible); [value] reads the dense plain snapshot.
//
// Import order note: importing this module installs the operator modules
// (static imports, no side-effect registration protocol — tree-shakers see
// real imports).

import '../ops/rowops.ts'
import '../ops/aggregate.ts'
import '../ops/between.ts'
import '../ops/setops.ts'
import '../ops/bucket.ts'
import '../ops/ordered.ts'
import '../ops/misc.ts'
import '../ops/quantile.ts'

import { registry } from '../ops/registry.ts'
import { Runtime } from '../kernel/runtime.ts'
import { DataNode, SourceNode, leafAt } from '../kernel/node.ts'
import type { SubscriptionHandle } from '../kernel/node.ts'
import { RESERVED, type ChangeRecordV2 } from '../contract/index.ts'
import type { Path, RowKey } from '../contract/delta.ts'
import { V2RecordSink, materialize, type V2SinkOpts } from '../compat/v2-records.ts'
import { currentScope } from '../kernel/scope.ts'
import { installReactive } from '../ops/reactive.ts'
import { mirror as makeMirror, MirrorNode, raf as rafWriter } from '../render/index.ts'
import { ingest as seamIngest } from '../seam/index.ts'

installReactive() // reactive value-slot args on gt/lt/gte/lte/za/az/top/limit/sum/avg

export { render, el, text, list, bind, component, boundary } from '../render/index.ts'
export { HTML, SVG, normChildren } from '../render/builders.ts'
export { h, Fragment, For, ErrorBoundary } from '../jsx/index.ts'
// The component-lifecycle hook: registers a cleanup on the AMBIENT scope
// (a component invocation, a render mount) — see kernel/scope.ts.
export { onCleanup } from '../kernel/scope.ts'
// The automatic-runtime verbs live on the MAIN entry too: dist/v3/jsx-runtime.js
// is a thin re-export of this bundle (see tsup.config.ts), so these names must
// exist here for that entry to forward — and classic/automatic interop shares
// one module instance either way.
export { jsx, jsxs, jsxDEV } from '../jsx/runtime.ts'
export { fromAsync, exportContract, InMemoryBacking, lane, HOT, wireSink } from '../seam/index.ts'
// Devtools-support re-exports: dist/v3/devtools.js is emitted with every
// cross-boundary import rewritten to './index.js' (the jsx-runtime
// single-module-instance discipline — a duplicate kernel would break
// instanceof across bundles), so everything the devtools layer touches BY
// VALUE must be reachable from this entry. Not part of the consumer surface.
export { DataNode } from '../kernel/node.ts'
export { Runtime } from '../kernel/runtime.ts'
export { materialize } from '../compat/v2-records.ts'
export { domLinks, liveLists } from '../render/index.ts'

export const value = Symbol.for('data.v4.value')
export const node = Symbol.for('data.v4.node')

const defaultRuntime = new Runtime()
export function runtime(): Runtime {
  return defaultRuntime
}

export function batch<R>(fn: () => R): R {
  return defaultRuntime.batch(fn)
}

// ── handle internals ─────────────────────────────────────────────────────────

interface HandleState {
  node: DataNode<any>
  // For children of a SOURCE: the owning source + the path from its root.
  // path[0] is the row key; deeper entries address into the row.
  source: SourceNode<any> | null
  path: Path
  // All three caches are LAZY (null until first use): a leaf handle minted for
  // one get(k).remove() allocates none of them. Minting used to cost ~30
  // allocations (eager method suite + per-handle Proxy handler + two Maps) —
  // the dominant per-write term on every fresh-key get(k) path (the corpus
  // remove-side hotspots, STATUS gap 8 pass 2).
  children: Map<string, any> | null // one wrapper per (state, name) — stable identity
  dedup: Map<string, any> | null // scope-owned operator dedup cache (deterministic)
  methods: Record<string, any> | null // per-verb closures, minted on first access
}

const HANDLE = Symbol('data.v4.handle')

function reserved(name: string): boolean {
  return RESERVED.has(name)
}

function readAt(state: HandleState): unknown {
  if (state.path.length === 0) {
    const n = state.node
    if (n.kind === 'scalar') return (n as any).value()
    return materialize(n.snapshot(), n.currentOrder())
  }
  const src = state.source!
  const key = state.path[0] as RowKey
  const row = src.get(key)
  return state.path.length === 1 ? row : leafAt(row, state.path.slice(1))
}

function childState(parent: HandleState, name: string): HandleState {
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

function childRead(state: HandleState): unknown {
  if (state.source !== null) return readAt(state)
  // operator-view child: read through the materialized snapshot
  const snap = state.node.snapshot()
  const key = state.path[0] as RowKey
  const row = snap.has(key) ? snap.get(key) : snap.get(String(key)) ?? snap.get(Number(key))
  return state.path.length === 1 ? row : leafAt(row, state.path.slice(1))
}

// key coercion: array-born sources mint integer keys; property sugar always
// arrives as strings. A source with an order channel resolves numeric-looking
// names positionally? NO — positional addressing is a lens concern; the sugar
// addresses KEYS. For array-born sources a numeric-looking name addresses the
// minted integer key.
function coerceKey(state: HandleState, name: string): RowKey {
  const src = state.source
  if (src !== null && state.path.length === 0 && src.currentOrder() !== null && /^\d+$/.test(name))
    return Number(name)
  return name
}

const EMPTY_PATH: Path = Object.freeze([]) as unknown as Path

// W9: once-per-object deep freeze (cycle-safe; WeakSet cache added BEFORE
// recursion). Rows are immutable post-write by the path-copy law, so a
// frozen row stays valid forever.
const frozenSeen = new WeakSet<object>()
function deepFreeze<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v
  if (frozenSeen.has(v as object)) return v
  frozenSeen.add(v as object)
  for (const k of Object.keys(v as object)) deepFreeze((v as any)[k])
  return Object.freeze(v)
}

function writeTarget(state: HandleState): { src: SourceNode<any>; key: RowKey; sub: Path } {
  if (state.source === null || state.path.length === 0)
    throw new Error(
      'data: this view is a derived projection — write through its source (operator views are read-only)',
    )
  return {
    src: state.source,
    key: state.path[0] as RowKey,
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

function doUpdate(state: HandleState, v: unknown): void {
  if (state.path.length === 0 && state.node instanceof SourceNode)
    throw new Error('data: whole-source update — write [value] semantics not yet supported; use per-key writes or batch()')
  const { src, key, sub } = writeTarget(state)
  src.write(key, sub, v)
}

function makeMethod(state: HandleState, name: string): (...args: any[]) => any {
  switch (name) {
    case 'get':
      return (k: string | number) => childHandle(state, String(k))
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
      return (opts?: { freeze?: boolean }) => {
        const v = readAt(state)
        return opts?.freeze === true ? deepFreeze(v) : v
      }
    case 'update':
      return (v: unknown) => doUpdate(state, v)
    case 'set':
      return (k: unknown, v?: unknown) => {
        // mirror repoint: mirrorHandle.set(otherViewHandle) — single object arg
        if (state.node instanceof MirrorNode && state.path.length === 0 && v === undefined && k !== null && typeof k === 'object') {
          state.node.set((k as any)[node] ?? k)
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
      return (v: unknown, at?: number) => {
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
      return (pairs: readonly (readonly [string | number, unknown])[]) => {
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
        const src = state.node as SourceNode<any>
        src.runtime.batch(() => {
          for (const [k, v] of pairs) src.write(coerceKey(state, String(k)), [], v)
        })
      }
    case 'connect':
      return (a: unknown, b?: unknown, c?: unknown): SubscriptionHandle => {
        const n = state.node
        if (state.path.length > 0) throw new Error('data: connect() on child paths not yet supported — connect the view')
        // W2: the record forms take trailing options {origin, clone, initial} —
        // origin-token echo suppression and the clone-free/by-ref mode on the
        // PUBLIC surface (no more Symbol.for node reach-through for fero).
        if (Array.isArray(a) && (b === undefined || (typeof b === 'object' && b !== null))) {
          const sink = new V2RecordSink(n, (r: ChangeRecordV2) => (a as ChangeRecordV2[]).push(r), (b as V2SinkOpts) ?? {})
          return n.connect(sink)
        }
        if (typeof a === 'object' && a !== null && typeof b === 'function') {
          const sink = new V2RecordSink(n, b as (r: ChangeRecordV2) => void, (c as V2SinkOpts) ?? {})
          return n.connect(sink)
        }
        if (typeof a === 'object' && a !== null && typeof b === 'string') {
          const obj = a as Record<string, unknown>
          obj[b] = readAt(state)
          return n.connect({
            wantsOrder: false,
            origin: null,
            apply: () => {
              obj[b] = readAt(state)
            },
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
      return () => rafWriter((v: unknown) => doUpdate(state, v))
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
        let k: RowKey | undefined
        if (order) k = order[order.length - 1]
        else for (k of n.snapshot().keys());
        return childHandle(state, String(k ?? 0))
      }
    case 'ingest':
      return (records: unknown, opts?: unknown) => {
        if (!(state.node instanceof SourceNode) || state.path.length > 0)
          throw new Error('data: ingest() applies to a source root')
        return seamIngest(state.node, records as any, opts as any)
      }
    case 'each':
      // W9: the NO-COPY read protocol on the public handle — one-pass row
      // visitation without materializing a snapshot container (~5× the
      // copy-then-iterate cost at 10k rows; kernel node.each). Root views
      // only; contract: do NOT mutate the view inside fn.
      return (fn: (key: RowKey, row: unknown) => void) => {
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
      return (s: {
        wantsOrder?: boolean
        origin?: symbol | null
        init?: (snapshot: Map<RowKey, unknown>, order?: readonly RowKey[]) => void
        apply: (batch: unknown) => void
      }): SubscriptionHandle => {
        const n = state.node
        if (state.path.length > 0) throw new Error('data: sink() attaches to a view, not a child path')
        if (typeof s?.apply !== 'function') throw new Error('data: sink() takes { apply(batch), wantsOrder?, origin?, init? }')
        if (n.kind === 'scalar')
          throw new Error('data: sink() attaches to collection views — subscribe a scalar via connect(anchor, fn) records')
        if (s.init) s.init(n.snapshot(), n.currentOrder() ?? undefined)
        // Wrap rather than hand the user object to the kernel: the effect
        // loop reads entry.origin/wantsOrder per commit (keep them plain data
        // fields), and the runtime stamps bornSeq/dead on the entry.
        return n.connect({
          wantsOrder: s.wantsOrder === true,
          origin: s.origin ?? null,
          apply: (b) => s.apply(b),
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

function operatorCall(state: HandleState, prop: string, def: any): (...args: any[]) => any {
  return (...rawArgs: unknown[]) => {
    // Unwrap ROOT-view handle args to their nodes (set-ops take view
    // operands). CHILD handles pass through intact — a path-addressed
    // reactive param ("cfg.t") must keep its path; reactiveArg reads
    // the leaf through the handle's [value].
    const args = rawArgs.map((a) => {
      if (a === null || typeof a !== 'object') return a
      const st = (a as any)[HANDLE] as HandleState | undefined
      if (st !== undefined && st.path.length === 0 && (a as any)[node] instanceof DataNode)
        return (a as any)[node]
      return a
    })
    // length(fn) routes to the histogram (v2's length(fn) contract)
    const def2 = prop === 'length' && typeof args[0] === 'function' ? registry.get('lengthBuckets')! : def
    const key = def2.dedupKey ? def2.dedupKey(...args) : null
    if (key !== null && state.dedup !== null) {
      const hit = state.dedup.get(key)
      if (hit !== undefined) {
        // A disposed node is detached and frozen forever — handing it
        // back would silently return stale reads (the pivot-v3
        // dispose-then-rerequest footgun). Evict lazily and mint fresh.
        if (((hit as any)[node] as DataNode<any>).disposed) state.dedup.delete(key)
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

const SHARED_HANDLER: ProxyHandler<Record<string | symbol, unknown>> = {
  get(t, prop, _r) {
    const state = t[HANDLE] as HandleState
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
        const m = (state.methods ??= Object.create(null) as Record<string, any>)
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
    const state = t[HANDLE] as HandleState
    if (typeof prop !== 'string') return prop === value || prop === node
    if (reserved(prop)) return true
    const snap = readAt(state)
    return snap != null && typeof snap === 'object' ? prop in (snap as object) : false
  },
  ownKeys(t) {
    const state = t[HANDLE] as HandleState
    const snap = readAt(state)
    return snap != null && typeof snap === 'object' ? Reflect.ownKeys(snap as object) : []
  },
  getOwnPropertyDescriptor(t, prop) {
    const state = t[HANDLE] as HandleState
    if (typeof prop !== 'string') return undefined
    const snap = readAt(state)
    if (snap != null && typeof snap === 'object' && prop in (snap as object))
      return { configurable: true, enumerable: true, value: (snap as any)[prop] }
    return undefined
  },
}

function wrap(state: HandleState): any {
  const target = Object.create(null) as Record<string | symbol, unknown>
  target[HANDLE] = state
  return new Proxy(target, SHARED_HANDLER)
}

function childHandle(state: HandleState, name: string): any {
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

export function $<T extends object>(v: T | unknown[]): any {
  // $(handle) fail-fast: SourceNode's constructor would walk Object.keys(v)
  // THROUGH the live proxy, minting a source whose rows are child-handle
  // proxies — membership frozen at construction, field reads leaking through
  // to live data, operator fns receiving proxies instead of rows. Silent
  // weirdness; point at the two things the caller could have meant.
  if (v !== null && typeof v === 'object' && (v as any)[node] instanceof DataNode)
    throw new Error(
      'data: $(handle) would copy through the live proxy — use handle.mirror() for a re-pointable slot, or $(structuredClone(handle[value])) to fork a plain snapshot',
    )
  const src = new SourceNode(defaultRuntime, v as any)
  void currentScope() // nodes self-register with the ambient scope in their ctor
  return wrap({ node: src, source: src, path: [], children: null, dedup: null, methods: null })
}

// Handles for raw nodes (used by tests / the render layer).
export function handleFor(n: DataNode<any>): any {
  return wrap({ node: n, source: n instanceof SourceNode ? n : null, path: [], children: null, dedup: null, methods: null })
}
