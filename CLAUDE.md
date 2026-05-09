# CLAUDE.md

Guide for Claude sessions working in this repo. Read this before making changes.

## What this is

A small TypeScript reactive data library. `$(value)` wraps a value or array into a `ViewProxy`; chainable operators (`filter`, `between`, `sort`, `length`, `sum`/`avg`/`max`/`min`, `intersect`, `group`, `map`, `to`) produce derived reactive views; [render/index.ts](render/index.ts) attaches reactive data to the DOM via `HTML.*`/`SVG.*` builders. JSX authoring is supported via [jsx/index.ts](jsx/index.ts) (`h`, `Fragment`, `For`), re-exported from `data/full`. Inspection helpers live behind the opt-in `data/devtools` entry — see [devtools/README.md](devtools/README.md).

## Source layout and build

`.ts` files at the root and under `operators/`, `render/`, `jsx/`,
`devtools/`, `tests/` are the source of truth. `.gitignore` blanket-ignores
`*.js`; build output goes to `dist/` (gitignored). There are **no committed
`.js` siblings of `.ts` sources** — that scheme was retired. A handful of
hand-written `.js` files remain in tree (e.g.
[render/render.test.js](render/render.test.js),
[assets/landing.js](assets/landing.js), `examples/crossfilter/flights*.js`)
because they have no `.ts` counterpart.

`tsup` produces four sub-path entries that line up 1:1 with the `"exports"`
map in [package.json](package.json):

| Sub-path         | Source       | What it ships |
|---|---|---|
| `data`           | [index.ts](index.ts)              | Lean core: `$`, `value`, `render`, `HTML`, `SVG`, `Operators`, `createOperator`. No operator dispatch registered. |
| `data/full`      | [full.ts](full.ts)                | Strict superset of `data` — same exports plus JSX helpers (`h`, `Fragment`, `For`), with the side effect of registering every operator on the dispatch table. |
| `data/render`    | [render/index.ts](render/index.ts) | Just the DOM render layer (`render`, `HTML`, `SVG`). |
| `data/devtools`  | [devtools/index.ts](devtools/index.ts) | Opt-in inspection helpers — importing this attaches `$.inspect`, `$.graph`, `$.fromDOM`, `$.highlight`, `$.trace`, `$.profile` onto the canonical `$`, AND lazy-loads + auto-mounts an in-page overlay panel ([devtools/panel/](devtools/panel/)) with Graph / Events / Profile tabs and a DOM picker. Append `?nopanel` to the URL to suppress the panel; `$.devtools.panel.{open,close}()` for explicit control. |

Tests do **not** require a build: `node --experimental-strip-types` reads
`.ts` directly. Run `npm test`. Examples *do* require a build because they
import from `dist/` via an import map; `npm run serve` chains `tsup` (and a
small `tsc` pass for the JSX example projects via `build:examples-jsx`)
before the static server.

JSX projects extend a single shared [tsconfig.jsx.json](tsconfig.jsx.json)
(jsx: react, jsxFactory: h, jsxFragmentFactory: Fragment) — both example
dirs ([examples/todo-jsx/tsconfig.json](examples/todo-jsx/tsconfig.json),
[examples/crossfilter-jsx/tsconfig.json](examples/crossfilter-jsx/tsconfig.json))
and [jsx/tsconfig.json](jsx/tsconfig.json) just `extends` it. New JSX
sub-projects should follow the same pattern rather than duplicating the
compilerOptions.

## Commands

From [package.json](package.json):

| Command | What it does |
|---|---|
| `npm test` | Runs `*.test.ts` via `node --experimental-strip-types --test` |
| `npm run perf` | Runs `*.perf.ts` (median-of-5 timing assertions) |
| `npm run test:render` | Playwright e2e against `examples/` |
| `npm run serve` | `tsup` build + static server on `:3000` for examples |
| `npm run build` | `tsup` → `dist/` (ESM + per-entry `.d.ts`) |
| `npm run test:all` | Both unit and Playwright tests |

Tests run TypeScript directly via `--experimental-strip-types` — no compile step needed for testing.

## Public API

- `$(value)` → `ViewProxy`. Read raw value with `proxy[value]` (the `value` Symbol from [core.ts:4](core.ts#L4)). Mutate via assignment: `proxy.foo = 1`, `proxy[2].completed = true`, `delete proxy[1]`, `proxy[value] = newValue`.
- Operators chain off the proxy: `data.filter(d => d.active).between('val', [0, 100]).length()`. The chainable form requires the dispatch table to be populated, which only happens when [full.ts](full.ts) is imported (= the `data/full` package entry). Bare [index.ts](index.ts) (= `data`) is operator-free; calling `.filter(...)` on a proxy without first loading `full.ts` throws an error pointing the user at `data/full`. The canonical dispatch list lives at [full.ts:30-52](full.ts#L30-L52). The dispatch picks a class based on argument shape (e.g. `filter(fn)` → `FilterValue`, `filter('key', val)` → `FilterStringValue`, `filter({k:v})` → `FilterObjectValue`).
- `render(el, template)` from [render/index.ts](render/index.ts); `HTML.div(...)`, `SVG.path(...)` builders.
- `h(tag, props, ...children)`, `Fragment`, `For` from [jsx/index.ts](jsx/index.ts) (re-exported by `data/full`) — JSX adapter over the same builders. `<div className="x">{c}</div>` desugars to `h("div", {className:"x"}, c)` which returns the same `NodeProxy` AST `HTML.div.x(c)` produces. Same `render()`, same `DOMSink`, same per-key surgical updates. ViewProxy children with no function sibling route through `.text()` (preserves element identity); with a function sibling they stay on the data path so `[VP, fn]` keeps working as a data-iteration shorthand.
- `connect` is built-in (not an operator): `proxy.connect([])` returns the array and pushes change events into it; `proxy.connect(obj, 'prop')` mirrors the value to `obj.prop`; `proxy.connect(obj, fn)` calls `fn(change)` on each event. See [core.ts:601-622](core.ts#L601-L622).
- `raf` is built-in (not an operator): `const write = proxy.raf()` returns a coalescing writer. `write(v)` schedules one `requestAnimationFrame` that commits the latest pending value to `proxy[value]`; subsequent calls before the frame fires overwrite the pending value. `write.flush()` commits immediately and cancels the pending frame — for `pointerup` handlers that want the final position to land without an extra frame's latency. Falls back to `setTimeout(cb, 16)` outside the browser. See the `raf` helper near the bottom of `core.ts`.
- `first` / `last` are built-ins (not operators): `proxy.first()` / `proxy.last()` return the child ViewProxy at the source's first / last key (snapshot at call time). Arrays use index 0 / `length - 1`; objects use the first / last enumerable key. Empty sources collapse to key `'0'` so the chainable shape is uniform. See `firstKey` / `lastKey` near the `raf` helper.
- Aggregates `sum(col?)`, `avg(col?)`, `max(col?)`, `min(col?)` return scalar ViewProxies. `col` is optional — without it, the aggregate runs over row values directly; with it, over `row[col]`. `sum`/`avg` are O(1) per delta (running total + count); `max`/`min` recompute O(n) per publish. Empty set → `undefined` (rather than `NaN` for avg / `0` for max/min). Implemented in [operators/aggregate/](operators/aggregate/).

## Adding a new operator

1. Extend `Operator` from [core.ts:233](core.ts#L233), or `RowOperator` from [row.ts:5](row.ts#L5) if it processes each row independently.
2. For `RowOperator`: implement `process(value, name, old_val) → value | undefined` (return `undefined` to exclude the row). [operators/filter/index.ts:41](operators/filter/index.ts#L41) and [operators/map/index.ts](operators/map/index.ts) are the canonical examples.
3. For `Operator`: implement the notification methods you care about (`XU0`, `BU1`, `BU2`, `BI0`, `BI2`, `XR0`, `BR1`, `BR2`) — see legend below.
4. Implement a `matches(...args)` method so `createOperator` can dedup repeated calls — [core.ts:20-28](core.ts#L20-L28).
5. Register the class in [full.ts:30-52](full.ts#L30-L52) so `proxy.<yourOp>(...)` dispatches to it (registrations live on `data/full`, not the lean `data` entry).

For deeper internals — the View/Sink contract, when each notification method fires, parent/child propagation — see [.claude/architecture.md](.claude/architecture.md).

## Notification code legend (quick reference)

The terse method names on `Value`/`View`/`Sink` follow this scheme:

- **Prefix**: `X` = root-level (no key context); `B` = branch (operating on a sub-key).
- **Verb**: `U` = update; `I` = insert; `R` = remove.
- **Suffix digit**: depth of the key path: `0` = direct (no key, or insert position), `1` = single name, `2` = full nested path.

The full set actually used: `XU0`, `XR0`, `BU1`, `BU2`, `BI0`, `BI2`, `BR1`, `BR2`. There is no `BU0`/`BR0`/`BI1` — those collapse to `XU0`/`XR0` and `BI0` respectively.

`NU1`/`NI0`/`NR1` you'll see inside `RowOperator.loop` ([row.ts:9](row.ts#L9)) and `Value.BU1` ([core.ts:148](core.ts#L148)) are **local accumulator arrays** ("New U1 list"), not separate notification methods.

For a fuller breakdown see [.claude/architecture.md](.claude/architecture.md).

## Testing patterns

- `node:test` + `node:assert` (`deepStrictEqual` aliased as `same`, `ok`).
- Override `$.random` for deterministic IDs — see [core.test.ts:7](core.test.ts#L7).
- Capture changes with `res.connect([])`, then assert event shape `{ type: 'update'|'insert'|'remove', key, value, at? }`. See [core.test.ts:9-20](core.test.ts#L9-L20).
- Tests assert downstream views *and* their parent in the same case (e.g. [core.test.ts:134-173](core.test.ts#L134-L173) checks `res`, `res.a`, `res.a[0]`, `res.a[1]`, `res.a[2]` simultaneously).

## Performance test patterns

- Median of 5 `performance.now()` runs, threshold via `ok(elapsed < N)`. Reference: [filter.perf.ts](filter.perf.ts).
- Each `*.perf.ts` typically covers: setup cost, single-row incremental update, batch update.
- Don't widen thresholds to make a perf test pass — investigate the regression. Recent commits (`perf: incremental LimitValue with large-batch fallback`, `perf: rAF-coalesce brush input in crossfilter example`) show active perf work; respect it.
- `npm run bench:compare` runs the cross-library comparison harness in [comparisons/bench/](comparisons/bench/) (this lib vs. crossfilter / MobX / RxJS / Solid / Preact / Vue / Svelte). It **reports**, it does not gate — peer regressions don't fail this repo's CI. Refresh the numbers in [comparisons.html](comparisons.html) when peer versions are bumped.

## Examples

- [examples/todo/](examples/todo/) — basic mutation + filter + length.
- [examples/crossfilter/](examples/crossfilter/) — chained `between → intersect → length(group) → za → limit` over ~500 flight records.
- [examples/todo-jsx/](examples/todo-jsx/) and [examples/crossfilter-jsx/](examples/crossfilter-jsx/) — same two apps written in JSX rather than the builder DSL. Both `tsconfig.json` files extend the shared [tsconfig.jsx.json](tsconfig.jsx.json) at the repo root; `npm run serve` runs `build:examples-jsx` after `tsup` to produce the sibling `.js`. Playwright tests at [tests/todo-jsx.spec.ts](tests/todo-jsx.spec.ts) and [tests/crossfilter-jsx.spec.ts](tests/crossfilter-jsx.spec.ts) assert DOM-identity preservation across reactive updates and brush-parity with the builder version. The example sources type-check without `// @ts-nocheck` thanks to the per-tag intrinsic types in [jsx/jsx.d.ts](jsx/jsx.d.ts) — keep new JSX code typed the same way.

All runnable via `npm run serve` then opening `http://127.0.0.1:3000/examples/todo/` etc.

## Common gotchas

- Use `proxy[value]` (the `value` symbol), **not** `proxy.value`, to read the raw underlying data. `proxy.value` would create a child view named `"value"`.
- Setting one proxy to another (`a[value] = b`) creates a `LinkedView` ([core.ts:427](core.ts#L427)) — `a` now forwards to `b`'s underlying data. See the `proxy/link` test at [core.test.ts:83-132](core.test.ts#L83-L132) for the full semantics.
- Operator dedup is opt-in via a `matches()` method. `between` ([operators/between/index.ts:6](operators/between/index.ts#L6)), `sort`/`za`/`az`/`top` ([operators/sort/index.ts:6](operators/sort/index.ts#L6)), `intersect` ([operators/intersect/index.ts](operators/intersect/index.ts)), and the aggregates `sum`/`avg`/`max`/`min` ([operators/aggregate/index.ts](operators/aggregate/index.ts)) implement it; repeated calls with identical args return the cached view. `filter`, `map`, `length`, `group`, `to` create a fresh operator on every call.
- Sinks are held via `WeakRef` ([core.ts:421](core.ts#L421)). Dropping the only strong reference unsubscribes silently. Tests keep `connect([])`'s return alive in a local for this reason.
- `between()` and similar range operators with reactive bounds (`ViewProxy` args) track their inputs reactively; with plain values they don't.
- Mutations on nested data work transparently: `res.a.b.c = 1` triggers the right notification cascade. No need for immutable updates.
- JSX `<label>{vp}</label>` routes through `.text(vp)` because there's no function sibling — preserves the host element across reactive updates. Adding a function child (`<div>{[vp, fn]}</div>` for a data binding) flips both children to the data path so `node.data = vp` and `node.fn = fn`. See the discriminator at [jsx/index.ts](jsx/index.ts) — `hasRowFn`. Don't author a single-VP child expecting iteration; use `<For>` or the `[vp, fn]` shorthand.
- `node(...)` with a single array arg auto-spreads — see `NodeProxy.apply` in [render/index.ts](render/index.ts). So `node(<Fragment>…</Fragment>)` is equivalent to `node(...children)`. Bare arrays as the only positional arg weren't a documented builder pattern, so this was purely additive.

## Working conventions in this repo (please follow)

- **Keep docs in sync with code.** When you change behavior, the public API, commands, or conventions, update the relevant docs in the *same* change:
  - `CLAUDE.md` for Claude-facing notes (this file).
  - [.claude/architecture.md](.claude/architecture.md) for internals (notification codes, View/Sink contracts, propagation rules).
  - [README.md](README.md) for human-facing usage and API examples.
  
  If you add or remove an operator, update the dispatch description and gotchas here, the legend (if it touches notification codes) in `architecture.md`, and the examples in `README.md`. Stale docs mislead future sessions — assume someone will trust them.

- **Commit granularly with detailed messages.** One logical change per commit (one bug fix, one perf improvement, one doc update — *not* bundled). Follow the existing style visible in `git log`: Conventional-Commits-ish prefixes like `fix(core): ...`, `perf: ...`, `fix(examples/todo): ...`, `docs: ...`. Each message body should explain *why* the change is needed and *what* its visible or internal effect is — not just restate the diff. Commit immediately after each logical change rather than batching at the end of a session, so a partial revert is always possible.

- **Before committing, present the change for review.** Don't commit silently. For each logical change, surface to the user (in chat):
  1. **What changed** — a brief plain-language summary of the diff: which files, which functions/sections, the user-visible or internal effect. For non-trivial code, include the diff itself or the key hunks.
  2. **Why** — the motivation (bug being fixed, regression being prevented, refactor rationale, perf hypothesis).
  3. **Test results** — the relevant tail of `npm test` output (pass count + any test names you added). For bug fixes, name the regression test you added.
  4. **Perf results** — for code changes, the relevant `npm run perf` numbers, ideally with a before/after comparison if you have it. For doc-only changes, state explicitly that perf is N/A and why.
  5. **Anything else relevant** — e.g. a known limitation, a follow-up TODO, a file you intentionally left out of the commit, an unrelated working-tree change you did *not* stage.

  Then commit. The user should never have to read the diff after the fact to understand what landed. Skipping this step also skips the chance to catch a problem before it's in history.

- **Run tests on every change. Extend them if the existing suite doesn't cover the change.** Before committing any code change, run `npm test` and confirm all 62+ tests pass. If your change adds or modifies behavior that isn't already exercised — a new operator, a new branch in an existing operator, a fixed bug, a new edge case — add a test for it in the corresponding `*.test.ts` file. The recently added `proxy/link - child propagation` test in [core.test.ts](core.test.ts) is a good template: it documents *why* the test exists (which regression it catches) in a comment, and asserts both the data shape *and* the change-event stream. A bug fix without a regression test invites the same bug to come back.

- **Run perf tests on every change. Watch for regressions; extend the suite if the change has a new perf surface.** Before committing, run `npm run perf` and confirm all assertions pass *and* the printed timings haven't drifted upward versus what `git log` and the existing thresholds suggest. The thresholds in `*.perf.ts` are guard rails — a change that only just squeaks under one is suspicious. If your change introduces a new hot path or a new operator, add corresponding setup / single-update / batch-update cases to the relevant `*.perf.ts` (or create a new one), following the median-of-5 + `ok(elapsed < N)` shape from [filter.perf.ts](filter.perf.ts). Don't widen thresholds to make a failing perf test pass — investigate the regression instead.

- **Don't undo recent perf work.** Before refactoring `sort.ts` (`LimitValue`), `core.ts` (`LinkedView` propagation), or the crossfilter example's brush handling, check `git log` for recent `perf:` / `fix(core):` commits and understand what they were optimizing.
