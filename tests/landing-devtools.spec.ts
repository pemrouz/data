// @ts-nocheck
// Smoke test for the devtools section of the landing page. The static
// mockup at index.html mirrors the live panel's shape — three tabs labelled
// inspect/events/profile, a Tree/DAG layout segment, a DAG graph pane with
// →N chips on its nodes, a card stack on the inspector. If the panel's tab
// names or toolbar shape change, this catches the mockup drifting away.
//
// Lives next to the devtools-panel spec because the same memory anchor
// applies: any panel change that affects the marketing mockup should fail
// this and force an update.
import { test, expect } from '@playwright/test'

test('landing devtools mockup matches the new panel shape', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('.dock-mock', { timeout: 10_000 })

  const state = await page.evaluate(() => {
    const dock = document.querySelector('.dock-mock')!
    const tabs = Array.from(dock.querySelectorAll('.dock-mock-tab')).map((t) => t.textContent?.trim())
    const layouts = Array.from(dock.querySelectorAll('.dock-mock-seg-btn')).map((b) => b.textContent?.trim())
    const dagActive = !!dock.querySelector('.dock-mock-seg-btn.dock-mock-seg-active')?.textContent?.includes('DAG')
    const dnodes = dock.querySelectorAll('.dock-mock-dnode').length
    const edges = dock.querySelectorAll('.dock-mock-edges path').length
    const chips = Array.from(dock.querySelectorAll('.dock-mock-chip')).map((c) => c.textContent?.trim())
    const cardTitles = Array.from(dock.querySelectorAll('.dock-pane-inspect .dock-mock-card-title'))
      .map((t) => (t.firstChild?.textContent || t.textContent || '').trim())
    return { tabs, layouts, dagActive, dnodes, edges, chips, cardTitles }
  })

  // Tabs must be the three-tab inspector layout — not the legacy
  // graph/events/profile (no separate Graph tab; the graph is the left pane).
  expect(state.tabs).toEqual(['inspect', 'events', 'profile'])
  // Layout segment exists with DAG as default.
  expect(state.layouts).toEqual(['Tree', 'DAG'])
  expect(state.dagActive).toBe(true)
  // Static DAG graph: at least the root + a couple of operator nodes + a
  // DOM-sink-ish terminal, plus edges between them.
  expect(state.dnodes).toBeGreaterThanOrEqual(4)
  expect(state.edges).toBeGreaterThanOrEqual(2)
  // At least one →N chip on a node.
  expect(state.chips.some((c) => /^→\d+$/.test(c || ''))).toBe(true)
  // Inspect tab shows the four canonical cards.
  expect(state.cardTitles).toEqual(['IDENTITY', 'CURRENT VALUE', 'CONNECTIONS', 'ACTIVITY'])
})
