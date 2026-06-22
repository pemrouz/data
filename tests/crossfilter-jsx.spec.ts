// JSX port of the crossfilter example must (a) load and produce the same
// shape DOM as the builder version, and (b) not regress the empty-row bug
// that `crossfilter.spec.ts` guards against. We replay the same brush
// gesture against the JSX page and assert the same invariant: every
// rendered .flight row carries a non-empty .time cell.
import { test, expect } from '@playwright/test'

test('crossfilter-jsx loads and renders charts + flight list', async ({ page }) => {
  await page.goto('http://127.0.0.1:3000/examples/crossfilter-jsx/', { timeout: 60_000 })
  await page.waitForSelector('.list .flight', { timeout: 60_000 })
  // four charts (time/delay/distance/date)
  expect(await page.locator('.chart').count()).toBe(4)
  // each chart has its brush + axis structure
  expect(await page.locator('.chart svg .brush').count()).toBe(4)
  expect(await page.locator('.chart svg .axis').count()).toBe(4)
})

test('crossfilter-jsx brush leaves no stale DOM rows (parity with builder)', async ({ page }) => {
  await page.goto('http://127.0.0.1:3000/examples/crossfilter-jsx/', { timeout: 60_000 })
  await page.waitForSelector('.list .flight', { timeout: 60_000 })

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

  const snap = await page.evaluate(() => {
    const w: any = window
    const acVal = w.ac[w.v]
    let groupedTotal = 0
    for (const k of Object.keys(acVal)) groupedTotal += acVal[k].length
    const domRows = document.querySelectorAll('.list .flight').length
    const empties = Array.from(document.querySelectorAll('.list .flight'))
      .filter((r: any) => !(r.querySelector('.time') as HTMLElement).textContent?.trim()).length
    return { groupedTotal, domRows, empties }
  })

  expect(snap.empties).toBe(0)
  expect(snap.domRows).toBe(snap.groupedTotal)
})
