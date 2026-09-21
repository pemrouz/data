// tools/probe.mjs — the honest fps/phase probe. usage:
//   node proto/site-v7/tools/probe.mjs <url> [--drag x0,y0,x1,y1 | --sel '<css>' [--dx -190 --dy 0]] [--dwell ms] [scrollY ...]
// Reads window.__fpsSamples (rAF deltas, ms) and window.__perf from the page;
// prints median fps at rest and, with --drag, during a scripted pointer drag.
// Run with cwd = repo root so the orphaned `playwright` resolves.
import { chromium } from 'playwright'
const args = process.argv.slice(2)
const url = args.shift()
let drag = null, dwell = 2500, sel = null, dx = -190, dy = 0
const ys = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--drag') drag = args[++i].split(',').map(Number)
  else if (args[i] === '--dwell') dwell = +args[++i]
  else if (args[i] === '--sel') sel = args[++i]
  else if (args[i] === '--dx') dx = +args[++i]
  else if (args[i] === '--dy') dy = +args[++i]
  else ys.push(+args[i])
}
if (!ys.length) ys.push(0)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
if (sel) { // --sel '<css>': drag from the element's centre by --dx/--dy
  const r = await page.$eval(sel, el => { const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })
  drag = [r.x, r.y, r.x + dx, r.y + dy]
}
const read = () => page.evaluate(() => {
  const s = (window.__fpsSamples ?? []).slice(-120).sort((a, b) => a - b)
  const med = s.length ? s[s.length >> 1] : 0
  const perf = {}
  for (const [k, v] of Object.entries(window.__perf ?? {})) perf[k] = typeof v === 'number' ? +v.toFixed(2) : v
  return { samples: s.length, fps: med ? +(1000 / med).toFixed(1) : null, perf }
})
for (const y of ys) {
  await page.evaluate(t => window.scrollTo({ top: t, behavior: 'instant' }), y)
  await page.evaluate(() => { if (window.__fpsSamples) window.__fpsSamples.length = 0 })
  await page.waitForTimeout(dwell)
  console.log('rest', 'y', y, JSON.stringify(await read()))
  if (drag) {
    const [x0, y0, x1, y1] = drag
    await page.evaluate(() => { if (window.__fpsSamples) window.__fpsSamples.length = 0 })
    await page.mouse.move(x0, y0)
    await page.mouse.down()
    const steps = 60
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)
      await page.waitForTimeout(16)
    }
    console.log('drag', 'y', y, JSON.stringify(await read()))
    await page.mouse.up()
  }
}
if (errors.length) { console.log('PAGE ERRORS:'); for (const e of errors) console.log(' ', e) }
await browser.close()
