// `map` — per-operator comparison.
//
// Workload: 10_000 rows {id, val, val2, ...}. Projection: row → {id, sum:
// val + val2}. Single tick: assign one row's `val`. Batch: TICK_COUNT ticks
// streamed back-to-back with the projected result read after each.
//
// `data.map` is a RowOperator — touching one row routes the BU2 only to
// that row's projection ([operators/map/index.ts](../../../operators/map/index.ts)).
// Peers materialize a fresh `rows.map(...)` array on every emit, so the
// projection runs over all N rows per tick.
//
// crossfilter has no projection primitive — you typically project at chart
// time via a dimension's value accessor. Skipped here to keep the comparison
// honest (translating it as `dim.top(Infinity).map(...)` would measure the
// `dim.top` walk, not the map).

import { measure, pkgVersion } from '../measure.ts'
import {
  makeRows, makeTicks,
  type Row, type Tick, type Variant, type OpBench,
} from './_shared.ts'

const TICKS = makeTicks(undefined, undefined, undefined, ['val'])

const project = (r: { id: number, val: number, val2: number }) => ({
  id: r.id,
  sum: r.val + r.val2,
})

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
      const m = src.map(project)
      return { src, m }
    }
    const setup = measure(() => { build() })
    const single = (() => {
      const { src, m }: any = build(); void m[value]
      let i = 0
      return measure(() => {
        const t = TICKS[i++ % TICKS.length]
        src[t.idx][t.field] = t.value
        void m[value]
      })
    })()
    const batch = (() => {
      const { src, m }: any = build(); void m[value]
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) {
          const t = TICKS[j]
          src[t.idx][t.field] = t.value
          void m[value]
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
      const mapped = computed(() => rows.map(project))
      const dispose = autorun(() => { void mapped.get() })
      return { rows, mapped, dispose }
    }
    const setup = measure(() => { const g = build(); g.dispose() })
    const tickFn = (rows: any, t: Tick) => {
      runInAction(() => { rows[t.idx][t.field] = t.value })
    }
    const single = (() => {
      const { rows, mapped }: any = build()
      let i = 0
      return measure(() => { tickFn(rows, TICKS[i++ % TICKS.length]); void mapped.get() })
    })()
    const batch = (() => {
      const { rows, mapped }: any = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(rows, TICKS[j]); void mapped.get() }
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
      const mapped$ = subj.pipe(map((rows: any) => rows.map(project)))
      const sub = mapped$.subscribe(() => {})
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
    let mapped: () => any[] = () => []
    let dispose = () => {}
    const build = () => {
      dispose = createRoot((d: any) => {
        cells = makeCells()
        mapped = createMemo(() => {
          const out = new Array(cells.length)
          for (let i = 0; i < cells.length; i++) {
            const c = cells[i]
            out[i] = { id: c.id, sum: c.getters.val() + c.getters.val2() }
          }
          return out
        })
        void mapped()
        return d
      })
    }
    const setup = measure(() => { build(); dispose() })
    build()
    const tickFn = (t: Tick) => { cells[t.idx].setters[t.field](t.value) }
    const single = (() => {
      let i = 0
      return measure(() => { tickFn(TICKS[i++ % TICKS.length]); void mapped() })
    })()
    const batch = measure(() => {
      for (let j = 0; j < TICKS.length; j++) { tickFn(TICKS[j]); void mapped() }
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
      const mapped = computed(() => {
        const out = new Array(cells.length)
        for (let i = 0; i < cells.length; i++) {
          const c = cells[i]
          out[i] = { id: c.id, sum: c.val.value + c.val2.value }
        }
        return out
      })
      const stop = effect(() => { void mapped.value })
      return { cells, mapped, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const tickFn = (cells: any, t: Tick) => { cells[t.idx][t.field].value = t.value }
    const single = (() => {
      const { cells, mapped }: any = build()
      let i = 0
      return measure(() => { tickFn(cells, TICKS[i++ % TICKS.length]); void mapped.value })
    })()
    const batch = (() => {
      const { cells, mapped }: any = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(cells, TICKS[j]); void mapped.value }
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
      const mapped = computed(() => rows.map(project))
      const stop = effect(() => { void mapped.value })
      return { rows, mapped, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const tickFn = (rows: any, t: Tick) => { rows[t.idx][t.field] = t.value }
    const single = (() => {
      const { rows, mapped }: any = build()
      let i = 0
      return measure(() => { tickFn(rows, TICKS[i++ % TICKS.length]); void mapped.value })
    })()
    const batch = (() => {
      const { rows, mapped }: any = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(rows, TICKS[j]); void mapped.value }
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
      const mapped = derived(store, (rows: any) => rows.map(project))
      const unsub = mapped.subscribe(() => {})
      return { store, mapped, unsub }
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
      const { store, mapped }: any = build()
      let i = 0
      return measure(() => { tickFn(store, TICKS[i++ % TICKS.length]); void get(mapped) })
    })()
    const batch = (() => {
      const { store, mapped }: any = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(store, TICKS[j]); void get(mapped) }
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
    let mappedRef: any = null
    function App() {
      const [rows, setRows] = useState(makeRows)
      const mapped = useMemo(() => rows.map(project), [rows])
      setRowsRef = setRows
      mappedRef = mapped
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
      return measure(() => { tickFn(TICKS[i++ % TICKS.length]); void mappedRef })
    })()
    const batch = (() => {
      build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(TICKS[j]); void mappedRef }
      })
    })()
    return { setup, single, batch }
  },
}

const op: OpBench = {
  operator: 'map',
  notes: 'projection {id, sum: val+val2} over 10k rows; tick mutates one row. crossfilter omitted — no projection primitive',
  variants: [data, mobxV, rxjsV, solidV, preactV, vueV, svelteV, reactV],
}
export default op
