// @ts-nocheck
import { deepStrictEqual as same } from 'node:assert'
import { test } from 'node:test'
import { $, value } from '../../core.ts'
import { sort, limit } from './index.ts'

const max = (a, b) => a > b ? a : b
$.random = o => 1 + Object.keys(o).map(Number).sort().reduce(max, -1)

test('sort (za) - insert/update/remove', () => {
  const data = $({
    10: { fooo: 1, date: 1 }, 40: { fooo: 4, date: 4 },
    30: { fooo: 3, date: 3 }, 20: { fooo: 2, date: 2 },
    50: { fooo: 5, date: 5 },
  })
  const res = sort(data, 'date', 3)
  const changes1 = res.connect([])
  const changes2 = res[0].connect([])
  const changes3 = res[1].connect([])
  const changes4 = res[2].connect([])
  const changes5 = res[3].connect([])
  same(res[value], [
    { fooo: 5, date: 5 }, { fooo: 4, date: 4 }, { fooo: 3, date: 3 },
  ])

  data.insert({ fooo: 0, date: 0 })
  same(res[value], [{ fooo: 5, date: 5 }, { fooo: 4, date: 4 }, { fooo: 3, date: 3 }])

  data.insert({ fooo: [], date: 6 })
  same(res[value], [{ fooo: [], date: 6 }, { fooo: 5, date: 5 }, { fooo: 4, date: 4 }])

  data[52].fooo.insert(1)
  same(res[value], [{ fooo: [1], date: 6 }, { fooo: 5, date: 5 }, { fooo: 4, date: 4 }])

  data[value] = {
    10: { fooo: 1, date: 1 }, 40: { fooo: 4, date: 4 },
    30: { fooo: 3, date: 3 }, 20: { fooo: 2, date: 2 }, 50: { fooo: 5, date: 5 },
  }
  same(res[value], [{ fooo: 5, date: 5 }, { fooo: 4, date: 4 }, { fooo: 3, date: 3 }])

  data[40].fooo = 40
  same(res[value], [{ fooo: 5, date: 5 }, { fooo: 40, date: 4 }, { fooo: 3, date: 3 }])

  data[10].fooo = 10
  same(res[value], [{ fooo: 5, date: 5 }, { fooo: 40, date: 4 }, { fooo: 3, date: 3 }])

  data[10].date = 10
  same(res[value], [{ fooo: 10, date: 10 }, { fooo: 5, date: 5 }, { fooo: 40, date: 4 }])

  data[10].date = 4
  same(res[value], [{ fooo: 5, date: 5 }, { fooo: 40, date: 4 }, { fooo: 10, date: 4 }])

  data[40].date = 0
  same(res[value], [{ fooo: 5, date: 5 }, { fooo: 10, date: 4 }, { fooo: 3, date: 3 }])

  data[value] = {
    10: { fooo: 1, date: 1 }, 40: { fooo: 4, date: 4 },
    30: { fooo: 3, date: 3 }, 20: { fooo: 2, date: 2 }, 50: { fooo: 5, date: 5 },
  }
  same(res[value], [{ fooo: 5, date: 5 }, { fooo: 4, date: 4 }, { fooo: 3, date: 3 }])

  delete data[50].fooo
  same(res[value], [{ date: 5 }, { fooo: 4, date: 4 }, { fooo: 3, date: 3 }])

  delete data[10].fooo
  same(res[value], [{ date: 5 }, { fooo: 4, date: 4 }, { fooo: 3, date: 3 }])

  delete data[20]
  same(res[value], [{ date: 5 }, { fooo: 4, date: 4 }, { fooo: 3, date: 3 }])

  delete data[40]
  same(res[value], [{ date: 5 }, { fooo: 3, date: 3 }, { date: 1 }])

  delete data[value]
  same(res[value], [])
})

// Regression: when the new value moves a *middle* row up, BU1 used to read
// `col(p.value[name])` while `name` was still at its old slot in `sorted`,
// feeding the bisect a non-monotonic array. The descending-bisect's
// `col(sorted[mid]) < v_new` test returned false at name's slot (equal, not
// less), so the search jumped right and never re-discovered the higher rank.
// Result: the row stayed at its old position with the new value, instead of
// being lifted to the front. The pre-existing "row 1 jumps to first" test
// missed this because '1' was already at the end of `sorted`, so the bisect
// happened to converge correctly even on the broken array.
test('sort (za) - middle row promoted to top (bisect on stale slot)', () => {
  const data = $({
    A: { vol: 900 }, B: { vol: 850 }, C: { vol: 800 },
    D: { vol: 750 }, E: { vol: 700 },
  })
  const top3 = sort(data, 'vol', 3)
  same(top3[value], [{ vol: 900 }, { vol: 850 }, { vol: 800 }])
  data.C.vol = 950
  same(top3[value], [{ vol: 950 }, { vol: 900 }, { vol: 850 }])
})

// Regression: out-of-window value updates with no rank change still emitted
// `super.BU1([oidx, value])` where oidx >= n, growing view.value past `n`
// (the materialized window). Found via stress test where a churning ticker
// pushed the top-50 view to 60+ entries after a few thousand updates.
test('sort (za) - out-of-window updates do not grow the window', () => {
  const data = $({
    A: { vol: 900 }, B: { vol: 850 }, C: { vol: 800 },
    D: { vol: 750 }, E: { vol: 700 }, F: { vol: 650 },
    G: { vol: 600 }, H: { vol: 550 },
  })
  const top3 = sort(data, 'vol', 3)
  same(top3[value].length, 3)
  data.E.vol = 695  // E was rank 4 (out), still rank 4
  data.F.vol = 645  // F was rank 5, still rank 5
  data.G.vol = 595  // ditto
  same(top3[value].length, 3)
})

// In-window rank rotation should be emitted as a single 'move' event rather
// than per-position 'update' events. Sinks that care about identity (DOMSink
// uses insertBefore on the same element) preserve it; sinks without BMV1
// fall back to a BU1 batch over the affected range automatically.
test('sort (za) - in-window rank change emits BMV1', () => {
  const data = $({
    1: { date: 1 },
    2: { date: 2 },
    3: { date: 3 },
    4: { date: 4 },
  })
  const res = sort(data, 'date', 4)
  const changes = res.connect([])
  changes.length = 0  // discard the initial XU0
  // row 1 (currently last in the desc-sorted window) jumps to first
  data[1].date = 99
  same(res[value], [
    { date: 99 }, { date: 4 }, { date: 3 }, { date: 2 },
  ])
  // expect a single 'move' event; the U2 for the changed value is also
  // emitted (the column update path that pre-dates the rank change).
  const moves = changes.filter(c => c.type === 'move')
  same(moves.length, 1)
  same(moves[0], { type: 'move', from: 3, to: 0 })
})
