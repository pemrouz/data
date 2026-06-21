// `compare` — per-operator comparison for the one-sided range filters
// (.gt / .lt / .gte / .lte). This bench exercises `.gt('val', 50)` against
// the same workload `filter.bench.ts` uses, and pits it against peer
// libraries that have no direct one-sided range operator — they all
// degrade to a predicate filter (`d.val > 50`).
//
// The peer rows therefore look very similar to the ones in filter.bench.ts.
// The point of this file isn't to show a different peer story; it's to
// (a) prove `.gt` is at least as fast as a function-predicate filter on
// the same workload — both should be RowOperator-based and O(1) per BU2 —
// and (b) guard against future regressions if compare's implementation
// drifts toward sort-indexing.

import { measure, pkgVersion } from '../measure.ts'
import {
  makeRows, makeTicks, THRESHOLD,
  type Row, type Tick, type Variant, type OpBench,
} from './_shared.ts'

const TICKS = makeTicks(undefined, undefined, undefined, ['val'])

const pred = (r: { val: number }) => r.val > THRESHOLD

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
      // The operator under test: declarative single-threshold filter.
      const f = src.gt('val', THRESHOLD)
      return { src, f }
    }
    const setup = measure(() => { build() })
    const single = (() => {
      const { src, f }: any = build(); void f[value]
      let i = 0
      return measure(() => {
        const t = TICKS[i++ % TICKS.length]
        src[t.idx][t.field] = t.value
        void f[value]
      })
    })()
    const batch = (() => {
      const { src, f }: any = build(); void f[value]
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) {
          const t = TICKS[j]
          src[t.idx][t.field] = t.value
          void f[value]
        }
      })
    })()
    return { setup, single, batch }
  },
}

// --- crossfilter ---------------------------------------------------------
// crossfilter is the closest peer to a one-sided range filter — its
// `filterRange([lo, hi])` is the actual analogue. We pin `lo` just above
// THRESHOLD (matching strict `>` semantics) and leave `hi` at +Infinity.

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
      dVal.filterRange([THRESHOLD + 1e-9, Infinity])
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
      const filtered = computed(() => rows.filter(pred))
      const dispose = autorun(() => { void filtered.get() })
      return { rows, filtered, dispose }
    }
    const setup = measure(() => { const g = build(); g.dispose() })
    const tickFn = (rows: any, t: Tick) => {
      runInAction(() => { rows[t.idx][t.field] = t.value })
    }
    const single = (() => {
      const { rows, filtered }: any = build()
      let i = 0
      return measure(() => {
        tickFn(rows, TICKS[i++ % TICKS.length])
        void filtered.get()
      })
    })()
    const batch = (() => {
      const { rows, filtered }: any = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) {
          tickFn(rows, TICKS[j])
          void filtered.get()
        }
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
      const filtered$ = subj.pipe(map((rows: any) => rows.filter(pred)))
      const sub = filtered$.subscribe(() => {})
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
    let filtered: () => any[] = () => []
    let dispose = () => {}
    const build = () => {
      dispose = createRoot((d: any) => {
        cells = makeCells()
        filtered = createMemo(() => {
          const out: Cell[] = []
          for (let i = 0; i < cells.length; i++) {
            if (cells[i].getters.val() > THRESHOLD) out.push(cells[i])
          }
          return out
        })
        void filtered()
        return d
      })
    }
    const setup = measure(() => { build(); dispose() })
    build()
    const tickFn = (t: Tick) => { cells[t.idx].setters[t.field](t.value) }
    const single = (() => {
      let i = 0
      return measure(() => { tickFn(TICKS[i++ % TICKS.length]); void filtered() })
    })()
    const batch = measure(() => {
      for (let j = 0; j < TICKS.length; j++) { tickFn(TICKS[j]); void filtered() }
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
      const filtered = computed(() => {
        const out: Cell[] = []
        for (let i = 0; i < cells.length; i++) {
          if (cells[i].val.value > THRESHOLD) out.push(cells[i])
        }
        return out
      })
      const stop = effect(() => { void filtered.value })
      return { cells, filtered, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const tickFn = (cells: any, t: Tick) => { cells[t.idx][t.field].value = t.value }
    const single = (() => {
      const { cells, filtered }: any = build()
      let i = 0
      return measure(() => { tickFn(cells, TICKS[i++ % TICKS.length]); void filtered.value })
    })()
    const batch = (() => {
      const { cells, filtered }: any = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(cells, TICKS[j]); void filtered.value }
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
      const filtered = computed(() => rows.filter(pred))
      const stop = effect(() => { void filtered.value })
      return { rows, filtered, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const tickFn = (rows: any, t: Tick) => { rows[t.idx][t.field] = t.value }
    const single = (() => {
      const { rows, filtered }: any = build()
      let i = 0
      return measure(() => { tickFn(rows, TICKS[i++ % TICKS.length]); void filtered.value })
    })()
    const batch = (() => {
      const { rows, filtered }: any = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(rows, TICKS[j]); void filtered.value }
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
      const filtered = derived(store, (rows: any) => rows.filter(pred))
      const unsub = filtered.subscribe(() => {})
      return { store, filtered, unsub }
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
      const { store, filtered }: any = build()
      let i = 0
      return measure(() => { tickFn(store, TICKS[i++ % TICKS.length]); void get(filtered) })
    })()
    const batch = (() => {
      const { store, filtered }: any = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(store, TICKS[j]); void get(filtered) }
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
    const React = (await import('react')).default ?? await import('react')
    const TestRenderer = (await import('react-test-renderer')).default ?? await import('react-test-renderer')
    const { act, create } = TestRenderer
    const h = React.createElement
    const { useState, useMemo } = React
    let setRowsRef: (fn: any) => void = () => {}
    let filteredRef: any = null
    function App() {
      const [rows, setRows] = useState(makeRows)
      const filtered = useMemo(() => rows.filter(pred), [rows])
      setRowsRef = setRows
      filteredRef = filtered
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
      return measure(() => { tickFn(TICKS[i++ % TICKS.length]); void filteredRef })
    })()
    const batch = (() => {
      build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(TICKS[j]); void filteredRef }
      })
    })()
    return { setup, single, batch }
  },
}

const op: OpBench = {
  operator: 'compare',
  notes: '.gt(\'val\', 50) on 10k rows; peers use predicate filter (val > 50)',
  variants: [data, crossfilterV, mobxV, rxjsV, solidV, preactV, vueV, svelteV, reactV],
}
export default op
