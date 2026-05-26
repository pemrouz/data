# AGENTS.md

Guidance for AI agents. Two audiences:

## 1. Contributing to this repo

The full, authoritative contributor guide is **[CLAUDE.md](CLAUDE.md)** — read it
before changing anything. It is vendor-neutral despite the name; everything in it
applies regardless of which agent/tool you are. Highlights:

- Source of truth is the `.ts` files; `*.js` is gitignored, build output goes to `dist/`.
- `npm test` (run via `node --experimental-strip-types`, no build needed) must stay green; add a regression test for any behaviour change.
- `npm run perf` must stay green; don't widen thresholds to pass — investigate regressions.
- Commit granularly with Conventional-Commits-ish messages, and **present each change for review before committing** (see the working-conventions section in CLAUDE.md).
- Adding an operator: follow the checklist in [operators/README.md](operators/README.md) top-to-bottom (register dispatch in [index.ts](index.ts)).

## 2. Using `data` as a dependency (generating code that imports it)

Import from **`data`** — the default entry registers every operator, so chaining
works immediately. (Use `data/full` only for JSX; `data/lean` only to tree-shake.)

```js
import { $, value, render, HTML } from 'data'

const rows = $([{ id: 1, done: false }, { id: 2, done: true }])
const open = rows.filter(d => !d.done).length()   // derived reactive view
rows[0].done = true                                // mutate by assignment; views update
console.log(open[value])                           // read raw value via the `value` symbol
```

Rules that catch generated code out:

- Read raw data with **`proxy[value]`** (the exported `value` symbol), never `proxy.value` (that makes a child view).
- **Mutate by assignment**, including nested: `proxy[0].x = 1`, `delete proxy[1]`, `proxy[value] = next`. No immutable spreads.
- Operators return new reactive views; they don't mutate in place. Chain them: `rows.filter(...).between(...).length()`.
- `gt`/`lt`/`gte`/`lte` take literal bounds; for a reactive threshold use `between` with reactive bounds.
- DOM: `render(el, HTML.div(...))`. JSX (`<div>...</div>`) needs the `data/full` entry and the shared `h` factory.

For the condensed machine-readable map see [llms.txt](llms.txt); for full prose see [README.md](README.md).
