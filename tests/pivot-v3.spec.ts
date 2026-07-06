import { test, expect, type Page } from '@playwright/test'

// Smoke test for examples/pivot-v3/ — the pivot table on the v3 engine (the
// fifth M5 migration), where EVERY cell, row/column total, and the grand total
// is a standing filter→aggregate chain over one $({}) source. (v3 has no
// group-bucket chaining — bucket children are path addresses — so per-cell
// filters are the idiom; every scalar derives from the SAME source and
// reconciles by construction.) Ports tests/pivot.spec.ts scenario-for-scenario
// (pivot-v3 keeps ../pivot's class names/ids exactly), adding the v3 engine
// proofs the migration is really about:
//   - RECONCILIATION: the DOM grand/row totals and header metrics are
//     cross-checked against a plain fold over the window.__pivot snapshot
//     (the crossfilter-v3 idiom — DOM ≡ data, not just "some text rendered");
//   - ONE-COMMIT BATCHES: +100 is a single sales.patch([[id, row]…]) tuple
//     batch and shuffle is a batch() of in-place set('region', …) writes. A
//     MutationObserver proves each grid text node is written AT MOST ONCE per
//     click (scalars settle once per COMMIT, not once per row — 100 separate
//     commits would write the running total ~100 times), that no childList
//     mutation ever fires (static domain lists: data never restructures the
//     grid), and that shuffle writes the grand-total cell ZERO times (revenue
//     is conserved and the renderer skips identical text);
//   - TRANSIENT-DISPOSE CHURN: a config change disposes the render handle and
//     every transient filter/aggregate, then rebuilds. The spec counts the
//     source node's attached operators (children of __pivot.sales's kernel
//     node, reached via the registry symbol Symbol.for('data.v3.node')) and
//     asserts repeated config cycles stay FLAT. The baseline is taken AFTER
//     one full measure cycle: grand totals / header metrics are DEDUPED
//     source-level aggregates minted once per measure and deliberately never
//     disposed (the per-handle dedup cache does not evict on dispose, so
//     disposing one would leave the cache handing back a dead frozen node —
//     the documented workaround, bounded at one standing scalar per measure).
//     A final +100 click proves those long-lived grands are still LIVE after
//     all the churn — a disposed-but-cached node would never move again.

const url = 'http://127.0.0.1:3000/examples/pivot-v3/'

const grandRevenue = (page: Page) =>
  page.locator('.metrics .metric', { hasText: 'revenue' }).locator('.mval').textContent()
const rowTotals = (page: Page) =>
  page.locator('.twoD .rowtotal').allTextContents()
// attached-operator count on the source's kernel node (filters + aggregates
// chain off `sales`; dispose() removes a node from its parents' children)
const sourceChildren = (page: Page) =>
  page.evaluate(
    () => (window as any).__pivot.sales[Symbol.for('data.v3.node')].children.length as number,
  )

test('pivot-v3 boots in 2-D and every total reconciles with a manual fold over the source', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

  await page.goto(url)
  await expect(page.locator('.ptable.twoD')).toBeVisible()
  // region(4) rows × (rowkey + 4 cats + rowtotal) + header(6) + footer(6) = 36
  await expect(page.locator('.twoD .pcell')).toHaveCount(36)
  await expect(page.locator('.twoD .rowtotal')).toHaveCount(4)

  // DOM ≡ data: footer grand, each region's row total, and both header
  // metrics equal a plain-JS fold over the [value] snapshot — every scalar is
  // a standing view off the SAME source, so they reconcile by construction.
  const r = await page.evaluate(() => {
    const w = window as any
    const snap = w.__pivot.sales[w.__pivot.value] as Record<string, { region: string; revenue: number }>
    const rows = Object.values(snap)
    const fmt = (n: number) => (n >= 1000 ? '$' + (n / 1000).toFixed(1) + 'k' : '$' + Math.round(n))
    const sum = (xs: { revenue: number }[]) => xs.reduce((a, s) => a + s.revenue, 0)
    const mvals = Array.from(document.querySelectorAll('.metrics .mval')).map(el => el.textContent)
    return {
      nRows: rows.length,
      grandData: fmt(sum(rows)),
      grandDom: document.querySelector('.foot.grand')!.textContent,
      rowData: ['North', 'South', 'East', 'West'].map(rv => fmt(sum(rows.filter(s => s.region === rv)))),
      rowDom: Array.from(document.querySelectorAll('.twoD .rowtotal')).map(el => el.textContent),
      metricRows: mvals[0],
      metricRevenue: mvals[1],
      metricRowsData: rows.length.toLocaleString(),
    }
  })
  expect(r.nRows).toBe(2000)
  expect(r.grandDom).toBe(r.grandData)
  expect(r.rowDom).toEqual(r.rowData)
  expect(r.metricRows).toBe(r.metricRowsData)
  expect(r.metricRevenue).toBe(r.grandData)
  expect(errors).toEqual([])
})

test('switching column field to none gives the 1-D table with share-of-total bars', async ({ page }) => {
  await page.goto(url)
  await page.selectOption('#colField', 'none')
  await expect(page.locator('.ptable.oneD')).toBeVisible()
  await expect(page.locator('.oneD .pbody .prow')).toHaveCount(4) // 4 regions
  // each bar's width is bind(rowScalar, share-of-grand) — a real percentage
  await expect(page.locator('.oneD .barfill').first()).toBeVisible()
  await expect(page.locator('.oneD .barfill').first()).toHaveAttribute('style', /width:\d+%/)
})

test('switching measure rebuilds the grid with the new aggregate', async ({ page }) => {
  await page.goto(url)
  const before = await page.locator('.twoD .rowtotal').first().textContent()
  await page.selectOption('#measure', 'count')
  await expect(page.locator('.twoD .rowtotal').first()).not.toHaveText(before!)
  // count totals are bare integers (no '$'), and the first row total (North)
  // reconciles with a manual count over the snapshot slice
  const r = await page.evaluate(() => {
    const w = window as any
    const snap = w.__pivot.sales[w.__pivot.value] as Record<string, { region: string }>
    return {
      northData: String(Object.values(snap).filter(s => s.region === 'North').length),
      northDom: document.querySelector('.twoD .rowtotal')!.textContent,
    }
  })
  expect(r.northDom).not.toContain('$')
  expect(r.northDom).toBe(r.northData)
})

test('+100 sales is ONE patch commit: the grand total moves with a single DOM write', async ({ page }) => {
  await page.goto(url)
  const before = await grandRevenue(page)

  // watch the footer grand cell: 100 keyed inserts land as one [key, row]
  // tuple batch → one commit → the standing sum settles ONCE → one
  // characterData write. Per-row commits would write the running total ~100×.
  await page.evaluate(() => {
    const w = window as any
    w.__writes = [] as MutationRecord[]
    w.__obs = new MutationObserver(rs => w.__writes.push(...rs))
    w.__obs.observe(document.querySelector('.foot.grand')!, {
      characterData: true, childList: true, subtree: true,
    })
  })
  await page.locator('#add100').click()
  await expect.poll(() => grandRevenue(page)).not.toBe(before)
  const writes = await page.evaluate(() => {
    const w = window as any
    w.__writes.push(...w.__obs.takeRecords())
    w.__obs.disconnect()
    const recs = w.__writes as MutationRecord[]
    return {
      characterData: recs.filter(r => r.type === 'characterData').length,
      childList: recs.filter(r => r.type === 'childList').length,
    }
  })
  expect(writes.characterData).toBe(1)
  expect(writes.childList).toBe(0) // static domains: inserts never restructure the grid
  // the rows header metric absorbed exactly the batch
  await expect(page.locator('.metrics .mval').first()).toHaveText((2100).toLocaleString())
})

test('shuffle is ONE batch commit: totals move at most once each, grand conserved', async ({ page }) => {
  await page.goto(url)
  const grandBefore = await grandRevenue(page)
  const rowsBefore = await rowTotals(page)

  // observe EVERY text node in the grid: 200 in-place `set('region', …)`
  // writes inside one batch() → one commit → each changed scalar settles once
  // → each text node is written at most ONCE. The grand cell gets ZERO writes
  // (region moves conserve revenue; the renderer skips identical text) and no
  // structural mutation fires (in-place edits patch cells surgically).
  await page.evaluate(() => {
    const w = window as any
    w.__writes = [] as MutationRecord[]
    w.__obs = new MutationObserver(rs => w.__writes.push(...rs))
    w.__obs.observe(document.querySelector('.ptable.twoD')!, {
      characterData: true, childList: true, subtree: true,
    })
  })
  await page.locator('#shuffle').click()
  // some region row total changed (rowField is 'region' — sales moved slices)
  await expect.poll(() => rowTotals(page)).not.toEqual(rowsBefore)
  const writes = await page.evaluate(() => {
    const w = window as any
    w.__writes.push(...w.__obs.takeRecords())
    w.__obs.disconnect()
    const grand = document.querySelector('.foot.grand')!
    const perTarget = new Map<Node, number>()
    let childList = 0
    let grandWrites = 0
    for (const r of w.__writes as MutationRecord[]) {
      if (r.type === 'childList') { childList++; continue }
      perTarget.set(r.target, (perTarget.get(r.target) ?? 0) + 1)
      if (grand.contains(r.target)) grandWrites++
    }
    const counts = Array.from(perTarget.values())
    return { total: counts.length, max: counts.length ? Math.max(...counts) : 0, childList, grandWrites }
  })
  expect(writes.total).toBeGreaterThan(0)
  expect(writes.max).toBe(1) // one commit: no text node written twice
  expect(writes.childList).toBe(0) // surgical: no row/cell rebuilt
  expect(writes.grandWrites).toBe(0)
  // …and total revenue is conserved (shuffle only changes region, not revenue)
  expect(await grandRevenue(page)).toBe(grandBefore)
})

test('config-change churn stays flat: transients disposed, deduped grands stay live', async ({ page }) => {
  await page.goto(url)

  // One full cycle through every measure (+ a colField flip) mints each
  // measure's grand ONCE — deduped source-level aggregates the example
  // deliberately never disposes (the dedup cache doesn't evict on dispose, so
  // disposing one would freeze it forever). Baseline AFTER that first cycle;
  // later identical cycles must not grow the source's operator count at all:
  // every per-cell filter→aggregate chain was dispose()d on rebuild.
  const cycle = async () => {
    for (const m of ['count', 'avg', 'units', 'max', 'revenue']) await page.selectOption('#measure', m)
    await page.selectOption('#colField', 'none')
    await page.selectOption('#colField', 'category')
  }
  await cycle()
  const baseline = await sourceChildren(page)
  expect(baseline).toBeGreaterThan(20) // the live grid's 24 filters are really attached
  expect(baseline).toBeLessThan(40) // 24 grid filters + ≤5 deduped grands (one per measure)

  for (let i = 0; i < 3; i++) {
    await cycle()
    expect(await sourceChildren(page)).toBe(baseline)
  }

  // after all that churn the long-lived deduped grand is still LIVE: a write
  // still moves the footer total (a disposed-but-cached node would be frozen)
  const grand = page.locator('.foot.grand')
  const before = await grand.textContent()
  await page.locator('#add100').click()
  await expect.poll(() => grand.textContent()).not.toBe(before)
})
