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
  ok(Object.keys(shell!.tabButtons).length === 3, 'should create 3 tab buttons')
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
