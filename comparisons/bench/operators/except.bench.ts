// @ts-nocheck
// `except` — per-operator comparison.
//
// Workload: 10_000 rows; A = filter(active === true), B = filter(val > 50);
// A.except(B) — rows in A but not in B. Single tick mutates `active` or
// `val` on one row. Batch streams TICK_COUNT ticks.
//
// data: bitmask difference, O(1) per delta (operators/except/index.ts).
// Peers rebuild the difference from scratch on every emit.

import { measure, pkgVersion } from '../measure.ts'
import {
  makeRows, makeTicks, THRESHOLD,
  type Row, type Tick, type Variant, type OpBench,
} from './_shared.ts'

const TICKS = makeTicks(undefined, undefined, undefined, ['active', 'val'])

const exceptFn = (rows: Row[]): Row[] => {
  const out: Row[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.active && !(r.val > THRESHOLD)) out.push(r)
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
      const e = a.except(b)
      return { src, e }
    }
    const setup = measure(() => { build() })
    const single = (() => {
      const { src, e } = build(); void e[value]
      let i = 0
      return measure(() => {
        const t = TICKS[i++ % TICKS.length]
        src[t.idx][t.field] = t.value
        void e[value]
      })
    })()
    const batch = (() => {
      const { src, e } = build(); void e[value]
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) {
          const t = TICKS[j]
          src[t.idx][t.field] = t.value
          void e[value]
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
      const e = computed(() => exceptFn(rows))
      const dispose = autorun(() => { void e.get() })
      return { rows, e, dispose }
    }
    const setup = measure(() => { const g = build(); g.dispose() })
    const tickFn = (rows, t: Tick) => {
      runInAction(() => { rows[t.idx][t.field] = t.value })
    }
    const single = (() => {
      const { rows, e } = build()
      let i = 0
      return measure(() => { tickFn(rows, TICKS[i++ % TICKS.length]); void e.get() })
    })()
    const batch = (() => {
      const { rows, e } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(rows, TICKS[j]); void e.get() }
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
      const e$ = subj.pipe(map(exceptFn))
      const sub = e$.subscribe(() => {})
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
    let e: () => any[] = () => []
    let dispose = () => {}
    const build = () => {
      dispose = createRoot(d => {
        cells = makeCells()
        e = createMemo(() => {
          const out: any[] = []
          for (let i = 0; i < cells.length; i++) {
            const cell = cells[i]
            if (cell.active() && !(cell.val() > THRESHOLD)) out.push(cell)
          }
          return out
        })
        void e()
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
      return measure(() => { tickFn(TICKS[i++ % TICKS.length]); void e() })
    })()
    const batch = measure(() => {
      for (let j = 0; j < TICKS.length; j++) { tickFn(TICKS[j]); void e() }
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
      const e = computed(() => {
        const out: any[] = []
        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i]
          if (cell.active.value && !(cell.val.value > THRESHOLD)) out.push(cell)
        }
        return out
      })
      const stop = effect(() => { void e.value })
      return { cells, e, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const tickFn = (cells, t: Tick) => {
      if (t.field === 'val') cells[t.idx].val.value = t.value as number
      else if (t.field === 'active') cells[t.idx].active.value = t.value as boolean
    }
    const single = (() => {
      const { cells, e } = build()
      let i = 0
      return measure(() => { tickFn(cells, TICKS[i++ % TICKS.length]); void e.value })
    })()
    const batch = (() => {
      const { cells, e } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(cells, TICKS[j]); void e.value }
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
      const e = computed(() => exceptFn(rows))
      const stop = effect(() => { void e.value })
      return { rows, e, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const tickFn = (rows, t: Tick) => { rows[t.idx][t.field] = t.value }
    const single = (() => {
      const { rows, e } = build()
      let i = 0
      return measure(() => { tickFn(rows, TICKS[i++ % TICKS.length]); void e.value })
    })()
    const batch = (() => {
      const { rows, e } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(rows, TICKS[j]); void e.value }
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
      const e = derived(store, exceptFn)
      const unsub = e.subscribe(() => {})
      return { store, e, unsub }
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
      const { store, e } = build()
      let i = 0
      return measure(() => { tickFn(store, TICKS[i++ % TICKS.length]); void get(e) })
    })()
    const batch = (() => {
      const { store, e } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(store, TICKS[j]); void get(e) }
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
    let eRef: any = null
    function App() {
      const [rows, setRows] = useState(makeRows)
      const e = useMemo(() => exceptFn(rows), [rows])
      setRowsRef = setRows
      eRef = e
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
      return measure(() => { tickFn(TICKS[i++ % TICKS.length]); void eRef })
    })()
    const batch = (() => {
      build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(TICKS[j]); void eRef }
      })
    })()
    return { setup, single, batch }
  },
}

const op: OpBench = {
  operator: 'except',
  notes: 'filter(active).except(filter(val>50)) over 10k rows; tick mutates active or val. crossfilter omitted — no native set-difference primitive',
  variants: [data, mobxV, rxjsV, solidV, preactV, vueV, svelteV, reactV],
}
export default op
