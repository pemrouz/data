// @ts-nocheck
// `union` — per-operator comparison.
//
// Workload: 10_000 rows; two filters (`active === true`, `val > 50`) UNIONed
// — a row is in the result if it passes either. Single tick mutates either
// `active` or `val` on one row. Batch streams TICK_COUNT ticks with the
// union read after each.
//
// data: A.union(B) — bitmask machinery, "any bit set" check is O(1) per
// row regardless of source count (operators/union/index.ts). Peers
// rebuild the union from scratch on each emit.
// crossfilter has no native union primitive — the closest fair translation
// is a manual two-dimension OR via JS, which collapses into filter+filter
// on the source rather than measuring a peer primitive. Omitted.

import { measure, pkgVersion } from '../measure.ts'
import {
  makeRows, makeTicks, THRESHOLD,
  type Row, type Tick, type Variant, type OpBench,
} from './_shared.ts'

const TICKS = makeTicks(undefined, undefined, undefined, ['active', 'val'])

const unionFn = (rows: Row[]): Row[] => {
  const out: Row[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.active || r.val > THRESHOLD) out.push(r)
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
      const u = a.union(b)
      return { src, u }
    }
    const setup = measure(() => { build() })
    const single = (() => {
      const { src, u } = build(); void u[value]
      let i = 0
      return measure(() => {
        const t = TICKS[i++ % TICKS.length]
        src[t.idx][t.field] = t.value
        void u[value]
      })
    })()
    const batch = (() => {
      const { src, u } = build(); void u[value]
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) {
          const t = TICKS[j]
          src[t.idx][t.field] = t.value
          void u[value]
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
      const u = computed(() => unionFn(rows))
      const dispose = autorun(() => { void u.get() })
      return { rows, u, dispose }
    }
    const setup = measure(() => { const g = build(); g.dispose() })
    const tickFn = (rows, t: Tick) => {
      runInAction(() => { rows[t.idx][t.field] = t.value })
    }
    const single = (() => {
      const { rows, u } = build()
      let i = 0
      return measure(() => { tickFn(rows, TICKS[i++ % TICKS.length]); void u.get() })
    })()
    const batch = (() => {
      const { rows, u } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(rows, TICKS[j]); void u.get() }
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
      const u$ = subj.pipe(map(unionFn))
      const sub = u$.subscribe(() => {})
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
    let u: () => any[] = () => []
    let dispose = () => {}
    const build = () => {
      dispose = createRoot(d => {
        cells = makeCells()
        u = createMemo(() => {
          const out: any[] = []
          for (let i = 0; i < cells.length; i++) {
            const cell = cells[i]
            if (cell.active() || cell.val() > THRESHOLD) out.push(cell)
          }
          return out
        })
        void u()
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
      return measure(() => { tickFn(TICKS[i++ % TICKS.length]); void u() })
    })()
    const batch = measure(() => {
      for (let j = 0; j < TICKS.length; j++) { tickFn(TICKS[j]); void u() }
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
      const u = computed(() => {
        const out: any[] = []
        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i]
          if (cell.active.value || cell.val.value > THRESHOLD) out.push(cell)
        }
        return out
      })
      const stop = effect(() => { void u.value })
      return { cells, u, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const tickFn = (cells, t: Tick) => {
      if (t.field === 'val') cells[t.idx].val.value = t.value as number
      else if (t.field === 'active') cells[t.idx].active.value = t.value as boolean
    }
    const single = (() => {
      const { cells, u } = build()
      let i = 0
      return measure(() => { tickFn(cells, TICKS[i++ % TICKS.length]); void u.value })
    })()
    const batch = (() => {
      const { cells, u } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(cells, TICKS[j]); void u.value }
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
      const u = computed(() => unionFn(rows))
      const stop = effect(() => { void u.value })
      return { rows, u, stop }
    }
    const setup = measure(() => { const g = build(); g.stop() })
    const tickFn = (rows, t: Tick) => { rows[t.idx][t.field] = t.value }
    const single = (() => {
      const { rows, u } = build()
      let i = 0
      return measure(() => { tickFn(rows, TICKS[i++ % TICKS.length]); void u.value })
    })()
    const batch = (() => {
      const { rows, u } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(rows, TICKS[j]); void u.value }
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
      const u = derived(store, unionFn)
      const unsub = u.subscribe(() => {})
      return { store, u, unsub }
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
      const { store, u } = build()
      let i = 0
      return measure(() => { tickFn(store, TICKS[i++ % TICKS.length]); void get(u) })
    })()
    const batch = (() => {
      const { store, u } = build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(store, TICKS[j]); void get(u) }
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
    let uRef: any = null
    function App() {
      const [rows, setRows] = useState(makeRows)
      const u = useMemo(() => unionFn(rows), [rows])
      setRowsRef = setRows
      uRef = u
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
      return measure(() => { tickFn(TICKS[i++ % TICKS.length]); void uRef })
    })()
    const batch = (() => {
      build()
      return measure(() => {
        for (let j = 0; j < TICKS.length; j++) { tickFn(TICKS[j]); void uRef }
      })
    })()
    return { setup, single, batch }
  },
}

const op: OpBench = {
  operator: 'union',
  notes: 'filter(active) ∪ filter(val>50) over 10k rows; tick mutates active or val. crossfilter omitted — no native union primitive',
  variants: [data, mobxV, rxjsV, solidV, preactV, vueV, svelteV, reactV],
}
export default op
