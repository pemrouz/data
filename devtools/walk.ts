// @ts-nocheck
// Pure helpers for the devtools layer. No instrumentation, no monkey-patching,
// no side effects on the runtime — just read-side traversal of the View/Sink
// graph and value summaries. Other devtools modules (index, instrument, events)
// build on these.
import {
  Operator, Sink, View, view,
  _devtoolsRoots, _devtoolsInternalRoots,
} from '../core.ts'

// iterRoots() — yields every live root view registered in _devtoolsRoots,
// derefing each WeakRef and pruning entries whose target has been GC'd. By
// default skips internal roots (panel state etc.); pass { internal: true }
// to include them.
export function* iterRoots(opts) {
  const includeInternal = opts && opts.internal
  for (const ref of _devtoolsRoots) {
    const v = ref.deref()
    if (!v) { _devtoolsRoots.delete(ref); continue }
    if (!includeInternal && _devtoolsInternalRoots.has(v)) continue
    yield v
  }
}

// internalRoot(proxy) — mark `proxy`'s view as devtools-internal so it's
// hidden from the user-facing graph view by default. The panel uses this to
// keep its own reactive state out of the inspector.
export function internalRoot(proxy) {
  const target = proxy?.[view]
  if (target) _devtoolsInternalRoots.add(target)
  return proxy
}

// classify(sink) — what role does this sink play? The graph view shows
// operators differently from DOM bindings differently from user-attached
// connect() sinks. We don't import DOMSink (it lives in render/, optional)
// or ArrSink/PropSink/FunctionSink (private to core), so we duck-type by
// constructor name and parent shape.
export function classify(sink) {
  if (sink instanceof Operator) return 'operator'
  if (sink && typeof sink === 'object') {
    if ('parent' in sink && sink.constructor?.name === 'DOMSink') return 'dom'
    const n = sink.constructor?.name
    if (n === 'ArrSink' || n === 'PropSink' || n === 'FunctionSink') return 'connect'
  }
  return 'sink'
}

// summarize(value) — short, JSON-safe-ish preview suitable for a console
// graph dump. Avoids dragging huge objects into the output. Arrays show as
// `Array(n)`, plain objects as `{ keys: n }`, primitives pass through.
export function summarize(value) {
  if (value === null || value === undefined) return value
  const t = typeof value
  if (t === 'string') return value.length > 80 ? value.slice(0, 77) + '...' : value
  if (t === 'number' || t === 'boolean' || t === 'bigint' || t === 'symbol') return value
  if (Array.isArray(value)) return `Array(${value.length})`
  if (t === 'function') return `Function(${value.name || 'anonymous'})`
  if (t === 'object') return `{ keys: ${Object.keys(value).length} }`
  return String(value)
}

// ancestorOf(child, root) — is `root` reachable from `child` by walking the
// parent chain? Used by trace/profile to scope events to a subtree without
// instrumenting every operator. The depth cap is paranoia: parent chains
// shouldn't loop, but if anything ever does we don't want an infinite walk.
export function ancestorOf(child, root, maxDepth = 32) {
  if (!child || !root) return false
  if (child === root) return true
  let n = child, d = 0
  while (n && d < maxDepth) {
    if (n === root) return true
    n = n.p
    d++
  }
  return false
}

// walk(view, opts?) — depth-first dump of the View graph rooted at `view`.
// Returns a serializable tree (no live View references) so it survives
// console.dir and can be serialized to JSON if a panel ever wants to ship
// it over a channel. WeakRef'd children/sinks are dereffed via View.each /
// View.sink which already prune dead entries, so dropped subscribers vanish
// naturally.
//
// opts.pickedSink — when set, the walk tags the matching sink node with
// `picked: true` and bubbles `pickedAncestor: true` up through the chain
// so callers can auto-expand the path. Used by the panel's Graph tab to
// spotlight the binding picked via the DOM picker.
export function walk(view, opts) {
  opts = opts || {}
  return walkImpl(view, opts.seen || new WeakSet(), opts)
}

function walkImpl(view, seen, opts) {
  if (seen.has(view)) {
    return { key: [...view.key], kind: 'cycle', children: [], sinks: [] }
  }
  seen.add(view)

  // LinkedView aliases another view. Don't recurse into the target — pass an
  // aliasOf marker so callers can choose to walk the source separately. We
  // detect it by the LinkedView-only `src` field rather than importing the
  // unexported class.
  if ('src' in view && view.src && view.src !== view) {
    return {
      key: [...view.key],
      name: view.name,
      kind: 'linked-alias',
      aliasOf: view.src.key ? [...view.src.key] : [],
      children: [],
      sinks: [],
    }
  }

  const node = {
    key: [...view.key],
    name: view.name,
    kind: view.p ? 'child' : 'root',
    value: summarize(view.value),
    children: [],
    sinks: [],
  }

  view.each?.((_name, child) => {
    const c = walkImpl(child, seen, opts)
    if (c.picked || c.pickedAncestor) node.pickedAncestor = true
    node.children.push(c)
  })

  view.sink?.((s) => {
    if (s instanceof Operator) {
      const opNode = walkImpl(s.view, seen, opts)
      opNode.kind = 'operator'
      opNode.ctor = s.constructor.name
      if (opts.pickedSink === s) opNode.picked = true
      if (opNode.picked || opNode.pickedAncestor) node.pickedAncestor = true
      node.sinks.push(opNode)
    } else {
      const sinkNode = {
        key: [...view.key],
        kind: classify(s),
        ctor: s.constructor?.name || 'anonymous',
        children: [],
        sinks: [],
      }
      if (opts.pickedSink === s) {
        sinkNode.picked = true
        node.pickedAncestor = true
      }
      node.sinks.push(sinkNode)
    }
  })

  return node
}
