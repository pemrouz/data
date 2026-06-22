// Devtools-on-JSX smoke test. The JSX adapter routes through the same
// NodeProxy/DOMSink pipeline as the builder DSL, so devtools' read-side
// helpers ($.inspect, $.graph, $.fromDOM, $.highlight) and the in-page
// overlay panel should "just work" on a JSX-built template — but neither the
// existing devtools tests nor the JSX tests prove it. This test does.
//
// What it asserts:
//   1. The panel auto-mounts when the page loads with `?devtools` (a
//      `.__ripple_panel_host` element appears in the document).
//   2. `$.fromDOM($el)` walks up to a __ripple_sink set by render() — proving
//      DOMSink ran on the JSX tree, just like it would on a builder tree.
//   3. `$.inspect(...)` returns a sensible snapshot for a JSX-built view.
//   4. `$.graph()` produces a non-empty walk over live roots.
//   5. `$.highlight(items)` adds the highlight class to at least one DOM
//      element bound to the source ViewProxy — closes the loop end-to-end.
//
// Importing devtools dynamically inside `page.evaluate` gives us the patched
// `$` directly. The page's own `await import('data/devtools')` triggered by
// `?devtools` resolves to the same module instance because tsup emits a
// shared core chunk that both `data/full` and `data/devtools` import — so
// the `$` we get back is the same one the page is already using.
import { test, expect } from '@playwright/test'

const seed = `
  localStorage.setItem('todos-ripple-jsx', JSON.stringify({
    1: { title: 'milk',  completed: false },
    2: { title: 'bread', completed: true  },
    3: { title: 'eggs',  completed: false },
  }))
`

test('devtools auto-mount on a JSX-built page', async ({ page }) => {
  await page.addInitScript(seed)
  await page.goto('/examples/todo-jsx/?devtools')
  await page.waitForSelector('.todo-list li', { timeout: 30_000 })

  // Panel host is a regular DOM element with a closed shadow root —
  // querySelector reaches it; the shadow content is opaque from outside.
  await expect.poll(
    () => page.locator('.__ripple_panel_host').count(),
    { timeout: 5_000 },
  ).toBeGreaterThan(0)
})

test('$.fromDOM on a JSX-built node returns the bound view', async ({ page }) => {
  await page.addInitScript(seed)
  await page.goto('/examples/todo-jsx/?devtools')
  await page.waitForSelector('.todo-list li', { timeout: 30_000 })

  // render() sets __ripple_sink on the *parent* DOM element of any data-bound
  // child slot — for `<For each={selected} tag="li">` that's the .todo-list ul.
  // $.fromDOM walks up from any descendant to find it, so passing a child <li>
  // still resolves to the ul's bound view.
  const result = await page.evaluate(async () => {
    const dt: any = await import('data/devtools')
    const $ = dt.$
    const li = document.querySelector('.todo-list li') as any
    const ul = document.querySelector('.todo-list') as any
    const proxy = $.fromDOM(li)
    return { hasProxy: !!proxy, ulHasSink: !!ul.__ripple_sink }
  })

  expect(result.ulHasSink).toBe(true)
  expect(result.hasProxy).toBe(true)
})

test('$.inspect / $.graph / $.highlight work on a JSX-built tree', async ({ page }) => {
  await page.addInitScript(seed)
  await page.goto('/examples/todo-jsx/?devtools')
  await page.waitForSelector('.todo-list li', { timeout: 30_000 })

  const result = await page.evaluate(async () => {
    const dt: any = await import('data/devtools')
    const $ = dt.$
    const w: any = window
    const items = w.items
    const selected = w.selected

    const inspect = $.inspect(items)
    const graph = $.graph()
    // $.highlight finds DOMSinks bound to the *exact* view passed in (not
    // descendants). `selected` is what the .todo-list ul is data-bound to in
    // the JSX template (`<For each={selected} tag="li">`), so highlight hits
    // that one ul. Passing `items` would return 0 because no DOMSink binds
    // directly to it — only its child views (per-row) do.
    const hits = $.highlight(selected, 100)

    return {
      inspectHasChildren: Array.isArray(inspect.children) && inspect.children.length > 0,
      graphIsArray: Array.isArray(graph),
      graphHasNodes: Array.isArray(graph) && graph.length > 0,
      highlightHits: hits,
    }
  })

  // The todo seed has three items, so the items proxy enumerates ≥ 3 children.
  expect(result.inspectHasChildren).toBe(true)
  // Graph walk over live roots returns an array (not console.dir output).
  expect(result.graphIsArray).toBe(true)
  expect(result.graphHasNodes).toBe(true)
  // The .todo-list ul is data-bound to `selected` — highlight should hit it.
  expect(result.highlightHits).toBeGreaterThan(0)
})

test('panel does NOT mount without ?devtools', async ({ page }) => {
  await page.addInitScript(seed)
  await page.goto('/examples/todo-jsx/')
  await page.waitForSelector('.todo-list li', { timeout: 30_000 })

  // Give any optional import a chance to resolve before asserting absence.
  await page.waitForTimeout(200)

  const count = await page.locator('.__ripple_panel_host').count()
  expect(count).toBe(0)
})
