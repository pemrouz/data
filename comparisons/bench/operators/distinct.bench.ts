// @ts-nocheck
// `distinct` — per-operator comparison.
//
// Workload: 10_000 rows; distinct list of `cat` values (10 buckets in
// first-seen order). Single tick rewrites one row's `cat`. Batch streams
// TICK_COUNT ticks with the distinct set read after each.
//
// data.distinct rebuilds on every upstream event (O(N), see
// operators/distinct/index.ts comments — the operator documents that
// incremental is a known optimization, not yet implemented). Most peers
// also walk N per emit. This is one of the "not optimized for incremental"
// cases — useful to surface where data is currently no better than peers.

import { measure, pkgVersion } from '../measure.ts'
import {
  makeRows, makeTicks,
  type Row, type Tick, type Variant, type OpBench,
} from './_shared.ts'

const TICKS = makeTicks(undefined, undefined, undefined, ['cat'])

const distinctCats = (rows: Row[]) => {
  const seen = new Set<string>()
  const out: string[] = []
  for (let i = 0; i < rows.length; i++) {
    const c = rows[i].cat
    if (!seen.has(c)) { seen.add(c); out.push(c) }
  }
  return out
}

// --- data -----------------------------------------------------------------

const data: Variant = {
  name: 'data',
  version: '1.0.0',
  run: async () => {
    const { $, value } = await import('../../../full.ts')
    const toObj = (rows: Row[]) => {
      const obj: Record<number, Row> = {}
      for (let i = 0; i < rows.length; i++) obj[i] = rows[i]
      return obj
    }
    const build = () => {
      const src = $(toObj(makeRows()))
      const d = src.distinct(r => r.cat)
      return { src, d }
    }
    const setup = measure(() => { build() })
    const single = (() => {
      const { src, d } = build(); void d[value]
      let i = 0
      return measure(() => {
        const t = TICKS[i++ % TICKS.length]
        src[t.idx][t.field] = t.value
        void d[value]
      })
    })()
    const batch = (() => {
      const { src, d } = build(); void d[value]
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) {
          const t = TICKS[j]
          src[t.idx][t.field] = t.value
          void d[value]
        }
      })
    })()
    return { setup, single, batch }
  },
}

// --- mobx ----------------------------------------------------------------

const mobxV: Variant = {
  name: 'mobx',
  version: pkgVersion('mobx'),
  run: async () => {
    const { observable, computed, runInAction, autorun } = await import('mobx')
    const build = () => {
      const rows = observable.array(
        makeRows().map(r => observable.object(r, {}, { deep: false })),
      )
      const d = computed(() => distinctCats(rows))
      const dispose = autorun(() => { void d.get() })
      return { rows, d, dispose }
    }
    const setup = measure(() => { const g = build(); g.dispose() })
    const tickFn = (rows, t: Tick) => {
      runInAction(() => { rows[t.idx][t.field] = t.value })
    }
    const single = (() => {
      const { rows, d } = build()
      let i = 0
      return measure(() => { tickFn(rows, TICKS[i++ % TICKS.length]); void d.get() })
    })()
    const batch = (() => {
      const { rows, d } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(rows, TICKS[j]); void d.get() }
      })
    })()
    return { setup, single, batch }
  },
}

// --- rxjs ----------------------------------------------------------------

const rxjsV: Variant = {
  name: 'rxjs',
  version: pkgVersion('rxjs'),
  run: async () => {
    const { BehaviorSubject } = await import('rxjs')
    const { map } = await import('rxjs/operators')
    const build = () => {
      const subj = new BehaviorSubject(makeRows())
      const d$ = subj.pipe(map(distinctCats))
      const sub = d$.subscribe(() => {})
      return { subj, sub }
    }
    const setup = measure(() => { const g = build(); g.sub.unsubscribe() })
    const tickFn = (subj, t: Tick) => {
      const next = subj.value.slice()
      next[t.idx] = { ...next[t.idx], [t.field]: t.value }
      subj.next(next)
    }
    const single = (() => {
      const { subj } = build()
      let i = 0
      return measure(() => { tickFn(subj, TICKS[i++ % TICKS.length]) })
    })()
    const batch = (() => {
      const { subj } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) tickFn(subj, TICKS[j])
      })
    })()
    return { setup, single, batch }
  },
}

// --- solid ----------------------------------------------------------------

const solidV: Variant = {
  name: 'solid',
  version: pkgVersion('solid-js'),
  run: async () => {
    const { createSignal, createMemo, createRoot } = await import('solid-js/dist/solid.js')
    type Cell = { id: number, cat: () => string, setCat: (v: string) => void }
    const makeCells = (): Cell[] => makeRows().map(r => {
      const [cat, setCat] = createSignal(r.cat)
      return { id: r.id, cat, setCat } as Cell
    })
    let cells: Cell[] = []
    let d: () => string[] = () => []
    let dispose = () => {}
    const build = () => {
      dispose = createRoot(dis => {
        cells = makeCells()
        d = createMemo(() => {
          const seen = new Set<string>()
          const out: string[] = []
          for (let i = 0; i < cells.length; i++) {
            const c = cells[i].cat()
            if (!seen.has(c)) { seen.add(c); out.push(c) }
          }
          return out
        })
        void d()
        return dis
      })
    }
    const setup = measure(() => { build(); dispose() })
    build()
    const tickFn = (t: Tick) => {
      if (t.field === 'cat') cells[t.idx].setCat(t.value as string)
    }
    const single = (() => {
      let i = 0
      return measure(() => { tickFn(TICKS[i++ % TICKS.length]); void d() })
    })()
    const batch = measure(() => {
      for (let j = 0; j < TICKS.length; j++) { tickFn(TICKS[j]); void d() }
    })
    dispose()
    return { setup, single, batch }
  },
}

// --- preact-signals ------------------------------------------------------

const preactV: Variant = {
  name: 'preact-signals',
  version: pkgVersion('@preact/signals-core'),
  run: async () => {
    const { signal, computed, effect } = await import('@preact/signals-core')
    type Cell = { id: number, cat: any }
    const makeCells = (): Cell[] => makeRows().map(r => ({
      id: r.id, cat: signal(r.cat),
    }))
    const build = () => {
      const cells = makeCells()
      const d = computed(() => {
        const seen = new Set<string>()
        const out: string[] = []
        for (let i = 0; i < cells.length; i++) {
          const c = cells[i].cat.value
          if (!seen.has(c)) { seen.add(c); out.push(c) }
        }
        return out
      })
      const stop = effect(() => { void d.value })
      return { cells, d, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const tickFn = (cells, t: Tick) => {
      if (t.field === 'cat') cells[t.idx].cat.value = t.value as string
    }
    const single = (() => {
      const { cells, d } = build()
      let i = 0
      return measure(() => { tickFn(cells, TICKS[i++ % TICKS.length]); void d.value })
    })()
    const batch = (() => {
      const { cells, d } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(cells, TICKS[j]); void d.value }
      })
    })()
    return { setup, single, batch }
  },
}

// --- vue-reactivity ------------------------------------------------------

const vueV: Variant = {
  name: 'vue-reactivity',
  version: pkgVersion('@vue/reactivity'),
  run: async () => {
    const { reactive, computed, effect } = await import('@vue/reactivity')
    const build = () => {
      const rows = reactive(makeRows())
      const d = computed(() => distinctCats(rows))
      const stop = effect(() => { void d.value })
      return { rows, d, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const tickFn = (rows, t: Tick) => { rows[t.idx][t.field] = t.value }
    const single = (() => {
      const { rows, d } = build()
      let i = 0
      return measure(() => { tickFn(rows, TICKS[i++ % TICKS.length]); void d.value })
    })()
    const batch = (() => {
      const { rows, d } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(rows, TICKS[j]); void d.value }
      })
    })()
    return { setup, single, batch }
  },
}

// --- svelte-store --------------------------------------------------------

const svelteV: Variant = {
  name: 'svelte-store',
  version: pkgVersion('svelte'),
  run: async () => {
    const { writable, derived, get } = await import('svelte/store')
    const build = () => {
      const store = writable(makeRows())
      const d = derived(store, distinctCats)
      const unsub = d.subscribe(() => {})
      return { store, d, unsub }
    }
    const setup = measure(() => { const g = build(); g.unsub() })
    const tickFn = (store, t: Tick) => {
      store.update(rows => {
        const next = rows.slice()
        next[t.idx] = { ...next[t.idx], [t.field]: t.value }
        return next
      })
    }
    const single = (() => {
      const { store, d } = build()
      let i = 0
      return measure(() => { tickFn(store, TICKS[i++ % TICKS.length]); void get(d) })
    })()
    const batch = (() => {
      const { store, d } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(store, TICKS[j]); void get(d) }
      })
    })()
    return { setup, single, batch }
  },
}

// --- react ---------------------------------------------------------------

const reactV: Variant = {
  name: 'react',
  version: pkgVersion('react'),
  run: async () => {
    await import('../react-act-env.ts')
    const ReactMod: any = await import('react')
    const React = ReactMod.default ?? ReactMod
    const RTRMod: any = await import('react-test-renderer')
    const TestRenderer = RTRMod.default ?? RTRMod
    const { act, create } = TestRenderer
    const h = React.createElement
    const { useState, useMemo } = React
    let setRowsRef: (fn: any) => void = () => {}
    let dRef: any = null
    function App() {
      const [rows, setRows] = useState(makeRows)
      const d = useMemo(() => distinctCats(rows), [rows])
      setRowsRef = setRows
      dRef = d
      return null
    }
    const build = () => {
      let renderer: any
      act(() => { renderer = create(h(App)) })
      return { renderer }
    }
    const setup = measure(() => { const g = build(); act(() => { g.renderer.unmount() }) })
    const tickFn = (t: Tick) => {
      act(() => {
        setRowsRef((prev: any[]) => {
          const next = prev.slice()
          next[t.idx] = { ...next[t.idx], [t.field]: t.value }
          return next
        })
      })
    }
    const single = (() => {
      build()
      let i = 0
      return measure(() => { tickFn(TICKS[i++ % TICKS.length]); void dRef })
    })()
    const batch = (() => {
      build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(TICKS[j]); void dRef }
      })
    })()
    return { setup, single, batch }
  },
}

const op: OpBench = {
  operator: 'distinct',
  notes: 'distinct(r => r.cat) over 10k rows, 10 buckets; tick rewrites one cat. crossfilter omitted — its dimension.group() form is bucketed-count, benched separately under `group`',
  variants: [data, mobxV, rxjsV, solidV, preactV, vueV, svelteV, reactV],
}
export default op
