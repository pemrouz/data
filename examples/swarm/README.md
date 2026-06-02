# swarm — a live agent-simulation control room

A SIRS epidemic over thousands of moving agents runs at 60fps in plain JS, with
a **fully incremental analytics deck** riding alongside — SIR counts, a region
infection leaderboard, an energy histogram, headline tiles, an outbreak alarm,
and a brushable cohort. Every panel is maintained by `data`, so the deck's cost
is proportional to the **events that fired this frame** (state flips + cell
crossings — a few hundred), not to the population. Drag a box on the cloud to
brush a region and watch the cohort churn as the wavefront sweeps through it.

Run it: `npm run serve`, then open `http://localhost:3000/examples/swarm/`.
Append `?n=24000` to push the population and watch the budget.

## The two-tier discipline

The example is built on the same plain-JS-owns-the-hot-loop / `data`-owns-the-
analytics split as the datagrid and metrics shapes:

- **Plain JS owns the O(N) core** ([sim.js](sim.js)): Float32Array position
  integration, a spatial-hash transmission pass, SIRS state logic, and the
  canvas point-cloud paint. `data` deliberately never touches it. The
  integrator is also the one place that knows an agent *crossed* a boundary, so
  it discretises position into integer `gx`/`gy` cell columns and energy into a
  band — the reactive layer brushes those, never the raw floats.
- **`data` owns the analytics** ([main.js](main.js)). The bridge is the dirty
  list: `step()` records only the agents that flipped, crossed a cell, or
  crossed an energy band, and the frame loop drains them into the proxy as **one
  batched `patch`** — the operators see a single `BU1` carrying every changed
  row, so the per-frame cost is one dispatch per sink, not one per agent.

| Panel | View | Incremental because |
|---|---|---|
| SIR counts | `pop.length(a => a.state)` | one bucket pair moves per flip (`length(fn)` rebuckets on the `BU1`) |
| Region leaderboard | `pop.filter('state','I').length(a => a.gy*GRID+a.gx)` | `filter` (RowOperator) turns a flip into a membership delta; `length(fn)` moves one bucket |
| Energy histogram | `pop.length(a => band(a.energy))` | one bucket per band crossing |
| Outbreak alarm | `regionInf.some(c => c.value >= OUTBREAK)` | boolean aggregate, true-count tracked |
| Headline tiles | `pop.avg('energy')`, the SIR counts | `avg` is O(1) per delta |
| Brushed cohort | `pop.intersect({ gx: pop.between('gx', sel.gx), gy: pop.between('gy', sel.gy) })` → `.length()` / `.avg('energy')` / `.limit(120)` | `between.BU2` re-checks membership the instant an agent crosses the box edge — the cohort updates even with a stationary brush; the table is `render()`-bound for surgical per-row updates |

## Why incrementality is load-bearing here

The natural shape in a vdom/selector stack is "new frame → new snapshot →
re-derive every selector → diff the DOM," which re-folds the whole population
every frame. Here a flip moves one `length` bucket, nudges one `avg`, flips one
`intersect` bit, and rewrites one `textContent`. Work tracks the events, so a
live deck and a churning sim share one frame budget — the thing a vdom stack
can't do at this scale.

The remaining ceiling is the demo's own canvas paint, not `data`: with the
batched `patch` the reactive cascade is a few milliseconds even as N climbs, so
pushing past the default is a rendering problem (WebGL instancing), not a
reactivity one.

## Two operators this example exercised / surfaced

- **`length(fn)` rebuckets on in-place field mutations.** The SIR/energy
  histograms sit *directly* on a source whose rows mutate in place (a flip is
  `pop[id].state = …`, a `BU2`). `length(fn)` now moves the bucket on a `BU2`,
  not just on insert/remove — without it the counts froze at their
  construction-time seed.
- **`patch` batches writes.** `pop.patch([id, row, …])` applies many row updates
  as a single cascade, collapsing the per-row dispatch fan-out to one walk per
  sink — the right tool for a high-throughput producer (a sim, a market feed).

## Deferred

Births/deaths (BI0/BR1 churn of the population) are left out: the array-insert
path in `between` is O(N) per insert, so a fixed population keeps every operator
on its O(1) field-mutation path. A production version would split the physics to
a worker and the point cloud to WebGL to scale the *render* past the deck.
