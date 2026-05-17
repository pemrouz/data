// Loads the AssemblyScript-compiled kernels and returns typed handles plus
// helpers for laying out data in shared linear memory. Memory views are
// re-acquired after a `grow()` call because the underlying ArrayBuffer is
// detached on grow.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

export interface Kernels {
  memory: WebAssembly.Memory
  max_f64(ptr: number, len: number): number
  min_f64(ptr: number, len: number): number
  sum_f64(ptr: number, len: number): number
  between_f64(srcPtr: number, srcLen: number, lo: number, hi: number, outPtr: number): number
  bitmask_and(aPtr: number, bPtr: number, len: number): number
  filter_gt_f64(srcPtr: number, len: number, threshold: number, maskPtr: number): number
  max_masked_f64(srcPtr: number, len: number, maskPtr: number): number
  popcnt_bitmask(maskPtr: number, len: number): number
  ensureBytes(bytes: number): void
  f64View(): Float64Array
  u32View(): Uint32Array
}

export function loadKernels(wasmPath?: string): Kernels {
  const here = dirname(fileURLToPath(import.meta.url))
  const path = wasmPath ?? resolve(here, 'build/release.wasm')
  const bytes = readFileSync(path)
  const mod = new WebAssembly.Module(bytes)
  const instance = new WebAssembly.Instance(mod, {})
  const exports = instance.exports as any
  const memory = exports.memory as WebAssembly.Memory

  let f64 = new Float64Array(memory.buffer)
  let u32 = new Uint32Array(memory.buffer)

  const refresh = () => {
    f64 = new Float64Array(memory.buffer)
    u32 = new Uint32Array(memory.buffer)
  }

  return {
    memory,
    max_f64: exports.max_f64,
    min_f64: exports.min_f64,
    sum_f64: exports.sum_f64,
    between_f64: exports.between_f64,
    bitmask_and: exports.bitmask_and,
    filter_gt_f64: exports.filter_gt_f64,
    max_masked_f64: exports.max_masked_f64,
    popcnt_bitmask: exports.popcnt_bitmask,
    ensureBytes(bytes: number) {
      const have = memory.buffer.byteLength
      if (have >= bytes) return
      const PAGE = 65536
      const deltaPages = Math.ceil((bytes - have) / PAGE)
      memory.grow(deltaPages)
      refresh()
    },
    f64View() { return f64 },
    u32View() { return u32 },
  }
}
