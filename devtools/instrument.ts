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
  cascadeRecorders,
  dispatchTrace,
  enterProfile,
  exitProfile,
  enterCascadeFrame,
  exitCascadeFrame,
} from './events.ts'

const originals = new Map()
let installed = false

function hasActive() {
  return traceTargets.size > 0 || profilers.size > 0 || cascadeRecorders.size > 0
}

export function ensureInstrumented() {
  if (installed) return
  for (const verb of VERBS) {
    const orig = View.prototype[verb]
    if (typeof orig !== 'function') continue
    originals.set(verb, orig)
    View.prototype[verb] = function patched(...args) {
      if (!hasActive()) return orig.apply(this, args)
      // Trace dispatch first — it's a read-only observation. Then enter
      // the timed paths for profile and/or cascade recorder.
      if (traceTargets.size) dispatchTrace(this, verb, args[0])
      const profOn = profilers.size > 0
      const cascOn = cascadeRecorders.size > 0
      if (!profOn && !cascOn) return orig.apply(this, args)
      if (profOn) enterProfile()
      if (cascOn) enterCascadeFrame(this, verb)
      const t0 = performance.now()
      try { return orig.apply(this, args) }
      finally {
        const dt = performance.now() - t0
        if (cascOn) exitCascadeFrame(this, verb)
        if (profOn) exitProfile(this, verb, dt)
      }
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
