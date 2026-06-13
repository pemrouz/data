// @ts-nocheck
import { isArray, iter } from '../../utils.ts'
import { Operator, view, reactive, createOperator } from '../../core.ts'

// A dims-style object: plain object (not a ViewProxy, not an array) whose
// values are the source ViewProxies to intersect. Used by the
// crossfilter-shaped overloads `intersect(dims)` and `intersect(dims, key)`.
const isDims = (v) =>
  v != null && typeof v === 'object' && !v[reactive] && !isArray(v)

// IntersectValue keeps rows that exist in *all* connected sources. Each
// source gets a unique bit; `filters[name]` is the mask of which sources
// currently hold the row, and a row only enters the output when `bits ===
// all` (every bit set). The bitmask form is what makes intersect cheap with
// many sources — the all-bits-set check is O(1) per row regardless of how
// many sources we're intersecting over (typical crossfilter case: 4–8 brush
// dimensions).
//
// Three argument shapes are supported, all collapsed to the same list of
// source views before construction proceeds:
//   `intersect(viewA, viewB, ...)` — variadic, the original form
//   `intersect(dims)`              — plain object whose values are views
//   `intersect(dims, 'key')`       — leave-one-out: every value of dims
//                                    except `dims[key]`
// The dims-form pair is the crossfilter pattern: name dimensions once, then
// each chart asks for "all dimensions except mine". Identity-based dedup
// (matches() below) means repeated calls with the same `(dims, key)` reuse
// the same operator view.
//
// `vp` retains the first source so `this.p.value[name]` stays the canonical
// row identity (downstream sees rows from the primary source even when
// secondary sources have a divergent view of the same key).
//
// ── Tried-and-didn't-pay-off: shared bitmask across sibling intersects ──
// A `SharedMembership` keyed by `dims` was prototyped (and reverted) to
// fold the N independent bitmask tables — one per sibling
// `intersect(dims, kX)` — into a single shared table. The idea: walk the
// boundary rows once for any dim source change, then fan out (oldBits,
// newBits) tuples to each subscriber so each does an O(1) visibility
// check per affected row. Measured on a 4-leave-one-out × 1000-row
// churn synthetic, this was ~16% **slower** than the per-instance
// variadic baseline. Mechanism: the per-row N×K filter updates the
// shared approach removes are paid back (and then some) by allocating
// a 3K-entry tuples buffer per emit and iterating it N times. A
// popcount filter on tuples (skip rows nowhere near any subscriber's
// mask) might tilt it the other way, but the savings ceiling is ≤20%
// on this shape — the real headroom to crossfilter parity lives in
// fusing intersect with the downstream reducer step, not in deduping
// the membership table. Documented here so the same refactor isn't
// re-tried blindly. Implementation lives in git history if someone
// wants to pick up the popcount-filtered variant.
export class IntersectValue extends Operator {
  constructor(p, ...args) {
    super()
    this._args = args

    // Normalize the args into a flat list of source ViewProxies.
    let sources
    if (args.length === 1 && isDims(args[0])) {
      sources = Object.values(args[0])
    } else if (args.length === 2 && isDims(args[0]) && typeof args[1] === 'string') {
      const [dims, except] = args
      sources = Object.entries(dims).filter(([k]) => k !== except).map(([, v]) => v)
    } else {
      sources = args
    }

    this.vp = sources[0]
    this.p = p
    // The primary source gets bit 0 implicitly; each additional source gets
    // the next bit position. `off` precomputes the bit-clear mask so the hot
    // path can do `bits & off` instead of `bits & ~one` every iteration.
    this.sources = new Map([[p, { one: 1, off: ~ 1 }]])
    this.all = 1
    for (const src of sources) {
      const v = src[view]
      // Skip a duplicate or self source. `a.intersect(b, b)` and `a.intersect(a)`
      // are idempotent (intersecting with the same set twice, or with self),
      // but the old code keyed `sources` by view yet OR'd `all` per argument:
      // the duplicate's entry overwrote the first (or the primary's) while `all`
      // still demanded the discarded bit, so `bits === all` was unsatisfiable and
      // the view was permanently, silently empty. Deduping by view makes these
      // collapse to the intended set.
      if (this.sources.has(v)) continue
      const one = 1 << this.sources.size
      src.connect(this)
      this.sources.set(v, { one, off: ~one })
      this.all |= one
    }

    if (typeof p.value !== 'object') { super.XU0(); return }
    const new_value = isArray(this.p.value) ? [] : {}
    this.filters = isArray(this.p.value) ? [] : {}
    iter(p.value, (i, v) => {
      for (const [res, src] of this.sources) {
        // `res.value[i] !== undefined`, NOT `i in res.value`: between/union/
        // except leave EXPLICIT `undefined` at excluded slots (the key is
        // present), so `i in` would count an excluded row as a member and
        // wrongly admit it. The incremental XU0/BI0 paths already use the
        // `!== undefined` test — the constructor seeding was the outlier.
        if (res.value[i] !== undefined) this.filters[i] |= src.one
      }
      if (this.filters[i] === this.all) new_value[i] = v
    })
    this.view.XU0(this.view.value = new_value)
  }

  // ── Array structural insert / remove (C12) ───────────────────────────────
  // Core routes an ARRAY source's positional insert/remove through BI0A/BR1A
  // (object sources keep the BI0/BR1 _enter/_leave path above, untouched). A
  // splice shifts every later index, so the per-index `filters` bitmask and the
  // sparse `view.value` MUST splice in lockstep or our index space drifts from
  // the (shifting) sources and every later positional event hits the wrong slot
  // — the C12 array desync. The object _leave/_enter path's `delete`/named-set
  // never shifts, which is correct for stable object keys but wrong for array
  // positions.

  // STRUCTURAL REMOVE. `this.p` is the canonical index space ("`this.p.value[name]`
  // stays the canonical row identity"). Only a removal from the PRIMARY shifts
  // that space, so only the primary echo splices `filters`/`view.value`. A
  // removal reported by a SECONDARY source is a membership change at a stable
  // position — the row left THAT source but the primary's index space didn't
  // move — so it routes to the by-name `_leave` (clear the bit, hole the slot if
  // it drops below `all`), exactly the object path. This split is what keeps two
  // INDEPENDENT arrays' intersect correct (only one shifts) while a DERIVED
  // crossfilter-style removal (every source echoes; the primary splices last —
  // see below) reconciles to one clean delete.
  //
  // Echo order in the DERIVED case: the secondaries hole their slot first
  // (emitting the real remove), then the primary splices the now-holed slot out
  // (oldVal === undefined → no phantom second remove) and the survivor below it
  // slides up. (`union`/`except` have their own primary ordering — handled in
  // their files.)
  BR1A(R1, v) {
    if (v !== this.p) return this._leave(R1, v, true)
    const NR1 = []
    for (let i = 0; i < R1.length; i += 2) {
      const at = R1[i]
      const oldVal = this.view.value[at]
      this.filters.splice(at, 1)
      this.view.value.splice(at, 1)
      // ALWAYS emit the positional splice, even for a pre-holed slot
      // (oldVal === undefined): the primary remove shifts every survivor below
      // it, so a downstream POSITIONAL consumer (map/filter/sort, or a DOMSink
      // bound to this view) must splice the same index or its layout drifts one
      // slot per holed-row removal. Position-agnostic record sinks skip the
      // undefined-valued pair (no phantom remove). Matches between.BR1 /
      // RowOperator.BR1 array handling. (C12 closure: the splice was applied
      // internally but never communicated.)
      NR1.push(at, oldVal)
    }
    if (NR1.length) this.view.BR1(NR1)
  }

  // STRUCTURAL INSERT (tail). Each source self-reports ITS membership bit for the
  // new position from the carried value: a real row sets the bit, a hole
  // (`undefined` — the positional insert an array RowOperator emits for a slot
  // its predicate excluded) CLEARS it. The bug this fixes (C12 intersect2) was
  // the object _enter path setting the bit unconditionally for that hole. Bits
  // accumulate across echoes order-independently (we never read other sources —
  // mid-cascade they may not have shifted); the new tail slot grows `filters`
  // and `view.value` naturally. Mid-array inserts into an array set-algebra
  // source are not supported (not shipped-reachable: the underlying mutation is
  // always a tail append or a delete).
  BI0A(I0, v) {
    const { one, off } = this.sources.get(v)
    const NI0 = []
    // A MID-array insert shifts every later source position, so the per-index
    // `filters` bitmask and `view.value` must splice a fresh cell in lockstep or
    // they drift one slot per interior insert (a member is dropped, ghosted by a
    // later remove/brush). `pendingShift` — the canonical source has already
    // grown but our parallel arrays haven't (core splices the source BEFORE
    // fanout) — distinguishes a genuine interior shift from a TAIL insert
    // (`ix === filters.length`, the original C12 bit-fold path) and from an
    // INDEPENDENT array's own insert (C14: never grows THIS primary, so never
    // splices — left deliberately unhandled). Only the PRIMARY echo
    // (`v === this.p`, the canonical index identity; it echoes LAST so every
    // facet has already shifted its own array) reconciles the splice, re-deriving
    // the new cell's full bitmask from each source's settled value. A secondary
    // echo of the same shift is a structural no-op — folding its bit into the
    // not-yet-shifted (wrong) cell is the echo-ordering hazard the no-op avoids.
    const pendingShift = this.p.value.length > this.filters.length
    for (let i = 0; i < I0.length; i += 2) {
      const at = I0[i]              // string key — emitted as-is
      const ix = +at                // numeric — splice / length math
      const val = I0[i + 1]
      if (pendingShift && ix < this.filters.length) {
        if (v !== this.p) continue
        let bits = 0
        for (const [src_view, { one: src_one }] of this.sources)
          if (src_view.value?.[ix] !== undefined) bits |= src_one
        this.filters.splice(ix, 0, bits)
        this.view.value.splice(ix, 0, bits === this.all ? this.p.value[ix] : undefined)
        if (bits === this.all) NI0.push(at, this.view.value[ix])
        continue
      }
      const bits = this.filters[at] || 0
      this.filters[at] = val !== undefined ? (bits | one) : (bits & off)
      if (this.filters[at] === this.all && this.view.value[at] === undefined) {
        NI0.push(at, this.view.value[at] = this.p.value[at])
      }
    }
    // Keep `view.value` length-aligned with `filters` so a holed (excluded) tail
    // insert still extends the output array — otherwise a later remove would
    // splice the two at divergent lengths.
    if (this.view.value.length < this.filters.length) this.view.value.length = this.filters.length
    if (NI0.length) this.view.BI0(NI0)
  }

  // One source emptied: clear its bit on every tracked row. We never look
  // at the primary source for row identity here, just iterate the bitmask
  // table. The view itself collapses to empty because at least one source
  // now has nothing — no row can satisfy `bits === all`.
  XR0(_, v){
    const { off } = this.sources.get(v)
    iter(this.filters, (i, b) => {
      if (b !== undefined) this.filters[i] = b & off
    })
    this.view.XU0(this.view.value = isArray(this.view.value) ? [] : {})
  }

  XU0(value, v) {
    const { one, off } = this.sources.get(v)
    this.view.value ??= isArray(this.p.value) ? [] : {}
    if (typeof value !== 'object') return super.XU0()
    this.filters ??= isArray(this.p.value) ? [] : {}
    const new_value = isArray(this.p.value) ? [] : {}
    // Clear this source's bit for tracked rows; skip unset slots so we
    // don't turn them into NaN
    iter(this.filters, (i, b) => {
      if (b !== undefined) this.filters[i] = b & off
    })
    // Set this source's bit for rows in the new value. If a row appears
    // for the first time (we never tracked it), initialise its bitmask by
    // checking every other source — without this, an expanding source
    // would leave bits permanently zero for the rows it newly admits.
    iter(value, (i, val) => {
      if (val === undefined) return
      let bits = this.filters[i]
      if (bits === undefined) {
        bits = 0
        for (const [src_view, { one: src_one }] of this.sources) {
          if (src_one !== one && src_view.value?.[i] !== undefined) bits |= src_one
        }
      }
      bits |= one
      this.filters[i] = bits
      if (bits === this.all) new_value[i] = this.p.value[i]
    })
    this.view.XU0(this.view.value = new_value)
  }

  // One row left one source. If clearing this source's bit drops the row
  // below "all bits set" (and it was at "all" before — i.e. visible), emit a
  // BR1. The `(bits & off) === zero` check tests "after clearing, only this
  // source's bit was set" which is equivalent to "the row was previously at
  // all-bits-set"; `zero` is precomputed once per call.
  BR1(R1, v) { this._leave(R1, v, false) }

  // BH1 (consumer): an upstream sparse producer (between/filter over an ARRAY)
  // holed a row in source v — positional-stable, no shift. Same membership
  // logic as BR1; emits BH1 downstream (a hole, not a splice) so a positional
  // sink (the DOMSink bound straight to this view) mirrors the hole instead of
  // popping its tail. Without this, core falls the upstream BH1 back to BR1,
  // which over an array routes to BR1A (splice-shift) and corrupts an
  // index-keyed sink. Mirrors between's consumer BH1.
  BH1(R1, v) { this._leave(R1, v, true) }

  _leave(R1, v, hole) {
    if (!R1.length) return
    const { off } = this.sources.get(v)
    const NR1 = []
    const zero = this.all & off
    this.view.value ??= isArray(this.p.value) ? [] : {}
    for (let i = 0; i < R1.length; i+=2) {
      const name = R1[i]
      const bits = this.filters[name]
      if (bits === undefined) continue
      if ((bits & off) === zero) {
        NR1.push(name, this.view.value[name])
        this.view.value[name] = undefined
      }
      // Clear this source's bit so we know the row is no longer in this
      // source — without this a subsequent BI0 from a *different* source
      // could see filters[name] still saying "all bits set" and re-emit.
      this.filters[name] = bits & off
    }
    if (NR1.length) hole && isArray(this.view.value) ? this.view.BH1(NR1) : this.view.BR1(NR1)
  }

  BU1(U1){
    if (!U1.length) return
    const { all, filters } = this
    const NU1 = []
    for (let i = 0; i < U1.length; i++) {
      const name = U1[i++]
      if (filters[name] === all) {
        const value = this.p.value[name]
        if (value === this.view.value[name]) continue
        this.view.value[name] = value
        NU1.push(name, value)
      }
    }
    if (NU1.length) this.view.BU1(NU1)
  }

  BI0(I0, v){ this._enter(I0, v, false) }

  // BF0 (consumer): an upstream sparse producer filled a hole in source v —
  // positional-stable. Same membership logic as BI0; emits BF0 downstream so a
  // positional sink fills the slot in place rather than tail-appending. Mirrors
  // between's consumer BF0. (The "first time seen" bitmask-init branch is inert
  // here — a hole-fill is for a row that was already tracked.)
  BF0(I0, v){ this._enter(I0, v, true) }

  _enter(I0, v, hole){
    if (!I0.length) return
    const { all, sources, filters } = this
    const { one } = sources.get(v)
    const me = this.view.value ??= isArray(this.p.value) ? [] : {}
    const NI0 = []
    for (let i = 0; i < I0.length; i++) {
      const name = I0[i++]
      let bits = filters[name]
      if (bits === undefined) {
        // First time we've seen this row — initialise from every other
        // source rather than starting at 0, otherwise rows that exist in
        // other sources but were outside p.value at construction time
        // would never reach the all-bits-set state.
        bits = 0
        for (const [src_view, { one: src_one }] of sources) {
          if (src_one !== one && src_view.value?.[name] !== undefined) bits |= src_one
        }
      }
      bits |= one
      filters[name] = bits
      if (bits === all) {
        NI0.push(name, me[name] = this.p.value[name])
      }
    }
    if (NI0.length) hole && isArray(this.view.value) ? this.view.BF0(NI0) : this.view.BI0(NI0)
  }

  // Nested-key events (deep updates on rows). Two gates:
  //   1. The event must come from `this.p` (the primary source). A
  //      secondary source's nested change to row[name] doesn't affect what
  //      intersect emits for that row — downstream sees `this.p.value[name]`,
  //      not the secondary's data — so dropping is the right answer.
  //   2. The row must be in the intersection (`filters[name] === all`).
  //      Otherwise the row isn't visible downstream and we'd be leaking
  //      events for excluded rows.
  // Previously these methods were misnamed `R2`/`U2`/`I2` — never called
  // by the framework (which dispatches `BR2`/`BU2`/`BI2`) — so deep updates
  // on excluded rows fell through to Operator's default forwarder and leaked
  // downstream silently.
  BR2(R2, v) {
    if (v !== this.p || !R2.length) return
    const NR2 = []
    for (let i = 0; i < R2.length; i += 2) {
      const path = R2[i]
      if (this.filters[path[0]] === this.all) NR2.push(path, R2[i + 1])
    }
    if (NR2.length) this.view.BR2(NR2)
  }
  BU2(U2, v) {
    if (v !== this.p || !U2.length) return
    const NU2 = []
    for (let i = 0; i < U2.length; i += 2) {
      const path = U2[i]
      if (this.filters[path[0]] === this.all) NU2.push(path, U2[i + 1])
    }
    if (NU2.length) this.view.BU2(NU2)
  }
  BI2(I2, v) {
    if (v !== this.p || !I2.length) return
    const NI2 = []
    for (let i = 0; i < I2.length; i += 3) {
      const path = I2[i]
      if (this.filters[path[0]] === this.all) NI2.push(path, I2[i + 1], I2[i + 2])
    }
    if (NI2.length) this.view.BI2(NI2)
  }

  // Identity-based dedup over the original args. Used by createOperator and
  // ViewProxy.apply to reuse an existing intersect view when the same call
  // shape is repeated. Crossfilter benefit: each chart in a dashboard calls
  // `flights.intersect(dims, 'thisChart')` on every render and gets the
  // same operator view back, so the bitmask state is shared.
  matches(...args){
    if (args.length !== this._args.length) return false
    for (let i = 0; i < args.length; i++) if (args[i] !== this._args[i]) return false
    return true
  }
}

export const intersect = (source, ...others) => createOperator(source, IntersectValue, ...others)
