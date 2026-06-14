// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { spec } from '../../tests/spec.ts'
import { $, value } from '../../core.ts'
import { tap } from './index.ts'
import { filter } from '../filter/index.ts'
import { length } from '../length/index.ts'
import { sum } from '../aggregate/index.ts'

// Deterministic insert keys so insert-driven parity assertions are stable.
const max = (a, b) => a > b ? a : b
$.random = o => 1 + Object.keys(o).map(Number).sort().reduce(max, -1)

spec({ op:'tap', guarantee:'Fidelity', trigger:'edit/insert/remove', shape:'object', asserts:'the callback receives the initial and every downstream change record' }, () => {
  const data = $({ a: 1, b: 2 })
  const events = []
  const t = tap(data, e => events.push(e))
  data.a = 10
  data.c = 3
  delete data.b
  same(events, [
    { type: 'update', key: [],    value: { a: 1, b: 2 } },
    { type: 'update', key: ['a'], value: 10 },
    { type: 'insert', key: [],    value: 3, at: 'c' },
    { type: 'remove', key: ['b'], value: 2 },
  ])
  // tap is a passthrough — the underlying data (and tap's view) should match
  same(t[value], { a: 10, c: 3 })
})

spec({ op:'tap', guarantee:'Propagation', trigger:'insert', shape:'array', chain:'tap→filter→length', asserts:'a downstream operator sees the same events' }, () => {
  const data = $([{ done: false }, { done: true }, { done: false }])
  const taps = []
  const remaining = length(filter(tap(data, e => taps.push(e.type)), 'done', false))
  same(remaining[value], 2)
  data.insert({ done: false })
  same(remaining[value], 3)
  // tap recorded each upstream event (initial update, then insert)
  same(taps, ['update', 'insert'])
})

spec({ op:'tap', guarantee:'Fidelity', trigger:'edit', shape:'object', via:['BU2'], asserts:'a nested in-place edit reaches the callback as a deep record' }, () => {
  const data = $({ a: { x: 1 } })
  const events = []
  tap(data, e => events.push(e))
  data.a.x = 99
  same(events, [
    { type: 'update', key: [], value: { a: { x: 1 } } },
    { type: 'update', key: ['a', 'x'], value: 99 },
  ])
})

spec({ op:'tap', guarantee:'Efficiency', trigger:'edit', shape:'object', asserts:'a 0-arg fn takes the bare per-emit path with no record or clone' }, () => {
  // Bare tap exists for hot-path consumers that re-read the live proxy
  // value inside their callback (chart redraws, count textContent updates).
  // Skipping the structuredClone+record construction is the whole point —
  // verify that the fn fires synchronously after the value is updated, so
  // reading `data[value]` inside the callback returns post-mutation state.
  const data = $({ a: 1, b: 2 })
  let calls = 0
  let snapshot
  tap(data, () => { calls++; snapshot = data[value] })
  // Constructor fires the initial XU0 → fn() once.
  same(calls, 1)
  same(snapshot, { a: 1, b: 2 })
  data.a = 10
  same(calls, 2)
  same(snapshot.a, 10)
  data.c = 3                     // insert
  same(calls, 3)
  same(snapshot.c, 3)
  delete data.b                  // remove
  same(calls, 4)
  same('b' in snapshot, false)
})

spec({ op:'tap', guarantee:'Fidelity', trigger:'edit', shape:'object', asserts:'a 1-arg fn keeps the full record path, no silent downgrade' }, () => {
  // Strict 0-arity check is what makes the dispatch safe: anyone who
  // declared `(c) => ...` (length 1) still gets full change records. A
  // future minifier-driven param drop is the failure mode this guards
  // against, so we pin the dispatch with an explicit assertion.
  const data = $({ a: 1 })
  const records = []
  tap(data, (c) => records.push(c))
  data.a = 2
  same(records.length, 2)                       // initial + one update
  same(records[1], { type: 'update', key: ['a'], value: 2 })
})

// Regression: tap delegated to `super.<verb>`, which re-derived the delta off
// `this.view.value` — an alias of the source value the source had ALREADY
// mutated in place. So removes and same-key whole-row updates were dropped
// downstream (Value.BR1 saw the row already gone; Value.BU1 saw the value
// already equal), silently desyncing any operator chained after tap. The
// existing "downstream sees the same events" test only exercised an insert,
// which is why this shipped. Forwarding the handed delta via this.view.<verb>
// fixes it. These assert PARITY between a direct chain and a tap-interposed one
// across remove + whole-row replace, on both object and array sources.
function rows() { const o = {}; for (let i = 0; i < 5; i++) o[i] = { v: (i + 1) * 10, ok: i % 2 === 0 }; return $(o) }

spec({ op:'tap', guarantee:'Propagation', trigger:'remove/overwrite', shape:'object', chain:'tap→length/sum/filter', asserts:'a tap-interposed chain matches a direct chain through removes and overwrites' }, () => {
  const churn = s => { delete s[1]; s[3] = { v: 999, ok: true }; delete s[4]; s.insert({ v: 7, ok: true }) }

  const dSrc = rows(), tSrc = rows()
  const dLen = length(dSrc),               tLen = length(tap(tSrc, () => {}))
  const dSum = sum(dSrc, 'v'),             tSum = sum(tap(tSrc, () => {}), 'v')
  const dFil = filter(dSrc, r => r && r.ok), tFil = filter(tap(tSrc, () => {}), r => r && r.ok)
  churn(dSrc); churn(tSrc)
  same(tLen[value], dLen[value])           // was 5 vs 3 before the fix (removes dropped)
  same(tSum[value], dSum[value])           // was 150 vs … before the fix
  same(tFil[value], dFil[value])           // kept deleted rows before the fix
})

spec({ op:'tap', guarantee:'Fidelity', trigger:'insert/remove', shape:'array+object', asserts:'the change stream is byte-identical to the bare source' }, () => {
  // object source
  const bo = $({ 0: 10, 1: 20, 2: 30, 3: 40 }), to = $({ 0: 10, 1: 20, 2: 30, 3: 40 })
  const boC = bo.connect([]), toC = tap(to, () => {}).connect([])
  const seqO = s => { s.insert(50); delete s[1]; s.insert(60); s[0] = 99; delete s[2] }
  seqO(bo); seqO(to)
  same(toC, boC)

  // array source (positional removes carried wrong values + a phantom event before the fix)
  const ba = $([10, 20, 30, 40]), ta = $([10, 20, 30, 40])
  const baC = ba.connect([]), taC = tap(ta, () => {}).connect([])
  const seqA = s => { s.insert(50); delete s[1]; s.insert(60); s[0] = 99; delete s[2] }
  seqA(ba); seqA(ta)
  same(taC, baC)
})

// Regression (#57): tap picked its path by fn.length === 0, but a defaulted or
// destructured parameter reports length 0 — so `(c = {}) => …` was routed to
// the bare (no-args) path and never received the change record. Path selection
// is now by parameter PRESENCE (tapHasParam), so those take the full record path.
spec({ op:'tap', guarantee:'Robustness', trigger:'edit', shape:'object', issue:'#57', asserts:'a defaulted or destructured param still takes the record path' }, () => {
  const src = $({ a: 1 })
  let got
  tap(src, (c = { type: 'DEFAULT' }) => { got = c })
  src.a = 2
  same(got, { type: 'update', key: ['a'], value: 2 }) // not the default

  const s2 = $({ a: 1 })
  let dt
  tap(s2, ({ type } = {}) => { dt = type })
  s2.a = 5
  same(dt, 'update')

  // a genuinely parameterless fn still takes the bare path (fires per emit)
  const s3 = $({ a: 1 })
  let calls = 0
  tap(s3, () => { calls++ })
  s3.a = 9
  same(calls > 0, true)
})
