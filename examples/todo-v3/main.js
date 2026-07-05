// TodoMVC on the v3 engine, written with the HTML builder DSL.
//
// One `$({})` source of todos; the visible list is a MIRROR re-pointed at a
// derived filter view on route changes; counts and the all-complete checkbox
// are standing aggregates. Rows carry their UI state (editing) in the data,
// so a row's class/checkbox patch surgically on update — no per-row
// subscriptions, no manual invalidation.
//
// Two idioms this example demonstrates (both documented in the render layer):
// - event handlers read CURRENT state through the source (items.get(id)),
//   never their captured row snapshot (listeners bind once; rows patch).
// - checked/value are LIVE props — the renderer writes the DOM property, so
//   data-driven checkboxes keep following data after the user has clicked.

import { $, value, render, list, text, bind, HTML } from 'data/v3'

const { section, header, h1, input, label, ul, li, div, button, footer, span, strong, a } = HTML

const KEY = 'todos-data-v3'
const ENTER = 'Enter'
const ESC = 'Escape'

// ── the model ─────────────────────────────────────────────────────────────────

const items = $(JSON.parse(localStorage.getItem(KEY) || '{}'))

const persist = () => {
  const clean = {}
  for (const [id, t] of Object.entries(items[value])) clean[id] = { title: t.title, completed: t.completed }
  localStorage.setItem(KEY, JSON.stringify(clean))
}

const filters = {
  all: items,
  active: items.filter(t => !t.completed),
  completed: items.filter(t => t.completed),
}

const activeCount = filters.active.length()
const completedCount = filters.completed.length()
const totalCount = items.length()
const allComplete = items.to(todos => {
  const all = Object.values(todos)
  return all.length > 0 && all.every(t => t.completed)
})

// the visible list: a re-pointable slot over the current filter
const selected = items.mirror()
const route = $({ name: 'all' })

const changeView = () => {
  const name = document.location.hash.split('/').pop() || 'all'
  route.set('name', name)
  selected.set(filters[name] ?? filters.all)
}
addEventListener('hashchange', changeView)
changeView()

// ── actions (all read current state through the source) ──────────────────────

const todo = id => items.get(id)

const addTodo = e => {
  if (e.key !== ENTER) return
  const title = e.target.value.trim()
  if (title === '') return
  items.insert({ title, completed: false })
  e.target.value = ''
  persist()
}

const toggle = id => () => {
  todo(id).set('completed', !todo(id)[value].completed)
  persist()
}

const toggleAll = e => {
  for (const id of Object.keys(items[value])) items.get(id).set('completed', e.target.checked)
  persist()
}

const destroy = id => () => {
  todo(id).remove()
  persist()
}

const clearCompleted = () => {
  for (const [id, t] of Object.entries(items[value])) if (t.completed) items.get(id).remove()
  persist()
}

const startEdit = id => e => {
  todo(id).set('editing', true)
  const field = e.target.closest('li').querySelector('.edit')
  field.focus()
  field.setSelectionRange(field.value.length, field.value.length)
}

const finishEdit = id => e => {
  if (!todo(id)[value]?.editing) return
  const title = e.target.value.trim()
  if (title === '') {
    todo(id).remove()
  } else {
    todo(id).set('title', title)
    todo(id).set('editing', false)
  }
  persist()
}

const editKeys = id => e => {
  if (e.key === ENTER) e.target.blur()
  if (e.key === ESC) {
    e.target.value = todo(id)[value].title // discard — blur saves the restored title
    todo(id).set('editing', false)
    e.target.blur()
  }
}

// ── the view ──────────────────────────────────────────────────────────────────

const todoRow = (t, id) => li(
  { class: `${t.completed ? 'completed' : ''}${t.editing ? ' editing' : ''}` },
  div.view(
    input.toggle({ type: 'checkbox', checked: t.completed, onChange: toggle(id) }),
    label({ onDblclick: startEdit(id) }, t.title),
    button.destroy({ onClick: destroy(id) }),
  ),
  input.edit({ value: t.title, onBlur: finishEdit(id), onKeydown: editKeys(id) }),
)

render(document.body, section.todoapp(
  header.header(
    h1('todos'),
    input.new_todo({ placeholder: 'What needs to be done?', autofocus: true, onKeydown: addTodo }),
  ),
  section.main({ class: bind(totalCount, n => n === 0 ? 'hidden' : '') },
    input.toggle_all['#toggle-all']({ type: 'checkbox', checked: bind(allComplete), onChange: toggleAll }),
    label({ for: 'toggle-all' }, 'Mark all as complete'),
    ul.todo_list(list(selected, todoRow)),
  ),
  footer.footer({ class: bind(totalCount, n => n === 0 ? 'hidden' : '') },
    span.todo_count(
      strong(text(activeCount)),
      text(activeCount, n => ` item${n === 1 ? '' : 's'} left`),
    ),
    ul.filters(
      li(a({ href: '#/', class: bind(route.get('name'), r => r === 'all' ? 'selected' : '') }, 'All')),
      li(a({ href: '#/active', class: bind(route.get('name'), r => r === 'active' ? 'selected' : '') }, 'Active')),
      li(a({ href: '#/completed', class: bind(route.get('name'), r => r === 'completed' ? 'selected' : '') }, 'Completed')),
    ),
    button.clear_completed({
      class: bind(completedCount, n => n === 0 ? 'hidden' : ''),
      onClick: clearCompleted,
    }, 'Clear completed'),
  ),
))

// debug / test hooks
window.__todo = { items, selected, route, value }
