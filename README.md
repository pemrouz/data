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

**Work is proportional to the *path* that changed, not the row, not the dataset, not anything broader.** Almost nothing else in the JS state-management space does this cleanly.

When you mutate a deeply-nested property:

```js
trades[1234].bid = 99.85
```

…the underlying notification carries the exact path `['1234', 'bid']` and the new value. Each layer in the pipeline only does work scoped to that path:

- **Direct subscriptions are property-granular.** A sink bound to `trades[1234].bid` fires; a sink bound to `trades[1234].ask` is never even visited. The view graph routes notifications down by path; siblings are skipped, not deferred or re-checked. (Try [the snippet at the bottom of this section](#try-it).)
- **`filter` reruns its predicate for that one row.** Not the other 4,999. `RowOperator` is structured so each row is processed independently — the predicate sees one row, decides keep / drop, and that's the work.
- **`between` does a binary-search step against its sorted index.** Not a rescan. If the new value stays inside the range, no boundary crossing — done.
- **`intersect` flips one bitmask entry per source.** Membership for the other rows is cached as a per-row bitmask; only the changed row's bit toggles.
- **`za` repositions one entry in its sorted index.** If the row was in the top-50 and stayed, the same `<li>` re-emits; if it moves out, one remove + one insert.
- **The DOM updates the single binding tied to the changed path.** `span.bid.text(t.bid)` rewrites that one text node's `textContent`. No diff pass, no list re-render, no key reconciliation, no re-creating the row's `<li>` or its sibling spans.

Concretely, picture the blotter:

```js
const visible = trades.filter('tenor', '5Y').between('pnl', [-1e6, 1e6]).za('pnl', 50)
render(document.body, ul(visible, (node, t) =>
  node.nodes(
    span.id.text(t.id),
    span.bid.text(t.bid),
    span.pnl.text(t.pnl),
  )
))

trades[1234].bid = 99.85
```

5,000 rows in the source, 50 visible. The bid tick exercises one predicate evaluation, one bisect, one bitmask flip, one sorted-index update, and one `textContent =` assignment. No frame-coupling, no batching, no scheduler — propagation is synchronous and purely incremental.

The one honest caveat: row-level operators (`filter`, `map`) flatten nested updates to row-level when they re-emit (architectural choice — see [.claude/architecture.md](.claude/architecture.md)). So a sink subscribed *downstream* of a `filter` to `t.id` will get a redundant notification when `t.bid` changes — but it's a `setProperty(sameValue)` call on one element, not a tree diff. The work stays bounded by the affected row.

Compare to a typical Redux + virtual-DOM stack: the same tick re-runs the entire selector chain over all 5,000 trades, produces a new array reference, triggers a top-down diff against the previous render, and reconciles every list item. With one tick per second across hundreds of rows, that scales badly. With one tick per millisecond, it doesn't scale at all.

Operators here are written for minimum-work propagation by construction. See [operators/README.md](operators/README.md) for each one's strategy.

The crossfilter demo at the top of this README is the proof: dragging a brush across a 50,000-row dataset stays interactive at 60 fps because every brush delta turns into the smallest possible diff that flows through `between → intersect → length(group) → za → limit` to the DOM. The kind of responsiveness usually reserved for special-purpose libraries like crossfilter.js, here from general primitives.

### Try it

```js
const trades = $([
  { id: 'A', bid: 100, ask: 101 },
  { id: 'B', bid:  50, ask:  51 },
])

const idEvents  = trades[0].id.connect([])
const bidEvents = trades[0].bid.connect([])
const askEvents = trades[0].ask.connect([])

trades[0].bid = 99.85

bidEvents.length   // 2  (initial + the change)
askEvents.length   // 1  (just the initial — never visited)
idEvents.length    // 1
```

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
