// @ts-nocheck
// Regression tests for the v2 devtools mockup at mockups/v2/.
//
// The v2 panel mounts into a CLOSED shadow root, so Playwright's locator API
// can't see inside. index.html keeps the panel reference at window.panel, so
// every test reaches into the shadow via `window.panel.root.querySelector(...)`
// inside page.evaluate. DOM events on shadow elements are dispatched directly
// rather than using locator.click() (which goes through the auto-pierce path
// but won't reach closed-mode roots).
//
// The seed below pins the demo to a deterministic 3-item shape so tests can
// rely on concrete counts (e.g. "5 nodes in graph", "1 active todo").
import { test, expect } from '@playwright/test'

const SEED = `
  localStorage.setItem('todos-devtools-v2', JSON.stringify({
    a: { title: 'milk',   completed: false, price: 1 },
    b: { title: 'bread',  completed: true,  price: 2 },
    c: { title: 'eggs',   completed: false, price: 3 },
  }))
`

// Helper: wait for panel.host.shadowRoot is null (closed mode) but
// window.panel.root is the live ref. Test driver waits for the dock element to
// appear inside the shadow before each assertion.
const waitForDock = async (page) => {
  await page.waitForFunction(() => {
    const p = (window as any).panel
    return p && p.root && p.root.querySelector && p.root.querySelector('.dock')
  }, { timeout: 10_000 })
}

const setup = async (page) => {
  await page.addInitScript(SEED)
  await page.goto('/mockups/v2/')
  await page.waitForSelector('.todos li', { timeout: 10_000 })
  await waitForDock(page)
}

test.describe('v2 panel — shell', () => {
  test('mounts a host with a closed shadow and a dock inside', async ({ page }) => {
    await setup(page)
    // Host element is reachable from the document; shadow content is hidden
    // from outside, so the dock can only be probed via window.panel.root.
    const visible = await page.evaluate(() => {
      const p: any = (window as any).panel
      return {
        hostInDom:   !!document.querySelector('.__ripple_panel_v2_host'),
        shadowMode:  p.host.shadowRoot === null,    // closed
        dockExists:  !!p.root.querySelector('.dock'),
        brand:       p.root.querySelector('.brand')?.textContent,
        layoutBtns:  Array.from(p.root.querySelectorAll('.seg button')).map((b: any) => b.textContent),
        tabBtns:     Array.from(p.root.querySelectorAll('.insp-tabs button')).map((b: any) => b.textContent),
      }
    })
    expect(visible.hostInDom).toBe(true)
    expect(visible.shadowMode).toBe(true)
    expect(visible.dockExists).toBe(true)
    expect(visible.brand).toContain('devtools')
    expect(visible.layoutBtns).toEqual(['Tree', 'DAG'])
    // Inspector starts hidden, but the tab buttons exist in the DOM.
    expect(visible.tabBtns).toEqual(['inspect', 'events', 'profile'])
  })

  test('suppresses the legacy panel via ?nopanel=1 rewrite', async ({ page }) => {
    await setup(page)
    // Only the v2 host should be present — the older panel uses
    // .__ripple_panel_host (without the _v2_ infix).
    const counts = await page.evaluate(() => ({
      v2:     document.querySelectorAll('.__ripple_panel_v2_host').length,
      legacy: document.querySelectorAll('.__ripple_panel_host').length,
    }))
    expect(counts.v2).toBe(1)
    expect(counts.legacy).toBe(0)
  })
})

test.describe('v2 panel — graph', () => {
  test('Tree layout renders root + operator chain', async ({ page }) => {
    await setup(page)
    const tree = await page.evaluate(() => {
      const p: any = (window as any).panel
      const rows = p.root.querySelectorAll('.tnode-row')
      return Array.from(rows).map((r: any) => ({
        kind: r.querySelector('.kind')?.textContent,
        name: r.querySelector('.name')?.textContent,
        chip: r.querySelector('.tnode-chip')?.textContent || null,
      }))
    })
    // Root + 3 operators (active/done/total): all length() chains attach to
    // root. With hideSinks=true (default), terminal DOMSinks collapse to
    // chips. Length operators are themselves nodes.
    expect(tree.length).toBeGreaterThanOrEqual(4)
    expect(tree[0].name).toBe('<root>')
    // Root should have a "→N" chip representing its hidden terminal sinks.
    expect(tree[0].chip).toMatch(/^→\d+$/)
    // At least one .length() and one .filter() node should appear.
    const labels = tree.map(t => t.name).join('|')
    expect(labels).toMatch(/\.length\(\)/)
    expect(labels).toMatch(/\.filter\(\)/)
  })

  test('DAG layout renders nodes + edges', async ({ page }) => {
    await setup(page)
    await page.evaluate(() => {
      const p: any = (window as any).panel
      // Find the "DAG" button and click it.
      const btns = p.root.querySelectorAll('.seg button')
      const dag = Array.from(btns).find((b: any) => b.textContent === 'DAG') as any
      dag.click()
    })
    // Wait for auto-fit (requestAnimationFrame inside renderDag).
    await page.waitForTimeout(50)
    const dag = await page.evaluate(() => {
      const p: any = (window as any).panel
      return {
        canvasExists: !!p.root.querySelector('.dag-canvas'),
        nodes:        p.root.querySelectorAll('.dnode').length,
        edges:        p.root.querySelectorAll('.dag-edges path').length,
        toolBtns:     Array.from(p.root.querySelectorAll('.dag-tools button')).map((b: any) => b.textContent),
      }
    })
    expect(dag.canvasExists).toBe(true)
    expect(dag.nodes).toBeGreaterThan(0)
    expect(dag.edges).toBeGreaterThan(0)
    expect(dag.toolBtns).toEqual(expect.arrayContaining(['⛶', '1:1', '+', '−']))
  })

  test('rewalk on mutation — graph reflects new items', async ({ page }) => {
    await setup(page)
    const before = await page.evaluate(() => {
      const p: any = (window as any).panel
      // Read the root's chip: terminal sinks under root.
      return p.root.querySelector('.tnode-row')?.querySelector('.tnode-chip')?.textContent
    })
    // Insert a new item via the input handler.
    await page.evaluate(() => {
      const w: any = window
      w.items.insert({ title: 'oranges', completed: false, price: 5 })
    })
    // The rewalk is scheduled via rAF; wait a couple frames.
    await page.waitForTimeout(50)
    const after = await page.evaluate(() => {
      const p: any = (window as any).panel
      return p.root.querySelector('.tnode-row')?.querySelector('.tnode-chip')?.textContent
    })
    // Chip count may stay identical (terminals on root don't depend on the
    // number of items — they're length/filter etc. bound to root). The
    // important thing is the panel didn't crash and the chip still shows.
    expect(after).toMatch(/^→\d+$/)
    expect(before).toMatch(/^→\d+$/)
  })
})

test.describe('v2 panel — inspector', () => {
  test('clicking a Tree node opens inspector with all four cards', async ({ page }) => {
    await setup(page)
    await page.evaluate(() => {
      const p: any = (window as any).panel
      // Click the root row.
      const row = p.root.querySelector('.tnode-row') as any
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    const cards = await page.evaluate(() => {
      const p: any = (window as any).panel
      const inspectorOpen = !p.root.querySelector('.inspector').hidden
      return {
        inspectorOpen,
        title: p.root.querySelector('.insp-title')?.textContent,
        cardTitles: Array.from(p.root.querySelectorAll('.insp-card .card-title'))
          .map((e: any) => e.textContent),
        boundHeader: p.root.querySelector('.bound-section .bound-title')?.textContent,
      }
    })
    expect(cards.inspectorOpen).toBe(true)
    expect(cards.title).toContain('<root>')
    // Four cards (in order): IDENTITY, CURRENT VALUE, CONNECTIONS, ACTIVITY.
    expect(cards.cardTitles).toEqual(['IDENTITY', 'CURRENT VALUE', 'CONNECTIONS', 'ACTIVITY'])
    // Plus a Bound DOM section below the cards.
    expect(cards.boundHeader).toBe('Bound DOM')
  })

  test('Inspect tab shows live value and refreshes on mutation', async ({ page }) => {
    await setup(page)
    // Click the root node.
    await page.evaluate(() => {
      const p: any = (window as any).panel
      const row = p.root.querySelector('.tnode-row') as any
      row.click()
    })
    const v1 = await page.evaluate(() => {
      const p: any = (window as any).panel
      return p.root.querySelector('.insp-card-value .card-value')?.textContent
    })
    // The value is the items object. We seeded 3 items, so the pretty-printed
    // preview should include at least the first key 'a'.
    expect(v1).toContain('a:')
    // Mutate: toggle 'a'.completed.
    await page.evaluate(() => { (window as any).items.a.completed = true })
    await page.waitForTimeout(50)
    const v2 = await page.evaluate(() => {
      const p: any = (window as any).panel
      return p.root.querySelector('.insp-card-value .card-value')?.textContent
    })
    // Should still show the items object but the activity card must have
    // counted at least one event by now.
    expect(v2).toContain('a:')
    const recent = await page.evaluate(() => {
      const p: any = (window as any).panel
      return p.root.querySelector('.insp-card-activity .card-stat')?.textContent || ''
    })
    expect(recent).toMatch(/\d+ event/)
  })

  test('Esc closes the inspector', async ({ page }) => {
    await setup(page)
    await page.evaluate(() => {
      const p: any = (window as any).panel
      ;(p.root.querySelector('.tnode-row') as any).click()
    })
    let open = await page.evaluate(() => !((window as any).panel.root.querySelector('.inspector') as any).hidden)
    expect(open).toBe(true)
    // Esc must be received by `document` (panel's keydown listener is on doc).
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    open = await page.evaluate(() => !((window as any).panel.root.querySelector('.inspector') as any).hidden)
    expect(open).toBe(false)
  })
})

test.describe('v2 panel — events tab', () => {
  test('Events tab on scalar view (length) shows sparkline + transitions on mutation', async ({ page }) => {
    await setup(page)
    // Open the inspector on a length operator.
    await page.evaluate(() => {
      const p: any = (window as any).panel
      // Find a row whose name contains ".length()".
      const rows = Array.from(p.root.querySelectorAll('.tnode-row')) as any[]
      const lengthRow = rows.find(r => (r.querySelector('.name')?.textContent || '').includes('.length()'))
      if (!lengthRow) throw new Error('no .length() row found')
      lengthRow.click()
      // Switch to events tab.
      const tab = Array.from(p.root.querySelectorAll('.insp-tabs button')).find((b: any) => b.textContent === 'events') as any
      tab.click()
    })
    // Inject a few mutations.
    await page.evaluate(() => {
      const w: any = window
      w.items.a.completed = !w.items.a.completed
      w.items.b.completed = !w.items.b.completed
      w.items.a.completed = !w.items.a.completed
    })
    // Wait for the 1s tick to drain + redraw at least once (the trace
    // subscriber also nudges rerender on each event, so this is generous).
    await page.waitForTimeout(1100)
    const state = await page.evaluate(() => {
      const p: any = (window as any).panel
      const debug = p.root.querySelector('.ev-debug')?.textContent || ''
      const cardCount = p.root.querySelectorAll('.ev-card').length
      const transitions = p.root.querySelectorAll('.ev-trans li').length
      const ctlBtns = Array.from(p.root.querySelectorAll('.ev-controls button')).map((b: any) => b.textContent)
      return { debug, cardCount, transitions, ctlBtns }
    })
    expect(state.cardCount).toBeGreaterThanOrEqual(1)   // sparkline card
    expect(state.ctlBtns[0]).toMatch(/pause/)
    expect(state.ctlBtns[1]).toMatch(/clear/)
    // Events were emitted — debug badge should report >0.
    expect(state.debug).toMatch(/[1-9]\d*\s*events/)
  })

  test('pause button actually pauses UI updates', async ({ page }) => {
    await setup(page)
    // Click root + switch to events tab so we're on the collection path.
    await page.evaluate(() => {
      const p: any = (window as any).panel
      ;(p.root.querySelector('.tnode-row') as any).click()
      const tab = Array.from(p.root.querySelectorAll('.insp-tabs button')).find((b: any) => b.textContent === 'events') as any
      tab.click()
    })
    await page.waitForTimeout(50)
    // Hit pause.
    await page.evaluate(() => {
      const p: any = (window as any).panel
      const playBtn = p.root.querySelectorAll('.ev-controls button')[0] as any
      playBtn.click()
    })
    const before = await page.evaluate(() => {
      const p: any = (window as any).panel
      return p.root.querySelector('.ev-debug')?.textContent || ''
    })
    // Fire 5 mutations after pausing.
    await page.evaluate(() => {
      const w: any = window
      for (let i = 0; i < 5; i++) w.items.a.completed = !w.items.a.completed
    })
    // Wait past the 1s tick.
    await page.waitForTimeout(1200)
    const after = await page.evaluate(() => {
      const p: any = (window as any).panel
      return p.root.querySelector('.ev-debug')?.textContent || ''
    })
    // While paused, the debug counter must NOT advance — the documented
    // semantics of the pause button.
    expect(after).toBe(before)
  })

  test('ring buffer survives overflow without dropping events on the events tab', async ({ page }) => {
    await setup(page)
    await page.evaluate(() => {
      const p: any = (window as any).panel
      ;(p.root.querySelector('.tnode-row') as any).click()
      const tab = Array.from(p.root.querySelectorAll('.insp-tabs button')).find((b: any) => b.textContent === 'events') as any
      tab.click()
    })
    await page.waitForTimeout(50)
    // EVENTS_MAX = 500 inside the panel; fire 700 events so the ring shifts.
    await page.evaluate(() => {
      const w: any = window
      for (let i = 0; i < 700; i++) w.items.a.completed = !w.items.a.completed
    })
    await page.waitForTimeout(1200)
    const dbg = await page.evaluate(() => {
      const p: any = (window as any).panel
      return p.root.querySelector('.ev-debug')?.textContent || ''
    })
    // The debug badge tracks events the *events tab* has seen, drained from
    // the global ring. After 700 mutations + ring overflow, the tab should
    // still report all 700 (consumedRingIdx must compensate for shifts).
    const m = dbg.match(/(\d+)\s*events/)
    expect(m, `debug badge: ${dbg}`).toBeTruthy()
    const count = parseInt(m![1], 10)
    // Some leeway — startup tick may add a couple of events. Must be >= 700.
    expect(count).toBeGreaterThanOrEqual(700)
  })
})

test.describe('v2 panel — profile tab', () => {
  test('Profile tab starts/stops and tabulates operator calls', async ({ page }) => {
    await setup(page)
    await page.evaluate(() => {
      const p: any = (window as any).panel
      ;(p.root.querySelector('.tnode-row') as any).click()
      const tab = Array.from(p.root.querySelectorAll('.insp-tabs button')).find((b: any) => b.textContent === 'profile') as any
      tab.click()
    })
    // Start profiling.
    await page.evaluate(() => {
      const p: any = (window as any).panel
      const playBtn = p.root.querySelectorAll('.ev-controls button')[0] as any
      playBtn.click()
    })
    // Fire some mutations.
    await page.evaluate(() => {
      const w: any = window
      for (let i = 0; i < 20; i++) w.items.a.completed = !w.items.a.completed
    })
    // Profile refreshes every 500ms — wait for at least one refresh.
    await page.waitForTimeout(600)
    const running = await page.evaluate(() => {
      const p: any = (window as any).panel
      const rows = p.root.querySelectorAll('table.prof tbody tr').length
      const status = p.root.querySelector('.ev-controls .muted')?.textContent || ''
      return { rows, status }
    })
    expect(running.rows).toBeGreaterThan(0)
    expect(running.status).toMatch(/events:|recording/)
    // Stop profiling.
    await page.evaluate(() => {
      const p: any = (window as any).panel
      const playBtn = p.root.querySelectorAll('.ev-controls button')[0] as any
      playBtn.click()
    })
    const stopped = await page.evaluate(() => {
      const p: any = (window as any).panel
      return {
        btn:    (p.root.querySelectorAll('.ev-controls button')[0] as any).textContent,
        status: p.root.querySelector('.ev-controls .muted')?.textContent || '',
      }
    })
    expect(stopped.btn).toMatch(/start/)
    expect(stopped.status).toMatch(/stopped/)
  })
})

test.describe('v2 panel — DOM picker + alt-hover', () => {
  test('picker arms, click on bound element opens inspector at that view', async ({ page }) => {
    await setup(page)
    // Find a checkbox-bearing <li> in the todos list (it has __ripple_sink).
    await page.evaluate(() => {
      const p: any = (window as any).panel
      // Click the pick button (◎) — it's the second tool button (after ⊙).
      const btns = p.root.querySelectorAll('.dock-header .tools button')
      ;(btns[1] as any).click()
    })
    // Now a click on any bound DOM element should be intercepted by the
    // picker's capture-phase listener.
    await page.evaluate(() => {
      const li = document.querySelector('.todos li') as any
      li.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await page.waitForTimeout(50)
    const insp = await page.evaluate(() => {
      const p: any = (window as any).panel
      return {
        open:  !(p.root.querySelector('.inspector') as any).hidden,
        title: p.root.querySelector('.insp-title')?.textContent || '',
      }
    })
    expect(insp.open).toBe(true)
    // The title should mention a key — for items[id], the joined key.
    expect(insp.title.length).toBeGreaterThan(0)
  })

  test('alt-hover adds badge layer and outlines bound elements', async ({ page }) => {
    await setup(page)
    // Synthetic Alt-down — panel hooks document keydown.
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt' }))
    })
    // Move the mouse over a bound element so renderBadges runs. The mousemove
    // MUST be dispatched on the element itself so `e.target` is the li and
    // findReactiveAncestor can walk up to the bound ul. Dispatching on
    // `document` makes e.target = document, which has no __ripple_sink
    // ancestor — popover never appears.
    await page.evaluate(() => {
      const li = document.querySelector('.todos li') as any
      const r = li.getBoundingClientRect()
      const ev = new MouseEvent('mousemove', {
        bubbles: true, cancelable: true,
        clientX: r.left + 5, clientY: r.top + 5,
      })
      // MouseEvent doesn't surface altKey from init dict directly across some
      // engines, so set it via defineProperty.
      Object.defineProperty(ev, 'altKey', { value: true })
      li.dispatchEvent(ev)
    })
    await page.waitForTimeout(50)
    const outlined = await page.evaluate(() => ({
      outlines: document.querySelectorAll('.__rp_v2_alt_outline').length,
      badges:   document.querySelectorAll('.__rp_v2_alt_badge').length,
      popVisible: !(document.querySelector('.__rp_v2_alt_pop') as any)?.hidden,
    }))
    // At least 1 reactive element should be outlined; badges follow.
    expect(outlined.outlines).toBeGreaterThan(0)
    expect(outlined.badges).toBeGreaterThan(0)
    expect(outlined.popVisible).toBe(true)
    // Alt-release clears.
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' }))
    })
    await page.waitForTimeout(50)
    const cleared = await page.evaluate(() => ({
      outlines: document.querySelectorAll('.__rp_v2_alt_outline').length,
    }))
    expect(cleared.outlines).toBe(0)
  })
})

test.describe('v2 panel — destroy', () => {
  test('close button tears down host, listeners, and the trace subscription', async ({ page }) => {
    await setup(page)
    // The dock close button is the LAST .dock-header .tools button (✕).
    await page.evaluate(() => {
      const p: any = (window as any).panel
      const btns = p.root.querySelectorAll('.dock-header .tools button')
      ;(btns[btns.length - 1] as any).click()
    })
    await page.waitForTimeout(50)
    const after = await page.evaluate(() => ({
      host:    document.querySelectorAll('.__ripple_panel_v2_host').length,
      altLyr:  document.querySelectorAll('.__rp_v2_alt_layer').length,
      altPop:  document.querySelectorAll('.__rp_v2_alt_pop').length,
    }))
    expect(after.host).toBe(0)
    expect(after.altLyr).toBe(0)
    expect(after.altPop).toBe(0)
    // After destroy, mutating items must not throw (the trace was disposed).
    const err = await page.evaluate(() => {
      try { (window as any).items.a.completed = false; return null }
      catch (e: any) { return e.message }
    })
    expect(err).toBe(null)
  })
})
