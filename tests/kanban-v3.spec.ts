import { test, expect, type Page } from '@playwright/test'

// Smoke test for examples/kanban-v3/ — the kanban issue tracker on the v3
// engine via the HTML builder DSL (the fourth M5 migration). Ports
// tests/kanban.spec.ts scenario-for-scenario (kanban-v3 reuses ../kanban's
// CSS selector-for-selector) and adds the v3-specific proofs DOM assertions
// alone can't show, read through window.__kanban and the Symbol.for handle
// symbols (the same registry symbols main.js's entry uses):
//   - a drag-drop move is ONE batch() commit: effect spies on the raw board
//     node and the destination column's az view each fire exactly once —
//     unbatched status+order writes would fire the source spy twice;
//   - filtering composes ONE transient filter per column and dispose()s the
//     previous one after re-pointing the mirror slot, so each standing
//     colFilter's graph children go ['mirror'] → ['filter'] → ['mirror']
//     through churn without accumulating (the v2 kanban's per-keystroke
//     operator pileup, made structurally impossible);
//   - v3 ordered views keep CARD IDS as row keys — cards address by
//     .card[data-id] and a fractional-order drop RANKS the card in place
//     (data-id is only dropOrder's DOM hit-test + this spec's addressing;
//     handlers close over the stable id, no v2 read-back);
//   - sum() over an EMPTIED column reads 0 (v3's empty-set contract — v2 gave
//     undefined, forcing the `|| 0` guard this example dropped);
//   - the workload deck (length(fn) {value:N} histogram + 3-arg INCREMENTAL
//     reduce) tracks pill-click reassigns/points edits delta-by-delta.
// Search re-points once per frame (rAF-coalesced), so narrowed-list reads
// poll / auto-retry; chip clicks re-point synchronously in the click handler.

const url = 'http://127.0.0.1:3000/examples/kanban-v3/'

const colCount = (page: Page, s: string) => page.locator(`.col[data-status="${s}"] .col-count`)
const colPts = (page: Page, s: string) => page.locator(`.col[data-status="${s}"] .col-pts`)

// Resolve a card's stable row key (its id) from the board snapshot. main.js
// mounts as a module script, so wait for the debug hooks first.
const idOf = async (page: Page, title: string): Promise<string> => {
  await page.waitForFunction(() => !!(window as any).__kanban)
  return page.evaluate((title) => {
    const k = (window as any).__kanban
    const b = k.board[k.value] as Record<string, { title: string }>
    for (const id in b) if (b[id].title === title) return id
    throw new Error(`no card titled ${title}`)
  }, title)
}

// The graph-shape probe: each standing colFilter's children in the node
// graph, by op name. Baseline is exactly ['mirror'] (the slot); an active
// search swaps it for ['filter'] (the one transient, with the mirror
// re-pointed onto it); anything longer is a leaked transient.
const colFilterChildren = (page: Page) =>
  page.evaluate(() => {
    const k = (window as any).__kanban
    const NODE = Symbol.for('data.v3.node')
    return Object.keys(k.colFilter).map((s) =>
      k.colFilter[s][NODE].children.map((c: any) => c.opName).join(','),
    )
  })

test('kanban-v3 boots: columns, cards, aggregates, workload deck — DOM ≡ data', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

  await page.goto(url)
  await expect(page.locator('.col')).toHaveCount(5)
  await expect(page.locator('.card')).toHaveCount(20)
  await expect(page.locator('.sprint-fill')).toBeVisible()

  // seed-derived standing aggregates, each chained ONCE off the mirror slot
  await expect(colCount(page, 'todo')).toHaveText('6/8')
  await expect(colPts(page, 'todo')).toHaveText('28 pts')
  await expect(colCount(page, 'backlog')).toHaveText('5') // WIP ∞ → bare count
  await expect(colCount(page, 'in-progress')).toHaveText('3/4')
  await expect(colPts(page, 'review')).toHaveText('10 pts')
  // sprint header: one to() derive over the whole (dense) board snapshot
  await expect(page.locator('.sprint-meta')).toContainText('20 cards')
  await expect(page.locator('.sprint-meta')).toContainText('76 pts total')
  await expect(page.locator('.sprint-meta')).toContainText('7/76 pts done')
  // workload deck: length(fn) buckets are {value:N}; reduce map is plain numbers
  await expect(page.locator('.chip[data-who="ana"] .chip-load')).toHaveText('5')
  await expect(page.locator('.chip[data-who="ana"] .chip-pts')).toHaveText('23p')

  // DOM ≡ data per column through the debug hooks (the chat-v3 idiom)
  const match = await page.evaluate(() => {
    const k = (window as any).__kanban
    const b = k.board[k.value] as Record<string, { status: string }>
    return ['backlog', 'todo', 'in-progress', 'review', 'done'].every((s) => {
      const dataRows = Object.values(b).filter((c) => c.status === s).length
      const domRows = document.querySelectorAll(`.col[data-status="${s}"] .card`).length
      return domRows === dataRows
    })
  })
  expect(match).toBe(true)
  expect(errors).toEqual([])
})

test('drag-drop move is ONE batch commit and ranks the card at the drop position', async ({ page }) => {
  await page.goto(url)
  const id = await idOf(page, 'Postgres schema') // todo, 8 pts

  // Effect spies on the RAW nodes (Symbol.for('data.v3.node') is the shared
  // handle symbol): a node's effects fire once per commit it emits in, so the
  // batched move must read {src:1, view:1} — two unbatched writes (status,
  // then order) would settle the board twice.
  await page.evaluate(() => {
    const w = window as any
    const NODE = Symbol.for('data.v3.node')
    w.__spy = { src: 0, view: 0 }
    w.__kanban.board[NODE].connect({ wantsOrder: false, origin: null, apply: () => w.__spy.src++ })
    w.__kanban.colView['review'][NODE].connect({ wantsOrder: true, origin: null, apply: () => w.__spy.view++ })
  })

  // Native HTML5 drag isn't reliably reproducible in Playwright, so dispatch
  // the real dragstart/drop events the handlers listen for — unlike the v2
  // spec's direct proxy write, this exercises the example's onDrop → batch()
  // path, which IS the one-commit claim under test.
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
  await page.dispatchEvent(`.card[data-id="${id}"]`, 'dragstart', { dataTransfer })
  // clientY 0 sits above every card midpoint → dropOrder picks (first - 1)
  await page.dispatchEvent('.col[data-status="review"] .col-body', 'drop', { dataTransfer, clientY: 0 })

  // exactly one copy landed, and it left To Do
  await expect(
    page.locator('.col[data-status="review"] .card', { hasText: 'Postgres schema' }),
  ).toHaveCount(1)
  await expect(
    page.locator('.col[data-status="todo"] .card', { hasText: 'Postgres schema' }),
  ).toHaveCount(0)
  // ...at the TOP: the az('order') view ranked the fractional order in place
  // (row keys are card ids — no v2 data-id read-back to find it again)
  await expect(page.locator('.col[data-status="review"] .card').first()).toContainText('Postgres schema')

  // both columns' standing aggregates moved by exactly the card's points
  await expect(colPts(page, 'todo')).toHaveText('20 pts') // 28 - 8
  await expect(colPts(page, 'review')).toHaveText('18 pts') // 10 + 8
  await expect(colCount(page, 'review')).toHaveText('4/3')
  // over-WIP styling: the count's class is a bind() off the same length() view
  await expect(page.locator('.col[data-status="review"] .col-count')).toHaveClass(/over/)

  // THE v3 proof: one settle each — the two field writes were ONE commit
  expect(await page.evaluate(() => (window as any).__spy)).toEqual({ src: 1, view: 1 })
})

test('field edits patch the card surgically — element identity survives', async ({ page }) => {
  await page.goto(url)
  const id = await idOf(page, 'Design auth flow') // in-progress, 5 pts

  const card = page.locator(`.card[data-id="${id}"]`)
  const sibling = page.locator('.col[data-status="in-progress"] .card', { hasText: 'Search index' })
  const cardHandle = await card.elementHandle()
  const sibHandle = await sibling.elementHandle()

  // a points edit is one row update flowing filter → mirror → az; the row fn
  // re-runs and patchRow diffs — shape-stable, so the ELEMENT is preserved
  // (v2's kanban re-rendered the card; v3 patches the one text node)
  await page.evaluate((id) => (window as any).__kanban.board.get(id).set('points', 13), id)
  await expect(card.locator('.pill.pts')).toHaveText('13 pts')
  await expect(colPts(page, 'in-progress')).toHaveText('24 pts') // 16 - 5 + 13
  expect(await card.evaluate((el, prev) => el === prev, cardHandle)).toBe(true)

  // a title edit is a text patch on the same element
  await page.evaluate((id) => (window as any).__kanban.board.get(id).set('title', 'Design auth flow v2'), id)
  await expect(page.locator('.card', { hasText: 'Design auth flow v2' })).toHaveCount(1)
  expect(await card.evaluate((el, prev) => el === prev, cardHandle)).toBe(true)

  // untouched sibling rows never re-rendered through either edit
  expect(await sibling.evaluate((el, prev) => el === prev, sibHandle)).toBe(true)
})

test('pill clicks cycle fields; the workload deck tracks incrementally (real interaction)', async ({ page }) => {
  await page.goto(url)
  const id = await idOf(page, 'CI pipeline') // done, cy, low, 2 pts
  const card = page.locator(`.card[data-id="${id}"]`)

  // priority: the card class is computed from row data — a STATIC prop the
  // renderer diffs on row update (pri-low → pri-med patches in place)
  await expect(card).toHaveClass(/pri-low/)
  await card.locator('.pill.pri').click()
  await expect(card).toHaveClass(/pri-med/)
  await expect(card.locator('.pill.pri')).toHaveText('med')

  // points 2 → 3: the column sum and cy's reduce bucket both follow
  await card.locator('.pill.pts').click()
  await expect(card.locator('.pill.pts')).toHaveText('3 pts')
  await expect(colPts(page, 'done')).toHaveText('8 pts') // 7 - 2 + 3
  await expect(page.locator('.chip[data-who="cy"] .chip-pts')).toHaveText('17p') // 16 - 2 + 3

  // reassign cy → di: one remove(prev) + one add(row) through the 3-arg
  // incremental reduce (no rebuild), and the length(fn) histogram re-buckets
  await card.locator('.pill.who').click()
  await expect(card.locator('.pill.who')).toHaveText('di')
  await expect(page.locator('.chip[data-who="cy"] .chip-load')).toHaveText('4')
  await expect(page.locator('.chip[data-who="cy"] .chip-pts')).toHaveText('14p') // 17 - 3
  await expect(page.locator('.chip[data-who="di"] .chip-load')).toHaveText('6')
  await expect(page.locator('.chip[data-who="di"] .chip-pts')).toHaveText('16p') // 13 + 3
})

test('search narrows every column and dispose()s each transient filter (no graph leak)', async ({ page }) => {
  await page.goto(url)
  await expect(page.locator('.card')).toHaveCount(20)
  await page.waitForFunction(() => !!(window as any).__kanban)
  expect(await colFilterChildren(page)).toEqual(['mirror', 'mirror', 'mirror', 'mirror', 'mirror'])

  // typing re-points once per frame (rAF-coalesced) — auto-retrying reads only
  await page.locator('.search').fill('auth')
  await expect(page.locator('.card')).toHaveCount(2) // Design auth flow, OAuth providers
  await expect.poll(async () => {
    const titles = await page.locator('.card .card-title').allTextContents()
    return titles.length > 0 && titles.every((t) => t.toLowerCase().includes('auth'))
  }).toBe(true)
  // while active: each slot re-pointed at ONE transient (the mirror moved onto
  // it), so the standing filter's only graph child is that transient
  expect(await colFilterChildren(page)).toEqual(['filter', 'filter', 'filter', 'filter', 'filter'])

  // churn more queries, then clear — every re-point disposes the previous transient
  await page.locator('.search').fill('ci')
  await expect(page.locator('.card')).toHaveCount(1) // CI pipeline
  await page.locator('.search').fill('')
  await expect(page.locator('.card')).toHaveCount(20)

  // nothing leaked: back to exactly [mirror] per column — the v2 kanban's
  // per-keystroke operator pileup can't happen (dispose() detaches the node)
  expect(await colFilterChildren(page)).toEqual(['mirror', 'mirror', 'mirror', 'mirror', 'mirror'])
})

test('assignee chips filter reactively; the active class binds to the ui source', async ({ page }) => {
  await page.goto(url)
  await expect(page.locator('.card')).toHaveCount(20)

  await page.locator('.chip[data-who="ana"]').click()
  // the chip's active class is a bind() off ui.get('assignee') — reactive UI
  // state, not v2's syncFilterChips walking the DOM to toggle classes
  await expect(page.locator('.chip[data-who="ana"]')).toHaveClass(/active/)
  await expect(page.locator('.card')).toHaveCount(5)
  await expect.poll(async () => {
    const whos = await page.locator('.card .pill.who').allTextContents()
    return whos.length > 0 && whos.every((w) => w.trim() === 'ana')
  }).toBe(true)

  // toggle off: slots re-point back to the standing views, chip class clears
  await page.locator('.chip[data-who="ana"]').click()
  await expect(page.locator('.chip[data-who="ana"]')).not.toHaveClass(/active/)
  await expect(page.locator('.card')).toHaveCount(20)
})

test('emptying a column reads sum() = 0 — the v3 empty-set contract', async ({ page }) => {
  await page.goto(url)
  await expect(colPts(page, 'review')).toHaveText('10 pts')

  // remove every review card (row keys are ids — no positional bookkeeping)
  await page.evaluate(() => {
    const k = (window as any).__kanban
    const b = k.board[k.value] as Record<string, { status: string }>
    for (const id in b) if (b[id].status === 'review') k.board.get(id).remove()
  })

  await expect(page.locator('.col[data-status="review"] .card')).toHaveCount(0)
  // v2's sum() read undefined over an empty set (this line would have shown
  // "undefined pts" without a || 0 guard); v3 reads 0, so the example binds raw
  await expect(colPts(page, 'review')).toHaveText('0 pts')
  await expect(colCount(page, 'review')).toHaveText('0/3')
})
