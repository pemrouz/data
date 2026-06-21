import { iter, identity, isArray } from '../../utils.ts'
import { Operator, createOperator } from '../../core.ts'

// Sentinel returned by `_update` when an in-place edit moves a bucket's
// *representative* row to a new key while the bucket stays occupied — that
// can't be reconciled as an O(1) output edit, so BU2 falls back to rebuild.
const REBUILD = Symbol('distinct.rebuild')

// `proxy.distinct(fn?)` materializes the source's distinct values as an
// array, in first-seen iteration order. `fn` (default identity) projects
// each row to a comparison key — rows projecting to the same key collapse
// to the first one seen.
//
//   $([1, 2, 1, 3, 2]).distinct()                  // → [1, 2, 3]
//   $([{ a: 'x' }, { a: 'y' }, { a: 'x' }]).distinct(r => r.a)
//                                                  // → [{a:'x'}, {a:'y'}]
//
// Incremental on BI0 (inserts) and BU2 (deep updates): maintains a
// per-projection-key counter plus a name→projection map so each delta
// touches O(1) buckets. BR1 (removes) and BR2 fall back to rebuild
// because the test suite encodes a "first-seen order tracks current
// source iteration order" semantic — when a row that supplied the first
// instance of its projection is removed, the output's order can shift in
// ways that aren't expressible as O(1) edits to the cached array. BU2 also
// rebuilds in the one case it can't reconcile incrementally: an in-place
// edit that moves a bucket's *representative* row (the instance cached in
// the output) to a new key while the bucket stays occupied by a sibling.
// Crossfilter-shaped workloads (dimension brushing, attribute rewrites)
// are dominated by BI0/BU2 and stay on the incremental path.
export class DistinctValue extends Operator {
  declare fn: (row: any) => any
  declare counts: Map<any, number>
  declare firstRow: Map<any, any>
  declare namesProj: Map<any, any>
  constructor(p: any, fn: (row: any) => any) {
    super()
    this.p = p
    this.fn = fn || identity
    // Track: how many source rows project to each key; which row's value
    // is currently first-seen for each key; what key each row currently
    // projects to. firstRowPos parallels output indices for O(1) removal
    // when a count drops to zero.
    this._reset()
    this._rebuild()
  }

  matches(fn: any) { return this.fn === (fn || identity) }

  _reset() {
    this.counts = new Map()
    this.firstRow = new Map()
    this.namesProj = new Map()
    this.output = []
  }

  _rebuild() {
    this._reset()
    const v = this.p.value
    const { fn, counts, firstRow, namesProj, output } = this
    if (v && typeof v === 'object') {
      iter(v, (name: any, row: any) => {
        if (row === undefined) return
        const k = fn(row)
        const c = counts.get(k)
        if (c === undefined) {
          counts.set(k, 1)
          firstRow.set(k, row)
          output.push(row)
        } else {
          counts.set(k, c + 1)
        }
        namesProj.set(name, k)
      })
    }
    this.view.value = output
    this.view.XU0(output)
  }

  // Single-row insert at a fresh name. Either bumps an existing bucket's
  // count or admits a new projection to the output.
  _insert(name: any, row: any) {
    if (row === undefined) return false
    const k = this.fn(row)
    const c = this.counts.get(k)
    let changed = false
    if (c === undefined) {
      this.counts.set(k, 1)
      this.firstRow.set(k, row)
      this.output.push(row)
      changed = true
    } else {
      this.counts.set(k, c + 1)
    }
    this.namesProj.set(name, k)
    return changed
  }

  // Single-row update at a known name. Returns true if the output array
  // changed shape (bucket added or removed). Order-shift case (the removed
  // bucket's row appeared earlier than a still-present row that now becomes
  // the first instance of some OTHER bucket) doesn't happen for BU2 — the
  // row at `name` stays at `name`, just with a new projection.
  _update(name: any, row: any) {
    if (row === undefined) return false
    const newK = this.fn(row)
    const oldK = this.namesProj.get(name)
    if (oldK === newK) return false
    let changed = false
    if (oldK !== undefined) {
      const c = this.counts.get(oldK)! - 1   // oldK came from namesProj, so counts has it
      if (c === 0) {
        this.counts.delete(oldK)
        const oldFirst = this.firstRow.get(oldK)
        this.firstRow.delete(oldK)
        const idx = this.output.indexOf(oldFirst)
        if (idx >= 0) this.output.splice(idx, 1)
        changed = true
      } else {
        // The bucket still has other rows after this one leaves. If `row`
        // was oldK's representative — the instance cached in `output` — it
        // can't simply stay: for an in-place edit `row` is the SAME object
        // reference still sitting in `output`, so leaving it would show
        // oldK's output slot projecting to newK while the sibling that
        // should now represent oldK is absent (output ends up duplicating
        // newK and dropping oldK entirely). Promoting a replacement while
        // preserving first-seen order isn't an O(1) edit, so request a full
        // rebuild. When `row` was NOT the representative, the cached output
        // is still valid and we stay on the incremental path.
        if (this.firstRow.get(oldK) === row) return REBUILD
        this.counts.set(oldK, c)
      }
    }
    const c = this.counts.get(newK)
    if (c === undefined) {
      this.counts.set(newK, 1)
      this.firstRow.set(newK, row)
      this.output.push(row)
      changed = true
    } else {
      this.counts.set(newK, c + 1)
    }
    this.namesProj.set(name, newK)
    return changed
  }

  BI0(I0: any) {
    if (!I0.length) return
    // Array upstreams (sort/limit windows, mid-array inserts) deliver BI0 with a
    // POSITIONAL `at` that collides with the position-keyed namesProj map — a row
    // entering a sort window at rank k is not a fresh name. Rebuild from the
    // current (post-insert) source instead. Object upstreams keep the O(1) path.
    if (isArray(this.p.value)) return this._rebuild()
    let changed = false
    for (let i = 0; i < I0.length; i += 2) {
      if (this._insert(I0[i], I0[i + 1])) changed = true
    }
    if (changed) this.view.XU0(this.view.value = this.output)
  }

  BU2(U2: any) {
    if (!U2.length) return
    // U2 is [path, value, path, value, ...] — we need the FULL row at
    // each touched top-level name to recompute its projection, not the
    // partial sub-value. Read from this.p.value, which the source has
    // already updated by the time BU2 fires downstream.
    const v = this.p.value
    if (isArray(v)) return this._rebuild()   // positional names shift under array upstreams; rebuild
    let changed = false
    for (let i = 0; i < U2.length; i += 2) {
      const path = U2[i]
      const name = path[0]
      const r = this._update(name, v?.[name])
      if (r === REBUILD) return this._rebuild()
      if (r) changed = true
    }
    if (changed) this.view.XU0(this.view.value = this.output)
  }

  XR0() { this._rebuild() }
  XU0() { this._rebuild() }
  BU1() { this._rebuild() }
  BR1() { this._rebuild() }
  BR2() { this._rebuild() }
  BI2() { this._rebuild() }
}

export const distinct = (source: any, fn?: any) => createOperator(source, DistinctValue, fn)
