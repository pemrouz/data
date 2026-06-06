# todo-jsx — TodoMVC, authored in JSX

**The JSX port of [../todo](../todo).** Functionally identical app, same data model and reactive bindings — only the authoring layer changes. Every `HTML.div(...)` builder chain is rewritten as `<div .../>`, and because `h()` returns the **same `NodeProxy` AST** the builders produce, `render()` walks an identical tree and `DOMSink` does the same per-key surgical updates. Per-key DOM identity (and input focus) is preserved across reactive updates.

```jsx
import { $, value, render, h, Fragment, For } from 'data/full'   // full = ops + JSX helpers

const items   = $(JSON.parse(localStorage.getItem(KEY) || '{}'))  // object source, keyed by id
const selected = $(items.filter('completed', false))              // re-pointed on hashchange

<For each={selected} tag="li">{(item, id) =>                       // data-iteration over a view
  <li class={{ completed: item.completed, editing: item.editing }}>…</li>
}</For>
```

## What it exercises

- **`data/full` (not `data`)** — pulls in both the operator dispatch table *and* the JSX helpers (`h`, `Fragment`, `For`). Importing from one bundle keeps `h()` and `HTML.*` sharing the same `NodeProxy` class and `NODE` symbol, so cross-bundle `instanceof` can't silently fail.
- **`<For each={selected} tag="li">`** — the JSX form of data iteration over a `ViewProxy`. `selected` is a `$(view)` swap re-pointed on `hashchange` (`filters.all` / `.active` / `.completed`); the list catches up surgically.
- **`class={{ name: vp }}` vs `className="…"`** — reactive per-class bindings (`{ completed: item.completed, editing: item.editing }`, `{ hidden: total_count.to(n => n === 0) }`) alongside static class strings on the same element; `applyProps` iterates both, dispatching to `.class()` like the builder does.
- **Reactive text & attrs** — `{item.title}`, `checked={item.completed}`, `value={item.text}` bind `ViewProxy` children/props directly; an in-place `item.title = …` is a `BU2` that rewrites only that node's subtree.
- **Same scalar views as the sibling** — `length()` counts (`active_count`, `completed_count`, `total_count`) and a `.to(...)` fold for `all_complete`, identical to the builder version.

## JSX-specific notes

- `tsconfig.json` just `extends` the shared [../../tsconfig.jsx.json](../../tsconfig.jsx.json) (`jsx: react`, `jsxFactory: h`, `jsxFragmentFactory: Fragment`); the `/** @jsx h */` pragmas at the top of [index.tsx](index.tsx) match.
- `npm run serve` runs `build:examples-jsx` (a `tsc` pass) to emit the sibling `.js` — committed sources are `.tsx`/`.html`/`tsconfig`, the `.js` is gitignored.
- Append `?devtools` to the URL to lazy-load the inspection panel; off by default so the JSX example mirrors the vanilla todo's byte-clean baseline.

See **[../todo](../todo)** for the underlying data model and event handlers — they are line-for-line the same here.

## Library guarantee it pins

[tests/todo-jsx.spec.ts](../../tests/todo-jsx.spec.ts) asserts (1) the JSX `.todo-list` HTML is byte-identical to the builder version for the same state, and (2) **DOM identity survives** a title edit and a row insert — markers on untouched rows persist, proving JSX did not degrade into whole-subtree replacement.

## Run

```
npm run serve
```

Open `http://localhost:3000/examples/todo-jsx/`. Add todos (Enter), toggle completion, double-click a label to edit, and switch All / Active / Completed via the footer filters — behaviour is indistinguishable from [../todo](../todo).
