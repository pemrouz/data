# data

A small reactive data library for TypeScript and JavaScript. Wrap any value or collection in `$()` to get a reactive proxy; derive views with chainable operators (`filter`, `between`, `sort`, `length`, `intersect`, `group`, `map`, `to`, `debounce`); bind those views to the DOM with `render` — no virtual DOM, no diffing, just incremental change propagation all the way to the leaves.

```js
import { $, value } from 'data'

const count = $(0)
count.connect(document.body, 'textContent')   // body now mirrors count
count[value] = 42                              // body reads "42"
```

**Live demo:** [pemrouz.github.io/data/examples/crossfilter/](https://pemrouz.github.io/data/examples/crossfilter/) — brushable histograms over 50 000 flight records, built on the same primitives as everything else in this README.

## Install

```bash
npm install data
```

## Quickstart

### A reactive scalar

```js
import { $, value } from 'data'

const count = $(0)
const doubled = count.to(n => n * 2)

const events = doubled.connect([])   // events array captures every change

count[value] = 5
count[value] = 7

events
// [
//   { type: 'update', key: [], value: 0  },   // initial value
//   { type: 'update', key: [], value: 10 },
//   { type: 'update', key: [], value: 14 },
// ]
```

### A reactive collection

```js
import { $, value } from 'data'

const todos = $([
  { task: 'foo', done: false },
  { task: 'bar', done: true  },
  { task: 'baz', done: false },
])

const remaining = todos.filter('done', false)
const remainingCount = remaining.length()

const events = remainingCount.connect([])

todos.insert({ task: 'qux', done: false })   // pushes 3 → 4 onto remainingCount
todos[0].done = true                         //          4 → 3
delete todos[2]                              //          3 → 2

events
// [ { type: 'update', key: [], value: 2 },   // initial: 2 not-done todos
//   { type: 'update', key: [], value: 3 },
//   { type: 'update', key: [], value: 4 },
//   { type: 'update', key: [], value: 3 },
//   { type: 'update', key: [], value: 2 } ]
```

### Rendering to the DOM

```js
import { $, render, HTML } from 'data'
const { ul, li } = HTML

const todos = $([{ task: 'foo' }, { task: 'bar' }])

render(document.body,
  ul(todos, (node, item, key) => node.text(item.task))
)

todos.insert({ task: 'baz' })   // a new <li>baz</li> appears
```

See [render/README.md](render/README.md) for the full template syntax.

## Why incremental?

The thing this library does that almost nothing else does cleanly: **a change to one row only does work proportional to that one row, all the way through the operator chain to the DOM.**

Consider a trading blotter — say 5 000 trades, filtered by tenor, sorted by P&L, rendered as a list:

```js
const trades   = $([...])
const visible  = trades.filter('tenor', '5Y').between('pnl', [-1e6, 1e6]).za('pnl', 50)
render(document.body, ul(visible, (node, t) => node.text(t.id)))
```

A market-data tick updates the bid/ask on one row:

```js
trades[1234].bid = 99.85
```

What happens:

1. The row's bid changes → `filter` re-evaluates the predicate **for that one row only**.
2. `between` checks whether the new pnl crosses a boundary — incremental, not a full rescan.
3. `za`'s sorted index inserts/repositions one entry; if the row was already in the top-50 and stayed, only that entry updates.
4. The `<li>` for trade 1234 has its text/attribute updated. No DOM diff, no list re-render, no key reconciliation pass.

In a typical Redux-style setup, the same tick would re-run the entire selector chain over all 5 000 trades, produce a new array reference, and trigger a full virtual-DOM diff against the previous render. With one tick per second across hundreds of rows, that scales badly. With one tick per millisecond, it doesn't scale at all.

Operators here are written to do this minimum-work propagation by construction — `filter` is row-by-row, `between` keeps a sorted index, `intersect` uses bitmasks, `length` increments a counter, etc. See [operators/README.md](operators/README.md) for the per-operator strategy.

The crossfilter demo at the top of this README is the proof: dragging a brush across a 50 000-row dataset stays interactive at 60 fps because every brush delta turns into the smallest possible diff that flows through `between → intersect → length(group) → za → limit` to the DOM. That kind of responsiveness is hard to replicate with a `useState` + virtual-DOM stack — and you don't need a special-purpose library like `crossfilter.js` for it. The primitives here are general.

## Core concepts

- **`$(x)`** wraps any value, object, or array in a `ViewProxy` — the user-facing handle.
- **`proxy[value]`** reads the raw underlying data. Use the `value` symbol, *not* `proxy.value` (that would create a child view named `"value"`).
- **Mutate by assignment.** `proxy.foo = 1` updates a field; `proxy[2].done = true` updates a nested row; `delete proxy[1]` removes a row; `proxy[value] = newValue` replaces the entire value.
- **Operators chain.** Each operator returns a new `ViewProxy` you can chain further: `data.filter(...).between(...).length()`.
- **`connect` subscribes.** Three forms:
  - `proxy.connect([])` pushes `{ type, key, value, at? }` change events into an array — best for tests, debug logging, and inspecting what flows through.
  - `proxy.connect(obj, 'prop')` mirrors the value to `obj[prop]` — best for binding to a DOM property (`document.body.textContent`) or a state object field.
  - `proxy.connect(obj, fn)` calls `fn(change)` per event — `obj` is just the lifetime anchor (a sink stays alive while the object does).

For internals — the View / Sink / notification model — see [.claude/architecture.md](.claude/architecture.md).

## Operators

| Operator | One-liner | Reference |
|---|---|---|
| `filter` | rows matching a predicate | [operators/filter/](operators/filter/) |
| `between` | rows where a column falls in a range | [operators/between/](operators/between/) |
| `za` / `az` / `top` / `limit` | sort and/or limit | [operators/sort/](operators/sort/) |
| `length` | row count, or grouped counts | [operators/length/](operators/length/) |
| `intersect` | rows present in all source views | [operators/intersect/](operators/intersect/) |
| `group` | rows nested under a computed key | [operators/group/](operators/group/) |
| `map` | per-row transform | [operators/map/](operators/map/) |
| `to` | whole-value transform | [operators/to/](operators/to/) |
| `debounce` | delay updates, coalesce bursts | [operators/debounce/](operators/debounce/) |

Index with longer summaries and the dispatch model: [operators/README.md](operators/README.md).

## Examples

Two example apps live in [examples/](examples/):

- [examples/todo/](examples/todo/) — TodoMVC: filter on `done`, route via hash, edit-in-place, length counters.
- [examples/crossfilter/](examples/crossfilter/) — chained `between → intersect → length(group) → za → limit` over ~500 (and 50 000) flight records, with brushable histograms. **[Live demo](https://pemrouz.github.io/data/examples/crossfilter/).**

Run them locally:

```bash
npm run serve
# then open http://127.0.0.1:3000/examples/todo/
# and    http://127.0.0.1:3000/examples/crossfilter/
```

## Scripts

| Script | What it does |
|---|---|
| `npm test` | Unit tests (`node --test`, runs `*.test.ts` directly via `--experimental-strip-types`) |
| `npm run perf` | Perf assertions — median-of-5 timings with hard thresholds |
| `npm run test:render` | Playwright e2e against the example apps |
| `npm run test:all` | Both `test` and `test:render` |
| `npm run serve` | `tsc` + static server on `:3000` |
| `npm run build` | microbundle bundle into `build/` |

## Project layout

```
.
├── core.ts           — $, ViewProxy, View, Value, Sink (foundation)
├── index.ts          — package entry; re-exports + operator dispatch table
├── utils.ts          — small helpers
├── row.ts            — RowOperator base class (used by filter, map)
├── operators/
│   ├── README.md     — operator index
│   ├── filter/       — each operator: index.ts + tests + perf + README.md
│   ├── between/
│   ├── sort/         — covers za, az, top, limit
│   ├── length/
│   ├── intersect/
│   ├── group/
│   ├── map/
│   ├── to/
│   └── debounce/
├── render/
│   ├── README.md     — render layer reference
│   └── index.ts      — render(), HTML, SVG
└── examples/
    ├── todo/
    └── crossfilter/
```

Tests and perf checks live next to the code they cover — `operators/filter/filter.test.ts`, `operators/filter/filter.perf.ts`, etc.

## License

MIT
