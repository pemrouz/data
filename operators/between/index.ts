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
    if (this.sortedDirty) this._resort()
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

    // NB: a *point* range (new_lo === new_hi) is NOT special-cased to empty.
    // Bounds are inclusive on both ends, so `[v, v]` selects rows with
    // `col === v` — exactly what a fresh `between(col, [v, v])` yields and what
    // the incremental walk below produces (narrow-high keeps `col === new_hi`,
    // narrow-low keeps `col === new_lo`). The old collapse-to-empty shortcut
    // contradicted the constructor and dropped the boundary rows when a reactive
    // bound was narrowed down to a single value.
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
    // Over an ARRAY source a row crossing a bound is a HOLE event, not a splice:
    // we set value[ti]=undefined / value[ti]=tv in place, keeping the array
    // length stable so sibling sources stay index-aligned (intersect). Emit
    // BF0/BH1 so positional sinks mirror the hole instead of shifting. Object
    // sources have stable keys, so the plain BI0/BR1 path is correct there.
    if (I0.length) this.isArr ? this.view.BF0(I0) : this.view.BI0(I0)
    if (R1.length) this.isArr ? this.view.BH1(R1) : this.view.BR1(R1)
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
      // Skip holes: when between sits DOWNSTREAM of a sparse producer
      // (filter/map/between/…) its upstream array carries `undefined` slots for
      // excluded rows. Treat them as absent — don't index them and don't let
      // the comparator deref them.
      if (v === undefined) return
      this.sorted.push(''+i)
      if (v[col] >= this.lo_val && v[col] <= this.hi_val)
        new_value[i] = value[i]
    })

    this.sorted.sort((a, b) => {
      const va = value[a]?.[col]
      const vb = value[b]?.[col]
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
  // changed. `name` may or may not currently be in `sorted`/view; we emit
  // BU1/BI0/BR1 based on the before/after membership and mark the sorted
  // index dirty. The dirty flag is honoured the next time `set extent`
  // runs (which is rare relative to BU2 ticks — bounds change on user
  // brush, attribute updates happen on every data tick) so each BU2 stays
  // O(1) instead of paying O(N) splice + indexOf to maintain `sorted`.
  _replaceRow(name, row, newCol) {
    const wasIn = this.view.value[name] !== undefined
    const isIn = this._inRange(newCol)
    if (wasIn && isIn) {
      this.view.value[name] = row
      this.view.BU1([name, row])
    } else if (!wasIn && isIn) {
      this.view.value[name] = row
      // Over an array this fills a hole in place (no shift) — emit BF0 so
      // positional sinks fill rather than splice-insert; objects use BI0.
      this.isArr ? this.view.BF0([name, row]) : this.view.BI0([name, row])
    } else if (wasIn && !isIn) {
      const oldVal = this.view.value[name]
      if (this.isArr) {
        // Mark the slot a hole (length stable, siblings stay index-aligned) and
        // emit BH1 so positional sinks hole rather than splice-shift.
        this.view.value[name] = undefined
        this.view.BH1([name, oldVal])
      } else {
        delete this.view.value[name]
        this.view.BR1([name, oldVal])
      }
    }

    this.sortedDirty = true
    this.lo_index = undefined
    this.hi_index = undefined
  }

  // Rebuild `sorted` from the current `p.value`. Called lazily by
  // `set extent` when `sortedDirty` is set — amortizes the cost of many
  // BU2/BU1 attribute updates into a single O(N log N) sort that fires
  // only when the user actually brushes new bounds.
  _resort() {
    const v = this.p.value
    if (!v || typeof v !== 'object') return
    this.sorted = []
    iter(v, (i, row) => { if (row !== undefined) this.sorted.push('' + i) })
    const col = this.col
    this.sorted.sort((a, b) => {
      const va = v[a]?.[col]
      const vb = v[b]?.[col]
      return va > vb ? 1 : va < vb ? -1 : 0
    })
    this.sortedDirty = false
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

  // Insert/remove DEFER `sorted` maintenance via the same dirty-flag
  // amortization `_replaceRow` (BU2/BU1) already uses. `sorted` is read ONLY by
  // `set extent`, which calls `_resort()` when `sortedDirty` is set — so an
  // insert/remove only needs the membership decision (lo_val/hi_val, not
  // `sorted`) plus the view.value write, then marks `sorted` dirty. A stream of
  // inserts/removes between two brushes is therefore O(1) each (object:
  // dropping the O(N) indexOf+splice; array: dropping the O(N) key-shift loop
  // and the O(N²) batch-remove key-shift recompute) instead of O(N) per row.
  // The next brush pays one O(N log N) `_resort` — the births/deaths workload
  // (object-keyed population, frequent inserts/removes, occasional brush). For
  // arrays the view.value splice that mirrors the source's positional shift is
  // inherent to arrays and remains O(N); only the redundant sorted bookkeeping
  // is shed. (Dropping the old `sortedDirty → coarse XU0` bailout is safe: it
  // existed solely to stop the now-removed incremental sorted maintenance from
  // double-counting against a stale `sorted`; with no incremental maintenance
  // there's nothing to double-count, so insert/remove after an in-place edit
  // now emit incremental BI0/BR1 rather than a coarse resnapshot.)
  BI0(I0) {
    if (this.view.value === this.p.value) return this.view.BI0(I0)

    const NI0 = []
    for (let i = 0; i < I0.length; i += 2) {
      const at = I0[i]
      const row = I0[i + 1]
      const colVal = row?.[this.col]
      // Array source: the source already spliced p.value at `at` (shifting
      // every later position); mirror that into our sparse view.value so
      // positions stay index-aligned. Object keys are stable — no splice.
      if (this.isArr) this.view.value.splice(+at, 0, undefined)
      if (this._inRange(colVal)) {
        this.view.value[at] = row
        NI0.push(at, row)
      }
    }
    this.sortedDirty = true
    this.lo_index = undefined
    this.hi_index = undefined
    if (NI0.length) this.view.BI0(NI0)
  }

  BR1(R1) {
    if (this.view.value === this.p.value) return this.view.BR1(R1)

    const NR1 = []
    for (let i = 0; i < R1.length; i += 2) {
      const name = R1[i]
      const oldVal = this.view.value[name]
      if (this.isArr) {
        // Splice the view in lockstep with the source's array shift. ALWAYS
        // emit the splice (even a holed slot, oldVal===undefined): a downstream
        // row op keeps a parallel array and must splice the same position or its
        // layout drifts one slot per holed-row removal (a surviving row becomes
        // a ghost). The [name, oldVal] pair carries the removal at that position.
        this.view.value.splice(name, 1)
        NR1.push(name, oldVal)
      } else if (oldVal !== undefined) {
        delete this.view.value[name]
        NR1.push(name, oldVal)
      }
    }
    this.sortedDirty = true
    this.lo_index = undefined
    this.hi_index = undefined
    if (NR1.length) this.view.BR1(NR1)
  }

  // Consumer-side hole/fill: when between sits downstream of another sparse
  // producer (filter/map/between/…), a row entering/leaving the UPSTREAM view
  // arrives as BF0/BH1 (hole fill / hole remove — no array shift). Treat them
  // as membership transitions WITHOUT splicing: the position is stable, only
  // its occupancy changed. Mark `sorted` dirty so the next bound move rebuilds
  // it (skipping holes), and forward BH1/BF0 so our own positional sinks mirror.
  BH1(R1) {
    if (this.view.value === this.p.value) return this.view.BH1(R1)
    const NR1 = []
    for (let i = 0; i < R1.length; i += 2) {
      const name = R1[i]
      const oldVal = this.view.value[name]
      if (oldVal !== undefined) { this.view.value[name] = undefined; NR1.push(name, oldVal) }
    }
    this.sortedDirty = true
    this.lo_index = undefined
    this.hi_index = undefined
    if (NR1.length) this.view.BH1(NR1)
  }

  BF0(I0) {
    if (this.view.value === this.p.value) return this.view.BF0(I0)
    const NF0 = []
    for (let i = 0; i < I0.length; i += 2) {
      const name = I0[i]
      const row = this.p.value[name]
      if (row !== undefined && this._inRange(row[this.col])) {
        this.view.value[name] = row
        NF0.push(name, row)
      }
    }
    this.sortedDirty = true
    this.lo_index = undefined
    this.hi_index = undefined
    if (NF0.length) this.view.BF0(NF0)
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
