import { Operator, createOperator } from '../../core.ts'
import type { Data } from '../../core.ts'

// Does `fn` declare ANY parameter (even a defaulted or destructured one)?
// `fn.length` excludes parameters with defaults and rest/destructuring, so
// `(change = {}) => …` reports length 0 and was wrongly routed to the bare
// (no-args) tap path — the callback then saw its default on every event and
// the real change record was never delivered. Source inspection catches the
// defaulted/destructured cases the arity count misses (and is robust against
// minification: a USED param — defaulted or not — is never dropped).
export function tapHasParam(fn: any) {
  if (typeof fn !== 'function') return false
  if (fn.length > 0) return true
  const s = Function.prototype.toString.call(fn)
  // bare single-identifier arrow: `x => …` / `async x => …`
  if (/^\s*(?:async\s+)?[A-Za-z_$][\w$]*\s*=>/.test(s)) return true
  // first parenthesised parameter list has any content (`(c = {})`, `({k})`, …)
  const m = s.match(/\(([^)]*)\)/)
  return !!(m && m[1].trim() !== '')
}

// `proxy.tap(fn)` is a passthrough operator that calls `fn(change)` on every
// event flowing through it AND propagates the same event downstream. Used
// for declarative side effects in a chain (logging, persistence, debug):
//
//   items.tap(persist).filter('done', false).length()
//
// Equivalent to `connect(obj, fn)` but inline — keep the returned ViewProxy
// alive the same way you'd keep any operator alive (the receiving side of
// the chain anchors it). Drop the chain and the tap unsubscribes silently.
//
// Change records match the `connect(obj, fn)` shape:
//   { type: 'update'|'insert'|'remove', key, value, at? }
// — see ArrSink/FunctionSink in core.ts for the canonical event vocabulary.
//
// Propagation: each batched verb FORWARDS the delta it was handed straight to
// `this.view.<verb>` (the same View-level fan-out every operator uses to emit
// downstream), then fires `fn`. It must NOT delegate to `super.<verb>` (the
// inherited Value verbs): tap aliases `this.view.value` to the source's value
// object (Operator.XU0 does `this.view.value = value`, same reference), and the
// source mutates that object IN PLACE *before* notifying us — so a Value verb
// re-deriving the delta off `this.view.value` reads the already-applied state
// and DROPS it (Value.BR1 sees the row already gone → `continue`; same-key
// Value.BU1 sees the value already equal → skip), silently desyncing any
// downstream operator/DOM sink. Forwarding the handed delta is correct because
// the source already computed it and view.value (the alias) already reflects it.
// (This also avoids routing a stride-2 sink-shaped BR2 through Value.BR2, which
// expects a stride-1 keypath list and would throw `key.slice is not a function`
// on a group→tap relocate.) XU0/XR0 still go through super — they OWN the
// view.value (re)assignment. Order: fn fires before forward for BR1/BR2 (the
// record carries the leaving value), after for the others.
const sclone = (d: any) => structuredClone(d)

export class TapValue extends Operator {
  declare fn: (change?: any) => any
  constructor(p: any, fn: (change?: any) => any) {
    super()
    this.p = p
    this.fn = fn
    this.XU0(p.value)
  }

  XU0(value?: any) {
    super.XU0(value)
    this.fn({ type: 'update', key: [], value: sclone(value) })
  }

  XR0() {
    if (this.view.value === undefined) return false
    const value = this.view.value
    super.XR0()
    this.fn({ type: 'remove', key: [], value: sclone(value) })
  }

  BU1(U1: any) {
    this.view.BU1(U1)
    for (let i = 0; i < U1.length; i += 2)
      this.fn({ type: 'update', key: [U1[i]], value: sclone(U1[i + 1]) })
  }

  BR1(R1: any) {
    for (let i = 0; i < R1.length; i += 2)
      this.fn({ type: 'remove', key: [R1[i]], value: sclone(R1[i + 1]) })
    this.view.BR1(R1)
  }

  BI0(I0: any) {
    this.view.BI0(I0)
    for (let i = 0; i < I0.length; i += 2)
      this.fn({ type: 'insert', key: [], value: sclone(I0[i + 1]), at: I0[i] })
  }

  BU2(U2: any) {
    this.view.BU2(U2)
    for (let i = 0; i < U2.length; i += 2)
      this.fn({ type: 'update', key: U2[i], value: sclone(U2[i + 1]) })
  }

  BR2(R2: any) {
    for (let i = 0; i < R2.length; i += 2)
      this.fn({ type: 'remove', key: R2[i], value: sclone(R2[i + 1]) })
    this.view.BR2(R2)
  }

  BI2(I2: any) {
    this.view.BI2(I2)
    for (let i = 0; i < I2.length; i += 3)
      this.fn({ type: 'insert', key: I2[i], value: sclone(I2[i + 1]), at: I2[i + 2] })
  }

  // Move events: in-window rank rotations from sort/za/limit. The
  // `connect(obj, fn)` sink (FunctionSink) reports these as
  // `{ type: 'move', from, to }`; tap mirrors the convention so consumers
  // see the same vocabulary regardless of which sink they use.
  BMV1(M1: any) {
    this.view.BMV1(M1)
    for (let i = 0; i < M1.length; i += 2)
      this.fn({ type: 'move', from: +M1[i], to: +M1[i + 1] })
  }
}

// "Bare" variant: when the supplied fn takes no arguments, the caller is
// signalling "I don't read the change record, just tell me something
// happened" — typically because the callback re-reads the live view value
// directly (`proxy[value]`). Two wins versus TapValue:
//   • no structuredClone of the change value (the big one for object/array
//     payloads — bucket maps, top-K arrays).
//   • no per-row record construction in batched verbs: BU1/BU2/BR1/BR2/BI0/
//     BI2 fire fn ONCE per emit, not once per pair. This collapses
//     histogram-bucket batches (one BU2 with N bucket updates → one redraw)
//     to a single fn call.
// Same lifetime semantics as TapValue — keep the returned view alive (e.g.
// stashed in a chains array) and the tap stays subscribed. Don't use this
// if your callback inspects which key changed or needs the change record
// shape — use TapValue (the default) instead.
export class TapBareValue extends Operator {
  declare fn: () => any
  constructor(p: any, fn: () => any) {
    super()
    this.p = p
    this.fn = fn
    this.XU0(p.value)
  }

  XU0(value?: any) { super.XU0(value); this.fn() }
  XR0() {
    if (this.view.value === undefined) return false
    super.XR0()
    this.fn()
  }
  BU1(U1: any) { this.view.BU1(U1); this.fn() }
  BR1(R1: any) { this.view.BR1(R1); this.fn() }
  BI0(I0: any) { this.view.BI0(I0); this.fn() }
  BU2(U2: any) { this.view.BU2(U2); this.fn() }
  BR2(R2: any) { this.view.BR2(R2); this.fn() }
  BI2(I2: any) { this.view.BI2(I2); this.fn() }
  BMV1(M1: any) { this.view.BMV1(M1); this.fn() }
}

// The standalone `tap(source, fn)` form mirrors the dispatch in full.ts:
// 0-arg fn → TapBareValue (no clone, fires per emit), otherwise TapValue.
// So `tap(src, () => redraw())` is cheap whether you reach for it via the
// chainable proxy method or the standalone helper.
export const tap = <T>(source: Data<T>, fn: any): Data<T> =>
  createOperator(source, tapHasParam(fn) ? TapValue : TapBareValue, fn)
