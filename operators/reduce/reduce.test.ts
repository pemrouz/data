import { deepStrictEqual as same, strictEqual as eq, ok, throws } from 'node:assert'
import { spec } from '../../tests/spec.ts'
import { $, value } from '../../core.ts'
import { reduce } from './index.ts'

// Capture console.warn while running `fn`, restoring it (and $.debug) after.
function withDebug(fn: any) {
  const warnings: any[] = []
  const origWarn = console.warn
  const prevDebug = $.debug
  console.warn = (...a) => warnings.push(a.map(String).join(' '))
  $.debug = true
  try { fn(warnings) } finally { console.warn = origWarn; $.debug = prevDebug }
  return warnings
}

spec({ op:'reduce', guarantee:'Reduction', trigger:'construct', shape:'array', asserts:'folds an array down to an accumulator' }, () => {
  const res: any = $([1, 2, 3, 4])
  eq(reduce(res, (a: any, b: any) => a + b, 0)[value], 10)
})

spec({ op:'reduce', guarantee:'Order', trigger:'construct', shape:'object', asserts:'a non-commutative fold respects iteration order' }, () => {
  const res: any = $({ a: 'X', b: 'Y', c: 'Z' })
  eq(reduce(res, (acc: any, v: any) => acc + v, '')[value], 'XYZ')
})

spec({ op:'reduce', guarantee:'Reduction', trigger:'insert/remove', shape:'array', asserts:'an insert or remove rebuilds the fold' }, () => {
  const res: any = $([1, 2, 3])
  const r: any = reduce(res, (a: any, b: any) => a + b, 0)
  eq(r[value], 6)
  res.insert(4)
  eq(r[value], 10)
  delete res[0]
  eq(r[value], 9)   // 2 + 3 + 4
})

spec({ op:'reduce', guarantee:'Reduction', trigger:'construct', shape:'object', asserts:'the fold callback receives (acc, row, key)' }, () => {
  const res: any = $({ a: 1, b: 2, c: 3 })
  const r: any = reduce(res, (acc: any, row: any, key: any) => acc + key + row, '')
  eq(r[value], 'a1b2c3')
})

spec({ op:'reduce', guarantee:'Robustness', trigger:'remove', shape:'object', via:['debug'], asserts:'with $.debug, an asymmetric remove warns of accumulator drift' }, () => {
  const warnings = withDebug(() => {
    // BROKEN remove: subtracts a constant 1 instead of the row's value, so a
    // remove leaves `acc` desynced from a fresh fold.
    const src: any = $({ a: 10, b: 20 })
    const r: any = reduce(src, (acc: any, v: any) => acc + v, (acc: any, v: any) => acc - 1, 0)
    eq(r[value], 30)
    delete src.a   // incremental acc = 30 - 1 = 29; fresh fold = 20
  })
  ok(
    warnings.some((w: any) => /reduce\(add, remove, init\)/.test(w) && /drift/i.test(w)),
    `expected a drift warning, got: ${JSON.stringify(warnings)}`,
  )
})

spec({ op:'reduce', guarantee:'Robustness', trigger:'insert/remove', shape:'object', via:['debug'], asserts:'with $.debug, a correct symmetric remove stays silent' }, () => {
  const warnings = withDebug(() => {
    const src: any = $({ a: 10, b: 20 })
    const r: any = reduce(src, (acc: any, v: any) => acc + v, (acc: any, v: any) => acc - v, 0)
    src.c = 5         // insert a new row (BU1 → BI0): acc 30 → 35, verified
    delete src.a      // remove (BR1): acc 35 → 25, verified
    eq(r[value], 25)
  })
  same(warnings, [])
})

spec({ op:'reduce', guarantee:'Identity', trigger:'dedup-call', shape:'array', asserts:'the same fn and init reuse the operator view' }, () => {
  const res: any = $([1, 2, 3])
  const fn = (a: any, b: any) => a + b
  const r1: any = reduce(res, fn, 0)
  const r2: any = reduce(res, fn, 0)
  eq(r1[value], r2[value])
})

// `reduce(add, remove, init)` — the incremental arity. The whole point is
// that BI0/BR1 thread through the user's add/remove instead of triggering
// a full rebuild, so the assertions here pin both the *result* (matches
// the equivalent 2-arg reduce) and the *call count* (only the delta rows
// hit the user functions).
spec({ op:'reduce', guarantee:'Efficiency', trigger:'insert', shape:'object', via:['BI0'], asserts:'an object insert threads add for only the new row' }, () => {
  // OBJECT source: keys are stable, so an insert threads incrementally (add the
  // one new row). An ARRAY source deliberately rebuilds on insert/remove — a
  // splice shifts every position and the position-keyed cache can't survive it
  // (see the array-splice test below), matching AggregateValue/LengthFnValue.
  const src: any = $({ a: 10, b: 20, c: 30 })
  let addCalls = 0, removeCalls = 0
  const r: any = reduce(src,
    (acc: any, v: any) => { addCalls++; return acc + v },
    (acc: any, v: any) => { removeCalls++; return acc - v },
    0,
  )
  eq(r[value], 60)
  eq(addCalls, 3)                                // initial rebuild
  src.d = 40                                     // object insert — incremental
  eq(r[value], 100)
  eq(addCalls, 4)                                // +1 for the inserted row
  eq(removeCalls, 0)
})

spec({ op:'reduce', guarantee:'Reduction', trigger:'remove', shape:'array', issue:'#28', asserts:'an array splice rebuilds so the position-keyed cache cannot desync' }, () => {
  // Regression (#28): the position-keyed _cache went stale after an array
  // splice — a later BU1 recovered the wrong old row and the accumulator
  // drifted silently. Array inserts/removes now rebuild (re-keying the cache).
  const src: any = $([10, 20, 30])
  const r: any = reduce(src, (a: any, v: any) => a + v, (a: any, v: any) => a - v, 0)
  eq(r[value], 60)
  delete src[0]                                  // splice — positions shift
  eq(r[value], 50)
  src[0] = 99                                    // overwrite the (now-shifted) head
  eq(r[value], 129)                              // was 149 (subtracted the wrong cached row)
})

spec({ op:'reduce', guarantee:'Efficiency', trigger:'remove', shape:'object', via:['BR1'], asserts:'a remove threads remove for only the deleted row' }, () => {
  const src: any = $({ a: 1, b: 2, c: 3 })
  let addCalls = 0, removeCalls = 0
  const r: any = reduce(src,
    (acc: any, v: any) => { addCalls++; return acc + v },
    (acc: any, v: any) => { removeCalls++; return acc - v },
    0,
  )
  eq(r[value], 6)
  delete src.b
  eq(r[value], 4)
  eq(removeCalls, 1)                             // exactly the deleted row
})

spec({ op:'reduce', guarantee:'Reduction', trigger:'insert/remove', shape:'object', asserts:'the incremental fold matches the equivalent plain fold' }, () => {
  const src: any = $({ a: 1, b: 2, c: 3 })
  const total: any = reduce(src, (a: any, v: any) => a + v, 0)
  const totalInc: any = reduce(src,
    (a: any, v: any) => a + v,
    (a: any, v: any) => a - v,
    0,
  )
  eq(totalInc[value], total[value])
  src.d = 4
  eq(totalInc[value], total[value])
  delete src.a
  eq(totalInc[value], total[value])
})

spec({ op:'reduce', guarantee:'Robustness', trigger:'overwrite', shape:'object', asserts:'a thunk init produces a fresh accumulator on rebuild' }, () => {
  // Mutation-in-place is the common case for histogram-shaped accs. A
  // thunk init guarantees XU0/XR0 starts from a clean object instead of
  // re-using a polluted one.
  // OBJECT source: inserts thread incrementally (initCalls stays 1). An array
  // source would rebuild on each insert (#28), firing the thunk each time.
  const src: any = $({})
  let initCalls = 0
  const histogram: any = reduce(src,
    (acc: any, row: any) => { acc[row.b] = (acc[row.b] || 0) + 1; return acc },
    (acc: any, row: any) => { if (--acc[row.b] === 0) delete acc[row.b]; return acc },
    () => { initCalls++; return {} },
  )
  eq(initCalls, 1)
  src.r1 = { b: 'x' }
  src.r2 = { b: 'x' }
  src.r3 = { b: 'y' }
  same(histogram[value], { x: 2, y: 1 })
  // Replace the whole source — XU0. Thunk fires again so the new acc
  // doesn't inherit the previous counts.
  src[value] = { z1: { b: 'z' } }
  eq(initCalls, 2)
  same(histogram[value], { z: 1 })
})

spec({ op:'reduce', guarantee:'Efficiency', trigger:'overwrite', shape:'object', via:['BU1'], asserts:'a whole-slot overwrite subtracts the old and adds the new in O(delta)' }, () => {
  // A whole-slot overwrite (`data[k] = newRow`) changes the slot reference, so
  // the per-key cache holds the distinct OLD row: BU1 subtracts it and adds
  // the new one in O(Δ) instead of re-folding both rows. (BU2 — an in-place
  // nested edit — still rebuilds; the reference is unchanged so there's no
  // old value to subtract. That case is pinned in the next test.)
  const src: any = $({ a: 1, b: 2 })
  let addCalls = 0, removeCalls = 0
  const r: any = reduce(src,
    (acc: any, v: any) => { addCalls++; return acc + v },
    (acc: any, v: any) => { removeCalls++; return acc - v },
    0,
  )
  eq(addCalls, 2)                                // initial rebuild
  eq(removeCalls, 0)
  src.a = 10                                     // BU1 → remove(old 1) + add(new 10)
  eq(r[value], 12)                              // 10 + 2
  eq(addCalls, 3)                                // +1 for the new value only
  eq(removeCalls, 1)                             // -1 for the old value only
})

spec({ op:'reduce', guarantee:'Efficiency', trigger:'edit', shape:'object', via:['BU2'], asserts:'a nested in-place edit falls back to a full rebuild' }, () => {
  // The row reference is unchanged on `data[k].f = x`, so the cache holds the
  // already-mutated row — no pre-edit value to subtract. Rebuild is the safe
  // fallback (and it re-seeds the cache, so a later BU1 stays correct).
  const src: any = $({ a: { val: 1 }, b: { val: 2 } })
  let addCalls = 0, removeCalls = 0
  const r: any = reduce(src,
    (acc: any, row: any) => { addCalls++; return acc + row.val },
    (acc: any, row: any) => { removeCalls++; return acc - row.val },
    0,
  )
  eq(addCalls, 2)
  src.a.val = 10                                 // BU2 → full rebuild
  eq(r[value], 12)                              // 10 + 2
  eq(addCalls, 4)                                // both rows re-walked
  eq(removeCalls, 0)                             // rebuild re-adds, never removes
})

spec({ op:'reduce', guarantee:'Reduction', trigger:'overwrite', shape:'array', via:['BU1'], asserts:'a whole-slot overwrite over an array subtracts the old value via key normalization' }, () => {
  // Regression: the per-key cache is keyed by STRING, but `iter` yields NUMERIC
  // keys for arrays while BU1 carries STRING keys. Without `'' + key`
  // normalization the lookup misses, `remove` is skipped, and only `add` runs
  // → silent desync (would read 260, not 240). $.debug off, so the symmetry
  // check wouldn't catch it — the normalization is the actual guard.
  const src: any = $([10, 20, 30])
  const r: any = reduce(src, (a: any, v: any) => a + v, (a: any, v: any) => a - v, 0)
  eq(r[value], 60)
  src[1] = 200                                   // BU1 on index 1: 60 - 20 + 200
  eq(r[value], 240)
})

spec({ op:'reduce', guarantee:'Reduction', trigger:'insert/remove', shape:'object', via:['BI0','BU1','BR1'], asserts:'the value cache stays consistent across insert, overwrite and remove' }, () => {
  // Exercises the cache across all three incremental entry points: an insert
  // seeds it, a whole-slot overwrite reads+updates it, a remove deletes it.
  const src: any = $({ a: 1 })
  const r: any = reduce(src,
    (acc: any, v: any, k: any) => { acc[k] = v; return acc },
    (acc: any, v: any, k: any) => { delete acc[k]; return acc },
    () => ({}),
  )
  same(r[value], { a: 1 })
  src.b = 2                                       // BI0  → cache.set('b', 2)
  same(r[value], { a: 1, b: 2 })
  src.a = 100                                     // BU1  → remove old a, add new a
  same(r[value], { a: 100, b: 2 })
  delete src.b                                    // BR1  → cache.delete('b')
  same(r[value], { a: 100 })
})

spec({ op:'reduce', guarantee:'Identity', trigger:'dedup-call', shape:'array', asserts:'the same (add, remove, init) triple reuses the operator view' }, () => {
  const src: any = $([1, 2])
  const add = (a: any, v: any) => a + v
  const remove = (a: any, v: any) => a - v
  const r1: any = reduce(src, add, remove, 0)
  const r2: any = reduce(src, add, remove, 0)
  eq(r1[value], r2[value])
  // Same operator view: a mutation to one's view.value is observed via both.
  src.insert(3)
  eq(r1[value], 6)
  eq(r2[value], 6)
})

// Regression (#32): the 2-arg reduce(fn, init) reused the SAME init object on
// every rebuild, so the documented object-merging idiom (mutate + return acc)
// accumulated across rebuilds (3 -> 9 -> 24 instead of 3 -> 6 -> 15) AND the
// publish gate `acc !== view.value` was permanently false (acc WAS view.value),
// so sinks never updated. A mutable init is now cloned per rebuild.
spec({ op:'reduce', guarantee:'Reduction', trigger:'edit', shape:'object', issue:'#32', asserts:'a mutable object init is cloned per rebuild, not accumulated' }, () => {
  const src: any = $({ a: 1, b: 2 })
  const r: any = reduce(src, (acc: any, row: any) => { acc.total = (acc.total || 0) + row; return acc }, {})
  const ev = r.connect([])
  same(r[value], { total: 3 })
  src.c = 3
  same(r[value], { total: 6 })          // was 9
  src.a = 10
  same(r[value], { total: 15 })         // was 24
  eq(ev.length > 1, true)               // sinks DO receive updates now
  // primitive immutable fold unaffected
  eq(reduce($({ a: 1, b: 2 }), (a: any, x: any) => a + x, 0)[value], 3)
})

// REACTIVE-INIT GUARD --------------------------------------------------
// `init` is the fold's identity element, not a reactive input. A ViewProxy init
// is a misuse that used to silently misbehave (2-arg → NaN; 3-arg → an opaque
// "cannot invoke a root value" throw). Fail fast with a clear pointer instead.
spec({ op:'reduce', guarantee:'Robustness', trigger:'construct', shape:'array', via:'reactive-init-guard', asserts:'a reactive ViewProxy init throws a clear error (both arities)' }, () => {
  const src: any = $([1, 2, 3])
  throws(() => reduce(src, (a: any, x: any) => a + x, $(5)),
    /init must be a plain value or a thunk, not a reactive ViewProxy/)
  throws(() => reduce(src, (a: any, x: any) => a + x, (a: any, x: any) => a - x, $(5)),
    /init must be a plain value or a thunk, not a reactive ViewProxy/)
  // a plain literal / thunk init is unaffected
  eq(reduce(src, (a: any, x: any) => a + x, 5)[value], 11)
  eq(reduce(src, (a: any, x: any) => a + x, (a: any, x: any) => a - x, 5)[value], 11)
})
