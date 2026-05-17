// @ts-nocheck
// `sort` / `za` (top-K) — per-operator comparison.
//
// Workload: 10_000 rows; top 10 by `val` (descending). Single tick rewrites
// one row's `val` to a fresh value drawn from the same distribution. Batch
// streams TICK_COUNT ticks with the top-10 read after each.
//
// data.za is the incremental limited sort — a heap-backed window that only
// rotates rows around its boundary on each BU2. crossfilter has dim.top(K)
// over a sorted dimension. Other peers re-sort + slice on every emit.

import { measure, pkgVersion } from '../measure.ts'
import {
  makeRows, makeTicks,
  type Row, type Tick, type Variant, type OpBench,
} from './_shared.ts'

const TICKS = makeTicks(undefined, undefined, undefined, ['val'])
const K = 10

const byValDesc = (a: { val: number }, b: { val: number }) => b.val - a.val
const sortAndSlice = (rows: Row[]) => rows.slice().sort(byValDesc).slice(0, K)

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
      const top = src.za('val', K)
      return { src, top }
    }
    const setup = measure(() => { build() })
    const single = (() => {
      const { src, top } = build(); void top[value]
      let i = 0
      return measure(() => {
        const t = TICKS[i++ % TICKS.length]
        src[t.idx][t.field] = t.value
        void top[value]
      })
    })()
    const batch = (() => {
      const { src, top } = build(); void top[value]
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) {
          const t = TICKS[j]
          src[t.idx][t.field] = t.value
          void top[value]
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
      const dVal = cf.dimension(d => d.val)
      return { cf, dVal, state }
    }
    const setup = measure(() => { build() })
    const tick = (cf, state, t: Tick) => {
      cf.remove(d => d.id === t.idx)
      state[t.idx] = { ...state[t.idx], [t.field]: t.value }
      cf.add([state[t.idx]])
    }
    const single = (() => {
      const { cf, dVal, state } = build(); void dVal.top(K)
      let i = 0
      return measure(() => {
        tick(cf, state, TICKS[i++ % TICKS.length])
        void dVal.top(K)
      })
    })()
    const batch = (() => {
      const { cf, dVal, state } = build(); void dVal.top(K)
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) {
          tick(cf, state, TICKS[j])
          void dVal.top(K)
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
      const top = computed(() => sortAndSlice(rows.slice()))
      const dispose = autorun(() => { void top.get() })
      return { rows, top, dispose }
    }
    const setup = measure(() => { const g = build(); g.dispose() })
    const tickFn = (rows, t: Tick) => {
      runInAction(() => { rows[t.idx][t.field] = t.value })
    }
    const single = (() => {
      const { rows, top } = build()
      let i = 0
      return measure(() => { tickFn(rows, TICKS[i++ % TICKS.length]); void top.get() })
    })()
    const batch = (() => {
      const { rows, top } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(rows, TICKS[j]); void top.get() }
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
      const top$ = subj.pipe(map(sortAndSlice))
      const sub = top$.subscribe(() => {})
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
    type Cell = { id: number, val: () => number, val2: () => number, setVal: (v: number) => void, setVal2: (v: number) => void }
    const makeCells = (): Cell[] => makeRows().map(r => {
      const [val, setVal] = createSignal(r.val)
      const [val2, setVal2] = createSignal(r.val2)
      return { id: r.id, val, val2, setVal, setVal2 } as Cell
    })
    let cells: Cell[] = []
    let top: () => any[] = () => []
    let dispose = () => {}
    const build = () => {
      dispose = createRoot(d => {
        cells = makeCells()
        top = createMemo(() => {
          const arr = new Array(cells.length)
          for (let i = 0; i < cells.length; i++) arr[i] = { id: cells[i].id, val: cells[i].val() }
          arr.sort(byValDesc)
          return arr.slice(0, K)
        })
        void top()
        return d
      })
    }
    const setup = measure(() => { build(); dispose() })
    build()
    const tickFn = (t: Tick) => {
      if (t.field === 'val') cells[t.idx].setVal(t.value as number)
      else if (t.field === 'val2') cells[t.idx].setVal2(t.value as number)
    }
    const single = (() => {
      let i = 0
      return measure(() => { tickFn(TICKS[i++ % TICKS.length]); void top() })
    })()
    const batch = measure(() => {
      for (let j = 0; j < TICKS.length; j++) { tickFn(TICKS[j]); void top() }
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
    type Cell = { id: number, val: any, val2: any }
    const makeCells = (): Cell[] => makeRows().map(r => ({
      id: r.id, val: signal(r.val), val2: signal(r.val2),
    }))
    const build = () => {
      const cells = makeCells()
      const top = computed(() => {
        const arr = new Array(cells.length)
        for (let i = 0; i < cells.length; i++) arr[i] = { id: cells[i].id, val: cells[i].val.value }
        arr.sort(byValDesc)
        return arr.slice(0, K)
      })
      const stop = effect(() => { void top.value })
      return { cells, top, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const tickFn = (cells, t: Tick) => {
      if (t.field === 'val') cells[t.idx].val.value = t.value as number
      else if (t.field === 'val2') cells[t.idx].val2.value = t.value as number
    }
    const single = (() => {
      const { cells, top } = build()
      let i = 0
      return measure(() => { tickFn(cells, TICKS[i++ % TICKS.length]); void top.value })
    })()
    const batch = (() => {
      const { cells, top } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(cells, TICKS[j]); void top.value }
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
      const top = computed(() => sortAndSlice(rows.slice()))
      const stop = effect(() => { void top.value })
      return { rows, top, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const tickFn = (rows, t: Tick) => { rows[t.idx][t.field] = t.value }
    const single = (() => {
      const { rows, top } = build()
      let i = 0
      return measure(() => { tickFn(rows, TICKS[i++ % TICKS.length]); void top.value })
    })()
    const batch = (() => {
      const { rows, top } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(rows, TICKS[j]); void top.value }
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
      const top = derived(store, sortAndSlice)
      const unsub = top.subscribe(() => {})
      return { store, top, unsub }
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
      const { store, top } = build()
      let i = 0
      return measure(() => { tickFn(store, TICKS[i++ % TICKS.length]); void get(top) })
    })()
    const batch = (() => {
      const { store, top } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(store, TICKS[j]); void get(top) }
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
    let topRef: any = null
    function App() {
      const [rows, setRows] = useState(makeRows)
      const top = useMemo(() => sortAndSlice(rows), [rows])
      setRowsRef = setRows
      topRef = top
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
      return measure(() => { tickFn(TICKS[i++ % TICKS.length]); void topRef })
    })()
    const batch = (() => {
      build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(TICKS[j]); void topRef }
      })
    })()
    return { setup, single, batch }
  },
}

const op: OpBench = {
  operator: 'sort (top-K via za)',
  notes: 'top 10 rows by `val` desc over 10k; tick rewrites one row\'s val',
  variants: [data, crossfilterV, mobxV, rxjsV, solidV, preactV, vueV, svelteV, reactV],
}
export default op
