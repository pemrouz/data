// @ts-nocheck
import { isArray, iter } from '../../utils.ts'
import { Operator, view, createOperator } from '../../core.ts'

// `proxy.except(other)` is rows in the source but NOT in `other` — set
// difference. Mirrors intersect's bitmask machinery for the negative
// case: we keep p's rows that aren't in `other`, dropping rows the
// moment `other` admits them.
//
// Only one secondary source (intersection of "is in p AND is NOT in
// other"); for chained differences, just chain `.except(b).except(c)`.
export class ExceptValue extends Operator {
  constructor(p, other) {
    super()
    this.p = p
    this.otherView = other[view]
    this.otherView.connect(this)
    if (typeof p.value !== 'object') { super.XU0(); return }
    const new_value = isArray(p.value) ? [] : {}
    iter(p.value, (i, v) => {
      if (v === undefined) return
      if (this.otherView.value?.[i] === undefined) new_value[i] = v
    })
    this.view.XU0(this.view.value = new_value)
  }

  // Source XU0 (the primary swapped wholesale): rebuild from scratch,
  // filtering out keys that `other` has.
  XU0(value, v) {
    if (v === this.otherView) {
      // Other source replaced — re-evaluate every primary row.
      return this._rebuild()
    }
    // Primary swapped.
    if (typeof value !== 'object') return super.XU0()
    const new_value = isArray(value) ? [] : {}
    iter(value, (i, val) => {
      if (val === undefined) return
      if (this.otherView.value?.[i] === undefined) new_value[i] = val
    })
    this.view.XU0(this.view.value = new_value)
  }

  XR0(_, v) {
    if (v === this.otherView) {
      // Other source emptied — every primary row now passes through.
      return this._rebuild()
    }
    // Primary emptied — output is empty too.
    this.view.XU0(this.view.value = isArray(this.view.value) ? [] : {})
  }

  _rebuild() {
    const new_value = isArray(this.p.value) ? [] : {}
    iter(this.p.value, (i, v) => {
      if (v === undefined) return
      if (this.otherView.value?.[i] === undefined) new_value[i] = v
    })
    this.view.XU0(this.view.value = new_value)
  }

  // BR1 from primary: row left p → drop from output if it was there.
  // BR1 from other: row left other → row may now pass through; if p has
  // it, add it to output.
  BR1(R1, v) { this._removeFrom(R1, v, false) }

  // BH1 (consumer): an upstream sparse producer (between/filter over an ARRAY)
  // holed a row in source v — positional-stable, no shift. Same logic as BR1;
  // emits holes (BF0 admit / BH1 drop) so a positional sink mirrors them in
  // place instead of splice-shifting. Mirrors between/intersect/union.
  BH1(R1, v) { this._removeFrom(R1, v, true) }

  _removeFrom(R1, v, hole) {
    if (!R1.length) return
    const arr = isArray(this.view.value)
    if (v === this.otherView) {
      // `other` lost rows. Each affected key may now be admissible (ENTER).
      const NI0 = []
      for (let i = 0; i < R1.length; i += 2) {
        const name = R1[i]
        const pVal = this.p.value?.[name]
        if (pVal !== undefined && this.view.value[name] === undefined) {
          this.view.value[name] = pVal
          NI0.push(name, pVal)
        }
      }
      if (NI0.length) hole && arr ? this.view.BF0(NI0) : this.view.BI0(NI0)
      return
    }
    // Primary lost rows (LEAVE).
    const NR1 = []
    for (let i = 0; i < R1.length; i += 2) {
      const name = R1[i]
      if (this.view.value?.[name] !== undefined) {
        NR1.push(name, this.view.value[name])
        delete this.view.value[name]
      }
    }
    if (NR1.length) hole && arr ? this.view.BH1(NR1) : this.view.BR1(NR1)
  }

  // BU1 from primary: value at key changed; if key passes the filter, emit.
  // BU1 from other: row updated in `other`; doesn't change membership in
  // `other`, so nothing changes in our output.
  BU1(U1, v) {
    if (v === this.otherView) return
    if (!U1.length) return
    const NU1 = []
    for (let i = 0; i < U1.length; i += 2) {
      const name = U1[i]
      const val = U1[i + 1]
      if (this.otherView.value?.[name] !== undefined) continue
      if (this.view.value?.[name] === val) continue
      this.view.value[name] = val
      NU1.push(name, val)
    }
    if (NU1.length) this.view.BU1(NU1)
  }

  // BI0 from primary: maybe admit. BI0 from other: row appeared in other,
  // so if we were showing it, drop it.
  BI0(I0, v) { this._insertFrom(I0, v, false) }

  // BF0 (consumer): an upstream sparse producer filled a hole in source v —
  // positional-stable. Same logic as BI0; emits holes (BH1 drop / BF0 admit).
  BF0(I0, v) { this._insertFrom(I0, v, true) }

  _insertFrom(I0, v, hole) {
    if (!I0.length) return
    const arr = isArray(this.view.value)
    if (v === this.otherView) {
      // `other` gained rows → drop any we were showing (LEAVE).
      const NR1 = []
      for (let i = 0; i < I0.length; i += 2) {
        const name = I0[i]
        if (this.view.value?.[name] !== undefined) {
          NR1.push(name, this.view.value[name])
          delete this.view.value[name]
        }
      }
      if (NR1.length) hole && arr ? this.view.BH1(NR1) : this.view.BR1(NR1)
      return
    }
    // Primary insert (ENTER).
    const NI0 = []
    const me = this.view.value ??= isArray(this.p.value) ? [] : {}
    for (let i = 0; i < I0.length; i += 2) {
      const name = I0[i]
      const val = I0[i + 1]
      if (this.otherView.value?.[name] !== undefined) continue
      me[name] = val
      NI0.push(name, val)
    }
    if (NI0.length) hole && arr ? this.view.BF0(NI0) : this.view.BI0(NI0)
  }
}

export const except = (source, other) => createOperator(source, ExceptValue, other)
