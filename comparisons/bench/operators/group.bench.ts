// @ts-nocheck
// `group` (bucketed count via length(fn)) — per-operator comparison.
//
// Workload: 10_000 rows over 10 categorical buckets. Compute count-per-cat
// (`length(d => d.cat)`). Single tick rewrites one row's `cat` — forces a
// bucket migration: decrement old bucket, increment new. Batch streams
// TICK_COUNT ticks with the bucketed counts read after each.
//
// data: LengthFnValue maintains a counter per bucket — O(Δ) per delta.
// crossfilter: dim.group().reduceCount() is the textbook equivalent.
// Other peers reduce/group all N rows on every emit.

import { measure, pkgVersion } from '../measure.ts'
import {
  makeRows, makeTicks,
  type Row, type Tick, type Variant, type OpBench,
} from './_shared.ts'

const TICKS = makeTicks(undefined, undefined, undefined, ['cat'])

const groupCount = (rows: Row[]) => {
  const out: Record<string, number> = {}
  for (let i = 0; i < rows.length; i++) {
    const c = rows[i].cat
    out[c] = (out[c] ?? 0) + 1
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
      const g = src.length(d => d.cat)
      return { src, g }
    }
    const setup = measure(() => { build() })
    const single = (() => {
      const { src, g } = build(); void g[value]
      let i = 0
      return measure(() => {
        const t = TICKS[i++ % TICKS.length]
        src[t.idx][t.field] = t.value
        void g[value]
      })
    })()
    const batch = (() => {
      const { src, g } = build(); void g[value]
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) {
          const t = TICKS[j]
          src[t.idx][t.field] = t.value
          void g[value]
        }
      })
    })()
    return { setup, single, batch }
  },
}

// --- crossfilter ---------------------------------------------------------

const crossfilterV: Variant = {
  name: 'crossfilter',
  version: pkgVersion('crossfilter2'),
  run: async () => {
    const cfMod: any = await import('crossfilter2')
    const crossfilter = cfMod.default ?? cfMod
    const build = () => {
      const state = makeRows().map(r => ({ ...r }))
      const cf = crossfilter(state)
      const dCat = cf.dimension(d => d.cat)
      const grp = dCat.group().reduceCount()
      return { cf, grp, state }
    }
    const setup = measure(() => { build() })
    const tick = (cf, state, t: Tick) => {
      cf.remove(d => d.id === t.idx)
      state[t.idx] = { ...state[t.idx], [t.field]: t.value }
      cf.add([state[t.idx]])
    }
    const single = (() => {
      const { cf, grp, state } = build(); void grp.all()
      let i = 0
      return measure(() => {
        tick(cf, state, TICKS[i++ % TICKS.length])
        void grp.all()
      })
    })()
    const batch = (() => {
      const { cf, grp, state } = build(); void grp.all()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) {
          tick(cf, state, TICKS[j])
          void grp.all()
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
      const g = computed(() => groupCount(rows))
      const dispose = autorun(() => { void g.get() })
      return { rows, g, dispose }
    }
    const setup = measure(() => { const g = build(); g.dispose() })
    const tickFn = (rows, t: Tick) => {
      runInAction(() => { rows[t.idx][t.field] = t.value })
    }
    const single = (() => {
      const { rows, g } = build()
      let i = 0
      return measure(() => { tickFn(rows, TICKS[i++ % TICKS.length]); void g.get() })
    })()
    const batch = (() => {
      const { rows, g } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(rows, TICKS[j]); void g.get() }
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
      const g$ = subj.pipe(map(groupCount))
      const sub = g$.subscribe(() => {})
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
    let g: () => Record<string, number> = () => ({})
    let dispose = () => {}
    const build = () => {
      dispose = createRoot(d => {
        cells = makeCells()
        g = createMemo(() => {
          const out: Record<string, number> = {}
          for (let i = 0; i < cells.length; i++) {
            const c = cells[i].cat()
            out[c] = (out[c] ?? 0) + 1
          }
          return out
        })
        void g()
        return d
      })
    }
    const setup = measure(() => { build(); dispose() })
    build()
    const tickFn = (t: Tick) => {
      if (t.field === 'cat') cells[t.idx].setCat(t.value as string)
    }
    const single = (() => {
      let i = 0
      return measure(() => { tickFn(TICKS[i++ % TICKS.length]); void g() })
    })()
    const batch = measure(() => {
      for (let j = 0; j < TICKS.length; j++) { tickFn(TICKS[j]); void g() }
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
      const g = computed(() => {
        const out: Record<string, number> = {}
        for (let i = 0; i < cells.length; i++) {
          const c = cells[i].cat.value
          out[c] = (out[c] ?? 0) + 1
        }
        return out
      })
      const stop = effect(() => { void g.value })
      return { cells, g, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const tickFn = (cells, t: Tick) => {
      if (t.field === 'cat') cells[t.idx].cat.value = t.value as string
    }
    const single = (() => {
      const { cells, g } = build()
      let i = 0
      return measure(() => { tickFn(cells, TICKS[i++ % TICKS.length]); void g.value })
    })()
    const batch = (() => {
      const { cells, g } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(cells, TICKS[j]); void g.value }
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
      const g = computed(() => groupCount(rows))
      const stop = effect(() => { void g.value })
      return { rows, g, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const tickFn = (rows, t: Tick) => { rows[t.idx][t.field] = t.value }
    const single = (() => {
      const { rows, g } = build()
      let i = 0
      return measure(() => { tickFn(rows, TICKS[i++ % TICKS.length]); void g.value })
    })()
    const batch = (() => {
      const { rows, g } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(rows, TICKS[j]); void g.value }
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
      const g = derived(store, groupCount)
      const unsub = g.subscribe(() => {})
      return { store, g, unsub }
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
      const { store, g } = build()
      let i = 0
      return measure(() => { tickFn(store, TICKS[i++ % TICKS.length]); void get(g) })
    })()
    const batch = (() => {
      const { store, g } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(store, TICKS[j]); void get(g) }
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
    let gRef: any = null
    function App() {
      const [rows, setRows] = useState(makeRows)
      const g = useMemo(() => groupCount(rows), [rows])
      setRowsRef = setRows
      gRef = g
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
      return measure(() => { tickFn(TICKS[i++ % TICKS.length]); void gRef })
    })()
    const batch = (() => {
      build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(TICKS[j]); void gRef }
      })
    })()
    return { setup, single, batch }
  },
}

const op: OpBench = {
  operator: 'group (bucketed count)',
  notes: 'length(d => d.cat) over 10k rows, 10 buckets; tick rewrites one row\'s cat',
  variants: [data, crossfilterV, mobxV, rxjsV, solidV, preactV, vueV, svelteV, reactV],
}
export default op
