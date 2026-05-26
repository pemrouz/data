# data

A small reactive data library for TypeScript and JavaScript — think **crossfilter's incremental aggregation with Solid-style fine-grained DOM updates**, in one dependency-free package. Wrap any value or collection in `$()` to get a reactive proxy; derive views with chainable operators (`filter`, `between`, `gt`/`lt`/`gte`/`lte`, `sort`, `length`, `intersect`, `group`, `map`, `to`); bind those views to the DOM with `render` — no virtual DOM, no diffing, just incremental change propagation all the way to the leaves. **Work is proportional to the path that changed, not the size of the data.**

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

Five sub-path entries:

```js
// `data` — the default entry. Core + render + every operator (.filter, .between,
// .length, …) registered on import, so chaining works the moment you import `$`.
// This is the one you want.
import { $, value, render, HTML } from 'data'

// `data/full` — everything in `data` plus the JSX helpers (h, Fragment, For).
// Import this when you author views in JSX.
import { $, value, render, HTML, h, For } from 'data/full'

// `data/lean` — registration-free core: same exports as `data` minus the
// operator dispatch. Pick this only to tree-shake operators you don't use
// (register a hand-picked subset onto `Operators` yourself, or call the
// function-style operator API). Calling `.filter(...)` on a `data/lean` proxy
// throws, pointing back at `data`.
import { $, value, render, HTML } from 'data/lean'

// `data/render` — just the DOM render layer (render, HTML, SVG). For consumers
// who want the rendering primitives without pulling the reactive runtime.
import { render, HTML, SVG } from 'data/render'

// `data/devtools` — opt-in inspection helpers. Side-effecting: importing it
// attaches `$.inspect`, `$.graph`, `$.fromDOM`, `$.highlight`, `$.trace`,
// `$.profile` onto the canonical `$`, AND auto-mounts a graph-first overlay
// panel — right-edge dock with a Tree/DAG graph view and a slide-in
// inspector (Inspect / Events / Profile tabs), Alt-hover badges, a DOM
// picker, and a draggable left-edge resize handle. The shell is rendered
// into a closed Shadow DOM root so page CSS can't leak in. Append `?nopanel`
// to suppress the panel; only load this entry when you want the helpers
// (gate behind a query param in production). See
// [devtools/README.md](devtools/README.md).
import 'data/devtools'
```

`data` registers every operator on import, so `proxy.filter(...)` works out of
the box — reach for it by default. `data/full` is a strict superset that adds
the JSX authoring layer. `data/lean` is the same core with the registration
omitted, for when bundle size matters more than out-of-the-box ergonomics.

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

todos.insert({ task: 'qux', done: false })   // pushes 2 → 3 onto remainingCount
todos[0].done = true                         //          3 → 2
delete todos[2]                              //          2 → 1

events
// [ { type: 'update', key: [], value: 2 },   // initial: 2 not-done todos
//   { type: 'update', key: [], value: 3 },
//   { type: 'update', key: [], value: 2 },
//   { type: 'update', key: [], value: 1 } ]
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

#### Authoring with JSX

The same template, written in JSX:

```tsx
/** @jsx h */
import { $, render, h, For } from 'data/full'

const todos = $([{ task: 'foo' }, { task: 'bar' }])

render(document.body,
  <ul>
    <For each={todos} tag="li">
      {(item) => <li>{item.task}</li>}
    </For>
  </ul>
)

todos.insert({ task: 'baz' })   // a new <li>baz</li> appears
```

`h` returns the same `NodeProxy` AST the builder DSL produces, so `render()` walks an identical tree and `DOMSink` keeps doing per-key surgical updates — element identity and focus survive. ViewProxy children with no function sibling route through `.text()`; with a sibling function they stay on the data path so `[VP, fn]` still works as a data-iteration shorthand. Worked examples: [examples/todo-jsx/](examples/todo-jsx/) and [examples/crossfilter-jsx/](examples/crossfilter-jsx/).

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
- **`raf` writes.** `const write = proxy.raf()` returns a coalescing writer: `write(v)` schedules a single `requestAnimationFrame` that commits the latest pending value to `proxy[value]`; further calls before the frame fires overwrite the pending value. `write.flush()` commits immediately — for `pointerup` handlers that want the final brush position to land without an extra frame. Replaces hand-rolled `rafWriter` patterns in interactive UIs.
- **`first` / `last`** return the proxy at the first / last key of an array-shaped view (snapshot at call time). Sugar for `proxy[0]` / `proxy[length - 1]` and the equivalent for objects (first / last enumerable key).

For internals — the View / Sink / notification model — see [.claude/architecture.md](.claude/architecture.md).

## Operators

| Operator | One-liner | Reference |
|---|---|---|
| `filter` | rows matching a predicate | [operators/filter/](operators/filter/) |
| `between` | rows where a column falls in a range (sort-indexed; reactive bounds) | [operators/between/](operators/between/) |
| `gt` / `lt` / `gte` / `lte` | rows where a column compares against a literal threshold (RowOperator; O(1) per tick) | [operators/compare/](operators/compare/) |
| `za` / `az` / `top` / `limit` | sort and/or limit | [operators/sort/](operators/sort/) |
| `length` | row count, or grouped counts | [operators/length/](operators/length/) |
| `sum` / `avg` / `max` / `min` | scalar aggregates over a column or row values | [operators/aggregate/](operators/aggregate/) |
| `some` / `every` | scalar booleans — any/all rows matching a predicate | [operators/aggregate/](operators/aggregate/) |
| `intersect` | rows present in all source views (or in dims, except a named one) | [operators/intersect/](operators/intersect/) |
| `union` | rows present in any source (value from the first containing it) | [operators/union/](operators/union/) |
| `except` | rows in source but not in other | [operators/except/](operators/except/) |
| `group` | rows nested under a computed key | [operators/group/](operators/group/) |
| `distinct` | first-seen unique rows by an optional projection | [operators/distinct/](operators/distinct/) |
| `map` | per-row transform | [operators/map/](operators/map/) |
| `to` | whole-value transform | [operators/to/](operators/to/) |
| `reduce` | general fold — `reduce(fn, init)` rebuilds on change; `reduce(add, remove, init)` threads inserts/removes through in O(Δ) | [operators/reduce/](operators/reduce/) |
| `tap` | passthrough that fires `fn(change)` per event for declarative side effects; 0-arg `fn` opts into a cheap "fire on any change" path (no clone, fires once per emit) | [operators/tap/](operators/tap/) |
| `keys` / `values` | current `Object.keys` / `Object.values` as a reactive array | [operators/keys/](operators/keys/) |
| `reverse` | array order flipped | [operators/reverse/](operators/reverse/) |

Index with longer summaries and the dispatch model: [operators/README.md](operators/README.md).

## Examples

Two example apps live in [examples/](examples/):

- [examples/todo/](examples/todo/) — TodoMVC: filter on `done`, route via hash, edit-in-place, length counters.
- [examples/crossfilter/](examples/crossfilter/) — chained `between → intersect → length(group) → za → limit` over ~500 (and 50 000) flight records, with brushable histograms. **[Live demo](https://pemrouz.github.io/data/examples/crossfilter/).**
- [examples/todo-jsx/](examples/todo-jsx/) and [examples/crossfilter-jsx/](examples/crossfilter-jsx/) — same two apps written in JSX rather than the builder DSL. Functionally identical; demonstrates that the JSX adapter preserves DOMSink's per-key incremental updates.

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
| `npm run serve` | `tsup` + static server on `:3000` (examples need `dist/` to exist) |
| `npm run build` | `tsup` bundle into `dist/` (ESM + per-entry types) |

## Project layout

```
.
├── core.ts           — $, ViewProxy, View, Value, Sink (foundation)
├── lean.ts           — `data/lean` entry: core re-exports only, no operator dispatch
├── index.ts          — `data` entry (default): lean.ts + registers all operators
├── full.ts           — `data/full` entry: index.ts + JSX helpers (h, Fragment, For)
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
│   └── to/
├── render/
│   ├── README.md     — render layer reference
│   └── index.ts      — render(), HTML, SVG
├── jsx/
│   └── index.ts      — h, Fragment, For (JSX adapter over HTML/SVG)
├── devtools/
│   ├── README.md     — `data/devtools` reference
│   ├── index.ts      — opt-in $.inspect/$.graph/$.fromDOM/$.highlight + $.trace/$.profile
│   ├── walk.ts       — pure graph walk + iterRoots + summarize + classify
│   ├── instrument.ts — View.prototype monkey-patch (gated by trace/profile)
│   ├── events.ts     — trace dispatch + profile bucketing + re-entrancy depth
│   └── panel/        — overlay UI: single-file panel (right-edge dock, Tree/DAG graph, Inspect/Events/Profile inspector, picker, Alt-hover)
└── examples/
    ├── todo/         and todo-jsx/         (same app, two authoring styles)
    └── crossfilter/  and crossfilter-jsx/
```

Tests and perf checks live next to the code they cover — `operators/filter/filter.test.ts`, `operators/filter/filter.perf.ts`, etc.

## License

MIT
