// `reduce` — per-operator comparison.
//
// Workload: start with 10_000 rows; each tick INSERTS one new row at a
// fresh index. Maintain a running sum of `val` across the growing source.
// Single is one such insert; batch streams TICK_COUNT inserts (source
// grows from 10k to 11k).
//
// data: `reduce(add, remove, init)` threads each BI0 through `add` in O(1).
// Inserts are exactly the entry point reduce was designed to be incremental
// for (see CLAUDE.md — `BU1/BU2 still fall back to rebuild because the
// framework doesn't carry the old value at those entry points`). Peers
// re-walk the array on each emit; crossfilter has groupAll.reduce(add,
// remove, init) which is its closest semantic match.

import { measure, pkgVersion } from '../measure.ts'
import {
  N, makeRows,
  type Row, type Variant, type OpBench,
} from './_shared.ts'

const TICK_COUNT = 1000

const newRow = (id: number): Row => ({
  id,
  val: ((id * 9301 + 49297) % 1000) / 10,  // deterministic, in [0, 100)
  val2: ((id * 2147 + 33119) % 1000) / 10,
  cat: 'a',
  active: id % 2 === 0,
})

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
      const s = src.reduce(
        (acc: number, row: Row) => acc + row.val,
        (acc: number, row: Row) => acc - row.val,
        () => 0,
      )
      return { src, s }
    }
    const setup = measure(() => { build() })
    const single = (() => {
      const { src, s }: any = build(); void s[value]
      let next = N
      return measure(() => {
        src[next] = newRow(next)
        void s[value]
        next++
      })
    })()
    const batch = (() => {
      const { src, s }: any = build(); void s[value]
      let next = N  // monotonic across measure reps — every insert hits a
                    // fresh key (BI0 / incremental) rather than overwriting
                    // an earlier rep's key (BU2 / rebuild)
      return measure(() => {
        for (let j = 0; j < TICK_COUNT; j++) {
          src[next] = newRow(next)
          void s[value]
          next++
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
      const s = cf.groupAll().reduce(
        (acc: number, v: Row) => acc + v.val,
        (acc: number, v: Row) => acc - v.val,
        () => 0,
      )
      return { cf, s, state }
    }
    const setup = measure(() => { build() })
    const single = (() => {
      const { cf, s, state }: any = build(); void s.value()
      let next = N
      return measure(() => {
        const row = newRow(next++)
        state.push(row)
        cf.add([row])
        void s.value()
      })
    })()
    const batch = (() => {
      const { cf, s, state }: any = build(); void s.value()
      return measure(() => {
        for (let j = 0; j < TICK_COUNT; j++) {
          const row = newRow(N + j)
          state.push(row)
          cf.add([row])
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
        makeRows().map((r: any) => observable.object(r, {}, { deep: false })),
      )
      const s = computed(() => sumVals(rows))
      const dispose = autorun(() => { void s.get() })
      return { rows, s, dispose }
    }
    const setup = measure(() => { const g = build(); g.dispose() })
    const single = (() => {
      const { rows, s }: any = build()
      let next = N
      return measure(() => {
        runInAction(() => { rows.push(observable.object(newRow(next++), {}, { deep: false })) })
        void s.get()
      })
    })()
    const batch = (() => {
      const { rows, s }: any = build()
      return measure(() => {
        for (let j = 0; j < TICK_COUNT; j++) {
          runInAction(() => { rows.push(observable.object(newRow(N + j), {}, { deep: false })) })
          void s.get()
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
      const s$ = subj.pipe(map(sumVals))
      const sub = s$.subscribe(() => {})
      return { subj, sub }
    }
    const setup = measure(() => { const g = build(); g.sub.unsubscribe() })
    const single = (() => {
      const { subj }: any = build()
      let next = N
      return measure(() => {
        const cur = subj.value
        const nextArr = cur.slice()
        nextArr.push(newRow(next++))
        subj.next(nextArr)
      })
    })()
    const batch = (() => {
      const { subj }: any = build()
      return measure(() => {
        for (let j = 0; j < TICK_COUNT; j++) {
          const cur = subj.value
          const nextArr = cur.slice()
          nextArr.push(newRow(N + j))
          subj.next(nextArr)
        }
      })
    })()
    return { setup, single, batch }
  },
}

// --- solid ----------------------------------------------------------------
// Solid's per-row signal model doesn't fit a growing array shape cleanly;
// fairest equivalent is a single signal holding the array and a memo that
// sums it. That's what we measure.

const solidV: Variant = {
  name: 'solid',
  version: pkgVersion('solid-js'),
  run: async () => {
    const { createSignal, createMemo, createRoot } = await import('solid-js/dist/solid.js')
    let getRows: () => Row[] = () => []
    let setRows: (fn: (prev: Row[]) => Row[]) => void = () => {}
    let s: () => number = () => 0
    let dispose = () => {}
    const build = () => {
      dispose = createRoot((d: any) => {
        const [r, sr] = createSignal(makeRows(), { equals: false })
        getRows = r; setRows = sr as any
        s = createMemo(() => sumVals(getRows()))
        void s()
        return d
      })
    }
    const setup = measure(() => { build(); dispose() })
    build()
    const single = (() => {
      let next = N
      return measure(() => {
        setRows((prev: any) => { const a = prev.slice(); a.push(newRow(next++)); return a })
        void s()
      })
    })()
    const batch = measure(() => {
      for (let j = 0; j < TICK_COUNT; j++) {
        setRows((prev: any) => { const a = prev.slice(); a.push(newRow(N + j)); return a })
        void s()
      }
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
    const build = () => {
      const rows = signal(makeRows())
      const s = computed(() => sumVals(rows.value))
      const stop = effect(() => { void s.value })
      return { rows, s, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const single = (() => {
      const { rows, s }: any = build()
      let next = N
      return measure(() => {
        const a = rows.value.slice(); a.push(newRow(next++)); rows.value = a
        void s.value
      })
    })()
    const batch = (() => {
      const { rows, s }: any = build()
      return measure(() => {
        for (let j = 0; j < TICK_COUNT; j++) {
          const a = rows.value.slice(); a.push(newRow(N + j)); rows.value = a
          void s.value
        }
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
    const single = (() => {
      const { rows, s }: any = build()
      let next = N
      return measure(() => { rows.push(newRow(next++)); void s.value })
    })()
    const batch = (() => {
      const { rows, s }: any = build()
      return measure(() => {
        for (let j = 0; j < TICK_COUNT; j++) { rows.push(newRow(N + j)); void s.value }
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
    const single = (() => {
      const { store, s }: any = build()
      let next = N
      return measure(() => {
        store.update((rows: any) => { const a = rows.slice(); a.push(newRow(next++)); return a })
        void get(s)
      })
    })()
    const batch = (() => {
      const { store, s }: any = build()
      return measure(() => {
        for (let j = 0; j < TICK_COUNT; j++) {
          store.update((rows: any) => { const a = rows.slice(); a.push(newRow(N + j)); return a })
          void get(s)
        }
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
    const single = (() => {
      build()
      let next = N
      return measure(() => {
        act(() => { setRowsRef((prev: Row[]) => { const a = prev.slice(); a.push(newRow(next++)); return a }) })
        void sRef
      })
    })()
    const batch = (() => {
      build()
      return measure(() => {
        for (let j = 0; j < TICK_COUNT; j++) {
          act(() => { setRowsRef((prev: Row[]) => { const a = prev.slice(); a.push(newRow(N + j)); return a }) })
          void sRef
        }
      })
    })()
    return { setup, single, batch }
  },
}

const op: OpBench = {
  operator: 'reduce (incremental sum on insert)',
  notes: 'reduce(add, remove, init) running sum of `val`; tick inserts one new row at the end',
  variants: [data, crossfilterV, mobxV, rxjsV, solidV, preactV, vueV, svelteV, reactV],
}
export default op
