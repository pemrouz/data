// Regression tests for the devtools overlay panel.
//
// The panel mounts into a CLOSED shadow root, so Playwright's locator API
// can't see inside. We reach the live panel object through the public
// `$.devtools.panel.shell` accessor (which returns `{ host, root, dock,
// destroy }`); every test goes through it and then queries the shadow.
// DOM events on shadow elements are dispatched directly rather than via
// locator.click() (which doesn't reach closed shadow roots).
//
// We drive the existing todo-jsx example (`/examples/todo-jsx/?devtools`)
// rather than a custom mockup so the test exercises the same code path
// users hit: importmap-loaded devtools, auto-mount triggered by ?devtools,
// real `<For>` / `.filter()` / `.length()` graph topology.
import { test, expect } from '@playwright/test'

const SEED = `
  localStorage.setItem('todos-ripple-jsx', JSON.stringify({
    a: { title: 'milk',  completed: false },
    b: { title: 'bread', completed: true  },
    c: { title: 'eggs',  completed: false },
  }))
`

// Wait until the panel has fully mounted: shell ref is non-null AND the
// dock element exists inside its shadow root. The post-import poll waits up
// to ~5s for the first $() root to appear before mounting, so tests must
// allow time for both the example app and the panel to finish booting.
const waitForPanel = async (page: any) => {
  await page.waitForFunction(async () => {
    const dt: any = await import('data/devtools')
    const shell = dt.$?.devtools?.panel?.shell
    return shell && shell.root && shell.root.querySelector('.dock')
  }, { timeout: 10_000 })
}

const setup = async (page: any) => {
  await page.addInitScript(SEED)
  await page.goto('/examples/todo-jsx/?devtools')
  await page.waitForSelector('.todo-list li', { timeout: 10_000 })
  await waitForPanel(page)
}

// Switch the panel to Tree layout. DAG is the default, but several tests
// rely on Tree-specific selectors (.tnode-row, .name text) for readability —
// flipping the layout once at the top of those tests is cheaper than
// rewriting every one to work against both shapes.
const switchToTree = async (page: any) => {
  await page.evaluate(async () => {
    const dt: any = await import('data/devtools')
    const root = dt.$.devtools.panel.shell.root
    const tree = Array.from(root.querySelectorAll('.seg button')).find(
      (b: any) => b.textContent === 'Tree',
    ) as any
    if (tree && !tree.classList.contains('active')) tree.click()
  })
}

test.describe('devtools panel — shell', () => {
  test('mounts a host with a closed shadow and a dock inside', async ({ page }) => {
    await setup(page)
    const visible = await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const shell = dt.$.devtools.panel.shell
      return {
        hostInDom:   !!document.querySelector('.__ripple_panel_host'),
        shadowMode:  shell.host.shadowRoot === null, // closed
        dockExists:  !!shell.root.querySelector('.dock'),
        brand:       shell.root.querySelector('.brand')?.textContent,
        layoutBtns:  Array.from(shell.root.querySelectorAll('.seg button')).map((b: any) => b.textContent),
        tabBtns:     Array.from(shell.root.querySelectorAll('.insp-tabs button')).map((b: any) => b.textContent),
      }
    })
    expect(visible.hostInDom).toBe(true)
    expect(visible.shadowMode).toBe(true)
    expect(visible.dockExists).toBe(true)
    expect(visible.brand).toContain('devtools')
    expect(visible.layoutBtns).toEqual(['Tree', 'DAG'])
    expect(visible.tabBtns).toEqual(['inspect', 'events', 'profile'])
  })

  test('DAG is the default layout on load', async ({ page }) => {
    await setup(page)
    const state = await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      const active = Array.from(root.querySelectorAll('.seg button')).find(
        (b: any) => b.classList.contains('active'),
      ) as any
      return {
        activeLabel: active?.textContent,
        dagNodes:    root.querySelectorAll('.dnode').length,
        treeRows:    root.querySelectorAll('.tnode-row').length,
      }
    })
    expect(state.activeLabel).toBe('DAG')
    expect(state.dagNodes).toBeGreaterThan(0)
    expect(state.treeRows).toBe(0)
  })

  test('dock resize handle widens the dock via pointer drag', async ({ page }) => {
    await setup(page)
    const widths = await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      const dock: any = root.querySelector('.dock')
      const handle: any = root.querySelector('.dock-resize')
      const before = dock.getBoundingClientRect().width
      const r = handle.getBoundingClientRect()
      const dispatch = (type: string, x: number) => handle.dispatchEvent(
        new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 100, pointerId: 1 }),
      )
      dispatch('pointerdown', r.left + 3)
      dispatch('pointermove', r.left + 3 - 160)
      dispatch('pointerup',   r.left + 3 - 160)
      const after = dock.getBoundingClientRect().width
      const stored = Number(localStorage.getItem('data-devtools-dock-width'))
      return { before: Math.round(before), after: Math.round(after), stored }
    })
    expect(widths.after - widths.before).toBeGreaterThanOrEqual(140)
    expect(widths.after - widths.before).toBeLessThanOrEqual(180)
    expect(widths.stored).toBeGreaterThanOrEqual(widths.after - 2)
    expect(widths.stored).toBeLessThanOrEqual(widths.after + 2)
  })

  test('dock width persists across reload', async ({ page }) => {
    await setup(page)
    await page.evaluate(() => localStorage.setItem('data-devtools-dock-width', '720'))
    await page.reload()
    await page.waitForSelector('.todo-list li', { timeout: 10_000 })
    await waitForPanel(page)
    const width = await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      return root.querySelector('.dock').getBoundingClientRect().width
    })
    // 1px left-border on the dock means the rect width is inline width + 1.
    expect(width).toBeGreaterThanOrEqual(720)
    expect(width).toBeLessThanOrEqual(722)
  })

  test('does NOT mount when ?devtools is omitted', async ({ page }) => {
    await page.addInitScript(SEED)
    // The example only imports devtools when the URL contains "devtools",
    // so loading without it leaves the panel completely uninitialised.
    await page.goto('/examples/todo-jsx/')
    await page.waitForSelector('.todo-list li', { timeout: 10_000 })
    await page.waitForTimeout(200)
    const hosts = await page.locator('.__ripple_panel_host').count()
    expect(hosts).toBe(0)
  })
})

test.describe('devtools panel — graph', () => {
  test('Tree layout renders root + operator chain', async ({ page }) => {
    await setup(page)
    await switchToTree(page)
    const tree = await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      const rows = root.querySelectorAll('.tnode-row')
      return Array.from(rows).map((r: any) => ({
        kind: r.querySelector('.kind')?.textContent,
        name: r.querySelector('.name')?.textContent,
        chip: r.querySelector('.tnode-chip')?.textContent || null,
      }))
    })
    // todo-jsx wires .filter() and .length() chains off the items root —
    // exactly the surface the METHOD_OF table normalises ".filterstring()"
    // → ".filter()" for. DOM bindings live on a separate $(filters.all)
    // proxy (see the picker test), so the items root itself has no direct
    // terminal sinks — the chip on the root row is absent.
    expect(tree.length).toBeGreaterThanOrEqual(2)
    expect(tree[0].name).toBe('<root>')
    const labels = tree.map((t: any) => t.name).join('|')
    expect(labels).toMatch(/\.length\(\)/)
    expect(labels).toMatch(/\.filter\(\)/)
  })

  test('DAG layout renders nodes + edges', async ({ page }) => {
    await setup(page)
    await page.waitForTimeout(50)   // allow the auto-fit rAF inside renderDag
    const dag = await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      return {
        canvasExists: !!root.querySelector('.dag-canvas'),
        nodes:        root.querySelectorAll('.dnode').length,
        edges:        root.querySelectorAll('.dag-edges path').length,
        toolBtns:     Array.from(root.querySelectorAll('.dag-tools button')).map((b: any) => b.textContent),
      }
    })
    expect(dag.canvasExists).toBe(true)
    expect(dag.nodes).toBeGreaterThan(0)
    expect(dag.edges).toBeGreaterThan(0)
    expect(dag.toolBtns).toEqual(expect.arrayContaining(['⛶', '1:1', '+', '−']))
  })
})

test.describe('devtools panel — inspector', () => {
  test('clicking a Tree node opens inspector with all four cards', async ({ page }) => {
    await setup(page)
    await switchToTree(page)
    await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      const row = root.querySelector('.tnode-row') as any
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    const cards = await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      const inspectorOpen = !root.querySelector('.inspector').hidden
      return {
        inspectorOpen,
        title: root.querySelector('.insp-title')?.textContent,
        cardTitles: Array.from(root.querySelectorAll('.insp-card .card-title'))
          .map((e: any) => e.textContent),
        boundHeader: root.querySelector('.bound-section .bound-title')?.textContent,
      }
    })
    expect(cards.inspectorOpen).toBe(true)
    expect(cards.title).toContain('<root>')
    expect(cards.cardTitles).toEqual(['IDENTITY', 'CURRENT VALUE', 'CONNECTIONS', 'ACTIVITY'])
    expect(cards.boundHeader).toBe('Bound DOM')
  })

  test('Inspect tab shows live value and refreshes on mutation', async ({ page }) => {
    await setup(page)
    await switchToTree(page)
    await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      ;(root.querySelector('.tnode-row') as any).click()
    })
    const v1 = await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      return root.querySelector('.insp-card-value .card-value')?.textContent
    })
    expect(v1).toContain('a:')
    await page.evaluate(() => { (window as any).items.a.completed = true })
    await page.waitForTimeout(50)
    const recent = await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      return root.querySelector('.insp-card-activity .card-stat')?.textContent || ''
    })
    expect(recent).toMatch(/\d+ event/)
  })

  test('Esc closes the inspector', async ({ page }) => {
    await setup(page)
    await switchToTree(page)
    await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      ;(root.querySelector('.tnode-row') as any).click()
    })
    let open = await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      return !(root.querySelector('.inspector') as any).hidden
    })
    expect(open).toBe(true)
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    open = await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      return !(root.querySelector('.inspector') as any).hidden
    })
    expect(open).toBe(false)
  })
})

test.describe('devtools panel — events tab', () => {
  test('Events tab on scalar view (length) shows sparkline + transitions on mutation', async ({ page }) => {
    await setup(page)
    await switchToTree(page)
    await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      const rows = Array.from(root.querySelectorAll('.tnode-row')) as any[]
      const lengthRow = rows.find((r: any) => (r.querySelector('.name')?.textContent || '').includes('.length()'))
      if (!lengthRow) throw new Error('no .length() row found')
      lengthRow.click()
      const tab = Array.from(root.querySelectorAll('.insp-tabs button')).find((b: any) => b.textContent === 'events') as any
      tab.click()
    })
    await page.evaluate(() => {
      const w: any = window
      w.items.a.completed = !w.items.a.completed
      w.items.b.completed = !w.items.b.completed
      w.items.a.completed = !w.items.a.completed
    })
    await page.waitForTimeout(1100)
    const state = await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      return {
        debug: root.querySelector('.ev-debug')?.textContent || '',
        cardCount: root.querySelectorAll('.ev-card').length,
        ctlBtns: Array.from(root.querySelectorAll('.ev-controls button')).map((b: any) => b.textContent),
      }
    })
    expect(state.cardCount).toBeGreaterThanOrEqual(1)
    expect(state.ctlBtns[0]).toMatch(/pause/)
    expect(state.ctlBtns[1]).toMatch(/clear/)
    expect(state.debug).toMatch(/[1-9]\d*\s*events/)
  })

  test('pause button actually pauses UI updates', async ({ page }) => {
    await setup(page)
    await switchToTree(page)
    await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      ;(root.querySelector('.tnode-row') as any).click()
      const tab = Array.from(root.querySelectorAll('.insp-tabs button')).find((b: any) => b.textContent === 'events') as any
      tab.click()
    })
    await page.waitForTimeout(50)
    await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      const playBtn = root.querySelectorAll('.ev-controls button')[0] as any
      playBtn.click()
    })
    const before = await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      return root.querySelector('.ev-debug')?.textContent || ''
    })
    await page.evaluate(() => {
      const w: any = window
      for (let i = 0; i < 5; i++) w.items.a.completed = !w.items.a.completed
    })
    await page.waitForTimeout(1200)
    const after = await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      return root.querySelector('.ev-debug')?.textContent || ''
    })
    expect(after).toBe(before)
  })

  test('ring buffer survives overflow without dropping events on the events tab', async ({ page }) => {
    await setup(page)
    await switchToTree(page)
    await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      ;(root.querySelector('.tnode-row') as any).click()
      const tab = Array.from(root.querySelectorAll('.insp-tabs button')).find((b: any) => b.textContent === 'events') as any
      tab.click()
    })
    await page.waitForTimeout(50)
    await page.evaluate(() => {
      const w: any = window
      for (let i = 0; i < 700; i++) w.items.a.completed = !w.items.a.completed
    })
    await page.waitForTimeout(1200)
    const dbg = await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      return root.querySelector('.ev-debug')?.textContent || ''
    })
    const m = dbg.match(/(\d+)\s*events/)
    expect(m, `debug badge: ${dbg}`).toBeTruthy()
    const count = parseInt(m![1], 10)
    expect(count).toBeGreaterThanOrEqual(700)
  })
})

test.describe('devtools panel — profile tab', () => {
  test('Profile tab starts/stops and tabulates operator calls', async ({ page }) => {
    await setup(page)
    await switchToTree(page)
    await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      ;(root.querySelector('.tnode-row') as any).click()
      const tab = Array.from(root.querySelectorAll('.insp-tabs button')).find((b: any) => b.textContent === 'profile') as any
      tab.click()
    })
    await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      const playBtn = root.querySelectorAll('.ev-controls button')[0] as any
      playBtn.click()
    })
    await page.evaluate(() => {
      const w: any = window
      for (let i = 0; i < 20; i++) w.items.a.completed = !w.items.a.completed
    })
    await page.waitForTimeout(600)
    const running = await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      return {
        rows: root.querySelectorAll('table.prof tbody tr').length,
        status: root.querySelector('.ev-controls .muted')?.textContent || '',
      }
    })
    expect(running.rows).toBeGreaterThan(0)
    expect(running.status).toMatch(/events:|recording/)
    await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      const playBtn = root.querySelectorAll('.ev-controls button')[0] as any
      playBtn.click()
    })
    const stopped = await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      return {
        btn:    (root.querySelectorAll('.ev-controls button')[0] as any).textContent,
        status: root.querySelector('.ev-controls .muted')?.textContent || '',
      }
    })
    expect(stopped.btn).toMatch(/start/)
    expect(stopped.status).toMatch(/stopped/)
  })
})

test.describe('devtools panel — DOM picker + alt-hover', () => {
  test('picker arms, click on bound element opens inspector at that view', async ({ page }) => {
    await setup(page)
    await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      const btns = root.querySelectorAll('.dock-header .tools button')
      ;(btns[1] as any).click()
    })
    await page.evaluate(() => {
      const li = document.querySelector('.todo-list li') as any
      li.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await page.waitForTimeout(50)
    const insp = await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      return {
        open:  !(root.querySelector('.inspector') as any).hidden,
        title: root.querySelector('.insp-title')?.textContent || '',
      }
    })
    expect(insp.open).toBe(true)
    expect(insp.title.length).toBeGreaterThan(0)
  })

  test('alt-hover adds badge layer and outlines bound elements', async ({ page }) => {
    await setup(page)
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt' }))
    })
    await page.evaluate(() => {
      const li = document.querySelector('.todo-list li') as any
      const r = li.getBoundingClientRect()
      const ev = new MouseEvent('mousemove', {
        bubbles: true, cancelable: true,
        clientX: r.left + 5, clientY: r.top + 5,
      })
      Object.defineProperty(ev, 'altKey', { value: true })
      li.dispatchEvent(ev)
    })
    await page.waitForTimeout(50)
    const outlined = await page.evaluate(() => ({
      outlines: document.querySelectorAll('.__rp_alt_outline').length,
      badges:   document.querySelectorAll('.__rp_alt_badge').length,
      popVisible: !(document.querySelector('.__rp_alt_pop') as any)?.hidden,
    }))
    expect(outlined.outlines).toBeGreaterThan(0)
    expect(outlined.badges).toBeGreaterThan(0)
    expect(outlined.popVisible).toBe(true)
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' }))
    })
    await page.waitForTimeout(50)
    const cleared = await page.evaluate(() => ({
      outlines: document.querySelectorAll('.__rp_alt_outline').length,
    }))
    expect(cleared.outlines).toBe(0)
  })
})

test.describe('devtools panel — close button', () => {
  test('tears down host, listeners, and trace subscription', async ({ page }) => {
    await setup(page)
    await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const root = dt.$.devtools.panel.shell.root
      const btns = root.querySelectorAll('.dock-header .tools button')
      ;(btns[btns.length - 1] as any).click()
    })
    await page.waitForTimeout(50)
    const after = await page.evaluate(() => ({
      host:    document.querySelectorAll('.__ripple_panel_host').length,
      altLyr:  document.querySelectorAll('.__rp_alt_layer').length,
      altPop:  document.querySelectorAll('.__rp_alt_pop').length,
    }))
    expect(after.host).toBe(0)
    expect(after.altLyr).toBe(0)
    expect(after.altPop).toBe(0)
    const err = await page.evaluate(() => {
      try { (window as any).items.a.completed = false; return null }
      catch (e: any) { return e.message }
    })
    expect(err).toBe(null)
  })
})

test.describe('devtools panel — re-open after close (#51)', () => {
  test('close then open() mounts a FRESH panel, not the dead shell', async ({ page }) => {
    await setup(page)
    // click close
    await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const btns = dt.$.devtools.panel.shell.root.querySelectorAll('.dock-header .tools button')
      ;(btns[btns.length - 1] as any).click()
    })
    await page.waitForTimeout(50)
    expect(await page.evaluate(() => document.querySelectorAll('.__ripple_panel_host').length)).toBe(0)
    // re-open — must build a new panel (the module `current` was cleared)
    const reopened = await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      const shell = dt.$.devtools.panel.open?.((window as any).items)
      return {
        hosts: document.querySelectorAll('.__ripple_panel_host').length,
        hasDock: !!(shell && shell.root && shell.root.querySelector('.dock')),
      }
    })
    expect(reopened.hosts).toBe(1)      // a fresh panel mounted (was 0 — dead shell returned)
    expect(reopened.hasDock).toBe(true)
  })
})

test.describe('devtools panel — Alt-hover popover escaping (#73)', () => {
  test('a malicious key/value does not inject markup into the popover', async ({ page }) => {
    // Seed a row whose id and title carry HTML — the popover interpolates the
    // key path and the formatted value, both app/user-controlled.
    await page.addInitScript(() => {
      localStorage.setItem('todos-ripple-jsx', JSON.stringify({
        '<img src=x onerror=window.__xss=1>': { title: '<b>boom</b>', completed: false },
      }))
    })
    await page.goto('/examples/todo-jsx/?devtools')
    await page.waitForSelector('.todo-list li', { timeout: 10_000 })
    await page.waitForFunction(async () => {
      const dt: any = await import('data/devtools')
      return dt.$?.devtools?.panel?.shell?.root?.querySelector('.dock')
    }, { timeout: 10_000 })
    // Build a popover for the row's bound element directly via the panel API path:
    const result = await page.evaluate(async () => {
      const dt: any = await import('data/devtools')
      // arm alt-hover and synthesize a popover over a bound li
      const li = document.querySelector('.todo-list li') as any
      // dispatch an Alt-hover by simulating the alt key + mousemove the panel listens for
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true }))
      li?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5, altKey: true }))
      await new Promise((r: any) => setTimeout(r, 60))
      const pop = document.querySelector('.__rp_alt_pop') as any
      return {
        xss: !!(window as any).__xss,
        // no live <img>/<b> element injected — escaped to text
        imgs: pop ? pop.querySelectorAll('img').length : 0,
        bolds: pop ? pop.querySelectorAll('b').length : 0,
      }
    })
    expect(result.xss).toBeFalsy()       // onerror never executed
    expect(result.imgs).toBe(0)
    expect(result.bolds).toBe(0)
  })
})
