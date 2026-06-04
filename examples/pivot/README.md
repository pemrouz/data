# pivot

A live pivot table where **every cell is a standing reactive aggregate**.

```js
const sales = $({})                                   // keyed by sale id
const rows  = sales.group(d => d[rowField])           // one bucket per row value
// 1-D cell:
const cell  = rows[rowVal].sum(measure)
// 2-D cell:
const cell  = rows[rowVal].group(d => d[colField])[colVal].sum(measure)
```

## What it exercises

- **Nested `group` + per-bucket aggregates** — the 2-D matrix is `group`
  (rows) → `group` (columns) → `sum`/`avg`/`max`/`count` per cell, plus row
  totals (`measure(bucket)`), column totals (`measure(sales.group(colField)[cv])`)
  and a grand total (`measure(sales)`). All reconcile because they're all
  derivations of the same source.
- **`group`-rebuckets-on-`BU2`** — **shuffle regions** rewrites a sample of
  sales' `region` field *in place*. Each edit moves a sale from one row bucket
  to another; the row totals shift, the column totals (by category) and the
  grand total stay put (revenue is conserved). This is the fix this example
  surfaced — `group` over a mutating object source used to be inert to in-place
  edits.
- **Batched inserts via `patch`** — **+100 sales** and the **stream** toggle add
  rows through `sales.patch([...])`, so the whole grid sees one cascade per
  batch instead of one dispatch per sale.
- **Config-driven re-render, data-driven surgical update** — changing the
  row/column field or measure re-renders the grid structure; within a
  configuration, streaming or shuffling updates only the affected cells (no
  rebuild).

## Library bug it surfaced

`fix(group)` — `group`'s `BU2`/`BR2`/`BI2` were no-ops, so a `group(fn)` over a
source whose rows mutate in place was frozen: a non-key edit never reached
bucket aggregates, and a key edit never rebucketed the row. `GroupValue.BU2`
now rebuckets on a key change and forwards non-key edits into the bucket.

## Run

`npm run serve`, then open `http://localhost:3000/examples/pivot/`. Pick row /
column fields and a measure, press **+100 sales** or **stream** to add rows,
and **shuffle regions** to watch the row totals re-balance live.
