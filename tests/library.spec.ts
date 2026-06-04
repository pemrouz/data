import { test, expect, type Page } from '@playwright/test'

// Smoke test for examples/library/ — a faceted browser composed from set
// algebra (union within a facet, intersect across facets, except for
// exclusions, between for ranges). The display is `final.za('rating').limit(n)`
// — an array-shaped, heavily-churned list — so we also assert the rendered
// cards stay consistent (no duplicate / stale cards) after a sequence of facet
// changes (the array-list render path).

const count = (page: Page) => page.locator('.count .cnum').textContent()
const cardIds = (page: Page) =>
  page.locator('.card').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.id))
const cardGenres = (page: Page) =>
  page.locator('.card').evaluateAll(els =>
    els.map(e => [...e.querySelectorAll('.cg')].map(x => x.textContent)))

test('library boots, 6000 titles, 60 cards, no console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

  await page.goto('/examples/library/')
  await expect(page.locator('.card')).toHaveCount(60)
  expect(await count(page)).toBe('6,000')
  expect(errors).toEqual([])
})

test('union within a facet, intersect across facets, except for exclusions', async ({ page }) => {
  await page.goto('/examples/library/')

  // union: SciFi OR Thriller
  await page.locator('.facet-genres .chip', { hasText: 'SciFi' }).click()
  await page.locator('.facet-genres .chip', { hasText: 'Thriller' }).click()
  const afterUnion = +(await count(page))!.replace(/,/g, '')
  expect(afterUnion).toBeLessThan(6000)
  for (const gs of await cardGenres(page))
    expect(gs.includes('SciFi') || gs.includes('Thriller')).toBe(true)

  // intersect: AND a decade — strictly narrows
  await page.locator('.facet-decades .chip', { hasText: '1990' }).click()
  const afterDecade = +(await count(page))!.replace(/,/g, '')
  expect(afterDecade).toBeLessThan(afterUnion)

  // except: exclude Horror — no visible card has Horror
  await page.locator('.facet-exclude .chip', { hasText: 'Horror' }).click()
  for (const gs of await cardGenres(page)) expect(gs.includes('Horror')).toBe(false)
})

test('load more grows the page; clear all resets to 6000', async ({ page }) => {
  await page.goto('/examples/library/')
  await page.locator('.more').click()
  await expect(page.locator('.card')).toHaveCount(120)
  // narrow then clear
  await page.locator('.facet-genres .chip', { hasText: 'Drama' }).click()
  await expect.poll(() => count(page)).not.toBe('6,000')
  await page.locator('.clearbtn').click()
  expect(await count(page)).toBe('6,000')
  await expect(page.locator('.facet-genres .chip.on')).toHaveCount(0)
})

// The rating brush is the hot path that motivated the bounded-`za` + rAF work:
// `display = final.za('rating', pageSize)` (a bounded top-K, not `za().limit()`)
// updated through a rAF-coalesced bounds write. This asserts the brush stays
// CORRECT under a drag — every visible card within the ceiling, sorted desc,
// the window full (60) while enough titles qualify — and throws no errors.
// (The per-step cost is pinned at the operator level in
// operators/sort/sort.perf.ts `bounded batch brush`.)
test('rating brush filters + re-sorts correctly under a drag', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto('/examples/library/')
  await expect(page.locator('.card')).toHaveCount(60)

  const scores = (p: Page) =>
    p.locator('.card .score').evaluateAll(els =>
      els.map(e => parseFloat((e as HTMLElement).textContent || 'NaN')))

  // Drag the rating ceiling down through several stops; after each, every card
  // must be ≤ ceiling and the list must stay sorted descending.
  for (const hi of [9.0, 8.0, 7.0, 6.0, 5.5]) {
    await page.locator('#rhi').evaluate((el, v) => {
      ;(el as HTMLInputElement).value = String(v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }, hi)
    await expect.poll(async () => {
      const s = await scores(page)
      return s.length > 0 && s.every(x => x <= hi + 1e-9) && s.every((x, i) => i === 0 || s[i - 1] >= x)
    }).toBe(true)
  }
  // Plenty of titles still rate ≤ 5.5, so the window stays full.
  await expect(page.locator('.card')).toHaveCount(60)
  expect(errors).toEqual([])
})

test('rendered cards stay consistent (no duplicates/stale) through facet churn', async ({ page }) => {
  await page.goto('/examples/library/')

  // a churn sequence of toggles that reorders/inserts/removes the array list
  const toggles = [
    '.facet-genres .chip:has-text("Action")',
    '.facet-genres .chip:has-text("Comedy")',
    '.facet-decades .chip:has-text("2010")',
    '.facet-exclude .chip:has-text("Drama")',
    '.facet-genres .chip:has-text("Action")',   // un-toggle
    '.facet-decades .chip:has-text("2020")',
  ]
  for (const sel of toggles) { await page.locator(sel).first().click(); await page.waitForTimeout(40) }

  const ids = await cardIds(page)
  // no duplicate cards
  expect(new Set(ids).size).toBe(ids.length)
  // rendered card count == min(pageSize=60, resultCount)
  const n = +(await count(page))!.replace(/,/g, '')
  expect(ids.length).toBe(Math.min(60, n))
  // every card still satisfies the live facets (Comedy, 2010|2020, not Drama)
  for (const gs of await cardGenres(page)) {
    expect(gs.includes('Comedy')).toBe(true)
    expect(gs.includes('Drama')).toBe(false)
  }
})
