// @ts-nocheck
// RxJS — three chained .pipe stages, mirroring data's view graph. Every
// .next() fires the whole pipeline synchronously: map → filter → sort+slice,
// each emitting a new array.

import { BehaviorSubject } from 'rxjs'
import { map } from 'rxjs/operators'
import { makeTrades, TICKS, THRESHOLD, TOP_K } from './workload.ts'
import { measure, pkgVersion, type BenchResult } from './measure.ts'

function build() {
  const subject = new BehaviorSubject(makeTrades())
  const withSpread$ = subject.pipe(
    map(rows => {
      const out = new Array(rows.length)
      for (let i = 0; i < rows.length; i++) {
        const t = rows[i]
        out[i] = { id: t.id, spread: t.ask - t.bid }
      }
      return out
    }),
  )
  const filtered$ = withSpread$.pipe(
    map(rows => rows.filter(t => t.spread > THRESHOLD)),
  )
  const top$ = filtered$.pipe(
    map(rows => [...rows].sort((a, b) => b.spread - a.spread).slice(0, TOP_K)),
  )
  let last: any[] = []
  const sub = top$.subscribe(v => { last = v })
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
    notes: 'three .pipe stages (map / filter / sort+slice); each emits a new array',
  }
}
