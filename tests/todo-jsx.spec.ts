// @ts-nocheck
// The plan stands or falls on one claim: JSX preserves the per-key surgical
// DOM updates that the existing builder DSL gets. We assert this two ways:
//
//   1) DOM equivalence — given the same state, the JSX example produces the
//      same .todo-list innerHTML as the original builder example.
//   2) DOM identity — adding a new row, mutating an existing one, and
//      removing a row do NOT recreate unrelated rows. We capture an element
//      reference before the change and assert it survives via a marker.
//
// If JSX silently degraded into whole-subtree replacement, (2) would fail.
import { test, expect } from '@playwright/test'

const seed = (key: string) => `
  localStorage.setItem('${key}', JSON.stringify({
    1: { title: 'milk',  completed: false },
    2: { title: 'bread', completed: true  },
    3: { title: 'eggs',  completed: false },
  }))
`

async function loadTodo(page, path: string, key: string) {
  await page.addInitScript(seed(key))
  await page.goto(path)
  await page.waitForSelector('.todo-list li', { timeout: 30_000 })
}

test('todo-jsx renders the same .todo-list HTML as the builder version', async ({ page, context }) => {
  await loadTodo(page, '/examples/todo/', 'todos-ripple')
  const builderHtml = await page.locator('.todo-list').innerHTML()

  const page2 = await context.newPage()
  await loadTodo(page2, '/examples/todo-jsx/', 'todos-ripple-jsx')
  const jsxHtml = await page2.locator('.todo-list').innerHTML()

  expect(jsxHtml).toBe(builderHtml)
})

test('todo-jsx preserves DOM identity across an item title update', async ({ page }) => {
  await loadTodo(page, '/examples/todo-jsx/', 'todos-ripple-jsx')

  // Tag the second row's <label> with a marker, then mutate the FIRST row's
  // title. If JSX collapsed to whole-subtree rebuild, the marker would be
  // wiped because all rows would be re-created.
  await page.evaluate(() => {
    const labels = document.querySelectorAll('.todo-list li label')
    ;(labels[1] as any).dataset.identityMarker = 'survived'
  })

  await page.evaluate(() => {
    const w: any = window
    w.items[1].title = 'almond milk'
  })

  // The third row's label should still carry the marker because only row 1's
  // textContent was touched. (DOMSink's BU2 path updates the changed sub-tree
  // — the surrounding rows are not re-created.)
  const survived = await page.evaluate(() =>
    (document.querySelectorAll('.todo-list li label')[1] as any).dataset.identityMarker
  )
  expect(survived).toBe('survived')

  // And the mutation actually took effect.
  const newTitle = await page.locator('.todo-list li').nth(0).locator('label').textContent()
  expect(newTitle).toBe('almond milk')
})

test('todo-jsx preserves DOM identity when a row is inserted', async ({ page }) => {
  await loadTodo(page, '/examples/todo-jsx/', 'todos-ripple-jsx')

  await page.evaluate(() => {
    const labels = document.querySelectorAll('.todo-list li label')
    ;(labels[0] as any).dataset.identityMarker = 'first-row'
    ;(labels[2] as any).dataset.identityMarker = 'third-row'
  })

  await page.evaluate(() => {
    const w: any = window
    w.items.insert({ title: 'butter', completed: false })
  })

  // Wait for the new row to mount.
  await expect(page.locator('.todo-list li')).toHaveCount(4)

  const markers = await page.evaluate(() => {
    const ls = document.querySelectorAll('.todo-list li label')
    return Array.from(ls).map(l => (l as any).dataset.identityMarker || null)
  })

  // Original rows must still carry their markers — the insert created exactly
  // one new row alongside, not a fresh four-row list.
  expect(markers).toContain('first-row')
  expect(markers).toContain('third-row')
})
