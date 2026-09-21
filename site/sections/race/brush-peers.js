/* sections/race/brush-peers.js — the brushing card's EIGHT peer lanes, lifted from
 * the old site's multidim rows (ref/multidim/lib-*.js — their reactive cores; the
 * chart/top-list mounting is not ported) and re-shaped for variant d.
 *
 * Every peer is the REAL library, loaded from esm.sh through the page's import map
 * ONLY when the visitor selects it (the same dynamic import() the order-book peer in
 * race/peers.js makes — the module graph dedups, nothing is fetched twice), built over
 * the SAME row objects the engine adopted with $(flights) (nobody mutates a flight, so
 * both engines read one array), seeded with the ranges data holds at that instant, then
 * driven by the same drags:
 *   • mobx / solid / preact / vue — one signal per filter, four leave-one-out histogram
 *     computeds (each reads the OTHER three filters and walks all N rows) and an
 *     active-count computed over all four — the old lib-mobx.js shape; brushing one
 *     chart invalidates three histograms + the count, never the brushed chart's own.
 *   • rxjs — a BehaviorSubject of the filter state piped through five map()s; every
 *     emission re-runs all five walks (rxjs tracks nothing per key).
 *   • svelte/store — a writable per filter, derived() over the other three per
 *     histogram and over all four for the count, subscribed — a set() recomputes
 *     synchronously.
 *   • react — a headless root, useState filters, useMemo histograms + count keyed on
 *     the filters OBJECT (every brush replaces it, so all five recompute — no per-key
 *     tracking in React), one flushSync per brush.
 *   • crossfilter — one dimension per dim, dim.group(bucket) per histogram (a group
 *     excludes its own dimension's filter: leave-one-out is crossfilter's native idiom),
 *     groupAll() for the count; a brush is dim.filterRange — its incremental index,
 *     so it may well be FAST here; the page prints whatever is measured.
 * The adapter contract: { brush(name, [lo, hi]), hist(name) → Float64Array (dense —
 * index (bucket − domain[0]) / step, exactly the chart's bins and data's flatInto),
 * active() → count, dispose() }. The caller (race/brush.js) times
 * `brush(); hist() × 4; active()` with performance.now(): eager libraries walk inside
 * brush(), lazy ones (the mobx / preact / vue computeds) on the forced read — either
 * way the O(N) work lands inside the window, the same window it puts around data's
 * `filters.get(name).update(bounds)`. Bounds are inclusive on both ends, as data's
 * between is (ops/between.ts); crossfilter's filterRange is [lo, hi), so its upper
 * bound is nudged by half the dimension's value resolution (INCL) to select the same
 * rows. The walks bucket with DEFS.bin / DEFS.bucket from race/brush.js — the very
 * functions data's length(bin) uses. Nothing in this file prints a number. */
import { DEFS } from './brush.js'

const NAMES = DEFS.map(d => d.name)
const byName = Object.fromEntries(DEFS.map(d => [d.name, d]))
const binsOf = def => Math.round((def.domain[1] - def.domain[0]) / def.step)
const othersOf = def => NAMES.filter(n => n !== def.name)

/* ---------- the two walks every non-crossfilter peer runs (the old lanes' bodies) ----------
   ranges: the [lo, hi] pairs of `names`, in order. The bounds are read into locals ONCE —
   a per-row read through an observable proxy would measure the proxy, not the library. */
export function histOf (rows, def, names, ranges) {
  const out = new Float64Array(binsOf(def))
  const [a, b, c] = names, [ra, rb, rc] = ranges
  const a0 = ra[0], a1 = ra[1], b0 = rb[0], b1 = rb[1], c0 = rc[0], c1 = rc[1]
  const d0 = def.domain[0], step = def.step, bin = def.bin
  for (let i = 0, n = rows.length; i < n; i++) {
    const t = rows[i]
    const va = t[a]; if (va < a0 || va > a1) continue
    const vb = t[b]; if (vb < b0 || vb > b1) continue
    const vc = t[c]; if (vc < c0 || vc > c1) continue
    out[Math.round((bin(t) - d0) / step)]++
  }
  return out
}
export function activeOf (rows, ranges) {
  const [a, b, c, d] = NAMES, [ra, rb, rc, rd] = ranges
  const a0 = ra[0], a1 = ra[1], b0 = rb[0], b1 = rb[1], c0 = rc[0], c1 = rc[1], d0 = rd[0], d1 = rd[1]
  let k = 0
  for (let i = 0, n = rows.length; i < n; i++) {
    const t = rows[i]
    const va = t[a]; if (va < a0 || va > a1) continue
    const vb = t[b]; if (vb < b0 || vb > b1) continue
    const vc = t[c]; if (vc < c0 || vc > c1) continue
    const vd = t[d]; if (vd < d0 || vd > d1) continue
    k++
  }
  return k
}

/* ---------- generic fine-grained signal lane (mobx / solid / preact / vue) ---------- */
// `prims` = { signal(v)->{get,set}, computed(fn)->read(), bump(fn), dispose? }
function makeSignalLane (prims, rows, seed) {
  const sig = {}
  for (const n of NAMES) sig[n] = prims.signal(seed[n])
  const hists = {}
  for (const def of DEFS) {
    const others = othersOf(def)
    hists[def.name] = prims.computed(() => histOf(rows, def, others, others.map(n => sig[n].get())))
  }
  const active = prims.computed(() => activeOf(rows, NAMES.map(n => sig[n].get())))
  return {
    brush (name, bounds) { prims.bump(() => sig[name].set(bounds)) },
    hist (name) { return hists[name]() },
    active () { return active() },
    dispose () { prims.dispose?.() },
  }
}

/* ---------- rxjs lane (BehaviorSubject of the filters + 5 map, all re-run per emission) ---------- */
function makeRxLane ({ BehaviorSubject, map }, rows, seed) {
  const state$ = new BehaviorSubject({ ...seed })
  const H = {}, subs = []
  let A = 0
  for (const def of DEFS) {
    const others = othersOf(def)
    subs.push(state$.pipe(map(f => histOf(rows, def, others, others.map(n => f[n])))).subscribe(v => { H[def.name] = v }))
  }
  subs.push(state$.pipe(map(f => activeOf(rows, NAMES.map(n => f[n])))).subscribe(v => { A = v }))
  return {
    brush (name, bounds) { state$.next({ ...state$.value, [name]: bounds }) },
    hist (name) { return H[name] },
    active () { return A },
    dispose () { for (const s of subs) s.unsubscribe(); state$.complete() },
  }
}

/* ---------- svelte/store lane (writable per filter + derived over the others, subscribed) ---------- */
function makeSvelteLane ({ writable, derived }, rows, seed) {
  const st = {}
  for (const n of NAMES) st[n] = writable(seed[n])
  const H = {}, unsubs = []
  let A = 0
  for (const def of DEFS) {
    const others = othersOf(def)
    unsubs.push(derived(others.map(n => st[n]), rs => histOf(rows, def, others, rs)).subscribe(v => { H[def.name] = v }))
  }
  unsubs.push(derived(NAMES.map(n => st[n]), rs => activeOf(rows, rs)).subscribe(v => { A = v }))
  return {
    brush (name, bounds) { st[name].set(bounds) },
    hist (name) { return H[name] },
    active () { return A },
    dispose () { for (const u of unsubs) u() },
  }
}

/* ---------- react lane (headless root, useState filters, useMemo × 5, flushSync per brush) ---------- */
function makeReactLane ({ React, createRoot, flushSync }, rows, seed) {
  const { useState, useMemo, useImperativeHandle } = React
  function App ({ handle }) {
    const [filters, setFilters] = useState(seed)
    // keyed on the filters object: a brush replaces it, so every memo recomputes (the
    // brushed chart's own histogram too — React has no per-key dependency tracking)
    const hists = useMemo(() => {
      const o = {}
      for (const def of DEFS) { const others = othersOf(def); o[def.name] = histOf(rows, def, others, others.map(n => filters[n])) }
      return o
    }, [filters])
    const active = useMemo(() => activeOf(rows, NAMES.map(n => filters[n])), [filters])
    useImperativeHandle(handle, () => ({
      brush (name, bounds) { flushSync(() => setFilters(f => ({ ...f, [name]: bounds }))) },
      hist: name => hists[name],
      active: () => active,
    }), [hists, active])
    return null
  }
  const host = document.createElement('div')
  const root = createRoot(host)
  const handle = React.createRef()
  flushSync(() => root.render(React.createElement(App, { handle })))
  return {
    brush (name, bounds) { handle.current.brush(name, bounds) },
    hist (name) { return handle.current.hist(name) },
    active () { return handle.current.active() },
    dispose () { root.unmount() },
  }
}

/* ---------- crossfilter lane (dimension per dim, group(bucket) per chart, groupAll count) ----------
   data's between is inclusive on both ends; filterRange is [lo, hi) — the upper bound is
   nudged by half the dimension's value resolution (DEFS[].res: time = hh + mm/60, delay /
   distance integers, date whole minutes in ms) so the two select the same rows. */
const INCL = Object.fromEntries(DEFS.map(d => [d.name, d.res / 2]))
function makeCrossfilterLane (crossfilter, rows, seed) {
  const cf = crossfilter(rows)
  const dims = {}, groups = {}
  for (const def of DEFS) { const k = def.name; dims[k] = cf.dimension(r => r[k]); groups[k] = dims[k].group(def.bucket) }
  const all = cf.groupAll()
  const apply = (name, bounds) => dims[name].filterRange([bounds[0], bounds[1] + INCL[name]])
  for (const n of NAMES) apply(n, seed[n])
  return {
    brush: apply,
    hist (name) {
      const def = byName[name], out = new Float64Array(binsOf(def))
      for (const { key, value } of groups[name].all()) out[Math.round((key - def.domain[0]) / def.step)] = value
      return out
    },
    active () { return all.value() },
    dispose () { all.dispose(); for (const n of NAMES) { groups[n].dispose(); dims[n].dispose() } },
  }
}

/* ---------- the loader: ONE dynamic import per selection, then a synchronous build ----------
   loadBrushPeer(id) resolves — after the esm.sh import (deduped with the order-book peer's)
   — to make(rows, seed): a SYNCHRONOUS constructor over the engine's adopted row array,
   `seed` = { time, delay, distance, date } → the [lo, hi] each dimension currently holds in
   data's filters, so the peer's first histograms equal data's. The caller yields a frame
   before calling it (the tag line says "building …" first) and times the call. */
export async function loadBrushPeer (id) {
  switch (id) {
    case 'mobx': {
      const { observable, computed, runInAction } = await import('mobx')
      // keepAlive: a computed read outside a reaction is otherwise recomputed on EVERY read;
      // deep: false — a [lo, hi] pair is an opaque value, not a collection to proxy
      return (rows, seed) => makeSignalLane({ signal: v => { const b = observable.box(v, { deep: false }); return { get: () => b.get(), set: x => b.set(x) } }, computed: fn => { const c = computed(fn, { keepAlive: true }); return () => c.get() }, bump: runInAction }, rows, seed)
    }
    case 'preact': {
      const { signal, computed, batch } = await import('@preact/signals-core')
      return (rows, seed) => makeSignalLane({ signal: v => { const s = signal(v); return { get: () => s.value, set: x => { s.value = x } } }, computed: fn => { const c = computed(fn); return () => c.value }, bump: batch }, rows, seed)
    }
    case 'vue': {
      const { shallowRef, computed } = await import('@vue/reactivity')
      return (rows, seed) => makeSignalLane({ signal: v => { const r = shallowRef(v); return { get: () => r.value, set: x => { r.value = x } } }, computed: fn => { const c = computed(fn); return () => c.value }, bump: fn => fn() }, rows, seed)
    }
    case 'solid': {
      const { createSignal, createMemo, createRoot, batch } = await import('solid-js')
      // solid memos need an owner: the whole lane is built under one root, disposed with it
      return (rows, seed) => { let e; createRoot(dispose => { e = makeSignalLane({ signal: v => { const [g, s] = createSignal(v); return { get: g, set: s } }, computed: fn => createMemo(fn), bump: batch, dispose }, rows, seed) }); return e }
    }
    case 'rxjs': {
      const { BehaviorSubject } = await import('rxjs'); const { map } = await import('rxjs/operators')
      return (rows, seed) => makeRxLane({ BehaviorSubject, map }, rows, seed)
    }
    case 'svelte': {
      const { writable, derived } = await import('svelte/store')
      return (rows, seed) => makeSvelteLane({ writable, derived }, rows, seed)
    }
    case 'react': {
      const React = (await import('react')).default
      const { createRoot } = await import('react-dom/client'); const { flushSync } = await import('react-dom')
      return (rows, seed) => makeReactLane({ React, createRoot, flushSync }, rows, seed)
    }
    case 'crossfilter': {
      const crossfilter = (await import('crossfilter2')).default
      return (rows, seed) => makeCrossfilterLane(crossfilter, rows, seed)
    }
  }
  throw new Error(`unknown peer ${id}`)
}
