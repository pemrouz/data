// @ts-nocheck
// Devtools public API. Importing this module attaches helpers to the canonical
// `$` from core, mirroring how `$.random` is exposed (core.ts:32). Read-side
// only in this file: $.inspect, $.graph, $.fromDOM, $.highlight. Heavyweight
// machinery (trace/profile and the View.prototype patches that drive them)
// lives in instrument.ts and gets layered on top.
import { $, view, _devtoolsRoots, ViewProxy, Operator } from '../core.ts'
import './augment.ts'  // declare-module merge: types $.inspect/$.graph/… on Dollar
import { walk, classify, iterRoots, internalRoot } from './walk.ts'
import { ensureInstrumented, restoreInstrumentation } from './instrument.ts'
import {
  VERBS,
  traceTargets,
  profilers,
  cascadeRecorders,
  flushPendingClose,
  nextTraceId,
  newProfileAcc,
  finalize,
} from './events.ts'

// $.inspect(proxy) — print and return a single-view snapshot. Useful in the
// browser console: `$.inspect(items)` gives you the immediate children + sinks
// without walking the whole graph.
$.inspect = function inspect(proxy) {
  const v = proxy?.[view]
  if (!v) throw new Error('$.inspect requires a ViewProxy')
  const children = []
  v.each?.((name) => children.push({ name }))
  const sinks = []
  v.sink?.((s) => sinks.push({
    kind: classify(s),
    ctor: s.constructor?.name || 'anonymous',
  }))
  const out = {
    key: [...v.key],
    value: v.value,
    parent: v.p ? new ViewProxy(v.p) : null,
    children,
    sinks,
  }
  // Pretty print for the console; the returned object is the source of truth
  // (the printout is a courtesy, not the API).
  if (typeof console !== 'undefined' && console.group) {
    console.group(`View ${v.key.join('.') || '<root>'}`)
    console.log('value', v.value)
    if (children.length) console.table(children)
    if (sinks.length) console.table(sinks)
    console.groupEnd()
  }
  return out
}

// $.graph(proxy?, opts?) — DFS the View graph from `proxy`, or from every
// live root when no argument is given. Returns the same serializable tree
// shape that devtools/walk.ts produces, so a panel could ship it over
// postMessage etc. opts.internal:true includes devtools-internal roots
// (panel state etc.) when enumerating with no proxy argument.
$.graph = function graph(proxy, opts) {
  if (proxy === undefined) {
    const trees = []
    for (const v of iterRoots(opts)) trees.push(walk(v))
    if (typeof console !== 'undefined' && console.dir) {
      console.dir(trees, { depth: null })
    }
    return trees
  }
  const v = proxy?.[view]
  if (!v) throw new Error('$.graph requires a ViewProxy or no argument')
  const tree = walk(v)
  if (typeof console !== 'undefined' && console.dir) {
    console.dir(tree, { depth: null })
  }
  return tree
}

// $.fromDOM(el) — given a DOM element from the devtools console (e.g. $0),
// walk up the parent chain until we find a __ripple_sink (set in
// render/index.ts Node.render). Return a proxy for that sink's source view.
$.fromDOM = function fromDOM(el) {
  let n = el
  while (n) {
    if (n.__ripple_sink) {
      const v = n.__ripple_sink.p
      return v ? new ViewProxy(v) : null
    }
    n = n.parentElement
  }
  return null
}

// $.highlight(proxy, ms?) — for every live DOMSink whose source view matches
// `proxy`, briefly outline the bound element. Has no effect in non-DOM
// environments (parent.classList is required).
$.highlight = function highlight(proxy, ms = 1000) {
  const v = proxy?.[view]
  if (!v) throw new Error('$.highlight requires a ViewProxy')
  const targets = []
  v.sink?.((s) => {
    if (classify(s) === 'dom' && s.parent?.classList) targets.push(s.parent)
  })
  for (const el of targets) el.classList?.add('__ripple_highlight')
  if (typeof setTimeout !== 'undefined' && targets.length) {
    setTimeout(() => {
      for (const el of targets) el.classList?.remove('__ripple_highlight')
    }, ms)
  }
  return targets.length
}

// $.trace(proxy, opts?) — install a trace listener for the subtree rooted
// at proxy. Returns a disposer that removes the listener. Auto-enables
// instrumentation on first call. Default behavior logs each event to the
// console; pass { log: false, onEvent } to capture programmatically.
$.trace = function trace(proxy, opts = {}) {
  const v = proxy?.[view]
  if (!v) throw new Error('$.trace requires a ViewProxy')
  ensureInstrumented()
  const id = nextTraceId()
  traceTargets.set(id, {
    id,
    root: v,
    verbs: opts.verbs ? new Set(opts.verbs) : null,
    log: opts.log !== false,
    onEvent: opts.onEvent,
  })
  return function dispose() {
    traceTargets.delete(id)
  }
}

// $.profile(proxy?, opts?) — start collecting per-operator counts and
// timings. Returns { stop, report }. stop() ends the window and returns the
// final report; report() returns a snapshot without stopping. If
// opts.durationMs is given, the profile auto-stops after that interval.
$.profile = function profile(proxy, opts = {}) {
  ensureInstrumented()
  const v = proxy?.[view] || null
  const acc = newProfileAcc()
  const id = nextTraceId()
  profilers.set(id, { id, root: v, acc })
  let timer = null
  if (opts.durationMs) {
    timer = setTimeout(stop, opts.durationMs)
  }
  function stop() {
    if (timer) { clearTimeout(timer); timer = null }
    profilers.delete(id)
    const r = finalize(acc)
    if (typeof console !== 'undefined' && console.table && r.byOperator.length) {
      console.table(r.byOperator)
    }
    return r
  }
  function report() { return finalize(acc) }
  return { stop, report }
}

// $.cascades(proxy?, opts?) — start recording propagation cascades. A
// cascade is the synchronous tree of verb calls triggered by one root
// mutation; each frame records its parent index, op constructor, key,
// verb, and start/end timestamps relative to cascade start. Returns
// { stop, report, clear }. With no proxy argument, every cascade in the
// whole graph is captured. opts.maxCascades caps the ring buffer
// (default 200) so a long-running session doesn't grow unboundedly.
$.cascades = function cascades(proxy, opts = {}) {
  ensureInstrumented()
  const v = proxy?.[view] || null
  const id = nextTraceId()
  const recorder = {
    id,
    root: v,
    opts: {
      maxCascades: opts.maxCascades ?? 200,
      captureState: !!opts.captureState,
    },
    cascades: [],
    current: null,
    stack: null,
    cascadeStartT: 0,
    nextCascadeId: 1,
    rootView: null,
  }
  cascadeRecorders.set(id, recorder)
  return {
    stop() {
      flushPendingClose(recorder)
      cascadeRecorders.delete(id)
      return recorder.cascades.slice()
    },
    report() {
      flushPendingClose(recorder)
      return recorder.cascades.slice()
    },
    clear() {
      flushPendingClose(recorder)
      recorder.cascades.length = 0
    },
  }
}

// $.devtools — explicit control for users who want to pre-warm or fully
// tear down the instrumentation patches. trace/profile auto-enable; this
// is for the "I want to time my whole app startup" or "I want to confirm
// View.prototype is byte-identical to original" cases.
$.devtools = {
  enable: ensureInstrumented,
  disable() {
    traceTargets.clear()
    profilers.clear()
    cascadeRecorders.clear()
    restoreInstrumentation()
  },
  // `panel.open(proxy?)` opens the overlay rooted at `proxy` (or the first
  // live root if omitted). `panel.close()` tears it down. `panel.shell`
  // returns the live panel object — `{ host, root, dock, destroy }` — for
  // tests / advanced scripting that need to reach into the closed shadow.
  panel: {
    open(proxy) { return mountPanel(proxy) },
    close() { return unmountPanel() },
    get shell() { return getPanelShell() },
  },
}

// Auto-mount the in-page overlay panel on import, unless the URL carries
// ?nopanel — useful for consumers who import devtools just for the console
// API and don't want the visible UI. Lazy-imported so the panel bundle is
// only fetched when this code runs; when the consumer's bundler splits
// modules, the panel chunk is separable from the read-side helpers above.
let mountPanel: (proxy?: unknown) => unknown = () => undefined
let unmountPanel: () => void = () => {}
let getPanelShell: () => unknown = () => null
if (typeof document !== 'undefined') {
  const noPanel =
    typeof location !== 'undefined' && /(?:^|[?&])nopanel(?:[=&]|$)/.test(location.search)
  void import('./panel/index.ts').then((m) => {
    mountPanel = m.mount
    unmountPanel = m.unmount
    getPanelShell = m.getShell
    if (!noPanel) m.mount()
  })
}

// Re-export so consumers can `import { walk, classify } from 'data/devtools'`
// without reaching into the internal walk.ts module.
export { walk, classify, summarize, ancestorOf } from './walk.ts'
export { $ }
