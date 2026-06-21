// RxJS — three .pipe stages for the top-K graph. Dashboard adds two parallel
// pipes off the same subject (liquidCount, avgBid), each subscribed
// independently. Every .next() emission fans out to all three subscribers.

import { BehaviorSubject } from 'rxjs'
import { map } from 'rxjs/operators'
import { makeTrades, TICKS, THRESHOLD, TOP_K } from './workload.ts'
import { measure, pkgVersion, type BenchResult } from './measure.ts'

function buildSingle() {
  const subject = new BehaviorSubject(makeTrades())
  const withSpread$ = subject.pipe(
    map((rows: any) => {
      const out = new Array(rows.length)
      for (let i = 0; i < rows.length; i++) {
        const t = rows[i]
        out[i] = { id: t.id, spread: t.ask - t.bid }
      }
      return out
    }),
  )
  const filtered$ = withSpread$.pipe(map((rows: any) => rows.filter((t: any) => t.spread > THRESHOLD)))
  const top$ = filtered$.pipe(map((rows: any) => [...rows].sort((a: any, b: any) => b.spread - a.spread).slice(0, TOP_K)))
  const sub = top$.subscribe(() => {})
  return { subject, sub }
}

function buildDashboard() {
  const subject = new BehaviorSubject(makeTrades())
  const liquidCount$ = subject.pipe(map((rows: any) => {
    let n = 0
    for (let i = 0; i < rows.length; i++) {
      const t = rows[i]
      if (t.ask - t.bid > THRESHOLD) n++
    }
    return n
  }))
  const top10$ = subject.pipe(
    map((rows: any) => {
      const out = new Array(rows.length)
      for (let i = 0; i < rows.length; i++) {
        const t = rows[i]
        out[i] = { id: t.id, spread: t.ask - t.bid }
      }
      return out
    }),
    map((rows: any) => rows.filter((t: any) => t.spread > THRESHOLD)),
    map((rows: any) => [...rows].sort((a: any, b: any) => b.spread - a.spread).slice(0, TOP_K)),
  )
  const avgBid$ = subject.pipe(map((rows: any) => {
    let s = 0
    for (let i = 0; i < rows.length; i++) s += rows[i].bid
    return s / rows.length
  }))
  const subs = [
    liquidCount$.subscribe(() => {}),
    top10$.subscribe(() => {}),
    avgBid$.subscribe(() => {}),
  ]
  return { subject, subs }
}

function tick(subject: any, t: any) {
  const next = subject.value.slice()
  next[t.idx] = { ...next[t.idx], [t.field]: t.newValue }
  subject.next(next)
}

export default function bench(): BenchResult {
  const setup = measure(() => {
    const g = buildSingle()
    g.sub.unsubscribe()
  })

  const single = (() => {
    const { subject } = buildSingle()
    let i = 0
    return measure(() => {
      tick(subject, TICKS[i++ % TICKS.length])
    })
  })()

  const stream = (() => {
    const { subject } = buildSingle()
    return measure(() => {
      for (let j = 0; j < TICKS.length; j++) {
        tick(subject, TICKS[j])
      }
    })
  })()

  const dashboard = (() => {
    const { subject } = buildDashboard()
    return measure(() => {
      for (let j = 0; j < TICKS.length; j++) {
        tick(subject, TICKS[j])
      }
    })
  })()

  return {
    name: 'rxjs',
    version: pkgVersion('rxjs'),
    setup,
    single,
    batch: stream,
    dashboard,
    notes: 'BehaviorSubject + pipes; dashboard = 3 parallel pipes per .next()',
  }
}
