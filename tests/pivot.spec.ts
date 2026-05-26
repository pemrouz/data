// @ts-nocheck
import { test, expect } from '@playwright/test'

// Smoke test for the pivot table example (examples/pivot/).
//
// Proves the grid pivots a 50k-row dataset, that changing a dimension rebuilds
// to a single table (no duplicate appended), and that streaming inserts/evicts
// move the incrementally-maintained grand total — all with no console errors.

const URL = '/examples/pivot/'

test('pivot — aggregates, re-pivots on dimension change, streams', async ({ page }) => {
  test.setTimeout(40_000)
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

  await page.goto(URL, { timeout: 30_000 })
  await page.waitForSelector('.ptable', { timeout: 10_000 })

  // region (5) × quarter (4) on load
  await expect(page.locator('table.ptable')).toHaveCount(1)
  await expect(page.locator('.prow')).toHaveCount(5)
  await expect(page.locator('.pcell')).toHaveCount(20)
  await expect(page.locator('.pgrand')).toHaveText(/\d/)

  // changing the column dimension re-pivots to ONE table (no append) with new headers
  await page.selectOption('.pvctrl:has-text("cols") .psel', 'category')
  await expect(page.locator('table.ptable')).toHaveCount(1)
  await expect(page.locator('thead .ch')).toHaveCount(5)
  await expect(page.locator('.pcell')).toHaveCount(25)

  // streaming inserts/evicts move the incrementally-kept grand total
  const grand = () => page.locator('.pgrand').textContent()
  const g1 = await grand()
  await page.locator('.pvstream').click({ force: true })
  await page.waitForTimeout(700)
  const g2 = await grand()
  await page.evaluate(() => (document.querySelector('.pvstream') as HTMLButtonElement).click())
  expect(g2).not.toBe(g1)

  expect(errors, errors.join('\n')).toHaveLength(0)
})
