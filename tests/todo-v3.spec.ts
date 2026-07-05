import { test, expect } from '@playwright/test'

// TodoMVC on the v3 engine (examples/todo-v3) — the second M5 migration and
// the builder DSL's first browser consumer. Exercises: insert, the LIVE
// checked-prop path (toggle + toggle-all after user interaction), surgical
// class patching (completed/editing), the mirror re-point (filter routes),
// edit save/discard, clear-completed, and localStorage persistence.

test('todo-v3: add / toggle / filter / edit / clear / persist', async ({ page }) => {
  await page.goto('http://127.0.0.1:3000/examples/todo-v3/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  const newTodo = page.locator('.new-todo')
  for (const t of ['buy milk', 'ship v3', 'walk dog']) {
    await newTodo.fill(t)
    await newTodo.press('Enter')
  }
  await expect(page.locator('.todo-list li')).toHaveCount(3)
  await expect(page.locator('.todo-count')).toContainText('3 items left')

  // toggle: the row's class patches surgically; counts track
  await page.locator('.todo-list li', { hasText: 'ship v3' }).locator('.toggle').click()
  await expect(page.locator('.todo-list li.completed')).toHaveCount(1)
  await expect(page.locator('.todo-count')).toContainText('2 items left')

  // filter routes re-point the mirror
  await page.locator('.filters a', { hasText: 'Active' }).click()
  await expect(page.locator('.todo-list li')).toHaveCount(2)
  await page.locator('.filters a', { hasText: 'Completed' }).click()
  await expect(page.locator('.todo-list li')).toHaveCount(1)
  await expect(page.locator('.todo-list li')).toContainText('ship v3')
  await page.locator('.filters a', { hasText: 'All' }).click()
  await expect(page.locator('.todo-list li')).toHaveCount(3)

  // toggle-all drives every checkbox through the LIVE property path
  // (the 'ship v3' box was clicked by the user above — the attribute alone
  // would no longer move it)
  await page.locator('.toggle-all').click()
  await expect(page.locator('.todo-list li.completed')).toHaveCount(3)
  await expect(page.locator('.todo-list .toggle').first()).toBeChecked()
  await page.locator('.toggle-all').click()
  await expect(page.locator('.todo-list li.completed')).toHaveCount(0)
  await expect(page.locator('.todo-list .toggle').first()).not.toBeChecked()

  // edit: dblclick, type, Enter saves; ESC discards
  const first = page.locator('.todo-list li', { hasText: 'buy milk' })
  await first.locator('label').dblclick()
  await expect(first).toHaveClass(/editing/)
  await first.locator('.edit').fill('buy oat milk')
  await first.locator('.edit').press('Enter')
  await expect(page.locator('.todo-list li', { hasText: 'buy oat milk' })).toHaveCount(1)

  const second = page.locator('.todo-list li', { hasText: 'ship v3' })
  await second.locator('label').dblclick()
  await second.locator('.edit').fill('discarded text')
  await second.locator('.edit').press('Escape')
  await expect(page.locator('.todo-list li', { hasText: 'ship v3' })).toHaveCount(1)
  await expect(page.locator('.todo-list li', { hasText: 'discarded' })).toHaveCount(0)

  // clear completed
  await second.locator('.toggle').click()
  await page.locator('.clear-completed').click()
  await expect(page.locator('.todo-list li')).toHaveCount(2)

  // persistence: reload restores from localStorage
  await page.reload()
  await expect(page.locator('.todo-list li')).toHaveCount(2)
  await expect(page.locator('.todo-list li', { hasText: 'buy oat milk' })).toHaveCount(1)
})
