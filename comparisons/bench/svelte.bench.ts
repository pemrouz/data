// svelte/store — three chained `derived`s + dashboard adds two parallel
// deriveds (liquidCount, avgBid).

import { writable, derived, get } from 'svelte/store'
import { makeTrades, TICKS, THRESHOLD, TOP_K } from './workload.ts'
import { measure, pkgVersion, type BenchResult } from './measure.ts'

function buildSingle() {
  const store = writable(makeTrades())
  const withSpread = derived(store, (rows: any) => {
    const out = new Array(rows.length)
    for (let i = 0; i < rows.length; i++) {
      const t = rows[i]
      out[i] = { id: t.id, spread: t.ask - t.bid }
    }
    return out
  })
  const filtered = derived(withSpread, (rows: any) => rows.filter((t: any) => t.spread > THRESHOLD))
  const top = derived(filtered, (rows: any) => [...rows].sort((a: any, b: any) => b.spread - a.spread).slice(0, TOP_K))
  const unsub = top.subscribe(() => {})
  return { store, top, unsub }
}

function buildDashboard() {
  const store = writable(makeTrades())
  const liquidCount = derived(store, (rows: any) => {
    let n = 0
    for (let i = 0; i < rows.length; i++) {
      const t = rows[i]
      if (t.ask - t.bid > THRESHOLD) n++
    }
    return n
  })
  const withSpread = derived(store, (rows: any) => {
    const out = new Array(rows.length)
    for (let i = 0; i < rows.length; i++) {
      const t = rows[i]
      out[i] = { id: t.id, spread: t.ask - t.bid }
    }
    return out
  })
  const filtered = derived(withSpread, (rows: any) => rows.filter((t: any) => t.spread > THRESHOLD))
  const top10 = derived(filtered, (rows: any) => [...rows].sort((a: any, b: any) => b.spread - a.spread).slice(0, TOP_K))
  const avgBid = derived(store, (rows: any) => {
    let s = 0
    for (let i = 0; i < rows.length; i++) s += rows[i].bid
    return s / rows.length
  })
  const unsubs = [
    liquidCount.subscribe(() => {}),
    top10.subscribe(() => {}),
    avgBid.subscribe(() => {}),
  ]
  return { store, liquidCount, top10, avgBid, unsubs }
}

function tick(store: any, t: any) {
  store.update((rows: any) => {
    const next = rows.slice()
    next[t.idx] = { ...next[t.idx], [t.field]: t.newValue }
    return next
  })
}

export default function bench(): BenchResult {
  const setup = measure(() => {
    const g = buildSingle()
    g.unsub()
  })

  const single = (() => {
    const { store, top } = buildSingle()
    let i = 0
    return measure(() => {
      tick(store, TICKS[i++ % TICKS.length])
      void get(top)
    })
  })()

  const stream = (() => {
    const { store, top } = buildSingle()
    return measure(() => {
      for (let j = 0; j < TICKS.length; j++) {
        tick(store, TICKS[j])
        void get(top)
      }
    })
  })()

  const dashboard = (() => {
    const { store, liquidCount, top10, avgBid } = buildDashboard()
    return measure(() => {
      for (let j = 0; j < TICKS.length; j++) {
        tick(store, TICKS[j])
        void get(liquidCount)
        void get(top10)
        void get(avgBid)
      }
    })
  })()

  return {
    name: 'svelte-store',
    version: pkgVersion('svelte'),
    setup,
    single,
    batch: stream,
    dashboard,
    notes: 'writable + chained deriveds; dashboard = 3 parallel deriveds',
  }
}
