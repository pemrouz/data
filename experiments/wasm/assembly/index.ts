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

// Greater-than filter: for each src[i], set bit i in the output mask iff
// src[i] > threshold. `len` is element count; mask must be sized
// ceil(len/32) u32 words. Returns popcount (count of rows that pass).
export function filter_gt_f64(
  srcPtr: usize, len: i32, threshold: f64, maskPtr: usize,
): i32 {
  let count: i32 = 0
  const wordCount: i32 = (len + 31) >> 5
  // Clear the mask in one tight pass first.
  for (let w: i32 = 0; w < wordCount; w++) {
    store<u32>(maskPtr + (<usize>w << 2), 0)
  }
  // Build 32 rows at a time so we shift bits into a u32 register, then store.
  let i: i32 = 0
  for (let w: i32 = 0; w < wordCount; w++) {
    let word: u32 = 0
    const end: i32 = i + 32 < len ? i + 32 : len
    for (let b: i32 = 0; i < end; i++, b++) {
      const v: f64 = load<f64>(srcPtr + (<usize>i << 3))
      if (v > threshold) {
        word |= (<u32>1) << b
        count++
      }
    }
    store<u32>(maskPtr + (<usize>w << 2), word)
  }
  return count
}

// Max over a Float64 column, restricted to indices where the mask has a
// set bit. Returns -Infinity if no bits are set. `len` is element count.
export function max_masked_f64(
  srcPtr: usize, len: i32, maskPtr: usize,
): f64 {
  let m: f64 = -Infinity
  const wordCount: i32 = (len + 31) >> 5
  let i: i32 = 0
  for (let w: i32 = 0; w < wordCount; w++) {
    let word: u32 = load<u32>(maskPtr + (<usize>w << 2))
    const end: i32 = i + 32 < len ? i + 32 : len
    // Fast skip empty words.
    if (word == 0) { i = end; continue }
    for (let b: i32 = 0; i < end; i++, b++) {
      if ((word & ((<u32>1) << b)) != 0) {
        const v: f64 = load<f64>(srcPtr + (<usize>i << 3))
        if (v > m) m = v
      }
    }
  }
  return m
}

// Popcount over a Uint32 bitmask. `len` is the count of u32 words.
export function popcnt_bitmask(maskPtr: usize, len: i32): i32 {
  let count: i32 = 0
  for (let w: i32 = 0; w < len; w++) {
    count += i32(popcnt<u32>(load<u32>(maskPtr + (<usize>w << 2))))
  }
  return count
}
