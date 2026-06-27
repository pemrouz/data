import { createOperator } from '../../core.ts'
import type { Data, RowOf } from '../../core.ts'
import { RowOperator } from '../../row.ts'

// Map projects each row through `fn`. RowOperator handles all the
// BU1/BR1/BI0 bookkeeping; we just supply the per-row transform. `fn`
// receives the old value (`old_val`) so callers can do "diff against last"
// logic without external state. Returning undefined drops the row — same
// machinery as filter, just a different shape of `process`.
type RowFn = (value: any, name?: any, old_val?: any) => any

export class MapValue extends RowOperator {
  declare fn: RowFn
  constructor(p: any, fn: RowFn) {
    super()
    this.p = p
    this.fn = fn
    this.XU0(this.p.value)
  }

  process(value: any, name?: any, old_val?: any) {
    return this.fn(value, name, old_val)
  }
}

// Types the row param from the source (`RowOf<T>`) and infers the projected element
// type `R`, so `map(src, r => r.v)` is `Data<Record<string, number>>` — mirrors the
// method-style `proxy.map(...)`. `name`/`old_val` (the key and the row's previous
// value) stay available for "diff against last" projections. The internal `RowFn`
// keeps typing the loose class field.
export const map = <T, R>(source: Data<T>, fn: (row: RowOf<T>, name?: string, old_val?: RowOf<T>) => R): Data<Record<string, R>> => createOperator(source, MapValue, fn)
