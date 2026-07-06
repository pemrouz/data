import { test, expect, type Page } from '@playwright/test'

// Smoke test for examples/chat-v3/ — the chat workspace on the v3 engine,
// authored in classic JSX (the JSX layer's first browser consumer). Ports
// tests/chat.spec.ts flow-for-flow (chat-v3 keeps ../chat's CSS classes),
// with the v3 behavioural notes baked in:
//   - search re-points the mirror slot once per frame (rAF-coalesced, and the
//     previous transient filter is dispose()d), so search assertions poll;
//   - a row's FIRST reaction changes its child count, so the keyed list sink
//     structurally REBUILDS that row element in place — locators re-resolve
//     fine, but element identity is only asserted across the NON-structural
//     increment (and across an untouched sibling), never across that first
//     click, where a cached ElementHandle goes stale by design;
//   - the list is az('ts') chained ONCE off the slot, so a sent message lands
//     at the END and never re-binds the <For>.
// The bot streams a message every 1.5s; interaction tests pause it first for
// determinism (the toggle's reactive label flips '⏸ bot' → '▶ bot').

const url = 'http://127.0.0.1:3000/examples/chat-v3/'

const stopBot = async (page: Page) => {
  const bot = page.locator('.botbtn', { hasText: 'bot' }).first()
  if ((await bot.textContent())?.includes('⏸')) await bot.click() // running → pause
}

test('chat-v3 boots: seeded messages render for the open channel', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

  await page.goto(url)
  await expect(page.locator('.chan')).toHaveCount(4)
  await expect(page.locator('.msg').first()).toBeVisible()
  // active channel row + header reflect the ui source's initial channel
  await expect(page.locator('.chan.active')).toContainText('general')
  await expect(page.locator('.chan-title')).toContainText('general')

  // DOM ≡ data for the open channel: the <For> over az('ts') shows exactly
  // the source rows whose channel is 'general', read through window.__chat
  // (the crossfilter-v3 idiom). Polled — the bot is still streaming here.
  await expect.poll(() => page.evaluate(() => {
    const w = window as any
    const snap = w.__chat.messages[w.__chat.value] as Record<string, { channel: string }>
    const dataRows = Object.values(snap).filter(m => m.channel === 'general').length
    const domRows = document.querySelectorAll('.msg').length
    return domRows > 0 && domRows === dataRows
  })).toBe(true)

  expect(errors).toEqual([])
})

test('switching channel re-points the mirror slot', async ({ page }) => {
  await page.goto(url)
  await stopBot(page)
  const generalFirst = await page.locator('.msg .msg-text').first().textContent()

  await page.locator('.chan', { hasText: 'random' }).click()
  await expect(page.locator('.chan.active')).toContainText('random')
  await expect(page.locator('.chan-title')).toContainText('random')
  // the ONE az/length/<For> chain now shows the other channel's messages —
  // no operator was rebuilt; viewSlot.set() re-pointed at an existing view
  await expect.poll(() => page.locator('.msg .msg-text').first().textContent())
    .not.toBe(generalFirst)

  // and back: general's list is restored intact from the same standing views
  await page.locator('.chan', { hasText: 'general' }).click()
  await expect(page.locator('.chan-title')).toContainText('general')
  await expect(page.locator('.msg .msg-text').first()).toHaveText(generalFirst!)
})

test('reacting adds a chip, then increments it in place (path-addressed nested write)', async ({ page }) => {
  await page.goto(url)
  await stopBot(page)
  const msg = page.locator('.msg').first()
  const sibling = page.locator('.msg').last()
  const sibHandle = await sibling.elementHandle()

  // FIRST reaction: reactions {} → {👍:1} adds a chip — a child-count change,
  // so the list sink structurally rebuilds THIS row element in place (the
  // locator re-resolves; a cached handle for this row would now be stale)
  await msg.hover()
  await msg.locator('.rx-pick', { hasText: '👍' }).click()
  await expect(msg.locator('.rx')).toHaveCount(1)
  await expect(msg.locator('.rx .rx-n')).toHaveText('1')

  // untouched rows never re-render: the sibling kept its DOM element through
  // the neighbour's structural rebuild
  expect(await sibling.evaluate((el, prev) => el === prev, sibHandle)).toBe(true)

  // SECOND click on the same emoji: {👍:1} → {👍:2} is content-only (same
  // chip structure), so the row element is PRESERVED and only the count text
  // patches — capture the rebuilt element first, compare after
  const rowHandle = await msg.elementHandle()
  await msg.hover()
  await msg.locator('.rx-pick', { hasText: '👍' }).click()
  await expect(msg.locator('.rx')).toHaveCount(1)
  await expect(msg.locator('.rx .rx-n')).toHaveText('2')
  expect(await msg.evaluate((el, prev) => el === prev, rowHandle)).toBe(true)
})

test('sending a message appends it at the END of the az(ts) list', async ({ page }) => {
  await page.goto(url)
  await stopBot(page)
  const before = await page.locator('.msg').count()
  await page.locator('.compose-input').fill('hello from the v3 suite')
  await page.locator('.compose-input').press('Enter')
  await expect(page.locator('.msg', { hasText: 'hello from the v3 suite' })).toBeVisible()
  await expect(page.locator('.msg')).toHaveCount(before + 1)
  // az('ts') ordering: the newest message is the LAST row
  await expect(page.locator('.msg .msg-text').last()).toHaveText('hello from the v3 suite')
  // the header count is length() chained ONCE off the same slot
  await expect(page.locator('.chan-meta')).toHaveText(`${before + 1} messages`)
})

test('search narrows the open channel (rAF-coalesced transient filter)', async ({ page }) => {
  await page.goto(url)
  await stopBot(page)
  // two known messages in the open channel: one matches the query, one doesn't
  for (const t of ['alpha marker zzqq', 'beta other line']) {
    await page.locator('.compose-input').fill(t)
    await page.locator('.compose-input').press('Enter')
  }
  await expect(page.locator('.msg', { hasText: 'beta other line' })).toBeVisible()
  // typing re-points the slot at a transient filter once per frame (the
  // previous transient is dispose()d), so the narrowed list lands a frame
  // later — use auto-retrying polls
  await page.locator('.search').fill('zzqq')
  await expect.poll(async () => {
    const texts = await page.locator('.msg .msg-text').allTextContents()
    return texts.length > 0 && texts.every(t => t.toLowerCase().includes('zzqq'))
  }).toBe(true)
  await expect(page.locator('.msg', { hasText: 'beta other line' })).toHaveCount(0)
  // clearing re-points back at the standing channel view
  await page.locator('.search').fill('')
  await expect(page.locator('.msg', { hasText: 'beta other line' })).toBeVisible()
})

test('blast (one patch batch of 200) lifts the per-channel totals', async ({ page }) => {
  await page.goto(url)
  await stopBot(page)
  const counts = () => page.locator('.chan-count').allTextContents()
  const before = (await counts()).map(Number).reduce((a, b) => a + b, 0)
  await page.locator('.botbtn', { hasText: 'blast' }).click()
  // 200 keyed inserts land as ONE patch commit; the length(fn) histogram
  // absorbs them in a single settle across its four buckets
  await expect.poll(async () => (await counts()).map(Number).reduce((a, b) => a + b, 0))
    .toBe(before + 200)
  // cross-check the DOM totals against the data layer through __chat
  const dataTotal = await page.evaluate(() => {
    const w = window as any
    return Object.keys(w.__chat.messages[w.__chat.value] as Record<string, unknown>).length
  })
  expect(dataTotal).toBe(before + 200)
})
