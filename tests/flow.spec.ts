import { test, expect } from '@playwright/test'

test('flow essay loads, every figure mounts without console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text())
  })

  await page.goto('/examples/flow/')

  // §2 mounts a count line.
  await expect(page.locator('.qcount')).toContainText(/filter view: \d of 8 rows/)

  // §3 starts at N=60, work=0 events.
  await expect(page.locator('[data-stat=n] .cstat-v')).toHaveText('60')
  await expect(page.locator('[data-stat=real] .cstat-v')).toHaveText('0 events')

  // §4 builds the SVG graph with five nodes.
  await expect(page.locator('.pgsvg [data-node]')).toHaveCount(5)

  // §5 renders four region cells.
  await expect(page.locator('.gcell')).toHaveCount(4)

  // §6 seeds the log with 3 inserts; rebuilt state has 3 rows.
  await expect(page.locator('#loglist .lrec')).toHaveCount(3)
  await expect(page.locator('#staterows .lrow')).toHaveCount(3)

  expect(errors).toEqual([])
})

test('§2: toggling a row updates the filtered view', async ({ page }) => {
  await page.goto('/examples/flow/')

  // Right column holds 8 aligned slots; only `.show` slots represent the
  // filter view's current contents.
  const slots = page.locator('.qfig-col').nth(1).locator('.qrow.slot')
  await expect(slots).toHaveCount(8)

  const before = await slots.locator('.qrow.slot.show, .qrow.slot.show *').count()
  const show = page.locator('.qrow.slot.show')
  const initialShow = await show.count()

  await page.locator('.qfig-col').first().locator('.qrow.on').first().click()
  await expect(show).toHaveCount(initialShow - 1)
})

test('§3: insert advances N by 1 and reports bounded work', async ({ page }) => {
  await page.goto('/examples/flow/')

  await page.locator('.cfig button.cbtn').click()
  await expect(page.locator('[data-stat=n] .cstat-v')).toHaveText('61')

  const work = await page.locator('[data-stat=real] .cstat-v').textContent()
  // Work should be a small constant, not proportional to N.
  expect(work).toMatch(/^\d{1,2} events$/)
})

test('§4: clicking a trigger lights at least one edge', async ({ page }) => {
  await page.goto('/examples/flow/')

  // Wait for auto-cycle to be idle, then click "toggle active".
  await page.locator('[data-fire=active]').click()
  // Give the pulse animation a moment.
  await page.waitForTimeout(900)
  const litEdges = await page.locator('.edge.lit').count()
  expect(litEdges).toBeGreaterThan(0)
})

test('§6: insert / update / remove advance the log and re-derive state', async ({ page }) => {
  await page.goto('/examples/flow/')

  // Seeded with 3 records / 3 state rows.
  await expect(page.locator('#loglist .lrec')).toHaveCount(3)
  await expect(page.locator('#staterows .lrow')).toHaveCount(3)

  await page.locator('#fig-log button:has-text("insert")').click()
  await expect(page.locator('#loglist .lrec')).toHaveCount(4)
  await expect(page.locator('#staterows .lrow')).toHaveCount(4)

  // Update appends a record but doesn't change row count.
  await page.locator('#fig-log button:has-text("update random")').click()
  await expect(page.locator('#loglist .lrec')).toHaveCount(5)
  await expect(page.locator('#staterows .lrow')).toHaveCount(4)

  // Remove decrements state.
  await page.locator('#fig-log button:has-text("remove random")').click()
  await expect(page.locator('#staterows .lrow')).toHaveCount(3)

  // Replay rebuilds the same state from scratch.
  const stateBefore = await page.locator('#staterows').textContent()
  await page.locator('#fig-log button:has-text("replay from scratch")').click()
  await expect(page.locator('#staterows')).toHaveText(stateBefore!)
})
