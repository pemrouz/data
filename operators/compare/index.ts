// @ts-nocheck
// Scalar-comparison range filters: `.gt(col, v)`, `.lt(col, v)`, `.gte(col, v)`,
// `.lte(col, v)`. Each keeps rows whose `row[col]` satisfies the comparison
// against `v`. Both args are literal (serializable) — for a two-sided range
// with reactive bounds use `between(col, [lo, hi])`.
//
// Implementation note: these are RowOperator-based, so each tick is O(1) per
// changed row (one comparison + classify-as-update/insert/remove). Contrast
// with `between(col, [lo, hi])`, which maintains a sorted index for
// constant-time bound queries and pays a splice/insert in `sorted` per BU2.
// For workloads where the threshold rarely changes but row values do (e.g.
// "liquid trades where spread > 1.0"), the row-operator form is dramatically
// faster — see experiments/wasm/README.md for the motivating bench.

import { RowOperator } from '../../row.ts'
import { createOperator } from '../../core.ts'

class CompareValue extends RowOperator {
  constructor(p, col, val) {
    super()
    this.p = p
    this.col = col
    this.val = val
    this.XU0(this.p.value)
  }
  // Repeated `proxy.gt('col', v)` with identical args returns the cached view.
  matches(col, val) { return this.col === col && this.val === val }
  // Subclasses implement `_cmp(x)`. `value?.[col]` short-circuits on missing
  // rows / non-object rows — any such row fails every comparison (matches
  // JS's `undefined > 5 === false`, `undefined >= 5 === false`, etc.).
  process(value) { return this._cmp(value?.[this.col]) ? value : undefined }
}

export class GtValue  extends CompareValue { _cmp(x) { return x >  this.val } }
export class LtValue  extends CompareValue { _cmp(x) { return x <  this.val } }
export class GteValue extends CompareValue { _cmp(x) { return x >= this.val } }
export class LteValue extends CompareValue { _cmp(x) { return x <= this.val } }

export const gt  = (source, col, val) => createOperator(source, GtValue,  col, val)
export const lt  = (source, col, val) => createOperator(source, LtValue,  col, val)
export const gte = (source, col, val) => createOperator(source, GteValue, col, val)
export const lte = (source, col, val) => createOperator(source, LteValue, col, val)
