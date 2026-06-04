import { test, expect, type Page } from '@playwright/test'

// Smoke test for examples/pivot/ — a pivot table where every cell is a reactive
// aggregate over a `sales.group(rowField)[…].group(colField)[…].sum(measure)`
// derivation. We assert: it boots cleanly in 2-D, switching column field to
// "none" gives the 1-D table, switching the measure re-renders, streaming
// inserts lift the grand total, and shuffling regions (in-place `sale.region`
// edits, a group-rebuckets-on-BU2 path) moves the per-row totals while the
// grand total — revenue is conserved — stays put.

const grandRevenue = (page: Page) =>
  page.locator('.metrics .metric', { hasText: 'revenue' }).locator('.mval').textContent()
const rowTotals = (page: Page) =>
  page.locator('.twoD .rowtotal').allTextContents()

test('pivot boots in 2-D with reconciled totals, no console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

  await page.goto('/examples/pivot/')
  await expect(page.locator('.ptable.twoD')).toBeVisible()
  // region(4) rows × (corner + 4 cats + total) cols + header + footer = 36 cells
  await expect(page.locator('.twoD .pcell')).toHaveCount(36)
  await expect(page.locator('.twoD .rowtotal')).toHaveCount(4)
  expect(errors).toEqual([])
})

test('switching column field to none gives the 1-D table', async ({ page }) => {
  await page.goto('/examples/pivot/')
  await page.selectOption('#colField', 'none')
  await expect(page.locator('.ptable.oneD')).toBeVisible()
  await expect(page.locator('.oneD .pbody .prow')).toHaveCount(4)   // 4 regions
  await expect(page.locator('.oneD .barfill').first()).toBeVisible()
})

test('switching measure re-renders the cells', async ({ page }) => {
  await page.goto('/examples/pivot/')
  const before = await page.locator('.twoD .rowtotal').first().textContent()
  await page.selectOption('#measure', 'count')
  // count totals are bare integers, not "$…k"
  await expect(page.locator('.twoD .rowtotal').first()).not.toHaveText(before!)
  expect(await page.locator('.twoD .rowtotal').first().textContent()).not.toContain('$')
})

test('streaming inserts lift the grand total', async ({ page }) => {
  await page.goto('/examples/pivot/')
  const before = await grandRevenue(page)
  await page.locator('#add100').click()
  await expect.poll(() => grandRevenue(page)).not.toBe(before)
})

test('shuffling regions moves row totals but conserves the grand total (group BU2)', async ({ page }) => {
  await page.goto('/examples/pivot/')
  const grandBefore = await grandRevenue(page)
  const rowsBefore = await rowTotals(page)
  await page.locator('#shuffle').click()
  // some region row total changed (sales rebucketed across regions in place)
  await expect.poll(() => rowTotals(page)).not.toEqual(rowsBefore)
  // …but total revenue is conserved (shuffle only changes region, not revenue)
  expect(await grandRevenue(page)).toBe(grandBefore)
})
