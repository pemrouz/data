// @ts-nocheck
// Shell smoke tests. The panel needs a real DOM API surface (createElement,
// attachShadow, addEventListener, classList, dataset, ShadowRoot etc.) which
// node:test doesn't ship. We approximate enough of the surface here for the
// shell to mount; richer tab-content tests in later commits will need a
// fuller stub or a JSDOM dependency. Keep this file's stub local to the
// suite — don't pollute globalThis for other tests.
import { test } from 'node:test'
import { ok, strictEqual } from 'node:assert'

function installDomStub() {
  const elements: any[] = []
  function makeEl(tag = 'div'): any {
    const el: any = {
      tagName: tag.toUpperCase(),
      children: [] as any[],
      style: new Proxy({}, { set: (t, k, v) => { t[k] = v; return true } }),
      dataset: {},
      _classList: new Set<string>(),
      get classList() {
        const set = this._classList
        return {
          _set: set,
          add(c: string) { set.add(c) },
          remove(c: string) { set.delete(c) },
          toggle(c: string, on: boolean) { if (on) set.add(c); else set.delete(c) },
          contains(c: string) { return set.has(c) },
        }
      },
      get className() { return [...this._classList].join(' ') },
      set className(v: string) {
        this._classList.clear()
        for (const c of String(v).split(/\s+/)) if (c) this._classList.add(c)
      },
      _attrs: {} as Record<string, string>,
      setAttribute(k: string, v: string) { this._attrs[k] = v },
      getAttribute(k: string) { return this._attrs[k] },
      _listeners: {} as Record<string, ((e: any) => void)[]>,
      addEventListener(name: string, fn: any) {
        ;(this._listeners[name] ||= []).push(fn)
      },
      removeEventListener() {},
      setPointerCapture() {}, releasePointerCapture() {},
      appendChild(c: any) { this.children.push(c); c.parentNode = this; return c },
      removeChild(c: any) {
        const i = this.children.indexOf(c)
        if (i >= 0) { this.children.splice(i, 1); c.parentNode = null }
        return c
      },
      attachShadow() {
        const root: any = makeEl('#shadow')
        root.host = el
        el._shadow = root
        return root
      },
      getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 } },
      get parentNode() { return el._parent ?? null },
      set parentNode(v) { el._parent = v },
      get textContent() { return el._text ?? '' },
      set textContent(v) { el._text = v },
      get innerHTML() { return '' },
      set innerHTML(v: string) {
        // Panel code does body.innerHTML = '' before re-rendering. Honor
        // it so accumulated children don't pollute findEl traversals.
        if (v === '') el.children.length = 0
      },
    }
    elements.push(el)
    return el
  }
  const docBody = makeEl('body')
  globalThis.document = {
    createElement: (t: string) => makeEl(t),
    createTextNode: (text: string) => {
      const n: any = makeEl('#text')
      n.textContent = text
      return n
    },
    body: docBody,
  } as any
  globalThis.localStorage = {
    _data: {} as Record<string, string>,
    getItem(k: string) { return this._data[k] ?? null },
    setItem(k: string, v: string) { this._data[k] = v },
    removeItem(k: string) { delete this._data[k] },
  } as any
  return { docBody, elements }
}

test('panel/shell - mount attaches a host to document.body with shadow root', async () => {
  const { docBody } = installDomStub()
  const { mount, unmount, getShell } = await import('./index.ts')
  const shell = mount()
  ok(shell, 'mount should return a shell')
  ok(docBody.children.includes(shell!.host), 'host should be appended to body')
  ok(shell!.root, 'shell.root should be the shadow root')
  ok(shell!.body, 'shell.body should exist (tab content area)')
  ok(Object.keys(shell!.tabButtons).length === 4, 'should create 4 tab buttons')
  unmount()
  ok(!docBody.children.includes(shell!.host), 'unmount removes host')
  strictEqual(getShell(), null)
})

test('panel/shell - setActiveTab toggles the active class', async () => {
  installDomStub()
  const { mount, unmount } = await import('./index.ts')
  const shell = mount()!
  shell.setActiveTab('events')
  ok(shell.tabButtons.events.classList.contains('active'))
  ok(!shell.tabButtons.graph.classList.contains('active'))
  shell.setActiveTab('profile')
  ok(shell.tabButtons.profile.classList.contains('active'))
  ok(!shell.tabButtons.events.classList.contains('active'))
  unmount()
})

test('panel/shell - mount is idempotent', async () => {
  installDomStub()
  const { mount, unmount } = await import('./index.ts')
  const a = mount()
  const b = mount()
  strictEqual(a, b, 'second mount returns the same shell')
  unmount()
})

test('panel/state - getPanelState returns a singleton, marked internal', async () => {
  installDomStub()
  const { getPanelState, resetPanelState } = await import('./state.ts')
  const { _devtoolsInternalRoots } = await import('../../core.ts')
  const { value, view } = await import('../../core.ts')
  resetPanelState()
  const a = getPanelState()
  const b = getPanelState()
  strictEqual(a, b, 'getPanelState returns the same proxy')
  ok(_devtoolsInternalRoots.has(a[view]), 'panel state should be registered as internal')
  strictEqual(a[value].activeTab, 'graph', 'default activeTab is graph')
  resetPanelState()
})

test('panel/graph - renders root selector and tree from $.graph()', async () => {
  installDomStub()
  // Stub rAF so the throttled rewalk fires synchronously in the test.
  globalThis.requestAnimationFrame = (fn: any) => { fn(); return 0 }
  const { mount, unmount } = await import('./index.ts')
  const { $ } = await import('../../core.ts')
  await import('../../full.ts')   // register operators so .filter works
  await import('../index.ts')      // attach $.trace etc.
  // Create a small root with an operator chain so the graph tab has
  // something to render.
  const data = $({ x: { active: true, n: 1 } })
  const _filter = data.filter(d => d.active)
  const _length = _filter.length()

  const shell = mount()!
  shell.setActiveTab('graph')

  // Graph tab body should now contain the toolbar and tree.
  const findEl = (root: any, predicate: (el: any) => boolean): any => {
    if (predicate(root)) return root
    for (const c of root.children || []) {
      const hit = findEl(c, predicate)
      if (hit) return hit
    }
    return null
  }
  const toolbar = findEl(shell.body, (el) => el.classList?.contains?.('gt-toolbar'))
  ok(toolbar, 'graph tab should render its toolbar')
  const select = findEl(shell.body, (el) => el.tagName === 'SELECT')
  ok(select, 'graph tab should render a root selector')
  const tree = findEl(shell.body, (el) => el.classList?.contains?.('gt-tree'))
  ok(tree, 'graph tab should render the tree container')
  // Tree should contain at least one node row (the root) and ideally the
  // operator descendants. Just assert the tree is non-empty.
  ok((tree.children || []).length > 0, 'tree should render at least one node')

  unmount()
  ok(_filter && _length)
})

test('panel/events - mutating selected root appends rows to the live tail', async () => {
  installDomStub()
  globalThis.requestAnimationFrame = (fn: any) => { fn(); return 0 }
  const { mount, unmount } = await import('./index.ts')
  const { $, view } = await import('../../core.ts')
  await import('../../full.ts')
  await import('../index.ts')
  const { iterRoots } = await import('../walk.ts')
  const { getPanelState, resetPanelState, clearPersistedPanelState } = await import('./state.ts')
  clearPersistedPanelState()
  resetPanelState()
  const data = $({ a: 1 })
  // Find data's index among the live roots so the events tab traces it
  // (and not some stale root left behind by an earlier test).
  const idx = [...iterRoots()].findIndex(v => v === data[view])
  ok(idx >= 0, 'data root should be enumerable')
  getPanelState().selectedRootIdx = idx

  const shell = mount()!
  shell.setActiveTab('events')

  const findEl = (root: any, predicate: (el: any) => boolean): any => {
    if (predicate(root)) return root
    for (const c of root.children || []) {
      const hit = findEl(c, predicate)
      if (hit) return hit
    }
    return null
  }
  const list = findEl(shell.body, (el) => el.classList?.contains?.('ev-list'))
  ok(list, 'events tab should render its list')
  const before = (list.children || []).length

  // Mutate the data — should append a row.
  data.a = 2
  data.b = 99

  // The trace's onEvent fires synchronously inside the mutation, so the
  // list should have grown by the time the next statement runs.
  const after = (list.children || []).length
  ok(after > before, `expected list to grow on mutations (was ${before}, now ${after})`)

  unmount()
})

test('panel/events - pause toggle stops appending until resumed', async () => {
  installDomStub()
  const { mount, unmount } = await import('./index.ts')
  const { $, value, view } = await import('../../core.ts')
  await import('../../full.ts')
  await import('../index.ts')
  const { iterRoots } = await import('../walk.ts')
  const { getPanelState, resetPanelState, clearPersistedPanelState } = await import('./state.ts')
  clearPersistedPanelState()
  resetPanelState()
  const data = $({ a: 1 })
  const idx = [...iterRoots()].findIndex(v => v === data[view])
  getPanelState().selectedRootIdx = idx

  const shell = mount()!
  shell.setActiveTab('events')

  const findEl = (root: any, predicate: (el: any) => boolean): any => {
    if (predicate(root)) return root
    for (const c of root.children || []) {
      const hit = findEl(c, predicate)
      if (hit) return hit
    }
    return null
  }
  const list = findEl(shell.body, (el) => el.classList?.contains?.('ev-list'))!
  data.a = 2
  const baseline = (list.children || []).length

  // Pause via state mutation (cheaper than synthesizing a click).
  const state = getPanelState()
  state.paused = true
  data.a = 3
  data.a = 4
  strictEqual((list.children || []).length, baseline, 'no rows appended while paused')

  state.paused = false
  data.a = 5
  ok((list.children || []).length > baseline, 'rows resume after unpause')

  unmount()
  clearPersistedPanelState()
})

test('panel/profile - start renders table after mutations; stop clears state', async () => {
  installDomStub()
  const { mount, unmount } = await import('./index.ts')
  const { $, view } = await import('../../core.ts')
  await import('../../full.ts')
  await import('../index.ts')
  const { iterRoots } = await import('../walk.ts')
  const { getPanelState, resetPanelState, clearPersistedPanelState } = await import('./state.ts')
  clearPersistedPanelState()
  resetPanelState()
  const data = $({})
  const _filtered = data.filter(d => d.active)
  const _length = _filtered.length()
  const idx = [...iterRoots()].findIndex(v => v === data[view])
  getPanelState().selectedRootIdx = idx

  const shell = mount()!
  shell.setActiveTab('profile')

  const findEl = (root: any, predicate: (el: any) => boolean): any => {
    if (predicate(root)) return root
    for (const c of root.children || []) {
      const hit = findEl(c, predicate)
      if (hit) return hit
    }
    return null
  }
  // Click start by simulating: just call the click listener.
  const startBtn = findEl(shell.body, (el) => el.tagName === 'BUTTON' && el.classList?.contains?.('pf-btn'))!
  ok(startBtn, 'start button exists')
  for (const fn of startBtn._listeners?.click || []) fn({})

  // Trigger some events.
  for (let i = 0; i < 10; i++) data['k' + i] = { active: i % 2 === 0 }

  // Click stop (same button, now toggled).
  for (const fn of startBtn._listeners?.click || []) fn({})

  // After stop, the table should have been rendered with byOperator rows.
  const table = findEl(shell.body, (el) => el.classList?.contains?.('pf-table'))
  ok(table, 'profile tab should render the byOperator table after stop')

  unmount()
  ok(_filtered && _length)
  clearPersistedPanelState()
})

test('panel/picker - arm/disarm + click selects matching root and switches to graph tab', async () => {
  installDomStub()
  // Pad the stub with the things picker needs.
  ;(globalThis.document as any).addEventListener = (() => {
    const map: Record<string, ((e: any) => void)[]> = {}
    ;(globalThis.document as any)._listeners = map
    ;(globalThis.document as any).removeEventListener = (n: string, fn: any) => {
      const arr = map[n]
      if (arr) {
        const i = arr.indexOf(fn)
        if (i >= 0) arr.splice(i, 1)
      }
    }
    return (n: string, fn: any) => { (map[n] ||= []).push(fn) }
  })()
  // The picker defers click-listener install via setTimeout(0) to avoid
  // the arm-click immediately re-firing onClick. Run timers synchronously
  // in the test so we don't have to await a real timer.
  const realSetTimeout = globalThis.setTimeout as any
  ;(globalThis as any).setTimeout = (fn: any) => { fn(); return 0 }
  const { mount, unmount } = await import('./index.ts')
  const { $, view, value } = await import('../../core.ts')
  await import('../index.ts')
  const { iterRoots } = await import('../walk.ts')
  const { getPanelState, resetPanelState, clearPersistedPanelState } = await import('./state.ts')
  clearPersistedPanelState()
  resetPanelState()
  const data = $({ a: 1 })
  const idx = [...iterRoots()].findIndex(v => v === data[view])

  const shell = mount()!
  // Make a fake DOM element with a __ripple_sink whose p is data's view,
  // and register that sink on data so walk() sees it as a real sink during
  // the post-pick highlight step.
  const target: any = (globalThis.document as any).createElement('div')
  const fakeSink: any = { p: data[view], parent: target, constructor: { name: 'DOMSink' } }
  target.__ripple_sink = fakeSink
  ;(target as any).className = 'page-target'
  data[view].sinks.add(new WeakRef(fakeSink))

  // Click the pick button to arm.
  for (const fn of (shell.pickButton as any)._listeners?.click || []) fn({})

  // Simulate the document-level click — picker installs onClick at capture
  // phase via addEventListener('click', onClick, true). Find that listener
  // and invoke it with our target.
  const docListeners = (globalThis.document as any)._listeners?.click || []
  ok(docListeners.length, 'picker should install a document click listener while armed')
  const ev: any = {
    target,
    preventDefault() {},
    stopPropagation() {},
  }
  for (const fn of docListeners) fn(ev)

  // After click, pickerArmed should be false and selectedRootIdx should
  // point at data's index, with activeTab switched to graph.
  const state = getPanelState()
  strictEqual(state[value].pickerArmed, false, 'picker should disarm after click')
  strictEqual(state[value].selectedRootIdx, idx, 'selectedRootIdx should match the clicked root')
  strictEqual(state[value].activeTab, 'graph', 'activeTab should switch to graph')

  // The picker should have stashed the matched __ripple_sink so the graph
  // tab can spotlight it. walk() tags the node when given the same ref.
  const { getPickedSink } = await import('./state.ts')
  const { walk } = await import('../walk.ts')
  strictEqual(getPickedSink(), target.__ripple_sink, 'picked sink reference is stored')
  const tree = walk(data[view], { pickedSink: getPickedSink() })
  const pickedNode = tree.sinks.find((s: any) => s.picked)
  ok(pickedNode, 'walk should tag the matching sink as picked')

  unmount()
  clearPersistedPanelState()
  ;(globalThis as any).setTimeout = realSetTimeout
})

test('panel/flame - start records cascades; clicking one renders frame bars', async () => {
  installDomStub()
  const { mount, unmount } = await import('./index.ts')
  const { $, view } = await import('../../core.ts')
  await import('../../full.ts')
  await import('../index.ts')
  const { iterRoots } = await import('../walk.ts')
  const { getPanelState, resetPanelState, clearPersistedPanelState } = await import('./state.ts')
  clearPersistedPanelState()
  resetPanelState()
  const data = $({})
  const _filtered = data.filter(d => d.active)
  const _length = _filtered.length()
  const idx = [...iterRoots()].findIndex(v => v === data[view])
  getPanelState().selectedRootIdx = idx

  const shell = mount()!
  shell.setActiveTab('flame')

  const findEl = (root: any, predicate: (el: any) => boolean): any => {
    if (predicate(root)) return root
    for (const c of root.children || []) {
      const hit = findEl(c, predicate)
      if (hit) return hit
    }
    return null
  }
  const findAll = (root: any, predicate: (el: any) => boolean, out: any[] = []): any[] => {
    if (predicate(root)) out.push(root)
    for (const c of root.children || []) findAll(c, predicate, out)
    return out
  }

  // Click start.
  const startBtn = findEl(shell.body, (el) =>
    el.tagName === 'BUTTON' && el.classList?.contains?.('fl-btn') && el.textContent?.includes?.('start')
  )
  ok(startBtn, 'flame tab should render a start button')
  for (const fn of startBtn._listeners?.click || []) fn({})

  // Mutate — should produce a cascade once we yield to microtasks.
  for (let i = 0; i < 3; i++) {
    data['k' + i] = { active: i % 2 === 0 }
    await Promise.resolve()
  }

  // Force a refresh by clicking stop (which calls handle.stop() and re-renders).
  const stopBtn = findEl(shell.body, (el) =>
    el.tagName === 'BUTTON' && el.classList?.contains?.('fl-btn') && el.textContent?.includes?.('stop')
  )
  ok(stopBtn, 'after start, the toggle button should now read "stop"')
  for (const fn of stopBtn._listeners?.click || []) fn({})

  // Cascade list should have one row per recorded cascade.
  const list = findEl(shell.body, (el) => el.classList?.contains?.('fl-list'))
  ok(list, 'flame tab should render a cascade list')
  const rows = (list.children || []).filter((c: any) => c.classList?.contains?.('fl-cas'))
  ok(rows.length >= 1, `expected >=1 cascade rows, got ${rows.length}`)

  // Click the first row to select it; chart should render frames.
  for (const fn of rows[0]._listeners?.click || []) fn({})
  const flame = findEl(shell.body, (el) => el.classList?.contains?.('fl-flame'))
  ok(flame, 'selected cascade should render a flame container')
  const frames = findAll(flame, (el: any) => el.classList?.contains?.('fl-frame'))
  ok(frames.length >= 1, `expected >=1 flame frames, got ${frames.length}`)

  // Each frame's data-verb should match a known notification verb.
  const VERBS = new Set(['XU0','XR0','BU1','BU2','BI0','BI0A','BI2','BR1','BR1A','BR2','BMV1'])
  for (const f of frames) {
    ok(VERBS.has(f.dataset?.verb), `unexpected verb on frame: ${f.dataset?.verb}`)
  }

  unmount()
  ok(_filtered && _length)
  clearPersistedPanelState()
})

test('panel/flame - clear empties the list; new mutations repopulate it', async () => {
  installDomStub()
  const { mount, unmount } = await import('./index.ts')
  const { $, view } = await import('../../core.ts')
  await import('../../full.ts')
  await import('../index.ts')
  const { iterRoots } = await import('../walk.ts')
  const { getPanelState, resetPanelState, clearPersistedPanelState } = await import('./state.ts')
  clearPersistedPanelState()
  resetPanelState()
  const data = $({})
  const idx = [...iterRoots()].findIndex(v => v === data[view])
  getPanelState().selectedRootIdx = idx

  const shell = mount()!
  shell.setActiveTab('flame')

  const findEl = (root: any, predicate: (el: any) => boolean): any => {
    if (predicate(root)) return root
    for (const c of root.children || []) {
      const hit = findEl(c, predicate)
      if (hit) return hit
    }
    return null
  }
  const buttons = (root: any) => {
    const out: any[] = []
    const walk = (n: any) => {
      if (n.tagName === 'BUTTON' && n.classList?.contains?.('fl-btn')) out.push(n)
      for (const c of n.children || []) walk(c)
    }
    walk(root)
    return out
  }

  // Start + mutate + stop, so a cascade lands in the buffer.
  const [startBtn, clearBtn] = buttons(shell.body)
  ok(startBtn && clearBtn, 'flame tab should expose start + clear buttons')
  for (const fn of startBtn._listeners?.click || []) fn({})
  data.x = 1
  await Promise.resolve()
  // Stop (toggle button is the same element; its click listener handles both states).
  for (const fn of startBtn._listeners?.click || []) fn({})

  const list = findEl(shell.body, (el) => el.classList?.contains?.('fl-list'))!
  const before = (list.children || []).filter((c: any) => c.classList?.contains?.('fl-cas')).length
  ok(before >= 1, 'cascade list should have populated after the mutation')

  // Click clear.
  for (const fn of clearBtn._listeners?.click || []) fn({})
  const after = (list.children || []).filter((c: any) => c.classList?.contains?.('fl-cas')).length
  strictEqual(after, 0, 'clear should empty the cascade list')

  unmount()
  clearPersistedPanelState()
})

test('panel/state - mutations route through and persist subset to localStorage', async () => {
  installDomStub()
  const { getPanelState, resetPanelState, clearPersistedPanelState } = await import('./state.ts')
  const { value } = await import('../../core.ts')
  clearPersistedPanelState()
  resetPanelState()
  const state = getPanelState()
  state.activeTab = 'events'
  strictEqual(state[value].activeTab, 'events')
  // Reset the in-memory singleton; localStorage survives, so the next
  // getPanelState() should rehydrate.
  resetPanelState()
  const fresh = getPanelState()
  strictEqual(fresh[value].activeTab, 'events', 'rehydrated activeTab from localStorage')
  clearPersistedPanelState()
  resetPanelState()
})
