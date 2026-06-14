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
