import { test, expect } from '@playwright/test'

// The v3 engine's crossfilter (examples/crossfilter-v3) — the first M5
// example migration. Mirrors the v2 spec's brush-then-resize sequence and
// asserts (a) the DOM flight list exactly matches the data-layer day buckets
// (no stale/empty rows — the keyed list sink under churn), (b) the totals
// line tracks the active count, and (c) brushing actually narrows the
// selection and reset restores it.

test('crossfilter-v3: brush + resize leave DOM exactly matching the data', async ({ page }) => {
  test.setTimeout(180_000) // 36MB dataset fetch + parse dominates on this box
  await page.goto('http://127.0.0.1:3000/examples/crossfilter-v3/', { timeout: 60_000 })
  await page.waitForSelector('.list .flight', { timeout: 120_000 })

  const state = () =>
    page.evaluate(() => {
      const w: any = window
      const cf = w.__cf
      const days = cf.days[cf.value] as Record<string, Record<string, unknown>>[]
      let bucketRows = 0
      for (const bucket of Object.values(days)) bucketRows += Object.keys(bucket).length
      const domRows = document.querySelectorAll('.list .flight').length
      const empties = Array.from(document.querySelectorAll('.list .flight')).filter(
        (r) => !(r.querySelector('.time') as HTMLElement).textContent?.trim(),
      ).length
      const active = cf.active.length()[cf.value] as number
      const asideText = document.querySelector('aside')?.textContent ?? ''
      return { bucketRows, domRows, empties, active, asideText }
    })

  const before = await state()
  expect(before.domRows).toBeGreaterThan(0)
  expect(before.domRows).toBe(before.bucketRows)
  expect(before.empties).toBe(0)
  expect(before.asideText).toContain(`${before.active.toLocaleString()} of `)

  // Brush the time chart (like the v2 spec), then resize via the east handle.
  const chart = page.locator('.chart').nth(0)
  const box = (await chart.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5)
  await page.mouse.down()
  for (let f = 0.31; f <= 0.7; f += 0.02) {
    await page.mouse.move(box.x + box.width * f, box.y + box.height * 0.5, { steps: 1 })
    await page.waitForTimeout(20)
  }
  await page.mouse.up()
  await page.waitForTimeout(300)

  const handle = chart.locator('.resize.e')
  const hb = (await handle.boundingBox())!
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  for (let dx = 0; dx > -120; dx -= 5) {
    await page.mouse.move(hb.x + hb.width / 2 + dx, hb.y + hb.height / 2, { steps: 1 })
    await page.waitForTimeout(15)
  }
  await page.mouse.up()
  await page.waitForTimeout(500)

  const after = await state()
  expect(after.active).toBeGreaterThan(0)
  expect(after.active).toBeLessThan(before.active) // the brush narrowed the selection
  expect(after.empties).toBe(0)
  expect(after.domRows).toBe(after.bucketRows) // DOM ≡ data through the churn
  expect(after.asideText).toContain(`${after.active.toLocaleString()} of `)

  // reset restores the unfiltered count
  await chart.locator('a.reset').click()
  await page.waitForTimeout(300)
  const reset = await state()
  expect(reset.active).toBe(before.active)
  expect(reset.domRows).toBe(reset.bucketRows)
})
