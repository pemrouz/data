import { test, expect, type Page } from '@playwright/test'

// Smoke test for examples/chat/ (JSX) — a messaging workspace where the open
// channel is `messages.filter('channel', cur).az('ts')`, channel counts are a
// `length(fn)` histogram, and reactions are a <For> over a nested object that
// mutates in place. We pause the bot (which streams messages every 1.5s) at the
// start of each interaction test for determinism.

const stopBot = async (page: Page) => {
  const bot = page.locator('.botbtn', { hasText: 'bot' }).first()
  if ((await bot.textContent())?.includes('⏸')) await bot.click()  // running → pause
}

test('chat boots in JSX with no console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

  await page.goto('/examples/chat/')
  await expect(page.locator('.chan')).toHaveCount(4)
  await expect(page.locator('.msg').first()).toBeVisible()
  // active channel header reflects the current channel
  await expect(page.locator('.chan-title')).toContainText('general')
  expect(errors).toEqual([])
})

test('switching channel re-points the message view', async ({ page }) => {
  await page.goto('/examples/chat/')
  await stopBot(page)
  const generalFirst = await page.locator('.msg .msg-text').first().textContent()

  await page.locator('.chan', { hasText: 'random' }).click()
  await expect(page.locator('.chan.active')).toContainText('random')
  await expect(page.locator('.chan-title')).toContainText('random')
  // the list re-pointed to a different channel's messages
  const randomFirst = await page.locator('.msg .msg-text').first().textContent()
  expect(randomFirst).not.toBe(generalFirst)
})

test('reacting adds a chip and increments it (nested BU2 through For)', async ({ page }) => {
  await page.goto('/examples/chat/')
  await stopBot(page)
  const msg = page.locator('.msg').first()
  await msg.hover()
  const thumb = msg.locator('.rx-pick', { hasText: '👍' })
  await thumb.click()
  // a reaction chip appears with count 1
  await expect(msg.locator('.rx')).toHaveCount(1)
  await expect(msg.locator('.rx .rx-n')).toHaveText('1')
  // click again → same chip increments to 2 (in-place nested edit, no new chip)
  await msg.hover()
  await thumb.click()
  await expect(msg.locator('.rx')).toHaveCount(1)
  await expect(msg.locator('.rx .rx-n')).toHaveText('2')
})

test('sending a message appends it to the open channel', async ({ page }) => {
  await page.goto('/examples/chat/')
  await stopBot(page)
  const before = await page.locator('.msg').count()
  await page.locator('.compose-input').fill('hello from the test suite')
  await page.locator('.compose-input').press('Enter')
  await expect(page.locator('.msg', { hasText: 'hello from the test suite' })).toBeVisible()
  expect(await page.locator('.msg').count()).toBe(before + 1)
})

test('blast (batched patch insert) lifts the channel counts', async ({ page }) => {
  await page.goto('/examples/chat/')
  await stopBot(page)
  const counts = () => page.locator('.chan-count').allTextContents()
  const before = (await counts()).map(Number).reduce((a, b) => a + b, 0)
  await page.locator('.botbtn', { hasText: 'blast' }).click()
  await expect.poll(async () => (await counts()).map(Number).reduce((a, b) => a + b, 0))
    .toBe(before + 200)
})
