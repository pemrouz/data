/* sections/operators/bench.js — the in-tab operator bench behind §02 b's peers strip.
   Nothing here is canned: every figure is performance.now() around real work in THIS tab.
   - data: a SEPARATE 20,000-row source on a SECOND Runtime (the page's feed is untouched),
     the selected operator's real view attached — a sink counts its deltas, a scalar is read
     through [value] — and K single-row writes replayed through the public write path
     (src.get(k).set(field, v)).
   - peers (loaded only on the visitor's "load peers ▸"): a version signal + a computed /
     memo / derived / map / useMemo wrapping the idiomatic plain-JS recompute of the SAME
     operator over the same 20,000 rows, re-run per change; crossfilter uses its dimension /
     group where the operator maps (filter · between · length · lengthBuckets · group · sum ·
     avg) and the plain recompute elsewhere (flagged on the cell).
   - the clock: performance.now() steps at 0.1 ms in a non-isolated page, so one ~5 µs write
     cannot be resolved on its own. A ROUND replays the K changes (chunked, yielding to the
     frame loop every ~40 ms of timed work); the per-change figure is the round's timed total
     divided by K; rounds repeat within a budget and the printed number is the MEDIAN round.
     Every round's writes are fresh values (a repeat of the same value would be an Object.is
     no-op for the engine while a peer still recomputes). */
import { api } from '../../engine.js'
const { value, node, Runtime, InMemoryBacking, handleFor } = api

export const BENCH_N = 20000
export const BENCH_K = 200
const MIN_ROUNDS = 3, MAX_ROUNDS = 7, BUDGET_MS = 120, HARD_MS = 1500, SLICE_MS = 40

export const ENGINES = [
  { id: 'data', label: 'data' },
  { id: 'mobx', label: 'MobX' },
  { id: 'solid', label: 'Solid' },
  { id: 'preact', label: 'Preact signals' },
  { id: 'vue', label: 'Vue reactivity' },
  { id: 'crossfilter', label: 'crossfilter' },
  { id: 'svelte', label: 'Svelte store' },
  { id: 'rxjs', label: 'RxJS' },
  { id: 'react', label: 'React' },
]

/* ---------- the workload: 20,000 rows and the change sequence (synthetic INPUT) ---------- */
const SYMS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'TSLA', 'GOOG']
const BASE = { AAPL: 187.5, MSFT: 415.2, NVDA: 118.4, AMZN: 178.9, TSLA: 245.6, GOOG: 165.3 }
const r2 = v => Math.round(v * 100) / 100
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x1_0000_0000 } }
export function makeRows(n = BENCH_N, seed = 11) {
  const r = lcg(seed), out = new Array(n)
  for (let i = 0; i < n; i++) {
    const sym = SYMS[(r() * SYMS.length) | 0]
    out[i] = { k: 'r' + i, sym, side: r() < 0.5 ? 'buy' : 'sell', qty: 50 + ((r() * 24) | 0) * 50, px: r2(BASE[sym] * (1 + (r() - 0.5) * 0.08)) }
  }
  return out
}
// count single-row writes; every one CHANGES its row's field
export function makeWrites(rows, count, seed = 23) {
  const r = lcg(seed), cur = rows.map(x => ({ qty: x.qty, px: x.px })), out = new Array(count)
  for (let j = 0; j < count; j++) {
    const i = (r() * rows.length) | 0, field = r() < 0.6 ? 'px' : 'qty'
    let v
    do v = field === 'px' ? r2(BASE[rows[i].sym] * (1 + (r() - 0.5) * 0.08)) : 50 + ((r() * 24) | 0) * 50
    while (v === cur[i][field])
    cur[i][field] = v
    out[j] = { i, k: rows[i].k, field, v }
  }
  return out
}

/* ---------- the operators: data's real chain · the plain recompute · crossfilter's construct ---------- */
const LO = 150, HI = 250
const buy = t => t.side === 'buy'
const num = (a, b) => a - b
const q7 = (sorted, p) => { const n = sorted.length; if (!n) return undefined; const h = (n - 1) * p, lo = Math.floor(h), hi = Math.ceil(h); return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]) }
const pxs = rows => { const a = new Array(rows.length); for (let i = 0; i < rows.length; i++) a[i] = rows[i].px; return a.sort(num) }
let tapN = 0
export const SPECS = {
  filter: { data: s => s.filter(buy), plain: rows => rows.filter(buy), cf: cf => { const g = cf.dimension(r => r.side).group().reduceCount(); return () => g.all() } },
  map: { data: s => s.map(t => ({ ...t, notional: t.qty * t.px })), plain: rows => rows.map(r => ({ ...r, notional: r.qty * r.px })) },
  gt: { data: s => s.gt('qty', 300), plain: rows => rows.filter(r => r.qty > 300) },
  lt: { data: s => s.lt('px', 200), plain: rows => rows.filter(r => r.px < 200) },
  gte: { data: s => s.gte('qty', 500), plain: rows => rows.filter(r => r.qty >= 500) },
  lte: { data: s => s.lte('px', 180), plain: rows => rows.filter(r => r.px <= 180) },
  between: { data: s => s.between('px', [LO, HI]), plain: rows => rows.filter(r => r.px >= LO && r.px <= HI), cf: cf => { const g = cf.dimension(r => (r.px >= LO && r.px <= HI ? 1 : 0)).group().reduceCount(); return () => g.all() } },
  intersect: { data: s => s.filter(buy).intersect(s.gt('qty', 300)), plain: rows => { const big = new Set(); for (const r of rows) if (r.qty > 300) big.add(r.k); return rows.filter(r => buy(r) && big.has(r.k)) } },
  union: { data: s => s.filter(buy).union(s.gt('qty', 300)), plain: rows => { const out = new Map(); for (const r of rows) if (buy(r)) out.set(r.k, r); for (const r of rows) if (r.qty > 300) out.set(r.k, r); return out } },
  except: { data: s => s.filter(buy).except(s.gt('qty', 300)), plain: rows => { const big = new Set(); for (const r of rows) if (r.qty > 300) big.add(r.k); return rows.filter(r => buy(r) && !big.has(r.k)) } },
  sum: { data: s => s.sum('qty'), plain: rows => { let t = 0; for (let i = 0; i < rows.length; i++) t += rows[i].qty; return t }, cf: cf => { const g = cf.groupAll().reduceSum(r => r.qty); return () => g.value() } },
  avg: { data: s => s.avg('px'), plain: rows => { let t = 0; for (let i = 0; i < rows.length; i++) t += rows[i].px; return t / rows.length }, cf: cf => { const g = cf.groupAll().reduce((p, r) => { p.s += r.px; p.n++; return p }, (p, r) => { p.s -= r.px; p.n--; return p }, () => ({ s: 0, n: 0 })); return () => { const v = g.value(); return v.n ? v.s / v.n : undefined } } },
  length: { data: s => s.length(), plain: rows => rows.length, cf: cf => { const g = cf.groupAll().reduceCount(); return () => g.value() } },
  group: { data: s => s.group(t => t.sym), plain: rows => { const g = {}; for (const r of rows) (g[r.sym] ??= {})[r.k] = r; return g }, cf: cf => { const g = cf.dimension(r => r.sym).group().reduce((p, r) => (p.set(r.k, r), p), (p, r) => (p.delete(r.k), p), () => new Map()); return () => g.all() } },
  lengthBuckets: { data: s => s.length(t => t.sym), plain: rows => { const c = {}; for (const r of rows) c[r.sym] = (c[r.sym] || 0) + 1; return c }, cf: cf => { const g = cf.dimension(r => r.sym).group().reduceCount(); return () => g.all() } },
  some: { data: s => s.some(t => t.qty > 1000), plain: rows => rows.some(r => r.qty > 1000) },
  every: { data: s => s.every(t => t.px > 150), plain: rows => rows.every(r => r.px > 150) },
  az: { data: s => s.az('px'), plain: rows => rows.slice().sort((a, b) => a.px - b.px) },
  za: { data: s => s.filter(buy).za('qty', 5), plain: rows => rows.filter(buy).sort((a, b) => b.qty - a.qty).slice(0, 5) },
  top: { data: s => s.map(t => t.qty * t.px).top(3), plain: rows => rows.map(r => r.qty * r.px).sort((a, b) => b - a).slice(0, 3) },
  limit: { data: s => s.limit(4), plain: rows => rows.slice(0, 4) },
  reverse: { data: s => s.reverse(), plain: rows => rows.slice().reverse() },
  max: { data: s => s.max('px'), plain: rows => { let m = -Infinity; for (let i = 0; i < rows.length; i++) if (rows[i].px > m) m = rows[i].px; return m } },
  min: { data: s => s.min('px'), plain: rows => { let m = Infinity; for (let i = 0; i < rows.length; i++) if (rows[i].px < m) m = rows[i].px; return m } },
  reduce: { data: s => s.reduce((a, t) => a + t.qty * t.px, (a, t) => a - t.qty * t.px, 0), plain: rows => rows.reduce((a, r) => a + r.qty * r.px, 0) },
  distinct: { data: s => s.distinct(t => t.sym), plain: rows => { const seen = new Set(); for (const r of rows) seen.add(r.sym); return seen } },
  to: { data: s => s.to(v => Object.keys(v).length), plain: rows => Object.keys(rows).length },
  quantile: { data: s => s.quantile('px', 0.9), plain: rows => q7(pxs(rows), 0.9) },
  percentile: { data: s => s.percentile('px', 90), plain: rows => q7(pxs(rows), 0.9) },
  median: { data: s => s.median('px'), plain: rows => q7(pxs(rows), 0.5) },
  tap: { data: s => s.tap(c => { tapN++ }), plain: () => ++tapN },
  keys: { data: s => s.keys(), plain: rows => rows.map(r => r.k) },
  values: { data: s => s.values(), plain: rows => rows.slice() },
}

/* ---------- engines: each exposes write(w) · read() · dispose() ---------- */
const mutate = rows => w => { rows[w.i] = { ...rows[w.i], [w.field]: w.v } }

function dataEngine(op, rows) {
  const rt = new Runtime()
  const obj = {}
  for (const r of rows) obj[r.k] = r
  const src = handleFor(new InMemoryBacking(rt, obj, 'bench').source)
  src.promote()   // W11: pre-pay the container adoption — setup, not per-change cost
  const view = SPECS[op].data(src)
  let n = 0, read
  if (view[node].kind === 'scalar') read = () => view[value]
  else { view.sink({ wantsOrder: true, apply(b) { n += b.rows.length + (b.order ? b.order.length : 0) } }); read = () => n }
  read()
  return { rowCount: () => src.rowCount(), write: w => { src.get(w.k).set(w.field, w.v) }, read, dispose() { view.dispose(); src.dispose() } }
}

/* peer modules — loaded ONLY on the visitor's action, cached per page */
const mods = new Map()   // id → module bundle | 'loading' | Error
export const peerState = id => { const m = mods.get(id); return m === undefined ? 'off' : m === 'loading' ? 'loading' : m instanceof Error ? 'failed' : 'ok' }
export const peersLoaded = () => ENGINES.filter(e => e.id !== 'data' && peerState(e.id) === 'ok').length
async function importPeer(id) {
  switch (id) {
    case 'mobx': return { mobx: await import('mobx') }
    case 'solid': return { solid: await import('solid-js') }
    case 'preact': return { preact: await import('@preact/signals-core') }
    case 'vue': return { vue: await import('@vue/reactivity') }
    case 'crossfilter': return { crossfilter: (await import('crossfilter2')).default }
    case 'svelte': return { store: await import('svelte/store') }
    case 'rxjs': return { rxjs: await import('rxjs'), ops: await import('rxjs/operators') }
    case 'react': return { React: (await import('react')).default, client: await import('react-dom/client'), dom: await import('react-dom') }
  }
  throw new Error(`unknown peer ${id}`)
}
export async function loadPeers(onEach) {
  for (const e of ENGINES) {
    if (e.id === 'data' || peerState(e.id) === 'ok' || peerState(e.id) === 'loading') continue
    mods.set(e.id, 'loading'); onEach?.(e, 'loading')
    try { mods.set(e.id, await importPeer(e.id)); onEach?.(e, 'ok') }
    catch (err) { mods.set(e.id, err instanceof Error ? err : new Error(String(err))); onEach?.(e, 'failed'); console.warn(`[operators] peer ${e.id} failed to load`, err) }
  }
}

// `prims` = { signal(v) → {get,set}, computed(fn) → read(), bump(fn) } — the race's idiom
function prims(id, m) {
  if (id === 'mobx') { const { observable, computed, runInAction } = m.mobx; return { signal: v => { const b = observable.box(v); return { get: () => b.get(), set: x => b.set(x) } }, computed: fn => { const c = computed(fn); return () => c.get() }, bump: runInAction, dispose() {} } }
  if (id === 'preact') { const { signal, computed, batch } = m.preact; return { signal: v => { const s = signal(v); return { get: () => s.value, set: x => { s.value = x } } }, computed: fn => { const c = computed(fn); return () => c.value }, bump: batch, dispose() {} } }
  if (id === 'vue') { const { shallowRef, computed } = m.vue; return { signal: v => { const r = shallowRef(v); return { get: () => r.value, set: x => { r.value = x } } }, computed: fn => { const c = computed(fn); return () => c.value }, bump: fn => fn(), dispose() {} } }
  const { createSignal, createMemo, createRoot, batch } = m.solid   // solid memos need a root owner
  let p
  createRoot(dispose => { p = { signal: v => { const [g, s] = createSignal(v); return { get: g, set: s } }, computed: fn => createMemo(fn), bump: batch, dispose } })
  return p
}
function signalEngine(id, m, op, rows) {
  const P = prims(id, m), plain = SPECS[op].plain
  const ver = P.signal(0)
  const c = P.computed(() => { ver.get(); return plain(rows) })
  c()
  return { write: mutate(rows), read: () => { P.bump(() => ver.set(ver.get() + 1)); return c() }, dispose: () => P.dispose() }
}
function rxEngine(m, op, rows) {
  const plain = SPECS[op].plain, s$ = new m.rxjs.Subject()
  let out
  const sub = s$.pipe(m.ops.map(() => plain(rows))).subscribe(v => { out = v })
  s$.next(0)
  return { write: mutate(rows), read: () => { s$.next(0); return out }, dispose: () => sub.unsubscribe() }
}
function svelteEngine(m, op, rows) {
  const plain = SPECS[op].plain, ver = m.store.writable(0)
  let out
  const un = m.store.derived(ver, () => plain(rows)).subscribe(v => { out = v })
  return { write: mutate(rows), read: () => { ver.update(v => v + 1); return out }, dispose: un }
}
function reactEngine(m, op, rows) {
  const { React, client, dom } = m, plain = SPECS[op].plain
  const { useState, useRef, useMemo, useImperativeHandle, forwardRef } = React
  const App = forwardRef((_props, ref) => {
    const [, setV] = useState(0)
    const tr = useRef(rows)
    const result = useMemo(() => plain(tr.current))
    useImperativeHandle(ref, () => ({
      write(w) { tr.current[w.i] = { ...tr.current[w.i], [w.field]: w.v } },
      bump() { dom.flushSync(() => setV(v => v + 1)) },
      result: () => result,
    }), [result])
    return null
  })
  const host = document.createElement('div'), root = client.createRoot(host), ref = React.createRef()
  dom.flushSync(() => root.render(React.createElement(App, { ref })))
  return { write: w => ref.current.write(w), read: () => { ref.current.bump(); return ref.current.result() }, dispose: () => root.unmount() }
}
function cfEngine(m, op, rows) {
  const spec = SPECS[op]
  if (!spec.cf) return { write: mutate(rows), read: () => spec.plain(rows), dispose() {}, fallback: true }
  const cf = m.crossfilter(rows.slice()), idDim = cf.dimension(r => r.k), read = spec.cf(cf)
  read()
  return {
    write: w => { const nr = { ...rows[w.i], [w.field]: w.v }; rows[w.i] = nr; idDim.filterExact(w.k); cf.remove(); idDim.filterAll(); cf.add([nr]) },
    read, dispose() { idDim.dispose() }, fallback: false,
  }
}
function makeEngine(id, op, rows) {
  const m = mods.get(id)
  if (id === 'rxjs') return rxEngine(m, op, rows)
  if (id === 'svelte') return svelteEngine(m, op, rows)
  if (id === 'react') return reactEngine(m, op, rows)
  if (id === 'crossfilter') return cfEngine(m, op, rows)
  return signalEngine(id, m, op, rows)
}

/* ---------- timing ---------- */
const yieldTask = () => new Promise(r => setTimeout(r, 0))
export function clockStep() {   // the smallest positive performance.now() delta seen in a short spin
  const t0 = performance.now()
  let last = t0, best = Infinity
  while (performance.now() - t0 < 8) { const now = performance.now(); if (now !== last) { const d = now - last; if (d < best) best = d; last = now } }
  return best === Infinity ? 0 : best
}
async function timeRounds(eng, writes, K, cancelled) {
  const rounds = []
  let used = 0, written = 0   // written: the writes actually applied across the rounds (counted, not assumed)
  while (rounds.length < MAX_ROUNDS && (rounds.length < MIN_ROUNDS || used < BUDGET_MS) && !(rounds.length >= 1 && used >= HARD_MS)) {
    const base = rounds.length * K
    let i = 0, timed = 0
    while (i < K) {
      const t0 = performance.now()
      do { const w = writes[base + i++]; eng.write(w); eng.read(); written++ } while (i < K && performance.now() - t0 < SLICE_MS)
      timed += performance.now() - t0
      if (i < K) { await yieldTask(); if (cancelled?.()) return null }
    }
    rounds.push(timed / K)
    used += timed
    await yieldTask()
    if (cancelled?.()) return null
  }
  const sorted = rounds.slice().sort(num)
  return { ms: sorted[sorted.length >> 1], rounds: rounds.length, best: sorted[0], perRound: written / rounds.length }
}

/* bench(op): { op, n (src.rowCount()), k (writes counted per round on data), clock, engines: { [id]: { ms, rounds, best, fallback } | 'off' | 'failed' | 'na' } } */
export async function bench(op, { onStatus, cancelled } = {}) {
  if (!SPECS[op]) throw new Error(`no bench spec for ${op}`)
  const rows = makeRows(), writes = makeWrites(rows, BENCH_K * MAX_ROUNDS)
  const res = { op, n: 0, k: 0, clock: clockStep(), engines: {} }
  for (const e of ENGINES) {
    if (cancelled?.()) return null
    let eng
    if (e.id === 'data') { eng = dataEngine(op, rows); res.n = eng.rowCount() }
    else {
      const st = peerState(e.id)
      if (st !== 'ok') { res.engines[e.id] = st === 'failed' ? 'failed' : 'off'; continue }
      if (!SPECS[op].plain) { res.engines[e.id] = 'na'; continue }
      eng = makeEngine(e.id, op, rows.slice())
    }
    onStatus?.(`measuring ${e.label}…`)
    try {
      const t = await timeRounds(eng, writes, BENCH_K, cancelled)
      if (t === null) return null
      if (e.id === 'data') res.k = t.perRound
      res.engines[e.id] = { ms: t.ms, rounds: t.rounds, best: t.best, fallback: eng.fallback === true }
    } finally { eng.dispose() }
    await yieldTask()
  }
  return res
}
