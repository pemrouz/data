// @ts-nocheck
import { Operator, createOperator } from '../../core.ts'

// `proxy.keys()` and `proxy.values()` materialize the source's current
// keys / values as a plain array reactive view. Both rebuild on every
// upstream event — sugar over `to(d => Object.keys(d))` / `Object.values`,
// just discoverable as method calls. Useful with `distinct`/`length` for
// crossfilter-style "list the categories": `data.length(byCol).keys()`
// gives the distinct category labels.
class CollectionView extends Operator {
  constructor(p, project) {
    super()
    this.p = p
    this.project = project
    this._rebuild()
  }
  _rebuild() {
    const v = this.p.value
    const out = v && typeof v === 'object' ? this.project(v) : []
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

export class KeysValue extends CollectionView {
  constructor(p) { super(p, Object.keys) }
}

export class ValuesValue extends CollectionView {
  constructor(p) { super(p, Object.values) }
}

export const keys   = (source) => createOperator(source, KeysValue)
export const values = (source) => createOperator(source, ValuesValue)
