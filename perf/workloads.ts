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
import { $ } from '../full.ts'

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
