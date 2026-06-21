
// Shape-aware iterator: numeric for-loop over arrays (preserves index type
// and visits every slot, including holes), for-in over plain objects (skips
// non-enumerable keys, respects insertion order). Operators reach for this
// instead of branching at every call site.
export function iter(o: any, fn: any) {
    if (isArray(o)) {
        for (let i = 0; i < o.length; i++) fn(i, o[i])
    } else {
        for (const i in o) fn(i, o[i])
    }
}

export const { isArray } = Array

export const identity = (d: any) => d

export const noop = () => { }

export const U = undefined

// `left(prop)` returns a bisector keyed by `prop(row)`. Used by between to
// find where a brushed bound falls in its sorted source array — O(log n)
// instead of rescanning all rows on every drag tick.
export const left = (prop: any) => function bisect(a: any, v: any, lo = 0, hi = a.length) {
  while (lo < hi) {
    const mid = lo + hi >>> 1;
    if (prop(a[mid]) < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// `right(prop)` is the right-bisect counterpart — returns the first index `i`
// such that `prop(a[i]) > v`. between uses this for `hi_index` so the index
// represents "first sorted-position past the upper bound" (i.e. first NOT in
// view), which matches the convention the narrow/widen loops leave it in
// after running. Initialising hi_index via `left` instead landed on the
// boundary row itself and caused the widen-onto-boundary bug.
export const right = (prop: any) => function bisect(a: any, v: any, lo = 0, hi = a.length) {
  while (lo < hi) {
    const mid = lo + hi >>> 1;
    if (prop(a[mid]) > v) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

// Right-bisect for descending-sorted arrays, bound to the operator instance
// so it can dereference `this.col(this.p.value[this.sorted[mid]])` inline.
// Read on ZAValue.prototype.find and called from sort/index.ts.
export function bisect_right(this: any, v: any, lo = 0, hi = this.sorted.length) {
  while (lo < hi) {
    const mid = lo + hi >>> 1;
    if (this.col(this.p.value[this.sorted[mid]]) < v) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

// Left-bisect for ascending-sorted arrays. Mirror of bisect_right above —
// AZValue.prototype.find uses this so the rank-tracking machinery in BU1/BI0
// works against ascending order without a parallel codepath.
export function bisect_left(this: any, v: any, lo = 0, hi = this.sorted.length) {
  while (lo < hi) {
    const mid = lo + hi >>> 1;
    if (this.col(this.p.value[this.sorted[mid]]) < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function find(a: any, v: any, lo = 0, hi = a.length) {
  while (lo < hi) {
    const mid = lo + hi >>> 1;
    if (a[mid] < v) lo = mid + 1
    else hi = mid;
  }
  return lo;
}

// Cheaper than Object.keys(obj).length === 0 — returns on first iteration.
// Hot in group's bucket-cleanup path where every batch may inspect dozens of
// per-group buckets to decide which became empty.
export function isEmpty(obj: any) {
  for (const i in obj)
    return false;
  return true;
}
