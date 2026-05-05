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
| [filter](filter/) | rows matching a predicate (function, key/value, key path, or shape) | — | — |
| [between](between/) | rows where a column falls in `[lo, hi]`; bounds may be reactive | bounds | column + range |
| [sort](sort/) — `za` / `az` / `top` / `limit` | sort descending / ascending / limit (no sort) | — | column + n |
| [length](length/) | scalar row count, or `{[key]: count}` grouped by a function | — | — |
| [intersect](intersect/) | rows present in source AND every additional view passed | sources | — |
| [group](group/) | nest rows under keys returned by a function | — | — |
| [map](map/) | per-row transform | — | — |
| [to](to/) | whole-value transform; emits only on change | — | — |
| [debounce](debounce/) | hold updates for `ms` and emit only the final result of a burst | — | — |

**Reactive args** — operators marked here accept other `ViewProxy`s as arguments and re-fire when those inputs change. Plain values are captured once.

**Dedup** — operators with a `matches(...)` method return the same instance when called twice with equivalent args. Operators without dedup create a fresh derived view on every call.

## How dispatch works

The mapping from operator name to class lives in [../index.ts](../index.ts) (lines 18–32). Each entry is a function that picks a class based on argument shape:

```js
Operators['filter']  = (a, b) => typeof a === 'function' ? FilterValue
                              : typeof a === 'string'   ? FilterStringValue
                              : isArray(a)              ? FilterColumnValue
                              : FilterObjectValue
Operators['between'] = () => BetweenValue
Operators['length']  = (fn) => typeof fn === 'function' ? LengthFnValue : LengthValue
Operators['za']      = (a, b) => typeof a === 'string' ? ZAColumnValue : ZANumberValue
// …etc
```

So `proxy.filter('done', true)` and `proxy.filter(row => row.done)` resolve to *different* classes via the same `filter` name. Each per-operator README documents the overloads it supports.

## Adding an operator

1. Extend `Operator` from [../core.ts](../core.ts), or `RowOperator` from [../row.ts](../row.ts) if your operator processes each row independently.
2. Implement the notification methods you care about (`XU0`, `BU1`, `BI0`, `BR1`, …) — see [.claude/architecture.md](../.claude/architecture.md) for the full code legend and propagation rules.
3. Add a `matches(...args)` method if you want repeated calls with equivalent args to be deduplicated.
4. Register the class in [../index.ts](../index.ts) so `proxy.<name>(...)` dispatches to it.
5. Add `<name>.test.ts` and `<name>.perf.ts` next to the source.

## `connect` (not an operator, but the read path)

Three forms — see [../core.ts](../core.ts) for the implementation:

```js
const events = []
proxy.connect(events)                  // pushes { type, key, value, at } to the array
proxy.connect(obj, 'fieldName')        // mirrors value to obj.fieldName
proxy.connect(obj, change => { ... })  // calls fn on every change
```

`connect`'s sinks are held via `WeakRef`, so keep the returned target alive (a local in your test, an object you own in app code) — once the only strong reference is dropped, the next GC silently unsubscribes.
