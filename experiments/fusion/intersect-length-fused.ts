// @ts-nocheck
// PROTOTYPE — not wired into dispatch. Hand-built fused operator that
// collapses `source.intersect(dims, except).length(fn)` into one node.
//
// Hypothesis: the per-emit cost of the chain is dominated by (a) intersect
// allocating `NI0`/`NR1` arrays of boundary rows, and (b) length re-iterating
// that array to do the bucket update. A fused op walks boundary rows once,
// and on a visibility transition increments/decrements the bucket directly —
// no intermediate row-array allocation, no second walk, no second event
// propagation level (sink dispatch saved too).
//
// Output shape matches LengthFnValue: { [bucket]: { value: count } }.
import { isArray, iter } from '../../utils.ts'
import { Operator, view, reactive, createOperator } from '../../core.ts'

const isDims = (v) =>
  v != null && typeof v === 'object' && !v[reactive] && !isArray(v)

export class IntersectLengthValue extends Operator {
  constructor(p, dims, except, fn) {
    super()
    this._dims = dims
    this._except = except
    this._fn = fn

    const sources = Object.entries(dims).filter(([k]) => k !== except).map(([, v]) => v)

    this.vp = sources[0]
    this.p = p
    this.fn = fn
    this.sources = new Map([[p, { one: 1, off: ~1 }]])
    this.all = 1
    for (const src of sources) {
      const one = 1 << this.sources.size
      src.connect(this)
      this.sources.set(src[view], { one, off: ~one })
      this.all |= one
    }

    this.filters = isArray(this.p.value) ? [] : {}
    this.mapping = {}
    this.view.value = {}
    this._rebuild()
  }

  _rebuild() {
    const { p, sources, all, fn } = this
    const buckets = {}
    const mapping = this.mapping = {}
    const filters = this.filters = isArray(p.value) ? [] : {}
    iter(p.value, (i, v) => {
      let bits = 0
      for (const [res, src] of sources) {
        if (i in res.value) bits |= src.one
      }
      filters[i] = bits
      if (bits === all && v !== undefined) {
        const b = buckets[fn(v)] ??= { value: 0 }
        b.value++
        mapping[i] = b
      }
    })
    this.view.XU0(this.view.value = buckets)
  }

  XR0(_, v) {
    const { off } = this.sources.get(v)
    iter(this.filters, (i, b) => {
      if (b !== undefined) this.filters[i] = b & off
    })
    this.mapping = {}
    this.view.XU0(this.view.value = {})
  }

  XU0(value, v) {
    if (typeof value !== 'object') { this._rebuild(); return }
    // Source `v` got a wholly new value. Easiest correct path: rebuild.
    // The XU0 cost is rare in the brush hot path (between only emits XU0
    // on full unfilter / collapse), so we don't optimise it.
    this._rebuild()
  }

  // Source `v` lost rows. For each row, clear v's bit, and if the row was
  // previously visible, decrement its bucket.
  BR1(R1, v) {
    if (!R1.length) return
    const { off } = this.sources.get(v)
    const { filters, mapping, all } = this
    const zero = all & off
    let changed = false
    for (let i = 0; i < R1.length; i += 2) {
      const name = R1[i]
      const bits = filters[name]
      if (bits === undefined) continue
      if ((bits & off) === zero) {
        // Was visible; now hidden.
        const m = mapping[name]
        if (m) { m.value--; mapping[name] = undefined; changed = true }
      }
      filters[name] = bits & off
    }
    if (changed) this.view.XU0(this.view.value)
  }

  // Source `v` gained rows. For each row, set v's bit, and if the row is now
  // at all-bits-set, increment its bucket.
  BI0(I0, v) {
    if (!I0.length) return
    const { all, sources, filters, mapping, fn, p } = this
    const { one } = sources.get(v)
    const buckets = this.view.value
    let changed = false
    for (let i = 0; i < I0.length; i += 2) {
      const name = I0[i]
      let bits = filters[name]
      if (bits === undefined) {
        bits = 0
        for (const [src_view, { one: src_one }] of sources) {
          if (src_one !== one && src_view.value?.[name] !== undefined) bits |= src_one
        }
      }
      bits |= one
      filters[name] = bits
      if (bits === all) {
        const row = p.value[name]
        if (row === undefined) continue
        const b = buckets[fn(row)] ??= { value: 0 }
        b.value++
        mapping[name] = b
        changed = true
      }
    }
    if (changed) this.view.XU0(buckets)
  }

  // BU1 from a source: row's value changed in some source. We only care if
  // the row is currently visible AND if the source is the primary (only the
  // primary's value drives the bucket via `fn`). If the bucket changes, move.
  BU1(U1, v) {
    if (!U1.length) return
    if (v !== this.p) return
    const { all, filters, mapping, fn, view } = this
    const buckets = view.value
    let changed = false
    for (let i = 0; i < U1.length; i += 2) {
      const name = U1[i]
      const newRow = U1[i + 1]
      if (filters[name] !== all) continue
      const og = mapping[name]
      const ng = buckets[fn(newRow)] ??= { value: 0 }
      if (og !== ng) {
        if (og) og.value--
        ng.value++
        mapping[name] = ng
        changed = true
      }
    }
    if (changed) view.XU0(buckets)
  }

  BR2(){}
  BU2(){}
  BI2(){}

  matches(dims, except, fn) {
    return dims === this._dims && except === this._except && fn === this._fn
  }
}

export const intersectLength = (source, dims, except, fn) =>
  createOperator(source, IntersectLengthValue, dims, except, fn)
