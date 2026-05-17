// @ts-nocheck
// `aggregate` (sum/avg/max/min) — per-operator comparison.
//
// Workload: 10_000 rows; scalar sum of `val`. Single tick rewrites one row's
// `val`. Batch streams TICK_COUNT ticks with the sum read after each.
//
// data.sum maintains a running total — each BU2 swaps (old, new) on the
// accumulator. O(1) per delta. Peers re-walk all N rows on every emit.
// crossfilter is right at home here: groupAll().reduceSum is incremental.
// We exercise `sum` specifically because it's the cheapest case for data —
// the largest expected gap to peers and the cleanest baseline.

import { measure, pkgVersion } from '../measure.ts'
import {
  makeRows, makeTicks,
  type Row, type Tick, type Variant, type OpBench,
} from './_shared.ts'

const TICKS = makeTicks(undefined, undefined, undefined, ['val'])

const sumVals = (rows: Row[]) => {
  let s = 0
  for (let i = 0; i < rows.length; i++) s += rows[i].val
  return s
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
      const s = src.sum('val')
      return { src, s }
    }
    const setup = measure(() => { build() })
    const single = (() => {
      const { src, s } = build(); void s[value]
      let i = 0
      return measure(() => {
        const t = TICKS[i++ % TICKS.length]
        src[t.idx][t.field] = t.value
        void s[value]
      })
    })()
    const batch = (() => {
      const { src, s } = build(); void s[value]
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) {
          const t = TICKS[j]
          src[t.idx][t.field] = t.value
          void s[value]
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
      const s = cf.groupAll().reduceSum(d => d.val)
      return { cf, s, state }
    }
    const setup = measure(() => { build() })
    const tick = (cf, state, t: Tick) => {
      cf.remove(d => d.id === t.idx)
      state[t.idx] = { ...state[t.idx], [t.field]: t.value }
      cf.add([state[t.idx]])
    }
    const single = (() => {
      const { cf, s, state } = build(); void s.value()
      let i = 0
      return measure(() => {
        tick(cf, state, TICKS[i++ % TICKS.length])
        void s.value()
      })
    })()
    const batch = (() => {
      const { cf, s, state } = build(); void s.value()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) {
          tick(cf, state, TICKS[j])
          void s.value()
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
      const s = computed(() => sumVals(rows))
      const dispose = autorun(() => { void s.get() })
      return { rows, s, dispose }
    }
    const setup = measure(() => { const g = build(); g.dispose() })
    const tickFn = (rows, t: Tick) => {
      runInAction(() => { rows[t.idx][t.field] = t.value })
    }
    const single = (() => {
      const { rows, s } = build()
      let i = 0
      return measure(() => { tickFn(rows, TICKS[i++ % TICKS.length]); void s.get() })
    })()
    const batch = (() => {
      const { rows, s } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(rows, TICKS[j]); void s.get() }
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
      const s$ = subj.pipe(map(sumVals))
      const sub = s$.subscribe(() => {})
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
    type Cell = { id: number, val: () => number, setVal: (v: number) => void }
    const makeCells = (): Cell[] => makeRows().map(r => {
      const [val, setVal] = createSignal(r.val)
      return { id: r.id, val, setVal } as Cell
    })
    let cells: Cell[] = []
    let s: () => number = () => 0
    let dispose = () => {}
    const build = () => {
      dispose = createRoot(d => {
        cells = makeCells()
        s = createMemo(() => {
          let t = 0
          for (let i = 0; i < cells.length; i++) t += cells[i].val()
          return t
        })
        void s()
        return d
      })
    }
    const setup = measure(() => { build(); dispose() })
    build()
    const tickFn = (t: Tick) => {
      if (t.field === 'val') cells[t.idx].setVal(t.value as number)
    }
    const single = (() => {
      let i = 0
      return measure(() => { tickFn(TICKS[i++ % TICKS.length]); void s() })
    })()
    const batch = measure(() => {
      for (let j = 0; j < TICKS.length; j++) { tickFn(TICKS[j]); void s() }
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
    type Cell = { id: number, val: any }
    const makeCells = (): Cell[] => makeRows().map(r => ({
      id: r.id, val: signal(r.val),
    }))
    const build = () => {
      const cells = makeCells()
      const s = computed(() => {
        let t = 0
        for (let i = 0; i < cells.length; i++) t += cells[i].val.value
        return t
      })
      const stop = effect(() => { void s.value })
      return { cells, s, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const tickFn = (cells, t: Tick) => {
      if (t.field === 'val') cells[t.idx].val.value = t.value as number
    }
    const single = (() => {
      const { cells, s } = build()
      let i = 0
      return measure(() => { tickFn(cells, TICKS[i++ % TICKS.length]); void s.value })
    })()
    const batch = (() => {
      const { cells, s } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(cells, TICKS[j]); void s.value }
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
      const s = computed(() => sumVals(rows))
      const stop = effect(() => { void s.value })
      return { rows, s, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const tickFn = (rows, t: Tick) => { rows[t.idx][t.field] = t.value }
    const single = (() => {
      const { rows, s } = build()
      let i = 0
      return measure(() => { tickFn(rows, TICKS[i++ % TICKS.length]); void s.value })
    })()
    const batch = (() => {
      const { rows, s } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(rows, TICKS[j]); void s.value }
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
      const s = derived(store, sumVals)
      const unsub = s.subscribe(() => {})
      return { store, s, unsub }
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
      const { store, s } = build()
      let i = 0
      return measure(() => { tickFn(store, TICKS[i++ % TICKS.length]); void get(s) })
    })()
    const batch = (() => {
      const { store, s } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(store, TICKS[j]); void get(s) }
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
    let sRef: number = 0
    function App() {
      const [rows, setRows] = useState(makeRows)
      const s = useMemo(() => sumVals(rows), [rows])
      setRowsRef = setRows
      sRef = s
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
      return measure(() => { tickFn(TICKS[i++ % TICKS.length]); void sRef })
    })()
    const batch = (() => {
      build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(TICKS[j]); void sRef }
      })
    })()
    return { setup, single, batch }
  },
}

const op: OpBench = {
  operator: 'aggregate (sum)',
  notes: 'sum(val) over 10k rows; tick rewrites one row\'s val',
  variants: [data, crossfilterV, mobxV, rxjsV, solidV, preactV, vueV, svelteV, reactV],
}
export default op
