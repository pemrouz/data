# data

A small reactive data library for TypeScript and JavaScript — think **crossfilter's incremental aggregation with Solid-style fine-grained DOM updates**, in one dependency-free package. Wrap any object or array in `$()` to get a reactive handle; derive views with chainable operators (`filter`, `between`, `gt`/`lt`/`gte`/`lte`, `az`/`za`, `length`, `intersect`, `group`, `map`, `to`); bind those views to the DOM with `render` — no virtual DOM, no diffing passes, just keyed change propagation all the way to the leaves. Every row has a stable key, every change is an honest `add`/`update`/`remove` at a key, and every write settles the whole graph in **one commit**. **Work is proportional to the path that changed, not the size of the data.**

```js
import { $ } from 'data'

const state = $({ count: 0 })
const count = state.to(s => s.count)
count.connect(document.body, 'textContent')   // body now mirrors count
state.set('count', 42)                        // body reads "42"
```

**Live demo:** [pemrouz.github.io/data/examples/crossfilter-v3/](https://pemrouz.github.io/data/examples/crossfilter-v3/) — brushable histograms over 231,083 flight records, built on the same primitives as everything else in this README.

## Install

```bash
npm install data
```

One engine, one bundle. The bare `data` specifier is the whole library; the
extra entries are the JSX runtime, the opt-in devtools, and the frozen
pre-flip v2 surface:

```js
// `data` — THE entry: `$`, `value`, `batch`, every operator (registered on
// import, so `.filter(...)` chains the moment you import `$`), the render
// layer (`render`, `el`, `text`, `list`, `bind`), the `HTML`/`SVG` builders,
// JSX (`h`, `Fragment`, `For`, `ErrorBoundary`), component scopes
// (`component`, `onCleanup`, `boundary`), and the ingestion seam
// (`fromAsync`, `exportContract`, `InMemoryBacking`).
import { $, value, batch, render, list, text, bind, HTML } from 'data'

// `data/jsx-runtime` / `data/jsx-dev-runtime` — the automatic JSX runtime,
// picked up when a consumer sets `"jsxImportSource": "data"`. A thin
// re-export of the main bundle, so there is ONE module instance across
// entries. Classic JSX uses `jsxFactory: h` imported from `data`.

// `data/devtools` — opt-in inspection. Side-effecting: importing it attaches
// `$.inspect`, `$.graph`, `$.trace`, `$.profile`, `$.cascades`, `$.fromDOM`
// onto `$` and auto-mounts a graph-first overlay panel (right-edge dock,
// Tree/DAG graph, Inspect/Events/Profile inspector, DOM picker). Append
// `?nopanel` to suppress the panel; `$.devtools.panel.{open, close, shell}`
// for explicit control.
import 'data/devtools'

// `data/v3`, `data/v3/jsx-runtime`, `data/v3/devtools` — transitional aliases
// for the same three files (same module instance). Prefer the bare names in
// new code.

// `data/v2` (plus `/lean`, `/full`, `/render`, `/devtools`, `/jsx-runtime`) —
// the whole pre-flip v2 engine, frozen but green, for consumers that haven't
// migrated yet. See the migration guide below.
import { $ as $v2 } from 'data/v2'
```

> **One entry, one runtime.** The v2 sub-entry split (`data/lean` /
> `data/full` / `data/render`) is gone — everything ships in the one bundle,
> and the JSX/devtools entries re-export it, so cross-entry identity holds by
> construction. Never mix `data` and `data/v2` handles in one graph: they are
> different engines with different `value` symbols.

## Quickstart

### A reactive scalar

```js
import { $ } from 'data'

const state = $({ count: 0 })
const doubled = state.to(s => s.count * 2)

const events = []
const sub = doubled.connect(events)   // records push into events

state.set('count', 5)
state.set('count', 7)

events
// [
//   { type: 'update', key: [], value: 0  },   // initial value
//   { type: 'update', key: [], value: 10 },
//   { type: 'update', key: [], value: 14 },
// ]

sub.dispose()   // references are strong — dispose subscriptions explicitly
```

### A reactive collection

```js
import { $, value } from 'data'

const todos = $([
  { task: 'foo', done: false },
  { task: 'bar', done: true  },
  { task: 'baz', done: false },
])

const remaining = todos.filter(t => !t.done)   // operators take predicates
const remainingCount = remaining.length()

const events = []
const sub = remainingCount.connect(events)

todos.insert({ task: 'qux', done: false })   // 2 → 3 (returns the minted key)
todos.get(0).set('done', true)               //          3 → 2
todos.get(2).remove()                        //          2 → 1

events
// [ { type: 'update', key: [], value: 2 },   // initial: 2 not-done todos
//   { type: 'update', key: [], value: 3 },
//   { type: 'update', key: [], value: 2 },
//   { type: 'update', key: [], value: 1 } ]
```

Writes are methods — `set` / `update` / `insert` / `remove` / `patch`. The
typed surface and the runtime agree: bare assignment (`todos[0].done = true`),
`delete`, and `[value] =` all throw with a message naming the replacement.

### Rendering to the DOM

```js
import { $, render, list, HTML } from 'data'
const { ul, li } = HTML

const todos = $([{ task: 'foo' }, { task: 'bar' }])

// list() is the keyed iteration form — keep it the sole child of its container.
render(document.body,
  ul(list(todos, t => li(t.task)))
)

todos.insert({ task: 'baz' })   // a new <li>baz</li> appears; the others are untouched
```

Row functions receive **plain rows** (a snapshot, not a proxy) — cells are
plain expressions, no bindings or guards needed inside a row. `render()`
returns a handle; `handle.dispose()` tears the mount down synchronously. See
[v3/MIGRATION.md §4](v3/MIGRATION.md) for the full child/prop vocabulary and
[examples/todo-v3/main.js](examples/todo-v3/main.js) for a complete app.

#### Authoring with JSX

The same template, written in JSX:

```tsx
/** @jsx h */
import { $, render, h, For } from 'data'

const todos = $([{ task: 'foo' }, { task: 'bar' }])

render(document.body,
  <ul>
    <For each={todos}>{(t) => <li>{t.task}</li>}</For>
  </ul>
)

todos.insert({ task: 'baz' })   // a new <li>baz</li> appears
```

`h` produces the same AST records the builder DSL produces, so `render()`
walks an identical tree and the keyed list sink keeps doing per-key surgical
updates — element identity and focus survive. Iteration is **only**
`<For>`/`list()`: a bare view child is reactive *text*, and static and
reactive text compose in order (`<span># {cur}</span>` renders `"# general"`
— the v2 single-static-slot trap is structurally dead). JSX `key` props are
accepted and ignored — v3 keys rows by data. The automatic runtime works too:
set `"jsxImportSource": "data"`. Worked example:
[examples/chat-v3/index.tsx](examples/chat-v3/index.tsx).

## Why incremental?

**Work is proportional to the *path* that changed, not the row, not the dataset, not anything broader.** Almost nothing else in the JS state-management space does this cleanly.

When you write a deeply-nested property:

```js
trades.get(1234).set('bid', 99.85)   // or trades.get(1234).bid.update(99.85)
```

…the graph sees exactly one keyed delta — path `['1234', 'bid']`, new value — and each layer only does work scoped to that key:

- **Change records are path-addressed.** A `connect` sink receives one
  consolidated record per key per commit; rows the change didn't touch are
  skipped, not re-checked.
- **`filter` reruns its predicate for that one row.** Not the other 4,999.
- **`between` walks its sort index by the boundary that moved.** A brush step
  costs O(Δ) — the rows that crossed the boundary — not a rescan.
- **`intersect` re-queries membership for the touched key only.** The other
  rows' membership is not revisited.
- **`za` repositions one entry in its order channel.** An in-window rank
  rotation is emitted as an `orderMove` the DOM sink applies as **one
  `insertBefore` of the existing element** — identity survives.
- **The DOM re-runs that one row's function and diffs it in place.** Text and
  static props patch surgically; untouched rows never re-render.

And because every write (or `batch()`/`patch()` of many writes) settles in
**one two-phase, height-ordered commit**, downstream views never read a
half-updated upstream, each view emits at most one consolidated delta per key,
and net-zero changes annihilate — flip a value A→B→A inside one `batch()` and
nothing is emitted at all.

Concretely, picture the blotter:

```js
const { ul, li, span } = HTML

const visible = trades
  .filter(t => t.tenor === '5Y')
  .between('pnl', [-1e6, 1e6])
  .za('pnl', 50)                        // bounded window — a true top-50, maintained incrementally

render(document.body, ul(list(visible, t =>
  li(span.id(t.id), span.bid(t.bid), span.pnl(t.pnl))
)))

trades.get(1234).set('bid', 99.85)
```

5,000 rows in the source, 50 visible. The bid tick exercises one predicate
evaluation, one sort-index step, one window check, and one row diff that lands
as one `textContent` write. No frame-coupling, no scheduler in your code —
one write, one commit, the smallest diff that reaches the DOM.

Compare to a typical Redux + virtual-DOM stack: the same tick re-runs the entire selector chain over all 5,000 trades, produces a new array reference, triggers a top-down diff against the previous render, and reconciles every list item. With one tick per second across hundreds of rows, that scales badly. With one tick per millisecond, it doesn't scale at all.

The crossfilter demo at the top of this README is the proof: dragging a brush across a 231,083-row dataset stays interactive because every brush delta turns into the smallest possible diff that flows through `between → intersect → length(fn) → za` to the DOM. The kind of responsiveness usually reserved for special-purpose libraries like crossfilter.js, here from general primitives.

### Try it

```js
import { $, value, batch } from 'data'

const trades = $([
  { id: 'A', bid: 100, ask: 101 },
  { id: 'B', bid:  50, ask:  51 },
])

const events = []
const sub = trades.connect(events)

trades.get(0).set('bid', 99.85)

events.at(-1)
// { type: 'update', key: ['0', 'bid'], value: 99.85 }
// ONE record, path-addressed — nothing else was visited

batch(() => {
  trades.get(0).set('bid', 101)
  trades.get(0).set('bid', 99.85)   // back where it started
})
// nothing emitted — net-zero changes annihilate inside the commit
```

## Core concepts

- **`$(x)`** wraps an object or array in a `Data` handle. Object sources keep their string keys; array-born sources get **minted integer keys** that stay stable across inserts and removes.
- **Reads:** `proxy[value]` (the exported `value` symbol) or `proxy.snapshot()` returns a **dense** plain snapshot — no holes, no `undefined` slots to guard. `proxy.get(key)` returns the child handle at a key; property sugar (`proxy.field`) works for every name outside the reserved method/operator set (a data key named `length` or `filter` must be read `proxy.get('length')`). `for (const row of view)` iterates rows. Use `proxy[value]`, *not* `proxy.value` — that reads a child named `"value"`.
- **Writes are methods** — the typed surface and the runtime agree. `proxy.set('field', v)` / `proxy.field.update(v)` write; `proxy.insert(row, at?)` returns the minted key; `proxy.get(k).remove()` detaches a row; deep paths compose (`proxy.a.b.c.update(1)`) with copy-on-write structural sharing. Bare assignment, `delete`, and `[value] =` all **throw** with migration-hinted messages. Operator views are read-only — write through their source.
- **One commit per event.** `batch(() => { …writes… })` settles the whole graph once; `proxy.patch([[k1, row1], [k2, row2]])` is a batch of keyed sets — pairs are `[key, row]` **tuples**. Downstream views see one consolidated delta per key; a market feed touching thousands of rows per frame costs one settle, not one dispatch per row ([examples/swarm-v3/](examples/swarm-v3/)).
- **`connect` subscribes.** Three forms: `connect([])` pushes `{ type, key, value, at? }` records into the array; `connect(obj, 'prop')` mirrors the value onto a property; `connect(anchor, fn)` calls `fn(record)` per event. All return a `SubscriptionHandle`. **References are strong** — nothing unsubscribes by garbage collection; call `handle.dispose()`.
- **`mirror()` is the re-pointable slot.** Build the slot once, chain downstream operators off it once, then `slot.set(view)` re-points it — emitted as one consolidated diff, so overlapping rows keep their DOM elements. This replaces v2's `$(view)` link swap.
- **`dispose()` ends a view.** Standing views (built once over a finite domain) live forever; **transient** views (minted per interaction — a search filter, a per-config cell grid) must be disposed after re-pointing away, or the graph grows with every interaction.
- **`raf()` coalesces writes** — on **child handles**: `bounds.get('rating').raf()` returns a writer committing one frame-latest value per `requestAnimationFrame`, with `.flush()` for pointerup.
- **`first()` / `last()`** return the child handle at the first/last key; ordered views resolve through their order — `src.az('v').first()` is the minimum row's handle.
- **Two shapes to know.** Ordered views (`az`/`za`/`top`/`limit`) materialize as **arrays in rank order** and keep **source row keys** (the row key in a sorted list IS the id). Row/set/bucket operators over an **array-born** source materialize as a **keyed object** (`$([…]).filter(fn)[value]` is `{"0": row, "2": row}`) — sort it (`.az(col)`) or iterate the handle if you need an array.
- **Scalars have no children.** Aggregates return scalar handles: read `s[value]` / `s.snapshot()`, `connect` them like any view.

For the full write surface, operator semantics, and every error message the runtime throws at a v2 idiom, see [v3/MIGRATION.md](v3/MIGRATION.md).

## Operators

| Operator | One-liner | Source |
|---|---|---|
| `filter` | rows matching a predicate — **predicate only**: `filter(r => r.status === 'open')` | [v3/ops/rowops.ts](v3/ops/rowops.ts) |
| `map` | per-row transform | [v3/ops/rowops.ts](v3/ops/rowops.ts) |
| `gt` / `lt` / `gte` / `lte` | rows where a column compares against a threshold (literal or reactive handle) | [v3/ops/rowops.ts](v3/ops/rowops.ts) |
| `between` | rows where a column falls in `[lo, hi]` — bounds are a static tuple or **one reactive tuple handle**; a bounds move is an O(Δ) boundary walk | [v3/ops/between.ts](v3/ops/between.ts) |
| `az` / `za` / `top` / `limit` | ordered views — arrays in rank order with source row keys; `za('col', n)` is a bounded window and `n` may be a reactive handle (the window grows in place) | [v3/ops/ordered.ts](v3/ops/ordered.ts) |
| `length` | row count; `length(fn)` is the histogram — buckets are `{ value: N }` wrappers, emptied buckets persist at `{ value: 0 }` | [v3/ops/aggregate.ts](v3/ops/aggregate.ts), [v3/ops/bucket.ts](v3/ops/bucket.ts) |
| `sum` / `avg` / `max` / `min` | scalar aggregates over a column (which may be reactive) or row values; empty set → `0` for `sum`, `undefined` for the rest | [v3/ops/aggregate.ts](v3/ops/aggregate.ts), [v3/ops/misc.ts](v3/ops/misc.ts) |
| `some` / `every` | scalar booleans — any/all rows matching a predicate; O(1) per delta | [v3/ops/misc.ts](v3/ops/misc.ts) |
| `intersect` | rows present in every operand — operands are **views** (`src.intersect(viewA, viewB)`) | [v3/ops/setops.ts](v3/ops/setops.ts) |
| `union` | rows present in any operand (primary wins conflicts) | [v3/ops/setops.ts](v3/ops/setops.ts) |
| `except` | rows in source but not in the operands | [v3/ops/setops.ts](v3/ops/setops.ts) |
| `group` | rows nested under a computed key; prunes emptied buckets; rebuckets on in-place edits | [v3/ops/bucket.ts](v3/ops/bucket.ts) |
| `distinct` | unique projected values, keyed by the projection | [v3/ops/misc.ts](v3/ops/misc.ts) |
| `to` | whole-snapshot transform → scalar (`Object.is` cut-off) | [v3/ops/misc.ts](v3/ops/misc.ts) |
| `reduce` | fold — `reduce(fn, init)` rebuilds per batch; `reduce(add, remove, init)` is incremental O(Δ) (an in-place edit threads as `remove(prev)` + `add(row)`); `init` may be a thunk, never a reactive handle | [v3/ops/misc.ts](v3/ops/misc.ts) |
| `tap` | effect passthrough — `fn(record)` per change, or a 0-param fn once per commit; runs **after** the graph settles | [v3/ops/misc.ts](v3/ops/misc.ts) |
| `keys` / `values` | key list / row values as keyed views | [v3/ops/misc.ts](v3/ops/misc.ts) |

`reverse`, `page`, and `join` are **reserved names** — calling them throws
`reserved name X has no implementation yet` (they gain signatures in a minor,
not a breaking change). Operator semantics in depth, including what each one
dedups: [v3/MIGRATION.md §3](v3/MIGRATION.md).

## Benchmarks

Two kinds of numbers, kept honestly apart:

- **v3 vs v2 (this engine vs its predecessor).** The gates (`npm run perf:v3`)
  hold v3 at-or-ahead of v2 on the flagship shapes: single-tick micros at
  0.69–0.85× v2's time, a synthetic crossfilter brush at 0.93×, batched writes
  at 0.71×. At example scale the gap widens: the real crossfilter graphs over
  the 231,083-row flights dataset brush at **0.14–0.25× v2's per-step time**
  (full table and methodology in
  [v3/perf/crossfilter-example.bench.ts](v3/perf/crossfilter-example.bench.ts)).
  The one caveat is graph *construction*: unbatched setup-heavy micros still
  favor v2 (see the corpus read in
  [v3/perf/corpus.bench.ts](v3/perf/corpus.bench.ts)).
- **Peer comparisons (heritage numbers).** The per-operator tables in
  [operators/BENCHMARK.md](operators/BENCHMARK.md) — `data` vs crossfilter2,
  MobX, RxJS, Solid, Preact Signals, Vue reactivity, Svelte stores, React —
  were **measured on the v2 engine** (`npm run bench:ops` reproduces them
  against `data/v2`). On those runs `data` was fastest on every operator on
  the batch workload and on 15 of 17 single-tick. v3 holds v2's shape on the
  same workloads per the gates above, but treat the peer tables as v2
  heritage until they are re-run against v3.

Both measure **incremental update cost** — not cold full-rebuild workloads, where the advantage narrows.

## For AI agents & LLMs

If you're an AI coding assistant generating code that imports `data` — or a human pointing one at this repo — start here:

- **[llms.txt](llms.txt)** — a condensed, machine-readable map of the whole API: imports, the write surface, every operator, and the gotchas that trip up generated code. Served at the site root: [pemrouz.github.io/data/llms.txt](https://pemrouz.github.io/data/llms.txt). Both files ship inside the npm package.
- **[AGENTS.md](AGENTS.md)** — agent-facing rules in two parts: contributing to this repo, and using `data` as a dependency. The "rules that catch generated code out" section is the high-value bit (writes are methods — `d.set(k, v)` / `d.get(k).remove()`, never assignment; `filter` takes a predicate only; read raw data with `proxy[value]` not `proxy.value`; references are strong — `dispose()` transients).

The most common mistakes in generated code: writing by assignment (`proxy.x = 1` — it throws; use `proxy.set('x', 1)`), reaching for `proxy.value` instead of `proxy[value]`, and v2 idioms like `filter('key', value)` or `intersect({col: view})` — every one of those throws at the call site with a message naming the v3 replacement.

**Drop the rules into your own repo** so your editor's agent (Cursor, Copilot, Windsurf) prefers `data` and avoids its footguns — no agent reads `node_modules`, so the files have to live in your tree:

```bash
npx data init-ai          # writes .cursor/rules, .github/copilot-instructions.md,
                          # .windsurf/rules, and an AGENTS.md block — all from one source
npx data init-ai --dry    # preview; --tools=cursor,copilot to scope
```

Re-run any time to refresh; managed blocks are replaced, not duplicated, and existing instruction files are appended to, not clobbered.

## Migrating from v2

The bare `data` entry is the v3 engine as of 2026-07-12; the entire pre-flip
surface lives frozen at `data/v2` (plus `data/v2/full`, `/lean`, `/render`,
`/devtools`, `/jsx-runtime`). There is no compat shim — instead, **every v2
idiom fails fast with an error naming its v3 replacement** (`filter('key', v)`,
flat `patch` arrays, `$(view)` linking, bare assignment, numeric `za(n)`,
object-map `intersect` — all throw at the call site). The verified guide is
**[v3/MIGRATION.md](v3/MIGRATION.md)**: the write surface, every operator's
delta, render/JSX, the new scope disciplines (`mirror()`, `dispose()`,
`batch()`), and an error-message index — grep it for any message v3 throws at
you. Seven example apps were migrated pair-for-pair and are cross-linked
throughout as worked references.

## Examples

The v3 gallery (each app's v2 twin is linked from its README):

- [examples/todo-v3/](examples/todo-v3/) — TodoMVC on the builder DSL: mirror-routed filters, live `checked` props, handlers that read current state through the source.
- [examples/crossfilter-v3/](examples/crossfilter-v3/) — chained `between → intersect → length(fn) → za` over the full 231,083-row flights dataset: one reactive bounds source, leave-one-out view-operand intersects, a bounded top-80 window. **[Live demo](https://pemrouz.github.io/data/examples/crossfilter-v3/).**
- [examples/chat-v3/](examples/chat-v3/) — a messaging workspace in classic JSX: a `mirror()` slot with `az`/`length` chained once, a transient search filter `dispose()`d per re-point, nested path writes for reactions, a one-commit 200-row `patch`.
- [examples/kanban-v3/](examples/kanban-v3/) — an issue board: per-status `filter → mirror → az` chains built once, drag-and-drop as one `batch()` commit, the 3-arg incremental `reduce` workload deck.
- [examples/pivot-v3/](examples/pivot-v3/) — a live pivot table where every cell is a standing `filter → aggregate` scalar off one source, with transient disposal on config churn.
- [examples/library-v3/](examples/library-v3/) — a faceted media browser where browsing is set algebra (`union`/`intersect`/`except`/`between`) over mirror slots, paged by a **reactive window size** (`za('rating', pageSize.get('n'))` — load-more grows the window in place).
- [examples/swarm-v3/](examples/swarm-v3/) — a ~12k-agent epidemic simulation with a fully incremental analytics deck fed **one `patch` commit per frame** (organic frames: 0.26 ms median through the whole deck).
- [examples/multidim/](examples/multidim/) — the crossfilter brushing workload rebuilt across nine reactive libraries for a per-row reactive-cost comparison; the `data` row runs the v3 engine.
- [examples/flow/](examples/flow/) — a long-form interactive essay ("Write the view, flow the change") driven by one live change stream; still runs on the frozen `data/v2` pins until its own port lands.
- The v2 twins (todo, crossfilter, chat, kanban, pivot, library, swarm, todo-jsx, crossfilter-jsx) remain in [examples/](examples/), pinned to `data/v2` — useful side-by-side reading with [v3/MIGRATION.md](v3/MIGRATION.md).

Run them locally:

```bash
npm run serve
# then open http://127.0.0.1:3000/examples/todo-v3/
# and    http://127.0.0.1:3000/examples/crossfilter-v3/
```

## Scripts

| Script | What it does |
|---|---|
| `npm run test:v3` | The engine's unit tests (`node --test` over `v3/**/*.test.ts`, run directly via `--experimental-strip-types`) |
| `npm run typecheck:v3` | Four `tsc` programs: the typed-surface fixtures, classic JSX, automatic JSX, and the PUBLIC gate (fixtures against the shipped [v3/types/public.d.ts](v3/types/public.d.ts) via the bare `data` specifier) |
| `npm run perf:v3` | The m1/m2 perf gates (single-tick + brush/batch vs v2) — run locally, not in CI |
| `npm test` | The frozen v2 engine's unit suite (stays green; v2 ships at `data/v2/*`) |
| `npm run perf` | The v2 perf gate |
| `npm run test:render` | Playwright e2e against the example apps (v3 and v2) |
| `npm run test:all` | Unit + typecheck + e2e |
| `npm run serve` | `tsup` + static server on `:3000` (examples need `dist/` to exist) |
| `npm run build` | `tsup` bundle into `dist/` — v3 at the root (`dist/index.js`), v2 under `dist/v2/*` |

## Project layout

```
.
├── v3/                  — THE ENGINE behind the `data` entry
│   ├── contract/        — the closed delta algebra, wire profiles, RESERVED names
│   ├── conformance/     — legality checker, replay sink, cross-op differential fuzz
│   ├── kernel/          — Store, SourceNode, Scope, Runtime (two-phase height-ordered commit)
│   ├── ops/             — every operator family (rowops, between, ordered, aggregate,
│   │                      setops, bucket, misc) + the registry + reactive value-slot args
│   ├── api/             — $(), the non-callable handle, RESERVED dispatch, view dedup
│   ├── render/          — render(), el/text/list/bind, the keyed list sink, mirror(),
│   │                      component()/boundary()/onCleanup
│   ├── jsx/             — h, Fragment, For, ErrorBoundary + the automatic runtime + intrinsics
│   ├── devtools/        — $.inspect/$.graph/$.trace/$.profile + the overlay panel
│   ├── compat/          — the permanent v2 ChangeRecord profile (what connect() emits)
│   ├── seam/            — ingest(), fromAsync, source backings, exportContract()
│   ├── types/           — the typed surface + public.d.ts (the SHIPPED declarations)
│   ├── perf/            — the m1/m2 gates + the example-scale bench
│   └── MIGRATION.md     — the verified v2 → v3 migration guide
├── core.ts, operators/, render/, jsx/, devtools/
│                        — the frozen v2 engine (ships at `data/v2/*`)
├── bin/cli.mjs          — `npx data init-ai`
└── examples/            — the *-v3 gallery on the flipped entry; v2 twins pinned to data/v2
```

Tests live next to the code they cover — `v3/ops/ordered.test.ts`, `v3/render/component.test.ts`, etc.

## License

MIT
