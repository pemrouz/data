// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { spec } from '../../tests/spec.ts'
import { $, value } from '../../core.ts'
import { to } from './index.ts'

spec({ op:'to', guarantee:'Fidelity', trigger:'edit/overwrite', shape:'object', asserts:'the scalar projection re-derives on nested edit, whole-row replace and overwrite' }, async () => {
  const res = $({ a: { b: 1 } })
  const result = to(res, r => r.a.b * 10)
  const changes = result.connect([])
  res.a.b = 2
  res.a = { b: 3 }
  res[value] = { a: { b: 4 } }
  same(changes, [
    { type: 'update', key: [], value: 10 },
    { type: 'update', key: [], value: 20 },
    { type: 'update', key: [], value: 30 },
    { type: 'update', key: [], value: 40 },
  ])
  same(result[value], 40)
})

spec({ op:'to', guarantee:'Fidelity', trigger:'edit', shape:'object', asserts:'a projection of a sub-view re-derives on edits to that sub-view' }, async () => {
  const res = $({ a: { b: 1 } })
  const result = to(res.a, a => a.b * 100)
  const changes = result.connect([])
  res.a.b = 2
  res.a = { b: 3 }
  same(changes, [
    { type: 'update', key: [], value: 100 },
    { type: 'update', key: [], value: 200 },
    { type: 'update', key: [], value: 300 },
  ])
  same(result[value], 300)
})

// ToValue.XU0's reference-equality short-circuit (`new_value === view.value`) is
// the contract that makes a `to` whose projection ignores field VALUES cheap: a
// real upstream BU2 reaches the operator, but if fn re-derives the SAME scalar
// the subscription stays silent. Pin it directly: field edits that leave the key
// count unchanged emit zero records; only a structural change that moves the
// count emits one.
spec({ op:'to', guarantee:'Efficiency', trigger:'edit', shape:'scalar', via:['XU0'], asserts:'a re-derive equal to the last value emits nothing; only a real change emits' }, () => {
  const res = $({ a: { x: 1 }, b: { x: 1 } })
  const out = to(res, d => Object.keys(d).length)
  const changes = out.connect([])
  same(changes, [{ type: 'update', key: [], value: 2 }])   // baseline
  res.a.x = 9                          // BU2 reaches `to`; count still 2 — short-circuit
  res.b.x = 7                          // another no-count-change edit
  same(changes.length, 1)              // still just the baseline — no redundant records
  res.c = { x: 1 }                     // count 2 → 3: a real change
  same(changes, [
    { type: 'update', key: [], value: 2 },
    { type: 'update', key: [], value: 3 },
  ])
})

// Clearing the whole source (XR0) re-derives fn(undefined). With a guarded
// projection this yields a defined scalar and emits a single update — no crash,
// no churn. Clearing from a NON-empty state (2 → 0) so the short-circuit doesn't
// swallow it (clearing from already-0 would be a silent no-op asserting nothing).
spec({ op:'to', guarantee:'Robustness', trigger:'remove', shape:'scalar', via:['XR0'], asserts:'clearing the source re-derives the guarded projection to a defined scalar with one update' }, () => {
  const res = $({ a: 1, b: 2 })
  const out = to(res, r => r ? Object.keys(r).length : 0)
  const ch = out.connect([])
  same(out[value], 2)
  delete res[value]                    // XR0 → fn(undefined) → guard → 0
  same(out[value], 0)
  same(ch, [
    { type: 'update', key: [], value: 2 },
    { type: 'update', key: [], value: 0 },
  ])
})
