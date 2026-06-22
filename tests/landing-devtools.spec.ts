// Smoke test for the devtools mount on the landing page.
//
// History: this used to assert a STATIC `.dock-mock` marketing mockup mirrored
// the live panel's shape. The v2 landing redesign (commit e28460e) deleted that
// mockup and replaced it with a real, lazily-mounted panel — the
// `#devtools-mount` button dynamically imports `data/devtools` and calls
// `$.devtools.panel.open()` on the `$` the page already got from `data/full`.
// So the old mockup-drift assertion was dead; this spec now exercises the
// actual mount path users hit.
//
// That path is the cross-bundle case C6 closed: `feed.js` imports `$` from
// `data/full` (dist/full.js), the button imports `data/devtools`
// (dist/devtools/index.js) — two SEPARATE tsup bundles. Before the
// Symbol.for/globalThis singleton fix, `data/devtools` attached `.devtools` to
// its own `$`, so `$.devtools?.panel?.open?.()` on the page's `$` silently
// no-opped and no panel ever appeared. This is the browser-level regression
// guard for that fix; the panel's internal shape is covered exhaustively by
// devtools-panel.spec.ts.
import { test, expect } from '@playwright/test'

// Wait until the panel has fully mounted: shell ref non-null AND its shadow
// dock exists. Mirrors devtools-panel.spec's waitForPanel.
const waitForPanel = async (page: any) => {
  await page.waitForFunction(async () => {
    const dt: any = await import('data/devtools')
    const shell = dt.$?.devtools?.panel?.shell
    return shell && shell.root && shell.root.querySelector('.dock')
  }, { timeout: 10_000 })
}

test('landing page mounts the live devtools panel (cross-bundle C6)', async ({ page }) => {
  await page.goto('/')
  // The button is static HTML; clicking it triggers the lazy import + open().
  await page.click('#devtools-mount')
  await waitForPanel(page)

  const state = await page.evaluate(async () => {
    const dt: any = await import('data/devtools')
    const shell = dt.$.devtools.panel.shell
    return {
      // The page's $ (from data/full) and the devtools bundle's $ must be the
      // same object for .devtools.panel to exist at all — this is the C6 fact.
      sharedDollar: dt.$ === (globalThis as any)[Symbol.for('data.$')],
      hostInDom:    !!document.querySelector('.__ripple_panel_host'),
      shadowClosed: shell.host.shadowRoot === null,
      brand:        shell.root.querySelector('.brand')?.textContent,
      layoutBtns:   Array.from(shell.root.querySelectorAll('.seg button')).map((b: any) => b.textContent),
      tabBtns:      Array.from(shell.root.querySelectorAll('.insp-tabs button')).map((b: any) => b.textContent),
      status:       document.querySelector('#devtools-status')?.textContent || '',
    }
  })

  // Mount actually happened (the cross-bundle call resolved, not a silent no-op).
  expect(state.hostInDom).toBe(true)
  expect(state.shadowClosed).toBe(true)
  expect(state.brand).toContain('devtools')
  // Same panel shape the live-panel spec pins, asserted here against the
  // landing page's own mount.
  expect(state.layoutBtns).toEqual(['Tree', 'DAG'])
  expect(state.tabBtns).toEqual(['inspect', 'events', 'profile'])
  // The landing button's success wiring ran through.
  expect(state.status.toLowerCase()).toContain('mounted')
})
