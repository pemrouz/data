import { test } from 'node:test'
import { deepStrictEqual as same } from 'node:assert/strict'
import { $, value } from '../../full.ts'

// Regression for whole-row replacement on $({}) source feeding za with a
// limit. The existing 'in-window rank change emits BMV1' test only
// covers nested-key mutation (data[1].date = 99) which keeps the row
// object identity stable — the moved object happens to read the new
// value because it's the same reference, mutated in place. Whole-row
// replacement (data[1] = {date: 99}) creates a NEW object reference
// and the BMV1 path leaves the old reference at the new position.
test('sort (za) - whole-row replacement inside window updates value at new rank', () => {
  const data = $({})
  data['A'] = { pctChg: 1.0 }
  data['B'] = { pctChg: 2.0 }
  data['C'] = { pctChg: 3.0 }
  const top = data.za('pctChg', 5)
  same(top[value], [{ pctChg: 3.0 }, { pctChg: 2.0 }, { pctChg: 1.0 }])

  // Whole-row replacement of A pushing it to rank 0.
  data['A'] = { pctChg: 4.0 }
  same(top[value], [{ pctChg: 4.0 }, { pctChg: 3.0 }, { pctChg: 2.0 }])

  data['B'] = { pctChg: 5.0 }
  same(top[value], [{ pctChg: 5.0 }, { pctChg: 4.0 }, { pctChg: 3.0 }])
})

// Larger universe with limit < universe size. The previous (smaller)
// test happened to have n >= universe so every BU1 stayed in-window
// (the BU1+BMV1 branch). With 8 entries and n=3 we exercise out-to-in,
// in-to-out, and out-to-out transitions too. Replays a many-symbol
// streaming workload where every assignment is a whole-row replacement.
test('sort (za) - whole-row replacement crossing window boundary stays sorted', () => {
  const data = $({})
  const symbols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
  for (const s of symbols) data[s] = { pctChg: 0 }
  const top = data.za('pctChg', 3)
  // All zeros — order is whatever the initial Object.keys hands us.
  same(top[value].length, 3)

  // Bump each symbol once. After eight whole-row writes the view's first
  // three entries must be the three highest values, and there must be
  // no duplicates by reference.
  data['A'] = { pctChg: 1 }
  data['B'] = { pctChg: 5 }
  data['C'] = { pctChg: 2 }
  data['D'] = { pctChg: 9 }   // crosses into top-3
  data['E'] = { pctChg: 3 }
  data['F'] = { pctChg: 7 }   // crosses into top-3, evicting one
  data['G'] = { pctChg: 4 }
  data['H'] = { pctChg: 6 }   // crosses into top-3

  same(top[value], [{ pctChg: 9 }, { pctChg: 7 }, { pctChg: 6 }])

  // Now update the in-window leader to a smaller value, forcing it out.
  data['D'] = { pctChg: 0 }
  same(top[value], [{ pctChg: 7 }, { pctChg: 6 }, { pctChg: 5 }])

  // And an out-of-window symbol jumps to the top.
  data['A'] = { pctChg: 100 }
  same(top[value], [{ pctChg: 100 }, { pctChg: 7 }, { pctChg: 6 }])
})
