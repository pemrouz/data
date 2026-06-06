// @ts-nocheck
import { iter } from '../../utils.ts'
import { $, Operator, createOperator } from '../../core.ts'

// Order-insensitive, float-tolerant structural compare used ONLY by the
// `$.debug` symmetry check below — never on a hot path. Numbers compare with a
// relative epsilon so benign floating-point drift between an incremental
// subtract and a fresh add doesn't false-positive.
const _approxEqual = (a, b) =>
  a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
const _deepEqual = (a, b) => {
  if (a === b) return true
  const ta = typeof a
  if (ta !== typeof b) return false
  if (ta === 'number') return _approxEqual(a, b) || (Number.isNaN(a) && Number.isNaN(b))
  if (a && b && ta === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    for (let i = 0; i < ka.length; i++) {
      const k = ka[i]
      if (!Object.prototype.hasOwnProperty.call(b, k) || !_deepEqual(a[k], b[k])) return false
    }
    return true
  }
  return false
}

// `proxy.reduce(fn, init)` folds the source's rows through `fn(acc, row, key)`
// starting from `init`, exposing the result as a scalar reactive view.
//
//   data.reduce((acc, row) => acc + row.amount, 0)   // total amount
//   data.reduce((acc, row, k) => `${acc} ${k}=${row}`, '')   // formatted
//
// For commutative numeric aggregates (sum, count, min/max, avg) prefer the
// dedicated operators in operators/aggregate/ — they're O(1) per delta.
// `reduce` rebuilds from scratch on every upstream event because in the
// general case `fn` is non-commutative (string concatenation, object
// merging) and there's no safe way to "undo" a contribution.
//
// 3-arg form `reduce(add, remove, init)` opts into an incremental fold —
// dispatched to ReduceIncrementalValue below.
export class ReduceValue extends Operator {
  constructor(p, fn, init) {
    super()
    this.p = p
    this.fn = fn
    this.init = init
    this._rebuild()
  }

  matches(fn, init) { return this.fn === fn && this.init === init }

  _rebuild() {
    let acc = this.init
    const v = this.p.value
    if (v && typeof v === 'object') {
      iter(v, (k, row) => {
        if (row === undefined) return
        acc = this.fn(acc, row, k)
      })
    }
    if (acc !== this.view.value) this.view.XU0(this.view.value = acc)
  }

  XR0() { this._rebuild() }
  XU0() { this._rebuild() }
  BU1() { this._rebuild() }
  BR1() { this._rebuild() }
  BI0() { this._rebuild() }
  BU2() { this._rebuild() }
  BR2() { this._rebuild() }
  BI2() { this._rebuild() }
}

// `proxy.reduce(add, remove, init)` — incremental fold. The caller supplies
// both directions explicitly, signalling "my fold is invertible by row" so
// inserts/removes can thread through O(Δ) instead of triggering a full
// rebuild. This is the general primitive crossfilter-shaped workloads want
// when `length(fn)` (count-by-bucket) isn't expressive enough — bucketed
// sums, percentile sketches, top-K per group, anything where each row
// contributes a known delta to the accumulator.
//
//   const totalByBucket = source.intersect(dims, 'delay').reduce(
//     (acc, row) => { const k = bucket(row); acc[k] = (acc[k]||0) + row.x; return acc },
//     (acc, row) => { const k = bucket(row); if ((acc[k] -= row.x) === 0) delete acc[k]; return acc },
//     () => ({}),
//   )
//
// `init` may be a value or a thunk: a thunk is called once per full rebuild
// (XU0/XR0) so a fold that mutates its accumulator in place (the common
// case for histograms) starts from a fresh object each time the source
// resets. Plain-value init is fine for primitives.
//
// Limitations — opt out by sticking with the 2-arg form when these bite:
//   • BU1/BU2 (row mutated in place) → falls back to full rebuild, since
//     the framework doesn't preserve the old value at those entry points
//     and there's no safe way to "undo" the prior contribution without it.
//     Filter-driven workloads (intersect/between emitting BR1/BI0 as rows
//     enter/leave the active set) never hit this path; it's a fallback for
//     direct-on-source use where rows themselves change in place.
//   • `remove` must invert `add`'s contribution for the row passed to it,
//     using only the row + key — same contract as crossfilter's
//     group.reduce(add, remove, init). Forgetting symmetry desyncs `acc`
//     silently; a unit test that round-trips insert+remove catches it. Set
//     `$.debug = true` during development to turn the silent desync loud: after
//     every incremental delta the fold is recomputed from scratch and compared
//     to the running accumulator, warning on the first drift (O(N) per delta,
//     so off by default — a dev aid, not a runtime guard).
export class ReduceIncrementalValue extends Operator {
  constructor(p, add, remove, init) {
    super()
    this.p = p
    this.add = add
    this.remove = remove
    this.init = init
    this._rebuild()
  }

  matches(add, remove, init) {
    return this.add === add && this.remove === remove && this.init === init
  }

  _seed() {
    return typeof this.init === 'function' ? this.init() : this.init
  }

  // Dev-only symmetry check (see the class comment): re-fold from scratch and
  // compare to the incremental accumulator. A mismatch means `remove` didn't
  // invert `add` for some row. Gated behind `$.debug` because the re-fold is
  // O(N) per delta — it exists to make the silent-desync trap catchable.
  _verify(where) {
    if (!$.debug) return
    let truth = this._seed()
    const v = this.p.value
    if (v && typeof v === 'object') iter(v, (k, row) => {
      if (row === undefined) return
      truth = this.add(truth, row, k)
    })
    if (!_deepEqual(truth, this.view.value) && typeof console !== 'undefined')
      console.warn(
        '[data] reduce(add, remove, init): the incremental accumulator drifted ' +
        `from a fresh fold after ${where}. The usual cause is a \`remove\` that ` +
        "doesn't exactly invert `add` for a row (the symmetry contract).",
        '\n  incremental =', this.view.value, '\n  fresh fold  =', truth)
  }

  _rebuild() {
    let acc = this._seed()
    const v = this.p.value
    if (v && typeof v === 'object') {
      iter(v, (k, row) => {
        if (row === undefined) return
        acc = this.add(acc, row, k)
      })
    }
    this.view.XU0(this.view.value = acc)
  }

  XR0() { this._rebuild() }
  XU0() { this._rebuild() }

  BI0(I0) {
    if (!I0.length) return
    let acc = this.view.value
    for (let i = 0; i < I0.length; i += 2) {
      const v = I0[i + 1]
      if (v === undefined) continue
      acc = this.add(acc, v, I0[i])
    }
    this.view.XU0(this.view.value = acc)
    this._verify('BI0')
  }

  BR1(R1) {
    if (!R1.length) return
    let acc = this.view.value
    for (let i = 0; i < R1.length; i += 2) {
      const v = R1[i + 1]
      // RowOperator over an array emits [name, undefined] for shift-only
      // events (see LengthValue.BR1) — the row was already excluded
      // upstream so there's no contribution to remove. Same guard here.
      if (v === undefined) continue
      acc = this.remove(acc, v, R1[i])
    }
    this.view.XU0(this.view.value = acc)
    this._verify('BR1')
  }

  // BU1: row's slot was overwritten with a new value, but the framework
  // doesn't carry the old value at this entry point. Rebuild is the
  // semantically safe fallback. Crossfilter-shaped workloads (rows
  // immutable, filters mutate) don't hit this path.
  BU1() { this._rebuild() }
  BU2() { this._rebuild() }
  BR2() { this._rebuild() }
  BI2() { this._rebuild() }
}

// Standalone helper. `typeof remove === 'function'` is the dispatch key —
// mirror it in full.ts so chainable and standalone forms agree.
export const reduce = (source, fnOrAdd, removeOrInit, init) =>
  typeof removeOrInit === 'function'
    ? createOperator(source, ReduceIncrementalValue, fnOrAdd, removeOrInit, init)
    : createOperator(source, ReduceValue, fnOrAdd, removeOrInit)
