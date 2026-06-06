// @ts-nocheck
import { test, expect } from '@playwright/test'

// Regression test for the landing-page `tap` operator demo (assets/demos.js).
//
// The tap demo's "events received" counter is incremented by a SIDE-EFFECT tap
// (`trades.tap(() => tapN[value] = ++n)`) — the one demo operator with no
// downstream render sink. It was originally anchored only by
// `const _tapKeepAlive = trades.tap(...); void _tapKeepAlive`, which V8 happily
// reclaims: once the binding is provably never read again and no closure
// captures it, the sink's WeakRef (core.ts — sinks are held weakly) dies and the
// tap silently stops firing. The visible symptom: the counter froze after a
// few ticks while the "last mutation" panel (driven directly by mutateOnce in
// feed.js, not through any sink) kept ticking — so the counter changed FAR less
// than the ticker. Fix: anchor the tap on the card's DOM node (`tapEl._tap`),
// alive for the page's life, mirroring multidim's `chartsRoot._chains`.
//
// This test forces GC repeatedly (needs --expose-gc, set below) and asserts the
// counter keeps climbing. Pre-fix it would freeze (delta ~0); post-fix it
// tracks the mutation stream (delta in the dozens over the window).

test.use({ launchOptions: { args: ['--js-flags=--expose-gc'] } })

const HOME = 'http://127.0.0.1:3000/'

test('tap demo — counter keeps firing under GC (sink not collected)', async ({ page }) => {
  test.setTimeout(60_000)
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))

  await page.goto(HOME, { timeout: 90_000 })
  const counter = page.locator('#tap-result .tap-counter')
  // streams regardless of card expansion (the feed only pauses on a hidden tab)
  await expect(counter).toHaveText(/\d/, { timeout: 15_000 })

  const hasGc = await page.evaluate(() => typeof (window as any).gc === 'function')
  expect(hasGc, '--expose-gc must be active for this regression test').toBe(true)

  const read = () => page.evaluate(() => +document.querySelector('#tap-result .tap-counter')!.textContent!)
  const start = await read()

  // ~5s of streaming with GC forced every 250ms — the window in which the
  // un-anchored sink used to be collected and go silent.
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(250)
    await page.evaluate(() => (window as any).gc())
  }

  const end = await read()
  const delta = end - start
  // Pre-fix froze at delta ~0-2; post-fix climbs by ~100+ over 5s. 20 is a wide
  // margin that cleanly separates "still firing" from "GC'd and frozen".
  expect(delta, `tap counter only advanced by ${delta} under GC — the sink was collected`).toBeGreaterThan(20)

  expect(errors, errors.join('\n')).toHaveLength(0)
})
