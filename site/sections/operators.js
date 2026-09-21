/* sections/operators.js — §02 The operator surface.
   b (THE PICK) · the REAL engine on the page's runtime: `trades = $({ t1 … t14 })`, a scripted
     writer issuing one real write per ~110 ms (synthetic INPUT: random-walk px/qty updates,
     an occasional add/remove), the feed line printed from `trades.sink` (the CommitBatch's
     seq + first RowDelta) and rowCount(), the four category cards from gen/manifest.json,
     and ONE shared panel painting the selected operator's real view from its own
     sink / connect / [value]. The peers strip is MEASURED in this tab, on demand
     (./operators/bench.js) — every multiple printed there was timed here.
   a (not picked, untouched) · ./operators/variant-a.js — the canned catalogue on its canned
     feed; that module (and feed.js under it) is imported ONLY when variant a is shown, so no
     smoke code is on the picked path. */
import { api, attest, put, fmt, REDUCED } from '../engine.js'
import { ENGINES, bench, loadPeers, peerState, peersLoaded } from './operators/bench.js'

const { $, value, node, runtime } = api
const root = document.getElementById('operators')
const VB = root.querySelector(':scope > .opt > [data-variant="b"]')
const $$ = sel => VB.querySelector(sel)
{ // variant a's smoke loads on a's first show (or at load under ?operators=a) — never on b's path
  const VA = root.querySelector(':scope > .opt > [data-variant="a"]')
  if (VA) { const loadA = () => import('./operators/variant-a.js'); if (!VA.hidden) loadA(); else VA.addEventListener('variantshow', loadA, { once: true }) }
}
const unattest = el => { if (el) el.removeAttribute('data-attested') }
// fixed decimals (engine.js's fmt(v, d) throws on an integer-valued v when d > 0: min > max fraction digits)
const fixed = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : String(v))
const signed = (v, dp) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(dp)
const signedN = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + fmt(Math.abs(v))

/* ======================================================================
 * the feed: $(trades) on the page's runtime + the scripted writer
 * ====================================================================== */
const SYMS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'TSLA', 'GOOG']
const BASE = { AAPL: 187.5, MSFT: 415.2, NVDA: 118.4, AMZN: 178.9, TSLA: 245.6, GOOG: 165.3 }
const r2 = v => Math.round(v * 100) / 100
const rnd = n => (Math.random() * n) | 0
let minted = 0
const seed = {}
for (const [sym, side, qty, px] of [
  ['AAPL', 'buy', 200, 187.50], ['MSFT', 'sell', 120, 415.20], ['NVDA', 'buy', 500, 118.40],
  ['AMZN', 'buy', 350, 178.90], ['TSLA', 'sell', 80, 245.60], ['GOOG', 'buy', 640, 165.30],
  ['AAPL', 'sell', 410, 187.62], ['NVDA', 'sell', 300, 118.55], ['AMZN', 'sell', 150, 179.05],
  ['MSFT', 'buy', 275, 414.90], ['TSLA', 'buy', 900, 246.10], ['GOOG', 'sell', 220, 165.10],
  ['NVDA', 'buy', 1100, 118.20], ['AAPL', 'buy', 60, 187.44],
]) { const k = 't' + (++minted); seed[k] = { k, sym, side, qty, px: r2(px) } }
const trades = $(seed)
const bounds = $({ px: [150, 250] })   // the reactive bounds handle for between

const keysOf = h => { const ks = []; h.each(k => ks.push(k)); return ks }
function tick() {   // ONE real write per tick — the engine does everything after this line
  const n = trades.rowCount(), roll = Math.random()
  if (roll < 0.045 && n < 16) {
    const sym = SYMS[rnd(SYMS.length)], k = 't' + (++minted)
    trades.set(k, { k, sym, side: Math.random() < 0.5 ? 'buy' : 'sell', qty: 50 + rnd(24) * 50, px: r2(BASE[sym] * (1 + (Math.random() - 0.5) * 0.01)) })
    return
  }
  const ks = keysOf(trades)
  if (roll < 0.09 && n > 12) { trades.get(ks[rnd(ks.length)]).remove(); return }
  const k = ks[rnd(ks.length)], row = trades.get(k)[value]
  const field = Math.random() < 0.6 ? 'px' : 'qty'
  let next
  if (field === 'px') {
    const base = BASE[row.sym], raw = row.px * (1 + (Math.random() - 0.5) * 0.006)
    next = r2(Math.max(base * 0.96, Math.min(base * 1.04, raw)))
    if (next === row.px) next = r2(row.px + (Math.random() < 0.5 ? -0.01 : 0.01))
  } else {
    next = Math.max(20, Math.min(1400, row.qty + Math.round((Math.random() - 0.5) * 6) * 10))
    if (next === row.qty) next = Math.min(1400, row.qty + 10)
  }
  trades.get(k).set(field, next)
}

/* gates: streaming × variant shown × on-screen × tab visible → the writer's interval */
let timer = 0, streaming = !REDUCED, shown = !VB.hidden, onScreen = false
const running = on => { if (on && !timer) timer = setInterval(tick, 110); if (!on && timer) { clearInterval(timer); timer = 0 } }
const sync = () => running(streaming && shown && onScreen && !document.hidden)
VB.addEventListener('variantshow', () => { shown = true; sync() })
VB.addEventListener('varianthide', () => { shown = false; sync() })
document.addEventListener('visibilitychange', sync)
new IntersectionObserver(es => { onScreen = es.some(e => e.isIntersecting); sync() }, { rootMargin: '160px 0px' }).observe(VB)
// the lede says ALL the operators run live off the feed: build every chip's chain once, the first
// time the section nears the viewport (14 rows · 33 nodes — a millisecond), not only the picked one
let allBuilt = false
const buildAll = () => { if (allBuilt) return; allBuilt = true; for (const o of OPS) o.view ??= o.build() }
new IntersectionObserver((es, io) => { if (es.some(e => e.isIntersecting)) { buildAll(); io.disconnect() } }, { rootMargin: '600px 0px' }).observe(VB)
const pauseBtn = $$('#op-pause-b')
const syncToggle = () => put(pauseBtn, streaming ? '⏸ pause' : '▶ stream')
pauseBtn.addEventListener('click', () => { streaming = !streaming; syncToggle(); sync() })
syncToggle(); sync()

/* the feed line: rowCount() · the batch's seq · its first RowDelta, printed */
const leaf = (v, path) => { for (const p of path) v = v == null ? undefined : v[p]; return v }
const fmtLeaf = (path, v) => (path[path.length - 1] === 'px' && typeof v === 'number' ? fixed(v, 2) : typeof v === 'number' ? String(v) : JSON.stringify(v))
function printDelta(d) {
  if (d.op === 'update') { const p = d.path ?? []; return `update ${d.key}${p.length ? ' .' + p.join('.') : ''} ${fmtLeaf(p, leaf(d.prev, p))} → ${fmtLeaf(p, leaf(d.row, p))}` }
  if (d.op === 'add') { const r = d.row; return `add ${d.key} { ${r.sym} ${r.side} ${r.qty} @ ${fixed(r.px, 2)} }` }
  return `remove ${d.key}`
}
const flN = $$('#op-fl-n-b'), flSeq = $$('#op-fl-seq-b'), flDelta = $$('#op-fl-delta-b')
attest(flN, trades.rowCount()); attest(flSeq, runtime().seq)
trades.sink({
  apply(b) {
    attest(flN, trades.rowCount()); attest(flSeq, b.seq)
    if (b.rows.length) attest(flDelta, printDelta(b.rows[0]) + (b.rows.length > 1 ? ` +${b.rows.length - 1}` : ''))
  },
})

/* ======================================================================
 * tiny DOM kit — keyed reconciliation; every printed row is engine-produced
 * ====================================================================== */
function flash(el) { if (!el) return; el.classList.remove('op-flash'); void el.offsetWidth; el.classList.add('op-flash') }
function setText(el, text, flashIt = false) {
  if (!el || el.textContent === text) return false
  el.textContent = text
  if (flashIt) flash(el)
  return true
}
function syncList(host, items, make, update) {
  const stale = new Map()
  for (const el of host.children) stale.set(el.dataset.key, el)
  let cursor = host.firstElementChild
  items.forEach((it, i) => {
    let el = stale.get(it.k)
    if (el) { stale.delete(it.k); update(el, it, i, false) }
    else { el = make(it); el.dataset.key = it.k; update(el, it, i, true) }
    if (el !== cursor) host.insertBefore(el, cursor)
    else cursor = cursor.nextElementSibling
  })
  for (const el of stale.values()) el.remove()
}
const COL = {
  rank:     { cls: 'op-rank', f: (r, i) => String(i + 1) },
  k:        { cls: 'op-k', f: (r, i, k) => k },
  sym:      { cls: 'op-sym', f: r => r.sym, sym: true },
  side:     { cls: 'op-side', f: r => r.side, side: true },
  bar:      { cls: 'op-bar', bar: r => r.qty / 1400 },
  qty:      { cls: 'op-qty', f: r => String(r.qty), on: ['qty'] },
  px:       { cls: 'op-px', f: r => fixed(r.px, 2), on: ['px'] },
  notional: { cls: 'op-notional', f: r => fmt(Math.round(r.notional)), on: ['qty', 'px'] },
  num:      { cls: 'op-notional', f: r => fmt(Math.round(r)), on: ['*'] },
}
function makeRow(cols) {
  const el = document.createElement('div')
  el.className = 'mrow op-row'
  el.dataset.cols = cols.join('-')
  el.setAttribute('data-attested', 'runtime')   // every cell below is the view's own value
  for (const c of cols) {
    const s = document.createElement('span')
    s.className = COL[c].cls
    if (c === 'bar') s.appendChild(document.createElement('i'))
    el.appendChild(s)
  }
  return el
}
function fillRow(el, it, cols, i, hit) {   // hit: the delta's path head for this key ('*' = whole row), or null
  const r = it.row
  cols.forEach((c, j) => {
    const spec = COL[c], s = el.children[j]
    if (c === 'bar') { s.firstChild.style.width = (Math.min(1, spec.bar(r)) * 100).toFixed(1) + '%'; return }
    const text = spec.f(r, i, it.k)
    if (s.textContent !== text) { s.textContent = text; if (hit && spec.on && (hit === '*' || spec.on.includes(hit) || spec.on.includes('*'))) flash(s) }
    if (spec.sym) s.dataset.sym = r.sym
    if (spec.side) s.className = 'op-side ' + r.side
  })
}
function renderList(host, items, cols, hits, cap, moreEl) {
  const show = cap ? items.slice(0, cap) : items
  syncList(host, show, () => makeRow(cols), (el, it, i, fresh) => fillRow(el, it, cols, i, fresh ? null : hits?.get(it.k) ?? null))
  if (moreEl) {
    const extra = items.length - show.length
    moreEl.hidden = extra <= 0
    if (extra > 0) { moreEl.textContent = ''; const b = document.createElement('b'); attest(b, extra); moreEl.append('+ ', b, ` more row${extra === 1 ? '' : 's'}`) }
  }
}
/* the paths a view batch touched, per key — drives the cell flash (presentation of a real delta) */
function hitsOf(b) {
  if (!b) return null
  const m = new Map()
  for (const d of b.rows) if (d.op === 'update') m.set(String(d.key), d.path && d.path.length ? String(d.path[0]) : '*')
  return m
}
/* an ordered or keyed view's (key, row) pairs in the view's own order */
const entries = view => { const out = []; view.each((k, row) => out.push({ k: String(k), row })); return out }

/* sparkline: the history of REAL values only (no seeded past) */
class Spark {
  constructor(canvas, n = 80) { this.c = canvas; this.v = []; this.n = n }
  push(x) { if (typeof x !== 'number' || !Number.isFinite(x)) return; this.v.push(x); if (this.v.length > this.n) this.v.shift(); this.draw() }
  draw() {
    const c = this.c, w = c.clientWidth, h = 40
    if (!w) return
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    const W = Math.round(w * dpr), H = Math.round(h * dpr)
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H }
    const g = c.getContext('2d')
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    const v = this.v
    if (v.length < 2) return
    let lo = Math.min(...v), hi = Math.max(...v)
    if (hi - lo < 1e-9) { lo -= 1; hi += 1 }
    const pad = (hi - lo) * 0.18; lo -= pad; hi += pad
    const x = i => 1 + (i / (this.n - 1)) * (w - 2)
    const y = val => h - 3 - ((val - lo) / (hi - lo)) * (h - 6)
    g.strokeStyle = '#26262b'; g.lineWidth = 1
    g.beginPath(); g.moveTo(0, Math.round(y(v[0])) + 0.5); g.lineTo(w, Math.round(y(v[0])) + 0.5); g.stroke()
    g.strokeStyle = '#ff5e3a'; g.lineWidth = 1.5; g.lineJoin = 'round'
    g.beginPath()
    v.forEach((val, i) => { const px = x(i), py = y(val); i ? g.lineTo(px, py) : g.moveTo(px, py) })
    g.stroke()
    g.fillStyle = '#ff5e3a'
    g.beginPath(); g.arc(x(v.length - 1), y(v[v.length - 1]), 2.2, 0, Math.PI * 2); g.fill()
  }
}
function nudge(el, v, f) {
  if (!el) return
  attest(el, (v > 0 ? '▲ ' : '▼ ') + f(v))
  el.className = 'op-nudge ' + (v > 0 ? 'pos' : 'neg') + ' show'
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('show')))
}

/* ======================================================================
 * the operator specs — the REAL chain each chip builds on the feed
 * ====================================================================== */
const memo = fn => { let v; return () => (v ??= fn()) }
const buys = memo(() => trades.filter(t => t.side === 'buy'))
const large = memo(() => trades.gt('qty', 300))
const STD = ['k', 'sym', 'side', 'bar', 'qty', 'px'], RANK_PX = ['rank', 'k', 'sym', 'px'], RANK_Q = ['rank', 'k', 'sym', 'qty']
const SETNOTE = "<code>buys = trades.filter(t => t.side === 'buy')</code> · <code>large = trades.gt('qty', 300)</code> · by key, never deduped"
const tapLog = []   // the tap operator's side effect writes here; the panel paints it while tap is selected
const OPS = [
  /* rowop */
  { name: 'filter', cost: 'O(Δ)', sig: "trades.filter(t => t.side === 'buy')", desc: 'Rows matching a predicate — a change re-tests one row.', kind: 'rows', cols: STD, build: () => buys() },
  { name: 'map', sig: 'trades.map(t => ({ ...t, notional: t.qty * t.px }))', desc: 'A per-row transform — one row in, one row out.', kind: 'rows', cols: ['k', 'sym', 'side', 'notional'], build: () => trades.map(t => ({ ...t, notional: t.qty * t.px })) },
  { name: 'gt', sig: "trades.gt('qty', 300)", desc: 'Rows above a threshold — the threshold may itself be a handle.', kind: 'rows', cols: STD, build: () => large() },
  { name: 'lt', sig: "trades.lt('px', 200)", desc: 'Rows below a threshold.', kind: 'rows', cols: STD, build: () => trades.lt('px', 200) },
  { name: 'gte', sig: "trades.gte('qty', 500)", desc: 'Rows at or above a threshold.', kind: 'rows', cols: STD, build: () => trades.gte('qty', 500) },
  { name: 'lte', sig: "trades.lte('px', 180)", desc: 'Rows at or below a threshold.', kind: 'rows', cols: STD, build: () => trades.lte('px', 180) },
  { name: 'between', sig: "const bounds = $({ px: [150, 250] })\ntrades.between('px', bounds.get('px'))", desc: 'A column in a range — the bounds are a value handle; a write to it re-selects only the rows that crossed.', note: "drag a bound: <code>bounds.get('px').update([lo, hi])</code> is one write — the view re-bounds and every row keeps its key", kind: 'rows', cols: STD, boundsUI: true, build: () => trades.between('px', bounds.get('px')) },
  { name: 'intersect', sig: 'buys.intersect(large)', desc: 'Rows in every view — by key, never deduped.', note: SETNOTE, kind: 'rows', cols: STD, build: () => buys().intersect(large()) },
  { name: 'union', sig: 'buys.union(large)', desc: 'Rows in any view — by key, never deduped.', note: SETNOTE, kind: 'rows', cols: STD, build: () => buys().union(large()) },
  { name: 'except', sig: 'buys.except(large)', desc: 'Rows in the first view and none of the others.', note: SETNOTE, kind: 'rows', cols: STD, build: () => buys().except(large()) },
  /* aggregate-decomposable */
  { name: 'sum', cost: 'O(Δ)', sig: "trades.sum('qty')", desc: 'A running total — nudged by prev → next, never re-summed.', kind: 'scalar', dp: 0, build: () => trades.sum('qty'), law: () => ['over ', ['n', trades.rowCount()], ' rows · an update adds (next − prev)'] },
  { name: 'avg', sig: "trades.avg('px')", desc: 'A running mean — a sum and a count, both decomposable.', kind: 'scalar', dp: 2, build: () => trades.avg('px'), law: () => ['sum / n · n = ', ['n', trades.rowCount()]] },
  { name: 'length', sig: 'trades.length()', desc: 'The row count as a scalar — it moves by one per add or remove.', kind: 'scalar', dp: 0, build: () => trades.length(), law: () => ['the same number the feed line prints from rowCount()'] },
  { name: 'group', sig: 'trades.group(t => t.sym)', desc: 'Rows nested under a computed key — a key edit moves one row between buckets.', kind: 'groups', build: () => trades.group(t => t.sym) },
  { name: 'lengthBuckets', label: 'length(t => t.sym)', sig: 'trades.length(t => t.sym)', desc: 'Counts per key — the histogram. On a handle it is spelled length(fn): the function form dispatches to the registry operator lengthBuckets; an emptied bucket persists at zero.', note: 'the crossfilter histogram: filter → length(fn) keeps its zero bars', kind: 'buckets', build: () => trades.length(t => t.sym) },
  { name: 'some', sig: 'trades.some(t => t.qty > 1000)', desc: 'Any row matching — a match counter, not a rescan.', kind: 'bool', build: () => trades.some(t => t.qty > 1000), companion: () => trades.filter(t => t.qty > 1000), law: (m, n) => [['m', m], ' of ', ['n', n], ' rows match — the counter is the state'] },
  { name: 'every', sig: 'trades.every(t => t.px > 150)', desc: 'All rows matching — the same counter, compared to n.', kind: 'bool', build: () => trades.every(t => t.px > 150), companion: () => trades.filter(t => t.px > 150), law: (m, n) => [['m', m], ' of ', ['n', n], ' rows match — true when the counter equals n'] },
  /* holistic */
  { name: 'az', cost: 'O(Δ log n)', sig: "trades.az('px')", desc: 'Ascending by column or comparator — an ordered view; a rank change leaves as an orderMove.', kind: 'ordered', cols: RANK_PX, build: () => trades.az('px') },
  { name: 'za', sig: "buys.za('qty', 5)", desc: 'Descending; with n, only the top-n.', note: 'n may be a handle — write it and the window resizes', kind: 'ordered', cols: RANK_Q, build: () => buys().za('qty', 5) },
  { name: 'top', sig: 'trades.map(t => t.qty * t.px).top(3)', desc: 'The largest n of a view of numbers — top ranks the row value itself, here the notional.', kind: 'ordered', cols: ['rank', 'k', 'num'], build: () => trades.map(t => t.qty * t.px).top(3) },
  { name: 'limit', sig: 'trades.limit(4)', desc: 'A window of n over arrival order — n may be a handle.', kind: 'ordered', cols: ['rank', 'k', 'sym', 'side', 'qty'], build: () => trades.limit(4) },
  { name: 'reverse', sig: 'trades.reverse()', desc: 'Arrival order, newest first — an added row surfaces at the top.', kind: 'ordered', cols: ['rank', 'k', 'sym', 'side', 'qty'], build: () => trades.reverse() },
  { name: 'max', sig: "trades.max('px')", desc: 'The extreme by column — or with no column, the extreme row.', kind: 'scalar', dp: 2, build: () => trades.max('px'), law: () => ['the holder evicted → one recompute; otherwise a compare'] },
  { name: 'min', sig: "trades.min('px')", desc: 'The extreme by column — or with no column, the extreme row.', kind: 'scalar', dp: 2, build: () => trades.min('px'), law: () => ['the holder evicted → one recompute; otherwise a compare'] },
  { name: 'reduce', cost: 'O(Δ)', label: 'reduce(add, remove, 0)', sig: 'trades.reduce((a, t) => a + t.qty * t.px, (a, t) => a - t.qty * t.px, 0)', desc: 'A fold with an add and a remove — the remove inverts the add, so a delta is one remove and one add, never a re-fold.', kind: 'scalar', dp: 0, build: () => trades.reduce((a, t) => a + t.qty * t.px, (a, t) => a - t.qty * t.px, 0), law: () => ['Σ qty × px · an update is remove(prev) then add(next)'] },
  { name: 'distinct', cost: 'O(Δ)', sig: 'trades.distinct(t => t.sym)', desc: 'First-seen unique by projection — a removed representative promotes the next holder.', kind: 'chips', build: () => trades.distinct(t => t.sym) },
  { name: 'to', cost: 'O(n)', label: 'to(v => keys(v).length)', sig: 'trades.to(v => Object.keys(v).length)', desc: 'A whole-value transform — sees the plain value and its previous result.', kind: 'scalar', dp: 0, build: () => trades.to(v => Object.keys(v).length), law: () => ['fn re-runs over the plain value on every commit — the one operator that is honestly O(n)'] },
  { name: 'quantile', cost: 'O(Δ log n)', sig: "trades.quantile('px', 0.9)", desc: 'R-type-7 quantile over a column.', kind: 'scalar', dp: 2, build: () => trades.quantile('px', 0.9), law: () => [['lit', 'R-type-7 · h = (n − 1)·p + 1'], ' · n = ', ['n', trades.rowCount()]] },
  { name: 'percentile', sig: "trades.percentile('px', 90)", desc: 'R-type-7 — the quantile at p / 100.', kind: 'scalar', dp: 2, build: () => trades.percentile('px', 90), law: () => [['lit', 'R-type-7 · h = (n − 1)·p + 1'], ' · n = ', ['n', trades.rowCount()]] },
  { name: 'median', sig: "trades.median('px')", desc: 'R-type-7 at one half.', kind: 'scalar', dp: 2, build: () => trades.median('px'), law: () => [['lit', 'R-type-7 · h = (n − 1)·½ + 1'], ' · n = ', ['n', trades.rowCount()]] },
  /* iter */
  { name: 'tap', cost: 'O(1)', sig: 'trades.tap(c => log(c))', desc: 'A side effect per change record; the view passes through untouched.', note: 'c is a ChangeRecordV2 — the same record connect() delivers; it runs as an effect, after settle', kind: 'log', build: () => trades.tap(c => { tapLog.unshift({ c, seq: runtime().seq }); if (tapLog.length > 7) tapLog.length = 7; if (cur && cur.kind === 'log') paintLog() }) },
  { name: 'keys', sig: 'trades.keys()', desc: 'The row keys, as a view.', kind: 'keys', build: () => trades.keys() },
  { name: 'values', sig: 'trades.values()', desc: 'The rows, as a keyed view.', kind: 'rows', cols: STD, build: () => trades.values() },
]
{ let cost; for (const o of OPS) { cost = o.cost || cost; o.cost = cost } }
const CATNOTE = {
  'rowop': 'O(Δ): each delta re-tests its one row and passes or drops — the view never re-walks the source',
  'aggregate-decomposable': 'O(Δ): the delta carries prev, so the scalar moves by (next − prev); nothing is re-summed',
  'holistic': 'an ordered index absorbs the delta; a rank change leaves as an orderMove, not a rebuild',
  'iter': 'O(1): nothing is kept — the change record is handed on and the view passes through',
}

/* the syntax highlighter from the old landing.js — one pass, whole tokens */
const TOKEN = /(\/\/[^\n]*)|(`(?:\\.|[^`])*`|'(?:\\.|[^'])*'|"(?:\\.|[^"])*")|\b(\d+\.?\d*)\b|\b(import|from|const|let|var|function|return|new|if|else|for|of|in|true|false|null|undefined|delete|class|extends|export|default|async|await|typeof|instanceof|Infinity)\b|([(){}[\];,])/g
const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
function highlight(src) {
  let out = '', last = 0, m
  TOKEN.lastIndex = 0
  while ((m = TOKEN.exec(src))) {
    out += esc(src.slice(last, m.index))
    const cls = m[1] ? 'tok-com' : m[2] ? 'tok-str' : m[3] ? 'tok-num' : m[4] ? 'tok-key' : 'tok-pun'
    out += `<span class="${cls}">${esc(m[0])}</span>`
    last = m.index + m[0].length
  }
  return out + esc(src.slice(last))
}

/* ======================================================================
 * the cards + chips: names and counts from gen/manifest.json (build)
 * ====================================================================== */
async function manifest() {
  try { const r = await fetch(new URL('../gen/manifest.json', import.meta.url)); if (r.ok) return { ops: (await r.json()).operators, tier: 'build' } } catch {}
  return { ops: api.exportContract().operators, tier: 'runtime' }   // the same registry, reported by the engine itself
}
const man = await manifest()
const CATS = ['rowop', 'aggregate-decomposable', 'holistic', 'iter']
const catCount = {}
for (const [name, d] of Object.entries(man.ops)) catCount[d.category] = (catCount[d.category] || 0) + 1
for (const cat of CATS) attest($$(`.op-card[data-cat="${cat}"] [data-cat-n]`), catCount[cat] || 0, man.tier)
attest($$('#op-n-ops-b'), Object.keys(man.ops).length, man.tier)
attest($$('#op-foot-n-b'), Object.keys(man.ops).length, man.tier)
attest($$('#op-foot-c-b'), Object.keys(catCount).length, man.tier)
for (const o of OPS) o.cat = man.ops[o.name]?.category
for (const name of Object.keys(man.ops)) if (!OPS.some(o => o.name === name)) console.warn(`[operators] manifest operator ${name} has no panel spec`)

const chipOf = new Map()
for (const cat of CATS) {
  const host = $$(`.op-chips[data-cat="${cat}"]`)
  for (const o of OPS) {
    if (o.cat !== cat) continue
    const b = document.createElement('button')
    b.type = 'button'; b.className = 'chip'; b.textContent = o.name; b.dataset.op = o.name
    const x = document.createElement('i'); x.className = 'op-chip-x'; b.appendChild(x)   // the measured peak, once measured (≥ 1100 px only)
    b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', o.name)
    b.addEventListener('click', () => selectOp(o.name))
    host.appendChild(b); chipOf.set(o.name, b)
  }
}

/* ======================================================================
 * the shared panel: the selected operator's REAL view, painted from its own subscription
 * ====================================================================== */
let cur = null, P = null, subs = []
function lawLine(el, parts) {   // prose with attested figures: ['n', 14] → <b data-attested>, ['lit', 'R-type-7 …'] → data-literal
  el.textContent = ''
  for (const p of parts) {
    if (typeof p === 'string') { el.append(p); continue }
    const [kind, v] = p
    const b = document.createElement(kind === 'lit' ? 'span' : 'b')
    if (kind === 'lit') { b.setAttribute('data-literal', ''); b.textContent = v } else attest(b, v)
    el.append(b)
  }
}
function selectOp(name) {
  for (const h of subs) h.dispose()
  subs = []
  cur = OPS.find(o => o.name === name)
  for (const [n, b] of chipOf) { const on = n === name; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)) }
  put($$('#op-panel-name-b'), cur.name)
  renderHead()
  renderPeers()
  $$('#op-panel-sig-b').innerHTML = highlight(cur.sig)
  put($$('#op-panel-desc-b'), cur.desc)
  $$('#op-panel-note-b').innerHTML = cur.note || CATNOTE[cur.cat]
  const host = $$('#op-panel-result-b')
  host.innerHTML = ''
  const label = cur.label || cur.sig.replace(/^trades\./, '').replace(/^.*\n/, '')
  const view = (cur.view ??= cur.build())
  P = { host, view, prev: undefined }
  const head = () => { const h = document.createElement('div'); h.className = 'col-head'; h.innerHTML = '<code class="col-head-label"></code><span class="col-head-count"></span>'; h.firstChild.textContent = label; return h }
  switch (cur.kind) {
    case 'rows': case 'ordered': {
      host.append(head())
      if (cur.boundsUI) {
        const ui = document.createElement('div'); ui.className = 'op-bounds-b'
        ui.innerHTML = '<label class="op-bound"><span>lo</span><input type="range" min="100" max="450" step="5" aria-label="lower bound"><b></b></label><label class="op-bound"><span>hi</span><input type="range" min="100" max="450" step="5" aria-label="upper bound"><b></b></label>'
        const [lo, hi] = ui.querySelectorAll('input'), [loV, hiV] = ui.querySelectorAll('b')
        const cur0 = bounds.get('px')[value]; lo.value = String(cur0[0]); hi.value = String(cur0[1])
        const paintBounds = () => { const [a, b] = bounds.get('px')[value]; attest(loV, a); attest(hiV, b); attest(host.querySelector('.col-head-label'), `between('px', [${a}, ${b}])`) }
        const onInput = () => { const a = Math.min(+lo.value, +hi.value), b = Math.max(+lo.value, +hi.value); bounds.get('px').update([a, b]); paintBounds() }   // ONE write; the view re-bounds
        lo.addEventListener('input', onInput); hi.addEventListener('input', onInput)
        host.append(ui); paintBounds()
      }
      const rows = document.createElement('div'); rows.className = 'op-rows'
      const more = document.createElement('div'); more.className = 'op-more'; more.hidden = true
      host.append(rows, more)
      subs.push(view.sink({ wantsOrder: true, init: () => paintRows(null), apply: b => paintRows(b) }))
      break
    }
    case 'scalar': {
      host.innerHTML = '<div class="op-scalars"><div class="scalar-cell op-spark-cell"><code class="scalar-label"></code><div class="op-bigrow"><span class="scalar-val">—</span><span class="op-nudge"></span></div><canvas class="op-spark" height="40" aria-hidden="true"></canvas></div></div><p class="op-law"></p>'
      host.querySelector('.scalar-label').textContent = label
      P.spark = new Spark(host.querySelector('canvas'))
      subs.push(view.connect({}, r => paintScalar(r.value)))   // v2 records: the initial value, then one per change
      break
    }
    case 'bool': {
      host.innerHTML = '<div class="bool-grid"><div class="bool-cell"><code class="bool-key"></code><span class="bool-val"></span></div></div><p class="op-law"></p>'
      host.querySelector('.bool-key').textContent = label
      P.companion = (cur.companionView ??= cur.companion())
      subs.push(view.connect({}, r => paintBool(r.value)))
      subs.push(P.companion.sink({ apply: () => paintBool(view[value]) }))   // the match count moves without the boolean flipping
      break
    }
    case 'buckets': { host.append(head()); const b = document.createElement('div'); b.className = 'tcount-block'; host.append(b); subs.push(view.sink({ init: () => paintBuckets(null), apply: b => paintBuckets(b) })); break }
    case 'groups': { host.append(head()); const b = document.createElement('div'); b.className = 'op-buckets op-buckets-b'; host.append(b); subs.push(view.sink({ init: () => paintGroups(), apply: () => paintGroups() })); break }
    case 'chips': { host.append(head()); const b = document.createElement('div'); b.className = 'distinct-chips'; host.append(b); subs.push(view.sink({ init: () => paintChips(), apply: () => paintChips() })); break }
    case 'keys': { host.append(head()); const b = document.createElement('div'); b.className = 'key-chips'; host.append(b); subs.push(view.sink({ init: () => paintKeys(), apply: () => paintKeys() })); break }
    case 'log': { host.innerHTML = '<div class="col-head"><span class="col-head-label">change records</span><span class="col-head-count">newest first</span></div><div class="op-log"></div>'; paintLog(); break }
  }
  if (autoBench && !results.has(cur.name)) measureNow()
}
const countEl = () => P.host.querySelector('.col-head-count')
function paintRows(b) {
  const items = entries(P.view)
  const n = P.view.rowCount()
  const c = countEl(); c.textContent = ''; const nb = document.createElement('b'); attest(nb, n); c.append(nb, ` row${n === 1 ? '' : 's'}`)
  renderList(P.host.querySelector('.op-rows'), items, cur.cols, hitsOf(b), 8, P.host.querySelector('.op-more'))
}
function paintScalar(v) {
  const el = P.host.querySelector('.scalar-val')
  if (v === undefined || v === null) { unattest(el); put(el, '—') }
  else attest(el, typeof v === 'number' ? fixed(v, cur.dp) : String(v))
  if (cur.law) lawLine(P.host.querySelector('.op-law'), cur.law())
  if (typeof v === 'number') {
    if (typeof P.prev === 'number' && v !== P.prev) nudge(P.host.querySelector('.op-nudge'), v - P.prev, d => (cur.dp === 0 ? signedN(d) : signed(d, cur.dp)))
    P.spark.push(v)
  }
  P.prev = v
}
function paintBool(v) {
  const el = P.host.querySelector('.bool-val')
  if (setText(el, v ? '✓ true' : '✗ false', P.prev !== undefined && v !== P.prev)) el.className = 'bool-val ' + (v ? 'tru' : 'fal')
  P.prev = v
  lawLine(P.host.querySelector('.op-law'), cur.law(P.companion.rowCount(), trades.rowCount()))
}
function paintBuckets(b) {
  const v = P.view[value], keys = Object.keys(v)
  const bs = keys.map(k => ({ k, n: v[k].value })), max = Math.max(1, ...bs.map(x => x.n))
  const c = countEl(); c.textContent = ''; const nb = document.createElement('b'); attest(nb, P.view.rowCount()); c.append(nb, ` key${keys.length === 1 ? '' : 's'}`)
  const hits = hitsOf(b)
  syncList(P.host.querySelector('.tcount-block'), bs, () => {
    const el = document.createElement('div'); el.className = 'tcount-row'; el.setAttribute('data-attested', 'runtime')
    el.innerHTML = '<span class="tcount-label"></span><div class="tcount-bar"><span class="tcount-fill"></span></div><span class="tcount-val"></span>'
    return el
  }, (el, x, i, fresh) => {
    const lab = el.querySelector('.tcount-label'); setText(lab, x.k); if (SYMS.includes(x.k)) lab.dataset.sym = x.k
    el.querySelector('.tcount-fill').style.width = `${(x.n / max) * 100}%`
    setText(el.querySelector('.tcount-val'), String(x.n), !fresh && !!hits?.has(x.k))
  })
}
function paintGroups() {
  const v = P.view[value], gs = Object.keys(v).map(k => ({ k, keys: Object.keys(v[k]) }))
  const c = countEl(); c.textContent = ''; const nb = document.createElement('b'); attest(nb, P.view.rowCount()); c.append(nb, ` bucket${gs.length === 1 ? '' : 's'}`)
  syncList(P.host.querySelector('.op-buckets'), gs, () => {
    const el = document.createElement('div'); el.className = 'gbucket'; el.setAttribute('data-attested', 'runtime')
    el.innerHTML = '<div class="gbucket-head"><span class="op-sym"></span><span class="gcount"></span></div><div class="gbucket-body key-chips"></div>'
    return el
  }, (el, g, i, fresh) => {
    const head = el.querySelector('.op-sym'); head.dataset.sym = g.k; setText(head, g.k)
    setText(el.querySelector('.gcount'), String(g.keys.length), !fresh)
    syncList(el.querySelector('.key-chips'), g.keys.map(k => ({ k })), () => { const s = document.createElement('span'); s.className = 'kchip'; return s }, (s, r) => setText(s, r.k))
  })
}
function paintChips() {
  const v = P.view[value], cs = Object.keys(v).map(k => ({ k, v: String(v[k]) }))
  const c = countEl(); c.textContent = ''; const nb = document.createElement('b'); attest(nb, P.view.rowCount()); c.append(nb, ' unique')
  syncList(P.host.querySelector('.distinct-chips'), cs, () => { const el = document.createElement('span'); el.className = 'distinct-chip'; el.setAttribute('data-attested', 'runtime'); el.innerHTML = '<span class="distinct-chip-tenor"></span>'; return el }, (el, x) => { const t = el.firstChild; t.dataset.sym = x.v; setText(t, x.v) })
}
function paintKeys() {
  const v = P.view[value], ks = Object.keys(v).map(k => ({ k, v: String(v[k]) }))
  const c = countEl(); c.textContent = ''; const nb = document.createElement('b'); attest(nb, P.view.rowCount()); c.append(nb, ' keys')
  const host = P.host.querySelector('.key-chips'); host.setAttribute('data-attested', 'runtime')
  syncList(host, ks, () => { const s = document.createElement('span'); s.className = 'kchip'; return s }, (s, x) => setText(s, x.v))
}
function paintLog() {
  const log = P?.host.querySelector('.op-log')
  if (!log) return
  log.textContent = ''
  for (const { c, seq } of tapLog) {
    const row = document.createElement('div'); row.className = 'op-log-row'; row.setAttribute('data-attested', 'runtime')
    const b = document.createElement('b'); b.textContent = c.type
    const k = document.createElement('span'); k.className = 'op-k'; k.textContent = c.key.length ? c.key.join('.') : '(whole value)'
    const s = document.createElement('span'); s.className = 'op-k'; s.textContent = ` · seq ${seq}`
    const val = c.key.length === 0 ? '' : c.type === 'remove' ? '' : ` → ${typeof c.value === 'object' && c.value !== null ? `{ ${c.value.sym} ${c.value.side} ${c.value.qty} @ ${fixed(c.value.px, 2)} }` : fmtLeaf(c.key, c.value)}`
    row.append(b, ' ', k, val, s)
    log.append(row)
  }
}

/* ======================================================================
 * the peers strip — MEASURED in this tab, on demand; nothing printed before that
 * ====================================================================== */
const results = new Map()   // op → bench result
const peerRows = new Map()
for (const e of ENGINES) {
  const row = document.createElement('div')
  row.className = 'op-peer' + (e.id === 'data' ? ' is-data' : '')
  row.innerHTML = '<span class="op-peer-name"></span><span class="op-peer-bar"><i class="op-peer-fill"></i></span><span class="op-peer-x is-off">—</span>'
  row.firstChild.textContent = e.label
  $$('#op-peers-rows-b').appendChild(row)
  peerRows.set(e.id, { fill: row.querySelector('.op-peer-fill'), x: row.querySelector('.op-peer-x') })
}
const fmtUs = ms => (ms < 1 ? `${(ms * 1000).toFixed(ms * 1000 < 10 ? 1 : 0)} µs` : `${ms.toFixed(2)} ms`)
const fmtX = x => { const r = x < 1 ? +x.toFixed(2) : x < 10 ? +x.toFixed(1) : Math.round(x); return (r < 1 ? r.toFixed(2) : r < 10 ? r.toFixed(1) : String(r)) + '×' }
const measured = r => r && typeof r === 'object'
const peakOf = res => { const d = res?.engines.data; if (!measured(d)) return null; let peak = null; for (const e of ENGINES) { const r = res.engines[e.id]; if (e.id !== 'data' && measured(r)) peak = Math.max(peak ?? 0, r.ms / d.ms) } return peak }
function renderPeers() {
  const res = results.get(cur.name), d = res?.engines.data
  let max = 0
  if (res) for (const e of ENGINES) { const r = res.engines[e.id]; if (measured(r)) max = Math.max(max, r.ms) }
  for (const e of ENGINES) {
    const pr = peerRows.get(e.id), r = res?.engines[e.id]
    if (measured(r) && measured(d)) {
      pr.fill.style.width = ((r.ms / max) * 100).toFixed(2) + '%'
      attest(pr.x, e.id === 'data' ? fmtUs(r.ms) : fmtX(r.ms / d.ms), 'measured')
      pr.x.title = `${fmtUs(r.ms)} per change · median of ${r.rounds} round${r.rounds === 1 ? '' : 's'} (best ${fmtUs(r.best)})${r.fallback ? ' · plain recompute — no crossfilter construct for this operator' : ''}`
      pr.x.className = 'op-peer-x'
    } else {
      pr.fill.style.width = '0%'
      unattest(pr.x); pr.x.title = ''
      const st = peerState(e.id)
      put(pr.x, r === 'na' ? 'n/a' : st === 'failed' ? 'failed' : st === 'loading' ? 'loading' : '—')
      pr.x.className = 'op-peer-x is-off'
    }
  }
}
function renderHead() {
  const cat = $$('#op-panel-cat-b')
  cat.textContent = ''
  const b = document.createElement('b'); b.setAttribute('data-literal', ''); b.textContent = cur.cost; cat.append(b)
  const res = results.get(cur.name), d = res?.engines.data
  if (!measured(d)) return
  const peak = peakOf(res)
  const x = document.createElement('span'); x.className = 'op-x'; const w = document.createElement('span'); w.className = 'op-xw'
  if (peak !== null) { attest(x, fmtX(peak), 'measured'); w.textContent = 'peak' } else { attest(x, fmtUs(d.ms), 'measured'); w.textContent = 'per change' }
  cat.append(' · ', x, ' ', w)
  flash(x)
}
function renderChipX(op) {
  const i = chipOf.get(op)?.querySelector('.op-chip-x'), peak = peakOf(results.get(op))
  if (!i) return
  if (peak === null) { unattest(i); i.textContent = '' } else attest(i, fmtX(peak), 'measured')
}
const monoEl = $$('#op-peers-mono-b')
function renderMono(res) {
  monoEl.textContent = ''
  const b = (v, tier) => { const el = document.createElement('b'); attest(el, v, tier); return el }
  if (!res) { monoEl.append('not yet measured · measure ▸ builds a separate source on a second runtime and replays a burst of single-row writes through it, here in this tab'); return }
  monoEl.append('measured on this machine · ', b(res.n, 'runtime'), ' rows · ', b(res.k, 'measured'), ' changes per round · median round · clock step ', b(fixed(res.clock, res.clock >= 0.095 ? 1 : res.clock >= 0.0095 ? 2 : 3), 'measured'), ' ms')
}
renderMono(null)

const statusEl = $$('#op-peers-status-b'), measureBtn = $$('#op-measure-b'), loadBtn = $$('#op-load-peers-b')
const status = t => put(statusEl, t)
let autoBench = false, busy = false, pending = null
async function measureNow() {
  autoBench = true
  const op = cur.name
  if (busy) { pending = op; return }
  busy = true; measureBtn.disabled = true
  status('measuring data…')
  try {
    const res = await bench(op, { onStatus: status })
    if (res) { results.set(op, res); renderChipX(op); if (cur.name === op) { renderPeers(); renderHead(); renderMono(res) } }
  } catch (e) { console.warn('[operators] bench failed', e); status('bench failed') }
  busy = false; measureBtn.disabled = false
  if (statusEl.textContent !== 'bench failed') status('')
  if (pending !== null) { const p = pending; pending = null; if (cur.name === p && !results.has(p)) measureNow() }
}
measureBtn.addEventListener('click', measureNow)
loadBtn.addEventListener('click', async () => {
  loadBtn.disabled = true
  await loadPeers((e, st) => { status(st === 'loading' ? `loading ${e.label}…` : ''); renderPeers() })
  const n = peersLoaded()
  put(loadBtn, n === ENGINES.length - 1 ? 'peers loaded' : 'load peers ▸')
  loadBtn.disabled = n === ENGINES.length - 1
  if (cur) { results.delete(cur.name); measureNow() }   // re-measure the selected operator WITH the peers
})

selectOp('filter')
