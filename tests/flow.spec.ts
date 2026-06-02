import { test, expect } from '@playwright/test'

// The flow essay ("Table B is table A, filtered") is one base table shown as a
// scrubbable change history (left rail) feeding four derived views, plus
// companion figures for cost (§3), selectivity (§4), composition (§5), the
// hands-off code contrast (§6) and the DOM-as-last-derivation (§7). These
// smoke tests assert the figures mount and the core interactions behave, with
// no console errors.

test('flow essay loads, every figure mounts without console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })

  await page.goto('/examples/flow/')

  await expect(page.locator('.masthead h1')).toContainText(/filtered/i)

  // §1 instrument: seed of four changes → four chips, four base rows, three
  // active, four region bars, avg 67.
  await expect(page.locator('#tl-strip .chip')).toHaveCount(4)
  await expect(page.locator('#tl-head-n')).toHaveText('4')
  await expect(page.locator('#fold-orders .frow')).toHaveCount(4)
  await expect(page.locator('#fold-active .frow')).toHaveCount(3)
  await expect(page.locator('#fold-perRegion .rbar')).toHaveCount(4)
  await expect(page.locator('#fold-avg .avg-scalar')).toHaveText('67')

  expect(errors).toEqual([])
})

test('§1: adding a change extends the history and the derived views', async ({ page }) => {
  await page.goto('/examples/flow/')

  await page.locator('#tl-controls .tlb[data-act=insert]').click()
  await expect(page.locator('#tl-strip .chip')).toHaveCount(5)
  await expect(page.locator('#tl-len')).toHaveText('5')
  await expect(page.locator('#fold-orders .frow')).toHaveCount(5)
})

test('§2: scrubbing the history reconstructs an earlier state', async ({ page }) => {
  await page.goto('/examples/flow/')

  await page.locator('#tl-controls .tlb[data-act=insert]').click()
  await page.locator('#tl-controls .tlb[data-act=insert]').click()
  await expect(page.locator('#tl-strip .chip')).toHaveCount(6)

  const strip = await page.locator('#tl-strip').boundingBox()
  await page.mouse.click(strip!.x + 18, strip!.y + strip!.height / 2)

  expect(Number(await page.locator('#tl-head-n').textContent())).toBeLessThan(6)
  expect(await page.locator('#fold-orders .frow').count()).toBeLessThan(6)
})

test('§3: cost is O(Δ) flat vs O(N) per change, scaling with table size', async ({ page }) => {
  await page.goto('/examples/flow/')

  await page.locator('#cost-veil .tlb[data-bet=linear]').click()
  await expect(page.locator('#cost-veil')).toHaveClass(/gone/)
  await expect(page.locator('#cost-note')).toContainText(/right/)
  await expect(page.locator('#cost-curve .cc-refold')).toHaveCount(1)
  await expect(page.locator('#cost-inc')).toContainText(/ops/)

  // recompute cost scales with N; data does not.
  await page.locator('#cost-n').selectOption('600')
  const small = await page.locator('#cost-ref').textContent()
  await page.locator('#cost-n').selectOption('60000')
  const big = await page.locator('#cost-ref').textContent()
  const n = (s: string | null) => Number((s || '').replace(/[^0-9]/g, ''))
  expect(n(big)).toBeGreaterThan(n(small) * 10)
})

test('§4: each change is tinted only by the derived views it moves', async ({ page }) => {
  await page.goto('/examples/flow/')

  await page.locator('#tl-controls .tlb[data-act=toggle]').click()
  await expect(page.locator('#tl-detail')).toContainText(/moved/)
  await expect(page.locator('#tl-detail')).toContainText(/untouched/)
})

test('the change history pins to the left margin on scroll and scrubs', async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 900 })
  await page.goto('/examples/flow/')

  await expect(page.locator('#tl-pin')).not.toHaveClass(/show/)
  await page.evaluate(() => document.getElementById('selectivity')!.scrollIntoView())
  await expect(page.locator('#tl-pin')).toHaveClass(/show/, { timeout: 3000 })
  await expect(page.locator('#tl-pin-strip .pchip')).toHaveCount(4)
  await expect(page.locator('#tl-pin-label')).toContainText(/§4/)
})

test('§5: a change to orders becomes a change handed on by active', async ({ page }) => {
  await page.goto('/examples/flow/')

  await page.locator('#edge-go').click()
  await expect(page.locator('#edge-src')).toContainText(/update · #\d+\.active/)
  await expect(page.locator('#edge-act')).toContainText(/(insert|remove) · #\d+/)
})

test('§6: the hands-off code contrast renders both columns', async ({ page }) => {
  await page.goto('/examples/flow/')
  await expect(page.locator('#fig-handsoff .ho-col')).toHaveCount(2)
  await expect(page.locator('#fig-handsoff .ho-good')).toContainText(/orders\.filter/)
})

test('§7: a change maps to one minimal DOM instruction', async ({ page }) => {
  await page.goto('/examples/flow/')

  await expect(page.locator('#dom-list .dl-row')).toHaveCount(2)
  await page.locator('#dom-insert').click()
  await expect(page.locator('#dom-list .dl-row')).toHaveCount(3)
  await expect(page.locator('#dom-op')).toContainText(/appendChild/)
  await page.locator('#dom-update').click()
  await expect(page.locator('#dom-op')).toContainText(/one text write/)
  await page.locator('#dom-remove').click()
  await expect(page.locator('#dom-list .dl-row')).toHaveCount(2)
  await expect(page.locator('#dom-op')).toContainText(/remove/)
})
