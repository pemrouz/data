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
