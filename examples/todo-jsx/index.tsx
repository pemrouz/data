/** @jsx h */
/** @jsxFrag Fragment */
// @ts-nocheck
// JSX port of examples/todo/. Functionally identical: same data flow, same
// reactive bindings, same DOM. Only the authoring layer changes — every
// `HTML.div(...)` chain is rewritten as `<div .../>`. Because h() returns
// the same NodeProxy AST that the builders return, render() walks an
// identical tree and DOMSink does the same per-key surgical updates.
// `data/full` (not `data`) so the operator dispatch table is registered —
// `.filter`, `.length`, `.to` etc. are looked up dynamically and the lean
// `data` entry no longer pre-registers them. JSX helpers (`h`, `Fragment`,
// `For`) are re-exported from `data/full` for the same reason: keeping
// everything in one bundle means h() and HTML share the same NodeProxy class
// and NODE symbol — cross-bundle `instanceof` would silently fail otherwise.
import { $, value, render, h, Fragment, For } from 'data/full'

const KEY = 'todos-ripple-jsx'
const items = (window as any).items = $(JSON.parse(localStorage.getItem(KEY) || '{}'))
;(window as any).value = value

const ESC = 27
const ENTER = 13

const persist = () => {
  const clean: any = {}
  for (const [k, v] of Object.entries(items[value])) {
    clean[k] = { title: (v as any).title, completed: (v as any).completed }
  }
  localStorage.setItem(KEY, JSON.stringify(clean))
}

const filters = (window as any).filters = {
  completed: items.filter('completed', true),
  active: items.filter('completed', false),
  all: items,
}

const active_count = filters.active.length()
const completed_count = filters.completed.length()
const total_count = items.length()
const all_complete = items.to((v: any) => {
  let n = 0, c = 0
  for (const i in v) { n++; if (v[i].completed) c++ }
  return n > 0 && n === c
})

const selected = (window as any).selected = $(filters.all)
const route = (window as any).route = $('all')

const change_view = () => {
  const r = document.location.hash.split('/').pop() || 'all'
  route[value] = r
  selected[value] = filters[r] ?? filters.all
}

addEventListener('hashchange', change_view)
change_view()

const toggle = (item: any) => () => {
  item.completed = !item.completed[value]
  persist()
}

const edit = (item: any) => (ev: any) => {
  item.editing = true
  item.text = item.title[value]
  ev.target.parentNode.parentNode.querySelector('.edit').focus()
}

const clear = () => {
  for (const [id, { completed }] of Object.entries(items[value]) as any) {
    if (completed === true) delete items[id]
  }
  persist()
}

const destroy = (id: any) => () => {
  delete items[id]
  persist()
}

const submit = (item: any, id: any) => () => {
  if (item.cancelling[value]) {
    delete item.editing
    delete item.text
    delete item.cancelling
    return
  }
  const text = (item.text[value] ?? '').trim()
  if (text === '') {
    delete items[id]
    persist()
    return
  }
  item.title = text
  delete item.editing
  delete item.text
  persist()
}

const change = (item: any) => (ev: any) => { item.text = ev.target.value }

const keydown = (item: any) => (ev: any) => {
  if (ev.which === ENTER) ev.target.blur()
  if (ev.which === ESC) {
    item.cancelling = true
    ev.target.blur()
  }
}

const add_todo = (ev: any) => {
  if (ev.which !== ENTER) return
  const title = ev.target.value.trim()
  if (title === '') return
  items.insert({ title, completed: false })
  ev.target.value = ''
  persist()
}

const toggle_all = (ev: any) => {
  const checked = ev.target.checked
  for (const id in items[value]) items[id].completed = checked
  persist()
}

// className handles static class strings; class={{name: vp}} handles reactive
// per-class bindings. Both can sit on the same element — applyProps iterates
// both in order, dispatching to .class() the same way the builder does.
render(document.body, (
  <body>
    <section className="todoapp">

      <header className="header">
        <h1>todos</h1>
        <input
          className="new-todo"
          placeholder="What needs to be done?"
          autofocus=""
          onKeyDown={add_todo}
        />
      </header>

      <section className="main" class={{ hidden: total_count.to((n: number) => n === 0) }}>
        <input
          id="toggle-all"
          className="toggle-all"
          type="checkbox"
          checked={all_complete}
          onChange={toggle_all}
        />
        <label for="toggle-all">Mark all as complete</label>

        <ul className="todo-list">
          <For each={selected} tag="li">
            {(item: any, id: any) => (
              <li class={{ completed: item.completed, editing: item.editing }}>
                <div className="view">
                  <input
                    className="toggle"
                    type="checkbox"
                    checked={item.completed}
                    onChange={toggle(item)}
                  />
                  <label onDblClick={edit(item)}>{item.title}</label>
                  <button className="destroy" onClick={destroy(id)} />
                </div>
                <input
                  className="edit"
                  value={item.text}
                  onBlur={submit(item, id)}
                  onChange={change(item)}
                  onKeyDown={keydown(item)}
                />
              </li>
            )}
          </For>
        </ul>
      </section>

      <footer className="footer" class={{ hidden: total_count.to((n: number) => n === 0) }}>
        <span className="todo-count">
          <strong>{active_count}</strong>
          <span>{active_count.to((n: number) => ` item${n === 1 ? '' : 's'} left`)}</span>
        </span>
        <ul className="filters">
          <li><a href="#/" class={{ selected: route.to((r: string) => r === 'all') }}>All</a></li>
          <li><a href="#/active" class={{ selected: route.to((r: string) => r === 'active') }}>Active</a></li>
          <li><a href="#/completed" class={{ selected: route.to((r: string) => r === 'completed') }}>Completed</a></li>
        </ul>
        <button
          className="clear-completed"
          class={{ hidden: completed_count.to((n: number) => n === 0) }}
          onClick={clear}
        >
          Clear completed
        </button>
      </footer>

    </section>
  </body>
))
