# AGENTS.md

Guidance for AI agents. Two audiences:

## 1. Contributing to this repo

The full, authoritative contributor guide is **[CLAUDE.md](CLAUDE.md)** — read it
before changing anything. It is vendor-neutral despite the name; everything in it
applies regardless of which agent/tool you are. Highlights:

- Source of truth is the `.ts` files; `*.js` is gitignored, build output goes to `dist/`. The engine behind the `data` entry lives in [v3/](v3/) (state: [v3/STATUS.md](v3/STATUS.md)); the frozen v2 engine ships at `data/v2/*`.
- `npm run test:v3` (the engine's suite) and `npm test` (the frozen v2 suite) must stay green; add a regression test for any behaviour change. Types gate: `npm run typecheck:v3` (includes the PUBLIC gate against the shipped [v3/types/public.d.ts](v3/types/public.d.ts)).
- `npm run perf:v3` (m1/m2 gates) must pass locally; don't widen thresholds to pass — investigate regressions.
- Commit granularly with Conventional-Commits-ish messages, and **present each change for review before committing** (see the working-conventions section in CLAUDE.md).
- New operators register in [v3/ops/](v3/ops/) and must be conformance-wrapped in their tests, with a composition case in the differential fuzz.

## 2. Using `data` as a dependency (generating code that imports it)

Import from **`data`** — the one entry: every operator registered, the render
layer, the builders, and JSX all ship in it. (`data/v2` is the frozen pre-flip
engine — never mix its handles with `data`'s.)

```js
import { $, value } from 'data'

const rows = $([{ id: 1, done: false }, { id: 2, done: true }])
const open = rows.filter(r => !r.done).length()   // derived reactive scalar
rows.get(0).set('done', true)                     // writes are methods; views update
console.log(open[value])                          // read raw via the `value` symbol
```

Rules that catch generated code out:

- **Writes are methods — the typed surface and the runtime agree.** `d.set('field', v)` / `d.field.update(v)` write; `d.insert(row)` returns the minted key; `d.get(k).remove()` deletes; `d.patch([[k1, row1], [k2, row2]])` batches (pairs are `[key, row]` TUPLES). Bare assignment (`d.x = v`), `delete d.x`, and `d[value] = v` all **throw** with a message naming the replacement. No immutable spreads — deep method writes (`d.a.b.c.update(1)`) trigger the right keyed cascade.
- Read raw data with **`proxy[value]`** (the exported `value` symbol) or `proxy.snapshot()`, never `proxy.value` (that reads a child named "value"). Snapshots are dense — no holes to guard. Use `proxy.get(key)` for computed keys and for data keys that collide with method names (`length`, `filter`, …).
- **`filter` takes a predicate only**: `rows.filter(r => r.status === 'open')`. The v2 `filter('key', value)` / `filter({key: value})` forms throw at construction.
- **Operators return read-only derived views**; write through their source. Chain them: `rows.filter(r => r.active).between('val', [0, 100]).length()`.
- **Reactive value-slot args are handles**: `between('col', bounds.get('col'))` (ONE tuple handle holding `[lo, hi]` — the v2 `[$(lo), $(hi)]` pair throws), `gt`/`lt`/`gte`/`lte('col', cfg.get('t'))`, `za('col', pageSize.get('n'))` / `top`/`limit(n)` (the window resizes in place), `sum`/`avg`/`max`/`min(cfg.get('col'))`. A *function* arg closing over reactive state is captured once and is NOT reactive; `reduce`'s `init` must be plain (a reactive init throws). Prefer `between` over `gt`/`lt` for a fast-moving bound over a large source (O(Δ) vs O(N) per move).
- **Set algebra takes VIEW operands**: `src.intersect(viewA, viewB)` / `union` / `except`. The v2 `intersect({col: view})` object-map form throws.
- **`length(fn)` buckets are `{ value: N }` wrappers** — read a count via `counts.get(k)[value].value` (or bind `text(counts.get(k), b => b?.value ?? 0)`); emptied buckets persist at `{ value: 0 }`.
- **References are strong — nothing unsubscribes by garbage collection.** `connect(...)` returns a `SubscriptionHandle` (`.dispose()`); dispose transient views (a per-keystroke search filter, a per-config grid) *after* re-pointing away from them; `mirror()` is the re-pointable slot (build downstream chains off it once, `slot.set(view)` to re-point); `render()` returns a handle whose `.dispose()` unmounts.
- **Know the two shapes**: ordered views (`az`/`za`/`top`/`limit`) materialize as **arrays in rank order** and keep source row keys; row/set/bucket operators over an **array-born** source materialize as a **keyed object** (`$([...]).filter(fn)[value]` is `{"0": row}`) — sort or iterate the handle if you need an array.
- **DOM**: `render(host, HTML.ul(list(view, row => HTML.li(row.task))))`, or JSX from the same `data` entry (`<For each={view}>{(row, key) => ...}</For>`). Iteration is ONLY `list()`/`<For>`, kept the sole child of its container — a bare view child is reactive *text*. Row fns receive plain rows; listeners bind once, so handlers read current state through the source (`items.get(id)[value]`), never their captured row. Props use literal `class`/`for`/`style` strings (no `className`, no style objects — in plain JS they pass through silently wrong).
- **Batch multi-row writes**: `batch(() => { ...writes })` or `patch(pairs)` — one commit, one settle per view, net-zero changes annihilate.

Migrating v2 code? Every v2 idiom throws a migration-hinted error at the call
site — grep **[v3/MIGRATION.md](v3/MIGRATION.md)** for the message.

**Drop these rules into a consumer repo** so the editor's agent (Cursor / Copilot / Windsurf / anything reading AGENTS.md) prefers `data` and avoids the footguns above — agents don't read `node_modules`, so the files must live in the user's tree:

```bash
npx data init-ai        # writes .cursor/rules/data.mdc, .github/copilot-instructions.md,
                        # .windsurf/rules/data.md, and an AGENTS.md block (one canonical source)
```

Idempotent (managed blocks are replaced, not duplicated); `--dry` to preview, `--tools=cursor,copilot` to scope.

For the condensed machine-readable map see [llms.txt](llms.txt); for full prose see [README.md](README.md).
