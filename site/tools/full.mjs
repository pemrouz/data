// tools/full.mjs — full-page screenshot. usage: node site/tools/full.mjs <url> <out.png> [--width 1440]
import { chromium } from 'playwright'
const args = process.argv.slice(2)
const url = args.shift(), out = args.shift()
let width = 1440
for (let i = 0; i < args.length; i++) if (args[i] === '--width') width = +args[++i]
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(900)
// scroll through once so lazy/IntersectionObserver content mounts
const h = await page.evaluate(() => document.documentElement.scrollHeight)
for (let y = 0; y < h; y += 700) { await page.evaluate(t => window.scrollTo(0, t), y); await page.waitForTimeout(120) }
await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(400)
await page.screenshot({ path: out, fullPage: true })
console.log('wrote', out, 'scrollHeight', await page.evaluate(() => document.documentElement.scrollHeight))
if (errors.length) { console.log('PAGE ERRORS:'); for (const e of errors) console.log(' ', e) }
await browser.close()
