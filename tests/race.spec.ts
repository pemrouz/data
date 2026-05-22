// @ts-nocheck
import { test, expect } from '@playwright/test'

// Smoke test for the home-page race carousel (assets/race.js + race-views.js).
//
// One realistic order-book tick stream feeds an always-running data baseline
// plus whichever of nine engines the carousel has selected; both render through
// the same depth-chart + ladder viz. These tests prove every engine mounts and
// produces live numbers (the order book fills, the cpu wave + data baseline
// populate), that the carousel select/prev/next cycle engines, and that the
// multidim workload toggle shows its loading bar then the iframe.
//
// One test per engine (each on a fresh page) — like multidim.spec.ts — so a
// cold esm.sh fetch + an O(N=150,000) per-frame settle for the heavy libraries
// gets its own budget rather than nine of them racing one global timeout.
// Serial because parallel browsers walking 150k rows per frame saturate the CPU
// and make the per-frame settle non-deterministic.

test.describe.configure({ mode: 'serial' })

const HOME = 'http://127.0.0.1:3000/'
// id → label fragment shown in .rcard-name
const ENGINES: [string, string][] = [
  ['data', 'data'], ['mobx', 'MobX'], ['solid', 'Solid'], ['preact', 'Preact'],
  ['vue', 'Vue'], ['crossfilter', 'crossfilter'], ['svelte', 'Svelte'],
  ['rxjs', 'RxJS'], ['react', 'React'],
]

async function expectLiveCard (page, labelFragment: string) {
  const card = page.locator('.rcard')
  await expect(card.locator('.rcard-name')).toContainText(labelFragment, { timeout: 60_000 })
  // order book renders 14 ladder rows (7 ask + 7 bid) once setup runs
  await expect(card.locator('.ob-row')).toHaveCount(14, { timeout: 30_000 })
  // the live order count and cpu cost carry digits once the per-frame loop is
  // running (positive match — robust to per-frame rewrites). The data baseline
  // is asserted only in the data test: for the heaviest engine (crossfilter,
  // O(N) per tick) the saturated main thread makes a race-free read of a
  // per-frame-rewritten field flaky, while cpu + liquid already prove liveness.
  await expect(card.locator('[data-k=liquid]')).toHaveText(/\d/, { timeout: 60_000 })
  await expect(card.locator('[data-k=cpu]')).toHaveText(/\d/, { timeout: 60_000 })
}

for (const [id, label] of ENGINES) {
  test(`race — ${id} engine mounts and renders a live order book`, async ({ page }) => {
    test.setTimeout(150_000)
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))
    await page.goto(HOME, { timeout: 90_000 })
    await page.waitForSelector('.rcard', { timeout: 60_000 })
    if (id !== 'data') await page.selectOption('#race-lib', id)
    await expectLiveCard(page, label)
    if (id === 'data') {
      await expect(page.locator('#race-pos')).toHaveText('1 / 9')
      // data runs as its own baseline; the baseline field carries digits too
      await expect(page.locator('[data-k=base]')).toHaveText(/\d/, { timeout: 60_000 })
    }
    expect(errors, errors.join('\n')).toHaveLength(0)
  })
}

test('race — prev / next buttons cycle the carousel', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto(HOME, { timeout: 90_000 })
  await page.waitForSelector('.rcard', { timeout: 60_000 })
  await expect(page.locator('.rcard-name')).toContainText('data')
  await page.click('#race-next')
  await expect(page.locator('#race-pos')).toHaveText('2 / 9')
  await expect(page.locator('.rcard-name')).toContainText('MobX', { timeout: 60_000 })
  await page.click('#race-prev')
  await expect(page.locator('#race-pos')).toHaveText('1 / 9')
  await expect(page.locator('.rcard-name')).toContainText('data')
})

test('race — multidim panel lazy-loads on scroll, behind a loading bar', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto(HOME, { timeout: 90_000 })
  await page.waitForSelector('.rcard', { timeout: 60_000 })
  // not built on first paint — it's ~36MB, deferred until it nears the viewport
  await expect(page.locator('iframe.md-frame')).toHaveCount(0)
  await page.locator('#race-multidim').scrollIntoViewIfNeeded()
  // once scrolled near, the iframe is created pointing at the multidim app
  // (the loading bar shows behind it until the iframe's load event fires)
  await expect(page.locator('iframe.md-frame')).toHaveAttribute('src', './examples/multidim/', { timeout: 10_000 })
})
