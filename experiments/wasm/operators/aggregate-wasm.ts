// @ts-nocheck
// WASM-backed Max/Min aggregates. Maintains a packed Float64Array slice of
// shared wasm linear memory: every BU1/BR1/BI0 writes one f64 directly into
// wasm memory, so `_publish` can call the wasm `max_f64` / `min_f64` kernel
// over the packed slice without per-call extraction.
//
// Slot management: each tracked source-key is mapped to a slot index. Inserts
// take a slot from the free list (or extend `nextSlot`). Removes write a
// sentinel (-Infinity for max, +Infinity for min) into the slot and push it
// onto the free list — so the kernel scans `[0, nextSlot)` and the sentinel
// is benign. After many removes the scan can include waste; for a steady-
// state brushed view (where size ≈ tracked count) this is negligible.

import { iter } from '../../../utils.ts'
import { Operator, createOperator } from '../../../core.ts'
import { type Kernels } from '../loader.ts'

const PAGE = 65536
const F64_BYTES = 8

// Static allocator over wasm memory. Each WasmAggregateValue gets a contiguous
// f64 slice. We hand out slices in PAGE-aligned chunks so concurrent operators
// don't tread on each other.
let _wasmCursorBytes = 0
function _allocSlice(kernels: Kernels, capacityF64: number): { byteOffset: number, capacity: number } {
  const bytes = capacityF64 * F64_BYTES
  // Align to PAGE boundary so growth is cheap.
  const aligned = Math.ceil(bytes / PAGE) * PAGE
  const offset = _wasmCursorBytes
  _wasmCursorBytes += aligned
  kernels.ensureBytes(_wasmCursorBytes)
  return { byteOffset: offset, capacity: aligned / F64_BYTES }
}

class WasmAggregateValue extends Operator {
  // sentinel: value to store in freed slots so the kernel ignores them.
  // Subclass sets it (-Infinity for max, +Infinity for min).
  constructor(p, col, kernels: Kernels, sentinel: number, initialCapacity: number) {
    super()
    this.p = p
    this.col = col
    this.kernels = kernels
    this.sentinel = sentinel
    this.read = typeof col === 'string' ? (r => r?.[col]) : (r => r)

    const { byteOffset, capacity } = _allocSlice(kernels, initialCapacity)
    this.byteOffset = byteOffset
    this.f64Offset = byteOffset / F64_BYTES
    this.capacity = capacity

    this.slotMap = new Map() // source key → slot index
    this.freeSlots = []
    this.nextSlot = 0

    this.XU0(p.value)
  }

  matches(col) { return this.col === col }

  _project(v) {
    if (v === undefined) return undefined
    const x = this.read(v)
    return x === undefined || x === null ? undefined : x
  }

  _grow(needed: number) {
    while (this.capacity < needed) this.capacity *= 2
    // Heads up: this only works because we're the only allocator using
    // `_wasmCursorBytes` — if another instance allocated after us, growing
    // in place would clobber it. For a single-instance experiment this is
    // fine; a real impl would have to reallocate or use a real allocator.
    this.kernels.ensureBytes(this.byteOffset + this.capacity * F64_BYTES)
  }

  _addSlot(key, value: number) {
    let slot = this.freeSlots.length ? this.freeSlots.pop() : this.nextSlot++
    if (slot >= this.capacity) this._grow(slot + 1)
    this.slotMap.set(key, slot)
    this.kernels.f64View()[this.f64Offset + slot] = value
  }

  _updateSlot(key, value: number) {
    const slot = this.slotMap.get(key)
    if (slot === undefined) {
      this._addSlot(key, value); return
    }
    this.kernels.f64View()[this.f64Offset + slot] = value
  }

  _removeSlot(key) {
    const slot = this.slotMap.get(key)
    if (slot === undefined) return
    this.slotMap.delete(key)
    this.kernels.f64View()[this.f64Offset + slot] = this.sentinel
    this.freeSlots.push(slot)
  }

  XR0() {
    this.slotMap.clear()
    this.freeSlots.length = 0
    this.nextSlot = 0
    this._publish()
  }

  XU0(value) {
    this.slotMap.clear()
    this.freeSlots.length = 0
    this.nextSlot = 0
    if (value && typeof value === 'object') {
      iter(value, (n, v) => {
        const x = this._project(v)
        if (x !== undefined) this._addSlot(n, x)
      })
    }
    this._publish()
  }

  BU1(U1) {
    if (!U1.length) return
    let dirty = false
    for (let i = 0; i < U1.length; i += 2) {
      const n = U1[i]
      const x = this._project(U1[i + 1])
      if (this.slotMap.has(n)) {
        if (x === undefined) { this._removeSlot(n); dirty = true }
        else { this._updateSlot(n, x); dirty = true }
      } else if (x !== undefined) {
        this._addSlot(n, x); dirty = true
      }
    }
    if (dirty) this._publish()
  }

  BR1(R1) {
    if (!R1.length) return
    let dirty = false
    for (let i = 0; i < R1.length; i += 2) {
      const n = R1[i]
      if (this.slotMap.has(n)) { this._removeSlot(n); dirty = true }
    }
    if (dirty) this._publish()
  }

  BI0(I0) {
    if (!I0.length) return
    let dirty = false
    for (let i = 0; i < I0.length; i += 2) {
      const n = I0[i]
      const x = this._project(I0[i + 1])
      if (x !== undefined) {
        if (this.slotMap.has(n)) this._updateSlot(n, x)
        else this._addSlot(n, x)
        dirty = true
      }
    }
    if (dirty) this._publish()
  }

  // Nested-key path mutations: re-project from p.value, same as the JS aggregate.
  BU2(U2) { this._reprojectFromKeys(U2, 2) }
  BR2(R2) { this._reprojectFromKeys(R2, 2) }
  BI2(I2) { this._reprojectFromKeys(I2, 3) }

  _reprojectFromKeys(arr, stride) {
    if (!arr.length) return
    let dirty = false
    for (let i = 0; i < arr.length; i += stride) {
      const path = arr[i]
      const n = path[0]
      const x = this._project(this.p.value[n])
      if (this.slotMap.has(n)) {
        if (x === undefined) { this._removeSlot(n); dirty = true }
        else { this._updateSlot(n, x); dirty = true }
      } else if (x !== undefined) {
        this._addSlot(n, x); dirty = true
      }
    }
    if (dirty) this._publish()
  }

  _publish() { /* subclass */ }
}

export class WasmMaxValue extends WasmAggregateValue {
  constructor(p, col, kernels: Kernels, capacity = 65536) {
    super(p, col, kernels, -Infinity, capacity)
  }
  _publish() {
    if (this.slotMap.size === 0) {
      if (this.view.value !== undefined) this.view.XU0(this.view.value = undefined)
      return
    }
    const m = this.kernels.max_f64(this.byteOffset, this.nextSlot)
    if (m !== this.view.value) this.view.XU0(this.view.value = m)
  }
}

// Reference path: same packed Float64Array layout as WasmMaxValue, but the
// scan happens in JS. Isolates the WASM-specific gain from the data-structure
// gain (eliminating per-tick `Object.values(tracked)` allocation).
export class TypedMaxValue extends WasmAggregateValue {
  constructor(p, col, kernels: Kernels, capacity = 65536) {
    super(p, col, kernels, -Infinity, capacity)
  }
  _publish() {
    if (this.slotMap.size === 0) {
      if (this.view.value !== undefined) this.view.XU0(this.view.value = undefined)
      return
    }
    const f64 = this.kernels.f64View()
    const start = this.f64Offset
    const end = start + this.nextSlot
    let m = f64[start]
    for (let i = start + 1; i < end; i++) {
      const v = f64[i]
      if (v > m) m = v
    }
    if (m !== this.view.value) this.view.XU0(this.view.value = m)
  }
}

export class WasmMinValue extends WasmAggregateValue {
  constructor(p, col, kernels: Kernels, capacity = 65536) {
    super(p, col, kernels, Infinity, capacity)
  }
  _publish() {
    if (this.slotMap.size === 0) {
      if (this.view.value !== undefined) this.view.XU0(this.view.value = undefined)
      return
    }
    const m = this.kernels.min_f64(this.byteOffset, this.nextSlot)
    if (m !== this.view.value) this.view.XU0(this.view.value = m)
  }
}

export const wasmMax = (kernels: Kernels) => (source, col) => createOperator(source, WasmMaxValue, col, kernels)
export const wasmMin = (kernels: Kernels) => (source, col) => createOperator(source, WasmMinValue, col, kernels)
export const typedMax = (kernels: Kernels) => (source, col) => createOperator(source, TypedMaxValue, col, kernels)
