// Screenshot harness: captures the page at several scroll offsets.
// usage: node shot.mjs <url> <outPrefix> [scrollY ...]   (default offsets if none given)
// Run with cwd = the data repo root so `playwright` resolves from its node_modules.
import { chromium } from 'playwright'

const [url, outPrefix, ...offsets] = process.argv.slice(2)
const ys = offsets.length ? offsets.map(Number) : [0]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(700)

for (const y of ys) {
  await page.evaluate(t => window.scrollTo({ top: t, behavior: 'instant' }), y)
  await page.waitForTimeout(450)
  const path = `${outPrefix}-y${y}.png`
  await page.screenshot({ path })
  console.log('wrote', path)
}

const height = await page.evaluate(() => document.documentElement.scrollHeight)
console.log('scrollHeight:', height)
if (errors.length) { console.log('PAGE ERRORS:'); for (const e of errors) console.log(' ', e) }
await browser.close()
