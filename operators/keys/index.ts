// @ts-nocheck
import { isArray } from '../../utils.ts'
import { Operator, createOperator } from '../../core.ts'

// `proxy.keys()` and `proxy.values()` materialize the source's current
// keys / values as a plain array reactive view. Incremental on inserts
// (BI0 appends to the cached output array); removes / updates / XU0
// rebuild because reverse-mapping a name to its output index is O(N)
// without a parallel name→index map — straightforward to add if a
// remove-heavy workload appears.
//
// Useful with `distinct`/`length` for crossfilter-style "list the
// categories": `data.length(byCol).keys()` gives the distinct labels.
class CollectionView extends Operator {
  constructor(p, project, isKeys) {
    super()
    this.p = p
    this.project = project
    this.isKeys = isKeys
    this.output = []
    this._rebuild()
  }

  _rebuild() {
    const v = this.p.value
    const next = v && typeof v === 'object' ? this.project(v) : []
    this.output = next
    this.view.value = next
    this.view.XU0(next)
  }

  BI0(I0) {
    if (!I0.length) return
    // Array upstreams (a sort/limit window, or arr.insert at a position) deliver
    // BI0 with a POSITIONAL `at`, not an append: a row entering a sort window at
    // rank 0 shifts the rest, and the `at` is its index — appending it (and, for
    // keys, pushing the numeric index as a "key") corrupts the output. The
    // upstream value already reflects the insert, so rebuild. Object upstreams
    // (append-at-end iteration) keep the O(1) append fast path.
    if (isArray(this.p.value)) return this._rebuild()
    const out = this.output
    if (this.isKeys) {
      for (let i = 0; i < I0.length; i += 2) {
        if (I0[i + 1] !== undefined) out.push(I0[i])
      }
    } else {
      for (let i = 0; i < I0.length; i += 2) {
        const val = I0[i + 1]
        if (val !== undefined) out.push(val)
      }
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

export class KeysValue extends CollectionView {
  constructor(p) { super(p, Object.keys, true) }
}

export class ValuesValue extends CollectionView {
  constructor(p) { super(p, Object.values, false) }
}

export const keys   = (source) => createOperator(source, KeysValue)
export const values = (source) => createOperator(source, ValuesValue)
