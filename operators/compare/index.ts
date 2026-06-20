// @ts-nocheck
// Scalar-comparison range filters: `.gt(col, v)`, `.lt(col, v)`, `.gte(col, v)`,
// `.lte(col, v)`. Each keeps rows whose `row[col]` satisfies the comparison
// against `v`. The threshold may be a plain literal (captured once) OR a
// reactive ViewProxy (`gt('pnl', t)` with `t = $(0)`) — a reactive threshold is
// subscribed and re-classifies every row when it moves, the single-sided
// counterpart to `between`'s reactive bounds.
//
// Implementation note: these are RowOperator-based, so each tick is O(1) per
// changed row (one comparison + classify-as-update/insert/remove). Contrast
// with `between(col, [lo, hi])`, which maintains a sorted index for
// constant-time bound queries and pays a splice/insert in `sorted` per BU2.
// For workloads where the threshold rarely changes but row values do (e.g.
// "liquid trades where spread > 1.0"), the row-operator form is dramatically
// faster — see experiments/wasm/README.md for the motivating bench. A threshold
// MOVE re-runs the row classification once (O(N) XU0) rather than incrementally:
// a threshold flip can move any row in or out, and there is no sort index to
// walk like `between` has — so a fast-moving threshold (a brushed slider) over a
// large source is better served by `between(col, [lo, hi])`.

import { RowOperator } from '../../row.ts'
import { createOperator, ViewProxy, view, bindReactive } from '../../core.ts'

class CompareValue extends RowOperator {
  constructor(p, col, val) {
    super()
    this.p = p
    this.col = col
    // A reactive (ViewProxy) threshold subscribes via bindReactive: the `set val`
    // setter then fires on every change and re-runs the classification. A plain
    // literal is stored once (captured, never updated) — the original behaviour.
    if (!bindReactive(val, this, 'val')) this._val = val
    this.XU0(this.p.value)
    this._live = true   // subsequent `set val` calls now recompute (the seed above did not)
  }
  // Dedup by the threshold SOURCE's view identity when reactive (mirrors between
  // — a freshly-minted wrapper proxy per access would never `===` a stored one),
  // by value for a plain literal. `_valView` is set by bindReactive.
  matches(col, val) {
    if (this.col !== col) return false
    if (val instanceof ViewProxy) return this._valView === val[view]
    if (this._valView) return false      // we're reactive; arg is a plain literal
    return this._val === val
  }
  // `set val` is the connect target: PropSink writes `this.val = <bound value>`
  // on construction (guarded out by `_live` being unset) and on every later
  // change (which recomputes). Subclasses read the live threshold via `this._val`.
  set val(v) { this._val = v; if (this._live) this.XU0(this.p.value) }
  // Subclasses implement `_cmp(x)`. `value?.[col]` short-circuits on missing
  // rows / non-object rows — any such row fails every comparison (matches
  // JS's `undefined > 5 === false`, `undefined >= 5 === false`, etc.).
  process(value) { return this._cmp(value?.[this.col]) ? value : undefined }
}

export class GtValue  extends CompareValue { _cmp(x) { return x >  this._val } }
export class LtValue  extends CompareValue { _cmp(x) { return x <  this._val } }
export class GteValue extends CompareValue { _cmp(x) { return x >= this._val } }
export class LteValue extends CompareValue { _cmp(x) { return x <= this._val } }

export const gt  = (source, col, val) => createOperator(source, GtValue,  col, val)
export const lt  = (source, col, val) => createOperator(source, LtValue,  col, val)
export const gte = (source, col, val) => createOperator(source, GteValue, col, val)
export const lte = (source, col, val) => createOperator(source, LteValue, col, val)
