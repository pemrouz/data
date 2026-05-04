// @ts-nocheck
import { Operator, createOperator } from './core.ts'

export class DebounceValue extends Operator {
  constructor(p, fn, ms = 1000) {
    super()
    this.p = p
    this.fn = fn
    this.ms = ms
    this.bulk()
  }
  calc = () => {
    delete this.pending
    const value = this.fn(this.p.value, this.view.value)
    if (value === this.view.value) return
    const o = []
    super.U0({ value }, o)
    this.view.bulk(o)
  }
  bulk() {
    if (this.pending) return
    this.pending = setTimeout(this.calc, this.ms)
  }
}

export const debounce = (source, fn, ms) => createOperator(source, DebounceValue, fn, ms)
