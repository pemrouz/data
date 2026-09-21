// tools/sec.mjs — screenshot ONE element. usage: node site/tools/sec.mjs <url> <css-selector> <out.png> [--width 1440]
// Run with cwd = repo root (playwright resolves from the root node_modules).
import { chromium } from 'playwright'
const args = process.argv.slice(2)
const url = args.shift(), sel = args.shift(), out = args.shift()
let width = 1440
for (let i = 0; i < args.length; i++) if (args[i] === '--width') width = +args[++i]
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(900)
const loc = page.locator(sel).first()
await loc.scrollIntoViewIfNeeded()
await page.waitForTimeout(600)
await loc.screenshot({ path: out })
const box = await loc.boundingBox()
console.log('wrote', out, box ? `${Math.round(box.width)}×${Math.round(box.height)}` : '')
if (errors.length) { console.log('PAGE ERRORS:'); for (const e of errors) console.log(' ', e) }
await browser.close()
