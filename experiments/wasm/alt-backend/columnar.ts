// Alt-backend: columnar storage with declarative ("serializable") operators.
//
// Two flavours:
//   - ColumnarJsBackend   — columns + mask are plain JS typed arrays; ops in JS.
//   - ColumnarWasmBackend — same layout but stored inside WASM linear memory;
//                           bulk ops dispatch to wasm kernels.
//
// Both expose the same API:
//   setup(rows)              — initial load. derives spread = ask - bid in bulk.
//   tick(idx, field, value)  — single-row update, also recomputes spread.
//   getCount()               — count of rows with spread >= threshold.
//   getMax()                 — max(spread) over those rows. -Infinity if empty.
//   reset(threshold)         — change threshold, full rebuild of mask + scalars.
//
// The point of the experiment: with serializable predicates and resident
// columnar data, can a WASM-backed path beat (a) the lib operating on JS row
// objects via `.between('spread',[T,Inf]).max('spread')`, and (b) the same
// algorithm written in JS over the same typed arrays?

import { type Kernels } from '../loader.ts'

export interface AltBackend {
  setup(rows: { bid: number, ask: number }[], threshold: number): void
  tick(idx: number, field: 'bid' | 'ask', value: number): void
  setThreshold(threshold: number): void
  getCount(): number
  getMax(): number
}

// --- pure-JS columnar backend ---

export class ColumnarJsBackend implements AltBackend {
  bid!: Float64Array
  ask!: Float64Array
  spread!: Float64Array
  mask!: Uint32Array
  n = 0
  wordCount = 0
  threshold = 0
  count = 0
  // Running max + the index that holds it. -1 means "no row qualifies".
  // When the holder drops out of the mask or has its spread reduced below the
  // running max, we rescan over the mask to find a new max.
  maxVal = -Infinity
  maxIdx = -1

  setup(rows, threshold) {
    this.threshold = threshold
    this.n = rows.length
    this.wordCount = (this.n + 31) >> 5
    this.bid = new Float64Array(this.n)
    this.ask = new Float64Array(this.n)
    this.spread = new Float64Array(this.n)
    this.mask = new Uint32Array(this.wordCount)
    // Bulk derive + bulk filter + bulk max in one pass.
    let count = 0, maxVal = -Infinity, maxIdx = -1
    for (let i = 0; i < this.n; i++) {
      const b = rows[i].bid, a = rows[i].ask
      this.bid[i] = b
      this.ask[i] = a
      const s = a - b
      this.spread[i] = s
      if (s >= threshold) {
        this.mask[i >>> 5] |= (1 << (i & 31))
        count++
        if (s > maxVal) { maxVal = s; maxIdx = i }
      }
    }
    this.count = count
    this.maxVal = count ? maxVal : -Infinity
    this.maxIdx = maxIdx
  }

  tick(idx, field, value) {
    if (field === 'bid') this.bid[idx] = value; else this.ask[idx] = value
    const newSpread = this.ask[idx] - this.bid[idx]
    this.spread[idx] = newSpread
    const word = idx >>> 5, bit = 1 << (idx & 31)
    const oldBit = (this.mask[word] & bit) !== 0
    const newBit = newSpread >= this.threshold
    if (newBit !== oldBit) {
      if (newBit) { this.mask[word] |= bit; this.count++ }
      else        { this.mask[word] &= ~bit; this.count-- }
    }
    if (newBit) {
      if (newSpread > this.maxVal) { this.maxVal = newSpread; this.maxIdx = idx }
      else if (idx === this.maxIdx) this._rescanMax()
    } else if (idx === this.maxIdx) {
      // Holder dropped out of the masked set.
      this._rescanMax()
    }
  }

  _rescanMax() {
    let m = -Infinity, mi = -1
    const mask = this.mask, spread = this.spread, n = this.n, wc = this.wordCount
    let i = 0
    for (let w = 0; w < wc; w++) {
      let word = mask[w]
      const end = i + 32 < n ? i + 32 : n
      if (word === 0) { i = end; continue }
      for (let b = 0; i < end; i++, b++) {
        if ((word & (1 << b)) !== 0) {
          const v = spread[i]
          if (v > m) { m = v; mi = i }
        }
      }
    }
    this.maxVal = mi === -1 ? -Infinity : m
    this.maxIdx = mi
  }

  // Full re-eval of mask + scalars after a threshold change. Exercises the
  // bulk path that the wasm backend will dispatch to a kernel.
  setThreshold(threshold) {
    this.threshold = threshold
    let count = 0, maxVal = -Infinity, maxIdx = -1
    const spread = this.spread, mask = this.mask, wc = this.wordCount, n = this.n
    for (let w = 0; w < wc; w++) mask[w] = 0
    for (let i = 0; i < n; i++) {
      const s = spread[i]
      if (s >= threshold) {
        mask[i >>> 5] |= (1 << (i & 31))
        count++
        if (s > maxVal) { maxVal = s; maxIdx = i }
      }
    }
    this.count = count
    this.maxVal = count ? maxVal : -Infinity
    this.maxIdx = maxIdx
  }

  getCount() { return this.count }
  getMax() { return this.maxVal }
}

// --- WASM-backed columnar backend ---
//
// Memory layout in wasm linear memory:
//   offset 0          bid:    n * 8 bytes
//   offset n*8        ask:    n * 8 bytes
//   offset n*16       spread: n * 8 bytes
//   offset n*24       mask:   ceil(n/32) * 4 bytes
//
// Per-tick work is done in JS through the f64/u32 views: a single typed-array
// store is far cheaper than a WASM boundary crossing for an O(1) operation.
// The wasm kernels are reserved for bulk ops (setup-time fill, full re-eval
// on threshold change, and rescan-max when the running-max holder drops).

export class ColumnarWasmBackend implements AltBackend {
  kernels: Kernels
  n = 0
  wordCount = 0
  bidOff = 0
  askOff = 0
  spreadOff = 0
  maskOff = 0
  threshold = 0
  count = 0
  maxVal = -Infinity
  maxIdx = -1
  // Cached views — refreshed only after a `setup` (we don't grow memory mid-bench).
  // Direct view access in the hot path matters: a per-tick `this.kernels.f64View()`
  // call adds visible overhead on a 0.1µs/tick budget.
  _f64!: Float64Array
  _u32!: Uint32Array

  constructor(kernels: Kernels) { this.kernels = kernels }

  setup(rows, threshold) {
    this.threshold = threshold
    this.n = rows.length
    this.wordCount = (this.n + 31) >> 5
    const f64BytesPerCol = this.n * 8
    this.bidOff = 0
    this.askOff = f64BytesPerCol
    this.spreadOff = f64BytesPerCol * 2
    this.maskOff = f64BytesPerCol * 3
    const totalBytes = this.maskOff + this.wordCount * 4
    this.kernels.ensureBytes(totalBytes)
    this._f64 = this.kernels.f64View()
    this._u32 = this.kernels.u32View()
    const f64 = this._f64
    // Copy bid/ask into wasm memory and derive spread in the same pass.
    const bidIdx = this.bidOff >>> 3
    const askIdx = this.askOff >>> 3
    const spreadIdx = this.spreadOff >>> 3
    for (let i = 0; i < this.n; i++) {
      const b = rows[i].bid, a = rows[i].ask
      f64[bidIdx + i] = b
      f64[askIdx + i] = a
      f64[spreadIdx + i] = a - b
    }
    // Bulk filter -> mask. Returns popcount.
    this.count = this.kernels.filter_gt_f64(this.spreadOff, this.n, threshold - Number.EPSILON, this.maskOff)
    // Bulk max over the mask.
    this.maxVal = this.count
      ? this.kernels.max_masked_f64(this.spreadOff, this.n, this.maskOff)
      : -Infinity
    // We don't know the argmax from the kernel — locate it. This is bench-time
    // bookkeeping; the kernel could return both with two outputs if needed.
    if (this.count) {
      const spread = this._f64
      const u32 = this._u32
      const mask = this.maskOff >>> 2
      let mi = -1
      let i = 0
      for (let w = 0; w < this.wordCount; w++) {
        let word = u32[mask + w]
        const end = i + 32 < this.n ? i + 32 : this.n
        if (word === 0) { i = end; continue }
        for (let b = 0; i < end; i++, b++) {
          if ((word & (1 << b)) !== 0 && spread[spreadIdx + i] === this.maxVal) {
            mi = i; break
          }
        }
        if (mi !== -1) break
      }
      this.maxIdx = mi
    } else {
      this.maxIdx = -1
    }
  }

  tick(idx, field, value) {
    const f64 = this._f64
    const bidIdx = (this.bidOff >>> 3) + idx
    const askIdx = (this.askOff >>> 3) + idx
    const spreadIdx = (this.spreadOff >>> 3) + idx
    if (field === 'bid') f64[bidIdx] = value; else f64[askIdx] = value
    const newSpread = f64[askIdx] - f64[bidIdx]
    f64[spreadIdx] = newSpread

    const u32 = this._u32
    const maskIdx = (this.maskOff >>> 2) + (idx >>> 5)
    const bit = 1 << (idx & 31)
    const oldBit = (u32[maskIdx] & bit) !== 0
    const newBit = newSpread >= this.threshold
    if (newBit !== oldBit) {
      if (newBit) { u32[maskIdx] |= bit; this.count++ }
      else        { u32[maskIdx] &= ~bit; this.count-- }
    }
    if (newBit) {
      if (newSpread > this.maxVal) { this.maxVal = newSpread; this.maxIdx = idx }
      else if (idx === this.maxIdx) this._rescanMax()
    } else if (idx === this.maxIdx) {
      this._rescanMax()
    }
  }

  // Rescan via the wasm kernel. We pay the boundary cost but the work is O(n).
  _rescanMax() {
    if (this.count === 0) { this.maxVal = -Infinity; this.maxIdx = -1; return }
    this.maxVal = this.kernels.max_masked_f64(this.spreadOff, this.n, this.maskOff)
    // Locate argmax (same JS-side pass as in setup).
    const spread = this._f64
    const u32 = this._u32
    const mask = this.maskOff >>> 2
    const spreadIdx = this.spreadOff >>> 3
    let mi = -1
    let i = 0
    for (let w = 0; w < this.wordCount; w++) {
      let word = u32[mask + w]
      const end = i + 32 < this.n ? i + 32 : this.n
      if (word === 0) { i = end; continue }
      for (let b = 0; i < end; i++, b++) {
        if ((word & (1 << b)) !== 0 && spread[spreadIdx + i] === this.maxVal) {
          mi = i; break
        }
      }
      if (mi !== -1) break
    }
    this.maxIdx = mi
  }

  setThreshold(threshold) {
    this.threshold = threshold
    this.count = this.kernels.filter_gt_f64(this.spreadOff, this.n, threshold - Number.EPSILON, this.maskOff)
    this.maxVal = this.count
      ? this.kernels.max_masked_f64(this.spreadOff, this.n, this.maskOff)
      : -Infinity
    if (this.count) {
      const spread = this._f64
      const u32 = this._u32
      const mask = this.maskOff >>> 2
      const spreadIdx = this.spreadOff >>> 3
      let mi = -1
      let i = 0
      for (let w = 0; w < this.wordCount; w++) {
        let word = u32[mask + w]
        const end = i + 32 < this.n ? i + 32 : this.n
        if (word === 0) { i = end; continue }
        for (let b = 0; i < end; i++, b++) {
          if ((word & (1 << b)) !== 0 && spread[spreadIdx + i] === this.maxVal) {
            mi = i; break
          }
        }
        if (mi !== -1) break
      }
      this.maxIdx = mi
    } else {
      this.maxIdx = -1
    }
  }

  getCount() { return this.count }
  getMax() { return this.maxVal }
}
