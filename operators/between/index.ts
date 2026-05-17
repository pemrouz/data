// @ts-nocheck
import { isArray, iter, left, right } from '../../utils.ts'
import { $, Operator, ViewProxy, createOperator } from '../../core.ts'

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
    // `findHi` is the right-bisect variant — see `set extent` for why
    // hi_index needs "first sorted-position past hi_val" rather than "at".
    this.find = left(d => { return this.p.value[d][col] })
    this.findHi = right(d => { return this.p.value[d][col] })

    // Three flavours of arg: a single ViewProxy that yields `[lo, hi]`
    // snapshots, a tuple of two separately-reactive bounds, or a tuple of
    // plain numbers. Plain values are wrapped in $() so the connect machinery
    // is uniform — the wrapped proxy is captured-once and never updated.
    if (arg instanceof ViewProxy) {
      arg.connect(this, 'extent')
    } else {
      this._loSrc = arg[0] instanceof ViewProxy ? arg[0] : $(arg[0])
      this._hiSrc = arg[1] instanceof ViewProxy ? arg[1] : $(arg[1])
      this._loSrc.connect(this, 'lo')
      this._hiSrc.connect(this, 'hi')
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
    //
    // Convention: lo_index is the first sorted-position with col >= lo_val
    // (i.e. first in-view row on the low side); hi_index is the first
    // sorted-position with col > hi_val (first *out-of-view* row past the
    // high side). The asymmetry matches what the narrow/widen loops below
    // leave behind after running. Initialising hi_index via the left-bisect
    // would land it ON the boundary row instead of past it, dropping the
    // boundary row whenever a widen happens to terminate exactly on an
    // existing row's col-value.
    this.lo_index ??= this.find(this.sorted, this.lo_val)
    this.hi_index ??= this.findHi(this.sorted, this.hi_val)

    // The four directions of bound motion. Each loop walks `sorted` from
    // the current boundary index toward the new one, emitting one event
    // per row crossed. `tv = p.value[ti]` is the row at that sorted slot;
    // we test its `col` against the new bound to know when to stop. Bounds
    // are inclusive on both ends, so the widen branches use `<=` / `>=`
    // against the new bound to pull the boundary row in.
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
        (tv[this.col] <= new_hi)
      ) {
        this.hi_index++
        I0.push(ti, tv)
        this.view.value[ti] = tv
      }
    }

    if (new_lo < this.lo_val) {
      while (
        (tv = this.p.value[ti = this.sorted[this.lo_index - 1]]) &&
        (tv[this.col] >= new_lo)
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
    this.isArr = isArray(value)
    const new_value = this.isArr ? [] : {}
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

  // ─── Source-mutation handlers ─────────────────────────────────────────────
  // The bound-walk in `set extent` relies on `sorted` being current and on
  // `lo_index`/`hi_index` matching the bounds. These handlers keep `sorted`
  // synced with source mutations and invalidate the cached indexes — the
  // next bound change recomputes them lazily via the `??=` in `set extent`.
  //
  // Unfilter mode (view.value aliases source) is a fast path: every row is
  // trivially in range, so we don't need to fork or maintain membership —
  // we just relay the upstream verb to our sinks.

  _inRange(v) { return v >= this.lo_val && v <= this.hi_val }

  // Membership transition for a single row whose row-value or col-value
  // changed. `name` may or may not currently be in `sorted`/view; we
  // re-position it in `sorted` and emit BU1/BI0/BR1 based on the
  // before/after membership.
  _replaceRow(name, row, newCol) {
    const oidx = this.sorted.indexOf(name)
    if (oidx !== -1) this.sorted.splice(oidx, 1)
    const nidx = this.find(this.sorted, newCol)
    this.sorted.splice(nidx, 0, name)

    const wasIn = this.view.value[name] !== undefined
    const isIn = this._inRange(newCol)
    if (wasIn && isIn) {
      this.view.value[name] = row
      this.view.BU1([name, row])
    } else if (!wasIn && isIn) {
      this.view.value[name] = row
      this.view.BI0([name, row])
    } else if (wasIn && !isIn) {
      const oldVal = this.view.value[name]
      if (this.isArr) this.view.value[name] = undefined
      else delete this.view.value[name]
      this.view.BR1([name, oldVal])
    }

    this.lo_index = undefined
    this.hi_index = undefined
  }

  BU1(U1) {
    if (this.view.value === this.p.value) return this.view.BU1(U1)
    for (let i = 0; i < U1.length; i += 2) {
      const name = U1[i]
      const row = U1[i + 1]
      this._replaceRow(name, row, row?.[this.col])
    }
  }

  BU2(U2) {
    if (this.view.value === this.p.value) return this.view.BU2(U2)
    for (let i = 0; i < U2.length; i += 2) {
      const key = U2[i]
      const value = U2[i + 1]
      const [name, ...rest] = key
      if (rest.length && rest[0] === this.col) {
        // The sort-column changed for this row — re-evaluate membership.
        // We pass the full row (post-update) because `_replaceRow` writes
        // it into view.value when the row is/becomes in-range.
        const row = this.p.value?.[name]
        if (row !== undefined) this._replaceRow(name, row, value)
      } else if (this.view.value[name] !== undefined) {
        // Deep update on a different field; forward unchanged but only if
        // the row is currently in view. (Otherwise the sink doesn't know
        // about the row and a BU2 referencing it would be confusing.)
        this.view.BU2([key, value])
      }
    }
  }

  BI0(I0) {
    if (this.view.value === this.p.value) return this.view.BI0(I0)

    // Array source: a non-end insert at position `at` shifts every existing
    // upstream key >= at up by one. We have to translate `sorted` and the
    // sparse `view.value` to match before we can place the new row.
    if (this.isArr) {
      for (let i = 0; i < I0.length; i += 2) {
        const atNum = +I0[i]
        if (atNum >= this.sorted.length) continue  // pure end-push, no shift
        for (let j = 0; j < this.sorted.length; j++) {
          const k = +this.sorted[j]
          if (k >= atNum) this.sorted[j] = '' + (k + 1)
        }
        // splice the view at `at` to mirror the source's splice; the new
        // slot is filled below if the row is in range.
        this.view.value.splice(atNum, 0, undefined)
      }
    }

    const NI0 = []
    for (let i = 0; i < I0.length; i += 2) {
      const at = I0[i]
      const row = I0[i + 1]
      const colVal = row?.[this.col]
      const nidx = this.find(this.sorted, colVal)
      this.sorted.splice(nidx, 0, at)
      if (this._inRange(colVal)) {
        this.view.value[at] = row
        NI0.push(at, row)
      }
    }
    this.lo_index = undefined
    this.hi_index = undefined
    if (NI0.length) this.view.BI0(NI0)
  }

  BR1(R1) {
    if (this.view.value === this.p.value) return this.view.BR1(R1)

    const NR1 = []
    const removedKeys = this.isArr ? [] : null
    for (let i = 0; i < R1.length; i += 2) {
      const name = R1[i]
      const oldVal = this.view.value[name]
      const oidx = this.sorted.indexOf(name)
      if (oidx !== -1) this.sorted.splice(oidx, 1)
      if (this.isArr) {
        removedKeys.push(+name)
        // Splice the view in lockstep with the source's array shift; if
        // the row was in view its slot disappears, otherwise the hole at
        // that position disappears (which is what we want).
        this.view.value.splice(name, 1)
        if (oldVal !== undefined) NR1.push(name, oldVal)
      } else if (oldVal !== undefined) {
        delete this.view.value[name]
        NR1.push(name, oldVal)
      }
    }

    if (this.isArr && removedKeys.length) {
      removedKeys.sort((a, b) => a - b)
      // Shift remaining `sorted` keys to match the post-splice source.
      for (let i = 0; i < this.sorted.length; i++) {
        const k = +this.sorted[i]
        let shift = 0
        for (const r of removedKeys) { if (r < k) shift++; else break }
        if (shift) this.sorted[i] = '' + (k - shift)
      }
    }

    this.lo_index = undefined
    this.hi_index = undefined
    if (NR1.length) this.view.BR1(NR1)
  }

  BR2(R2) {
    if (this.view.value === this.p.value) return this.view.BR2(R2)
    for (let i = 0; i < R2.length; i += 2) {
      const key = R2[i]
      const value = R2[i + 1]
      const [name] = key
      if (this.view.value[name] !== undefined) this.view.BR2([key, value])
    }
  }

  BI2(I2) {
    if (this.view.value === this.p.value) return this.view.BI2(I2)
    for (let i = 0; i < I2.length; i += 3) {
      const key = I2[i]
      const value = I2[i + 1]
      const at = I2[i + 2]
      const [name] = key
      if (this.view.value[name] !== undefined) this.view.BI2([key, value, at])
    }
  }
}

export const between = (source, col, arg) => createOperator(source, BetweenValue, col, arg)
