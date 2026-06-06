import { test, expect } from '@playwright/test'

// The flow essay ("Write the view, flow the change") opens on the duality (§1):
// the real change records (left) ⟷ the orders table (right), two forms of one
// thing, feeding three derived views. ONE change stream and ONE playhead drive
// the whole page — scrubbing the records list (or any figure's button) re-reads
// every figure from the head: cost (§3), selectivity (§4), the edge (§5), and
// the DOM (§7, a second render() sink on the SAME source). These smoke tests
// assert the figures mount, the shared playhead drives them, and no console errors.

test('flow essay loads, every figure mounts without console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })

  await page.goto('/examples/flow/')

  await expect(page.locator('.masthead h1')).toContainText(/flow the change/i)

  // §1 duality: seed of four change records → four records on the left, four
  // rows in the table, three active, four region bars, avg 67.
  await expect(page.locator('#dz-records .drec')).toHaveCount(4)
  await expect(page.locator('#dz-rows .frow')).toHaveCount(4)
  await expect(page.locator('#dz-meta')).toHaveText('4 / 4')
  await expect(page.locator('#fold-active .frow')).toHaveCount(3)
  await expect(page.locator('#fold-perRegion .rbar')).toHaveCount(4)
  await expect(page.locator('#fold-avg .avg-scalar')).toHaveText('67')

  // the records show the REAL deltas, not abstract glyphs.
  await expect(page.locator('#dz-records .drec').first()).toContainText('insert')

  // the cast diagram (orders → active → perRegion; orders → avg) is present.
  await expect(page.locator('#fig-cast svg .c-name')).toHaveCount(4)

  // §4 selectivity is a records × views matrix (one row per change), not chips.
  await expect(page.locator('#sel-strip .selm-row')).toHaveCount(4)

  // the rendered essay uses no § section symbol anywhere.
  const sectionSymbols = await page.evaluate(() => (document.body.innerText.match(/§/g) || []).length)
  expect(sectionSymbols).toBe(0)

  expect(errors).toEqual([])
})

test('§1: editing the table appends a real change (the diff direction)', async ({ page }) => {
  await page.goto('/examples/flow/')

  await page.locator('#dz-controls .tlb[data-act=insert]').click()
  await expect(page.locator('#dz-records .drec')).toHaveCount(5)
  await expect(page.locator('#dz-meta')).toHaveText('5 / 5')
  await expect(page.locator('#dz-rows .frow')).toHaveCount(5)
})

test('§1/§2: scrubbing the records applies fewer changes → a smaller table', async ({ page }) => {
  await page.goto('/examples/flow/')

  await page.locator('#dz-controls .tlb[data-act=insert]').click()
  await page.locator('#dz-controls .tlb[data-act=insert]').click()
  await expect(page.locator('#dz-records .drec')).toHaveCount(6)

  // scrub the playhead to the first record → apply only one change.
  await page.locator('#dz-records .drec').first().click()
  await expect(page.locator('#dz-meta')).toHaveText('1 / 6')
  await expect(page.locator('#dz-rows .frow')).toHaveCount(1)
})

test('§3: the sweep lights one row for data, all N for recompute, scaling with N', async ({ page }) => {
  await page.goto('/examples/flow/')

  await page.locator('#cost-veil .tlb[data-bet=linear]').click()
  await expect(page.locator('#cost-veil')).toHaveClass(/gone/)
  await expect(page.locator('#cost-note')).toContainText(/right/)

  // data strip lights exactly one row; recompute strip sweeps the whole table.
  await expect(page.locator('#sweep-data .sweep-bar.hit')).toHaveCount(1)
  await expect(page.locator('#sweep-ref')).toHaveClass(/swept/)
  await expect(page.locator('#sweep-data-n')).toContainText(/row/)

  // the recompute count scales with N; data stays one row.
  await page.locator('#cost-n').selectOption('600')
  await expect(page.locator('#sweep-ref-n')).toContainText('600')
  await page.locator('#cost-n').selectOption('60000')
  await expect(page.locator('#sweep-ref-n')).toContainText('60,000')
  await expect(page.locator('#sweep-data .sweep-bar.hit')).toHaveCount(1)
})

test('§4: each change is tinted only by the derived views it moves', async ({ page }) => {
  await page.goto('/examples/flow/')

  await page.locator('#dz-controls .tlb[data-act=toggle]').click()
  await expect(page.locator('#dz-detail')).toContainText(/moved/)
  await expect(page.locator('#dz-detail')).toContainText(/untouched/)
})

test('the change history pins to the left margin on scroll and scrubs', async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 900 })
  await page.goto('/examples/flow/')

  await expect(page.locator('#tl-pin')).not.toHaveClass(/show/)
  await page.evaluate(() => document.getElementById('selectivity')!.scrollIntoView())
  await expect(page.locator('#tl-pin')).toHaveClass(/show/, { timeout: 3000 })
  await expect(page.locator('#tl-pin-strip .pchip')).toHaveCount(4)
  await expect(page.locator('#tl-pin-label')).toContainText(/selectivity/)
})

test('§5: a change to orders becomes the change active hands on', async ({ page }) => {
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

test('§7: the DOM list is a second sink on the same source; a change → one DOM op', async ({ page }) => {
  await page.goto('/examples/flow/')

  // the dom list renders the SAME source as the §1 table, so it starts at four.
  await expect(page.locator('#dom-list .dl-row')).toHaveCount(4)
  await expect(page.locator('#dz-rows .frow')).toHaveCount(4)

  await page.locator('#dom-insert').click()
  await expect(page.locator('#dom-list .dl-row')).toHaveCount(5)
  await expect(page.locator('#dz-rows .frow')).toHaveCount(5)   // both sinks updated
  await expect(page.locator('#dom-op')).toContainText(/appendChild/)

  await page.locator('#dom-update').click()   // bumps a value — count unchanged
  await expect(page.locator('#dom-list .dl-row')).toHaveCount(5)
  await expect(page.locator('#dom-op')).toContainText(/one text write/)

  await page.locator('#dom-remove').click()
  await expect(page.locator('#dom-list .dl-row')).toHaveCount(4)
  await expect(page.locator('#dom-op')).toContainText(/remove/)
})
