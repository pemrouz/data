// @ts-nocheck
// Real-browser smoke for the Flame panel tab. The panel.test.ts unit suite
// already covers the click→start→mutate→stop→render path against a stubbed
// DOM; what this spec adds is proof that:
//   1. The Flame tab button is in the panel's tab strip.
//   2. setActiveTab('flame') populates shell.body with the .fl-tab subtree
//      (toolbar, list, chart). If any of the styles, the createFlameTab
//      wiring, or the lazy panel-chunk import broke, this fires.
//   3. $.cascades records propagation in a real browser — i.e. the patched
//      View.prototype + queueMicrotask coalescing behave the same way under
//      a real event loop as under node:test.
//
// We don't try to read inside the closed shadow root from the test side —
// shell holds direct refs to its DOM nodes, so all queries go through
// shell.body / shell.tabButtons inside page.evaluate.
import { test, expect } from '@playwright/test'

const seed = `
  localStorage.setItem('todos-ripple', JSON.stringify({
    1: { title: 'milk',  completed: false },
    2: { title: 'bread', completed: true  },
  }))
`

test('flame tab is present in the panel tab strip', async ({ page }) => {
  await page.addInitScript(seed)
  await page.goto('/examples/todo/?devtools')
  await page.waitForSelector('.todo-list li', { timeout: 30_000 })

  const out = await page.evaluate(async () => {
    const dt: any = await import('data/devtools')
    const shell = dt.$.devtools.panel.open()
    return {
      tabNames: Object.keys(shell.tabButtons),
      hasFlame: !!shell.tabButtons.flame,
    }
  })
  expect(out.hasFlame).toBe(true)
  expect(out.tabNames).toEqual(expect.arrayContaining(['graph', 'events', 'profile', 'flame']))
})

test('setActiveTab(flame) populates the body with .fl-tab subtree', async ({ page }) => {
  await page.addInitScript(seed)
  await page.goto('/examples/todo/?devtools')
  await page.waitForSelector('.todo-list li', { timeout: 30_000 })

  const out = await page.evaluate(async () => {
    const dt: any = await import('data/devtools')
    const shell = dt.$.devtools.panel.open()
    shell.setActiveTab('flame')
    // Walk shell.body.children to find the toolbar + list + chart.
    const find = (root: any, cls: string): any => {
      if (root.classList?.contains?.(cls)) return root
      for (const c of root.children || []) {
        const hit = find(c, cls)
        if (hit) return hit
      }
      return null
    }
    return {
      hasToolbar: !!find(shell.body, 'fl-toolbar'),
      hasList: !!find(shell.body, 'fl-list'),
      hasChart: !!find(shell.body, 'fl-chart'),
      activeTab: [...shell.tabButtons.flame.classList].includes('active'),
    }
  })
  expect(out.hasToolbar).toBe(true)
  expect(out.hasList).toBe(true)
  expect(out.hasChart).toBe(true)
  expect(out.activeTab).toBe(true)
})

test('$.cascades records a cascade in a real browser', async ({ page }) => {
  await page.addInitScript(seed)
  await page.goto('/examples/todo/?devtools')
  await page.waitForSelector('.todo-list li', { timeout: 30_000 })

  const out = await page.evaluate(async () => {
    const dt: any = await import('data/devtools')
    const $ = dt.$
    const w: any = window
    const items = w.items
    if (!items) return { ok: false, reason: 'no window.items' }
    const rec = $.cascades(items)
    items.smoke = { title: 'smoke', completed: false }
    // Yield to microtasks so the cascade closes (queueMicrotask).
    await Promise.resolve()
    const cascades = rec.stop()
    return {
      ok: true,
      cascadeCount: cascades.length,
      // First cascade should have at least one frame and a non-negative totalMs.
      framesOk: cascades.length > 0
        && cascades[0].frames.length > 0
        && cascades[0].totalMs >= 0,
      sampleVerb: cascades[0]?.frames?.[0]?.verb,
    }
  })
  expect(out.ok).toBe(true)
  expect(out.cascadeCount).toBeGreaterThan(0)
  expect(out.framesOk).toBe(true)
  // First frame should be a recognized notification verb.
  expect(['XU0','XR0','BU1','BU2','BI0','BI0A','BI2','BR1','BR1A','BR2','BMV1'])
    .toContain(out.sampleVerb)
})
