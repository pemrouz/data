// Synthetic market-data tape. 200 symbols across 8 sectors; geometric
// brownian motion per symbol (drift ~0, vol ~0.0008 per tick); volumes
// log-normal. Seeded RNG so reloading the page produces the same stream
// — perf comparisons across libs are then apples-to-apples.
//
// Emits batches on a fixed 60ms cadence; batch size = round(rate * 0.06).
// Why batch instead of one-at-a-time:
//   - At target rates of 5k-100k ticks/s, a single setTimeout(0) burns
//     event-loop slots faster than libs can process them; the queue
//     blows out. Batching coalesces work into one cascade per frame-ish,
//     which is what every realistic streaming source would do anyway.
//   - The latency tracker measures *batch* → next paint, not individual
//     tick → paint. That's the perceptually relevant number — a user
//     sees the *block* of new ticks land.
//
// rate slider is logarithmic in the UI; we receive the linear value from
// main.js and the slider handles the log scaling.

const SECTORS = ['TECH', 'FIN', 'ENERGY', 'HEALTH', 'CONSUMER', 'INDUST', 'MATERIAL', 'UTIL']

// 200 symbols. Pad each sector with synthetic numbered tickers so the
// universe is realistic-sized; the names don't need to be real companies.
function buildUniverse() {
  const real = {
    TECH:     ['AAPL', 'MSFT', 'NVDA', 'GOOG', 'META', 'AMZN', 'TSLA', 'AMD', 'INTC', 'ORCL'],
    FIN:      ['JPM', 'BAC', 'GS', 'MS', 'WFC', 'C', 'BLK', 'AXP', 'SCHW', 'USB'],
    ENERGY:   ['XOM', 'CVX', 'COP', 'SLB', 'EOG', 'PXD', 'OXY', 'MPC', 'PSX', 'VLO'],
    HEALTH:   ['JNJ', 'PFE', 'UNH', 'ABBV', 'LLY', 'MRK', 'TMO', 'ABT', 'DHR', 'BMY'],
    CONSUMER: ['WMT', 'COST', 'HD', 'TGT', 'NKE', 'SBUX', 'MCD', 'LOW', 'TJX', 'BKNG'],
    INDUST:   ['CAT', 'BA', 'GE', 'HON', 'UPS', 'RTX', 'DE', 'LMT', 'MMM', 'FDX'],
    MATERIAL: ['LIN', 'APD', 'ECL', 'SHW', 'FCX', 'NUE', 'DOW', 'DD', 'PPG', 'NEM'],
    UTIL:     ['NEE', 'DUK', 'SO', 'AEP', 'D', 'EXC', 'XEL', 'SRE', 'PCG', 'ED'],
  }
  const universe = []
  for (const sector of SECTORS) {
    const tickers = real[sector]
    for (let i = 0; i < 25; i++) {
      const symbol = i < tickers.length ? tickers[i] : `${sector.slice(0, 3)}${String(i).padStart(2, '0')}`
      // Anchor price loosely by sector — utilities cheap, tech expensive.
      const base = ({ TECH: 250, FIN: 80, ENERGY: 110, HEALTH: 140, CONSUMER: 95, INDUST: 180, MATERIAL: 70, UTIL: 45 })[sector]
      universe.push({ symbol, sector, open: base * (0.6 + 0.8 * rand01(symbol)) })
    }
  }
  return universe
}

// Deterministic per-symbol "random" so identical reloads pick the same
// open prices. Cheap string-hash → [0,1).
function rand01(s) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 1000000) / 1000000
}

// Mulberry32 — seeded RNG for the price walk. Cheap and good enough.
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Standard normal via Box-Muller, drawing from a seeded uniform.
function makeGauss(rng) {
  let spare = null
  return function gauss() {
    if (spare !== null) { const r = spare; spare = null; return r }
    let u, v, s
    do {
      u = rng() * 2 - 1
      v = rng() * 2 - 1
      s = u * u + v * v
    } while (s >= 1 || s === 0)
    const m = Math.sqrt(-2 * Math.log(s) / s)
    spare = v * m
    return u * m
  }
}

export function makeTicker({ batchIntervalMs = 60 } = {}) {
  const universe = buildUniverse()
  const symbolCount = universe.length
  // Current price + open price, indexed by position in `universe`.
  const last = new Float64Array(symbolCount)
  const opens = new Float64Array(symbolCount)
  for (let i = 0; i < symbolCount; i++) { last[i] = universe[i].open; opens[i] = universe[i].open }

  const rng = mulberry32(0xC0FFEE)
  const gauss = makeGauss(rng)

  let rate = 1000       // ticks per second target
  let running = false
  let timer = null
  let listeners = []
  let observed = { batches: 0, ticks: 0, t0: 0 }

  // Drift / vol per *tick* — vol scaled so a few thousand ticks per symbol
  // produce realistic ~0.5-2% intraday moves. Drift is zero so the demo
  // doesn't just trend up forever.
  const VOL = 0.0009
  const DRIFT = 0
  // Volume: log-normal, mean ~500 shares, fat tail.
  function nextVolume() { return Math.max(1, Math.floor(Math.exp(4 + gauss() * 0.9))) }

  function nextBatch() {
    if (!running) return
    const size = Math.max(1, Math.round(rate * batchIntervalMs / 1000))
    const now = performance.now()
    const batch = new Array(size)
    for (let i = 0; i < size; i++) {
      // Pick a symbol uniformly at random. Realistic tape would weight by
      // sector activity but the perf characteristics don't depend on the
      // distribution — only on the *count* of symbol-buckets touched.
      const idx = (rng() * symbolCount) | 0
      const ref = universe[idx]
      const step = DRIFT + VOL * gauss()
      last[idx] = last[idx] * (1 + step)
      const price = last[idx]
      const pctChg = (price - opens[idx]) / opens[idx] * 100
      batch[i] = {
        symbol: ref.symbol,
        sector: ref.sector,
        price,
        volume: nextVolume(),
        pctChg,
        time: now + i * (batchIntervalMs / size),
      }
    }
    observed.batches++
    observed.ticks += size
    for (const cb of listeners) cb(batch)
    timer = setTimeout(nextBatch, batchIntervalMs)
  }

  // Synchronous batch synthesis. Used by main.js to pre-fill each lib's
  // rolling window before timing starts — running the same per-tick price
  // walk that the live stream uses, but without any setTimeout cadence.
  // The returned array reuses the same {symbol, sector, price, volume,
  // pctChg, time} shape; libs MUST NOT mutate it (one reference is shared
  // across every row). Advances the internal rng / price state, so live
  // ticks after prefill continue the same trajectory.
  function synthesize(count) {
    const out = new Array(count)
    const now = performance.now()
    for (let i = 0; i < count; i++) {
      const idx = (rng() * symbolCount) | 0
      const ref = universe[idx]
      last[idx] = last[idx] * (1 + DRIFT + VOL * gauss())
      const price = last[idx]
      const pctChg = (price - opens[idx]) / opens[idx] * 100
      out[i] = {
        symbol: ref.symbol,
        sector: ref.sector,
        price,
        volume: nextVolume(),
        pctChg,
        time: now - (count - i),
      }
    }
    return out
  }

  return {
    universe,
    sectors: SECTORS,
    synthesize,
    onBatch(cb) { listeners.push(cb); return () => { listeners = listeners.filter(l => l !== cb) } },
    setRate(r) { rate = Math.max(1, r | 0) },
    getRate() { return rate },
    start() {
      if (running) return
      running = true
      observed.t0 = performance.now()
      observed.batches = 0
      observed.ticks = 0
      timer = setTimeout(nextBatch, batchIntervalMs)
    },
    stop() {
      running = false
      if (timer) { clearTimeout(timer); timer = null }
    },
    isRunning() { return running },
    observed,
  }
}
