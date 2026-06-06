# tap

Passthrough side-effect operator — calls `fn` on every event flowing through the chain **and** relays the same event downstream unchanged. For declarative side effects inline in a chain (logging, persistence, debug, redraw). The callback's arity picks the path: a `1+`-arg `fn(change)` gets a cloned change record per row; a `0`-arg `fn()` is a cheaper "something happened, re-read the view yourself" signal.

## Signatures

```ts
proxy.tap(fn: (change: ChangeRecord) => void): Data<T>   // 1+-arg fn → TapValue
proxy.tap(fn: () => void): Data<T>                        // 0-arg fn  → TapBareValue
```

`ChangeRecord` is the `connect(obj, fn)` event shape: `{ type: 'update' | 'insert' | 'remove' | 'move', key, value, at? }` (`from`/`to` instead of `key`/`value` for `'move'`). Dispatch picks the class by `fn.length === 0` — see [../../register.ts:85](../../register.ts#L85) (registered onto `Operators['tap']`, imported by the default [../../index.ts](../../index.ts) entry).

## Examples

```js
// 1-arg: full change records, structuredClone'd value, one per row
const data = $({ a: 1, b: 2 })
const events = []
const t = tap(data, e => events.push(e))
data.a = 10
data.c = 3
delete data.b
// events:
//   { type: 'update', key: [],    value: { a: 1, b: 2 } }   ← initial XU0
//   { type: 'update', key: ['a'], value: 10 }
//   { type: 'insert', key: [],    value: 3, at: 'c' }
//   { type: 'remove', key: ['b'], value: 2 }
t[value]                                   // { a: 10, c: 3 } — tap is a passthrough

// nested edits surface as a full key path
const nested = $({ a: { x: 1 } })
tap(nested, e => events.push(e))
nested.a.x = 99                            // { type: 'update', key: ['a', 'x'], value: 99 }

// inline in a chain — downstream sees identical events
const remaining = tap(data, e => log(e)).filter('done', false).length()

// 0-arg bare path: no record, no clone, fires once per emit
let calls = 0
tap(data, () => { calls++; redraw(data[value]) })   // re-read the live value inside the callback
data.a = 10                                          // calls === 2 (1 was the initial XU0)
```

## Behavior

- **Passthrough, not a transform.** Each batched verb (`XU0`/`XR0`/`BU1`/`BU2`/`BR1`/`BR2`/`BI0`/`BI2`/`BMV1`) forwards the delta it was handed straight to `this.view.<verb>` (never `super.<verb>`), so the same event reaches every downstream operator/DOM sink. `tap`'s view value is aliased to the source's value object, so re-deriving the delta off it would read already-applied state and silently drop removes / same-key whole-row updates — forwarding the handed delta is what keeps a tap-interposed chain byte-identical to a direct one.
- **1-arg path (`TapValue`)** — fires `fn` once per row in a batched verb with a `{ type, key, value, at? }` record; `value` is `structuredClone`'d so the callback can retain it. `key` is `[]` for whole-value/insert events, `[name]` for a single-key edit, and a full path (`['a', 'x']`) for a nested `BU2`. `fn` fires *before* the forward for removes (`BR1`/`BR2`, so the record still carries the leaving value), *after* for the rest.
- **0-arg path (`TapBareValue`)** — fires `fn()` **once per emit** (one batched `BU1`/`BU2`/`BI0`/… → one call), with no record construction and no clone. For hot-path consumers that re-read `proxy[value]` inside the callback (chart redraws, count `textContent`). 40%+ faster on the batch case (see [BENCHMARK.md](BENCHMARK.md)).
- **Strict 0-arity dispatch.** The choice is `fn.length === 0`, not "does the body use its arg" — `(c) => doThing()` (length 1) keeps the full record path. This guards against a minifier dropping an unused param and silently downgrading a real consumer; don't author a 0-arg callback expecting change records.
- **`move` events** — in-window rank rotations from `sort`/`za`/`limit` arrive as `BMV1` and surface as `{ type: 'move', from, to }`, mirroring the `connect(obj, fn)` (FunctionSink) vocabulary.
- **No dedup.** `tap` has no `matches()` — each call constructs a fresh operator. (Aggregates/`distinct`/`reduce`/`between`/sort/compare/`intersect` dedup; `tap`/`union`/`except`/`keys`/`values`/`reverse`/`filter`/`map`/`length`/`group`/`to` do not.)
- **Lifetime** — same as any operator: keep the returned `ViewProxy` alive (the receiving side of the chain anchors it). Drop the chain and the tap unsubscribes silently (sinks are held via `WeakRef`).
