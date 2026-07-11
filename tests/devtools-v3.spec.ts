import { test, expect, type Page } from '@playwright/test'

// Regression spec for the v3 devtools layer (v3/devtools/**): $ helper
// attachment, the overlay panel shell, graph + inspector selection, the
// fromDOM/rowElements/highlight DOM bridge, ?nopanel suppression, and the
// close/reopen lifecycle. Driven against examples/todo-v3/, which does NOT
// import devtools itself — every test injects dist/v3/devtools.js into the
// already-running page, the exact drop-into-a-live-app workflow the bundle
// is built for.
//
// Single-module-instance premise (asserted, not assumed, by the graph test):
// the app's importmap maps 'data/v3' → ../../dist/v3/index.js, which from
// /examples/todo-v3/ resolves to /dist/v3/index.js — the SAME url the
// devtools bundle's externalized core import ('./index.js' beside
// /dist/v3/devtools.js) hits. One resolved url = one module instance, so the
// injected layer shares the app's $ and runtime, and the injected graph()
// must see the app's own chain (the spec builds zero nodes of its own).
//
// Shadow access: the dock lives in a CLOSED shadow root (page CSS and
// page.locator can't reach in), so in-shadow assertions go through
// $.devtools.panel.shell — exposed for exactly this.

const url = 'http://127.0.0.1:3000/examples/todo-v3/'
const DT = '/dist/v3/devtools.js' // the injected devtools bundle
const API = '/dist/v3/index.js' // the main bundle — the app's own module instance

// Three rows so the list has real row elements for the DOM bridge; the keys
// are the row ids fromDOM must hand back.
const seed = `
  localStorage.setItem('todos-data-v3', JSON.stringify({
    1: { title: 'milk',  completed: false },
    2: { title: 'bread', completed: true  },
    3: { title: 'eggs',  completed: false },
  }))
`

// Specifiers travel as evaluate args, never as import literals — tsc under
// nodenext would try (and fail) to resolve a server-absolute path; the
// browser resolves it against the document base at runtime.
const inject = (page: Page): Promise<void> =>
  page.evaluate((spec) => import(spec).then(() => undefined), DT)

const boot = async (page: Page, query = ''): Promise<void> => {
  await page.addInitScript(seed)
  await page.goto(url + query)
  await page.waitForFunction(() => !!(window as any).__todo)
  await expect(page.locator('.todo-list li')).toHaveCount(3)
}

test('injection attaches the $ helpers and auto-mounts one panel host', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await boot(page)
  // the app never imports devtools — no host until the spec injects it
  await expect(page.locator('[data-v3-devtools]')).toHaveCount(0)
  await inject(page)
  await expect(page.locator('[data-v3-devtools]')).toHaveCount(1)

  const r = await page.evaluate(async (api) => {
    const { $ } = (await import(api)) as any
    const helpers = ['inspect', 'graph', 'trace', 'profile', 'cascades', 'fromDOM', 'highlight']
    return {
      missing: helpers.filter((k) => typeof $[k] !== 'function'),
      panelApi: typeof $.devtools?.panel?.open === 'function' && typeof $.devtools?.panel?.close === 'function',
      shellLive: $.devtools.panel.shell != null, // auto-mount built the dock
    }
  }, API)
  expect(r.missing).toEqual([])
  expect(r.panelApi).toBe(true)
  expect(r.shellLive).toBe(true)
  expect(errors).toEqual([])
})

test('injected devtools sees the app graph (one module instance); the panel draws it', async ({ page }) => {
  await boot(page)
  await inject(page)
  const r = await page.evaluate(async (urls) => {
    const dt: any = await import(urls.dt)
    const api: any = await import(urls.api)
    const g = dt.graph() // default runtime — the app's, iff single-instance
    const shell = api.$.devtools.panel.shell
    return {
      nodes: g.nodes.length,
      ops: g.nodes.map((n: any) => n.op),
      kinds: g.nodes.map((n: any) => n.kind),
      gnodes: shell.querySelectorAll('.gnode').length,
      empty: shell.querySelectorAll('.gempty').length,
    }
  }, { dt: DT, api: API })
  expect(r.nodes).toBeGreaterThan(0) // the spec built no nodes — these are the app's
  expect(r.ops).toContain('source') // items / route
  expect(r.ops).toContain('mirror') // the visible-list slot
  expect(r.kinds).toContain('operator')
  expect(r.gnodes).toBeGreaterThanOrEqual(r.nodes) // every live node got a box
  expect(r.empty).toBe(0)
})

test('panel.open(handle) selects the node; inspector shows identity, value, connections', async ({ page }) => {
  await boot(page)
  await inject(page)
  const r = await page.evaluate(async (urls) => {
    const dt: any = await import(urls.dt)
    const api: any = await import(urls.api)
    const items = (window as any).__todo.items
    const info = dt.inspect(items) // {id, kind, op, height, parents, value}
    api.$.devtools.panel.open(items)
    const shell = api.$.devtools.panel.shell
    return {
      id: info.id,
      op: info.op,
      kind: info.kind,
      headline: shell.querySelector('.card-headline')?.textContent ?? '',
      sub: shell.querySelector('.card-sub')?.textContent ?? '',
      value: shell.querySelector('pre.card-value')?.textContent ?? '',
      ring: shell.querySelector('.gnode.selected')?.getAttribute('data-node-id') ?? null,
      chips: shell.querySelectorAll('.conn-chip').length,
    }
  }, { dt: DT, api: API })
  expect(r.op).toBe('source') // $({}) roots as opName 'source'
  expect(r.headline).toBe(`${r.op}#${r.id}`)
  expect(r.sub).toContain(r.kind)
  expect(r.value).toContain('milk') // CURRENT VALUE materializes the seed
  expect(r.ring).toBe(String(r.id)) // the graph selection ring moved too
  expect(r.chips).toBeGreaterThan(0) // filters/counts/mirror hang off the source
})

test('fromDOM resolves rows and descendants to the bound view; highlight outlines and restores', async ({ page }) => {
  await boot(page)
  await inject(page)
  const r = await page.evaluate(async (urls) => {
    const dt: any = await import(urls.dt)
    const api: any = await import(urls.api)
    const $ = api.$
    const selected = (window as any).__todo.selected
    const li: any = document.querySelector('.todo-list li')
    const fromRow = $.fromDOM(li)
    const fromDesc = $.fromDOM(li.querySelector('label')) // walks up to the row root
    const before = li.style.outline
    const restore = $.highlight(selected)
    const lit = [...document.querySelectorAll('.todo-list li')].filter((n: any) => n.style.outline !== '').length
    const during = li.style.outline
    const offset = li.style.outlineOffset
    restore()
    restore() // second call must no-op (the stale-restore contract)
    return {
      rowOp: fromRow?.node?.opName,
      rowKind: fromRow?.node?.kind,
      rowKey: String(fromRow?.key),
      sameLink: fromRow !== null && fromDesc !== null && fromRow.node === fromDesc.node && fromRow.key === fromDesc.key,
      miss: $.fromDOM(document.body) === null, // no registered row root above it
      rowEls: dt.rowElements(selected).length,
      lit,
      before,
      during,
      offset,
      after: li.style.outline,
    }
  }, { dt: DT, api: API })
  expect(r.rowOp).toBe('mirror') // list(selected, todoRow) binds the mirror slot
  expect(r.rowKind).toBe('operator')
  expect(['1', '2', '3']).toContain(r.rowKey) // the seeded row ids ARE the keys
  expect(r.sameLink).toBe(true)
  expect(r.miss).toBe(true)
  expect(r.rowEls).toBe(3) // one bound element per seeded row
  expect(r.lit).toBe(3) // highlight outlined every row of the view
  expect(r.before).toBe('')
  expect(r.during).toContain('2px') // the amber outline landed inline
  expect(r.offset).toBe('2px')
  expect(r.after).toBe('') // restore put the saved inline style back
})

test('?nopanel suppresses auto-mount; helpers attach; explicit open() still summons the dock', async ({ page }) => {
  await boot(page, '?nopanel')
  await inject(page)
  await page.waitForTimeout(200) // an auto-mount would attach synchronously — belt and braces
  await expect(page.locator('[data-v3-devtools]')).toHaveCount(0)

  const r = await page.evaluate(async (api) => {
    const { $ } = (await import(api)) as any
    return {
      inspectIsFn: typeof $.inspect === 'function',
      nodes: $.graph().nodes.length,
      shell: $.devtools.panel.shell, // null — the lazy facade built nothing
    }
  }, API)
  expect(r.inspectIsFn).toBe(true)
  expect(r.nodes).toBeGreaterThan(0)
  expect(r.shell).toBeNull()

  await page.evaluate(async (api) => {
    const mod: any = await import(api)
    mod.$.devtools.panel.open()
  }, API)
  await expect(page.locator('[data-v3-devtools]')).toHaveCount(1)
})

test('close() detaches the dock; the app keeps writing cleanly; reopen re-attaches', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await boot(page)
  await inject(page)
  await expect(page.locator('[data-v3-devtools]')).toHaveCount(1)

  await page.evaluate(async (api) => {
    const mod: any = await import(api)
    mod.$.devtools.panel.close()
  }, API)
  await expect(page.locator('[data-v3-devtools]')).toHaveCount(0)

  // post-close leak smoke: insert + update flow with the devtools
  // subscriptions gone (a live onCommit hook on destroyed modules would
  // throw into the commit loop and surface as a pageerror)
  const newTodo = page.locator('.new-todo')
  await newTodo.fill('post-close write')
  await newTodo.press('Enter')
  await expect(page.locator('.todo-list li')).toHaveCount(4)
  await page.locator('.todo-list li', { hasText: 'milk' }).locator('.toggle').click()
  await expect(page.locator('.todo-list li.completed')).toHaveCount(2) // bread was seeded completed

  // reopen: the singleton shell survives close; the graph redraws live state
  const r = await page.evaluate(async (api) => {
    const { $ } = (await import(api)) as any
    $.devtools.panel.open()
    return { gnodes: $.devtools.panel.shell.querySelectorAll('.gnode').length }
  }, API)
  await expect(page.locator('[data-v3-devtools]')).toHaveCount(1)
  expect(r.gnodes).toBeGreaterThan(0)
  expect(errors).toEqual([])
})
