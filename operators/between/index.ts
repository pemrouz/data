// @ts-nocheck
import { isArray, iter, left } from '../../utils.ts'
import { Operator, ViewProxy, createOperator } from '../../core.ts'

// BetweenValue is the range filter. The user calls `data.between('col', [lo,
// hi])` typically with reactive bounds (a brush rectangle on a chart) — the
// operator sorts the source by `col` once at construction, then on every
// bound change walks only the rows whose `col` value crossed the new
// boundary, emitting per-row BI0/BR1 rather than a full XU0. That keeps the
// crossfilter example responsive at >1M rows even when the user is dragging.
export class BetweenValue extends Operator {
  // Dedup helper — when two charts brush over the same column with the same
  // bounds, share a single Between sink.
  matches(col, [lo, hi]) {
    return this.col === col && this.plo === lo && this.phi === hi
  }

  constructor(p, col, arg) {
    super()
    this.p = p
    this.col = col
    this.plo = arg[0]
    this.phi = arg[1]
    this.sorted = []
    // `sorted` holds source keys ordered by col-value. `find` does the
    // O(log n) bisect that lets us advance lo_index/hi_index incrementally.
    this.find = left(d => { return this.p.value[d][col] })

    // Two flavours of reactive arg: a single ViewProxy that yields
    // `[lo, hi]` snapshots, or a tuple of two separately-reactive bounds.
    if (arg instanceof ViewProxy) {
      arg.connect(this, 'extent')
    } else {
      arg[0].connect(this, 'lo')
      arg[1].connect(this, 'hi')
    }
    this.XU0(p.value)
  }

  // Single-bound setters auto-sort so lo always ends up ≤ hi. This is what
  // keeps the resize handles working when the user drags one past the other.
  set lo(v){
    this.extent = v > this.hi_val
      ? [this.hi_val, v]
      : [v, this.hi_val]
  }

  set hi(v){
    this.extent = v < this.lo_val
      ? [v, this.lo_val]
      : [this.lo_val, v]
  }

  // Whole-extent setter — the hot path. Each branch handles one of the
  // common bound transitions:
  //   • full domain (-∞, ∞) → unfiltered, share the source array directly
  //   • collapsed (lo === hi) → empty result
  //   • shrink/expand → walk sorted from the old boundary to the new one and
  //     emit incremental BI0/BR1 events instead of resnapshotting.
  // The `value === p.value` check is the unfilter fast path: when we
  // previously aliased the source we have to fork it before mutating, or our
  // `value[ti] = undefined` writes would hit the user's data.
  set extent([a = -Infinity, b = Infinity]){
    a = +a
    b = +b
    const new_lo = a < b ? a : b
    const new_hi = a < b ? b : a
    if (!this.view.value)
      return [this.lo_val, this.hi_val] = [new_lo, new_hi]

    if (new_lo === -Infinity && new_hi === Infinity) {
      this.hi_index = this.lo_index = undefined;
      [this.lo_val, this.hi_val] = [new_lo, new_hi]
      return this.view.XU0(this.view.value = this.p.value)
    }

    if (new_lo === new_hi) {
      this.hi_index = this.lo_index = undefined;
      [this.lo_val, this.hi_val] = [new_lo, new_hi]
      return this.view.XU0(this.view.value = isArray(this.p.value) ? [] : {})
    }

    if (this.view.value === this.p.value) {
      this.view.value = isArray(this.p.value) ? [...this.p.value] : {...this.p.value}
    }
    const I0 = [], R1 = []
    // lo/hi_index are the bisect positions of the current bounds in `sorted`.
    // First-pass after a fast-path reset they're undefined; recompute lazily.
    this.lo_index ??= this.find(this.sorted, this.lo_val)
    this.hi_index ??= this.find(this.sorted, this.hi_val)

    // The four directions of bound motion. Each loop walks `sorted` from
    // the current boundary index toward the new one, emitting one event
    // per row crossed. `tv = p.value[ti]` is the row at that sorted slot;
    // we test its `col` against the new bound to know when to stop.
    let ti, tv
    if (new_hi < this.hi_val) {
      while (
        (tv = this.p.value[ti = this.sorted[this.hi_index - 1]]) &&
        (tv[this.col] > new_hi)
      ) {
        this.hi_index--
        R1.push(ti, tv)
        this.view.value[ti] = undefined
      }
      if (this.lo_index > this.hi_index) this.lo_index = this.hi_index
    }

    if (new_lo > this.lo_val) {
      while (
        (tv = this.p.value[ti = this.sorted[this.lo_index]]) &&
        (tv[this.col] < new_lo)
      ) {
        this.lo_index++
        R1.push(ti, tv)
        this.view.value[ti] = undefined
      }
      if (this.hi_index < this.lo_index) this.hi_index = this.lo_index
    }

    if (new_hi > this.hi_val) {
      while (
        (tv = this.p.value[ti = this.sorted[this.hi_index]]) &&
        (tv[this.col] < new_hi)
      ) {
        this.hi_index++
        I0.push(ti, tv)
        this.view.value[ti] = tv
      }
    }

    if (new_lo < this.lo_val) {
      while (
        (tv = this.p.value[ti = this.sorted[this.lo_index - 1]]) &&
        (tv[this.col] > new_lo)
      ) {
        this.lo_index--
        I0.push(ti, tv)
        this.view.value[ti] = tv
      }
    }

    this.lo_val = new_lo
    this.hi_val = new_hi
    if (I0.length) this.view.BI0(I0)
    if (R1.length) this.view.BR1(R1)
  }

  // Whole-source replacement: rebuild `sorted` and seed `new_value` with
  // rows already inside the bounds. The bound indexes are wiped so the next
  // `extent` setter recomputes them from scratch (cheaper than tracking
  // them through this rebuild).
  XU0(value) {
    const { col } = this
    this.lo_index = undefined
    this.hi_index = undefined
    if (typeof value !== 'object') return super.XU0()
    const new_value = isArray(value) ? [] : {}
    this.sorted = []
    iter(value, (i, v) => {
      this.sorted.push(''+i)
      if (v[col] >= this.lo_val && v[col] <= this.hi_val)
        new_value[i] = value[i]
    })

    this.sorted.sort((a, b) => {
      const va = value[a][col]
      const vb = value[b][col]
      return va > vb ? 1
           : va < vb ? -1
           : 0
    })
    super.XU0(new_value)
  }
}

export const between = (source, col, arg) => createOperator(source, BetweenValue, col, arg)
