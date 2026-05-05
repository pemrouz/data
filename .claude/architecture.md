# Architecture reference

Deep reference for the View / Sink / notification system in this repo. Read this when working on internals (anything in [core.ts](../core.ts), [row.ts](../row.ts), or implementing a non-row operator). For the public API and conventions, see [../CLAUDE.md](../CLAUDE.md).

## Layered model

```
$(value)
  └─ ViewProxy        — the user-facing handle (Proxy wrapping a View)
      └─ View         — graph node: tracks parent, child views, sinks
          └─ Value    — owns the underlying data; emits notifications
              ↑
              └─ Operator (extends Value)  — derived data (filter, sort, …)
```

- `$` ([core.ts:16](../core.ts#L16)) constructs a `ViewProxy` over a fresh `View`. If you pass another `ViewProxy`, it produces a `LinkedView` instead ([core.ts:252-260](../core.ts#L252-L260)).
- `Value` ([core.ts:60](../core.ts#L60)) holds the data and exposes mutation entrypoints (`update`, `insert`, `remove`) which dispatch to the appropriate notification method based on key-path length.
- `Operator extends Value` ([core.ts:233](../core.ts#L233)). Operators *also* receive notifications (as sinks of their parent) and *emit* notifications (as the source of their own view's sinks).
- `View` ([core.ts:235](../core.ts#L235)) tracks the parent `View` (`p`), the path key from root (`key`), child views (`views: Map<name, WeakRef<View>>`), and subscribers (`sinks: Set<WeakRef<Sink>>`).
- `ViewProxy` ([core.ts:531](../core.ts#L531)) translates JS proxy traps into `Value` mutations:
  - `proxy.x = v` → `res.update(v, [...key, 'x'])`.
  - `delete proxy.x` → `res.remove([...key, 'x'])`.
  - `proxy.x` → returns a child `ViewProxy` lazily (creates child `View` on demand).
  - `proxy[value]` (the `value` symbol) returns the raw underlying value.
  - `proxy.method(args)` — if `method` is a registered operator name (in `Operators`), instantiates/reuses the operator class; if it's `connect`, wires up a sink; otherwise dispatches `update`/`insert`/`remove`.

## Symbols

Defined at [core.ts:4-6](../core.ts#L4-L6):

- `value` — accessor for the raw underlying data. Use `proxy[value]`, not `proxy.value`.
- `view` — accessor for the underlying `View` object. Used internally and by `LinkedView`.
- `reactive` — `Symbol.for('reactive')` (cross-realm). Truthy on any `ViewProxy`; useful as a duck-type test.

## Notification codes

Internal method names on `Value` / `View` / `Sink` follow this scheme:

| Prefix | Verb | Suffix digit |
|---|---|---|
| `X` = at root (no key context) | `U` = update | `0` = direct (no key, or "at" position for inserts) |
| `B` = on a branch (with key info) | `I` = insert | `1` = single name |
|  | `R` = remove | `2` = full key path (depth ≥ 2) |

The full set actually used: **`XU0`, `XR0`, `BU1`, `BU2`, `BI0`, `BI2`, `BR1`, `BR2`**. There is no `BU0`/`BR0`/`BI1` — those collapse to `XU0`/`XR0` and `BI0`.

| Code | Meaning | Payload shape | Dispatched by |
|---|---|---|---|
| `XU0(value)` | root value replaced | scalar value | `Value.update([])` ([core.ts:142](../core.ts#L142)) |
| `XR0(value)` | root removed | prior value | `Value.remove([])` ([core.ts:85](../core.ts#L85)) |
| `BU1(U1)` | one or more children updated | `[name, value, name, value, …]` | `Value.update([k])` ([core.ts:148](../core.ts#L148)) |
| `BU2(U2)` | nested updates | `[keyPath, value, …]` | `Value.update(path)` where `path.length ≥ 2` ([core.ts:165](../core.ts#L165)) |
| `BI0(I0)` | inserts at this level | `[at, value, at, value, …]` (at may be undefined → auto-key) | `Value.insert([])` ([core.ts:182](../core.ts#L182)) |
| `BI2(I2)` | inserts at nested path | `[keyPath, value, at, …]` | `Value.insert(path)` ([core.ts:206](../core.ts#L206)) |
| `BR1(R1)` | child removals | `[name, value, …]` | `Value.remove([k])` ([core.ts:104](../core.ts#L104)) |
| `BR2(R2)` | nested removals | `[keyPath, value, …]` | `Value.remove(path)` ([core.ts:118](../core.ts#L118)) |

Inside operator code you'll see local arrays named `NU1` / `NI0` / `NR1` (e.g. [row.ts:9](../row.ts#L9), [core.ts:148-163](../core.ts#L148-L163)). These are **accumulator buffers** ("New U1 list") collected during a single mutation, then passed to `view.BU1(NU1)`, `view.BI0(NI0)`, etc. They are not separate notification methods.

### Propagation (View)

`View` re-publishes notifications down to children and sinks ([core.ts:262-364](../core.ts#L262-L364)). Each method:

1. Updates its local `value` cache from the parent's value (if it has a parent).
2. Walks affected children and recursively calls their corresponding notification (e.g. `BU1` calls each child's `XU0`).
3. Iterates sinks and calls the matching method on each.

Special case: when an array's children change (insert/remove), `V1(offset)` ([core.ts:366-371](../core.ts#L366-L371)) re-fires `XU0` on every child view at index ≥ offset, since their underlying data has shifted.

### Sink contract

Sinks live on `View.sinks` as `WeakRef<Sink>`. They must implement the notification methods that interest them. The four built-in sinks ([core.ts:462-529](../core.ts#L462-L529)):

| Sink | Purpose | Used by |
|---|---|---|
| `ArrSink` | Pushes change events into a JS array | Tests via `proxy.connect([])` |
| `PropSink` | Mirrors value to `obj[prop]` | `proxy.connect(obj, 'name')`; `lifetimes` WeakMap holds the sink alive as long as `obj` is alive ([core.ts:491-503](../core.ts#L491-L503)) |
| `FunctionSink` | Calls `fn(change)` per event | `proxy.connect(obj, fn)` |
| `LinkedView` | Forwards updates to a different `View` | Created when you assign one proxy to another (`a[value] = b`) — see [core.ts:427-453](../core.ts#L427-L453) |

External sinks (e.g. `DOMSink` from [render/index.ts:11](../render/index.ts#L11)) follow the same contract — they only need the methods they care about.

## RowOperator contract

[row.ts:5](../row.ts#L5). Base class for operators that process each row independently (filter, map, length-by-fn).

- Override `process(value, name, old_val) → newValue | undefined`. Returning `undefined` excludes the row.
- `XU0` ([row.ts:25-33](../row.ts#L25-L33)) initializes the operator's value by mapping every row through `process`.
- `loop(C, inc, inner)` ([row.ts:8-23](../row.ts#L8-L23)) is the main update path: walks the incoming notification array, calls `process` per row, classifies each row as update/insert/remove based on whether old and new values are defined, accumulates `NU1`/`NI0`/`NR1`, and emits them via `view.BU1` / `view.BI0` / `view.BR1`.
- `BU1`, `BU2`, `BI0`, `BI2`, `BR2` all delegate to `loop` with different `inc` and `inner` flags. Only `BR1` ([row.ts:40-51](../row.ts#L40-L51)) is special-cased because removals don't re-run `process`.

Note that `RowOperator` always emits at the `BU1`/`BI0`/`BR1` level — it flattens nested updates into a single child-level notification. This is why row operators yield an object/array of rows, not a tree.

## Operator dedup

`createOperator` ([core.ts:20-28](../core.ts#L20-L28)) walks the source view's sinks, looks for an existing instance of the same operator class whose `matches(...args)` returns truthy, and reuses it. The same dedup logic also runs inside `ViewProxy.apply` ([core.ts:563-583](../core.ts#L563-L583)) when an operator is invoked via `proxy.<op>()`.

Dedup is opt-in: an operator only participates if it defines `matches`. Currently:

- [operators/between/index.ts:6](../operators/between/index.ts#L6) — matches on column + range.
- [operators/sort/index.ts:6](../operators/sort/index.ts#L6) — `matches(col, n) { return this.col_name == col && this.n == n }`.
- All others (`filter`, `map`, `length`, `intersect`, `group`, `to`, `debounce`) currently have no `matches`, so they create a fresh operator on every call. If you add `matches` to one, also confirm it doesn't break tests that rely on per-call freshness.

An operator's lifetime is tied to *some* downstream `WeakRef` keeping it alive; if all downstream proxies are dropped, the operator gets GC'd and a fresh one is built next time.

## WeakRef sink cleanup

Sinks are stored as `WeakRef`. Iteration happens in `View.sink` ([core.ts:382-388](../core.ts#L382-L388)), `View.some_sink` ([core.ts:373-380](../core.ts#L373-L380)), and `View.each` ([core.ts:390-396](../core.ts#L390-L396)). Each iteration:

1. `deref()` the WeakRef.
2. If `undefined` (collected), delete the entry from the set/map and continue.
3. Otherwise call the per-sink callback.

Practical implications:

- A test that does `proxy.connect([])` *must* keep the returned array bound to a local — once it goes out of scope, the `ArrSink`'s only strong reference is gone and the next GC will silently unsubscribe it.
- `PropSink` extends its lifetime by registering itself in the `lifetimes: WeakMap<obj, Set<sink>>` map ([core.ts:491-503](../core.ts#L491-L503)) — so the sink lives as long as the *target object* does, not the user's reference to the sink.

## Render layer

[render/index.ts](../render/index.ts) attaches reactive data to the DOM:

- `render(parent, nodeProxy)` ([render/index.ts:8-9](../render/index.ts#L8-L9)) entry point.
- `DOMSink` ([render/index.ts:11](../render/index.ts#L11)) is a regular sink — implements `XU0` / `BU1` / etc. to create/remove/reorder DOM nodes.
- `Node` and friends ([render/index.ts:136+](../render/index.ts#L136)) describe the template tree.
- `HTML` and `SVG` ([render/index.ts:350-354](../render/index.ts#L350-L354)) are Proxies that produce builder functions for any tag name (`HTML.div(...)`, `SVG.path(...)`).
- A private `NODE` Symbol ([render/index.ts:5](../render/index.ts#L5)) tags template nodes inside data structures.

## Recent perf-sensitive areas (don't undo silently)

Recent commits in `git log`:

- `perf: incremental LimitValue with large-batch fallback` ([operators/sort/index.ts:169](../operators/sort/index.ts#L169)) — `LimitValue` has both an incremental path and a batch fallback. Touch with care.
- `perf: rAF-coalesce brush input in crossfilter example` — `examples/crossfilter/` coalesces brush events via `requestAnimationFrame`. Don't re-introduce a synchronous path.
- `fix(core): propagate path-updates through LinkedView child views` — `LinkedView` (extends `View`, [core.ts:427](../core.ts#L427)) had a propagation bug; check `proxy/link` ([core.test.ts:83-132](../core.test.ts#L83-L132)) before changing it.
- `perf: skip empty-batch notifications in intersect/between/length` — multiple operators short-circuit on empty `U1`/`I0`/`R1` arrays. Preserve those guards.

## When updating this file

If you change the notification scheme, sink contract, propagation rules, or operator dedup behavior, update the affected sections of this file in the same commit. If you add a new sink type or a new notification code, extend the relevant table.
