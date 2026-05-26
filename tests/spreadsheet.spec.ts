// @ts-nocheck
import { test, expect } from '@playwright/test'

// Smoke test for the reactive spreadsheet example (examples/spreadsheet/).
//
// Proves the formula engine + the library's surgical render hang together:
// the seed sheet computes, editing a cell recomputes only its dependents, a
// circular reference is flagged, and the whole thing mounts with no console
// errors. Uses a unique seed each run via localStorage clear so a previous
// run's persisted edits can't leak in.

const URL = '/examples/spreadsheet/'

test('spreadsheet — seeds, recomputes dependents, detects cycles', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

  await page.addInitScript(() => localStorage.removeItem('data-sheet'))
  await page.goto(URL, { timeout: 30_000 })
  await page.waitForSelector('.sscell', { timeout: 10_000 })

  const cell = (id: string) => page.locator(`[data-cell="${id}"]`)

  // seed formulas compute: E2 = SUM(B2:D2) = 405; B6 = SUM(B2:B5) = 468
  await expect(cell('E2')).toHaveText('405')
  await expect(cell('B6')).toHaveText('468')

  // editing B2 (120 → 200) recomputes its dependents incrementally
  await cell('B2').dblclick()
  await page.locator('.sseditor').fill('200')
  await page.keyboard.press('Enter')
  await expect(cell('B2')).toHaveText('200')
  await expect(cell('E2')).toHaveText('485')   // 200 + 135 + 150
  await expect(cell('B6')).toHaveText('548')   // 200 + 98 + 140 + 110

  // a circular reference is caught, not hung
  await cell('A12').dblclick(); await page.locator('.sseditor').fill('=A13'); await page.keyboard.press('Enter')
  await cell('A13').dblclick(); await page.locator('.sseditor').fill('=A12'); await page.keyboard.press('Enter')
  await expect(cell('A12')).toHaveText('#CYCLE!')
  await expect(cell('A13')).toHaveText('#CYCLE!')

  // division by zero surfaces as an error, not Infinity
  await cell('B14').dblclick(); await page.locator('.sseditor').fill('=1/0'); await page.keyboard.press('Enter')
  await expect(cell('B14')).toHaveText('#DIV/0!')

  expect(errors, errors.join('\n')).toHaveLength(0)
})
