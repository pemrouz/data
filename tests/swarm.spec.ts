import { test, expect } from '@playwright/test'

// Smoke test for examples/swarm/ — a live SIRS epidemic with a fully
// incremental analytics deck. We assert the deck is genuinely *live* (the SIR
// counts evolve, the R bucket appears mid-run — the exact length(fn)-on-BU2
// rebucket the example surfaced), the render() cohort table populates, and a
// brush drags the cohort. Kept lenient on exact numbers (the sim is seeded but
// frame-timing varies); strict on "no console errors" and "values moved".

test('swarm boots, deck is live, no console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

  await page.goto('/examples/swarm/?n=8000')

  // fixed-slot panels exist
  await expect(page.locator('#hist .hbar')).toHaveCount(20)
  await expect(page.locator('#cohort-rows .cohort-row').first()).toBeVisible()

  const readSIR = () =>
    page.evaluate(() => ({
      S: +document.querySelector('#sir-S .n')!.textContent!.replace(/,/g, ''),
      I: +document.querySelector('#sir-I .n')!.textContent!.replace(/,/g, ''),
      R: +document.querySelector('#sir-R .n')!.textContent!.replace(/,/g, ''),
    }))

  await page.waitForTimeout(1200)
  const t1 = await readSIR()
  await page.waitForTimeout(4500)
  const t2 = await readSIR()

  // The deck is incremental, not frozen at its construction seed: susceptibles
  // fall, and the recovered bucket — which did NOT exist at construction (every
  // agent starts S or I) — has been created and populated. Its mere presence is
  // the length(fn)-rebuckets-on-BU2 fix in action.
  expect(t2.S).toBeLessThan(t1.S)
  expect(t2.R).toBeGreaterThan(0)

  // The cohort table is the render() showcase: ≤120 surgically-updated rows.
  const rows = await page.locator('#cohort-rows .cohort-row').count()
  expect(rows).toBeGreaterThan(0)
  expect(rows).toBeLessThanOrEqual(120)

  expect(errors).toEqual([])
})

test('brushing the cloud drives the cohort', async ({ page }) => {
  await page.goto('/examples/swarm/?n=8000')
  await page.waitForTimeout(1500)

  const before = await page.evaluate(
    () => +document.querySelector('#t-cohort')!.textContent!.replace(/,/g, '')
  )

  // drag a fresh box over a different region of the cloud
  const box = (await page.locator('#cloud').boundingBox())!
  await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.05)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.4, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(600)

  await expect(page.locator('#brush')).toBeVisible()
  const after = await page.evaluate(
    () => +document.querySelector('#t-cohort')!.textContent!.replace(/,/g, '')
  )
  // the brushed-cohort count responded to the new selection
  expect(after).not.toBe(before)
})
