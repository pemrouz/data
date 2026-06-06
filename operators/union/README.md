# union

Outputs every row present in the source OR in any additional source view — set union by row key. When the same key appears in more than one source, the value is taken from the **first** source (in argument order) that contains it.

## Signatures

```ts
proxy.union(...sources: ViewProxy[])   // UnionValue — rows present in ANY of [proxy, ...sources]
```

Dispatch lives in [../../register.ts:99](../../register.ts#L99) (the side-effect registration `index.ts` imports).

## Examples

```js
const a = $({ 1: 'a', 2: 'b' })
const b = $({ 2: 'b', 3: 'c' })

a.union(b)                              // { 1: 'a', 2: 'b', 3: 'c' }
```

### Value comes from the first source containing the row

```js
const a = $({ 1: 'a1', 2: 'a2' })
const b = $({ 2: 'b2', 3: 'b3' })

a.union(b)                              // { 1: 'a1', 2: 'a2', 3: 'b3' }  — key 2 takes a's value
```

### Reactive

```js
const a = $({ 1: 'x' })
const b = $({ 1: 'y' })
const res = a.union(b)                  // { 1: 'x' }   — a wins

delete a[1]                             // { 1: 'y' }   — a gone, value flips to b's
delete b[1]                             // {}           — last source loses it, row leaves

b[3] = 'c'                              // insert in any source enters the output
```

## Behavior

- **Bitmask membership.** Each source gets a bit; a row is in the output when its bitmask is **nonzero** (`bits !== 0`) — the OR-counterpart to `intersect` (`bits === all`) and `except`, sharing the same machinery. ~30 sources before the integer bitmask runs out of room.
- **Incremental.** `XU0`/`XR0` (whole-source replace/remove) plus the branch verbs `BU1`/`BI0`/`BR1` are implemented, so inserts/updates/removes in any source update the output O(1) per delta rather than rebuilding (which would be O(rows × sources)). On a `BR1`, clearing a bit either drops the row (bits hit zero → `BR1` out) or, if another source still has it, **re-picks** its value from the first remaining source and emits a `BU1` if that value changed. On a `BI0`, the first appearance in any source is a `BI0` out; a later appearance in a higher-priority source re-picks and emits a `BU1`.
- **Reactive sources.** All sources are tracked reactively (each is `connect`ed at construction). There are no reactive scalar args to capture — `union` only takes other views.
- **No dedup.** `union` does **not** implement `matches()`; each `proxy.union(...)` call constructs a fresh derived view. (Contrast the aggregates / `distinct` / `reduce` / `between` / `intersect`, which dedup and return a cached view for equivalent args.)
- **Sparse-undefined slots.** Like `between`/`intersect`/`except`, `union` builds its output by writing into a sparse array/object and leaving excluded rows as **explicit `undefined`** (not `delete`'d) on the array path. A `for (i in arr)` walk treats those as enumerable, so a `render(rows, (n, r) => …)` row template binds a node per excluded slot and resolves e.g. `r.col.to(fmt)` to `fmt(undefined)` ("NaN"). When binding a union view to a row template directly, **densify first** (`vp.to(arr => arr.filter(r => r !== undefined))`, the `dense()` helper in `assets/demos.js`) or write the bindings defensively. Object-keyed sources (`$({})`) sidestep this — they use stable keys and `delete`.
- **Array-source chaining caveat.** Chaining a row op (`filter`/`map`) or an `iter()`-based op (a second `union`, `group`, `distinct`, `sort`) *after* a union over an **array** source is a known limitation: the union marks excluded slots as positional holes, but downstream ops model array removes as splice-shifts, so ghost rows or accessor-on-hole throws can result. Key the source by id with `$({})` (every shipped example does) or densify between stages.
