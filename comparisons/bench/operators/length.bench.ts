// `length` — per-operator comparison.
//
// Workload: 10_000 rows; count of `active === true`. Single tick toggles one
// row's `active`. The count moves by ±1 each tick. Batch streams TICK_COUNT
// ticks with the count read after each.
//
// data: `filter((d: any) => d.active).length()`. The filter's BU2 emits one
// BI0/BR1 to length per crossing tick; length keeps a running counter —
// O(1) per delta. Peers re-walk all N rows on every emit to compute the
// filtered length.

import { measure, pkgVersion } from '../measure.ts'
import {
  makeRows, makeTicks,
  type Row, type Tick, type Variant, type OpBench,
} from './_shared.ts'

const TICKS = makeTicks(undefined, undefined, undefined, ['active'])
const isActive = (r: { active: boolean }) => r.active
const filteredLen = (rows: Row[]) => {
  let n = 0
  for (let i = 0; i < rows.length; i++) if (rows[i].active) n++
  return n
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
      const len = src.filter(isActive).length()
      return { src, len }
    }
    const setup = measure(() => { build() })
    const single = (() => {
      const { src, len }: any = build(); void len[value]
      let i = 0
      return measure(() => {
        const t = TICKS[i++ % TICKS.length]
        src[t.idx][t.field] = t.value
        void len[value]
      })
    })()
    const batch = (() => {
      const { src, len }: any = build(); void len[value]
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) {
          const t = TICKS[j]
          src[t.idx][t.field] = t.value
          void len[value]
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
      const state = makeRows().map((r: any) => ({ ...r }))
      const cf = crossfilter(state)
      const dActive = cf.dimension((d: any) => d.active ? 1 : 0)
      dActive.filter(1)
      const count = cf.groupAll().reduceCount()
      return { cf, dActive, count, state }
    }
    const setup = measure(() => { build() })
    const tick = (cf: any, state: any, t: Tick) => {
      cf.remove((d: any) => d.id === t.idx)
      state[t.idx] = { ...state[t.idx], [t.field]: t.value }
      cf.add([state[t.idx]])
    }
    const single = (() => {
      const { cf, count, state }: any = build(); void count.value()
      let i = 0
      return measure(() => {
        tick(cf, state, TICKS[i++ % TICKS.length])
        void count.value()
      })
    })()
    const batch = (() => {
      const { cf, count, state }: any = build(); void count.value()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) {
          tick(cf, state, TICKS[j])
          void count.value()
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
        makeRows().map((r: any) => observable.object(r, {}, { deep: false })),
      )
      const len = computed(() => filteredLen(rows))
      const dispose = autorun(() => { void len.get() })
      return { rows, len, dispose }
    }
    const setup = measure(() => { const g = build(); g.dispose() })
    const tickFn = (rows: any, t: Tick) => {
      runInAction(() => { rows[t.idx][t.field] = t.value })
    }
    const single = (() => {
      const { rows, len }: any = build()
      let i = 0
      return measure(() => { tickFn(rows, TICKS[i++ % TICKS.length]); void len.get() })
    })()
    const batch = (() => {
      const { rows, len }: any = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(rows, TICKS[j]); void len.get() }
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
      const len$ = subj.pipe(map(filteredLen))
      const sub = len$.subscribe(() => {})
      return { subj, sub }
    }
    const setup = measure(() => { const g = build(); g.sub.unsubscribe() })
    const tickFn = (subj: any, t: Tick) => {
      const next = subj.value.slice()
      next[t.idx] = { ...next[t.idx], [t.field]: t.value }
      subj.next(next)
    }
    const single = (() => {
      const { subj }: any = build()
      let i = 0
      return measure(() => { tickFn(subj, TICKS[i++ % TICKS.length]) })
    })()
    const batch = (() => {
      const { subj }: any = build()
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
    type Cell = { id: number, active: () => boolean, setActive: (v: boolean) => void }
    const makeCells = (): Cell[] => makeRows().map((r: any) => {
      const [active, setActive] = createSignal(r.active)
      return { id: r.id, active, setActive } as Cell
    })
    let cells: Cell[] = []
    let len: () => number = () => 0
    let dispose = () => {}
    const build = () => {
      dispose = createRoot((d: any) => {
        cells = makeCells()
        len = createMemo(() => {
          let n = 0
          for (let i = 0; i < cells.length; i++) if (cells[i].active()) n++
          return n
        })
        void len()
        return d
      })
    }
    const setup = measure(() => { build(); dispose() })
    build()
    const tickFn = (t: Tick) => {
      if (t.field === 'active') cells[t.idx].setActive(t.value as boolean)
    }
    const single = (() => {
      let i = 0
      return measure(() => { tickFn(TICKS[i++ % TICKS.length]); void len() })
    })()
    const batch = measure(() => {
      for (let j = 0; j < TICKS.length; j++) { tickFn(TICKS[j]); void len() }
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
    type Cell = { id: number, active: any }
    const makeCells = (): Cell[] => makeRows().map((r: any) => ({
      id: r.id, active: signal(r.active),
    }))
    const build = () => {
      const cells = makeCells()
      const len = computed(() => {
        let n = 0
        for (let i = 0; i < cells.length; i++) if (cells[i].active.value) n++
        return n
      })
      const stop = effect(() => { void len.value })
      return { cells, len, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const tickFn = (cells: any, t: Tick) => {
      if (t.field === 'active') cells[t.idx].active.value = t.value as boolean
    }
    const single = (() => {
      const { cells, len }: any = build()
      let i = 0
      return measure(() => { tickFn(cells, TICKS[i++ % TICKS.length]); void len.value })
    })()
    const batch = (() => {
      const { cells, len }: any = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(cells, TICKS[j]); void len.value }
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
      const len = computed(() => filteredLen(rows))
      const stop = effect(() => { void len.value })
      return { rows, len, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const tickFn = (rows: any, t: Tick) => { rows[t.idx][t.field] = t.value }
    const single = (() => {
      const { rows, len }: any = build()
      let i = 0
      return measure(() => { tickFn(rows, TICKS[i++ % TICKS.length]); void len.value })
    })()
    const batch = (() => {
      const { rows, len }: any = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(rows, TICKS[j]); void len.value }
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
      const len = derived(store, filteredLen)
      const unsub = len.subscribe(() => {})
      return { store, len, unsub }
    }
    const setup = measure(() => { const g = build(); g.unsub() })
    const tickFn = (store: any, t: Tick) => {
      store.update((rows: any) => {
        const next = rows.slice()
        next[t.idx] = { ...next[t.idx], [t.field]: t.value }
        return next
      })
    }
    const single = (() => {
      const { store, len }: any = build()
      let i = 0
      return measure(() => { tickFn(store, TICKS[i++ % TICKS.length]); void get(len) })
    })()
    const batch = (() => {
      const { store, len }: any = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(store, TICKS[j]); void get(len) }
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
    let lenRef: number = 0
    function App() {
      const [rows, setRows] = useState(makeRows)
      const len = useMemo(() => filteredLen(rows), [rows])
      setRowsRef = setRows
      lenRef = len
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
      return measure(() => { tickFn(TICKS[i++ % TICKS.length]); void lenRef })
    })()
    const batch = (() => {
      build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(TICKS[j]); void lenRef }
      })
    })()
    return { setup, single, batch }
  },
}

const op: OpBench = {
  operator: 'length (filtered count)',
  notes: 'count of `active === true` over 10k rows; tick toggles one row\'s active',
  variants: [data, crossfilterV, mobxV, rxjsV, solidV, preactV, vueV, svelteV, reactV],
}
export default op
