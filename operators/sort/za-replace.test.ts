import { spec } from '../../tests/spec.ts'
import { deepStrictEqual as same } from 'node:assert/strict'
import { $, value } from '../../full.ts'

// Regression for whole-row replacement on $({}) source feeding za with a
// limit. The existing 'in-window rank change emits BMV1' test only
// covers nested-key mutation (data[1].date = 99) which keeps the row
// object identity stable — the moved object happens to read the new
// value because it's the same reference, mutated in place. Whole-row
// replacement (data[1] = {date: 99}) creates a NEW object reference
// and the BMV1 path leaves the old reference at the new position.
spec({ op:'sort', guarantee:'Order', trigger:'overwrite', shape:'object', via:['BMV1','BU1'], chain:'za-window', asserts:'whole-row replacement inside window, new value sits at new rank' }, () => {
  const data: any = $({})
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

// With a tap operator subscribed (or any pass-through Operator
// downstream), in-window rotations used to double-splice the
// materialised view: the source operator (za) spliced its view.value
// in Operator.BMV1, then dispatched view.BMV1 to the tap, whose
// BMV1 → super.BMV1 spliced THE SAME ARRAY again (tap.view.value
// shares the reference via Operator.XU0). The shared-ref guard in
// Operator.BR1A/BI0A/BMV1 gates the splice on `view.value !== p.value`
// so pass-through operators don't re-mutate the shared array.
spec({ op:'sort', guarantee:'Propagation', trigger:'overwrite', shape:'object', via:'BMV1', chain:'za-window→tap', asserts:'in-window rotation with tap downstream, observed view stays consistent' }, () => {
  const data: any = $({})
  for (const s of ['A', 'B', 'C', 'D', 'E']) data[s] = { pctChg: 'ABCDE'.indexOf(s) + 1 }
  const top = data.za('pctChg', 5)
  let observed = null
  const sink = top.tap(() => { observed = top[value] })
  same(top[value], [{ pctChg: 5 }, { pctChg: 4 }, { pctChg: 3 }, { pctChg: 2 }, { pctChg: 1 }])

  // A jumps from rank 4 to rank 0.
  data['A'] = { pctChg: 6 }
  same(top[value], [{ pctChg: 6 }, { pctChg: 5 }, { pctChg: 4 }, { pctChg: 3 }, { pctChg: 2 }])
  same(observed, top[value])
  void sink
})

// Larger universe with limit < universe size. The previous (smaller)
// test happened to have n >= universe so every BU1 stayed in-window
// (the BU1+BMV1 branch). With 8 entries and n=3 we exercise out-to-in,
// in-to-out, and out-to-out transitions too. Replays a many-symbol
// streaming workload where every assignment is a whole-row replacement.
spec({ op:'sort', guarantee:'Order', trigger:'overwrite', shape:'object', via:['BU1','BR1A','BI0A'], chain:'za-window', asserts:'whole-row replacement crossing window boundary, view stays sorted with no dupes' }, () => {
  const data: any = $({})
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
