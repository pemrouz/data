// Trades-dashboard workload: 10 000 limit orders, each { id, bid, ask }.
// Ticks replace one row's bid or ask. A slowly drifting REGIME drives the
// generation — three sine waves (mid drift, half-spread bias, bid/ask
// imbalance) with incommensurate periods so the depth chart evolves
// visibly over time without ever exactly repeating.
//
// The minimum half-spread is 4 so that even at the regime mid's ±2
// extremes, bids land cleanly in buckets 0–6 and asks in 8–14, leaving
// bucket 7 (centered on $75) as the always-empty mid banner.

export const N = 10_000
export const THRESHOLD = 24
export const PRICE_LO = 50
export const PRICE_HI = 100
export const PRICE_BINS = 15
export const MID_TARGET = 75
export const MID_BUCKET = priceBucket(MID_TARGET)

export function priceBucket(p) {
  if (p <= PRICE_LO) return 0
  if (p >= PRICE_HI) return PRICE_BINS - 1
  return Math.floor((p - PRICE_LO) / (PRICE_HI - PRICE_LO) * PRICE_BINS)
}

export function bucketPrice(idx) {
  return PRICE_LO + (idx + 0.5) * (PRICE_HI - PRICE_LO) / PRICE_BINS
}

export function lcg(seed) {
  let s = seed >>> 0
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x1_0000_0000 }
}

function biasedHalfSpread(r1, r2, spreadScale) {
  // Min of two uniforms → mode at 0 → orders cluster near the mid.
  // Floor of 4 keeps bid/ask cleanly outside bucket 7 at all regime mids.
  return 4 + Math.min(r1, r2) * spreadScale
}

// Regime: shared mutable state — both initial generation AND every tick
// consult the same regime() so the page-load distribution matches the
// regime at t≈0 and live ticks track the drift smoothly.
const REGIME_T0 = performance.now()
export function regime() {
  const t = (performance.now() - REGIME_T0) / 1000
  return {
    mid:       MID_TARGET + Math.sin(2 * Math.PI * t / 22) * 2.0,
    spread:    6 + (Math.sin(2 * Math.PI * t / 17) + 1) / 2 * 12, // 6..18
    imbalance: Math.sin(2 * Math.PI * t / 13) * 0.25,             // ±0.25
  }
}

// Initial 10k rows, all anchored to the regime at the time of import.
// Both data and mobx start from this snapshot; ticks then evolve the state.
export function makeInitial() {
  const rand = lcg(42)
  const r0 = regime()
  const initial = {}
  for (let i = 0; i < N; i++) {
    const halfSpread = biasedHalfSpread(rand(), rand(), r0.spread)
    initial[i] = { id: i, bid: r0.mid - halfSpread, ask: r0.mid + halfSpread }
  }
  return initial
}

// nextTick is a closure factory so the random stream is isolated from
// any other consumer of lcg(). Returned ticks have shape:
//   { idx, field: 'bid'|'ask', newValue: number }
// — chosen to map cleanly onto a BU1 row replace: trades[idx] = { ...cur,
// [field]: newValue }.
export function makeTickStream(seed = 7) {
  const r = lcg(seed)
  return function nextTick() {
    const reg = regime()
    const idx = (r() * N) | 0
    const field = r() < (0.5 + reg.imbalance) ? 'ask' : 'bid'
    const halfSpread = biasedHalfSpread(r(), r(), reg.spread)
    const newValue = field === 'bid' ? reg.mid - halfSpread : reg.mid + halfSpread
    return { idx, field, newValue }
  }
}
