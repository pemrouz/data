// @ts-nocheck
// perf/workloads.ts — the ONE definition of each operator's perf workload:
// a source builder + the setup/single/batch timed closures + each closure's
// gate threshold (ms). BOTH consumers import from here, so there is a single
// source of truth per measurement:
//   - the gate operators/<op>/<op>.perf.ts asserts `ok(gateMeasure(run) < gate)`
//   - the report perf/run-report.ts re-measures the SAME `run` with report rigor
//     (benchMeasure: warmup + gc) and emits a row.
// This closes the honesty gap where the report used to sweep a *third* source
// shape, reporting numbers no gate ever asserted.
//
// Shape per operator: { N, source(n), workloads(n) -> { <case>: { gate, run, batch? } } }.
// A workload that needs a live graph across reps holds it on a `keep` field so
// the WeakRef-held operator chain isn't collected mid-measurement.
import { $, value } from '../full.ts'

export const filter = {
  N: 10_000,
  source(n = this.N) {
    const o = {}
    for (let i = 0; i < n; i++) o[i] = { active: i % 2 === 0, val: i }
    return o
  },
  workloads(n = this.N) {
    const mk = () => {
      const s = $(this.source(n))
      const f = s.filter(d => d.active) // hold f so the chain stays alive
      return { s, f }
    }
    const single = mk()
    const batch = mk()
    let toggle = false
    return {
      // setup rebuilds a fresh source+filter each rep — already rep-idempotent
      setup: { gate: 500, run: () => { const s = $(this.source(n)); s.filter(d => d.active) } },
      // insert one row into an N-row filtered source (the 5-row growth over reps
      // is an O(1) insert, negligible)
      single: { gate: 50, keep: single.f, run: () => single.s.insert({ active: true, val: 99999 }) },
      // toggle `active` on 1000 rows in place (deterministic, rep-stable)
      batch: { gate: 500, batch: 1000, keep: batch.f, run: () => { toggle = !toggle; for (let i = 0; i < 1000; i++) batch.s[i].active = toggle } },
    }
  },
}

// ── clean-tier operators (Mode A) ──────────────────────────────────────────
// Each below mirrors its gate file's EXACT source + cases + thresholds; the
// gate operators/<op>/<op>.perf.ts is now a thin driver over `workloads()` and
// perf/run-report.ts re-measures the same closures. `label` is the display/op
// name (export keys can't carry `(fn)` etc.). A batch that re-mutates the SAME
// field every rep alternates a base so each rep does real work (a literal
// repeat would dedup to a no-op and the median would collapse to ~0).

export const map = {
  N: 10_000,
  label: 'map',
  source(n = this.N) {
    const o = {}
    for (let i = 0; i < n; i++) o[i] = { x: i, y: i * 2 }
    return o
  },
  workloads(n = this.N) {
    const mk = () => { const s = $(this.source(n)); const m = s.map(d => d.x + d.y); return { s, m } }
    const ins = mk(); let i = n
    return {
      setup: { gate: 500, run: () => { const s = $(this.source(n)); s.map(d => d.x + d.y) } },
      insert: { gate: 50, keep: ins.m, run: () => { ins.s.insert({ x: i, y: i * 2 }); i++ } },
    }
  },
}

export const to = {
  N: 10_000,
  label: 'to',
  source(n = this.N) {
    const o = {}
    for (let i = 0; i < n; i++) o[i] = { active: i % 2 === 0, val: i }
    return o
  },
  workloads(n = this.N) {
    // non-trivial projection (count active rows) — the realistic derived-scalar use
    const proj = d => Object.values(d).filter(r => r.active).length
    const mk = () => { const s = $(this.source(n)); const t = s.to(proj); return { s, t } }
    const ins = mk(); const bat = mk(); let i = n; let toggle = false
    return {
      setup: { gate: 500, run: () => { const s = $(this.source(n)); s.to(proj) } },
      insert: { gate: 50, keep: ins.t, run: () => { ins.s.insert({ active: true, val: i++ }) } },
      batch: { gate: 2000, batch: 1000, keep: bat.t, run: () => { toggle = !toggle; for (let k = 0; k < 1000; k++) bat.s[k].active = toggle } },
    }
  },
}

export const length = {
  N: 10_000,
  label: 'length',
  source(n = this.N) {
    const o = {}
    for (let i = 0; i < n; i++) o[i] = { bucket: Math.floor(i / 100), val: i }
    return o
  },
  workloads(n = this.N) {
    const mk = () => { const s = $(this.source(n)); const c = s.length(); return { s, c } }
    const ins = mk(); let i = n
    return {
      // scalar count: O(1) per insert
      insert: { gate: 50, keep: ins.c, run: () => { ins.s.insert({ bucket: 0, val: i++ }) } },
    }
  },
}

export const lengthFn = {
  N: 10_000,
  label: 'length(fn)',
  source: length.source,
  workloads(n = this.N) {
    return {
      // bucketed count build over 100 buckets
      setup: { gate: 500, run: () => { const s = $(this.source(n)); s.length(d => d.bucket) } },
    }
  },
}

export const keys = {
  N: 10_000,
  label: 'keys',
  source(n = this.N) {
    const o = {}
    for (let i = 0; i < n; i++) o[i] = { active: i % 2 === 0, val: i }
    return o
  },
  workloads(n = this.N) {
    const mk = () => { const s = $(this.source(n)); const k = s.keys(); return { s, k } }
    const ins = mk(); let i = n
    return {
      setup: { gate: 500, run: () => { const s = $(this.source(n)); s.keys() } },
      insert: { gate: 50, keep: ins.k, run: () => { ins.s.insert({ active: true, val: i++ }) } },
    }
  },
}

export const values = {
  N: 10_000,
  label: 'values',
  source: keys.source,
  workloads(n = this.N) {
    const mk = () => { const s = $(this.source(n)); const v = s.values(); return { s, v } }
    const bat = mk(); let toggle = false
    return {
      setup: { gate: 500, run: () => { const s = $(this.source(n)); s.values() } },
      // alternate base so every rep mutates (else reps 2+ would dedup to no-ops)
      batch: { gate: 1000, batch: 100, keep: bat.v, run: () => { toggle = !toggle; const base = toggle ? 1 : 2; for (let i = 0; i < 100; i++) bat.s[i].val = i + base } },
    }
  },
}

export const tap = {
  N: 10_000,
  label: 'tap',
  source: keys.source,
  workloads(n = this.N) {
    const mkFull = () => { const s = $(this.source(n)); let c = 0; const t = s.tap(ch => { c++ }); return { s, t } }   // 1-arg → full TapValue (clones)
    const mkBare = () => { const s = $(this.source(n)); let c = 0; const t = s.tap(() => { c++ }); return { s, t } }   // 0-arg → TapBareValue (no clone)
    const ins = mkFull(); const bat = mkFull(); const bare = mkBare(); let i = n; let tb = false; let tbare = false
    return {
      setup: { gate: 1000, run: () => { const s = $(this.source(n)); let c = 0; s.tap(() => { c++ }) } },
      insert: { gate: 50, keep: ins.t, run: () => { ins.s.insert({ active: true, val: i++ }) } },
      batch: { gate: 500, batch: 1000, keep: bat.t, run: () => { tb = !tb; for (let k = 0; k < 1000; k++) bat.s[k].active = tb } },
      bare: { gate: 500, batch: 1000, keep: bare.t, run: () => { tbare = !tbare; for (let k = 0; k < 1000; k++) bare.s[k].active = tbare } },
    }
  },
}

export const reverse = {
  N: 10_000,
  label: 'reverse',
  source: keys.source,
  workloads(n = this.N) {
    const mk = () => { const s = $(this.source(n)); const r = s.reverse(); return { s, r } }
    const ins = mk(); const bat = mk(); let i = n; let toggle = false
    return {
      setup: { gate: 500, run: () => { const s = $(this.source(n)); s.reverse() } },
      insert: { gate: 50, keep: ins.r, run: () => { ins.s.insert({ active: true, val: i++ }) } },
      batch: { gate: 1000, batch: 100, keep: bat.r, run: () => { toggle = !toggle; const base = toggle ? 1 : 2; for (let k = 0; k < 100; k++) bat.s[k].val = k + base } },
    }
  },
}

export const distinct = {
  N: 10_000,
  label: 'distinct',
  source(n = this.N) {
    const o = {}
    for (let i = 0; i < n; i++) o[i] = { cat: i % 100, val: i }
    return o
  },
  workloads(n = this.N) {
    const mk = () => { const s = $(this.source(n)); const d = s.distinct(r => r.cat); return { s, d } }
    const ins = mk(); const bat = mk(); let i = n; let toggle = false
    return {
      setup: { gate: 500, run: () => { const s = $(this.source(n)); s.distinct(r => r.cat) } },
      insert: { gate: 50, keep: ins.d, run: () => { ins.s.insert({ cat: i % 100, val: i }); i++ } },
      batch: { gate: 1000, batch: 100, keep: bat.d, run: () => { toggle = !toggle; const base = toggle ? 1 : 2; for (let k = 0; k < 100; k++) bat.s[k].val = k + base } },
    }
  },
}

export const group = {
  N: 10_000,
  label: 'group',
  source(n = this.N) {
    const o = {}
    for (let i = 0; i < n; i++) o[i] = { cat: i % 10, val: i }
    return o
  },
  workloads(n = this.N) {
    const mk = () => { const s = $(this.source(n)); const g = s.group(d => d.cat); return { s, g } }
    const ins = mk(); let i = n
    // limit→group churn: each delete is limit BR1A (pop) + BI0A (refill) that
    // group translates into one per-bucket splice (the array-source restructure)
    const cs = $(this.source(n)); const cg = cs.limit(100).group(d => d.cat); let removed = 100
    return {
      setup: { gate: 500, run: () => { const s = $(this.source(n)); s.group(d => d.cat) } },
      insert: { gate: 50, keep: ins.g, run: () => { ins.s.insert({ cat: i % 10, val: i }); i++ } },
      churn: { gate: 50, keep: cg, run: () => { delete cs[removed]; removed++ } },
    }
  },
}

// ── complex-tier operators (Mode A) ────────────────────────────────────────
// These diverge from the uniform clean-tier shape: reactive bounds, multi-
// source set algebra, dynamic (view-reading) setups, and per-case sampling
// counts. A case may carry `reps` (passed to the timer as its second arg) when
// the gate sampled it with a non-default rep count — typically because the run
// CONSUMES its source (distinct keys per rep) so the source must hold enough
// rows for warmup + reps. `keep` bundles every graph piece (sources + bounds +
// view) because a multi-source / reactive-bounds operator holds its inputs by
// WeakRef and the run closure only references the one it mutates — the rest
// would be collected mid-measurement and the op would silently measure nothing.

export const compare = {
  N: 10_000,
  label: 'compare',
  source(n = this.N) {
    const o = {}
    for (let i = 0; i < n; i++) o[i] = { active: i % 2 === 0, val: i }
    return o
  },
  workloads(n = this.N) {
    const mkGt = () => { const s = $(this.source(n)); const f = s.gt('val', 5000); return { s, f } }
    const ins = mkGt(); const bat = mkGt(); let bump = 0
    // reactive threshold: oscillate the bound (idempotent pair) — each move is a
    // full RowOperator XU0 over n rows (compare keeps no sort index), so this is
    // the worst case for a reactive threshold and the gate that catches drift.
    const tS = $(this.source(n)); const tb = $(5000); const tV = tS.gt('val', tb)
    return {
      'gt-setup': { gate: 500, run: () => { const s = $(this.source(n)); s.gt('val', 5000) } },
      'gt-insert': { gate: 50, keep: ins, run: () => { ins.s.insert({ active: true, val: 99999 }) } },
      // shift 1000 rows across the threshold to drive membership flips (bump grows → real work each rep)
      'gt-batch': { gate: 500, batch: 1000, keep: bat, run: () => { bump++; for (let i = 4500; i < 5500; i++) bat.s[i].val = bump * 10000 + i } },
      'gt-threshold-move': { gate: 500, keep: { tS, tb, tV }, run: () => { tb[value] = 2500; tb[value] = 5000 } },
      'lt-setup': { gate: 500, run: () => { const s = $(this.source(n)); s.lt('val', 5000) } },
      'gte-setup': { gate: 500, run: () => { const s = $(this.source(n)); s.gte('val', 5000) } },
      'lte-setup': { gate: 500, run: () => { const s = $(this.source(n)); s.lte('val', 5000) } },
    }
  },
}

export const between = {
  N: 10_000,
  label: 'between',
  source(n = this.N) {
    const o = {}
    for (let i = 0; i < n; i++) o[i] = { val: Math.random() * 1000 }
    return o
  },
  workloads(n = this.N) {
    // narrow/widen brush on reactive bounds (idempotent pair)
    const nS = $(this.source(n)); const nb = $({ lo: 0, hi: 1000 }); const nV = nS.between('val', [nb.lo, nb.hi])
    // insert churn (object): src.insert grows the source; reps=3 (consumes)
    const iS = $(this.source(n)); const ib = $({ lo: 200, hi: 800 }); const iV = iS.between('val', [ib.lo, ib.hi]); let id = 100000
    // remove churn (object): delete distinct keys per rep; reps=5 (consumes 5×1000 of 10000)
    const rS = $(this.source(n)); const rb = $({ lo: 200, hi: 800 }); const rV = rS.between('val', [rb.lo, rb.hi]); let base = 0
    return {
      setup: { gate: 500, run: () => { const s = $(this.source(n)); const b = $({ lo: 200, hi: 800 }); s.between('val', [b.lo, b.hi]) } },
      narrow: { gate: 100, keep: { nS, nb, nV }, run: () => { nb.lo = 400; nb.hi = 600; nb.lo = 0; nb.hi = 1000 } },
      insert: { gate: 50, reps: 3, batch: 1000, keep: { iS, ib, iV }, run: () => { for (let i = 0; i < 1000; i++) iS.insert({ val: Math.random() * 1000 }, 'n' + (id++)) } },
      remove: { gate: 50, reps: 5, batch: 1000, keep: { rS, rb, rV }, run: () => { for (let i = 0; i < 1000; i++) delete rS[base + i]; base += 1000 } },
    }
  },
}

export const sort = {
  N: 10_000,
  label: 'sort',
  source(n = this.N) {
    const o = {}
    for (let i = 0; i < n; i++) o[i] = { score: Math.random() * 1000, id: i }
    return o
  },
  workloads(n = this.N) {
    // sort(src,'score',100) === za('score',100): ZAColumnValue, descending bounded top-100
    const iS = $(this.source(n)); const iV = iS.za('score', 100); let i = n
    // rotate: bump the row at the window tail (rank 99, lowest) past rank 0
    const rS = $(this.source(n)); const rV = rS.za('score', 100)
    const lastId = rV[value][rV[value].length - 1].id
    let bump = Math.max(...rV[value].map(r => r.score)) + 1
    // brush: bounded top-100 over a between, brush the whole window out then in
    const bo = {}; for (let k = 0; k < n; k++) bo['v' + k] = { r: Math.random(), id: k }
    const bS = $(bo); const bB = $([0, 1]); const bV = bS.between('r', bB).za('r', 100)
    return {
      setup: { gate: 500, run: () => { const s = $(this.source(n)); s.za('score', 100) } },
      insert: { gate: 50, keep: { iS, iV }, run: () => { iS.insert({ score: Math.random() * 1000, id: i++ }) } },
      rotate: { gate: 50, keep: { rS, rV }, run: () => { rS[lastId].score = bump++ } },
      brush: { gate: 200, keep: { bS, bB, bV }, run: () => { bB[value] = [0, 0.5]; bB[value] = [0, 1] } },
    }
  },
}

export const aggregate = {
  N: 10_000,
  label: 'aggregate',
  source(n = this.N) {
    const o = {}
    for (let i = 0; i < n; i++) o[i] = { active: i % 2 === 0, val: i }
    return o
  },
  workloads(n = this.N) {
    const mk = (build) => { const s = $(this.source(n)); const a = build(s); return { s, a } }
    const sumIns = mk(s => s.sum('val')); const maxIns = mk(s => s.max('val'))
    const avgBat = mk(s => s.avg('val')); const minBat = mk(s => s.min('val')); const everyBat = mk(s => s.every(r => r.active))
    let si = n; let mi = n; let ta = false; let tm = false; let te = false
    return {
      'sum-setup': { gate: 500, run: () => { const s = $(this.source(n)); s.sum('val') } },
      'sum-insert': { gate: 10, keep: sumIns, run: () => { sumIns.s.insert({ active: true, val: si++ }) } },
      // alternate base so every rep mutates (else reps 2+ dedup to no-ops)
      'avg-batch': { gate: 500, batch: 1000, keep: avgBat, run: () => { ta = !ta; const b = ta ? 1 : 2; for (let i = 0; i < 1000; i++) avgBat.s[i].val = i + b } },
      'max-setup': { gate: 500, run: () => { const s = $(this.source(n)); s.max('val') } },
      'max-insert': { gate: 10, keep: maxIns, run: () => { maxIns.s.insert({ active: true, val: mi++ }) } },
      'min-batch': { gate: 500, batch: 100, keep: minBat, run: () => { tm = !tm; const b = tm ? 1 : 2; for (let i = 0; i < 100; i++) minBat.s[i].val = i + b } },
      'some-setup': { gate: 500, run: () => { const s = $(this.source(n)); s.some(r => r.active) } },
      'every-batch': { gate: 500, batch: 1000, keep: everyBat, run: () => { te = !te; for (let i = 0; i < 1000; i++) everyBat.s[i].active = te } },
    }
  },
}

export const union = {
  N: 10_000,
  label: 'union',
  src(start, n) { const o = {}; for (let i = 0; i < n; i++) o[start + i] = `v${start + i}`; return o },
  workloads() {
    const N = this.N
    const build = () => { const a = $(this.src(0, N)); const b = $(this.src(5000, N)); const c = $(this.src(10000, N)); const u = a.union(b, c); return { a, b, c, u } }
    const churnG = build(); const insG = build(); let ins = 25000
    return {
      setup: { gate: 500, run: () => { const a = $(this.src(0, N)); const b = $(this.src(5000, N)); const c = $(this.src(10000, N)); a.union(b, c) } },
      // remove 1000 from b then re-add (idempotent — net zero, rep-stable)
      churn: { gate: 500, batch: 1000, keep: churnG, run: () => { for (let i = 0; i < 1000; i++) delete churnG.b[5000 + i]; for (let i = 0; i < 1000; i++) churnG.b[5000 + i] = `v${5000 + i}` } },
      insert: { gate: 500, batch: 1000, keep: insG, run: () => { for (let k = 0; k < 1000; k++) { insG.a[ins] = `v${ins}`; ins++ } } },
    }
  },
}

export const intersect = {
  N: 10_000,
  label: 'intersect',
  src(n) { const o = {}; for (let i = 0; i < n; i++) o[i] = `v${i}`; return o },
  workloads() {
    const N = this.N
    const build = () => { const a = $(this.src(N)); const b = $(this.src(8000)); const c = $(this.src(6000)); const x = a.intersect(b, c); return { a, b, c, x } }
    const churnG = build()
    return {
      setup: { gate: 500, run: () => { const a = $(this.src(N)); const b = $(this.src(8000)); const c = $(this.src(6000)); a.intersect(b, c) } },
      churn: { gate: 200, batch: 1000, keep: churnG, run: () => { for (let i = 0; i < 1000; i++) delete churnG.b[i]; for (let i = 0; i < 1000; i++) churnG.b[i] = `v${i}` } },
    }
  },
}

export const except = {
  N: 10_000,
  label: 'except',
  src(start, n) { const o = {}; for (let i = 0; i < n; i++) o[start + i] = `v${start + i}`; return o },
  workloads() {
    const N = this.N
    const insG = (() => { const a = $(this.src(0, N)); const b = $(this.src(0, 5000)); const x = a.except(b); return { a, b, x } })()
    // remove-other deletes DISTINCT keys per rep (base grows) so each rep re-admits
    // a different 1000 rows; b sized 6000 to hold warmup + 5 reps of 1000.
    const remG = (() => { const a = $(this.src(0, N)); const b = $(this.src(0, 6000)); const x = a.except(b); return { a, b, x } })()
    let ins = 5000; let base = 0
    return {
      setup: { gate: 500, run: () => { const a = $(this.src(0, N)); const b = $(this.src(0, 5000)); a.except(b) } },
      'insert-other': { gate: 500, batch: 1000, keep: insG, run: () => { for (let k = 0; k < 1000; k++) { insG.b[ins] = `v${ins}`; ins++ } } },
      'remove-other': { gate: 500, batch: 1000, keep: remG, run: () => { for (let i = 0; i < 1000; i++) delete remG.b[base + i]; base += 1000 } },
    }
  },
}

export const reduce = {
  N: 10_000,
  label: 'reduce',
  source(n = this.N) {
    const o = {}
    for (let i = 0; i < n; i++) o[i] = { active: i % 2 === 0, val: i }
    return o
  },
  workloads(n = this.N) {
    const add = (acc, r) => acc + r.val
    const sub = (acc, r) => acc - r.val
    const mkFull = () => { const s = $(this.source(n)); const a = s.reduce(add, 0); return { s, a } }                  // general fold, O(n)/event
    const mkInc = () => { const s = $(this.source(n)); const a = s.reduce(add, sub, 0); return { s, a } }              // incremental, O(Δ)/event
    const fIns = mkFull(); const fBat = mkFull(); const iIns = mkInc(); const iOvr = mkInc(); const iRem = mkInc()
    let fi = n; let ii = n; let toggle = false; let j = 0; let rbase = 9900
    return {
      setup: { gate: 500, run: () => { const s = $(this.source(n)); s.reduce(add, 0) } },
      insert: { gate: 50, keep: fIns, run: () => { fIns.s.insert({ active: true, val: fi++ }) } },
      // alternate base so every rep mutates (else reps 2+ dedup to no-ops)
      batch: { gate: 1000, batch: 100, keep: fBat, run: () => { toggle = !toggle; const b = toggle ? 1 : 2; for (let i = 0; i < 100; i++) fBat.s[i].val = i + b } },
      'inc-setup': { gate: 500, run: () => { const s = $(this.source(n)); s.reduce(add, sub, 0) } },
      'inc-insert': { gate: 5, keep: iIns, run: () => { iIns.s.insert({ active: true, val: ii++ }) } },        // O(1), much tighter than the full form's 50ms
      // whole-slot overwrite (BU1): remove(old)+add(new) via the per-key cache; j grows → real work each rep
      'inc-overwrite': { gate: 50, batch: 100, keep: iOvr, run: () => { for (let i = 0; i < 100; i++) iOvr.s[i] = { active: true, val: 100000 + (j++) } } },
      // delete DISTINCT keys per rep (rbase descends from 9900) so each rep does real removes; source holds 0..9999
      'inc-remove': { gate: 100, batch: 100, reps: 5, keep: iRem, run: () => { for (let i = 0; i < 100; i++) delete iRem.s[rbase + i]; rbase -= 100 } },
    }
  },
}
