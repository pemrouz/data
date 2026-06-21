// `between` — per-operator comparison.
//
// Workload: 10_000 rows; range [25, 75] on `val` (~50% pass). Single tick
// rewrites one row's `val` to a fresh value drawn from the same
// distribution. Batch streams TICK_COUNT ticks with the filtered set read
// after each.
//
// data.between sorts by col once at construction and threads each row's BU2
// through a binary-search update — O(log N) per touched row. Peers fall back
// to filter, scanning all N rows per emit. crossfilter's dim.filterRange +
// dim.top is the closest peer primitive.

import { measure, pkgVersion } from '../measure.ts'
import {
  makeRows, makeTicks,
  type Row, type Tick, type Variant, type OpBench,
} from './_shared.ts'

const TICKS = makeTicks(undefined, undefined, undefined, ['val'])
const LO = 25
const HI = 75

const inRange = (r: { val: number }) => r.val >= LO && r.val <= HI

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
      const b = src.between('val', [LO, HI])
      return { src, b }
    }
    const setup = measure(() => { build() })
    const single = (() => {
      const { src, b }: any = build(); void b[value]
      let i = 0
      return measure(() => {
        const t = TICKS[i++ % TICKS.length]
        src[t.idx][t.field] = t.value
        void b[value]
      })
    })()
    const batch = (() => {
      const { src, b }: any = build(); void b[value]
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) {
          const t = TICKS[j]
          src[t.idx][t.field] = t.value
          void b[value]
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
      const dVal = cf.dimension((d: any) => d.val)
      dVal.filterRange([LO, HI])
      return { cf, dVal, state }
    }
    const setup = measure(() => { build() })
    const tick = (cf: any, state: any, t: Tick) => {
      cf.remove((d: any) => d.id === t.idx)
      state[t.idx] = { ...state[t.idx], [t.field]: t.value }
      cf.add([state[t.idx]])
    }
    const single = (() => {
      const { cf, dVal, state }: any = build(); void dVal.top(Infinity)
      let i = 0
      return measure(() => {
        tick(cf, state, TICKS[i++ % TICKS.length])
        void dVal.top(Infinity)
      })
    })()
    const batch = (() => {
      const { cf, dVal, state }: any = build(); void dVal.top(Infinity)
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) {
          tick(cf, state, TICKS[j])
          void dVal.top(Infinity)
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
      const inRangeRows = computed(() => rows.filter(inRange))
      const dispose = autorun(() => { void inRangeRows.get() })
      return { rows, inRangeRows, dispose }
    }
    const setup = measure(() => { const g = build(); g.dispose() })
    const tickFn = (rows: any, t: Tick) => {
      runInAction(() => { rows[t.idx][t.field] = t.value })
    }
    const single = (() => {
      const { rows, inRangeRows }: any = build()
      let i = 0
      return measure(() => { tickFn(rows, TICKS[i++ % TICKS.length]); void inRangeRows.get() })
    })()
    const batch = (() => {
      const { rows, inRangeRows }: any = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(rows, TICKS[j]); void inRangeRows.get() }
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
      const inRangeRows$ = subj.pipe(map((rows: any) => rows.filter(inRange)))
      const sub = inRangeRows$.subscribe(() => {})
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
    type Cell = { id: number, getters: Record<string, () => any>, setters: Record<string, (v: any) => void> }
    const makeCells = (): Cell[] => makeRows().map((r: any) => {
      const [val, setVal] = createSignal(r.val)
      const [val2, setVal2] = createSignal(r.val2)
      const [cat, setCat] = createSignal(r.cat)
      const [active, setActive] = createSignal(r.active)
      return {
        id: r.id,
        getters: { val, val2, cat, active },
        setters: { val: setVal, val2: setVal2, cat: setCat, active: setActive },
      }
    })
    let cells: Cell[] = []
    let inRangeRows: () => any[] = () => []
    let dispose = () => {}
    const build = () => {
      dispose = createRoot((d: any) => {
        cells = makeCells()
        inRangeRows = createMemo(() => {
          const out: Cell[] = []
          for (let i = 0; i < cells.length; i++) {
            const v = cells[i].getters.val()
            if (v >= LO && v <= HI) out.push(cells[i])
          }
          return out
        })
        void inRangeRows()
        return d
      })
    }
    const setup = measure(() => { build(); dispose() })
    build()
    const tickFn = (t: Tick) => { cells[t.idx].setters[t.field](t.value) }
    const single = (() => {
      let i = 0
      return measure(() => { tickFn(TICKS[i++ % TICKS.length]); void inRangeRows() })
    })()
    const batch = measure(() => {
      for (let j = 0; j < TICKS.length; j++) { tickFn(TICKS[j]); void inRangeRows() }
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
    type Cell = { id: number, val: any, val2: any, cat: any, active: any }
    const makeCells = (): Cell[] => makeRows().map((r: any) => ({
      id: r.id,
      val: signal(r.val),
      val2: signal(r.val2),
      cat: signal(r.cat),
      active: signal(r.active),
    }))
    const build = () => {
      const cells = makeCells()
      const inRangeRows = computed(() => {
        const out: Cell[] = []
        for (let i = 0; i < cells.length; i++) {
          const v = cells[i].val.value
          if (v >= LO && v <= HI) out.push(cells[i])
        }
        return out
      })
      const stop = effect(() => { void inRangeRows.value })
      return { cells, inRangeRows, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const tickFn = (cells: any, t: Tick) => { cells[t.idx][t.field].value = t.value }
    const single = (() => {
      const { cells, inRangeRows }: any = build()
      let i = 0
      return measure(() => { tickFn(cells, TICKS[i++ % TICKS.length]); void inRangeRows.value })
    })()
    const batch = (() => {
      const { cells, inRangeRows }: any = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(cells, TICKS[j]); void inRangeRows.value }
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
      const inRangeRows = computed(() => rows.filter(inRange))
      const stop = effect(() => { void inRangeRows.value })
      return { rows, inRangeRows, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const tickFn = (rows: any, t: Tick) => { rows[t.idx][t.field] = t.value }
    const single = (() => {
      const { rows, inRangeRows }: any = build()
      let i = 0
      return measure(() => { tickFn(rows, TICKS[i++ % TICKS.length]); void inRangeRows.value })
    })()
    const batch = (() => {
      const { rows, inRangeRows }: any = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(rows, TICKS[j]); void inRangeRows.value }
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
      const inRangeRows = derived(store, (rows: any) => rows.filter(inRange))
      const unsub = inRangeRows.subscribe(() => {})
      return { store, inRangeRows, unsub }
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
      const { store, inRangeRows }: any = build()
      let i = 0
      return measure(() => { tickFn(store, TICKS[i++ % TICKS.length]); void get(inRangeRows) })
    })()
    const batch = (() => {
      const { store, inRangeRows }: any = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(store, TICKS[j]); void get(inRangeRows) }
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
    let inRangeRef: any = null
    function App() {
      const [rows, setRows] = useState(makeRows)
      const inRangeRows = useMemo(() => rows.filter(inRange), [rows])
      setRowsRef = setRows
      inRangeRef = inRangeRows
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
      return measure(() => { tickFn(TICKS[i++ % TICKS.length]); void inRangeRef })
    })()
    const batch = (() => {
      build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(TICKS[j]); void inRangeRef }
      })
    })()
    return { setup, single, batch }
  },
}

const op: OpBench = {
  operator: 'between',
  notes: 'range [25,75] on `val` over 10k rows; tick mutates one row',
  variants: [data, crossfilterV, mobxV, rxjsV, solidV, preactV, vueV, svelteV, reactV],
}
export default op
