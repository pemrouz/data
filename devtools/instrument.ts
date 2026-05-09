// @ts-nocheck
// Monkey-patches View.prototype verb methods so trace/profile listeners
// in events.ts can observe every notification. ensureInstrumented() is
// idempotent and gated by a fast-out: with no active listeners, the
// patched method's only added cost is one boolean check + an `apply`.
import { View } from '../core.ts'
import {
  VERBS,
  traceTargets,
  profilers,
  dispatchTrace,
  enterProfile,
  exitProfile,
} from './events.ts'

const originals = new Map()
let installed = false

function hasActive() {
  return traceTargets.size > 0 || profilers.size > 0
}

export function ensureInstrumented() {
  if (installed) return
  for (const verb of VERBS) {
    const orig = View.prototype[verb]
    if (typeof orig !== 'function') continue
    originals.set(verb, orig)
    View.prototype[verb] = function patched(...args) {
      if (!hasActive()) return orig.apply(this, args)
      // Trace dispatch first — it's a read-only observation. Then time
      // the original call for the profiler.
      if (traceTargets.size) dispatchTrace(this, verb, args[0])
      if (profilers.size) {
        enterProfile()
        const t0 = performance.now()
        try { return orig.apply(this, args) }
        finally { exitProfile(this, verb, performance.now() - t0) }
      }
      return orig.apply(this, args)
    }
  }
  installed = true
}

export function restoreInstrumentation() {
  if (!installed) return
  for (const [verb, orig] of originals) {
    View.prototype[verb] = orig
  }
  originals.clear()
  installed = false
}

export function isInstrumented() { return installed }
