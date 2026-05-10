// @ts-nocheck
import { iter } from '../../utils.ts'
import { Operator, createOperator } from '../../core.ts'

// Common per-row tracking for scalar aggregates. `tracked.get(name)` returns
// the projected column value for each row currently included in the source;
// rows whose projection is undefined are removed from the Map rather than
// stored, so `tracked.values()` never yields undefined.
//
// `tracked` is a Map (not a plain object) so per-publish iteration via
// `tracked.values()` walks the Map's internal storage directly without
// allocating a fresh values array — `Object.values()` was the dominant
// per-tick allocation in the previous implementation. See
// experiments/wasm/README.md for the measurement that motivated the switch.
//
// Subclass contract:
//   _afterReset()           — called after XU0/XR0 has rebuilt `tracked`
//                             wholesale. Recompute aggregate state from
//                             scratch and publish.
//   _delta(old, new, key)   — called on every BU1/BR1/BI0 entry; `old`/`new`
//                             is the row's projected value before/after the
//                             change (undefined means "not in the set"),
//                             `key` is the source row name. Use to maintain
//                             a running aggregate. Subclasses that don't
//                             care about the key just ignore it.
//   _publish()              — called once after each batch (BU1/BR1/BI0/...).
//                             Emit XU0 with the current aggregate scalar.
//
// Sum/avg/some/every use `_delta` for O(1) running totals/counts; max/min
// can't derive a running aggregate from old/new alone (a removed maximum
// re-opens the question), so they maintain a parallel `Float64Array` keyed
// by `key` and let `_publish` scan it in a tight loop. See MaxValue.
class AggregateValue extends Operator {
  // `col` is the dedup key (string column name, fn reference, etc.). `read`
  // is the per-row projector, defaulting to row[col] when col is a string,
  // identity when col is undefined; subclasses with a custom projection
  // (some/every — `r => !!fn(r)`) pass an explicit read function.
  constructor(p, col, read) {
    super()
    this.p = p
    this.col = col
    this.read = read || (typeof col === 'string' ? (r => r?.[col]) : (r => r))
    this.tracked = new Map()
    this.XU0(p.value)
  }

  matches(col) { return this.col === col }

  _project(v) {
    if (v === undefined) return undefined
    const x = this.read(v)
    return x === undefined || x === null ? undefined : x
  }

  XR0() {
    this.tracked.clear()
    this._afterReset()
  }

  XU0(value) {
    this.tracked.clear()
    if (value && typeof value === 'object') {
      iter(value, (n, v) => {
        const x = this._project(v)
        // Coerce keys to strings: notifications (BU1/BR1/BI0) carry stringified
        // names regardless of source shape, so the Map's get/set/delete must
        // see the same form for both XU0 init and incremental updates. The
        // previous plain-object `tracked` coerced implicitly; Map does not.
        if (x !== undefined) this.tracked.set('' + n, x)
      })
    }
    this._afterReset()
  }

  BU1(U1) {
    if (!U1.length) return
    let dirty = false
    for (let i = 0; i < U1.length; i += 2) {
      const n = U1[i]
      const old = this.tracked.get(n)
      const x = this._project(U1[i + 1])
      if (x === undefined) this.tracked.delete(n)
      else this.tracked.set(n, x)
      if (x !== old) { this._delta(old, x, n); dirty = true }
    }
    if (dirty) this._publish()
  }

  BR1(R1) {
    if (!R1.length) return
    let dirty = false
    for (let i = 0; i < R1.length; i += 2) {
      const n = R1[i]
      const old = this.tracked.get(n)
      if (old === undefined) continue
      this.tracked.delete(n)
      this._delta(old, undefined, n)
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
      this.tracked.set(n, x)
      this._delta(undefined, x, n)
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
      const old = this.tracked.get(n)
      const x = this._project(this.p.value[n])
      if (x === undefined) this.tracked.delete(n)
      else this.tracked.set(n, x)
      if (x !== old) { this._delta(old, x, n); dirty = true }
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
    for (const v of this.tracked.values()) this.total += +v
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
    for (const v of this.tracked.values()) { this.total += +v; this.count++ }
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

// Max/Min: O(n) per publish. Maintains a parallel `Float64Array` (`fast`)
// indexed by a `key→slot` map, so `_publish` scans contiguous f64 memory in
// a tight loop instead of iterating the `tracked` Map. Roughly 5× quicker
// per element on V8 for 50k+ row sources.
//
// The fast path only runs when every observed projected value is a finite
// number. The first non-numeric (Date, string, null, NaN, ±Infinity) flips
// `numericMode` to false; from that point the operator falls back to the
// `tracked.values()` scan. This preserves the `max(arr, 'date')` use case
// where the operator must return the original Date instance, and is sticky
// within a snapshot — a wholesale data swap (XU0/XR0) re-evaluates and may
// re-enter fast mode.
//
// On remove, the slot is zeroed to a sentinel (-Infinity for max,
// +Infinity for min) and pushed to `freeSlots`; the sentinel never wins
// the comparison, so the scan range `[0, nextSlot)` may include freed
// slots without affecting the answer. Inserts reuse from `freeSlots`
// before extending `nextSlot`.
class FastNumericAggregate extends AggregateValue {
  _afterReset() {
    this._buildFast()
    this._publish()
  }

  _buildFast() {
    this.numericMode = true
    this.slotMap = new Map()
    this.freeSlots = []
    this.nextSlot = 0
    let cap = 64
    while (cap < this.tracked.size) cap *= 2
    this.fast = new Float64Array(cap)
    for (const [k, v] of this.tracked) {
      if (typeof v !== 'number' || !Number.isFinite(v)) { this._abandonFast(); return }
      const slot = this.nextSlot++
      this.fast[slot] = v
      this.slotMap.set(k, slot)
    }
  }

  _abandonFast() {
    this.numericMode = false
    this.fast = null
    this.slotMap = null
    this.freeSlots = null
    this.nextSlot = 0
  }

  _delta(_old, x, key) {
    if (!this.numericMode) return
    if (x !== undefined && (typeof x !== 'number' || !Number.isFinite(x))) {
      this._abandonFast(); return
    }
    if (x === undefined) {
      const slot = this.slotMap.get(key)
      if (slot === undefined) return
      this.slotMap.delete(key)
      this.fast[slot] = this._sentinel
      this.freeSlots.push(slot)
      return
    }
    let slot = this.slotMap.get(key)
    if (slot === undefined) {
      slot = this.freeSlots.length ? this.freeSlots.pop() : this.nextSlot++
      if (slot >= this.fast.length) {
        let cap = this.fast.length
        while (cap < slot + 1) cap *= 2
        const next = new Float64Array(cap)
        next.set(this.fast)
        this.fast = next
      }
      this.slotMap.set(key, slot)
    }
    this.fast[slot] = x
  }
}

export class MaxValue extends FastNumericAggregate {
  get _sentinel() { return -Infinity }
  _publish() {
    if (this.tracked.size === 0) {
      if (this.view.value !== undefined) this.view.XU0(this.view.value = undefined)
      return
    }
    let m
    if (this.numericMode) {
      const arr = this.fast
      m = arr[0]
      for (let i = 1; i < this.nextSlot; i++) {
        const v = arr[i]
        if (v > m) m = v
      }
    } else {
      for (const v of this.tracked.values()) if (m === undefined || v > m) m = v
    }
    if (m !== this.view.value) this.view.XU0(this.view.value = m)
  }
}

export class MinValue extends FastNumericAggregate {
  get _sentinel() { return Infinity }
  _publish() {
    if (this.tracked.size === 0) {
      if (this.view.value !== undefined) this.view.XU0(this.view.value = undefined)
      return
    }
    let m
    if (this.numericMode) {
      const arr = this.fast
      m = arr[0]
      for (let i = 1; i < this.nextSlot; i++) {
        const v = arr[i]
        if (v < m) m = v
      }
    } else {
      for (const v of this.tracked.values()) if (m === undefined || v < m) m = v
    }
    if (m !== this.view.value) this.view.XU0(this.view.value = m)
  }
}

// some/every: short-circuit booleans. Each row's projection is `!!fn(row)`;
// the operator tracks how many tracked rows are truthy and publishes a
// scalar bool. Empty set semantics match Array.prototype: some=false,
// every=true (vacuous truth). The fn is passed as both the dedup key (so
// `data.some(fn)` twice with the same fn returns the same view) and the
// custom read; AggregateValue's machinery does the rest.
export class SomeValue extends AggregateValue {
  constructor(p, fn) { super(p, fn, r => !!fn(r)) }
  _afterReset() {
    this.trueCount = 0
    for (const v of this.tracked.values()) if (v) this.trueCount++
    this._publish()
  }
  _delta(o, n) {
    if (o === true) this.trueCount--
    if (n === true) this.trueCount++
  }
  _publish() {
    const v = this.trueCount > 0
    if (v !== this.view.value) this.view.XU0(this.view.value = v)
  }
}

export class EveryValue extends AggregateValue {
  constructor(p, fn) { super(p, fn, r => !!fn(r)) }
  _afterReset() {
    // Track total tracked rows and how many are truthy. `every` is true iff
    // all tracked rows are truthy. Empty set → true (matches Array#every).
    this.totalCount = 0
    this.trueCount = 0
    for (const v of this.tracked.values()) {
      this.totalCount++
      if (v) this.trueCount++
    }
    this._publish()
  }
  _delta(o, n) {
    if (o !== undefined) {
      this.totalCount--
      if (o === true) this.trueCount--
    }
    if (n !== undefined) {
      this.totalCount++
      if (n === true) this.trueCount++
    }
  }
  _publish() {
    const v = this.trueCount === this.totalCount
    if (v !== this.view.value) this.view.XU0(this.view.value = v)
  }
}

export const sum   = (source, col) => createOperator(source, SumValue, col)
export const avg   = (source, col) => createOperator(source, AvgValue, col)
export const max   = (source, col) => createOperator(source, MaxValue, col)
export const min   = (source, col) => createOperator(source, MinValue, col)
export const some  = (source, fn)  => createOperator(source, SomeValue, fn)
export const every = (source, fn)  => createOperator(source, EveryValue, fn)
