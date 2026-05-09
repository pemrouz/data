// @ts-nocheck
import { iter, identity } from '../../utils.ts'
import { Operator, createOperator } from '../../core.ts'

// `proxy.distinct(fn?)` materializes the source's distinct values as an
// array, in first-seen iteration order. `fn` (default identity) projects
// each row to a comparison key — rows projecting to the same key collapse
// to the first one seen.
//
//   $([1, 2, 1, 3, 2]).distinct()                  // → [1, 2, 3]
//   $([{ a: 'x' }, { a: 'y' }, { a: 'x' }]).distinct(r => r.a)
//                                                  // → [{a:'x'}, {a:'y'}]
//
// Implementation rebuilds on every upstream event (XU0/BU1/BR1/BI0/...).
// O(n) per change, simple and correct. Optimization to incremental
// (per-key count + first-name map) is straightforward when needed; the
// shape of `distinct` doesn't change.
export class DistinctValue extends Operator {
  constructor(p, fn) {
    super()
    this.p = p
    this.fn = fn || identity
    this._rebuild()
  }

  matches(fn) { return this.fn === (fn || identity) }

  _rebuild() {
    const seen = new Set()
    const out = []
    const v = this.p.value
    if (v && typeof v === 'object') {
      iter(v, (_, row) => {
        if (row === undefined) return
        const k = this.fn(row)
        if (!seen.has(k)) {
          seen.add(k)
          out.push(row)
        }
      })
    }
    this.view.value = out
    this.view.XU0(out)
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

export const distinct = (source, fn) => createOperator(source, DistinctValue, fn)
