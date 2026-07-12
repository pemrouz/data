import { test, expect } from '@playwright/test'

// Regression: a `za`/sort view that rotates a row in-window emits a BMV1 move
// event. Rows are index-keyed — each DOM node is bound to the positional child
// view top[k], and core's Value.BMV1 already refreshes every affected slot's
// content before the DOM sink sees the move. DOMSink.BMV1 used to ALSO splice
// the element to its new sibling position, double-applying the rotation and
// leaving the rendered list out of order (visible on the landing page's `za`
// operator demo: rows 4 and 5 displayed swapped). The fix makes DOMSink.BMV1 a
// no-op; this test pins the rendered DOM order to the sorted view.value across
// several in-window rotations.

test('render — za list DOM order tracks the sorted view across rotations', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e: any) => errors.push(String(e)))
  page.on('console', (m: any) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

  // any served page works as a host for the importmap — use the landing page
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  const result = await page.evaluate(async () => {
    const { $, render, HTML, value } = await import('/dist/v2/full.js' as any)
    const { div, span } = HTML
    const host = document.createElement('div')
    document.body.appendChild(host)

    const rows = $([
      { id: 'a', pnl: 10 }, { id: 'b', pnl: 50 }, { id: 'c', pnl: 30 },
      { id: 'd', pnl: 20 }, { id: 'e', pnl: 40 },
    ])
    const top = rows.za('pnl', 5)
    render(host, div(
      div.row(top, (node: any, t: any) => node(
        span.kid.text(t.id), span.kpnl.text(t.pnl),
      ))
    ))

    const domIds = () => [...host.querySelectorAll('.row')].map((r: any) => r.querySelector('.kid')?.textContent)
    const viewIds = () => top[value].map((r: any) => r.id)

    const snaps: any[] = []
    const snap = (label: string) => snaps.push({ label, dom: domIds(), view: viewIds() })

    snap('initial')
    rows[0].pnl = 99   // a: 10 -> 99   (tail -> head)
    snap('a=99')
    rows[3].pnl = 45   // d: 20 -> 45   (mid rotation)
    snap('d=45')
    rows[1].pnl = 5    // b: 50 -> 5    (head -> tail)
    snap('b=5')
    return snaps
  })

  // every snapshot: rendered DOM order must equal the sorted view order
  for (const s of result) expect(s.dom, s.label).toEqual(s.view)

  // and the final order is the expected descending sort
  expect(result.at(-1).view).toEqual(['a', 'd', 'e', 'c', 'b'])
  expect(errors).toEqual([])
})
