// @ts-nocheck
// State + dispatch for devtools trace/profile. Lives separate from the
// monkey-patcher (instrument.ts) so tests can drive the dispatcher in
// isolation without touching View.prototype.
import { ancestorOf, summarize } from './walk.ts'

// All View notification verbs we instrument. Listed exhaustively so the
// patcher can iterate; the array-aware variants (BR1A/BI0A) and the move
// (BMV1) are included alongside the basic verbs.
export const VERBS = [
  'XU0', 'XR0',
  'BU1', 'BU2',
  'BI0', 'BI0A', 'BI2',
  'BR1', 'BR1A', 'BR2',
  'BMV1',
]

// Active trace registrations. Each entry: { id, root: View|null, verbs: Set,
// onEvent: fn }. `root === null` means trace every view (rare, intended for
// debugging the runtime itself).
export const traceTargets = new Map()

// Active profilers. Each entry: { id, root: View|null, acc: { events, ms,
// byOp: Map<string, ProfileBucket>, byVerb: object } }.
export const profilers = new Map()

// Active cascade recorders. A cascade is the synchronous tree of patched
// verb calls triggered by one root mutation. Each entry:
// { id, root: View|null, opts, cascades: Cascade[], current: Cascade|null,
//   stack: number[], cascadeStartT: number, nextCascadeId: number }.
// Frames carry parent indices so renderers can rebuild the tree without a
// second pass.
export const cascadeRecorders = new Map()

let nextId = 1
export function nextTraceId() { return nextId++ }

// Re-entrancy depth: a parent verb's call can trigger child verb calls
// inside the same JavaScript turn. We only attribute wall-clock time to
// the *innermost* profiler-tracked call so a cascade of N events doesn't
// double-count the wall time. Counts (events, byOp.count, byVerb) are
// always incremented per call regardless of depth.
let depth = 0

export function dispatchTrace(view, verb, payload) {
  if (!traceTargets.size) return
  for (const t of traceTargets.values()) {
    if (t.root && !ancestorOf(view, t.root)) continue
    if (t.verbs && !t.verbs.has(verb)) continue
    const ev = {
      t: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      verb,
      key: [...view.key],
      payload: summarize(payload),
    }
    if (t.onEvent) t.onEvent(ev)
    if (t.log !== false && typeof console !== 'undefined') {
      console.log(`[trace] ${verb} ${ev.key.join('.') || '<root>'}`, ev.payload)
    }
  }
}

export function enterProfile() { depth++ }
export function exitProfile(view, verb, dt) {
  depth--
  if (!profilers.size) return
  for (const p of profilers.values()) {
    if (p.root && !ancestorOf(view, p.root)) continue
    const acc = p.acc
    acc.events++
    acc.byVerb[verb] = (acc.byVerb[verb] || 0) + 1
    const opCtor = view.res?.constructor?.name || 'View'
    const opKey = view.key.join('.')
    const bucketKey = `${opCtor}@${opKey}`
    let bucket = acc.byOp.get(bucketKey)
    if (!bucket) {
      bucket = { ctor: opCtor, key: [...view.key], count: 0, totalMs: 0 }
      acc.byOp.set(bucketKey, bucket)
    }
    bucket.count++
    // Only the outermost call contributes wall-clock; nested calls inflate
    // count/totalMs of their own bucket but not the wall-time of ancestors.
    if (depth === 0) {
      bucket.totalMs += dt
      acc.ms += dt
    }
  }
}

export function isAtTopOfStack() { return depth === 0 }

// Cascade recorder hooks. enterCascadeFrame is called *before* orig.apply
// in the patched verb; exitCascadeFrame is called in the finally block so
// errors thrown by the underlying call don't leave half-closed frames.
// Each recorder maintains its own stack — we don't share with the global
// `depth` counter because the profiler counts re-entrancy across all
// instrumented calls, while a cascade is scoped to its recorder's root.
//
// Coalescing: a single user assignment like `data.a = 2` actually fires
// two top-level patched verbs (Value.BU1 always splits into view.BU1 +
// view.BI0, one of which is empty). To keep the cascade count aligned
// with user intent, we defer the cascade close to a microtask — any
// sibling top-level frame arriving synchronously extends the same
// cascade. flushPendingClose() commits eagerly when the public API
// asks (stop/report/clear), so callers don't need to await microtasks.
// snapshotValue(view) — best-effort deep clone of the source value at the
// moment we capture it. structuredClone fails on non-plain objects (DOM
// nodes, functions, etc.); fall back to a JSON round-trip and finally to
// the live ref if both fail. Snapshots are only captured when the recorder
// was started with { captureState: true } so this cost stays opt-in.
function snapshotValue(view) {
  const v = view?.value
  if (v === undefined || v === null) return v
  try { return structuredClone(v) } catch {}
  try { return JSON.parse(JSON.stringify(v)) } catch {}
  return v
}

export function enterCascadeFrame(view, verb) {
  if (!cascadeRecorders.size) return
  const t = performance.now()
  for (const r of cascadeRecorders.values()) {
    // Ancestry gates only the *start* of a cascade. Once a cascade is
    // open, every nested patched-verb call is captured — operator views
    // (FilterValue, LengthValue, etc.) are connected to the source via
    // sink subscription, not via the View .p chain, so ancestorOf would
    // exclude them mid-propagation. This way, "scope by root" means
    // "cascades triggered by mutating this subtree" — which transitively
    // reaches every operator chained off it.
    if (!r.current && r.root && !ancestorOf(view, r.root)) continue
    if (r.current && r.pendingClose) {
      // Sibling top-level call within the same task tick — extend.
      r.pendingClose = false
    }
    if (!r.current) {
      r.current = {
        id: r.nextCascadeId++,
        startedAt: t,
        totalMs: 0,
        frames: [],
        // state snapshot is populated only if the recorder was started
        // with captureState:true, and only at cascade close (Value's
        // verbs mutate the underlying value *before* dispatching to
        // patched View verbs, so a snapshot at enter would already
        // reflect the mutation — capturing at close gives the true
        // post-cascade state, which is what replay scrubbers need).
        state: undefined,
      }
      r.cascadeStartT = t
      r.stack = []
      r.rootView = view
    }
    const i = r.current.frames.length
    const parent = r.stack.length ? r.stack[r.stack.length - 1] : -1
    r.current.frames.push({
      i,
      parent,
      ctor: view.res?.constructor?.name || 'View',
      key: [...view.key],
      verb,
      startMs: t - r.cascadeStartT,
      endMs: -1,
    })
    r.stack.push(i)
  }
}

export function exitCascadeFrame(view, verb) {
  if (!cascadeRecorders.size) return
  const t = performance.now()
  for (const r of cascadeRecorders.values()) {
    // Symmetric with enter: only pop if our stack is open. Don't re-check
    // ancestry here — if enter pushed, exit must pop (the pair is bound
    // by the patched-verb's try/finally).
    if (!r.current || !r.stack.length) continue
    const i = r.stack.pop()
    const f = r.current.frames[i]
    f.endMs = t - r.cascadeStartT
    if (r.stack.length === 0) {
      // totalMs grows monotonically across coalesced top-level frames.
      if (f.endMs > r.current.totalMs) r.current.totalMs = f.endMs
      r.pendingClose = true
      // Capture r in the closure; the microtask is a no-op if a sibling
      // already cleared pendingClose (i.e. the cascade was extended).
      queueMicrotask(() => flushPendingClose(r))
    }
  }
}

export function flushPendingClose(r) {
  if (!r.pendingClose || !r.current) return
  r.pendingClose = false
  // Capture the post-cascade state, anchored to the cascade's root view.
  // This is what the Replay tab scrubber renders.
  if (r.opts?.captureState) {
    r.current.state = snapshotValue(r.rootView)
  }
  r.cascades.push(r.current)
  const cap = r.opts?.maxCascades ?? 200
  if (r.cascades.length > cap) r.cascades.splice(0, r.cascades.length - cap)
  r.current = null
  r.stack = null
  r.rootView = null
}

export function newProfileAcc() {
  return { events: 0, ms: 0, byOp: new Map(), byVerb: {} }
}

// Materialize a Report for the user. Sorted by totalMs descending so the
// hottest operator floats to the top of the printed table.
export function finalize(acc) {
  const byOperator = [...acc.byOp.values()]
    .map(b => ({ ...b, avgMs: b.count ? b.totalMs / b.count : 0 }))
    .sort((a, b) => b.totalMs - a.totalMs)
  return {
    totalEvents: acc.events,
    totalMs: acc.ms,
    byOperator,
    byVerb: { ...acc.byVerb },
  }
}
