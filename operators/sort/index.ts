// @ts-nocheck
import { isArray, bisect_right, bisect_left } from '../../utils.ts'
import { Operator, value, createOperator } from '../../core.ts'

// ZAValue is the descending sort + top-n. State:
//   sorted   — every source key in descending order (kept fully so we can
//              rebuild the visible window incrementally on rank changes)
//   view.value — the first `n` entries materialized as an array
// The class also serves as the base for ascending sort (column accessor
// negated by the subclass) and for un-keyed numeric sort. Most updates only
// need to touch the n-element window: bisect to find the new rank, splice
// `sorted`, then translate the rank shift into BU1/BR1A/BI0A (or BMV1 when
// both ranks fall inside the window).
export class ZAValue extends Operator {
  matches(col, n) { return this.col_name == col && this.n == n }

  constructor(p, col, col_name, n) {
    super()
    this.p = p
    this.n = n
    this.col = col
    this.col_name = col_name
    this.XU0(p.value)
  }

  XR0(){
    this.sorted = []
    this.view.XU0(this.view.value = [])
  }

  XU0(value){
    if (typeof value !== 'object') return this.XR0()
    // Source shape is captured here (not at call time of BR1/BI0) because
    // those notifications fire *after* the source has already mutated, and
    // for arrays a removal will have shifted indices we still need to
    // translate against the pre-shift `sorted`.
    this.isArr = isArray(value)
    this.sorted = Object
      .keys(value)
      .sort((a, b) => {
        const va = this.col(value[a])
        const vb = this.col(value[b])
        return va > vb ? -1
             : va < vb ?  1
                       :  0
      })

    this.view.XU0(this.view.value = this.sorted
      .slice(0, this.n)
      .map(i => value[i])
    )
  }

  // Row removed upstream. Object sources keep stable keys, so we just
  // splice the deleted name out of `sorted` (and refill the visible window
  // from the next-ranked row if the removal was in-window). Array sources
  // require additional shift bookkeeping — see BR1A.
  BR1(R1){
    if (this.isArr) return this.BR1A(R1)
    for (let i = 0; i < R1.length; i += 2) {
      const oidx = this.get_index(R1[i])
      if (oidx === -1) continue
      this.sorted.splice(oidx, 1)
      if (oidx >= this.n) continue
      super.BR1A([oidx])
      const len = this.view.value.length
      if (this.sorted.length > len)
        super.BI0A([len, this.p.value[this.sorted[len]]])
    }
  }

  // Array source: each removal at upstream index `name` shifts all later
  // indices down by one. Sorted holds upstream keys (numeric strings); after
  // the source splice, every entry in `sorted` whose key is greater than
  // any removed index needs to decrement to match. We also re-emit an
  // in-window evict per removal that fell inside the visible window, then
  // refill the tail from whatever rows now sit at the boundary.
  BR1A(R1){
    const inWindow = []
    const removedKeys = []
    for (let i = 0; i < R1.length; i += 2) {
      const name = R1[i]
      // Always track the position for shift bookkeeping — upstream array
      // operators may forward shift-only notifications for rows that were
      // never in our `sorted` (because they were filtered out earlier in
      // the chain). We must still re-key everything else.
      removedKeys.push(+name)
      const oidx = this.sorted.indexOf(name)
      if (oidx === -1) continue
      this.sorted.splice(oidx, 1)
      if (oidx < this.n) inWindow.push(oidx)
    }

    // Shift remaining `sorted` keys to match the source's post-splice layout.
    if (removedKeys.length) {
      removedKeys.sort((a, b) => a - b)
      for (let i = 0; i < this.sorted.length; i++) {
        const k = +this.sorted[i]
        let shift = 0
        for (const r of removedKeys) { if (r < k) shift++; else break }
        if (shift) this.sorted[i] = '' + (k - shift)
      }
    }

    // Each in-window eviction shrinks `view.value` by one; remap by prior j.
    inWindow.sort((a, b) => a - b)
    for (let j = 0; j < inWindow.length; j++) super.BR1A([inWindow[j] - j])

    // Refill the window up to min(n, sorted.length) — reading p.value with
    // the post-shift keys we just wrote into `sorted`.
    const target = this.sorted.length < this.n ? this.sorted.length : this.n
    while (this.view.value.length < target) {
      const idx = this.view.value.length
      super.BI0A([idx, this.p.value[this.sorted[idx]]])
    }
  }

  // The four cases of a row's rank change, governed by where the old and
  // new ranks fall relative to the visible window of size n:
  //   • out → out: nothing observable, just update `sorted`
  //   • out → in : evict the row pushed off the tail, insert this one
  //   • in  → out: evict this one from its position, refill the tail
  //   • in  → in : in-window rotation — emitted as a single BMV1 'move'
  //                rather than N per-position updates (cheaper for change-
  //                stream consumers; index-keyed DOM sinks refresh content
  //                positionally and treat the move itself as a no-op).
  BU1(U1){
    for (let i = 0; i < U1.length; i++) {
      const name = U1[i++]
      const value = U1[i]
      const { n, p, sorted } = this
      let oidx = this.get_index(name)
      if (oidx === -1) { this.BI0([name, value]); continue }

      // Splice out *before* bisecting: by the time BU1 fires, p.value[name]
      // already holds the new sort value, so leaving `name` in `sorted`
      // would feed the bisect a non-monotonic array (its old slot now reads
      // as the new value). Binary search on a non-sorted array can skip past
      // the correct insertion point — the failure mode we hit is value
      // increases that get classified as "no change" (oidx === nidx) and
      // leave the row at its old rank.
      sorted.splice(oidx, 1)
      let nidx = this.find(this.col(this.p.value[name]))
      sorted.splice(nidx, 0, name)
      // No rank change: only forward the value update if the row is in the
      // visible window. Otherwise we'd write `view.value[oidx] = value` past
      // `n`, growing the materialized window past its limit.
      if (oidx === nidx) {
        if (oidx < n) super.BU1([oidx, value])
        continue
      }
      if (oidx >= n && nidx >= n) {}
      else if (oidx >= n && nidx <  n) {
        super.BR1A([n - 1])
        super.BI0A([nidx, p.value[sorted[nidx]]])
      } else if (oidx < n && nidx >= n) {
        super.BR1A([oidx])
        super.BI0A([n - 1, p.value[sorted[n - 1]]])
      } else if (oidx < n && nidx < n) {
        // Both ranks fall inside the visible window: this is a rotation
        // of the element from oidx to nidx. Refresh the value at oidx
        // first — whole-row replacement (`p.value[name] = newObj` rather
        // than nested mutation of an existing row) leaves view.value at
        // the old reference, which would then ride the BMV1 splice to
        // the new rank. The nested-mutation case (`row.col = …`) is
        // unaffected: value === p.value[name] is the same reference
        // that's already in view.value, the BU1 is a no-op shuffle. Then
        // emit the move event for change-stream consumers that want move
        // semantics; sinks without BMV1 (and index-keyed DOM sinks) fall
        // back to a positional content refresh over the affected range.
        super.BU1([oidx, value])
        super.BMV1([oidx, nidx])
      }
    }
  }

  // New row enters. If its rank is past the window we only need to record
  // it in `sorted`; otherwise, evict the bottom of the visible window (if
  // we're already at capacity) and splice the newcomer into its rank.
  // Array sources additionally require sliding existing keys >= `at` up by
  // one to match the source's post-splice indexing — `push` (at === length)
  // collapses to a no-op shift since nothing needs moving.
  BI0(I0){
    for (let i = 0; i < I0.length; i += 2) {
      const at = I0[i]
      const value = I0[i + 1]
      if (this.isArr) {
        const atNum = +at
        for (let j = 0; j < this.sorted.length; j++) {
          const k = +this.sorted[j]
          if (k >= atNum) this.sorted[j] = '' + (k + 1)
        }
      }
      const new_idx = this.find(this.col(this.p.value[at]))
      this.sorted.splice(new_idx, 0, at)
      if (new_idx >= this.n) continue
      if (this.view.value.length === this.n)
        super.BR1A([this.n - 1])
      super.BI0A([new_idx, value])
    }
  }

  // Nested-key changes (`row.col` mutated). If the change touches the sort
  // column we have to recompute the row's rank — funnel into BU1. Otherwise
  // it's just a deep update on a row that may or may not be visible: only
  // forward the BR2/BU2 if the row is in-window, with the key prefix
  // rewritten from upstream-name to in-window-position.
  BR2(R2) {
    for (let i = 0; i < R2.length; i++) {
      const [name, col, ...rest] = R2[i++]
      const value = R2[i]
      if (col === this.col_name) {
        this.BU1([name, this.p.value[name]])
      } else {
        const oidx = this.get_index(name)
        if (oidx < this.n)
          this.view.BR2([[`${oidx}`, col, ...rest], value])
      }
    }
  }

  BU2(U2) {
    for (let i = 0; i < U2.length; i++) {
      const [name, col, ...rest] = U2[i++]
      const value = U2[i]
      if (col === this.col_name) {
        this.BU1([name, this.p.value[name]])
      } else {
        const oidx = this.get_index(name)
        if (oidx < this.n) {
          this.view.BU2([[`${oidx}`, col, ...rest], value])
        }
      }
    }
  }

  BI2(I2){
    for (let i = 0; i < I2.length; i++) {
      const [name, ...rest] = I2[i++]
      const value = I2[i++]
      const at = I2[i]
      if (!this.has(name)) { this.BI0([name, this.p.value[name]]); continue }
      const nidx = this.get_index(name)
      if (nidx >= this.n) continue
      this.view.BI2([[`${nidx}`, ...rest], value, at])
    }
  }

  get_index(id){
    return this.sorted.indexOf(id)
  }

  has(id){ return !!~this.get_index(id) }
}
ZAValue.prototype.find = bisect_right

export class ZAColumnValue extends ZAValue {
  constructor(p, col, n = Infinity){
    super(p, d => d[col], col, n)
  }
}

export class ZANumberValue extends ZAValue {
  constructor(p, n = Infinity){
    super(p, d => d, value, n)
  }
}

// AZValue mirrors ZAValue but sorts ascending. Same state shape, same
// rank-tracking machinery — only the initial sort comparator and the
// bisect direction flip. All BU1/BR1/BI0/BR2/BU2/BI2 logic in ZAValue is
// inherited unchanged because it only ever consults `this.find` and
// `this.sorted`, both of which now follow ascending order.
//
// Why a subclass instead of a `dir` flag on ZAValue: keeping the two
// orderings as distinct classes lets `instanceof` separate them in the
// dedup check, so `proxy.za('col')` and `proxy.az('col')` never collide
// in the matches() lookup even though they share `col_name` and `n`.
export class AZValue extends ZAValue {
  XU0(value) {
    if (typeof value !== 'object') return this.XR0()
    this.sorted = Object
      .keys(value)
      .sort((a, b) => {
        const va = this.col(value[a])
        const vb = this.col(value[b])
        return va > vb ?  1
             : va < vb ? -1
                       :  0
      })
    this.view.XU0(this.view.value = this.sorted
      .slice(0, this.n)
      .map(i => value[i])
    )
  }
}
AZValue.prototype.find = bisect_left

export class AZColumnValue extends AZValue {
  constructor(p, col, n = Infinity){
    super(p, d => d[col], col, n)
  }
}

export class AZNumberValue extends AZValue {
  constructor(p, n = Infinity){
    super(p, d => d, value, n)
  }
}

// LimitValue keeps the first `n` non-undefined entries of an upstream collection
// in source iteration order. Both array and object sources are incremental:
// BR1/BI0/BU1 produce position-keyed deltas instead of triggering a full
// rescan, so downstream `group`/DOM doesn't tear down the window every time
// a brush removes a row that happened to fall inside it.
//
// State:
//   keys  — source keys currently inside the window. For arrays they're
//           numeric and stay sorted ascending so findPos/insertPos can
//           bisect; for objects they're stored as strings and looked up
//           with indexOf (linear scan, bounded by `n` so it stays cheap).
//   last  — only used for the array branch: largest key in the window;
//           refill scans source[last+1..]. For objects the refill walks
//           p.value's iteration order looking for the first key not in
//           the window.
export class LimitValue extends Operator {
  constructor(p, n) {
    super()
    this.p = p
    this.n = n
    this.XU0(this.p.value)
  }

  XR0(){ this.XU0(this.p.value) }

  XU0(value) {
    this.view.value = []
    this.keys = []
    this.isArr = isArray(value)
    if (typeof value === 'object' && value !== null) {
      if (this.isArr) {
        for (let i = 0; i < value.length; i++) {
          if (value[i] !== undefined) {
            this.view.value.push(value[i])
            this.keys.push(i)
            if (this.view.value.length === this.n) break
          }
        }
      } else {
        for (const i in value) {
          if (value[i] !== undefined) {
            this.view.value.push(value[i])
            this.keys.push(i)   // keep as string — object keys aren't always numeric
            if (this.view.value.length === this.n) break
          }
        }
      }
    }
    this.last = this.isArr && this.keys.length ? this.keys[this.keys.length - 1] : undefined
    this.view.XU0(this.view.value)
  }

  findPos(numKey) {
    let lo = 0, hi = this.keys.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      const m = this.keys[mid]
      if (m < numKey) lo = mid + 1
      else if (m > numKey) hi = mid
      else return mid
    }
    return -1
  }

  insertPos(numKey) {
    let lo = 0, hi = this.keys.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.keys[mid] < numKey) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  nextAfter(numKey) {
    const src = this.p.value
    if (!src) return undefined
    for (let i = numKey + 1; i < src.length; i++) {
      if (src[i] !== undefined) return i
    }
    return undefined
  }

  // Object-source refill helper: first key in p.value's iteration order
  // that isn't already in the window and has a defined value. Bounded by
  // `n + (source size)` per call, but typically returns on the first hit
  // past the window — fine for small to moderate sources.
  nextObjectKey() {
    const src = this.p.value
    if (!src) return undefined
    for (const k in src) {
      if (src[k] === undefined) continue
      if (this.keys.indexOf(k) !== -1) continue
      return k
    }
    return undefined
  }

  BU1(U1) {
    if (this.isArr) {
      const NU1 = []
      for (let i = 0; i < U1.length; i++) {
        const key = U1[i++]
        const val = U1[i]
        const pos = this.findPos(+key)
        if (pos === -1) continue
        this.view.value[pos] = val
        NU1.push(''+pos, val)
      }
      if (NU1.length) this.view.BU1(NU1)
      return
    }
    // Object branch: existing key in window → update at its position; brand-new
    // key (BU1 on a property not in the source before) → append if window has
    // headroom, otherwise drop (objects' iteration order puts new keys at the
    // end, past the window).
    const NU1 = []
    for (let i = 0; i < U1.length; i += 2) {
      const key = '' + U1[i]
      const val = U1[i + 1]
      const pos = this.keys.indexOf(key)
      if (pos !== -1) {
        if (val === undefined) {
          // The row left the source — same as a BR1 in effect. Splice out
          // and try to refill from the next iteration-order key.
          this.keys.splice(pos, 1)
          this.view.value.splice(pos, 1)
          super.BR1A([pos])
          const next = this.nextObjectKey()
          if (next !== undefined) {
            this.keys.push(next)
            super.BI0A([this.view.value.length, this.p.value[next]])
          }
        } else {
          this.view.value[pos] = val
          NU1.push(''+pos, val)
        }
      } else if (val !== undefined && this.keys.length < this.n) {
        this.keys.push(key)
        super.BI0A([this.view.value.length, val])
      }
    }
    if (NU1.length) this.view.BU1(NU1)
  }

  BR1(R1) {
    if (this.isArr) {
      // Large batches: each refill may scan far into a sparse source, so a
      // single XU0 walk is cheaper than n × (scan to end). Threshold matches
      // the scale where the refill cost dominates the per-item bookkeeping.
      if (R1.length > this.n * 2) { this.XU0(this.p.value); return }
      for (let i = 0; i < R1.length; i += 2) {
        const numKey = +R1[i]
        const pos = this.findPos(numKey)
        if (pos === -1) continue
        this.keys.splice(pos, 1)
        super.BR1A([pos])
        const next = this.nextAfter(this.last ?? -1)
        if (next !== undefined) {
          this.keys.push(next)
          this.last = next
          super.BI0A([this.view.value.length, this.p.value[next]])
        } else {
          this.last = this.keys.length ? this.keys[this.keys.length - 1] : undefined
        }
      }
      return
    }
    // Object branch: linear lookup, refill from iteration order.
    if (R1.length > this.n * 2) { this.XU0(this.p.value); return }
    for (let i = 0; i < R1.length; i += 2) {
      const key = '' + R1[i]
      const pos = this.keys.indexOf(key)
      if (pos === -1) continue
      this.keys.splice(pos, 1)
      super.BR1A([pos])
      const next = this.nextObjectKey()
      if (next !== undefined) {
        this.keys.push(next)
        super.BI0A([this.view.value.length, this.p.value[next]])
      }
    }
  }

  BI0(I0) {
    if (this.isArr) {
      if (I0.length > this.n * 2) { this.XU0(this.p.value); return }
      for (let i = 0; i < I0.length; i += 2) {
        const numKey = +I0[i]
        const val = I0[i + 1]
        if (this.keys.length < this.n) {
          const pos = this.insertPos(numKey)
          this.keys.splice(pos, 0, numKey)
          if (this.last === undefined || numKey > this.last) this.last = numKey
          super.BI0A([pos, val])
        } else if (numKey < this.last) {
          const pos = this.insertPos(numKey)
          this.keys.pop()
          super.BR1A([this.n - 1])
          this.keys.splice(pos, 0, numKey)
          this.last = this.keys[this.keys.length - 1]
          super.BI0A([pos, val])
        }
      }
      return
    }
    // Object insert is rare (BU1 covers most "new key" paths). Treat as an
    // append-if-room — object iteration puts inserted keys at the end, past
    // the window if the window is full.
    for (let i = 0; i < I0.length; i += 2) {
      const key = '' + I0[i]
      const val = I0[i + 1]
      if (val === undefined) continue
      if (this.keys.indexOf(key) !== -1) continue
      if (this.keys.length < this.n) {
        this.keys.push(key)
        super.BI0A([this.view.value.length, val])
      }
    }
  }

  BR2(){}
  BU2(){}
  BI2(){}
}

export const sort = (source, a, b) => {
  const Class = typeof a === 'string' ? ZAColumnValue : ZANumberValue
  return createOperator(source, Class, a, b)
}

export const limit = (source, n) => createOperator(source, LimitValue, n)
