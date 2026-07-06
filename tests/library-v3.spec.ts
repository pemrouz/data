import { test, expect, type Page } from '@playwright/test'

// Smoke test for examples/library-v3/ — the faceted media browser on the v3
// engine, browsing as SET ALGEBRA over one keyed source. Ports
// tests/library.spec.ts scenario-for-scenario (library-v3 keeps ../library's
// CSS classes, ids and data-* attributes), with the v3 differences baked in:
//   - the page window is 24 (+24 per load-more), not v2's 60/120 — and it is
//     a REACTIVE za('rating', n) window: load-more writes n+24 and the window
//     grows IN PLACE (v2's repage()-a-fresh-za concept is deleted);
//   - the range brushes write through raf() coalescing writers (one commit
//     per frame, .flush() on change/pointerup), so slider assertions poll;
//   - chip highlights (class 'on') and slider thumb positions DERIVE from the
//     reactive state via bind() — value is a LIVE prop, so clear-all snaps
//     the thumbs home and empties #search without any manual DOM pass, and a
//     clamped thumb is written BACK to the input mid-drag (v2 never wrote
//     thumbs back);
//   - facet selections re-point mirror slots at TRANSIENT unions/filters that
//     are dispose()d after re-pointing away — where the DOM alone can't show
//     an engine property (graph-node leaks, commit coalescing) the spec reads
//     it through window.__library + Symbol.for('data.v3.node') (the shared-
//     registry symbol: handle[node].runtime exposes graph() / onCommit()).

const url = 'http://127.0.0.1:3000/examples/library-v3/'

const GENRES = ['Action', 'Drama', 'SciFi', 'Comedy', 'Thriller', 'Horror', 'Romance', 'Crime', 'Fantasy', 'Doc']

const count = (page: Page) => page.locator('.count .cnum').textContent()
const cardIds = (page: Page) =>
  page.locator('.card').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.id))
const cardGenres = (page: Page) =>
  page.locator('.card').evaluateAll(els =>
    els.map(e => [...e.querySelectorAll('.cg')].map(x => x.textContent)))
const cardTitles = (page: Page) =>
  page.locator('.card .ctitle').evaluateAll(els => els.map(e => e.textContent || ''))
const scores = (page: Page) =>
  page.locator('.card .score').evaluateAll(els =>
    els.map(e => parseFloat((e as HTMLElement).textContent || 'NaN')))

// Live graph-node count through the debug hooks: DataNodes register on the
// runtime; graph() filters disposed nodes, so this is the leak metric.
const graphSize = (page: Page) =>
  page.evaluate(() => {
    const w = window as any
    return w.__library.media[Symbol.for('data.v3.node')].runtime.graph().length as number
  })

// Set a range thumb the way a drag does: write the value, fire input (the
// raf-coalesced path), fire change (the writer's flush()).
const setThumb = (page: Page, sel: string, v: number) =>
  page.locator(sel).evaluate((el, val) => {
    ;(el as HTMLInputElement).value = String(val)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, v)

test('library-v3 boots: 6,000 titles, a 24-card za window, DOM ≡ data, no errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

  await page.goto(url)
  await expect(page.locator('.card')).toHaveCount(24)
  expect(await count(page)).toBe('6,000')

  // grid = browsing.za('rating', n) — descending by rating
  const s = await scores(page)
  expect(s.every((x, i) => i === 0 || s[i - 1] >= x)).toBe(true)

  // DOM ≡ data: an ORDERED v3 view keeps the source's row KEYS (movie ids)
  // with a separate order channel, so the rendered data-id sequence must be
  // exactly the za window's currentOrder() — no v2 positional-key read-back.
  expect(await page.evaluate(() => {
    const w = window as any
    const order = w.__library.views.grid[Symbol.for('data.v3.node')].currentOrder() as (string | number)[]
    const dom = [...document.querySelectorAll('.card')].map(e => (e as HTMLElement).dataset.id)
    return dom.length === order.length && dom.every((id, i) => id === String(order[i]))
  })).toBe(true)

  expect(errors).toEqual([])
})

test('union within a facet, intersect across facets, except for exclusions', async ({ page }) => {
  await page.goto(url)

  // union: SciFi OR Thriller — the genre slot re-points at a transient union
  await page.locator('.facet-genres .chip[data-key="SciFi"]').click()
  await page.locator('.facet-genres .chip[data-key="Thriller"]').click()
  // chip highlight DERIVES from the sel source via a class bind — no v2
  // syncChips DOM pass ran, yet both chips carry .on
  await expect(page.locator('.facet-genres .chip.on')).toHaveCount(2)
  const afterUnion = +(await count(page))!.replace(/,/g, '')
  expect(afterUnion).toBeLessThan(6000)
  for (const gs of await cardGenres(page))
    expect(gs.includes('SciFi') || gs.includes('Thriller')).toBe(true)

  // intersect: AND a decade — strictly narrows
  await page.locator('.facet-decades .chip[data-key="1990"]').click()
  const afterDecade = +(await count(page))!.replace(/,/g, '')
  expect(afterDecade).toBeLessThan(afterUnion)

  // except: exclude Horror — no visible card has Horror
  await page.locator('.facet-exclude .chip[data-key="Horror"]').click()
  for (const gs of await cardGenres(page)) expect(gs.includes('Horror')).toBe(false)

  // the header count is browsing.length() on the SAME chain the grid renders
  // from — cross-check the DOM text against the data layer
  const shown = (await count(page))!.replace(/,/g, '')
  expect(await page.evaluate(() => {
    const w = window as any
    return String(w.__library.views.resultCount[w.__library.value])
  })).toBe(shown)
})

test('excluding EVERY genre empties the browse; clear all recovers cleanly', async ({ page }) => {
  await page.goto(url)
  // every title carries 1–3 of the 10 genres, so excluding all 10 makes the
  // exclusion slot an almost-everything union and except() subtracts the lot
  for (const g of GENRES) await page.locator(`.facet-exclude .chip[data-key="${g}"]`).click()
  await expect(page.locator('.card')).toHaveCount(0)
  expect(await count(page)).toBe('0')
  // clean recovery: clear-all re-points the exclusion slot at the EMPTY
  // source and disposes the 10-way transient union — full catalogue returns
  await page.locator('.clearbtn').click()
  expect(await count(page)).toBe('6,000')
  await expect(page.locator('.card')).toHaveCount(24)
  await expect(page.locator('.chip.on')).toHaveCount(0)
})

test('load more GROWS the reactive za window in place — no repage, no re-render', async ({ page }) => {
  await page.goto(url)
  await expect(page.locator('.card')).toHaveCount(24)
  const first = page.locator('.card').first()
  const firstHandle = await first.elementHandle()

  await page.locator('.more').click()
  await expect(page.locator('.card')).toHaveCount(48)

  // the window size is DATA: load-more wrote pageSize.n = 24+24, and the ONE
  // standing za view re-windowed itself (v2 minted a fresh za per size)
  expect(await page.evaluate(() => {
    const w = window as any
    return w.__library.pageSize.get('n')[w.__library.value] as number
  })).toBe(48)

  // growth admits ranks 25–48 only; ranks 1–24 receive no delta, so the keyed
  // list sink leaves their DOM elements untouched — the first card is the
  // SAME element, not a rebuild
  expect(await first.evaluate((el, prev) => el === prev, firstHandle)).toBe(true)

  // still one contiguous descending window
  const s = await scores(page)
  expect(s.length).toBe(48)
  expect(s.every((x, i) => i === 0 || s[i - 1] >= x)).toBe(true)
})

test('clear all resets count, chips, page, thumbs and search — all reactively', async ({ page }) => {
  await page.goto(url)
  await expect(page.locator('.card')).toHaveCount(24)

  // dirty everything: a genre facet, the rating ceiling, the search box
  await page.locator('.facet-genres .chip[data-key="Drama"]').click()
  await setThumb(page, '#rhi', 7)
  await expect.poll(() => count(page)).not.toBe('6,000')
  // the ceiling landed AND was written back to the thumb (live value prop)
  await expect(page.locator('#rhi')).toHaveValue('7')

  // search mints a transient filter (rAF-coalesced re-point) — poll until the
  // narrowed window shows only matching titles
  await page.locator('#search').fill('velvet')
  await expect.poll(async () => {
    const ts = await cardTitles(page)
    return ts.length > 0 && ts.every(t => t.includes('Velvet'))
  }).toBe(true)

  await page.locator('.clearbtn').click()
  expect(await count(page)).toBe('6,000')
  await expect(page.locator('.card')).toHaveCount(24) // page reset to one window
  await expect(page.locator('.chip.on')).toHaveCount(0)
  // thumbs snapped home REACTIVELY: their positions derive from the bounds
  // tuple through bind() — v2 needed a manual syncRanges() DOM pass here
  await expect(page.locator('#rlo')).toHaveValue('4')
  await expect(page.locator('#rhi')).toHaveValue('9.5')
  await expect(page.locator('#tlo')).toHaveValue('80')
  await expect(page.locator('#thi')).toHaveValue('180')
  // and #search's value is bound to sel.q — emptied without a querySelector
  await expect(page.locator('#search')).toHaveValue('')
})

test('a crossed thumb is clamped and written BACK to the input mid-drag', async ({ page }) => {
  await page.goto(url)
  await expect(page.locator('.card')).toHaveCount(24)

  await setThumb(page, '#rhi', 6)
  await expect(page.locator('#rhi')).toHaveValue('6')

  // drag the FLOOR past the ceiling: the handler clamps lo to hi=6, and since
  // the thumb position DERIVES from the bounds tuple (value is a LIVE prop)
  // the clamp is written back to the input DURING the drag — v2 never wrote
  // thumbs back, it just ignored the crossed extent
  await setThumb(page, '#rlo', 8)
  await expect(page.locator('#rlo')).toHaveValue('6')

  // the pinched selection [6,6] is live: every visible card rates exactly 6.0
  await expect.poll(async () => {
    const s = await scores(page)
    return s.length > 0 && s.every(x => Math.abs(x - 6) < 1e-9)
  }).toBe(true)
})

// The v2 hot path, ported: the ceiling drag over the bounded za window. In v3
// the brush is a reactive between bound (an O(Δ) boundary walk) feeding the
// standing intersect → except → za chain; the raf writer coalesces the drag,
// so each stop's assertion polls.
test('rating brush filters + re-sorts correctly under a drag', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(url)
  await expect(page.locator('.card')).toHaveCount(24)

  // drag the ceiling down through several stops; after each, every card must
  // be ≤ ceiling and the list must stay sorted descending
  for (const hi of [9.0, 8.0, 7.0, 6.0, 5.5]) {
    await page.locator('#rhi').evaluate((el, v) => {
      ;(el as HTMLInputElement).value = String(v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }, hi)
    await expect.poll(async () => {
      const s = await scores(page)
      return s.length > 0 && s.every(x => x <= hi + 1e-9) && s.every((x, i) => i === 0 || s[i - 1] >= x)
    }).toBe(true)
  }
  // plenty of titles still rate ≤ 5.5, so the 24-window stays full
  await expect(page.locator('.card')).toHaveCount(24)
  expect(errors).toEqual([])
})

test('rendered cards stay consistent (no duplicates/stale) through facet churn', async ({ page }) => {
  await page.goto(url)
  await expect(page.locator('.card')).toHaveCount(24)

  // a churn sequence of toggles that re-points slots, mints/disposes
  // transient unions and re-windows the sort
  const toggles = [
    '.facet-genres .chip[data-key="Action"]',
    '.facet-genres .chip[data-key="Comedy"]',
    '.facet-decades .chip[data-key="2010"]',
    '.facet-exclude .chip[data-key="Drama"]',
    '.facet-genres .chip[data-key="Action"]', // un-toggle
    '.facet-decades .chip[data-key="2020"]',
  ]
  for (const sel of toggles) { await page.locator(sel).click(); await page.waitForTimeout(40) }

  const ids = await cardIds(page)
  // no duplicate cards
  expect(new Set(ids).size).toBe(ids.length)
  // rendered card count == min(pageSize=24, resultCount)
  const n = +(await count(page))!.replace(/,/g, '')
  expect(ids.length).toBe(Math.min(24, n))
  // every card still satisfies the live facets (Comedy, 2010|2020, not Drama)
  for (const gs of await cardGenres(page)) {
    expect(gs.includes('Comedy')).toBe(true)
    expect(gs.includes('Drama')).toBe(false)
  }
  const decades = await page.locator('.card .cdecade').evaluateAll(els => els.map(e => e.textContent))
  for (const d of decades) expect(d === '2010s' || d === '2020s').toBe(true)
})

// ── v3 engine proofs the DOM alone can't show (via window.__library) ─────────

test('transient unions/filters are disposed on re-point — the graph does not leak', async ({ page }) => {
  await page.goto(url)
  await expect(page.locator('.card')).toHaveCount(24)

  // Chip churn: each 2-selection mints a transient union node, each
  // deselection back to ≤1 disposes it. Clicks re-point synchronously (no
  // rAF on this path), so the whole churn runs in one evaluate. One warm-up
  // cycle first, then the baseline, so first-touch lazy work can't skew it.
  const { baseline, after } = await page.evaluate(() => {
    const w = window as any
    const rt = w.__library.media[Symbol.for('data.v3.node')].runtime
    const chip = (facet: string, key: string) =>
      document.querySelector(`.facet-${facet} .chip[data-key="${key}"]`) as HTMLElement
    const cycle = () => {
      chip('genres', 'SciFi').click(); chip('genres', 'Drama').click() // union minted
      chip('exclude', 'Horror').click(); chip('exclude', 'Doc').click() // union minted
      chip('genres', 'Drama').click(); chip('genres', 'SciFi').click() // disposed
      chip('exclude', 'Doc').click(); chip('exclude', 'Horror').click() // disposed
    }
    cycle() // warm-up
    const baseline = rt.graph().length as number
    for (let i = 0; i < 10; i++) cycle()
    return { baseline, after: rt.graph().length as number }
  })
  expect(after).toBe(baseline)
  // the view recovered exactly — the churn left no data residue either
  expect(await count(page)).toBe('6,000')
  await expect(page.locator('.card')).toHaveCount(24)

  // Search transients too: each query mints a filter node (disposed on the
  // next rAF-coalesced re-point); a type-then-clear session leaves none
  for (const q of ['velvet', 'ghost', '']) {
    await page.locator('#search').fill(q)
    await page.waitForTimeout(50) // let the rAF re-point + dispose land
  }
  await expect.poll(() => graphSize(page)).toBe(baseline)
})

test('a slider drag is rAF-coalesced: 20 input events commit like ONE write', async ({ page }) => {
  await page.goto(url)
  await expect(page.locator('.card')).toHaveCount(24)

  // Count runtime commits over a burst of same-frame input events. The raf
  // writer holds the latest pending tuple and commits ONCE on the next frame.
  const commitsFor = (vals: number[]) =>
    page.evaluate(async vs => {
      const w = window as any
      const rt = w.__library.media[Symbol.for('data.v3.node')].runtime
      let commits = 0
      const hook = rt.onCommit(() => commits++)
      const el = document.querySelector('#rhi') as HTMLInputElement
      for (const v of vs) {
        el.value = String(v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      // two frames + slack: the writer's frame fires, the flush completes
      await new Promise<void>(r =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => r(), 50))))
      hook.dispose()
      return commits
    }, vals)

  // ONE write is worth a couple of commits (the bounds commit plus the
  // reactive-between re-select, which defers to a second commit in the same
  // flush) — measure it rather than hardcode the kernel's commit anatomy
  const c1 = await commitsFor([9.0])
  expect(c1).toBeGreaterThanOrEqual(1)
  expect(c1).toBeLessThanOrEqual(3)

  // a 20-event same-task burst coalesces to EXACTLY the same commit count —
  // the drag pays one cascade per frame, not one per event
  const sweep = Array.from({ length: 20 }, (_, i) => +(8.9 - i * 0.1).toFixed(1))
  const c20 = await commitsFor(sweep)
  expect(c20).toBe(c1)

  // and the LATEST pending value is what landed
  await expect(page.locator('#rhi')).toHaveValue('7')
  const s = await scores(page)
  expect(s.length).toBe(24)
  expect(s.every(x => x <= 7 + 1e-9)).toBe(true)
})
