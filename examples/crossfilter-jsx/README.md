# crossfilter (JSX)

The **JSX port of [../crossfilter](../crossfilter)** — same brushable coordinated
charts, same data flow, same brush logic, only the template is rewritten in JSX.
See [../crossfilter/README.md](../crossfilter/README.md) for the data model; this
note covers what the JSX layer adds and the devtools-over-JSX angle.

```jsx
// identical chain to the builder version — JSX changes the template, not the data
const flights = source.map(project).za('date', Infinity)
const dims    = { delay: flights.between('delay', filters.delay), /* … */ }
const active  = flights.intersect(dims)                    // AND the dimensions
const data    = flights.intersect(dims, 'time').length(byHour) // per-chart histogram
const byDate  = active.limit(80).group(formatDate)         // the data table
```

## What it exercises

- **JSX authoring of an SVG-heavy view** (`h` / `Fragment`) — every chart is an
  inline `<svg><g><clipPath><path>…` tree. `h()` dispatches the SVG namespace
  the same way `SVG.*` builders do, so `render` / `DOMSink` behave identically to
  the builder version — verified by the brush-parity spec.
- **Reactive attribute values** — the brush `<rect>`'s `x`, `width`, and the
  clip-rect `extent` are bound straight to `ViewProxy` filter-range derivations
  (`start`, `extent`, `filter.to(…)`); brushing mutates a `filters[name]` range
  and the attributes catch up with no manual invalidation.
- **Mid-tree function children** — the `<g className="brush">` carries a bare
  function child `{(n) => background(n, …)}` that compiles to a positional row
  generator (sets `node.fn`); `Node.generate` runs it on first render so
  `background` can attach `.on('pointerdown'|'pointermove'|'pointerup')` —
  identical to the builder's `g.brush(node => background(...))(rects…)` pattern.
- **The `[data, fn]` iteration shorthand for two shapes** — `{[charts, chart]}`
  iterates a *static* object (one row per chart), while
  `{[flightsByDate, (node, flights, day) => …]}` iterates a *ViewProxy* (group
  output), with a nested `{[flights, (node, flight) => …]}` inside. The row fns
  return a `Fragment` that `NodeProxy.apply` auto-spreads into positional args.
- **rAF-coalesced brush input** — pointer handlers write through `filter.raf()`
  and `.flush()` on pointerup, so a fast drag commits one cascade per frame (the
  documented `raf` built-in), same as the vanilla example.

## Devtools over JSX

The companion [../../tests/devtools-jsx.spec.ts](../../tests/devtools-jsx.spec.ts)
points `$.fromDOM` / `$.inspect` / `$.graph` / `$.highlight` and the overlay
panel at this JSX-built tree — proving the inspection helpers work uniformly
across authoring layers (a JSX-authored proxy is the same `ViewProxy` a builder
produces). Append `?devtools` to the URL to load `data/devtools` and auto-mount
the panel; it's off by default so this example mirrors the vanilla crossfilter's
byte-clean baseline ([index.html](index.html)).

## Build

[tsconfig.json](tsconfig.json) just `extends` the shared
[../../tsconfig.jsx.json](../../tsconfig.jsx.json) (`jsx: react`,
`jsxFactory: h`, `jsxFragmentFactory: Fragment`). `npm run serve` runs
`build:examples-jsx` after `tsup` to emit the sibling `.js` (gitignored). JSX
helpers come from a single `data/full` import — cross-bundle imports would break
`NodeProxy` `instanceof` checks (see [../../full.ts](../../full.ts)).

## Run

`npm run serve` (builds the JSX), then open
`http://localhost:3000/examples/crossfilter-jsx/`. Click and drag on any chart to
brush a range, drag the selection or its handles to move/resize it, **reset** to
clear; the counter and the other charts recompute live. Add `?devtools` to
inspect the reactive graph.
