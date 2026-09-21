// tools/drag.mjs — a mid-interaction shot: press, drag, screenshot (before mouseup), release.
// usage: node proto/site-v7/tools/drag.mjs <url> <out.png> x0 y0 x1 y1 [--width 1440 --height 900] [--hold ms]
//        node proto/site-v7/tools/drag.mjs <url> <out.png> --sel '<css>' [--dx -190 --dy 0]   (press at the element's centre)
import { chromium } from 'playwright'
const args = process.argv.slice(2)
const url = args.shift(), outPath = args.shift()
const nums = []
let width = 1440, height = 900, hold = 250, sel = null, dx = -190, dy = 0
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--width') width = +args[++i]
  else if (args[i] === '--height') height = +args[++i]
  else if (args[i] === '--hold') hold = +args[++i]
  else if (args[i] === '--sel') sel = args[++i]
  else if (args[i] === '--dx') dx = +args[++i]
  else if (args[i] === '--dy') dy = +args[++i]
  else nums.push(+args[i])
}
let [x0, y0, x1, y1] = nums
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
if (sel) { // --sel '<css>': press at the element's centre, drag by --dx/--dy (default -190,0)
  const r = await page.$eval(sel, el => { const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })
  x0 = r.x; y0 = r.y; x1 = r.x + dx; y1 = r.y + dy
  console.log('drag from', Math.round(x0), Math.round(y0), 'to', Math.round(x1), Math.round(y1))
}
await page.mouse.move(x0, y0)
await page.mouse.down()
const steps = 40
for (let i = 1; i <= steps; i++) {
  await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)
  await page.waitForTimeout(16)
}
await page.waitForTimeout(hold)
await page.screenshot({ path: outPath })
await page.mouse.up()
console.log('wrote', outPath)
if (errors.length) { console.log('PAGE ERRORS:'); for (const e of errors) console.log(' ', e) }
await browser.close()
