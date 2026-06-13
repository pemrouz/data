// @ts-nocheck
import { iter, isArray } from '../../utils.ts'
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
//   • BU2 (a NESTED field edited in place, `data[k].f = x`) → falls back to
//     full rebuild. The row object's reference is unchanged, so the per-key
//     value cache (below) holds the already-mutated row — there's no pre-edit
//     value to subtract. Filter-driven workloads (intersect/between emitting
//     BR1/BI0 as rows enter/leave the active set) never hit this path.
//   • BU1 (a whole slot overwritten, `data[k] = newRow`) IS incremental: the
//     overwrite changes the slot reference, so a per-key cache of the last-seen
//     row recovers the OLD row and the fold does remove(old) + add(new) in
//     O(Δ). The cache stores the row REFERENCE (no clone), so it adds no cost
//     to the insert/remove-driven crossfilter path (those rows are immutable).
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
    // Per-key last-seen row, so a BU1 whole-slot overwrite can subtract the
    // prior contribution (remove(old) + add(new)) without a full rebuild.
    // Keyed by STRING: `iter` yields numeric keys for arrays but BU1 carries
    // string keys, so normalize at every touch or the lookup silently misses
    // on array sources (→ only `add` runs → desync). Stores references, not
    // clones, so it's O(1) per insert and free for immutable-row workloads.
    this._cache = new Map()
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
    this._cache.clear()
    const v = this.p.value
    if (v && typeof v === 'object') {
      iter(v, (k, row) => {
        if (row === undefined) return
        acc = this.add(acc, row, k)
        this._cache.set('' + k, row)
      })
    }
    this.view.XU0(this.view.value = acc)
  }

  XR0() { this._rebuild() }
  XU0() { this._rebuild() }

  BI0(I0) {
    if (!I0.length) return
    // Array structural insert: the source splice shifted every later position,
    // so the position-keyed `_cache` is now off-by-one and a later BU1 would
    // recover the wrong old row (silent accumulator drift). Rebuild to re-key it
    // — exactly what AggregateValue / LengthFnValue do for the same reason. The
    // incremental thread stays for object sources (stable keys) and for the
    // BF0/BH1 membership churn the incremental path targets.
    if (isArray(this.p.value)) return this._rebuild()
    let acc = this.view.value
    for (let i = 0; i < I0.length; i += 2) {
      const v = I0[i + 1]
      if (v === undefined) continue
      acc = this.add(acc, v, I0[i])
      this._cache.set('' + I0[i], v)
    }
    this.view.XU0(this.view.value = acc)
    this._verify('BI0')
  }

  BR1(R1) {
    if (!R1.length) return
    if (isArray(this.p.value)) return this._rebuild()   // array splice shifts positions — see BI0
    let acc = this.view.value
    for (let i = 0; i < R1.length; i += 2) {
      const v = R1[i + 1]
      // RowOperator over an array emits [name, undefined] for shift-only
      // events (see LengthValue.BR1) — the row was already excluded
      // upstream so there's no contribution to remove. Same guard here.
      if (v === undefined) continue
      acc = this.remove(acc, v, R1[i])
      this._cache.delete('' + R1[i])
    }
    this.view.XU0(this.view.value = acc)
    this._verify('BR1')
  }

  // BU1: a slot was overwritten in place (`data[k] = newRow`). The
  // notification carries only the new value, but the per-key cache holds the
  // OLD row (a whole-slot overwrite changes the reference, so cached ≠ new),
  // so subtract its contribution then add the new one — O(Δ), no rebuild.
  // Value.BU1 routes brand-new keys to BI0, so BU1 only ever sees keys that
  // were already present; the cache hit is guaranteed for any row that
  // contributed (a fresh fold + every BI0 seeds it). The `!== undefined`
  // guard is against the *cache miss*, so a present-but-falsy row (value `0`)
  // is still correctly subtracted.
  BU1(U1) {
    if (!U1.length) return
    let acc = this.view.value
    for (let i = 0; i < U1.length; i += 2) {
      const key = '' + U1[i]
      const next = U1[i + 1]
      const prev = this._cache.get(key)
      if (prev !== undefined) acc = this.remove(acc, prev, U1[i])
      if (next !== undefined) { acc = this.add(acc, next, U1[i]); this._cache.set(key, next) }
      else this._cache.delete(key)
    }
    this.view.XU0(this.view.value = acc)
    this._verify('BU1')
  }

  // BU2: a NESTED field of an existing row was edited in place
  // (`data[k].f = x`). The row reference is unchanged, so the cache already
  // holds the mutated row — there's no pre-edit value to subtract. Rebuild
  // (which also re-seeds the cache, keeping BU1 consistent afterwards).
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
