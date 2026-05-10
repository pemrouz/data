// AssemblyScript kernels — compiled to WebAssembly via `asc`.
//
// The JS side owns memory layout. Each kernel takes raw byte offsets into the
// shared memory plus a length. No allocation happens inside wasm — the runtime
// is `stub`, which omits the GC and the heap walker. We use raw load/store so
// that we never construct typed-array headers in linear memory.

// max over a contiguous Float64 buffer.
export function max_f64(ptr: usize, len: i32): f64 {
  if (len == 0) return NaN
  let m: f64 = load<f64>(ptr)
  for (let i: i32 = 1; i < len; i++) {
    const v: f64 = load<f64>(ptr + (<usize>i << 3))
    if (v > m) m = v
  }
  return m
}

// min over a contiguous Float64 buffer.
export function min_f64(ptr: usize, len: i32): f64 {
  if (len == 0) return NaN
  let m: f64 = load<f64>(ptr)
  for (let i: i32 = 1; i < len; i++) {
    const v: f64 = load<f64>(ptr + (<usize>i << 3))
    if (v < m) m = v
  }
  return m
}

// sum over a contiguous Float64 buffer (used as a sanity-check kernel —
// the JS path is already O(1) in the library, so this is reference only).
export function sum_f64(ptr: usize, len: i32): f64 {
  let s: f64 = 0
  for (let i: i32 = 0; i < len; i++) {
    s += load<f64>(ptr + (<usize>i << 3))
  }
  return s
}

// Range filter: writes the *index* of every src[i] in [lo, hi] to outPtr.
// Returns the count of matches written. Caller owns sizing the output buffer.
export function between_f64(
  srcPtr: usize, srcLen: i32, lo: f64, hi: f64, outPtr: usize,
): i32 {
  let k: i32 = 0
  for (let i: i32 = 0; i < srcLen; i++) {
    const v: f64 = load<f64>(srcPtr + (<usize>i << 3))
    if (v >= lo && v <= hi) {
      store<i32>(outPtr + (<usize>k << 2), i)
      k++
    }
  }
  return k
}

// Bitmask AND across two Uint32 buffers, returning popcount of the AND.
// `len` is the count of u32 words.
export function bitmask_and(aPtr: usize, bPtr: usize, len: i32): i32 {
  let count: i32 = 0
  for (let i: i32 = 0; i < len; i++) {
    const off: usize = <usize>i << 2
    const v: u32 = load<u32>(aPtr + off) & load<u32>(bPtr + off)
    count += i32(popcnt<u32>(v))
  }
  return count
}
