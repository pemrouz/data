// @ts-nocheck
import { isArray, bisect_right } from '../../utils.ts'
import { Operator, value, createOperator } from '../../core.ts'

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

  BR1(R1){
    for (let i = 0; i < R1.length; i++) {
      const oidx = this.get_index(R1[i++])
      this.sorted.splice(oidx, 1)
      if (oidx >= this.n) return
      super.BR1A([oidx])
      const len = this.view.value.length
      if (this.sorted.length > len)
        super.BI0A([len, this.p.value[this.sorted[len]]])
    }
  }

  BU1(U1){
    for (let i = 0; i < U1.length; i++) {
      const name = U1[i++]
      const value = U1[i]
      const { n, p, sorted } = this
      let oidx = this.get_index(name)
      if (oidx === -1) { this.BI0([name, value]); continue }

      let nidx = this.find(this.col(this.p.value[name]))
      if (oidx === nidx) { super.BU1([oidx, value]); continue }
      if (nidx > oidx) nidx--
      sorted.splice(oidx, 1)
      sorted.splice(nidx, 0, name)
      if (oidx >= n && nidx >= n) {}
      else if (oidx >= n && nidx <  n) {
        super.BR1A([n - 1])
        super.BI0A([nidx, p.value[sorted[nidx]]])
      } else if (oidx < n && nidx >= n) {
        super.BR1A([oidx])
        super.BI0A([n - 1, p.value[sorted[n - 1]]])
      } else if (oidx < n && nidx < n) {
        // Both ranks fall inside the visible window: this is a rotation
        // of the element from oidx to nidx. Emit a single move event so
        // sinks that care about identity (DOMSink uses insertBefore on
        // the same element) preserve it; sinks that don't fall back to
        // BU1 over the affected range automatically.
        super.BMV1([oidx, nidx])
      }
    }
  }

  BI0(I0){
    for (let i = 0; i < I0.length; i++) {
      const at = I0[i++]
      const value = I0[i]
      const new_idx = this.find(this.col(this.p.value[at]))
      this.sorted.splice(new_idx, 0, at)
      if (new_idx >= this.n) return
      if (this.view.value.length === this.n)
        super.BR1A([this.n - 1])
      super.BI0A([new_idx, value])
    }
  }

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

// LimitValue keeps the first `n` non-undefined entries of an upstream collection
// in source iteration order. The array branch is incremental: BR1/BI0/BU1
// produce position-keyed deltas instead of triggering a full rescan, so
// downstream `group`/DOM doesn't tear down the window every time a brush
// removes a row that happened to fall inside it.
//
// State:
//   keys  — source keys currently inside the window, sorted ascending (numeric
//           comparison works for sparse arrays whose keys are numeric strings)
//   last  — largest key in the window; refill scans source[last+1..]
//
// The object branch falls back to full XU0 because for-in insertion order is
// not numerically comparable.
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
            this.keys.push(+i)
            if (this.view.value.length === this.n) break
          }
        }
      }
    }
    this.last = this.keys.length ? this.keys[this.keys.length - 1] : undefined
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

  BU1(U1) {
    if (!this.isArr) { this.XU0(this.p.value); return }
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
  }

  BR1(R1) {
    if (!this.isArr) { this.XU0(this.p.value); return }
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
  }

  BI0(I0) {
    if (!this.isArr) { this.XU0(this.p.value); return }
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
