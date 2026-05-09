// @ts-nocheck
import { Operator, createOperator } from '../../core.ts'

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
// Each verb override calls `super.<verb>` to keep the inherited Value
// semantics (mutating this.view.value and propagating to sinks); the only
// added work is the fn call. Order matters for BR1/BR2 — fn fires *before*
// super so the change record carries the value being removed; for the
// other verbs fn fires after so any normalization (e.g. BI0 may mint
// a random key for undefined `at`) is reflected in the record.
const sclone = d => structuredClone(d)

export class TapValue extends Operator {
  constructor(p, fn) {
    super()
    this.p = p
    this.fn = fn
    this.XU0(p.value)
  }

  XU0(value) {
    super.XU0(value)
    this.fn({ type: 'update', key: [], value: sclone(value) })
  }

  XR0() {
    if (this.view.value === undefined) return false
    const value = this.view.value
    super.XR0()
    this.fn({ type: 'remove', key: [], value: sclone(value) })
  }

  BU1(U1) {
    super.BU1(U1)
    for (let i = 0; i < U1.length; i += 2)
      this.fn({ type: 'update', key: [U1[i]], value: sclone(U1[i + 1]) })
  }

  BR1(R1) {
    for (let i = 0; i < R1.length; i += 2)
      this.fn({ type: 'remove', key: [R1[i]], value: sclone(R1[i + 1]) })
    super.BR1(R1)
  }

  BI0(I0) {
    super.BI0(I0)
    for (let i = 0; i < I0.length; i += 2)
      this.fn({ type: 'insert', key: [], value: sclone(I0[i + 1]), at: I0[i] })
  }

  BU2(U2) {
    super.BU2(U2)
    for (let i = 0; i < U2.length; i += 2)
      this.fn({ type: 'update', key: U2[i], value: sclone(U2[i + 1]) })
  }

  BR2(R2) {
    for (let i = 0; i < R2.length; i += 2)
      this.fn({ type: 'remove', key: R2[i], value: sclone(R2[i + 1]) })
    super.BR2(R2)
  }

  BI2(I2) {
    super.BI2(I2)
    for (let i = 0; i < I2.length; i += 3)
      this.fn({ type: 'insert', key: I2[i], value: sclone(I2[i + 1]), at: I2[i + 2] })
  }
}

export const tap = (source, fn) => createOperator(source, TapValue, fn)
