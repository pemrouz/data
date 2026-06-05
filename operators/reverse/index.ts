// @ts-nocheck
import { isArray } from '../../utils.ts'
import { Operator, createOperator } from '../../core.ts'

// `proxy.reverse()` materializes the source's array (or object's values)
// in reverse order. Incremental on inserts: a new key (BI0) prepends to
// the cached output array; removes / updates fall back to rebuild
// because finding the relevant position by value is O(N) and ambiguous
// for duplicate values.
export class ReverseValue extends Operator {
  constructor(p) {
    super()
    this.p = p
    this.output = []
    this._rebuild()
  }

  _rebuild() {
    const v = this.p.value
    const out = this.output
    out.length = 0
    if (v && typeof v === 'object') {
      if (isArray(v)) {
        for (let i = v.length - 1; i >= 0; i--) {
          const val = v[i]
          if (val !== undefined) out.push(val)
        }
      } else {
        const ks = Object.keys(v)
        for (let i = ks.length - 1; i >= 0; i--) {
          const val = v[ks[i]]
          if (val !== undefined) out.push(val)
        }
      }
    }
    this.view.value = out
    this.view.XU0(out)
  }

  // BI0: each [name, value] pair in I0 was just inserted into the source.
  // In source iteration order they sit at the END; in the reversed output
  // they sit at the FRONT. Process I0 in reverse so the last-inserted in
  // source becomes output[0].
  BI0(I0) {
    if (!I0.length) return
    // Array upstreams (sort/limit windows, mid-array inserts) deliver BI0 with a
    // POSITIONAL `at` — a row entering a sort window at rank k is not an append,
    // so the front-prepend below would put it at the wrong end. The upstream
    // value already reflects the insert; rebuild. Object upstreams (new key at
    // the end of iteration → front of the reverse) keep the O(1) prepend.
    if (isArray(this.p.value)) return this._rebuild()
    const out = this.output
    for (let i = I0.length - 2; i >= 0; i -= 2) {
      const val = I0[i + 1]
      if (val !== undefined) out.unshift(val)
    }
    this.view.value = out
    this.view.XU0(out)
  }

  XR0() { this._rebuild() }
  XU0() { this._rebuild() }
  BU1() { this._rebuild() }
  BR1() { this._rebuild() }
  BU2() { this._rebuild() }
  BR2() { this._rebuild() }
  BI2() { this._rebuild() }
}

export const reverse = (source) => createOperator(source, ReverseValue)
