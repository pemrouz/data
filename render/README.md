# render

DOM bindings for reactive views. `render(parent, template)` mounts a template tree under a real DOM node; `HTML.<tag>` and `SVG.<tag>` are Proxy-backed builders that produce chainable `NodeProxy` templates. Reactive values flow through the modifiers (`.text`, `.attr`, `.class`, `.style`) and update the DOM directly — no virtual DOM, no diffing.

## Quickstart

```js
import { $, render, HTML } from 'data'
const { div, h1, ul, li, button } = HTML

const todos = $([{ task: 'foo' }, { task: 'bar' }])

render(document.body,
  div.app(
    h1('Todos'),
    ul(todos, (node, item) => node.text(item.task)),
    button('Add').on('click', () => todos.insert({ task: 'new' }))
  )
)
```

## `render(parent, template)`

Entry point at [index.ts:8](index.ts#L8).

- `parent` — a real DOM node (typically `document.body`).
- `template` — a `NodeProxy` returned from `HTML.*` / `SVG.*` builders.

## Builders: `HTML` and `SVG`

Both are Proxy objects ([index.ts:350-354](index.ts#L350-L354)). Any property access returns a tag builder:

```js
const { div, span, h1, button } = HTML
const { svg, g, path, rect, circle } = SVG
```

`SVG` builders create elements in the SVG namespace (`http://www.w3.org/2000/svg`). Otherwise the API is identical.

A tag builder is callable, chainable, and reusable:

```js
div                                          // <div>
div('hello')                                 // <div>hello</div>
div(child1, child2)                          // <div>...</div>
div.classname                                // <div class="classname">
div.classname['#some-id']                    // <div class="classname" id="some-id">
div.classname.text('hi').on('click', fn)     // <div class="classname">hi</div> with click handler
```

## Modifiers

All modifiers return the same `NodeProxy` so they chain.

| Modifier | Use |
|---|---|
| `.text(value)` | Set text content. `value` may be a string or a reactive `ViewProxy`. |
| `.attr(name, value)` | Set one attribute. `value` may be reactive. |
| `.attr({ k: v, ... })` | Set multiple attributes. |
| `.class(name)` | Add class unconditionally. |
| `.class(name, condition)` | Toggle class on a (reactive) condition. |
| `.style(prop, value)` | Set inline style; `value` may be reactive. |
| `.on(event, handler)` | Attach a DOM event listener. |
| `.nodes(...children)` | Add children. (Equivalent to passing them as call arguments.) |

## Shorthand syntaxes

The examples lean on these heavily — they read tightly once you know the rules.

| Shorthand | Effect | Example |
|---|---|---|
| `.classname` | Add a class. Underscores become dashes. | `div.todo_list` → `<div class="todo-list">` |
| `['#id']` | Set the element id. | `div['#toggle-all']` → `<div id="toggle-all">` |
| `['attr=value']` | Set an attribute. | `input['placeholder=Search...']` → `<input placeholder="Search...">` |
| `['attr=']` | Set a boolean attribute. | `input['autofocus=']` → `<input autofocus>` |

These compose with method-style modifiers freely:

```js
input.new_todo['placeholder=What needs to be done?']['autofocus=']
  .on('keydown', addTodo)
```

## Reactive collection iteration

The headline pattern: pass a reactive collection as the first argument to a builder, with a render function as the second:

```js
ul(items, (node, item, key) => node.text(item.title))
```

Per source row, the render function receives:

- `node` — a fresh `NodeProxy` for the row's element (configure it like any other)
- `item` — a reactive `ViewProxy` for the row
- `key` — the row's key in the source (string or number)

The render layer handles inserts, removes, and reorders incrementally — no diff pass, no `key` prop. Worked example from [../examples/todo/index.html:127-148](../examples/todo/index.html#L127-L148):

```js
ul.todo_list(
  li(selected, (li, item, id) => li
    .class('completed', item.completed)
    .class('editing', item.editing)
    .nodes(
      div.view(
        input.toggle['type=checkbox']
          .attr('checked', item.completed)
          .on('change', toggle(item)),
        label.on('dblclick', edit(item)).text(item.title),
        button.destroy.on('click', destroy(id))
      ),
      input.edit
        .attr('value', item.text)
        .on('blur', submit(item, id))
    )
  )
)
```

## Reactive values in modifiers

Any modifier that takes a value also accepts a `ViewProxy`. The DOM updates whenever that proxy changes — usually you'll derive the proxy through `.to(...)`:

```js
// reactive text from a derived count
span.text(active_count.to(n => `${n} item${n === 1 ? '' : 's'} left`))

// reactive class
li.class('completed', item.completed)

// reactive boolean attribute
input.toggle['type=checkbox'].attr('checked', item.completed)

// reactive style
section.style('display', filter.to(f => f?.length ? '' : 'none'))
```

The example crossfilter uses this to drive SVG transforms ([../examples/crossfilter/index.html:160-183](../examples/crossfilter/index.html#L160-L183)):

```js
g.tick.attr('transform', t => `translate(${x(t)}, 0)`)(
  line.attr('y2', 6),
  text.attr('y', 9).attr('text-anchor', 'middle').text(format(t))
)
```

## Implementation notes

- The DOM bindings are a `DOMSink` ([index.ts:11](index.ts#L11)) — a regular sink that implements the standard notification methods (`XU0`, `BU1`, `BI0`, `BR1`, …). See [.claude/architecture.md](../.claude/architecture.md) for the sink contract.
- Templates are tagged with a private `NODE` symbol ([index.ts:5](index.ts#L5)) so the builder distinguishes nested templates from raw values when you pass them as children.
- Only three names are exported: `render`, `HTML`, `SVG`. Internal classes (`Node`, `NodeProxy`, `Attr`, `Class`, `Style`, `Text`, `Event`, `ID`, `DOMSink`) are not part of the public surface.
