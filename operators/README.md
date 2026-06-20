# Operators

An operator takes a `ViewProxy` and returns a new `ViewProxy` that derives its value reactively from the source. They chain — every operator's result is itself a source for further operators or for `connect`.

```js
const flights = $([...])

const ohare = flights.filter('origin', 'ORD')        // FilterStringValue
const peakDelays = ohare.between('delay', [60, 240]) // BetweenValue
const byDay = peakDelays.group(f => f.date.slice(0, 10))  // GroupValue
const counts = byDay.length(f => f.airline)         // LengthFnValue
const top10 = counts.za(10)                         // ZANumberValue (limit 10)

top10.connect(console, 'log')   // updates every time `flights` mutates
```

## Catalog

| Operator | What it does | Reactive args | Dedup |
|---|---|---|---|
| [filter](filter/) | rows matching a predicate (function, key/value, key path, or shape) | value (key/path/shape forms) | — |
| [between](between/) | rows where a column falls in `[lo, hi]`; bounds may be reactive | bounds | column + bound source |
| [gt / lt / gte / lte](compare/) | rows where a column compares against a threshold; RowOperator-based, O(1) per tick | threshold | column + value |
| [sort](sort/) — `za` / `az` / `top` / `limit` | sort descending / ascending / windowed top-K (no re-sort) | window size `n` | column + n (all forms) |
| [length](length/) | scalar row count, or `{[key]: {value: count}}` grouped by a function | — | — |
| [sum / avg / max / min](aggregate/) | scalar aggregate over a column (or row values); empty set → `undefined` | column | column |
| [some / every](aggregate/) | scalar boolean — does any / every row match a predicate | — | predicate |
| [intersect](intersect/) | rows present in source AND every additional view (variadic, or a dims object) | sources | sources / `(dims, key)` |
| [union](union/) | rows present in ANY source (value from the first source holding it) | sources | — |
| [except](except/) | rows in source but not in `other` | other | — |
| [group](group/) | nest rows under keys returned by a function (prunes emptied groups) | — | — |
| [distinct](distinct/) | first-seen unique rows, by an optional projection | — | projection + init |
| [map](map/) | per-row transform | — | — |
| [to](to/) | whole-value transform; emits only on change | — | — |
| [reduce](reduce/) | fold — `reduce(fn, init)` (rebuild) or `reduce(add, remove, init)` (incremental) | — | add + remove + init |
| [tap](tap/) | passthrough side effect — `fn(change)` per row, or `fn()` once per emit | — | — |
| [keys / values](keys/) | current `Object.keys` / `Object.values` as a reactive array | — | — |
| [reverse](reverse/) | array order flipped | — | — |

**Reactive args** — operators marked here accept a `ViewProxy` in that argument slot and re-fire when it changes (sources for set algebra; a value/threshold/window/column/bound for the rest). Plain values are captured once. A `ViewProxy` passed where a *function* is expected (e.g. `filter(fn)`, `map`, `group`) is not a reactive arg — a fn closing over reactive state recomputes only on a source delta. `reduce`'s `init` is the fold's seed, not a reactive input (a `ViewProxy` init throws).

**Dedup** — operators with a `matches(...)` method return the same instance when called twice with equivalent args. Operators without dedup create a fresh derived view on every call.

## How dispatch works

The mapping from operator name to class lives in [../register.ts](../register.ts) — a side-effect-only module imported by the default `data` entry ([../index.ts](../index.ts)), which registers every operator on import (`data/full` inherits the registration via `export * from './index.ts'`; the registration-free `data/lean` entry deliberately leaves the dispatch table empty). Each entry is a function that picks a class based on argument shape:

```js
Operators['filter']  = (a, b) => typeof a === 'function' ? FilterValue
                              : typeof a === 'string'   ? FilterStringValue
                              : isArray(a)              ? FilterColumnValue
                              : FilterObjectValue
Operators['between'] = () => BetweenValue
Operators['gt']      = () => GtValue
Operators['lt']      = () => LtValue
Operators['gte']     = () => GteValue
Operators['lte']     = () => LteValue
Operators['length']  = (fn) => typeof fn === 'function' ? LengthFnValue : LengthValue
Operators['za']      = (a, b) => typeof a === 'string' ? ZAColumnValue : ZANumberValue
// …etc
```

So `proxy.filter('done', true)` and `proxy.filter(row => row.done)` resolve to *different* classes via the same `filter` name. Each per-operator README documents the overloads it supports.

## Adding an operator — checklist

This is the canonical list of everything that needs to land when a new operator is added. Follow it top-to-bottom; **code** first, then **dispatch**, then **docs**, then **benchmarks** (if applicable), then run the verification and commit per the working conventions in [../CLAUDE.md](../CLAUDE.md). [../CLAUDE.md](../CLAUDE.md)'s `## Adding a new operator` section is a summary that points back here.

### Code — `operators/<name>/`

1. **`index.ts`** — operator class(es) + standalone factory.
   - Extend `Operator` from [../core.ts](../core.ts), or `RowOperator` from [../row.ts](../row.ts) if you process each row independently.
   - `RowOperator`: implement `process(value, name, old_val) → value | undefined` (return `undefined` to exclude). Examples: [filter/index.ts](filter/index.ts), [map/index.ts](map/index.ts), [compare/index.ts](compare/index.ts).
   - `Operator`: implement the notification methods you care about (`XU0`, `BU1`, `BU2`, `BI0`, `BI2`, `XR0`, `BR1`, `BR2`) — see [../PROTOCOL.md](../PROTOCOL.md) for the legend, propagation rules, and the **array-source shift contract** every key-indexed operator has to follow.
   - Add a `matches(...args)` method if repeated calls with equivalent args should dedup (returns `true` when the cached op should be reused).
   - Export the class(es) and a standalone factory: `export const opName = (source, ...args) => createOperator(source, OpClass, ...args)`.

2. **`<name>.test.ts`** — unit tests covering: initial filter/transform, mutation paths (BU1/BU2/BI0/BR1 as relevant), edge cases (missing column, non-object source value, etc.), array-source shift if the operator is key-indexed, dedup behaviour if `matches()` is implemented. Use [filter/filter.test.ts](filter/filter.test.ts), [between/between.test.ts](between/between.test.ts), or [compare/compare.test.ts](compare/compare.test.ts) as templates.

3. **Perf (Mode A — two parts):** (a) add an entry for the operator to [perf/workloads.ts](../perf/workloads.ts) — `{ N, label, source(n), workloads(n) }` returning one `{ gate, run, batch?, reps?, keep? }` case per measurement (setup, single-row update, batch update); (b) add a thin gate driver `<name>.perf.ts` that loops `Object.entries(<name>.workloads())` and asserts `ok(gateMeasure(w.run, w.reps) < w.gate)`, following [filter/filter.perf.ts](filter/filter.perf.ts). The single workload definition is what both the gate and the report sweep ([perf/run-report.ts](../perf/run-report.ts)) measure, so no report number is unasserted. Hold every graph piece on `keep` (sources + bounds + view) so nothing is GC'd mid-measurement, and vary the keys a batch case touches each rep (else it dedups to a ~0ms no-op). Thresholds are guard rails — don't widen them to make a test pass.

### Dispatch — repo root

4. **[../register.ts](../register.ts)** — the side-effect dispatch module (imported by the default `data` entry, [../index.ts](../index.ts)). Import the class(es), then add `Operators['<name>'] = (...) => OpClass` (or a closure that picks a class based on argument shape, like `filter` does) to the registration block. `data` runs it via `index.ts`'s `import './register.ts'`; `data/full` inherits it via `export * from './index.ts'`; the registration-free `data/lean` entry deliberately leaves dispatch empty.

### Docs — per-operator + cross-cutting

5. **`<name>/README.md`** — operator-specific docs. Signatures, examples (static + dynamic if applicable), behaviour (mutation handling, dedup, fast paths), and a comparison to nearby operators if there's overlap. Templates: [between/README.md](between/README.md), [compare/README.md](compare/README.md).

6. **[./README.md](README.md)** — add a catalog row to the operator table at the top, and a line to the dispatch example showing the routing.

7. **[../README.md](../README.md)** — add a row to the operator table near the bottom, and mention in the top-of-file blurb if it's user-facing.

8. **[../CLAUDE.md](../CLAUDE.md)** — update:
   - The opener paragraph's operator list (`## What this is` section).
   - The dedup gotcha line (in `## Common gotchas`) if the operator has `matches()`.
   - Any other section that references the set of available operators.

### Benchmarks — `comparisons/bench/operators/`

9. **`<name>.bench.ts`** *(optional but encouraged)* — peer-library comparison harness. Mirror an existing file ([filter.bench.ts](../comparisons/bench/operators/filter.bench.ts) is the canonical template, ~400 lines). Pick peer-library equivalents (e.g. `arr.filter(d => d.col > t)` for a `gt`-shape operator) and run the same workload against each.

10. **Regenerate the BENCHMARK summaries** — after adding `<name>.bench.ts`, run:
    ```sh
    npm run bench:ops > /tmp/bench.md
    node comparisons/bench/operators/_gen-bench-md.mjs /tmp/bench.md
    ```
    This patches every `operators/<op>/BENCHMARK.md` in place AND refreshes the top-level [./BENCHMARK.md](BENCHMARK.md) summary.

### Verify & commit

11. **`npm test`** — full suite must pass. New tests in `<name>.test.ts` should be exercised.
12. **`npm run perf`** — no regressions; new perf tests included.
13. **Commit per CLAUDE.md's working conventions** — granular commits with detailed messages, presenting each change for review before running `git commit`.

### When this checklist itself changes

If a new step is added to the convention (e.g. the recent addition of per-operator `BENCHMARK.md` and the top-level summary), update this list AND the `## Adding a new operator` section of [../CLAUDE.md](../CLAUDE.md) in the **same change**. Stale checklists mislead future sessions; the two locations should never drift.

## `connect` (not an operator, but the read path)

Three forms — see [../core.ts](../core.ts) for the implementation:

```js
const events = []
proxy.connect(events)                  // pushes { type, key, value, at } to the array
proxy.connect(obj, 'fieldName')        // mirrors value to obj.fieldName
proxy.connect(obj, change => { ... })  // calls fn on every change
```

`connect`'s sinks are held via `WeakRef`, so keep the returned target alive (a local in your test, an object you own in app code) — once the only strong reference is dropped, the next GC silently unsubscribes.
