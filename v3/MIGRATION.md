# data v2 → v3 migration guide

Written for a v2 consumer upgrading at the M5 flip. Every code claim in this
document was executed against the v3 runtime before it was written down; the
error strings are quoted verbatim from thrown errors ([api/index.ts](api/index.ts)
and the `ops/` factory guards) — **when v3
throws at you, grep this file for the message** (there is an
[error-message index](#appendix-a--error-message-index) at the bottom). The seven
migrated example pairs are the empirical record of what actually changes in an
app; they are cross-linked throughout and tabulated in
[Appendix B](#appendix-b--worked-references-the-example-pairs).

Imports in every snippet below:

```js
import { $, value, batch, render, list, text, bind, HTML, SVG, h, Fragment, For } from 'data'
```

---

## 1. The mental-model delta

Five sentences of theory; everything else in this guide is a consequence.

1. **Keyed deltas, not positional verbs.** Every row has a stable key — object
   sources keep their string keys, array-born sources get **minted integer
   keys** — and every change is an honest `add`/`update`/`remove` at a key.
   The v2 verb matrix (`BU1`/`BU2`/`BI0A`/`BH1`/`BF0`…), positional
   splice-shift bookkeeping, and sparse arrays with explicit-`undefined` holes
   do not exist.
2. **One commit per event.** A write (or a `batch()`/`patch()` of many writes)
   settles the whole graph in one two-phase, height-ordered commit: each view
   emits **at most one consolidated delta per key**, downstream views never
   read a half-updated upstream, and net-zero changes annihilate (flip A→B→A
   in one batch emits nothing).
3. **Views are DENSE.** `[value]` on any view is a dense plain snapshot — no
   holes, no `dense()` helpers, no `r == null ? '–' : …` defensive bindings,
   no transient-`undefined` field flashes during a re-point.
4. **Writes are METHODS.** `set` / `update` / `insert` / `remove` / `patch` /
   `ingest`. Bare assignment (`d.x = v`), `delete d.x`, and `d[value] = v`
   all **throw** with a message naming the replacement — the typed surface and
   the runtime agree (there is no "runtime accepts it but the types don't"
   gap like late v2 had).
5. **A handle is NOT callable and NOT thenable.** `$(v)` returns a proxy you
   read (`d[value]`, `d.snapshot()`, property sugar, iteration) and call
   methods on. `d(...)` is a TypeError; `await d` returns the handle itself
   (v2's await-for-snapshot sugar is gone — read `[value]`); a data key
   literally named `then` is just data (`$({then: 5}).then[value] === 5`).

Two structural consequences worth internalizing before touching code:

- **Ordered views (`az`/`za`/`top`/`limit`) keep source row keys** and carry
  rank in a separate order channel; they materialize as **arrays in rank
  order**. So the row key in a sorted column IS the card/message id — the
  whole v2 "read the live id off `data-id` because an `az` column is
  array-keyed" workaround is dead ([kanban-v3](../examples/kanban-v3/main.js),
  [chat-v3](../examples/chat-v3/index.tsx)).
- **Row/set/bucket operators over an ARRAY-born source materialize as a keyed
  OBJECT, not an array.** `$([...]).filter(fn)[value]` is
  `{"0": row, "2": row}` (stringified minted keys), because those operators
  have no order channel. v2 gave you a sparse array here. If you need an
  array shape downstream of a filter, sort it (`.az(col)`) or iterate the
  handle (`for (const row of view)` yields rows). Verified:

  ```js
  const arr = $([{v: 3}, {v: 1}, {v: 2}])
  arr[value]                          // [{v:3},{v:1},{v:2}] — source keeps order
  arr.filter(r => r.v > 1)[value]     // {"0":{v:3},"2":{v:2}} — keyed object!
  arr.az('v')[value]                  // [{v:1},{v:2},{v:3}] — ordered = array
  ```

---

## 2. The write surface

Every v2 write idiom, its v3 replacement, and the exact error v3 throws at the
old form (all strings verified by execution).

| v2 idiom | v3 replacement | what v3 does with the old form |
|---|---|---|
| `proxy.field = v` | `d.set('field', v)` or `d.get('field').update(v)` (sugar: `d.field.update(v)`) | throws `data: bare assignment (.field =) is not the write surface — use .get("field").update(v) / .set("field", v) (types and runtime agree in v3)` |
| `proxy.field[value] = v` | `d.get('field').update(v)` | throws `data: [value] whole-view assignment is a v2 idiom — use update()/set()/patch(); the pre-flip surface lives at data/v2` |
| `proxy[value] = newValue` (whole-value hatch) | no direct equivalent — per-key writes, `patch(pairs)`, or `batch(() => …)` | same `[value] whole-view assignment` error; `d.update(v)` on a source root also throws `data: whole-source update — write [value] semantics not yet supported; use per-key writes or batch()` |
| `delete proxy.field` | `d.get('field').remove()` (sugar: `d.field.remove()`) | throws `data: delete is not the write surface — use .get("field").remove()` |
| `proxy.field.remove()` (v2 typed surface) | unchanged — works | — |
| `proxy.a.b.c = 1` (deep write) | `d.a.b.c.update(1)` or `d.get('a').get('b').set('c', 1)` — path-addressed, copy-on-write | bare assignment error as above |
| `proxy.patch([k1, v1, k2, v2])` (flat array) | `d.patch([[k1, v1], [k2, v2]])` — **pairs are `[key, row]` TUPLES**, one commit | throws `data: patch() takes [key, row] TUPLE pairs — patch([[k1, v1], [k2, v2]]); v2's flat [k1, v1, k2, v2] array form is gone` — the tuple-shape pre-scan runs **BEFORE any write**, so nothing commits (snapshot verified unchanged after the throw; the old char-wise garbage-row behavior is gone) |
| `const b = $(a)` (LinkedView) + `b[value] = view` swap | `const slot = a.mirror()` + `slot.set(view)` — see [§5.1](#51-mirror--the-re-pointable-slot) | throws `data: $(handle) would copy through the live proxy — use handle.mirror() for a re-pointable slot, or $(structuredClone(handle[value])) to fork a plain snapshot` — any handle (source root, child path, or derived view; verified all three). The message names the two things you could have meant. |
| `proxy.connect([])` → returns the array | `d.connect(arr)` → returns a **`SubscriptionHandle`** (`{dispose()}`); records still push into `arr` | shape unchanged otherwise: first record is the v2-style whole-value `{type:'update', key:[], value: snapshot}`, then `{type, key: [..path], value, at?}` / `{type:'move', from, to}`. **Scalar** views (aggregates) support the record forms too — see [§3.5](#35-aggregates-and-the-empty-set) |
| `proxy.connect(obj, 'prop')` / `connect(anchor, fn)` | unchanged — work, return a `SubscriptionHandle` | — |
| `proxy.connect(fn)` (single-arg) | still invalid — use `connect(anchor, fn)` | throws `data: connect(fn) is not a valid sink — use connect(anchor, fn) for records, connect([]) for an array, or connect(obj, prop) to mirror` |
| drop the ref to unsubscribe (v2 WeakRef sinks) | **explicit `handle.dispose()`** — v3 references are strong and scope-owned; dropping the ref leaks the subscription until its owner disposes | — |
| `await proxy` → snapshot | `d[value]` / `d.snapshot()` | `await d` returns the handle unchanged (not thenable) — code that awaited a proxy now silently gets a proxy, so grep for `await` on handles |
| `proxy.raf()` (whole-value coalescing writer) | **child handles only**: `bounds.get('rating').raf()` → coalescing writer with `.flush()` / `.cancel()` | a root `raf()` writer throws at commit time with the `whole-source update` error above |
| — (new) | `d.insert(row, at?)` → returns the minted key (source roots only) | on a view: `data: insert() applies to a source root` (same for `patch()`) |

Notes:

- **`get(key)` is the total, collision-free child read.** Property sugar
  (`d.field`) works for every name outside the 45-name RESERVED set
  (`get/set/update/insert/remove/patch/ingest/connect/snapshot/raf/first/last/mirror/dispose`
  + every operator name incl. `page`/`reverse`/`join`). A data key named
  `length` or `filter` MUST be read `d.get('length')`. `d.value` is still a
  child named `"value"` — the raw read is the exported `value` symbol
  (`Symbol.for('data.v3.value')` — a *different* symbol from v2's; never mix
  entries' symbols).
- **Nested field removal is a gap**: `d.get('a').get('b').remove()` throws
  `data: remove() detaches a row — nested field removal not yet supported`.
  Workaround: rewrite the parent row without the field
  (`d.get('a').update({...rest})`).
- **Operator views are read-only.** Any write verb on a derived view (or a
  child of one) throws `data: this view is a derived projection — write
  through its source (operator views are read-only)`. The typed surface
  (`ReadonlyData<T>` in [types/surface.ts](types/surface.ts)) removes the
  write methods entirely, so in TS the mistake fails at the method name.
- **Child handles are addresses, not views** — see [§3.7](#37-child-handles-are-path-addresses--no-chaining-off-children).
- `first()` / `last()` survive unchanged: the child handle at the first/last
  key. Ordered views resolve through the order channel —
  `src.az('v').first()` is the minimum row's handle (verified).
- `connect()` on a child path throws `data: connect() on child paths not yet
  supported — connect the view` (per-path connect is future work; connect the
  view and filter records yourself).
- Array-born sources: `d.get(0)` and `d[0]` address the minted integer key 0;
  numeric-looking property sugar coerces to the minted key.

---

## 3. Operators

### 3.1 filter — PREDICATE ONLY

```js
// v2 — three forms
data.filter(d => d.active)
data.filter('status', 'open')          // GONE
data.filter({ status: 'open' })        // GONE
data.filter('status', $(v))            // GONE (reactive value form)

// v3 — one form
data.filter(r => r.status === 'open')
```

Every v2 non-predicate form — string, object-map, and the reactive-value
variant — throws **at construction**, empty source or not (verified all four):
`data: filter() takes a predicate fn — v2's filter('key', value) /
filter({key: value}) forms are gone: filter(r => r.key === value)`.
(`map` with a non-fn fails fast the same way:
`data: map() takes a fn (row, key) => value`.) For the v2 *reactive-value* filter
(`filter('key', $(v))` re-selecting when `v` changes) the v3 answer is either
a threshold operator (`gt`/`lt`/`gte`/`lte`/`between` — those take reactive
args) or the **transient filter + mirror + dispose** pattern
([§5.2](#52-dispose--transient-compositions); worked in
[chat-v3](../examples/chat-v3/index.tsx) search and
[kanban-v3](../examples/kanban-v3/main.js) chips): a closure over reactive
state is captured once and never re-runs on the state's change, exactly the
documented v2 rule.

The predicate receives `(row, key)`.

### 3.2 between — reactive bounds are a single tuple ref

```js
// v3 (the crossfilter-v3 / library-v3 idiom)
const bounds = $({ rating: [], date: [lo, hi] })
const inRange = media.between('rating', bounds.get('rating'))  // REACTIVE bounds
bounds.set('rating', [4, 10])   // brush = a write; O(Δ) boundary walk
```

- Bounds are one value: a static `[lo, hi]` tuple **or one reactive reference
  to a tuple** (a child handle, as above). `[]` means unfiltered (opens to
  ±∞). Bounds are inclusive on both ends; crossed bounds normalize
  (`[80, 20]` ≡ `[20, 80]`).
- **The v2 tuple-of-two-VPs form `between('col', [$(lo), $(hi)])` throws at
  construction** (it used to build a silently-empty view):
  `data: between() bounds must be plain numbers — v2's [$(lo), $(hi)]
  two-handle tuple is gone: drive both ends from ONE bounds child,
  between(col, bounds.get('range')) where range holds [lo, hi]` (verified for
  root handles and child handles alike; non-handle junk gets the typed variant
  `data: between() bounds must be numbers, got string`). Merge the two bounds
  into one tuple in one source, as above.
- Output is a dense keyed view (no v2 sparse-array `undefined` slots, no
  `BH1`/`BF0` hole protocol — nothing to guard downstream).
- Dedup: static numeric bounds dedup by `col+lo+hi`; a reactive bounds handle
  dedups by the bound node's identity + key path (same rule as v2's
  view-identity dedup).

### 3.3 gt / lt / gte / lte

Unchanged in shape: `d.gt('col', threshold)`, threshold may be reactive
(`d.gt('v', other.get('t'))` re-selects on change — verified). A threshold
move is a coarse O(N) re-scan emitting one consolidated batch; prefer
`between` for a fast-moving bound over a large source (its walk is O(Δ)) —
the same guidance as v2.

### 3.4 Ordered views: az / za / top / limit

```js
// v2                                        // v3
data.za('rating').limit(24)                  data.za('rating', 24)          // bounded window
repage(): fresh za('rating', n) per size     const pageSize = $({ n: 24 })
  change, deduped by matches()               data.za('rating', pageSize.get('n'))
                                             // "load more" = pageSize.get('n').update(n + 24)
                                             // the window GROWS IN PLACE
data.top(5) / data.za(5)  (numeric)          data.top(5)                    // za/az REQUIRE a column or comparator
data.az((a, b) => cmp)                       unchanged (comparator form)
```

- **The old numeric form throws at construction** — over 0/1-row sources too
  (the deferred until-a-second-row-arrives crash is gone; verified):
  `data: za(5) without a column is gone — use top(n) (descending numeric rows)
  / limit(n) (source order), or za(col, n) for a bounded column sort` (`az(5)`
  says `az`; other junk gets `data: az() takes a column name or comparator,
  got object`). Rewrite to `top(n)`/`limit(n)`.
- **Materialize as arrays in rank order; row keys are SOURCE keys** (ids).
  `ord.get('m1')` still addresses message `m1`; change records project
  positions only at the record sink (`{type:'insert', at: 0}` etc.).
- Window size `n` is a **reactive slot** (handle accepted; `Number()`-coerced;
  non-numeric → `Infinity`). This deletes v2's `repage()` concept — see
  [library-v3](../examples/library-v3/main.js).
- `limit(n)` = first n in **view-arrival order** (deterministic; a key removed
  and re-added arrives anew — the same history-dependence v2 documented for
  object sources, now the uniform rule). `top(n)` = descending over the row
  value itself.
- Ties break by view-arrival seq; `undefined`/`null`/`NaN` sort keys order
  LAST in both directions (they stay members — no sparse holes).
- Dedup: `az('col')`/`za('col', n)` with a static column (and static or absent
  n) dedup; comparator closures never dedup; a reactive `n` dedups by the
  bound node's identity.
- All the v2 windowed-sort pathology this section used to need (`BR1A`/`BI0A`
  rotations, `BMV1`, chained-window corruption, `_batchRemove` reconciles) is
  structurally gone; an in-window rank rotation is an `orderMove` the DOM sink
  applies as ONE `insertBefore` of the existing element.

### 3.5 Aggregates and the empty set

`sum(col?)` / `avg(col?)` / `max(col?)` / `min(col?)` / `length()` /
`some(fn)` / `every(fn)` return scalar handles (read `s[value]` or
`s.snapshot()`; **no children** — `s.foo` throws
`data: scalar views have no children (reading .foo)`). **All three `connect`
forms work on a scalar** — v2's documented testing pattern (capture an
aggregate's change stream with `connect([])`) carries over: the record forms
(`connect([])` / `connect(anchor, fn)`) emit the initial whole-value record
`{type:'update', key:[], value}` and then ONE update record per scalar delta
(verified: `sum('v')` over `{a:{v:1},b:{v:2}}` connects as `value: 3`, an
insert appends `value: 6`, a field edit `value: 15`); `connect(obj, prop)`
mirrors as before. All return a `SubscriptionHandle` — `dispose()` detaches.

**Empty-set returns changed for `sum`** (verified):

| aggregate | v2 empty set | v3 empty set |
|---|---|---|
| `sum` | `undefined` | **`0`** |
| `avg` | `undefined` | `undefined` |
| `max` / `min` | `undefined` | `undefined` |
| `length` | `0` | `0` |
| `some` | `false` | `false` |
| `every` | `true` | `true` |

So v2 code like `colPoints[s].to(n => n || 0)` / `pts ?? 0` guards for sum are
dead weight in v3 (kanban-v3 dropped them); avg/max/min formatters still need
their `undefined` branch (pivot-v3's `fmtMoney` renders `—`).

- Rows whose projection is `undefined` **or `null`** are excluded from the
  tracked set entirely (both versions). `NaN` still poisons `sum`.
- All four accept a **reactive column** (`rows.sum(col.get('c'))` /
  `rows.max(cfg.get('c'))` re-aggregate on change — verified: a column move
  emits ONE scalar delta, incremental adds keep flowing after a move, and the
  reactive form dedups by the bound node's identity like every reactive arg).
  The old `max`/`min` silent-`undefined` gap is closed.
- `some`/`every` are O(1)-per-delta counter scalars; semantics identical to
  v2 (Array.prototype's), vacuous truth included.

### 3.6 length(fn) and group(fn)

**Same contract as v2 — carried over deliberately:**

- `d.length(fn)` is the histogram. Buckets are `{ value: N }` wrappers — the
  count lives under `.value` (`counts.get(k)[value].value`; in a binding:
  `text(perChannel.get(c), b => b?.value ?? 0)`, chat-v3). **Emptied buckets
  persist as `{ value: 0 }`** (fixed-keyspace histograms keep stable
  zero-height bars); a moved row creates its new bucket on demand. Verified:
  `{"x":{"value":2},"y":{"value":0}}` after emptying `y`.
- `d.group(fn)` **prunes** emptied buckets (enter/leave semantics). Bucket
  values are `{ [rowKey]: row }` member objects, built fresh per change,
  member keys in sorted order.

**What improved:** rebucketing on in-place field edits is uniform. v2's
array-source `group` froze on `BU2`; v3 rebuckets object- and array-born
sources identically (verified both). Counts stay quiet on non-key edits;
group forwards non-key member edits as bucket updates.

**What you can no longer write:** chaining off a bucket — see next.

### 3.7 Child handles are PATH ADDRESSES — no chaining off children

In v2, `proxy.child` was itself a view you could chain operators off
(`groups[k].sum('x')`, the pivot idiom). In v3 a child handle is an address
into the owning node; calling an operator on it throws:

```
data: .sum(...) on a child path would operate on the OWNING view — chain
operators off the view itself (child handles are addresses, not views)
```

The replacement idiom is **per-cell filters** — one small standing
`filter → aggregate` chain per cell, all off the one source, reconciling by
construction ([pivot-v3](../examples/pivot-v3/main.js)):

```js
// v2 pivot cell                              // v3 pivot cell
sales.group('region')[rv].sum('revenue')      sales.filter(s => s.region === rv).sum('revenue')
```

Child handles still do everything a *path* should: read (`[value]`,
`snapshot()`), write (on source children: `update`/`set`/`remove`/`raf`),
navigate (`get`), and serve as **reactive value-slot args** (`bounds.get('r')`
into `between`, `pageSize.get('n')` into `za`).

### 3.8 Set algebra: intersect / union / except take VIEW OPERANDS

```js
// v2 — object-map form                       // v3 — view operands
pop.intersect({ gx: betweenX, gy: betweenY }) genreSlot.intersect(decadeSlot, ratingView, runtimeView)
a.except(b)                                   unchanged
```

**The v2 object-map form fails fast** — operands validate BEFORE any parent is
touched (it used to poison the runtime: the half-constructed node stayed
attached and every subsequent write to any source crashed until reload):

```
data: intersect() operands must be views, got a plain object — v2's
intersect({col: view}) object-map form is gone; compose the dims explicitly:
src.intersect(src.between('col', bounds.get('col')), …)
```

`union`/`except` name themselves in the same message; any other non-view
operand gets the typed variant (`data: intersect() operands must be views,
got number — pass derived views or sources`). After the throw the runtime is
untouched — subsequent writes settle normally and standing views stay correct
(verified).

Semantics:

- Operands are any keyed views of the same row type — source handles, derived
  views, mirrors, ordered views. Output is unordered, keyed, dense; the
  primary's row is canonical for `intersect`/`except`; `union` exposes the
  first holder in parent order (primary wins conflicts).
- **Key domains must be shared**: object-keyed sources, or views derived from
  one source (minted keys flow through derivations — the crossfilter-v3
  leave-one-out intersects). Two INDEPENDENT array-born sources mint unrelated
  keyspaces, so `a1.intersect(a2)` is honestly **empty** for numeric keys
  (verified; v2 silently intersected by position — the wrong answer), `except`
  ignores cross-domain exclusion bits, and `union` exposes-primary on numeric
  collisions.
- Duplicate/self operands dedup by identity (`a.intersect(a) ≡ a`;
  `a.except(a)` is honestly empty) — the v2 silent-empty bug is fixed.
- The entire v2 C-series corpus (sparse bitmask drift, C12–C16, `BH1`/`BF0`,
  echo ordering) has no v3 counterpart — membership is by key.

### 3.9 reduce

Both arities survive; the contracts tightened:

```js
board.reduce((acc, row, key) => …, init)                    // 2-arg general fold
board.reduce(add, remove, init)                             // 3-arg incremental
board.reduce(add, remove, () => ({}))                       // init may be a THUNK
```

- **The 3-arg form's BU2 rebuild fallback is GONE**: a v3 update delta carries
  `prev`, so an in-place edit is exactly `remove(prevRow)` + `add(newRow)` —
  O(Δ) always, no per-row snapshot cost (kanban-v3's points-per-person deck
  spy-verifies one remove + one add per edit). The `remove`-must-invert-`add`
  symmetry contract is unchanged; note v2's `$.debug` re-fold drift warning
  has **no v3 counterpart yet** — an asymmetric remove still desyncs silently.
- The 2-arg fold walks **display order** for ordered (array-born) parents (v2
  parity for concatenation-style folds), rebuilds O(N) per batch, and
  `structuredClone`s an object init per rebuild.
- A reactive init **throws** (verified):
  `data: reduce(): init must be a plain value or a thunk, not a reactive node
  — a fold seed is its identity element, not a reactive input. For a reactive
  base, derive it upstream (filter/gt/between) and fold the derived view.`
- Object accumulators are emitted as `structuredClone`s with a deep-equality
  cut-off (an in-place-mutating fold emits honestly; an unchanged fold stays
  silent).

### 3.10 to / tap / keys / values / distinct

- `to(fn)` — unchanged in spirit: `fn(plainSnapshot, prev)` → scalar,
  `Object.is` cut-off. Object-born parents materialize plain objects,
  array-born dense arrays in display order (kanban-v3's sprint header).
- `tap(fn)` — the v2 param-presence dispatch is ported verbatim (a declared —
  even defaulted/destructured — param gets per-row v2-shaped cloned records +
  the initial whole-value record; a genuinely parameterless fn fires once per
  batch, no allocation). **Timing changed**: tap fns run as effects AFTER all
  operator state settles (a tap reading a downstream view sees its settled
  value — verified) — v2 ran them inline during propagation. Exception
  handling is **half**-isolated: a throwing tap fn can't corrupt state (the
  commit completes, the graph settles, other effects still run), but the
  triggering write/`batch()` call then throws
  `data: N effect(s) failed during commit` — and the initial
  construction-time invocation is not isolated at all (`.tap(fn)` itself
  throws, verified). Code that relied on observing mid-cascade state must
  move to `connect`.
- `keys()` — incremental `{key: String(key)}` view, updates inert.
  `values()` — identity view, **unordered** (v2's was a dense array; put
  order-hungry sinks on the parent).
- `distinct(fn?)` — the output is keyed by `String(projected value)` and the
  exposed row IS the projected value, not the holding source row
  (`{a:{g:'x'}, b:{g:'y'}}.distinct(r => r.g)[value]` is `{x:'x', y:'y'}` —
  verified). The value is read from a deterministic representative — the
  earliest surviving holder in source key-insertion order, promoted on
  removal (silently, between `Object.is`-equal values); ≤1 output delta per
  distinct key per batch. No-arg `distinct()` dedups; fn forms never do.

### 3.11 Operator dedup + the dispose interaction

The v2 rule survives: **value-identity args dedup, closures never do.**
`d.sum('v') === d.sum('v')`; `d.az('col')`, static `between` bounds,
`top(5)`, no-arg `distinct()`/`keys()`/`values()`/`length()` all dedup;
`filter`/`map`/`group`/`length(fn)`/`some`/`every`/`reduce`/`tap`/`to` and any
comparator/fn form never dedup. Reactive args dedup by the **bound node's
identity + key path** (not current value) — v2's `arg[view]` rule.

New in v3: the dedup cache **evicts disposed views** (lazily, on hit).
`s.dispose(); d.sum('v')` mints a fresh live node instead of handing back the
frozen corpse (the pivot-v3 footgun that motivated the fix). Corollary from
pivot-v3: **don't dispose deduped standing scalars** you didn't mint for a
transient purpose — other code holding the same node goes stale; track and
dispose only your transients ([§5.2](#52-dispose--transient-compositions)).

`view.dispose()` detaches a view permanently: its snapshot freezes and it
stops receiving parent commits (verified). There is no v2 equivalent (v2
sinks died by WeakRef GC); v3 references are strong, so **transient
compositions must be disposed or they accumulate** — the v2 kanban
"operator pileup" now has a real answer instead of an rAF band-aid.

### 3.12 Gone in v3 (no counterpart at the flip)

| v2 surface | status in v3 |
|---|---|
| `filter('key', v)` / `filter({k: v})` / `filter(['path'], v)` | gone — predicate only; old forms throw at construction ([§3.1](#31-filter--predicate-only)) |
| `intersect({col: view})` object-map | gone — view operands; the old form fails fast BEFORE attach ([§3.8](#38-set-algebra-intersect--union--except-take-view-operands)) |
| `between('col', [$(lo), $(hi)])` two-VP bounds | gone — one reactive tuple ref; old form throws at construction ([§3.2](#32-between--reactive-bounds-are-a-single-tuple-ref)) |
| `za(n)` / `az(n)` numeric-only sort | use `top(n)` / `limit(n)`; the numeric form throws at construction ([§3.4](#34-ordered-views-az--za--top--limit)) |
| `reverse()` | RESERVED, unimplemented — throws `data: reserved name reverse has no implementation yet` |
| `page` / `join` | same — reserved names, throw `… has no implementation yet` (they gain signatures in a minor, not a breaking change) |
| single-arg `connect(fn)` | still invalid (throws, same as v2 — the message names the three valid forms) |
| `connect([])` returns the array | returns a `SubscriptionHandle`; keep the handle or a scope alive and `dispose()` explicitly |
| WeakRef auto-unsubscription | gone — strong refs, explicit `dispose()` |
| `$(view)` LinkedView / `linked[value] = view` re-point | `mirror()` / `slot.set(view)`; `$(handle)` throws, pointing at `mirror()` / a `structuredClone` fork ([§2](#2-the-write-surface)) |
| `proxy.raf()` on a whole view | child handles only |
| whole-value hatch `proxy[value] = v` | not yet supported — the error text points at `data/v2`, where the pre-flip surface lives (decision at the flip: no compat shim) |
| `$.debug` reduce drift warning | no counterpart yet |
| `data/devtools` (`$.inspect`, panel, badges) | SHIPPED — importing `data/devtools` attaches `$.inspect`/`$.graph`/`$.trace`/`$.profile`/`$.cascades`/`$.fromDOM` and auto-mounts the overlay panel (`?nopanel` opts out; `$.devtools.panel.{open, close, shell}`). One deliberate delta from v2: a single Alt-badge, not per-row badges |
| `data/lean` / `data/full` / `data/render` sub-entries | one entry: `data` ([§6](#6-entry-points-flipped-2026-07-12)); the old sub-entries live under `data/v2/*` |
| `createOperator` / `Operators` public registration | not exposed; v3 operators register via static module imports |
| nested-field `remove()` | throws `not yet supported` — rewrite the parent row |
| `connect()` on a child path | throws `not yet supported` — connect the view |

---

## 4. Render + JSX

The builders and JSX keep their surface but the child/prop vocabulary is
smaller and stricter. Both transforms (classic `jsxFactory: h` and automatic
`jsxImportSource: "data/v3"`) normalize through one `h`, so records are
byte-identical by construction.

### 4.1 Children: exactly four kinds

| child | v2 behavior | v3 behavior |
|---|---|---|
| string / number | last-wins single `static` slot (the `<span># {cur}</span>` → `"general# "` trap) | **an ordered text child** — `HTML.span('# ', text(cur))` and `<span># {cur}</span>` render `"# general"`, in order (verified record order). The single-static-slot trap is structurally dead. |
| view / handle | `.text()` if no function sibling, data-iteration if one (`hasRowFn`) | **reactive TEXT, always** — never auto-iterates, whatever its siblings |
| `[vp, fn]` pair | data-iteration shorthand | **gone** — the array flattens and the fn throws (below) |
| function | row template (data path) | **THROWS** under an element tag: `data/render: unsupported child — expected a VNode, string/number, view/$ handle, bind(), or a nested array of those` |
| `bind(view, fn)` | — | formatted reactive text (child position) |

**Iteration is ONLY `list(view, rowFn)` / `<For each={view}>{(row, key) => …}</For>`.**
`<For>` misuse throws precise errors, e.g. the wrong-children one ends
"…Iteration is ONLY For/list(); a bare view child is reactive text, and the v2
[vp, fn] shorthand is gone." Keep the list/`<For>` as the **sole child of its
container** — the keyed sink owns the parent's child order through its anchor
(the discipline every migrated example follows). JSX `key` props are
accepted-and-IGNORED (v3 keys rows by data): `h` **strips them from element
props** — no literal `key="…"` DOM attribute lands, and key-only props
collapse to `null` for byte-parity with a keyless call (verified:
`h('li', {key:'k1', class:'row'}, 'x')` deep-equals
`el('li', {class:'row'}, 'x')`; the automatic runtime inherits the strip
through its `h` delegation). `key` never reaches a COMPONENT's props either —
stripped on both transforms. Leaving keys in migrated JSX is harmless;
deleting them is tidier.

### 4.2 Row functions receive PLAIN rows

The rowFn gets `(rowSnapshot, key)` — plain data, not a proxy. On a row
update the renderer re-runs the fn and diffs: text and **static props**
(class-from-row-data) patch surgically; a structural change (child count/tag
changed) rebuilds that row in place; `rtext`/`bind`/nested lists are
self-updating and untouched.

Consequences (the headline readability win — compare the pairs):

- **No `.to()` bindings inside rows.** `m.user.to(u => u ? u[0] : '')`
  becomes `m.user[0].toUpperCase()`.
- **No defensive guards.** The v2 sparse-view and transient-`undefined`
  gotchas are GONE because (a) views are dense — excluded rows are absent,
  not `undefined` slots the template visits; and (b) one-commit settles mean a
  leaving row is a `remove` delta carrying `prev` — its fields never flash
  `undefined` mid-cascade (the v2 chat/library crash-guard class).
- **`key` is the stable source row key** (ordered views included), so the v2
  `data-id` read-back in handlers is unnecessary — close over `id`.
  (kanban-v3 keeps a `data-id` attribute purely for its geometric drag
  hit-test and tests.)

### 4.3 Listeners bind ONCE

`on*` props `addEventListener` at row build and are NOT rebound on row
updates. A handler must read **current** state through the source by stable
key — `items.get(id)[value]`, never its captured row snapshot (which goes
stale after the first patch). Every migrated example's handlers follow
`const card = id => board.get(id)`.

### 4.4 Props: literal attributes + live form props

- **`class`, `for`, `style`, `tabindex` — the literal attribute names.**
  There is no `className`, no `htmlFor`, no style objects, no class
  object-maps, no `ref`. In TS these are compile errors
  ([jsx/intrinsics.ts](jsx/intrinsics.ts)); **in plain JS they pass through
  silently wrong** — verified: `className: 'x'` sets an attribute literally
  named `className` (no styling), `style: {color:'red'}` stringifies to
  `"[object Object]"`. Grep for `className`/object styles when migrating
  JSX.
- Attribute values: `null`/`undefined`/`false` remove, `true` sets the empty
  attribute, everything else stringifies. Reactive values are a bare
  handle/scalar (auto-binds) or `bind(view, fn)` — per-binding surgical
  subscriptions with a normalized-string cut-off.
- **`checked` / `value` are LIVE props**: the renderer writes the DOM
  *property* when the element carries it (the attribute is only the
  pre-interaction default), so a data-driven checkbox keeps following data
  after the user has clicked it (todo-v3's toggle-all).
- Static props DIFF on row update (v2 set them once).

### 4.5 Builders

Dot sugar is unchanged from v2: `div.chart` → class, `div['#charts']` → id,
`a['href=https://x']` → attr (first `=` splits), `_`→`-`
(`input.new_todo` → class `new-todo`; also in tag names). Builders are
immutable values (reusing `div.chart` can't leak state). Explicit `class`
props APPEND to dot classes (`div.card({class: 'pri-high'})` →
`"card pri-high"`, reactive class values compose through a wrapping bind);
id/attrs OVERRIDE. `SVG.*` works inside an `<svg>` subtree (namespace
inherits). The v2 `node([...])` auto-spread pattern is replaced by ordinary
array flattening in children; `Fragment` returns its children array and
disappears.

`render(host, astOrArray)` returns a `RenderHandle` — `handle.dispose()`
tears down every subscription, listener, and row scope synchronously (v2 had
no unmount story).

---

## 5. New disciplines (no v2 counterpart)

### 5.1 mirror() — the re-pointable slot

The `$(view)` swap, done right. Build the slot once, chain downstream ops off
it ONCE, re-point forever:

```js
const viewSlot = chanViews.general.mirror()   // the slot
const ordered  = viewSlot.az('ts')            // chained ONCE — never re-binds
const count    = viewSlot.length()

viewSlot.set(chanViews.dev)                   // a re-point = ONE consolidated diff commit
```

The repoint diffs old vs new snapshot — removes, adds, and updates only for
keys whose row reference changed; **overlapping keys emit nothing, so their
DOM elements survive** (chat-v3's search-narrow keeps the surviving rows'
elements; a write dedups by `Object.is` on the row, verified).
Errors: `mirror()` on a child path, `set()` with a scalar, and cyclic
re-points all throw named messages (see Appendix A). A mirror repoint
re-heights descendants (the library-v3 staleness fix), so downstream views
built before the repoint stay correct.

### 5.2 dispose() — transient compositions

**The decision rule from the shipped examples:**

- **Standing** = built once at startup over a finite domain (per-channel
  filters, per-status columns, per-genre facet views, deduped
  column-aggregates). Never disposed.
- **Transient** = minted per interaction (a search-query filter, a
  multi-select union, a per-config pivot cell grid). **Always dispose the
  previous transient, AFTER re-pointing away from it:**

```js
let transient = null
const repoint = () => {
  const prev = transient
  transient = query ? chanViews[ch].filter(m => m.text.includes(query)) : null
  viewSlot.set(transient ?? chanViews[ch])
  if (prev) prev.dispose()                    // AFTER the slot left it
}
```

This is v3's answer to the v2 kanban lesson (undisposed per-keystroke
operators piling up on the source until every edit paid for all of them; v2
could only rAF-coalesce the damage — v3 keeps the graph exactly as big as
what's on screen, and library-v3's spec pins graph size across a repeated
mint/dispose churn loop). Coalescing fast input to one repoint per frame is still worth doing
(chat-v3/kanban-v3 search), but it's a UX nicety now, not a leak dam.

### 5.3 batch() and patch() — one commit

```js
batch(() => {                                  // N writes, ONE commit
  card(id).set('status', status)
  card(id).set('order', order)
})
messages.patch(pairs)                          // ≡ batch of keyed set()s — [key, row] TUPLES
```

Downstream views settle once (kanban-v3's drag-drop is one commit — each
column sees one batch, not two); consolidation annihilates net-zero updates.
`patch` replaces v2's flat-array form and its "vary the keys per rep or it
dedups" perf gotcha class; writes still dedup by `Object.is` on the row.

### 5.4 Scopes and ownership

Lifecycle is explicit and strong-referenced: `render()` owns a per-mount
Scope, each row owns a child scope (its listeners and bindings die with the
row), `raf()` writers auto-cancel with their ambient scope, and nodes created
during a mount register with it. What you interact with at the flip is just
the two verbs — `view.dispose()` and `renderHandle.dispose()` (plus
`subscription.dispose()` from `connect`). The Scope class itself is not
exported from `data/v3`; the component-level surface is: **`component(fn,
props)`** (a JSX function tag defers to it) invokes `fn` once at MOUNT under
its own child scope, **`onCleanup(fn)`** registers a cleanup on that ambient
scope (it THROWS outside one: `data: onCleanup() called outside a scope`),
and **`boundary(child, fallback)` / `<ErrorBoundary fallback={(err, reset) =>
…}>`** owns its subtree's scope and swaps in the fallback when the subtree
errors (mount-phase synchronously; effect-phase one microtask later). Row fns
are NOT a scope (they re-run on row updates) — `onCleanup` in one throws;
wrap row content in a component. The practical delta from v2: **nothing
unsubscribes by garbage collection anymore** — if you connected it or minted
it transiently, something must dispose it.

### 5.5 The seam (new capability, brief)

`d.ingest(records, {origin?})` applies wire records (both the native v3
profile and v2-shaped `ChangeRecordV2`s) to a source root with origin-token
echo suppression; `fromAsync` / `exportContract` / `InMemoryBacking` ship on
the entry. v2 had no ingestion surface. Errors: `ingest()` on anything but a
source root (a view, a child path) throws
`data: ingest() applies to a source root`.

### 5.6 One runtime

All `$()` sources share the default runtime; reactive args must belong to it
(a cross-runtime arg throws `data: reactive arg (node #N) belongs to a
different runtime than the operator it parameterizes`). The v2 "never mix
proxies across entries" rule survives in spirit: one entry, one runtime, one
`value` symbol.

---

## 6. Entry points (FLIPPED, 2026-07-12)

The flip landed: **`data` — the bare specifier and `dist/index.js` — IS the
v3 engine.** v2 moved whole to `data/v2/*`, frozen but green.

| specifier | file | contents |
|---|---|---|
| `data` | `dist/index.js` | everything: `$`, `value`, `node`, `batch`, `runtime`, `handleFor`, `render`/`el`/`text`/`list`/`bind`, `component`/`boundary`/`onCleanup`, `HTML`/`SVG`/`normChildren`, `h`/`Fragment`/`For`/`ErrorBoundary`, `jsx`/`jsxs`/`jsxDEV`, `fromAsync`/`exportContract`/`InMemoryBacking` |
| `data/jsx-runtime`, `data/jsx-dev-runtime` | `dist/jsx-runtime.js` | thin re-export of the main bundle — **one module instance** across entries (the v2 "self-contained bundles per entry → don't mix proxies across entries" trap is structurally closed). Set `"jsxImportSource": "data"` for the automatic transform; classic uses `jsxFactory: h` imported from `data`. |
| `data/devtools` | `dist/devtools.js` | the v3 inspection layer + overlay panel (every cross-boundary import externalized to `./index.js` — same single-instance rule) |
| `data/v3`, `data/v3/jsx-runtime`, `data/v3/devtools` | same three files | **transitional aliases** — same files, same module instance; pre-flip consumers keep working. Prefer the bare names in new code. |
| `data/v2` (+ `/lean` `/full` `/render` `/devtools` `/devtools/panel` `/jsx-runtime` `/jsx-dev-runtime`) | `dist/v2/*` | the whole pre-flip v2 surface, shifted — the v2 gallery examples, flow/multidim, and the landing page stay pinned here until each migrates |

Examples load via importmap: `{ "data/v3": "../../dist/index.js" }` (the key
kept the transitional alias so no example source changed at the flip).
There are no v3 `lean`/`full`/`render` sub-entries — one bundle, operators
installed by static imports (tree-shakers keep them via the `./v3/ops/*.ts`
entries in package.json `sideEffects`). TypeScript consumers: `exports["."]`
carries `types` → [v3/types/public.d.ts](types/public.d.ts), the shipped
self-contained declaration mirror of [v3/types/surface.ts](types/surface.ts)
(gated by `tsc -p v3/types/tsconfig.public.json`).

Decided at the flip: **no `data/v2-compat` runtime shim** — the fail-fast
errors + this guide carry porters; the `[value] =` error text points at
`data/v2` instead.

---

## Appendix A — error-message index

Every distinctive string v3 throws at a v2 idiom, verbatim, → where to look.

| error contains | section |
|---|---|
| `bare assignment (.X =) is not the write surface` | [§2](#2-the-write-surface) |
| `delete is not the write surface` | [§2](#2-the-write-surface) |
| `[value] whole-view assignment is a v2 idiom` | [§2](#2-the-write-surface) |
| `whole-source update — write [value] semantics not yet supported` | [§2](#2-the-write-surface) |
| `this view is a derived projection — write through its source` | [§2](#2-the-write-surface) |
| `connect(fn) is not a valid sink` | [§2](#2-the-write-surface) |
| `connect() on child paths not yet supported` | [§2](#2-the-write-surface) |
| `remove() detaches a row — nested field removal not yet supported` | [§2](#2-the-write-surface) |
| `insert() applies to a source root` / `patch() applies to a source root` / `ingest() applies to a source root` | [§2](#2-the-write-surface), [§5.5](#55-the-seam-new-capability-brief) |
| `on a child path would operate on the OWNING view — chain operators off the view itself` | [§3.7](#37-child-handles-are-path-addresses--no-chaining-off-children) |
| `reserved name X has no implementation yet` | [§3.12](#312-gone-in-v3-no-counterpart-at-the-flip) |
| `scalar views have no children` | [§3.5](#35-aggregates-and-the-empty-set) |
| `reduce(): init must be a plain value or a thunk, not a reactive node` | [§3.9](#39-reduce) |
| `filter() takes a predicate fn` / `map() takes a fn (row, key) => value` | [§3.1](#31-filter--predicate-only) — a v2 `filter('key', v)` / `filter({k: v})` / reactive-value form (all throw at construction now) |
| `za(5) without a column is gone` / `takes a column name or comparator, got` | [§3.4](#34-ordered-views-az--za--top--limit) — a v2 numeric `za(n)`/`az(n)`; use `top(n)`/`limit(n)` |
| `between() bounds must be plain numbers` / `between() bounds must be numbers, got` | [§3.2](#32-between--reactive-bounds-are-a-single-tuple-ref) — v2's two-handle `[$(lo), $(hi)]` tuple; drive both ends from ONE bounds child |
| `patch() takes [key, row] TUPLE pairs` | [§2](#2-the-write-surface) — v2 flat pairs; the pre-scan throws BEFORE any write commits |
| `$(handle) would copy through the live proxy` | [§2](#2-the-write-surface) — v2 `$(view)` linking; use `mirror()` or fork with `$(structuredClone(handle[value]))` |
| `intersect() operands must be views` (also `union()`/`except()`) | [§3.8](#38-set-algebra-intersect--union--except-take-view-operands) — a v2 object-map operand (or any non-view); validates BEFORE attach, runtime unharmed |
| `N effect(s) failed during commit` | [§3.10](#310-to--tap--keys--values--distinct) — a `tap` fn threw during the commit's effect phase (state still settled) |
| `data/render: expected a view — a DataNode or a $ handle` | [§4.1](#41-children-exactly-four-kinds) — junk where a view belongs; `text()`/`list()` child position throws this, a `bind()`/prop position throws the `text() expects…` message below |
| `mirror() applies to a view, not a child path` / `mirror.set() expects a collection view` / `mirror.set() would create a cyclic view` | [§5.1](#51-mirror--the-re-pointable-slot) |
| `data/render: unsupported child` | [§4.1](#41-children-exactly-four-kinds) — a function child (often a v2 `[vp, fn]`) |
| `<For> requires each={view}` / `expects a COLLECTION view` / `takes exactly ONE child` | [§4.1](#41-children-exactly-four-kinds) |
| `text() over a raw collection node` / `text() expects a scalar view or a $ handle` | [§4.4](#44-props-literal-attributes--live-form-props) |
| `reactive arg (node #N) belongs to a different runtime` | [§5.6](#56-one-runtime) |

And the silent (no-error) traps to grep for proactively:
`className:` / object `style:` in plain-JS JSX ([§4.4](#44-props-literal-attributes--live-form-props));
`await handle` (yields the handle, [§1](#1-the-mental-model-delta));
row-op-over-array `[value]` shape (keyed object, [§1](#1-the-mental-model-delta)).
(This list used to be three times as long — the fail-fast pass closed the
rest: flat `patch`, `$(someProxy)`, two-handle `between`, and numeric
`za`/`az` now throw at the call site with the migration-hinted messages
above; reactive `max`/`min` columns work ([§3.5](#35-aggregates-and-the-empty-set));
JSX `key` props are stripped ([§4.1](#41-children-exactly-four-kinds)).)

## Appendix B — worked references (the example pairs)

| app | v2 | v3 | what the diff teaches |
|---|---|---|---|
| todo | [examples/todo](../examples/todo/) | [examples/todo-v3](../examples/todo-v3/main.js) | builder DSL, mirror-routed filters, live `checked` props, handlers-read-through-source |
| chat (JSX) | [examples/chat](../examples/chat/) | [examples/chat-v3](../examples/chat-v3/index.tsx) | classic JSX, mirror + az/length chained once, transient search filter + dispose, nested path writes, one-commit blast, plain rows (guards deleted) |
| crossfilter | [examples/crossfilter](../examples/crossfilter/) | [examples/crossfilter-v3](../examples/crossfilter-v3/main.js) | reactive `between` bounds source, leave-one-out view-operand intersects, bounded `za` replacing `za(∞)`, array-born minted keys |
| kanban | [examples/kanban](../examples/kanban/) | [examples/kanban-v3](../examples/kanban-v3/main.js) | per-column filter→mirror→az built once, `batch()` drag-drop, 3-arg incremental reduce, no data-id read-back, sum-empty-set `|| 0` guards deleted |
| pivot | [examples/pivot](../examples/pivot/) | [examples/pivot-v3](../examples/pivot-v3/main.js) | per-cell filters replacing nested-group chaining, dispose-at-scale on config churn, dedup-vs-dispose rule |
| library | [examples/library](../examples/library/) | [examples/library-v3](../examples/library-v3/main.js) | set-algebra composition over mirror slots, reactive window size deleting `repage()`, transient unions + dispose |
| swarm | [examples/swarm](../examples/swarm/) | [examples/swarm-v3](../examples/swarm-v3/main.js) | one `patch(pairs)` commit per frame through a full analytics deck, predicate filters, view-operand intersect with reactive `between` bounds + `raf()` writers, `some()` over `length(fn)` buckets |
