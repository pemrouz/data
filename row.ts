// @ts-nocheck
import { isArray } from './utils.ts'
import { Operator } from './core.ts'

export class RowOperator extends Operator {
  process() { throw new Error('not implemented, process:', this.name) }

  loop(C, inc, inner) {
    const NU1 = [], NI0 = [], NR1 = []
    for (let i = 0; i < C.length; i += inc) {
      const name = inner ? C[i][0] : C[i]
      const old_val = this.view.value?.[name]
      const now_val = this.process(this.p.value[name], name, old_val)
      const old = old_val !== undefined
      const now = now_val !== undefined
      if ( old &&  now) { NU1.push(name, now_val); this.view.value[name] = now_val }
      else if (!old &&  now) { NI0.push(name, now_val); this.view.value[name] = now_val }
      else if ( old && !now) { NR1.push(name, old_val); delete this.view.value[name] }
    }
    this.view.BU1(NU1)
    this.view.BI0(NI0)
    this.view.BR1(NR1)
  }

  XU0(value){
    if (typeof value !== 'object') return this.view.XU0(this.view.value = undefined)
    const n = isArray(value) ? [] : {}
    for (const i in value) {
      const v = this.process(value[i], i, this.view.value?.[i])
      if (v !== undefined) n[i] = v
    }
    this.view.XU0(this.view.value = n)
  }
  BU1(U1) { this.loop(U1, 2, false) }
  BU2(U2) { this.loop(U2, 2, true ) }
  BI0(I0) { this.loop(I0, 2, false) }
  BI2(I2) { this.loop(I2, 3, true) }
  BR2(R2) { this.loop(R2, 2, true) }
  XR0(){ super.XR0() }
  BR1(R1) {
    const NR1 = []
    for (let i = 0; i < R1.length; i++) {
      const name = R1[i++]
      const value = this.view.value?.[name]
      if (value !== undefined) {
        delete this.view.value[name]
        NR1.push(name, value)
      }
    }
    this.view.BR1(NR1)
  }
}
