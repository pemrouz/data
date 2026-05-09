// @ts-nocheck
import { isArray } from '../../utils.ts'
import { Operator, createOperator } from '../../core.ts'

// `proxy.reverse()` materializes the source's array (or object's values)
// in reverse order. Rebuilds on every upstream change — for arrays the
// positional shifts under inserts/removes are tricky to map incrementally
// (a remove at the front of the source is a remove at the END of the
// output), so the simple-correct path is to rebuild. If a hot path needs
// incremental, the BR1A / BI0A semantics are the right next step.
export class ReverseValue extends Operator {
  constructor(p) {
    super()
    this.p = p
    this._rebuild()
  }

  _rebuild() {
    const v = this.p.value
    let out
    if (isArray(v)) {
      out = v.filter(x => x !== undefined).reverse()
    } else if (v && typeof v === 'object') {
      out = Object.values(v).filter(x => x !== undefined).reverse()
    } else {
      out = []
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

export const reverse = (source) => createOperator(source, ReverseValue)
