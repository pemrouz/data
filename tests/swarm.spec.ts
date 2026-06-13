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

  // The deck is incremental, not frozen at its construction seed. Assert that
  // directly and robustly:
  //  (1) Sum invariant — the deck accounts for every agent at all times:
  //      S+I+R === n. This is the real correctness guard (a length(fn)/patch
  //      desync would drop or double-count agents here); it's far stronger than
  //      the old single-direction check.
  //  (2) The recovered bucket — which did NOT exist at construction (every
  //      agent starts S or I) — has been created and populated: the
  //      length(fn)-rebuckets-on-BU2 fix in action.
  //  (3) The counts MOVED between samples — the deck tracks the live sim, not a
  //      frozen seed.
  // We deliberately do NOT assert S strictly fell. This is a SIRS model — the
  // trailing S is re-Susceptible: recovered agents lose immunity and return to
  // S — so at n=8000 the epidemic is weak (peaks ~1% infected) and oscillatory,
  // and S is non-monotonic. An earlier `t2.S < t1.S` flaked because S routinely
  // bounces back up between two early samples (verified: S falls 7916→7832 then
  // recovers to 7905 within the first 6s).
  expect(t1.S + t1.I + t1.R).toBe(8000)
  expect(t2.S + t2.I + t2.R).toBe(8000)
  expect(t2.R).toBeGreaterThan(0)
  expect(t2.S !== t1.S || t2.I !== t1.I || t2.R !== t1.R).toBe(true)

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
