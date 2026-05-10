// @ts-nocheck
import { test, expect } from '@playwright/test'

// Smoke test for the multi-dim live comparisons page.
//
// Verifies each library row mounts, all four brushable histograms render,
// the initial active/total counts populate, brushing updates the active
// count and the rolling latency tracker records samples (proving the
// dual-rAF post-paint measurement loop fires).

const LIBS = ['data', 'crossfilter', 'mobx']

for (const lib of LIBS) {
  test(`multidim — ${lib} row mounts, brush updates count, latency tracker records`, async ({ page }) => {
    test.setTimeout(180_000)
    await page.goto('http://127.0.0.1:3000/examples/multidim/', { timeout: 120_000 })

    const row = page.locator(`.mdf-row[data-lib="${lib}"]`)
    await row.waitFor({ timeout: 60_000 })

    const charts = row.locator('.mdf-chart')
    await expect(charts).toHaveCount(4)

    const total = row.locator('[data-stat=total]')
    const active = row.locator('[data-stat=active]')
    await expect(total).not.toHaveText(/^—$/, { timeout: 60_000 })
    await expect(active).not.toHaveText(/^—$/, { timeout: 60_000 })
    const initialActive = await active.textContent()

    // Brush the first chart (time of day). Scroll into view first — later
    // rows can sit below the viewport on a tall stack and mouse events
    // outside the viewport silently no-op.
    const time = charts.nth(0)
    await time.scrollIntoViewIfNeeded()
    const box = (await time.boundingBox())!
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.6)
    await page.mouse.down()
    for (let f = 0.31; f <= 0.7; f += 0.03) {
      await page.mouse.move(box.x + box.width * f, box.y + box.height * 0.6, { steps: 1 })
      await page.waitForTimeout(20)
    }
    await page.mouse.up()
    await page.waitForTimeout(200)

    await expect(active).not.toHaveText(initialActive!)

    const samples = await row.locator('[data-stat=count]').textContent()
    expect(Number(samples)).toBeGreaterThan(0)
  })
}
