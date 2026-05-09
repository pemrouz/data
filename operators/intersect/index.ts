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
      const one = 1 << this.sources.size
      src.connect(this)
      this.sources.set(src[view], { one, off: ~one })
      this.all |= one
    }

    if (typeof p.value !== 'object') { super.XU0(); return }
    const new_value = isArray(this.p.value) ? [] : {}
    this.filters = isArray(this.p.value) ? [] : {}
    iter(p.value, (i, v) => {
      for (const [res, src] of this.sources) {
        if (i in res.value) this.filters[i] |= src.one
      }
      if (this.filters[i] === this.all) new_value[i] = v
    })
    this.view.XU0(this.view.value = new_value)
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
  BR1(R1, v) {
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
    if (NR1.length) this.view.BR1(NR1)
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

  BI0(I0, v){
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
    if (NI0.length) this.view.BI0(NI0)
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
