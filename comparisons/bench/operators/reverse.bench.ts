// `reverse` — per-operator comparison.
//
// Workload: 10_000 rows; reactive reversed array. Tick inserts one row at
// a fresh key (the reversed array grows by one — what was index 0 becomes
// index 1 in the output). Batch streams TICK_COUNT inserts.
//
// data.reverse rebuilds on every upstream event (operators/reverse/index.ts
// source comment: "the simple-correct path is to rebuild. If a hot path
// needs incremental, the BR1A / BI0A semantics are the right next step.").

import { measure, pkgVersion } from '../measure.ts'
import {
  N, makeRows,
  type Row, type Variant, type OpBench,
} from './_shared.ts'

const TICK_COUNT = 1000
const newRow = (id: number): Row => ({ id, val: 0, val2: 0, cat: 'a', active: false })
const reverseArr = (rows: Row[]) => rows.slice().reverse()

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
      const r = src.reverse()
      return { src, r }
    }
    const setup = measure(() => { build() })
    const single = (() => {
      const { src, r }: any = build(); void r[value]
      let next = N
      return measure(() => { src[next] = newRow(next); void r[value]; next++ })
    })()
    const batch = (() => {
      const { src, r }: any = build(); void r[value]
      let next = N
      return measure(() => {
        for (let j = 0; j < TICK_COUNT; j++) { src[next] = newRow(next); void r[value]; next++ }
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
      const rows = observable.array(makeRows().map((r: any) => observable.object(r, {}, { deep: false })))
      const r = computed(() => reverseArr(rows))
      const dispose = autorun(() => { void r.get() })
      return { rows, r, dispose }
    }
    const setup = measure(() => { const g = build(); g.dispose() })
    const single = (() => {
      const { rows, r }: any = build()
      let next = N
      return measure(() => {
        runInAction(() => { rows.push(observable.object(newRow(next++), {}, { deep: false })) })
        void r.get()
      })
    })()
    const batch = (() => {
      const { rows, r }: any = build()
      return measure(() => {
        for (let j = 0; j < TICK_COUNT; j++) {
          runInAction(() => { rows.push(observable.object(newRow(N + j), {}, { deep: false })) })
          void r.get()
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
      const r$ = subj.pipe(map(reverseArr))
      const sub = r$.subscribe(() => {})
      return { subj, sub }
    }
    const setup = measure(() => { const g = build(); g.sub.unsubscribe() })
    const single = (() => {
      const { subj }: any = build()
      let next = N
      return measure(() => {
        const a = subj.value.slice(); a.push(newRow(next++)); subj.next(a)
      })
    })()
    const batch = (() => {
      const { subj }: any = build()
      return measure(() => {
        for (let j = 0; j < TICK_COUNT; j++) {
          const a = subj.value.slice(); a.push(newRow(N + j)); subj.next(a)
        }
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
    let getRows: () => Row[] = () => []
    let setRows: (fn: (prev: Row[]) => Row[]) => void = () => {}
    let r: () => Row[] = () => []
    let dispose = () => {}
    const build = () => {
      dispose = createRoot((d: any) => {
        const [rs, sr] = createSignal(makeRows(), { equals: false })
        getRows = rs; setRows = sr as any
        r = createMemo(() => reverseArr(getRows()))
        void r()
        return d
      })
    }
    const setup = measure(() => { build(); dispose() })
    build()
    const single = (() => {
      let next = N
      return measure(() => {
        setRows((prev: any) => { const a = prev.slice(); a.push(newRow(next++)); return a })
        void r()
      })
    })()
    const batch = measure(() => {
      for (let j = 0; j < TICK_COUNT; j++) {
        setRows((prev: any) => { const a = prev.slice(); a.push(newRow(N + j)); return a })
        void r()
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
      const r = computed(() => reverseArr(rows.value))
      const stop = effect(() => { void r.value })
      return { rows, r, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const single = (() => {
      const { rows, r }: any = build()
      let next = N
      return measure(() => {
        const a = rows.value.slice(); a.push(newRow(next++)); rows.value = a
        void r.value
      })
    })()
    const batch = (() => {
      const { rows, r }: any = build()
      return measure(() => {
        for (let j = 0; j < TICK_COUNT; j++) {
          const a = rows.value.slice(); a.push(newRow(N + j)); rows.value = a
          void r.value
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
      const r = computed(() => reverseArr(rows))
      const stop = effect(() => { void r.value })
      return { rows, r, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const single = (() => {
      const { rows, r }: any = build()
      let next = N
      return measure(() => { rows.push(newRow(next++)); void r.value })
    })()
    const batch = (() => {
      const { rows, r }: any = build()
      return measure(() => {
        for (let j = 0; j < TICK_COUNT; j++) { rows.push(newRow(N + j)); void r.value }
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
      const r = derived(store, reverseArr)
      const unsub = r.subscribe(() => {})
      return { store, r, unsub }
    }
    const setup = measure(() => { const g = build(); g.unsub() })
    const single = (() => {
      const { store, r }: any = build()
      let next = N
      return measure(() => {
        store.update((rows: any) => { const a = rows.slice(); a.push(newRow(next++)); return a })
        void get(r)
      })
    })()
    const batch = (() => {
      const { store, r }: any = build()
      return measure(() => {
        for (let j = 0; j < TICK_COUNT; j++) {
          store.update((rows: any) => { const a = rows.slice(); a.push(newRow(N + j)); return a })
          void get(r)
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
    let rRef: any = null
    function App() {
      const [rows, setRows] = useState(makeRows)
      const r = useMemo(() => reverseArr(rows), [rows])
      setRowsRef = setRows
      rRef = r
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
        void rRef
      })
    })()
    const batch = (() => {
      build()
      return measure(() => {
        for (let j = 0; j < TICK_COUNT; j++) {
          act(() => { setRowsRef((prev: Row[]) => { const a = prev.slice(); a.push(newRow(N + j)); return a }) })
          void rRef
        }
      })
    })()
    return { setup, single, batch }
  },
}

const op: OpBench = {
  operator: 'reverse',
  notes: 'src.reverse() over 10k rows; tick inserts one row. data.reverse rebuilds on every event — same shape as peers',
  variants: [data, mobxV, rxjsV, solidV, preactV, vueV, svelteV, reactV],
}
export default op
