// `tap` — per-operator comparison.
//
// Workload: 10_000 rows; passthrough operator with a side-effect callback.
// Single tick rewrites one row's `val`. Batch streams TICK_COUNT ticks
// with the operator's output read after each.
//
// data.tap has two paths picked by fn.length. We test BOTH (CLAUDE.md
// flags the 0-arg bare path as 40%+ faster on batch) with two variants:
//   data            — bare (0-arg fn). Each emit triggers one fn() call.
//   data (1-arg)    — change-record form. fn(change) once per row in
//                     batched verbs.
// Peers don't have a built-in tap; closest equivalent is subscribe/effect
// with no derived state, which is what we measure.

import { measure, pkgVersion } from '../measure.ts'
import {
  makeRows, makeTicks,
  type Row, type Tick, type Variant, type OpBench,
} from './_shared.ts'

const TICKS = makeTicks(undefined, undefined, undefined, ['val'])

// --- data (bare 0-arg tap) ----------------------------------------------

const dataBare: Variant = {
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
      let n = 0
      const t = src.tap(() => { n++ })
      return { src, t, get: () => n }
    }
    const setup = measure(() => { build() })
    const single = (() => {
      const { src, t }: any = build(); void t[value]
      let i = 0
      return measure(() => {
        const tk = TICKS[i++ % TICKS.length]
        src[tk.idx][tk.field] = tk.value
        void t[value]
      })
    })()
    const batch = (() => {
      const { src, t }: any = build(); void t[value]
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) {
          const tk = TICKS[j]
          src[tk.idx][tk.field] = tk.value
          void t[value]
        }
      })
    })()
    return { setup, single, batch }
  },
}

// --- data (1-arg change-record tap) -------------------------------------

const dataRecord: Variant = {
  name: 'data (1-arg)',
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
      let n = 0
      const t = src.tap((c: any) => { n++ })
      return { src, t, get: () => n }
    }
    const setup = measure(() => { build() })
    const single = (() => {
      const { src, t }: any = build(); void t[value]
      let i = 0
      return measure(() => {
        const tk = TICKS[i++ % TICKS.length]
        src[tk.idx][tk.field] = tk.value
        void t[value]
      })
    })()
    const batch = (() => {
      const { src, t }: any = build(); void t[value]
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) {
          const tk = TICKS[j]
          src[tk.idx][tk.field] = tk.value
          void t[value]
        }
      })
    })()
    return { setup, single, batch }
  },
}

// --- mobx (autorun side effect) -----------------------------------------

const mobxV: Variant = {
  name: 'mobx',
  version: pkgVersion('mobx'),
  run: async () => {
    const { observable, runInAction, autorun } = await import('mobx')
    const build = () => {
      const rows = observable.array(
        makeRows().map((r: any) => observable.object(r, {}, { deep: false })),
      )
      let n = 0
      // autorun on each row's val individually would be 10k autoruns; the
      // analog of a tap on the whole collection is one autorun that reads
      // anything observable — re-runs when any row changes.
      const dispose = autorun(() => {
        // Touch one observable so autorun has a dep — keeps the rerun
        // shape comparable.
        for (let i = 0; i < rows.length; i++) { void rows[i].val }
        n++
      })
      return { rows, dispose, get: () => n }
    }
    const setup = measure(() => { const g = build(); g.dispose() })
    const tickFn = (rows: any, t: Tick) => {
      runInAction(() => { rows[t.idx][t.field] = t.value })
    }
    const single = (() => {
      const { rows }: any = build()
      let i = 0
      return measure(() => { tickFn(rows, TICKS[i++ % TICKS.length]) })
    })()
    const batch = (() => {
      const { rows }: any = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) tickFn(rows, TICKS[j])
      })
    })()
    return { setup, single, batch }
  },
}

// --- rxjs (subscribe side effect) ---------------------------------------

const rxjsV: Variant = {
  name: 'rxjs',
  version: pkgVersion('rxjs'),
  run: async () => {
    const { BehaviorSubject } = await import('rxjs')
    const { tap } = await import('rxjs/operators')
    const build = () => {
      const subj = new BehaviorSubject(makeRows())
      let n = 0
      const sub = subj.pipe(tap(() => { n++ })).subscribe(() => {})
      return { subj, sub, get: () => n }
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

// --- solid (effect over signals) ----------------------------------------

const solidV: Variant = {
  name: 'solid',
  version: pkgVersion('solid-js'),
  run: async () => {
    const { createSignal, createEffect, createRoot } = await import('solid-js/dist/solid.js')
    type Cell = { id: number, val: () => number, setVal: (v: number) => void }
    const makeCells = (): Cell[] => makeRows().map((r: any) => {
      const [val, setVal] = createSignal(r.val)
      return { id: r.id, val, setVal } as Cell
    })
    let cells: Cell[] = []
    let n = 0
    let dispose = () => {}
    const build = () => {
      n = 0
      dispose = createRoot((d: any) => {
        cells = makeCells()
        createEffect(() => {
          for (let i = 0; i < cells.length; i++) void cells[i].val()
          n++
        })
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
      return measure(() => { tickFn(TICKS[i++ % TICKS.length]) })
    })()
    const batch = measure(() => {
      for (let j = 0; j < TICKS.length; j++) tickFn(TICKS[j])
    })
    dispose()
    return { setup, single, batch }
  },
}

// --- preact-signals (effect) --------------------------------------------

const preactV: Variant = {
  name: 'preact-signals',
  version: pkgVersion('@preact/signals-core'),
  run: async () => {
    const { signal, effect } = await import('@preact/signals-core')
    type Cell = { id: number, val: any }
    const makeCells = (): Cell[] => makeRows().map((r: any) => ({
      id: r.id, val: signal(r.val),
    }))
    const build = () => {
      const cells = makeCells()
      let n = 0
      const stop = effect(() => {
        for (let i = 0; i < cells.length; i++) void cells[i].val.value
        n++
      })
      return { cells, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const tickFn = (cells: any, t: Tick) => {
      if (t.field === 'val') cells[t.idx].val.value = t.value as number
    }
    const single = (() => {
      const { cells }: any = build()
      let i = 0
      return measure(() => { tickFn(cells, TICKS[i++ % TICKS.length]) })
    })()
    const batch = (() => {
      const { cells }: any = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) tickFn(cells, TICKS[j])
      })
    })()
    return { setup, single, batch }
  },
}

// --- vue-reactivity (effect) --------------------------------------------

const vueV: Variant = {
  name: 'vue-reactivity',
  version: pkgVersion('@vue/reactivity'),
  run: async () => {
    const { reactive, effect } = await import('@vue/reactivity')
    const build = () => {
      const rows = reactive(makeRows())
      let n = 0
      const stop = effect(() => {
        for (let i = 0; i < rows.length; i++) void rows[i].val
        n++
      })
      return { rows, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const tickFn = (rows: any, t: Tick) => { rows[t.idx][t.field] = t.value }
    const single = (() => {
      const { rows }: any = build()
      let i = 0
      return measure(() => { tickFn(rows, TICKS[i++ % TICKS.length]) })
    })()
    const batch = (() => {
      const { rows }: any = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) tickFn(rows, TICKS[j])
      })
    })()
    return { setup, single, batch }
  },
}

// --- svelte-store (subscribe side effect) -------------------------------

const svelteV: Variant = {
  name: 'svelte-store',
  version: pkgVersion('svelte'),
  run: async () => {
    const { writable } = await import('svelte/store')
    const build = () => {
      const store = writable(makeRows())
      let n = 0
      const unsub = store.subscribe(() => { n++ })
      return { store, unsub }
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
      const { store }: any = build()
      let i = 0
      return measure(() => { tickFn(store, TICKS[i++ % TICKS.length]) })
    })()
    const batch = (() => {
      const { store }: any = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) tickFn(store, TICKS[j])
      })
    })()
    return { setup, single, batch }
  },
}

// --- react (useEffect side effect) --------------------------------------

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
    const { useState, useEffect } = React
    let setRowsRef: (fn: any) => void = () => {}
    function App() {
      const [rows, setRows] = useState(makeRows)
      useEffect(() => { /* side effect each render */ }, [rows])
      setRowsRef = setRows
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
        setRowsRef((prev: Row[]) => {
          const next = prev.slice()
          next[t.idx] = { ...next[t.idx], [t.field]: t.value }
          return next
        })
      })
    }
    const single = (() => {
      build()
      let i = 0
      return measure(() => { tickFn(TICKS[i++ % TICKS.length]) })
    })()
    const batch = (() => {
      build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) tickFn(TICKS[j])
      })
    })()
    return { setup, single, batch }
  },
}

const op: OpBench = {
  operator: 'tap',
  notes: 'passthrough side-effect callback over 10k rows; tick updates one row\'s val. data measured twice — bare (0-arg, hot path) and 1-arg change-record. crossfilter omitted — no analog primitive',
  variants: [dataBare, dataRecord, mobxV, rxjsV, solidV, preactV, vueV, svelteV, reactV],
}
export default op
