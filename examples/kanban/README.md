# kanban

An issue tracker where the entire board is **one source** and every column,
counter and chart is a *derived reactive view* of it.

```js
const board = $({})                                  // keyed by card id
const column = s => board.filter('status', s).az('order')   // one per status
const count  = column(s).length()                    // incremental
const points = column(s).sum('points')               // incremental
```

## What it exercises

- **`filter` + `az` + aggregate composition** — each column is
  `board.filter('status', s).az('order')`, with `.length()` / `.sum('points')`
  chained on top. Moving a card between columns is a single in-place write
  (`card.status = …`): it leaves one filter and enters another, `az` re-sorts,
  and both columns' counts **and point totals** update surgically.
- **In-place edits through `filter → sort`** — double-click a title or click a
  pill (priority / points / assignee). Each is a `BU2` on one card that
  propagates through the column's `filter → sort` chain to re-render just that
  card and update the column total.
- **Re-pointable filter** — the assignee / search filter re-points each
  column's source via the `$(view)` swap (`colData[s][value] = base.filter(…)`);
  the `.length()` / `.sum()` views chained on the proxy follow the relink.
- **`length(fn)` + incremental `reduce`** — the assignee chips show cards-per-
  person (`board.length(a => a.assignee)`) and points-per-person (a 3-arg
  `board.reduce(add, remove, init)` bucketed sum), both rebucketing on
  insert / remove / move.
- **Array-shaped list rendering** — a column is an array-keyed `az` view, so
  cards render through the array path of the DOM sink with mid-list inserts.

## Library bugs it surfaced

Building this example surfaced three correctness bugs, all now fixed:

1. **`fix(aggregate)`** — `sum`/`avg`/`max`/`min` downstream of a `sort`/`limit`
   silently desynced (the column point totals never decremented).
2. **`fix(sort)`** — an in-place card edit (a same-reference whole-row `BU1`
   forwarded by `filter`) was dropped by `sort`, leaving aggregates and the
   rendered card stale.
3. **`fix(render)`** — a mid-list insert into an array column duplicated the
   inserted card and dropped the tail.

## Run

`npm run serve`, then open `http://localhost:3000/examples/kanban/`.
Drag cards between columns, double-click a title to rename, click a pill to
cycle priority/points/assignee, filter by person or search text.
