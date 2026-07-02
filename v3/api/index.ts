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

import { registry } from '../ops/registry.ts'
import { Runtime } from '../kernel/runtime.ts'
import { DataNode, SourceNode, leafAt } from '../kernel/node.ts'
import type { SubscriptionHandle } from '../kernel/node.ts'
import { RESERVED, type ChangeRecordV2 } from '../contract/index.ts'
import type { Path, RowKey } from '../contract/delta.ts'
import { V2RecordSink, materialize } from '../compat/v2-records.ts'
import { currentScope } from '../kernel/scope.ts'
import { installReactive } from '../ops/reactive.ts'
import { mirror as makeMirror, MirrorNode, raf as rafWriter } from '../render/index.ts'
import { ingest as seamIngest } from '../seam/index.ts'

installReactive() // reactive value-slot args on gt/lt/gte/lte/za/az/top/limit/sum/avg

export { render, el, text, list } from '../render/index.ts'
export { fromAsync, exportContract, InMemoryBacking } from '../seam/index.ts'

export const value = Symbol.for('data.v3.value')
export const node = Symbol.for('data.v3.node')

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
  children: Map<string, any> // one wrapper per (state, name) — stable identity
  dedup: Map<string, any> // scope-owned operator dedup cache (deterministic)
}

const HANDLE = Symbol('data.v3.handle')

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
    return { node: parent.node, source: parent.node, path: [name], children: new Map(), dedup: new Map() }
  }
  if (parent.source !== null) {
    return { node: parent.node, source: parent.source, path: [...parent.path, name], children: new Map(), dedup: new Map() }
  }
  // child of an operator view: readable snapshot projection, writes throw
  return { node: parent.node, source: null, path: [name], children: new Map(), dedup: new Map() }
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

function writeTarget(state: HandleState): { src: SourceNode<any>; key: RowKey; sub: Path } {
  if (state.source === null || state.path.length === 0)
    throw new Error(
      'data: this view is a derived projection — write through its source (operator views are read-only)',
    )
  return { src: state.source, key: state.path[0] as RowKey, sub: state.path.slice(1) }
}

// ── the built-in method surface (everything non-operator in RESERVED) ────────

function makeMethods(state: HandleState, self: () => any): Record<string, (...args: any[]) => any> {
  const m: Record<string, (...args: any[]) => any> = {
    get(k: string | number) {
      return childHandle(state, String(k))
    },
    snapshot() {
      return readAt(state)
    },
    update(v: unknown) {
      if (state.path.length === 0 && state.node instanceof SourceNode)
        throw new Error('data: whole-source update — write [value] semantics not yet supported; use per-key writes or batch()')
      const { src, key, sub } = writeTarget(state)
      src.write(key, sub, v)
    },
    set(k: unknown, v?: unknown) {
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
    },
    insert(v: unknown, at?: number) {
      if (!(state.node instanceof SourceNode) || state.path.length > 0)
        throw new Error('data: insert() applies to a source root')
      return state.node.insert(v, at)
    },
    remove() {
      const { src, key, sub } = writeTarget(state)
      if (sub.length > 0) throw new Error('data: remove() detaches a row — nested field removal not yet supported')
      src.remove(key)
    },
    patch(pairs: readonly (readonly [string | number, unknown])[]) {
      if (!(state.node instanceof SourceNode) || state.path.length > 0)
        throw new Error('data: patch() applies to a source root')
      const src = state.node
      src.runtime.batch(() => {
        for (const [k, v] of pairs) src.write(coerceKey(state, String(k)), [], v)
      })
    },
    connect(a: unknown, b?: unknown): SubscriptionHandle {
      const n = state.node
      if (state.path.length > 0) throw new Error('data: connect() on child paths not yet supported — connect the view')
      if (Array.isArray(a) && b === undefined) {
        const sink = new V2RecordSink(n, (r: ChangeRecordV2) => (a as ChangeRecordV2[]).push(r))
        return n.connect(sink)
      }
      if (typeof a === 'object' && a !== null && typeof b === 'function') {
        const sink = new V2RecordSink(n, b as (r: ChangeRecordV2) => void)
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
    },
    dispose() {
      state.node.dispose()
    },
    mirror() {
      if (state.path.length > 0) throw new Error('data: mirror() applies to a view, not a child path')
      return handleFor(makeMirror(state.node))
    },
    raf() {
      return rafWriter((v: unknown) => m.update(v))
    },
    first() {
      if (state.path.length > 0) throw new Error('data: first() applies to a view, not a child path')
      const n = state.node
      const order = n.currentOrder()
      const k = order ? order[0] : n.snapshot().keys().next().value
      return childHandle(state, String(k ?? 0))
    },
    last() {
      if (state.path.length > 0) throw new Error('data: last() applies to a view, not a child path')
      const n = state.node
      const order = n.currentOrder()
      let k: RowKey | undefined
      if (order) k = order[order.length - 1]
      else for (k of n.snapshot().keys());
      return childHandle(state, String(k ?? 0))
    },
    ingest(records: unknown, opts?: unknown) {
      if (!(state.node instanceof SourceNode) || state.path.length > 0)
        throw new Error('data: ingest() applies to a source root')
      seamIngest(state.node, records as any, opts as any)
    },
  }
  void self
  return m
}

// ── the proxy ────────────────────────────────────────────────────────────────

function wrap(state: HandleState): any {
  const methods = makeMethods(state, () => proxy)
  const target = Object.create(null) as Record<string | symbol, unknown>
  const proxy: any = new Proxy(target, {
    get(_t, prop, _r) {
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
        const builtin = methods[prop]
        if (builtin) return builtin
        const def = registry.get(prop)
        if (def) {
          if (state.path.length > 0)
            throw new Error(
              `data: .${prop}(...) on a child path would operate on the OWNING view — chain operators off the view itself (child handles are addresses, not views)`,
            )
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
            if (key !== null) {
              const hit = state.dedup.get(key)
              if (hit !== undefined) return hit
            }
            const out = wrap({
              node: def2.create(state.node, ...args),
              source: null,
              path: [],
              children: new Map(),
              dedup: new Map(),
            })
            if (key !== null) state.dedup.set(key, out)
            return out
          }
        }
        throw new Error(`data: reserved name ${prop} has no implementation yet`)
      }
      return childHandle(state, prop)
    },
    set(_t, prop, _v) {
      if (prop === value)
        throw new Error('data: [value] whole-view assignment is a v2 idiom — use update()/set()/patch() (data/v2-compat restores it)')
      throw new Error(
        `data: bare assignment (.${String(prop)} =) is not the write surface — use .get(${JSON.stringify(String(prop))}).update(v) / .set(${JSON.stringify(String(prop))}, v) (types and runtime agree in v3)`,
      )
    },
    deleteProperty(_t, prop) {
      throw new Error(`data: delete is not the write surface — use .get(${JSON.stringify(String(prop))}).remove()`)
    },
    has(_t, prop) {
      if (typeof prop !== 'string') return prop === value || prop === node
      if (reserved(prop)) return true
      const snap = readAt(state)
      return snap != null && typeof snap === 'object' ? prop in (snap as object) : false
    },
    ownKeys() {
      const snap = readAt(state)
      return snap != null && typeof snap === 'object' ? Reflect.ownKeys(snap as object) : []
    },
    getOwnPropertyDescriptor(_t, prop) {
      if (typeof prop !== 'string') return undefined
      const snap = readAt(state)
      if (snap != null && typeof snap === 'object' && prop in (snap as object))
        return { configurable: true, enumerable: true, value: (snap as any)[prop] }
      return undefined
    },
  })
  return proxy
}

function childHandle(state: HandleState, name: string): any {
  let child = state.children.get(name)
  if (child === undefined) {
    const cs = childState(state, name)
    if (cs.source !== null && cs.path.length === 1) cs.path = [coerceKey(state, name)]
    child = wrap(cs)
    state.children.set(name, child)
  }
  return child
}

// ── $ ────────────────────────────────────────────────────────────────────────

export function $<T extends object>(v: T | unknown[]): any {
  const src = new SourceNode(defaultRuntime, v as any)
  void currentScope() // nodes self-register with the ambient scope in their ctor
  return wrap({ node: src, source: src, path: [], children: new Map(), dedup: new Map() })
}

// Handles for raw nodes (used by tests / the render layer).
export function handleFor(n: DataNode<any>): any {
  return wrap({ node: n, source: n instanceof SourceNode ? n : null, path: [], children: new Map(), dedup: new Map() })
}
