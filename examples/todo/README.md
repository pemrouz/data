# todo — TodoMVC, the whole loop in one file

**The smallest end-to-end example.** One `$({})` source keyed by id; `filter`, `length`, and a route-driven `$(view)` swap derive everything the UI shows, and `render` applies per-key surgical DOM updates so toggling or editing one row touches exactly that `<li>` (and keeps the edit input focused).

```js
const items   = $(JSON.parse(localStorage.getItem(KEY) || '{}'))  // object source, keyed by id
const filters = {
  completed: items.filter('completed', true),                     // FilterStringValue
  active:    items.filter('completed', false),
  all:       items,
}
const active_count = filters.active.length()                       // remaining count (scalar VP)
const selected     = $(filters.all)                               // re-pointed on hashchange
```

## What it exercises

- **`$({})` object source** — todos are stored under stable string ids (persisted to `localStorage` via `persist()`), so a delete is a per-key removal, not an array tail-pop.
- **`filter('completed', …)`** — the `active`/`completed` views are `FilterStringValue` derivations; toggling a checkbox is one `item.completed = !…` write that moves the row between filters reactively.
- **`length()`** — `active_count`, `completed_count`, `total_count` are scalar views; the "N items left" footer and the empty-state `.hidden` toggles bind straight to them.
- **`to(fn)`** — `all_complete` folds the source into the toggle-all checkbox state; `active_count.to(n => …)` pluralizes "item/items"; `route.to(r => r === …)` drives the filter-tab `.selected` class.
- **`$(view)` swap** — `selected` is a proxy whose `[value]` is re-pointed to `filters[r]` on `hashchange`, so the list re-renders for the All / Active / Completed routes without rebuilding the chain.
- **`render` surgical updates** — `li(selected, (li, item, id) => …)` keys each row by id; editing a title (`dblclick` → `.edit` input → `blur`/`submit`) rewrites just that node's text and the `<input>` keeps focus mid-edit.
- **`items.insert({...})`** — adding a todo on Enter appends one row; **`delete items[id]`** removes one; both flow through to the counts and filtered views.

## Run

```
npm run serve
```

Open http://localhost:3000/examples/todo/ — type and press Enter to add, double-click a label to edit, toggle items, switch the All/Active/Completed tabs (hash routes), and "Clear completed". Append `?devtools` to the URL to load the inspection helpers. State persists to `localStorage`.

See [index.html](index.html) for the full source (markup, derivations, and handlers are all inline).
