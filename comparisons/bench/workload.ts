// @ts-nocheck
// Trades-with-ticking workload. Pipeline:
//
//   src.map(t => ({...t, spread: t.ask - t.bid}))
//      .filter(t => t.spread > THRESHOLD)
//      .length()
//
// `map` derives a `spread` column per row. `filter` rejects rows whose spread
// is at or below THRESHOLD. `length()` counts the survivors. The threshold and
// initial distribution are chosen so roughly half of rows pass on initial
// build — the filtered set is non-trivial.
//
// "Ticks" simulate a streaming market data feed: each tick changes one row's
// `bid` or `ask`. Each tick is its own settle point — no batching primitive is
// used in any peer library. This is the workload `data` was designed for.

export const N = 10_000
export const TICK_COUNT = 1000
export const THRESHOLD = 1.0
export const TOP_K = 10
export const SEED = 42
export const TICK_SEED = 7

export type Trade = { id: number, bid: number, ask: number }

function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x1_0000_0000
  }
}

// bid ∈ [50, 100); spread ∈ [0, 2) → ask = bid + spread.
// THRESHOLD = 1.0 sits at the midpoint, so ~50% of rows pass initially.
export function makeTrades(n: number = N, seed: number = SEED): Trade[] {
  const rand = lcg(seed)
  const out: Trade[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const bid = 50 + rand() * 50
    const spread = rand() * 2
    out[i] = { id: i, bid, ask: bid + spread }
  }
  return out
}

export type Tick = { idx: number, field: 'bid' | 'ask', newValue: number }

// Each tick picks a new value drawn from the same bid distribution.
// Sometimes the new spread crosses the threshold, sometimes not — that's
// realistic. Filter and downstream length() do real work either way.
export function makeTicks(
  count: number = TICK_COUNT,
  n: number = N,
  seed: number = TICK_SEED,
): Tick[] {
  const rand = lcg(seed)
  const out: Tick[] = new Array(count)
  for (let i = 0; i < count; i++) {
    out[i] = {
      idx: Math.floor(rand() * n),
      field: rand() < 0.5 ? 'bid' : 'ask',
      newValue: 50 + rand() * 50,
    }
  }
  return out
}

export const TICKS: readonly Tick[] = Object.freeze(makeTicks())

export function isLiquid(t: { bid: number, ask: number }): boolean {
  return t.ask - t.bid > THRESHOLD
}
