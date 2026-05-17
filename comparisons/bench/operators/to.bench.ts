// @ts-nocheck
// `to` — per-operator comparison.
//
// Workload: 10_000 rows; whole-value projection `to(rows => rows.length)`.
// Single tick rewrites one row's `val`. Batch streams TICK_COUNT ticks.
//
// data.to is the whole-value projection — every upstream change collapses
// to a single XU0 of `fn(source, prev)` (operators/to/index.ts). The
// reference-equality short-circuit means a `to` whose fn returns the same
// instance every time becomes a no-op subscription. Peers run the same
// shape via map/computed — same O(N) per emit for the user fn, plus their
// reactive overhead.

import { measure, pkgVersion } from '../measure.ts'
import {
  makeRows, makeTicks,
  type Row, type Tick, type Variant, type OpBench,
} from './_shared.ts'

const TICKS = makeTicks(undefined, undefined, undefined, ['val'])

// The projection itself reads source-wide state — proves the rebuild-on-
// every-event behaviour without amplifying it. A scalar reduction like
// length is the cheapest natural shape.
const proj = (rows: Row[] | Record<string, Row>) => {
  if (Array.isArray(rows)) return rows.length
  let n = 0
  for (const _ in rows) n++
  return n
}

// --- data -----------------------------------------------------------------

const data: Variant = {
  name: 'data',
  version: '1.0.0',
  run: async () => {
    const { $, value } = await import('../../../full.ts')
    const build = () => {
      // Source is an array (peer parity for `proj` — it short-circuits to
      // O(1) `rows.length` when given an array; if we wrapped it as an
      // object via `toObj` the projection would walk all 10k keys per tick
      // and the bench would measure for-in cost, not the operator).
      const src = $(makeRows())
      const t = src.to(proj)
      return { src, t }
    }
    const setup = measure(() => { build() })
    const single = (() => {
      const { src, t } = build(); void t[value]
      let i = 0
      return measure(() => {
        const tk = TICKS[i++ % TICKS.length]
        src[tk.idx][tk.field] = tk.value
        void t[value]
      })
    })()
    const batch = (() => {
      const { src, t } = build(); void t[value]
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
      const t = computed(() => proj(rows))
      const dispose = autorun(() => { void t.get() })
      return { rows, t, dispose }
    }
    const setup = measure(() => { const g = build(); g.dispose() })
    const tickFn = (rows, t: Tick) => {
      runInAction(() => { rows[t.idx][t.field] = t.value })
    }
    const single = (() => {
      const { rows, t } = build()
      let i = 0
      return measure(() => { tickFn(rows, TICKS[i++ % TICKS.length]); void t.get() })
    })()
    const batch = (() => {
      const { rows, t } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(rows, TICKS[j]); void t.get() }
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
      const t$ = subj.pipe(map(proj))
      const sub = t$.subscribe(() => {})
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
    let t: () => number = () => 0
    let dispose = () => {}
    const build = () => {
      dispose = createRoot(d => {
        cells = makeCells()
        t = createMemo(() => {
          // Touch each signal so the memo's deps include all of them
          let n = 0
          for (let i = 0; i < cells.length; i++) { void cells[i].val(); n++ }
          return n
        })
        void t()
        return d
      })
    }
    const setup = measure(() => { build(); dispose() })
    build()
    const tickFn = (tk: Tick) => {
      if (tk.field === 'val') cells[tk.idx].setVal(tk.value as number)
    }
    const single = (() => {
      let i = 0
      return measure(() => { tickFn(TICKS[i++ % TICKS.length]); void t() })
    })()
    const batch = measure(() => {
      for (let j = 0; j < TICKS.length; j++) { tickFn(TICKS[j]); void t() }
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
      const t = computed(() => {
        let n = 0
        for (let i = 0; i < cells.length; i++) { void cells[i].val.value; n++ }
        return n
      })
      const stop = effect(() => { void t.value })
      return { cells, t, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const tickFn = (cells, tk: Tick) => {
      if (tk.field === 'val') cells[tk.idx].val.value = tk.value as number
    }
    const single = (() => {
      const { cells, t } = build()
      let i = 0
      return measure(() => { tickFn(cells, TICKS[i++ % TICKS.length]); void t.value })
    })()
    const batch = (() => {
      const { cells, t } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(cells, TICKS[j]); void t.value }
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
      const t = computed(() => proj(rows))
      const stop = effect(() => { void t.value })
      return { rows, t, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const tickFn = (rows, t: Tick) => { rows[t.idx][t.field] = t.value }
    const single = (() => {
      const { rows, t } = build()
      let i = 0
      return measure(() => { tickFn(rows, TICKS[i++ % TICKS.length]); void t.value })
    })()
    const batch = (() => {
      const { rows, t } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(rows, TICKS[j]); void t.value }
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
      const t = derived(store, proj)
      const unsub = t.subscribe(() => {})
      return { store, t, unsub }
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
      const { store, t } = build()
      let i = 0
      return measure(() => { tickFn(store, TICKS[i++ % TICKS.length]); void get(t) })
    })()
    const batch = (() => {
      const { store, t } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(store, TICKS[j]); void get(t) }
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
    let tRef: any = null
    function App() {
      const [rows, setRows] = useState(makeRows)
      const t = useMemo(() => proj(rows), [rows])
      setRowsRef = setRows
      tRef = t
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
      return measure(() => { tickFn(TICKS[i++ % TICKS.length]); void tRef })
    })()
    const batch = (() => {
      build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(TICKS[j]); void tRef }
      })
    })()
    return { setup, single, batch }
  },
}

const op: OpBench = {
  operator: 'to (whole-value projection)',
  notes: 'src.to(rows => rows.length) over 10k rows; tick updates one val. crossfilter omitted — no whole-value projection primitive',
  variants: [data, mobxV, rxjsV, solidV, preactV, vueV, svelteV, reactV],
}
export default op
