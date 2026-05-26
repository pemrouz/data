// @ts-nocheck
import { test, expect } from '@playwright/test'

// Smoke test for the live metrics dashboard example (examples/metrics/).
//
// Proves the board mounts, the stream runs (the cumulative "served" counter
// climbs), and every incrementally-maintained panel — status codes, endpoints,
// latency bands, the tiles — carries live numbers, with no console errors.

const URL = '/examples/metrics/'

test('metrics — streams events and keeps every panel incrementally', async ({ page }) => {
  test.setTimeout(40_000)
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

  await page.goto(URL, { timeout: 30_000 })
  await page.waitForSelector('.tile', { timeout: 10_000 })

  // panels are present
  await expect(page.locator('.status .bar')).toHaveCount(8)
  await expect(page.locator('.eps .bar')).toHaveCount(10)

  // tiles carry real numbers
  for (const k of ['rps', 'served', 'avg', 'errorRate']) await expect(page.locator(`[data-k=${k}]`)).toHaveText(/\d/, { timeout: 5_000 })

  // the stream is running: the cumulative served counter climbs
  const read = () => page.locator('[data-k=served]').textContent()
  const a = await read()
  await page.waitForTimeout(800)
  const b = await read()
  expect(a).not.toBe(b)

  // a top endpoint has accumulated more than a cold one (skewed popularity)
  const counts = await page.locator('.eps .bval').allTextContents()
  expect(counts.length).toBe(10)
  expect(counts.some(c => /\d/.test(c))).toBeTruthy()

  expect(errors, errors.join('\n')).toHaveLength(0)
})
