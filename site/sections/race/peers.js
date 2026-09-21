/* sections/race/peers.js — the race's EIGHT peer adapters, lifted from the old
 * site's race.js (ref/assets/race.js) and re-shaped for variant d (stage 2).
 *
 * Every peer is the REAL library, loaded from esm.sh through the page's import
 * map ONLY when the visitor selects it (a dynamic import() — nothing here runs
 * on first paint), built on its own structuredClone of the SAME book data is
 * running (orders.snapshot() at the moment of selection), then fed the same
 * ticks every frame and settled ONCE PER FRAME (the real render cadence):
 *   • mobx / solid / preact / vue — a version signal + four derivations that
 *     re-walk all N rows (the idiomatic signal graph). ingest mutates plain
 *     state; settle bumps the version once and FORCE-reads the four
 *     derivations so the O(N) recompute lands inside the timed window
 *     (lazy libs recompute on the read, eager ones on the bump — either way
 *     it is measured).
 *   • rxjs — a Subject piped through four map()s, fired once per frame.
 *   • svelte/store — a writable version + four derived stores.
 *   • react — a headless root, four useMemo()s, flushSync'd once per frame.
 *   • crossfilter — dimensions × groups; an update is remove-then-add, which
 *     crossfilter rebuilds O(N) per tick (its groups fold incrementally).
 * The adapter contract: { ingest(idx, field, v), settle(), view(), dispose() }.
 * The caller times `for (ticks) ingest(); settle()` with performance.now() —
 * the same window it puts around data's batch() — so the peer's ms/frame and
 * the "N× data" multiple are two measurements from THIS tab, nothing canned.
 * Nothing in this file prints a number. */

// the four derivations every peer maintains — the same walks the old page
// inlined per adapter (liquid count, running mean bid, two price histograms)
export function derivations (trades, n, { bins, bucketOf, thresh }) {
  return {
    liquid () { let c = 0; for (let i = 0; i < n; i++) { const t = trades[i]; if (t.ask - t.bid > thresh) c++ } return c },
    avg () { let s = 0; for (let i = 0; i < n; i++) s += trades[i].bid; return s / n },
    bids () { const o = new Array(bins).fill(0); for (let i = 0; i < n; i++) o[bucketOf(trades[i].bid)]++; return o },
    asks () { const o = new Array(bins).fill(0); for (let i = 0; i < n; i++) o[bucketOf(trades[i].ask)]++; return o },
  }
}
const replace = (trades, idx, field, v) => { trades[idx] = { ...trades[idx], [field]: v } }

/* ---------- generic fine-grained signal engine (mobx / solid / preact / vue) ---------- */
// `prims` = { signal(v)->{get,set}, computed(fn)->read(), bump(fn), dispose? }
function makeSignalEngine (prims, trades, n, shape) {
  const d = derivations(trades, n, shape)
  const ver = prims.signal(0)
  const mk = fn => prims.computed(() => { ver.get(); return fn() })
  const liquid = mk(d.liquid), avg = mk(d.avg), bids = mk(d.bids), asks = mk(d.asks)
  const readers = [liquid, avg, bids, asks]
  return {
    ingest (idx, field, v) { replace(trades, idx, field, v) },
    settle () { prims.bump(() => ver.set(ver.get() + 1)); for (const rd of readers) rd() },
    view () { return { bids: bids(), asks: asks(), liquid: liquid(), avg: avg() } },
    dispose () { prims.dispose?.() },
  }
}

/* ---------- rxjs engine (Subject + 4 map, fired once/frame) ---------- */
function makeRxEngine ({ Subject, map }, trades, n, shape) {
  const d = derivations(trades, n, shape)
  const tick$ = new Subject()
  let L = 0, A = 0, B = new Array(shape.bins).fill(0), K = new Array(shape.bins).fill(0)
  const subs = [
    tick$.pipe(map(d.liquid)).subscribe(v => { L = v }),
    tick$.pipe(map(d.avg)).subscribe(v => { A = v }),
    tick$.pipe(map(d.bids)).subscribe(v => { B = v }),
    tick$.pipe(map(d.asks)).subscribe(v => { K = v }),
  ]
  return {
    ingest (idx, field, v) { replace(trades, idx, field, v) },
    settle () { tick$.next() },
    view () { return { bids: B, asks: K, liquid: L, avg: A } },
    dispose () { for (const s of subs) s.unsubscribe(); tick$.complete() },
  }
}

/* ---------- svelte/store engine (writable + 4 derived, fired once/frame) ---------- */
function makeSvelteEngine ({ writable, derived }, trades, n, shape) {
  const d = derivations(trades, n, shape)
  const ver = writable(0)
  let L = 0, A = 0, B = new Array(shape.bins).fill(0), K = new Array(shape.bins).fill(0)
  const unsubs = [
    derived(ver, d.liquid).subscribe(v => { L = v }),
    derived(ver, d.avg).subscribe(v => { A = v }),
    derived(ver, d.bids).subscribe(v => { B = v }),
    derived(ver, d.asks).subscribe(v => { K = v }),
  ]
  return {
    ingest (idx, field, v) { replace(trades, idx, field, v) },
    settle () { ver.update(v => v + 1) },
    view () { return { bids: B, asks: K, liquid: L, avg: A } },
    dispose () { for (const u of unsubs) u() },
  }
}

/* ---------- react engine (headless root, 4 useMemo, flushSync once/frame) ---------- */
function makeReactEngine ({ React, createRoot, flushSync }, trades, n, shape) {
  const { useState, useRef, useMemo, useImperativeHandle } = React
  const d = derivations(trades, n, shape)
  // React 19: the handle ref travels as a plain prop (forwardRef is the 18-era spelling)
  function App ({ handle }) {
    const [, setV] = useState(0)
    const tr = useRef(trades)
    // no dependency arrays on purpose: the book changed, so every render re-walks it
    const liquid = useMemo(d.liquid), avg = useMemo(d.avg), bids = useMemo(d.bids), asks = useMemo(d.asks)
    useImperativeHandle(handle, () => ({
      ingest (idx, field, v) { replace(tr.current, idx, field, v) },
      bump () { flushSync(() => setV(v => v + 1)) },
      view: () => ({ bids, asks, liquid, avg }),
    }), [bids, asks, liquid, avg])
    return null
  }
  const host = document.createElement('div')
  const root = createRoot(host)
  const handle = React.createRef()
  flushSync(() => root.render(React.createElement(App, { handle })))
  return {
    ingest (idx, field, v) { handle.current.ingest(idx, field, v) },
    settle () { handle.current.bump() },
    view () { return handle.current.view() },
    dispose () { root.unmount() },
  }
}

/* ---------- crossfilter engine (dimensions/groups, incremental on add/remove) ---------- */
function makeCrossfilterEngine (crossfilter, trades, n, shape) {
  const { bins, bucketOf, thresh } = shape
  const cf = crossfilter([])
  const rows = new Array(n); for (let i = 0; i < n; i++) rows[i] = trades[i]; cf.add(rows)
  const idDim = cf.dimension(r => r.id)
  const bidDim = cf.dimension(r => bucketOf(r.bid)), askDim = cf.dimension(r => bucketOf(r.ask))
  const liqDim = cf.dimension(r => (r.ask - r.bid) > thresh ? 1 : 0)
  const bidG = bidDim.group().reduceCount(), askG = askDim.group().reduceCount(), liqG = liqDim.group().reduceCount()
  const avgAcc = cf.groupAll().reduce((a, r) => { a.sum += r.bid; a.n++; return a }, (a, r) => { a.sum -= r.bid; a.n--; return a }, () => ({ sum: 0, n: 0 }))
  return {
    ingest (idx, field, v) { const nr = { ...trades[idx], [field]: v }; trades[idx] = nr; idDim.filter(idx); cf.remove(); idDim.filterAll(); cf.add([nr]) },
    settle () { /* the groups fold incrementally on remove + add */ },
    view () {
      const b = new Array(bins).fill(0); for (const { key, value } of bidG.all()) b[key] = value
      const a = new Array(bins).fill(0); for (const { key, value } of askG.all()) a[key] = value
      let L = 0; for (const { key, value } of liqG.all()) if (key === 1) L = value
      const av = avgAcc.value()
      return { bids: b, asks: a, liquid: L, avg: av.n ? av.sum / av.n : 0 }
    },
    dispose () { bidG.dispose(); askG.dispose(); liqG.dispose(); avgAcc.dispose(); idDim.dispose(); bidDim.dispose(); askDim.dispose(); liqDim.dispose() },
  }
}

/* ---------- the loader: ONE dynamic import per selection, then a synchronous build ----------
   loadPeer(id) resolves — after the esm.sh import — to make(book, n, shape): a SYNCHRONOUS
   constructor, so the caller can clone the live book and build the peer in one stretch with
   no frame in between (the two engines then start from the identical book).
   `book` = the peer's OWN copy (structuredClone(orders.snapshot())), `n` = its row count,
   `shape` = { bins, bucketOf, thresh } — the buckets and liquidity threshold data's views use. */
export async function loadPeer (id) {
  switch (id) {
    case 'mobx': {
      const { observable, computed, runInAction } = await import('mobx')
      // keepAlive: a computed read outside a reaction is otherwise recomputed on EVERY read
      return (book, n, shape) => makeSignalEngine({ signal: v => { const b = observable.box(v); return { get: () => b.get(), set: x => b.set(x) } }, computed: fn => { const c = computed(fn, { keepAlive: true }); return () => c.get() }, bump: runInAction }, book, n, shape)
    }
    case 'preact': {
      const { signal, computed, batch } = await import('@preact/signals-core')
      return (book, n, shape) => makeSignalEngine({ signal: v => { const s = signal(v); return { get: () => s.value, set: x => { s.value = x } } }, computed: fn => { const c = computed(fn); return () => c.value }, bump: batch }, book, n, shape)
    }
    case 'vue': {
      const { shallowRef, computed } = await import('@vue/reactivity')
      return (book, n, shape) => makeSignalEngine({ signal: v => { const r = shallowRef(v); return { get: () => r.value, set: x => { r.value = x } } }, computed: fn => { const c = computed(fn); return () => c.value }, bump: fn => fn() }, book, n, shape)
    }
    case 'solid': {
      const { createSignal, createMemo, createRoot, batch } = await import('solid-js')
      // solid memos need an owner: the whole engine is built under one root, disposed with it
      return (book, n, shape) => { let e; createRoot(dispose => { e = makeSignalEngine({ signal: v => { const [g, s] = createSignal(v); return { get: g, set: s } }, computed: fn => createMemo(fn), bump: batch, dispose }, book, n, shape) }); return e }
    }
    case 'rxjs': {
      const { Subject } = await import('rxjs'); const { map } = await import('rxjs/operators')
      return (book, n, shape) => makeRxEngine({ Subject, map }, book, n, shape)
    }
    case 'svelte': {
      const { writable, derived } = await import('svelte/store')
      return (book, n, shape) => makeSvelteEngine({ writable, derived }, book, n, shape)
    }
    case 'react': {
      const React = (await import('react')).default
      const { createRoot } = await import('react-dom/client'); const { flushSync } = await import('react-dom')
      return (book, n, shape) => makeReactEngine({ React, createRoot, flushSync }, book, n, shape)
    }
    case 'crossfilter': {
      const crossfilter = (await import('crossfilter2')).default
      return (book, n, shape) => makeCrossfilterEngine(crossfilter, book, n, shape)
    }
  }
  throw new Error(`unknown peer ${id}`)
}

// the old race's per-engine SAFE tick rate (log10 ticks/sec) to snap to on
// selection: the O(N)/frame libraries start gentler so their first frames
// don't stall, then the visitor pushes the slider back up
export const DEF_RATE = { data: 3.3, mobx: 2.8, solid: 2.8, preact: 2.8, vue: 2.8, crossfilter: 1.8, svelte: 2.3, rxjs: 2.3, react: 2.2 }

// the version the page actually pulls: read off the import map's pinned esm.sh
// URL (e.g. https://esm.sh/mobx@6.15.3) — a build-tier fact, never typed here
const SPECIFIER = { mobx: 'mobx', solid: 'solid-js', preact: '@preact/signals-core', vue: '@vue/reactivity', crossfilter: 'crossfilter2', svelte: 'svelte/store', rxjs: 'rxjs', react: 'react' }
export function peerVersion (id) {
  try {
    const imports = JSON.parse(document.querySelector('script[type="importmap"]').textContent).imports
    const m = String(imports[SPECIFIER[id]] || '').match(/@(\d+\.\d+\.\d+[^/]*)/)
    return m ? m[1] : ''
  } catch { return '' }
}
