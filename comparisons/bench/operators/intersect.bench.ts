// @ts-nocheck
// `intersect` — per-operator comparison.
//
// Workload: 10_000 rows; two filters (`active === true`, `val > 50`)
// intersected. Single tick mutates either `active` or `val` on one row.
// Batch streams TICK_COUNT ticks with the intersection read after each.
//
// data: A.intersect(B) — bitmask machinery threads each per-source delta
// through in O(1) (operators/intersect/index.ts). Peers have no native
// intersect — most natural translation is filter+filter then a Set-based
// hand-rolled intersect on every emit. crossfilter is the right peer for
// the crossfilter-shaped intent: brushable charts crossing dimensions.

import { measure, pkgVersion } from '../measure.ts'
import {
  makeRows, makeTicks, THRESHOLD,
  type Row, type Tick, type Variant, type OpBench,
} from './_shared.ts'

// Mix of active-toggles and val-rewrites — each peer hits both filter
// surfaces. Same generator, just both fields.
const TICKS = makeTicks(undefined, undefined, undefined, ['active', 'val'])

const intersectFn = (rows: Row[]): Row[] => {
  const out: Row[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.active && r.val > THRESHOLD) out.push(r)
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
      const a = src.filter(r => r.active)
      const b = src.filter(r => r.val > THRESHOLD)
      const c = a.intersect(b)
      return { src, c }
    }
    const setup = measure(() => { build() })
    const single = (() => {
      const { src, c } = build(); void c[value]
      let i = 0
      return measure(() => {
        const t = TICKS[i++ % TICKS.length]
        src[t.idx][t.field] = t.value
        void c[value]
      })
    })()
    const batch = (() => {
      const { src, c } = build(); void c[value]
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) {
          const t = TICKS[j]
          src[t.idx][t.field] = t.value
          void c[value]
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
      const dActive = cf.dimension(d => d.active ? 1 : 0)
      const dVal = cf.dimension(d => d.val)
      dActive.filter(1)
      dVal.filterRange([THRESHOLD + 1e-9, Infinity])
      // Reading the intersection: any dimension's top(Infinity) over the
      // crossfilter view yields rows passing every filter — that IS the
      // intersection.
      return { cf, dActive, dVal, state }
    }
    const setup = measure(() => { build() })
    const tick = (cf, state, t: Tick) => {
      cf.remove(d => d.id === t.idx)
      state[t.idx] = { ...state[t.idx], [t.field]: t.value }
      cf.add([state[t.idx]])
    }
    const single = (() => {
      const { cf, dActive, state } = build(); void dActive.top(Infinity)
      let i = 0
      return measure(() => {
        tick(cf, state, TICKS[i++ % TICKS.length])
        void dActive.top(Infinity)
      })
    })()
    const batch = (() => {
      const { cf, dActive, state } = build(); void dActive.top(Infinity)
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) {
          tick(cf, state, TICKS[j])
          void dActive.top(Infinity)
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
      const c = computed(() => intersectFn(rows))
      const dispose = autorun(() => { void c.get() })
      return { rows, c, dispose }
    }
    const setup = measure(() => { const g = build(); g.dispose() })
    const tickFn = (rows, t: Tick) => {
      runInAction(() => { rows[t.idx][t.field] = t.value })
    }
    const single = (() => {
      const { rows, c } = build()
      let i = 0
      return measure(() => { tickFn(rows, TICKS[i++ % TICKS.length]); void c.get() })
    })()
    const batch = (() => {
      const { rows, c } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(rows, TICKS[j]); void c.get() }
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
      const c$ = subj.pipe(map(intersectFn))
      const sub = c$.subscribe(() => {})
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
    type Cell = {
      id: number
      val: () => number, setVal: (v: number) => void
      active: () => boolean, setActive: (v: boolean) => void
    }
    const makeCells = (): Cell[] => makeRows().map(r => {
      const [val, setVal] = createSignal(r.val)
      const [active, setActive] = createSignal(r.active)
      return { id: r.id, val, setVal, active, setActive } as Cell
    })
    let cells: Cell[] = []
    let c: () => any[] = () => []
    let dispose = () => {}
    const build = () => {
      dispose = createRoot(d => {
        cells = makeCells()
        c = createMemo(() => {
          const out: any[] = []
          for (let i = 0; i < cells.length; i++) {
            const cell = cells[i]
            if (cell.active() && cell.val() > THRESHOLD) out.push(cell)
          }
          return out
        })
        void c()
        return d
      })
    }
    const setup = measure(() => { build(); dispose() })
    build()
    const tickFn = (t: Tick) => {
      if (t.field === 'val') cells[t.idx].setVal(t.value as number)
      else if (t.field === 'active') cells[t.idx].setActive(t.value as boolean)
    }
    const single = (() => {
      let i = 0
      return measure(() => { tickFn(TICKS[i++ % TICKS.length]); void c() })
    })()
    const batch = measure(() => {
      for (let j = 0; j < TICKS.length; j++) { tickFn(TICKS[j]); void c() }
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
    type Cell = { id: number, val: any, active: any }
    const makeCells = (): Cell[] => makeRows().map(r => ({
      id: r.id, val: signal(r.val), active: signal(r.active),
    }))
    const build = () => {
      const cells = makeCells()
      const c = computed(() => {
        const out: any[] = []
        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i]
          if (cell.active.value && cell.val.value > THRESHOLD) out.push(cell)
        }
        return out
      })
      const stop = effect(() => { void c.value })
      return { cells, c, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const tickFn = (cells, t: Tick) => {
      if (t.field === 'val') cells[t.idx].val.value = t.value as number
      else if (t.field === 'active') cells[t.idx].active.value = t.value as boolean
    }
    const single = (() => {
      const { cells, c } = build()
      let i = 0
      return measure(() => { tickFn(cells, TICKS[i++ % TICKS.length]); void c.value })
    })()
    const batch = (() => {
      const { cells, c } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(cells, TICKS[j]); void c.value }
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
      const c = computed(() => intersectFn(rows))
      const stop = effect(() => { void c.value })
      return { rows, c, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const tickFn = (rows, t: Tick) => { rows[t.idx][t.field] = t.value }
    const single = (() => {
      const { rows, c } = build()
      let i = 0
      return measure(() => { tickFn(rows, TICKS[i++ % TICKS.length]); void c.value })
    })()
    const batch = (() => {
      const { rows, c } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(rows, TICKS[j]); void c.value }
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
      const c = derived(store, intersectFn)
      const unsub = c.subscribe(() => {})
      return { store, c, unsub }
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
      const { store, c } = build()
      let i = 0
      return measure(() => { tickFn(store, TICKS[i++ % TICKS.length]); void get(c) })
    })()
    const batch = (() => {
      const { store, c } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(store, TICKS[j]); void get(c) }
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
    let cRef: any = null
    function App() {
      const [rows, setRows] = useState(makeRows)
      const c = useMemo(() => intersectFn(rows), [rows])
      setRowsRef = setRows
      cRef = c
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
      return measure(() => { tickFn(TICKS[i++ % TICKS.length]); void cRef })
    })()
    const batch = (() => {
      build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(TICKS[j]); void cRef }
      })
    })()
    return { setup, single, batch }
  },
}

const op: OpBench = {
  operator: 'intersect',
  notes: 'filter(active) ∩ filter(val>50) over 10k rows; tick mutates active or val',
  variants: [data, crossfilterV, mobxV, rxjsV, solidV, preactV, vueV, svelteV, reactV],
}
export default op
