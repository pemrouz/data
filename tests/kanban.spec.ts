import { test, expect, type Page } from '@playwright/test'

// Smoke test for examples/kanban/ — an issue tracker where every column is a
// `board.filter('status', s).az('order')` view and counts/points are
// incremental aggregates over it. The reactive-chain assertions drive the
// board via page.evaluate (deterministic — native HTML5 drag isn't reliably
// reproducible in Playwright); a couple of real interactions (pill click,
// filter chip) cover the event path.

const colCount = (page: Page, s: string) =>
  page.locator(`.col[data-status="${s}"] .col-count`).textContent()
const colPts = (page: Page, s: string) =>
  page.locator(`.col[data-status="${s}"] .col-pts`).textContent()
const idOf = async (page: Page, title: string) => {
  // main.js mounts asynchronously (await import) — wait until the board proxy
  // is on window before reading it.
  await page.waitForFunction(() => !!(window as any).board && !!(window as any).value)
  return page.evaluate((title) => {
    const b = (window as any).board[(window as any).value]
    for (const k in b) if (b[k] && b[k].title === title) return k
    return null
  }, title)
}

test('kanban boots, no console errors, columns + cards rendered', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

  await page.goto('/examples/kanban/')
  await expect(page.locator('.col')).toHaveCount(5)
  await expect(page.locator('.card')).toHaveCount(20)
  await expect(page.locator('.sprint-fill')).toBeVisible()
  expect(errors).toEqual([])
})

test('moving a card re-routes it and updates both columns count + points', async ({ page }) => {
  await page.goto('/examples/kanban/')
  const id = await idOf(page, 'Postgres schema')   // To Do, 8 pts

  const todoPts0 = await colPts(page, 'todo')
  const ipPts0 = await colPts(page, 'in-progress')

  await page.evaluate((id) => { (window as any).board[id!].status = 'in-progress' }, id)

  // exactly one copy lands under In Progress (no duplicate — the array-insert
  // render fix), and it left To Do
  await expect(
    page.locator('.col[data-status="in-progress"] .card', { hasText: 'Postgres schema' })
  ).toHaveCount(1)
  await expect(
    page.locator('.col[data-status="todo"] .card', { hasText: 'Postgres schema' })
  ).toHaveCount(0)

  // point TOTALS moved on both sides — the sum-over-sort decrement/increment
  expect(await colPts(page, 'todo')).not.toBe(todoPts0)
  expect(await colPts(page, 'in-progress')).not.toBe(ipPts0)
})

test('editing a card in place re-renders it and updates the column total', async ({ page }) => {
  await page.goto('/examples/kanban/')
  const id = await idOf(page, 'Design auth flow')   // In Progress, 5 pts

  const before = await colPts(page, 'in-progress')
  await page.evaluate((id) => { (window as any).board[id!].points = 13 }, id)
  // the card's own points pill re-rendered in place (sort in-place-edit fix)
  await expect(
    page.locator('.card', { hasText: 'Design auth flow' }).locator('.pill.pts')
  ).toHaveText('13 pts')
  // and the column total followed
  expect(await colPts(page, 'in-progress')).not.toBe(before)

  // an in-place title edit also re-renders the same card node
  await page.evaluate((id) => { (window as any).board[id!].title = 'Design auth flow v2' }, id)
  await expect(page.locator('.card', { hasText: 'Design auth flow v2' })).toHaveCount(1)
})

test('clicking the points pill cycles the value (real interaction)', async ({ page }) => {
  await page.goto('/examples/kanban/')
  const pill = page.locator('.card', { hasText: 'CI pipeline' }).locator('.pill.pts')
  const before = await pill.textContent()
  await pill.click()
  await expect(pill).not.toHaveText(before!)
})

test('search filters cards across columns (rAF-coalesced re-point)', async ({ page }) => {
  await page.goto('/examples/kanban/')
  await expect(page.locator('.card')).toHaveCount(20)
  // typing re-points every column once per frame; the filter applies a frame
  // later, so use auto-retrying assertions (never a synchronous read).
  await page.locator('.search').fill('auth')
  await expect.poll(async () => {
    const cards = await page.locator('.card').allTextContents()
    return cards.length > 0 && cards.length < 20 && cards.every(t => t.toLowerCase().includes('auth'))
  }).toBe(true)
  // clearing restores the full board
  await page.locator('.search').fill('')
  await expect(page.locator('.card')).toHaveCount(20)
})

test('assignee filter re-points every column', async ({ page }) => {
  await page.goto('/examples/kanban/')
  const totalBefore = await page.locator('.card').count()
  await page.locator('.chip[data-who="ana"]').click()
  await expect(page.locator('.chip[data-who="ana"]')).toHaveClass(/active/)
  expect(await page.locator('.card').count()).toBeLessThan(totalBefore)
  const whos = await page.locator('.card .pill.who').allTextContents()
  expect(whos.every(w => w.trim() === 'ana')).toBe(true)
})
