# CLAUDE.md

Guide for Claude sessions working in this repo. Read this before making changes.

## What this is

A small TypeScript reactive data library. `$(value)` wraps a value or array into a `ViewProxy`; chainable operators (`filter`, `between`, `sort`, `length`, `intersect`, `group`, `map`, `to`, `debounce`) produce derived reactive views; [render.ts](render.ts) attaches reactive data to the DOM via `HTML.*`/`SVG.*` builders.

## Source of truth: `.ts`. The `.js` siblings are committed compiled output.

[.gitignore](.gitignore) has `# *.js` (commented out, line 6) and `!**/flights.js`, so every `.ts` source has a `.js` next to it that **is tracked in git**. Edit the `.ts` file. Run `npm run build` (or whatever the user's compile step is) before committing if the `.js` needs to stay in sync. Never edit the `.js` files by hand.

## Commands

From [package.json](package.json):

| Command | What it does |
|---|---|
| `npm test` | Runs `*.test.ts` via `node --experimental-strip-types --test` |
| `npm run perf` | Runs `*.perf.ts` (median-of-5 timing assertions) |
| `npm run test:render` | Playwright e2e against `examples/` |
| `npm run serve` | `tsc` + static server on `:3000` for examples |
| `npm run build` | microbundle → `build/` |
| `npm run test:all` | Both unit and Playwright tests |

Tests run TypeScript directly via `--experimental-strip-types` — no compile step needed for testing.

## Public API

- `$(value)` → `ViewProxy`. Read raw value with `proxy[value]` (the `value` Symbol from [core.ts:4](core.ts#L4)). Mutate via assignment: `proxy.foo = 1`, `proxy[2].completed = true`, `delete proxy[1]`, `proxy[value] = newValue`.
- Operators chain off the proxy: `data.filter(d => d.active).between('val', [0, 100]).length()`. The full operator dispatch table is [index.ts:18-32](index.ts#L18-L32) — that's the canonical list. The dispatch picks a class based on argument shape (e.g. `filter(fn)` → `FilterValue`, `filter('key', val)` → `FilterStringValue`, `filter({k:v})` → `FilterObjectValue`).
- `render(el, template)` from [render.ts](render.ts); `HTML.div(...)`, `SVG.path(...)` builders.
- `connect` is built-in (not an operator): `proxy.connect([])` returns the array and pushes change events into it; `proxy.connect(obj, 'prop')` mirrors the value to `obj.prop`; `proxy.connect(obj, fn)` calls `fn(change)` on each event. See [core.ts:601-622](core.ts#L601-L622).

## Adding a new operator

1. Extend `Operator` from [core.ts:233](core.ts#L233), or `RowOperator` from [row.ts:5](row.ts#L5) if it processes each row independently.
2. For `RowOperator`: implement `process(value, name, old_val) → value | undefined` (return `undefined` to exclude the row). [filter.ts:41](filter.ts#L41) and [map.ts](map.ts) are the canonical examples.
3. For `Operator`: implement the notification methods you care about (`XU0`, `BU1`, `BU2`, `BI0`, `BI2`, `XR0`, `BR1`, `BR2`) — see legend below.
4. Implement a `matches(...args)` method so `createOperator` can dedup repeated calls — [core.ts:20-28](core.ts#L20-L28).
5. Register the class in [index.ts:18-32](index.ts#L18-L32) so `proxy.<yourOp>(...)` dispatches to it.

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

## Examples

- [examples/todo/](examples/todo/) — basic mutation + filter + length.
- [examples/crossfilter/](examples/crossfilter/) — chained `between → intersect → length(group) → za → limit` over ~500 flight records.

Both are runnable via `npm run serve` then opening `http://127.0.0.1:3000/examples/todo/` etc.

## Common gotchas

- Use `proxy[value]` (the `value` symbol), **not** `proxy.value`, to read the raw underlying data. `proxy.value` would create a child view named `"value"`.
- Setting one proxy to another (`a[value] = b`) creates a `LinkedView` ([core.ts:427](core.ts#L427)) — `a` now forwards to `b`'s underlying data. See the `proxy/link` test at [core.test.ts:83-132](core.test.ts#L83-L132) for the full semantics.
- Operator dedup is opt-in via a `matches()` method. Currently only `between` ([between.ts:6](between.ts#L6)) and `sort`/`za`/`az`/`top` ([sort.ts:6](sort.ts#L6)) implement it; calling those twice with equivalent args returns the cached view. `filter`, `map`, `length`, `intersect`, `group`, `to`, `debounce` create a fresh operator on every call.
- Sinks are held via `WeakRef` ([core.ts:421](core.ts#L421)). Dropping the only strong reference unsubscribes silently. Tests keep `connect([])`'s return alive in a local for this reason.
- `between()` and similar range operators with reactive bounds (`ViewProxy` args) track their inputs reactively; with plain values they don't.
- Mutations on nested data work transparently: `res.a.b.c = 1` triggers the right notification cascade. No need for immutable updates.

## Working conventions in this repo (please follow)

- **Keep docs in sync with code.** When you change behavior, the public API, commands, or conventions, update the relevant docs in the *same* change:
  - `CLAUDE.md` for Claude-facing notes (this file).
  - [.claude/architecture.md](.claude/architecture.md) for internals (notification codes, View/Sink contracts, propagation rules).
  - [README.md](README.md) for human-facing usage and API examples.
  
  If you add or remove an operator, update the dispatch description and gotchas here, the legend (if it touches notification codes) in `architecture.md`, and the examples in `README.md`. Stale docs mislead future sessions — assume someone will trust them.

- **Commit granularly with detailed messages.** One logical change per commit (one bug fix, one perf improvement, one doc update — *not* bundled). Follow the existing style visible in `git log`: Conventional-Commits-ish prefixes like `fix(core): ...`, `perf: ...`, `fix(examples/todo): ...`, `docs: ...`. Each message body should explain *why* the change is needed and *what* its visible or internal effect is — not just restate the diff. Commit immediately after each logical change rather than batching at the end of a session, so a partial revert is always possible.

- **Don't undo recent perf work.** Before refactoring `sort.ts` (`LimitValue`), `core.ts` (`LinkedView` propagation), or the crossfilter example's brush handling, check `git log` for recent `perf:` / `fix(core):` commits and understand what they were optimizing.
