// Smoke test for the devtools mount on the landing page — v3, post-flip.
//
// History: the v2 version of this spec guarded the C6 cross-bundle regression
// (`data/full` and `data/devtools` were SEPARATE self-contained tsup bundles;
// before the Symbol.for/globalThis singleton fix, devtools attached `.devtools`
// to its own `$` and the landing button's `$.devtools?.panel?.open?.()`
// silently no-opped). The flip made `data` the v3 engine, whose devtools entry
// closes the same trap STRUCTURALLY: dist/devtools.js externalizes every
// boundary import to './index.js', so both specifiers resolve ONE url = one
// module instance, and the attach lands on the page's own `$` by construction.
// This spec asserts that end-to-end on the real button path users hit; the v3
// panel's internal shape is covered exhaustively by devtools-v3.spec.ts.
import { test, expect } from '@playwright/test'

test('landing page mounts the live v3 devtools panel (one module instance)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('/')

  // The button is static HTML; clicking it triggers the lazy import (which
  // auto-mounts the panel host) + the handler's open().
  await page.click('#devtools-mount')
  await expect(page.locator('[data-v3-devtools]')).toHaveCount(1, { timeout: 10_000 })

  const state = await page.evaluate(async () => {
    const main: any = await import('data')
    const shell = main.$?.devtools?.panel?.shell
    return {
      // the single-instance fact: the devtools attach is visible on the $ the
      // PAGE imported from 'data' (not on some second bundle's copy)
      attachedToPageDollar:
        typeof main.$?.devtools?.panel?.open === 'function' &&
        typeof main.$?.devtools?.panel?.close === 'function',
      shellLive: shell != null,
      // the injected panel sees the page's own reactive graph (the feed's
      // trades source + the operator-demo views)
      gnodes: shell ? shell.querySelectorAll('.gnode').length : -1,
      status: document.querySelector('#devtools-status')?.textContent || '',
    }
  })

  expect(state.attachedToPageDollar).toBe(true)
  expect(state.shellLive).toBe(true)
  expect(state.gnodes).toBeGreaterThan(0)
  // The landing button's success wiring ran through.
  expect(state.status.toLowerCase()).toContain('mounted')
  expect(errors).toEqual([])
})
