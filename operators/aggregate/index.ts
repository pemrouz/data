// @ts-nocheck
import { iter } from '../../utils.ts'
import { Operator, createOperator } from '../../core.ts'

// Common per-row tracking for scalar aggregates. `tracked[name]` holds the
// projected column value for each row currently included in the source;
// undefined entries are removed from `tracked` rather than stored as
// `undefined`, so `Object.values(this.tracked)` never includes holes.
//
// Subclass contract:
//   _afterReset()      — called after XU0/XR0 has rebuilt `tracked` wholesale.
//                        Recompute aggregate state from scratch and publish.
//   _delta(old, new)   — called on every BU1/BR1/BI0 entry, where `old`/`new`
//                        is the row's projected value before/after the change
//                        (undefined means "not in the set"). Use to maintain
//                        a running aggregate.
//   _publish()         — called once after each batch (BU1/BR1/BI0/BU2/...).
//                        Emit XU0 with the current aggregate scalar.
//
// Sum/avg use `_delta` for O(1) running totals; max/min ignore `_delta` and
// recompute O(n) in `_publish` since a removed maximum can't be derived
// from a delta alone.
class AggregateValue extends Operator {
  constructor(p, col) {
    super()
    this.p = p
    this.col = col
    this.read = col ? (r => r?.[col]) : (r => r)
    this.tracked = {}
    this.XU0(p.value)
  }

  matches(col) { return this.col === col }

  _project(v) {
    if (v === undefined) return undefined
    const x = this.read(v)
    return x === undefined || x === null ? undefined : x
  }

  XR0() {
    this.tracked = {}
    this._afterReset()
  }

  XU0(value) {
    this.tracked = {}
    if (value && typeof value === 'object') {
      iter(value, (n, v) => {
        const x = this._project(v)
        if (x !== undefined) this.tracked[n] = x
      })
    }
    this._afterReset()
  }

  BU1(U1) {
    if (!U1.length) return
    let dirty = false
    for (let i = 0; i < U1.length; i += 2) {
      const n = U1[i]
      const old = this.tracked[n]
      const x = this._project(U1[i + 1])
      if (x === undefined) delete this.tracked[n]
      else this.tracked[n] = x
      if (x !== old) { this._delta(old, x); dirty = true }
    }
    if (dirty) this._publish()
  }

  BR1(R1) {
    if (!R1.length) return
    let dirty = false
    for (let i = 0; i < R1.length; i += 2) {
      const n = R1[i]
      const old = this.tracked[n]
      if (old === undefined) continue
      delete this.tracked[n]
      this._delta(old, undefined)
      dirty = true
    }
    if (dirty) this._publish()
  }

  BI0(I0) {
    if (!I0.length) return
    let dirty = false
    for (let i = 0; i < I0.length; i += 2) {
      const n = I0[i]
      const x = this._project(I0[i + 1])
      if (x === undefined) continue
      this.tracked[n] = x
      this._delta(undefined, x)
      dirty = true
    }
    if (dirty) this._publish()
  }

  // Nested-key changes: re-project the affected row from p.value, then run
  // the same delta/publish pipe. Saves the subclass from caring about depth.
  BU2(U2) { this._reprojectFromKeys(U2, 2) }
  BR2(R2) { this._reprojectFromKeys(R2, 2) }
  BI2(I2) { this._reprojectFromKeys(I2, 3) }

  _reprojectFromKeys(arr, stride) {
    if (!arr.length) return
    let dirty = false
    for (let i = 0; i < arr.length; i += stride) {
      const path = arr[i]
      const n = path[0]
      const old = this.tracked[n]
      const x = this._project(this.p.value[n])
      if (x === undefined) delete this.tracked[n]
      else this.tracked[n] = x
      if (x !== old) { this._delta(old, x); dirty = true }
    }
    if (dirty) this._publish()
  }

  _afterReset() {}
  _delta() {}
  _publish() {}
}

// Sum: running total, O(1) per delta.
export class SumValue extends AggregateValue {
  // Note: `total` is intentionally not a class field — class fields
  // initialize *after* super() returns, which would overwrite the value
  // computed by _afterReset during construction.
  _afterReset() {
    this.total = 0
    for (const v of Object.values(this.tracked)) this.total += +v
    this._publish()
  }
  _delta(o, n) {
    if (o !== undefined) this.total -= +o
    if (n !== undefined) this.total += +n
  }
  _publish() {
    if (this.total !== this.view.value) this.view.XU0(this.view.value = this.total)
  }
}

// Average: running total + count, O(1) per delta. Empty set → undefined
// (rather than 0/0 = NaN), matching the "no data" idiom used elsewhere.
export class AvgValue extends AggregateValue {
  _afterReset() {
    this.total = 0; this.count = 0
    for (const v of Object.values(this.tracked)) { this.total += +v; this.count++ }
    this._publish()
  }
  _delta(o, n) {
    if (o !== undefined) { this.total -= +o; this.count-- }
    if (n !== undefined) { this.total += +n; this.count++ }
  }
  _publish() {
    const v = this.count === 0 ? undefined : this.total / this.count
    if (v !== this.view.value) this.view.XU0(this.view.value = v)
  }
}

// Max/Min: O(n) per publish. The simple-correct version. For 50k-row
// crossfilter brushing this is ~50k comparisons per frame which fits the
// 16ms budget; if it ever doesn't, swap in a sorted multiset.
export class MaxValue extends AggregateValue {
  _afterReset() { this._publish() }
  _publish() {
    let m
    for (const v of Object.values(this.tracked)) if (m === undefined || v > m) m = v
    if (m !== this.view.value) this.view.XU0(this.view.value = m)
  }
}

export class MinValue extends AggregateValue {
  _afterReset() { this._publish() }
  _publish() {
    let m
    for (const v of Object.values(this.tracked)) if (m === undefined || v < m) m = v
    if (m !== this.view.value) this.view.XU0(this.view.value = m)
  }
}

export const sum = (source, col) => createOperator(source, SumValue, col)
export const avg = (source, col) => createOperator(source, AvgValue, col)
export const max = (source, col) => createOperator(source, MaxValue, col)
export const min = (source, col) => createOperator(source, MinValue, col)
