// @ts-nocheck
import { test, expect } from '@playwright/test'

// Smoke test for the million-row data grid example (examples/datagrid/).
//
// Proves the grid mounts over 1,000,000 rows, virtualizes (only a few dozen DOM
// rows exist and the window moves on deep scroll), filters down the view, and
// that the library's global aggregate footer carries live numbers — all with no
// console errors. Generous timeout: generating 1M rows + lib aggregate setup
// runs once on load behind the splash.

const URL = '/examples/datagrid/'

test('datagrid — virtualizes, filters, and aggregates a million rows', async ({ page }) => {
  test.setTimeout(60_000)
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

  await page.goto(URL, { timeout: 40_000 })
  await page.waitForSelector('.dgrows > div', { timeout: 25_000 })

  // virtualization: only a window of rows is in the DOM, not a million
  const rowCount = await page.locator('.dgrows > div').count()
  expect(rowCount).toBeGreaterThan(10)
  expect(rowCount).toBeLessThan(120)
  await expect(page.locator('.dgshownv')).toHaveText('1,000,000')

  // footer aggregates carry real numbers (Σ value, avg price, gainers)
  for (const fv of await page.locator('.dgfoot .fv').all()) await expect(fv).toHaveText(/\d/)

  // deep scroll moves the window to a far-down row id
  const firstBefore = await page.locator('.dgrows > div').first().locator('.cidx').textContent()
  await page.locator('.dgviewport').evaluate(el => { el.scrollTop = 400_000 })
  await page.waitForTimeout(150)
  const firstAfter = await page.locator('.dgrows > div').first().locator('.cidx').textContent()
  expect(firstAfter).not.toBe(firstBefore)

  // filtering by sector shrinks the view below the full million
  await page.selectOption('.dgsel', 'Tech')
  await expect(page.locator('.dgshownv')).not.toHaveText('1,000,000', { timeout: 5_000 })

  expect(errors, errors.join('\n')).toHaveLength(0)
})
