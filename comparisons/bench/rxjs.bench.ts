// @ts-nocheck
// RxJS — BehaviorSubject<Trade[]>; pipe maps to top-K spread list. Each tick =
// one .next() with a freshly substituted array, which fires the pipeline
// synchronously: full sort + slice on every emission.

import { BehaviorSubject } from 'rxjs'
import { map } from 'rxjs/operators'
import { makeTrades, TICKS, THRESHOLD, TOP_K } from './workload.ts'
import { measure, pkgVersion, type BenchResult } from './measure.ts'

function build() {
  const subject = new BehaviorSubject(makeTrades())
  let last: any[] = []
  const sub = subject
    .pipe(map(rows => {
      const out = []
      for (let i = 0; i < rows.length; i++) {
        const t = rows[i]
        const spread = t.ask - t.bid
        if (spread > THRESHOLD) out.push({ id: t.id, spread })
      }
      out.sort((a, b) => b.spread - a.spread)
      return out.slice(0, TOP_K)
    }))
    .subscribe(v => { last = v })
  return { subject, sub, getLast: () => last }
}

function tick(subject, t) {
  const next = subject.value.slice()
  next[t.idx] = { ...next[t.idx], [t.field]: t.newValue }
  subject.next(next)
}

export default function bench(): BenchResult {
  const setup = measure(() => {
    const g = build()
    g.sub.unsubscribe()
  })

  const single = (() => {
    const { subject, getLast } = build()
    let i = 0
    return measure(() => {
      tick(subject, TICKS[i++ % TICKS.length])
      void getLast()
    })
  })()

  const stream = (() => {
    const { subject, getLast } = build()
    return measure(() => {
      for (let j = 0; j < TICKS.length; j++) {
        tick(subject, TICKS[j])
        void getLast()
      }
    })
  })()

  return {
    name: 'rxjs',
    version: pkgVersion('rxjs'),
    setup,
    single,
    batch: stream,
    notes: 'BehaviorSubject<Trade[]>; full filter + sort + slice per .next()',
  }
}
