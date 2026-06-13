// @ts-nocheck
import { isArray, iter } from '../../utils.ts'
import { Operator, createOperator } from '../../core.ts'

// Two flavours of length: a scalar count of rows (LengthValue) and a
// histogram-by-fn (LengthFnValue). The scalar form just adds/subtracts
// payload sizes on insert/remove — `length/2` because the protocol arrays
// pack [name, value, name, value, ...]. BU1 is a no-op because updating a
// row's value doesn't change the count.
export class LengthValue extends Operator {
  constructor(p) {
    super()
    this.p = p
    this.view.value = 0
    this.XU0(p.value)
  }

  XR0(){
    this.view.XU0(this.view.value = 0)
  }
  XU0(value){
    this.view.value = 0
    // Holes / undefined slots represent excluded rows in derived sparse arrays
    // (RowOperator builds these in `XU0`), so skip them — otherwise filter →
    // length would return the source's length instead of the kept count.
    iter(value, (_, v) => { if (v !== undefined) this.view.value++ })
    this.view.XU0(this.view.value)
  }
  BR1(R1){
    if (!R1.length) return
    // Array-aware upstreams (RowOperator over an array source) emit
    // `[name, undefined]` for shift-only events — the row was already
    // excluded by an upstream predicate so we shouldn't decrement the
    // count, but the position notification still has to flow through for
    // sort/between to maintain their indices.
    let n = 0
    for (let i = 1; i < R1.length; i += 2) if (R1[i] !== undefined) n++
    if (n) this.view.XU0(this.view.value -= n)
  }
  // A BU1 pair carrying `undefined` is a LEAVE (`src.k = undefined` — core's
  // upsert split routes a previously-DEFINED key set to undefined here, not to
  // BR1). Decrement once per such pair; a defined new value is a genuine update
  // of a still-counted row (no count change). Was a blanket no-op, so the count
  // went permanently stale on assignment-to-undefined.
  BU1(U1){
    if (!U1.length) return
    let n = 0
    for (let i = 1; i < U1.length; i += 2) if (U1[i] === undefined) n++
    if (n) this.view.XU0(this.view.value -= n)
  }
  BI0(I0){
    if (!I0.length) return
    let n = 0
    for (let i = 1; i < I0.length; i += 2) if (I0[i] !== undefined) n++
    if (n) this.view.XU0(this.view.value += n)
  }
  BR2(){}
  BU2(){}
  BI2(){}
}

// Histogram-by-fn: each output bucket is `{ value: count }` — a tiny
// reactive object so downstream views (e.g. histogram bars in crossfilter)
// can subscribe to a single counter without re-rendering all bars on every
// change. `mapping[name]` is the bucket each upstream row currently belongs
// to, so cross-bucket moves are decremented from old / incremented into new
// without re-iterating the source.
export class LengthFnValue extends Operator {
  constructor(p, fn) {
    super()
    this.p = p
    this.fn = fn
    this.XU0(this.p.value)
  }

  XR0(){
    this.mapping = {}
    this.view.XU0(this.view.value = {})
  }

  XU0(value) {
    const new_value = {}
    this.mapping = {}
    this.isArr = isArray(value)
    iter(value, (i, v) => {
      if (v === undefined) return
      ;(this.mapping[i] = new_value[this.fn(v)] ??= { value: 0 }).value++
    })
    this.view.XU0(this.view.value = new_value)
  }

  BR1(R1){
    if (!R1.length) return
    // Array source: a remove SPLICES the source, shifting every position past
    // it — but `mapping` is keyed by position, so it goes stale and a later
    // BU2 would rebucket the wrong row. Rebuild to re-key `mapping` (O(N), but
    // array-source length(fn) with inserts/removes is rare; the histogram-on-a-
    // mutating-source case the incremental path targets is BU2-only). BI0 below
    // does the same for the symmetric insert shift.
    if (this.isArr) return this.XU0(this.p.value)
    const { mapping } = this
    let changed = false
    for (let i = 0; i < R1.length; i++) {
      const n = R1[i++]
      const m = mapping[n]
      if (!m) continue
      m.value--
      mapping[n] = undefined
      changed = true
    }
    if (changed) this.view.XU0(this.view.value)
  }

  BU1(U1){
    if (!U1.length) return
    const { mapping, view, fn } = this
    // Publish only when a bucket count actually moved. A BU1 whose row stays in
    // the same bucket (a non-key field changed) changes no count, but the old
    // code XU0'd the whole buckets object regardless — waking every bucket child
    // view and sink on every event, defeating the per-counter subscription
    // design. (BU2 already guarded with `moved`.)
    let changed = false
    for (let i = 0; i < U1.length; i++) {
      const n = U1[i++]
      const v = U1[i]
      const og = mapping[n]
      // value === undefined is a LEAVE: drop from the old bucket and clear the
      // position mapping — NEVER call fn(undefined) (it expects a row and would
      // crash mid-cascade).
      if (v === undefined) {
        if (og) { og.value--; mapping[n] = undefined; changed = true }
        continue
      }
      const ng = view.value[fn(v)] ??= { value: 0 }
      if (og !== ng) {
        mapping[n] = ng
        if (og) og.value--
        ng.value++
        changed = true
      }
    }
    if (changed) this.view.XU0(this.view.value)
  }

  BI0(I0){
    if (!I0.length) return
    if (this.isArr) return this.XU0(this.p.value)   // see BR1: re-key position map
    const { mapping, view, fn } = this
    let changed = false
    for (let i = 0; i < I0.length; i++) {
      const n = I0[i++]
      const v = I0[i]
      if (v === undefined) continue
      ;(mapping[n] = view.value[fn(v)] ??= { value: 0 }).value++
      changed = true
    }
    if (changed) this.view.XU0(this.view.value)
  }

  // In-place field mutation (e.g. `data[id].status = 'x'`). The framework
  // delivers this as a BU2 carrying the changed path, not the whole row, so we
  // re-read the current row from `p.value` and recompute its bucket key. If the
  // key moved, decrement the old bucket and increment the new one — exactly the
  // BU1 rebucket, just sourced by path. A no-op key change (a different field
  // changed, or the same bucket) republishes nothing, so subscribers only wake
  // on an actual count change. Without this, `length(fn)` was blind to in-place
  // mutations — a histogram over a source that mutates rows (rather than only
  // inserting/removing them) silently froze at its construction-time buckets.
  BU2(U2){
    if (!U2.length) return
    const { mapping, view, fn, p } = this
    let moved = false
    for (let i = 0; i < U2.length; i += 2) {
      const n = U2[i][0]
      const v = p.value[n]
      if (v === undefined) continue
      const og = mapping[n]
      const ng = view.value[fn(v)] ??= { value: 0 }
      if (og !== ng) {
        mapping[n] = ng
        if (og) og.value--
        ng.value++
        moved = true
      }
    }
    if (moved) this.view.XU0(this.view.value)
  }
  // NB: no BH1/BF0 — a sparse producer's membership flip falls back to BR1/BI0,
  // which rebuilds over an array source. Incremental BH1/BF0 here desynced the
  // same way the aggregate one did (see ISSUES.md P7); the rebuild is correct.
  BR2(){}
  BI2(){}
}

export const length = (source, fn) => createOperator(source, fn ? LengthFnValue : LengthValue, fn)
