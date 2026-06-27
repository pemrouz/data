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
import type { Data, ColOf, ColValue, Reactive } from '../../core.ts'

abstract class CompareValue extends RowOperator {
  declare col: any
  declare _val: any
  declare _valView: any
  declare _live: boolean
  // Implemented by each subclass (Gt/Lt/Gte/Lte). Abstract so the base type
  // knows `process` can call it; emits nothing (abstract members are erased).
  abstract _cmp(x: any): boolean
  constructor(p: any, col: any, val: any) {
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
  matches(col: any, val: any) {
    if (this.col !== col) return false
    if (val instanceof ViewProxy) return this._valView === (val as any)[view]
    if (this._valView) return false      // we're reactive; arg is a plain literal
    return this._val === val
  }
  // `set val` is the connect target: PropSink writes `this.val = <bound value>`
  // on construction (guarded out by `_live` being unset) and on every later
  // change (which recomputes). Subclasses read the live threshold via `this._val`.
  set val(v: any) { this._val = v; if (this._live) this.XU0(this.p.value) }
  // Subclasses implement `_cmp(x)`. `value?.[col]` short-circuits on missing
  // rows / non-object rows — any such row fails every comparison (matches
  // JS's `undefined > 5 === false`, `undefined >= 5 === false`, etc.).
  process(value?: any) { return this._cmp(value?.[this.col]) ? value : undefined }
}

export class GtValue  extends CompareValue { _cmp(x: any) { return x >  this._val } }
export class LtValue  extends CompareValue { _cmp(x: any) { return x <  this._val } }
export class GteValue extends CompareValue { _cmp(x: any) { return x >= this._val } }
export class LteValue extends CompareValue { _cmp(x: any) { return x <= this._val } }

// `col` is key-checked against the source's row shape (`ColOf<T>` — a typo like
// `gt(src, 'agee', 18)` is rejected) and the threshold is typed to that column's
// value type, plain or reactive (`Reactive<ColValue<T,K>>` — so a number column
// rejects a string threshold, while a reactive `$(n)` bound is still accepted).
// Mirrors the method-style `proxy.gt(...)`. Both args fall back to permissive
// `string`/`any` for scalar-row, dynamic-`Record`, or untyped sources.
export const gt  = <T, K extends ColOf<T>>(source: Data<T>, col: K, val: Reactive<ColValue<T, K>>): Data<T> => createOperator(source, GtValue,  col, val)
export const lt  = <T, K extends ColOf<T>>(source: Data<T>, col: K, val: Reactive<ColValue<T, K>>): Data<T> => createOperator(source, LtValue,  col, val)
export const gte = <T, K extends ColOf<T>>(source: Data<T>, col: K, val: Reactive<ColValue<T, K>>): Data<T> => createOperator(source, GteValue, col, val)
export const lte = <T, K extends ColOf<T>>(source: Data<T>, col: K, val: Reactive<ColValue<T, K>>): Data<T> => createOperator(source, LteValue, col, val)
