// tools/audit.mjs — the honesty gate for one page. usage: node proto/site-v7/tools/audit.mjs <url> [--proofs N]
// Fails (exit 1) on: page errors; #engine not .ok; any [data-attested] empty or '—';
// any digit-bearing text node outside [data-attested] / pre / code / [data-literal] / noscript / script / style;
// a control without an accessible name; missing <noscript>; with --proofs, window.__proofs.fail > 0 or total ≠ N.
import { chromium } from 'playwright'
const args = process.argv.slice(2)
const url = args.shift()
let proofs = null
for (let i = 0; i < args.length; i++) if (args[i] === '--proofs') proofs = +args[++i]
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
await page.goto(url, { waitUntil: 'networkidle' })
try { await page.waitForSelector('#engine.ok', { timeout: 15000 }) } catch { errors.push('engine never reached .ok') }
await page.waitForTimeout(1500)
const report = await page.evaluate((wantProofs) => {
  const problems = []
  for (const el of document.querySelectorAll('[data-attested]')) {
    if (el.closest('[data-variant][hidden]')) continue
    const t = el.textContent.trim()
    if (!t || t === '—' || t === '–') problems.push(`[${el.closest('section')?.id ?? 'page'}] unfilled attested element: ${el.id || el.className || el.tagName}`)
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const skip = (n) => n.closest('[data-attested], pre, code, [data-literal], noscript, script, style, kbd, [data-variant][hidden], #optbar')
  let n
  while ((n = walker.nextNode())) {
    const text = n.nodeValue
    if (!/\d/.test(text)) continue
    if (skip(n.parentElement)) continue
    problems.push(`[${n.parentElement.closest('section')?.id ?? 'page'}] unattested digits: "${text.trim().slice(0, 60)}" in <${n.parentElement.tagName.toLowerCase()}${n.parentElement.id ? '#' + n.parentElement.id : ''}${n.parentElement.className ? '.' + String(n.parentElement.className).split(' ')[0] : ''}>`)
  }
  for (const c of document.querySelectorAll('button, input, select, textarea, [role=slider], [role=button]')) {
    if (c.closest('[data-variant][hidden], #optbar')) continue
    const name = c.getAttribute('aria-label') || c.getAttribute('aria-labelledby') || c.textContent.trim() || (c.id && document.querySelector(`label[for="${c.id}"]`)?.textContent.trim()) || c.closest('label')?.textContent.trim()
    if (!name) problems.push(`[${c.closest('section')?.id ?? 'page'}] control without an accessible name: <${c.tagName.toLowerCase()}${c.id ? '#' + c.id : ''}>`)
  }
  if (!document.querySelector('noscript')) problems.push('no <noscript> fallback')
  if (wantProofs !== null) {
    const p = window.__proofs
    if (!p) problems.push('window.__proofs missing')
    else { if (p.fail > 0) problems.push(`${p.fail} proof(s) failed: ${(p.failed ?? []).join('; ')}`); if (p.total !== wantProofs) problems.push(`proofs total ${p.total} ≠ ${wantProofs}`) }
  }
  return { problems, scrollHeight: document.documentElement.scrollHeight, attested: document.querySelectorAll('[data-attested]').length }
}, proofs)
await browser.close()
for (const e of errors) console.log('ERROR', e)
for (const p of report.problems) console.log('FAIL', p)
console.log(`audit ${url}: ${report.attested} attested elements, scrollHeight ${report.scrollHeight}, ${errors.length + report.problems.length} problem(s)`)
process.exit(errors.length + report.problems.length ? 1 : 0)
