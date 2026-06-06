# flow — Write the view, flow the change

**A long-form interactive essay, not an app — the featured gallery piece.** It
argues one idea in eight sections: a table and its change-stream are two forms
of one thing (the table *accumulated*, the changes *differentiated*), so a
*view* is just a table derived from another, and each derivation casts a
**change-shadow** the runtime runs for you — you pay the cost of the *change*,
never the table. The whole page is driven by **one change-stream and one
playhead**.

```js
const display   = $({})                        // the source, keyed by id (an OBJECT, not array)
const active    = display.filter(o => o.active) // a view = a derived table
const perRegion = active.length(o => o.region)  // a derivation OF a derivation
const avg       = display.avg('value')          // a scalar fold
display.connect(anchor, c => log.push(c))       // capture the runtime's REAL records
```

## How it's built

The protagonist is [log.js](log.js)'s `createLog(seed)`: the `display` source
above plus its three derived views, and the **real** change records captured
off the source via the two-arg `display.connect(anchor, fn)` form (the anchor
pins the `WeakRef` sink). It exposes `append(mutate)` (apply one record at the
head, `O(Δ)`, then diff each view's output to learn the record's *selectivity*)
and `scrubTo(k)` (reconstruct an earlier state). It also connects to `active`
(`actAnchor`) and tags each source record with `actDeltas` — the change
`active` re-emitted — so section 05 reads it off the head record.

[main.js](main.js) renders every figure off those views and wires the chrome.
The architectural spine is **`syncHead()`** plus a `figureUpdaters` registry:
each figure registers an updater on mount, and `syncHead()` repaints the
records rail then calls every updater — so scrubbing the rail OR pressing any
figure's button (all of which append to the one stream) re-reads cost,
selectivity, the edge, and the DOM from the current head.

## What it exercises

- **`filter` / `length(fn)` / `avg` as derived tables** — `active`,
  `perRegion`, `avg` are one-line operator chains off `display`; the section-01
  table and every fold panel are ordinary `render()` sinks, so they update for
  free as the playhead moves.
- **The two-arg `connect(anchor, fn)`** — captures the runtime's path-addressed
  deltas `{ type, key, value, at? }` as the literal change history; the
  single-arg `connect(fn)` is unsupported (it throws on the first insert).
- **`render()` as the last derivation** — section 07's `#dom-list` is a SECOND
  `render()` sink on the SAME `model.display` source as the section-01 table, so
  one button updates both, and each record maps to one DOM op
  (insert→`appendChild`, update→one text write, remove→`node.remove()`).
- **Object-keyed source** — keying `display` by id (not an array) gives stable
  per-key removal, so the plain-JS `foldPlain` reconstruction stays in lockstep
  without array index-shifting.

## Constraints baked in (don't regress)

- **The runtime never re-folds a log from zero.** A consumer gets the current
  snapshot + deltas onward. So section 03's cost baseline is naive *recompute*
  `O(N)` vs `O(Δ)` — NOT "re-fold `O(L²)`" — and `scrubTo`/`foldPlain` is a
  **viewing aid only**; the prose must stay explicit that the library only ever
  moves forward.
- **Single entry only.** Everything imports from `data/full` — each dist entry
  bundles its own `$`/`value` symbol, so mixing proxies across entries breaks.
- The eight sections: 01 duality, 02 a view is a derived table, 03 flow-the-
  change cost (the row-tick sweep), 04 selectivity matrix, 05 derivations
  compose / the edge, 06 you-never-touch-a-delta (RxJS contrast), 07 the DOM is
  the last derivation, 08 best-of-both + the free change-stream dividend.

## Run

`npm run serve`, then open `http://localhost:3000/examples/flow/`. Scrub the
records rail (or the pinned left-margin rail ≥1180px) to *apply* changes to the
table; press any figure's button to *edit* the table and watch a new change
appear. Section 03 scales N with the `#cost-n` selector. Smoke test:
[tests/flow.spec.ts](../../tests/flow.spec.ts) (9 cases).
