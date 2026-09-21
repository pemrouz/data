/* sections/operators/feed.js — the canned $(trades) feed behind §02.
 *
 * SMOKE AND MIRRORS: there is no engine on this page. This module fakes an
 * object-born keyed source `$({ t1: { sym, side, qty, px }, … })` and emits one
 * consolidated delta per "commit" in the v4 vocabulary — add · update (with prev
 * and a path) · remove — so every demo can render and flash the way the real
 * sinks would. Rates and walks are tuned to look like a quiet blotter. */

export const SYMS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'TSLA', 'GOOG']
const BASE = { AAPL: 187.5, MSFT: 415.2, NVDA: 118.4, AMZN: 178.9, TSLA: 245.6, GOOG: 165.3 }

const store = new Map()
let minted = 0
let seq = 0
const subs = new Set()

const r2 = v => Math.round(v * 100) / 100
const rnd = n => (Math.random() * n) | 0

function mint(sym, side, qty, px) {
  const k = 't' + (++minted)
  store.set(k, { k, sym, side, qty, px: r2(px) })
  return k
}

;[
  ['AAPL', 'buy',  200, 187.50], ['MSFT', 'sell', 120, 415.20], ['NVDA', 'buy',  500, 118.40],
  ['AMZN', 'buy',  350, 178.90], ['TSLA', 'sell',  80, 245.60], ['GOOG', 'buy',  640, 165.30],
  ['AAPL', 'sell', 410, 187.62], ['NVDA', 'sell', 300, 118.55], ['AMZN', 'sell', 150, 179.05],
  ['MSFT', 'buy',  275, 414.90], ['TSLA', 'buy',  900, 246.10], ['GOOG', 'sell', 220, 165.10],
].forEach(a => mint(...a))

/** A plain snapshot, in key order (the registry mints keys ascending). */
export const rows = () => [...store.values()]
export const size = () => store.size
export const seqNow = () => seq

/** Subscribe to commits: fn(delta). Returns the unsubscribe. */
export function onCommit(fn) { subs.add(fn); return () => subs.delete(fn) }

/** The printed form of a delta — facts.md: `update t3 .qty 500 → 380`. */
export function printDelta(d) {
  if (!d) return '—'
  if (d.verb === 'update') {
    const f = d.path[0] === 'px' ? v => v.toFixed(2) : v => String(v)
    return `update ${d.key} .${d.path[0]} ${f(d.prev)} → ${f(d.value)}`
  }
  if (d.verb === 'add') return `add ${d.key} { ${d.row.sym} ${d.row.side} ${d.row.qty} @ ${d.row.px.toFixed(2)} }`
  return `remove ${d.key}`
}

function tick() {
  const n = store.size
  const roll = Math.random()
  let d
  if (roll < 0.045 && n < 14) {
    const sym = SYMS[rnd(SYMS.length)]
    const side = Math.random() < 0.5 ? 'buy' : 'sell'
    const qty = 50 + rnd(24) * 50
    const px = BASE[sym] * (1 + (Math.random() - 0.5) * 0.01)
    const k = mint(sym, side, qty, px)
    d = { verb: 'add', key: k, row: { ...store.get(k) } }
  } else if (roll < 0.09 && n > 10) {
    const keys = [...store.keys()]
    const k = keys[rnd(keys.length)]
    const row = store.get(k)
    store.delete(k)
    d = { verb: 'remove', key: k, row }
  } else {
    const keys = [...store.keys()]
    const row = store.get(keys[rnd(keys.length)])
    const field = Math.random() < 0.6 ? 'px' : 'qty'
    let next
    if (field === 'px') {
      const base = BASE[row.sym]
      const raw = row.px * (1 + (Math.random() - 0.5) * 0.006)
      next = r2(Math.max(base * 0.96, Math.min(base * 1.04, raw)))
      if (next === row.px) next = r2(row.px + (Math.random() < 0.5 ? -0.01 : 0.01))
    } else {
      const raw = row.qty + Math.round((Math.random() - 0.5) * 6) * 10
      next = Math.max(20, Math.min(1400, raw))
      if (next === row.qty) next = Math.min(1400, row.qty + 10)
    }
    const prev = row[field]
    row[field] = next
    d = { verb: 'update', key: row.k, path: [field], prev, value: next }
  }
  d.seq = ++seq
  for (const fn of subs) fn(d)
}

/* ---------- running: the single switch every gate feeds ---------- */
let timer = null
export function running(on) {
  if (on && !timer) timer = setInterval(tick, 110)
  if (!on && timer) { clearInterval(timer); timer = null }
}
export const isRunning = () => timer !== null
