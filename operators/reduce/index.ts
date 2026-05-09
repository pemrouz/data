// @ts-nocheck
import { iter } from '../../utils.ts'
import { Operator, createOperator } from '../../core.ts'

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

export const reduce = (source, fn, init) => createOperator(source, ReduceValue, fn, init)
