// @ts-nocheck
// svelte/store — writable<Trade[]> + derived computing top-K.

import { writable, derived, get } from 'svelte/store'
import { makeTrades, TICKS, THRESHOLD, TOP_K } from './workload.ts'
import { measure, pkgVersion, type BenchResult } from './measure.ts'

function build() {
  const store = writable(makeTrades())
  const top = derived(store, rows => {
    const out = []
    for (let i = 0; i < rows.length; i++) {
      const t = rows[i]
      const spread = t.ask - t.bid
      if (spread > THRESHOLD) out.push({ id: t.id, spread })
    }
    out.sort((a, b) => b.spread - a.spread)
    return out.slice(0, TOP_K)
  })
  let last: any[] = []
  const unsub = top.subscribe(v => { last = v })
  return { store, top, unsub, getLast: () => last }
}

function tick(store, t) {
  store.update(rows => {
    const next = rows.slice()
    next[t.idx] = { ...next[t.idx], [t.field]: t.newValue }
    return next
  })
}

export default function bench(): BenchResult {
  const setup = measure(() => {
    const g = build()
    g.unsub()
  })

  const single = (() => {
    const { store, top } = build()
    let i = 0
    return measure(() => {
      tick(store, TICKS[i++ % TICKS.length])
      void get(top)
    })
  })()

  const stream = (() => {
    const { store, top } = build()
    return measure(() => {
      for (let j = 0; j < TICKS.length; j++) {
        tick(store, TICKS[j])
        void get(top)
      }
    })
  })()

  return {
    name: 'svelte-store',
    version: pkgVersion('svelte'),
    setup,
    single,
    batch: stream,
    notes: 'writable + derived; full filter + sort + slice per .update',
  }
}
