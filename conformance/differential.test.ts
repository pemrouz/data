// M2 differential fuzz: cross-operator COMPOSITIONS under seeded churn — the
// crossfilter shape (between → intersect → buckets → windowed sort → scalar)
// that generated v2's C-series, run over object AND array sources with the
// widened mutation vocabulary (writes, nested writes, adds, removes,
// patch-batches, mid-inserts, brush moves).
//
// Every collection node is conform()-wrapped (legality + replay on every
// commit); every step additionally asserts each view against an independent
// plain-JS oracle recomputed from the source snapshot. v2 needed normalizers
// to fence off underspecified behavior; v3 asserts EXACT equality.

import { test } from 'node:test'
import assert from 'node:assert'
import { Runtime } from '../kernel/runtime.ts'
import { SourceNode } from '../kernel/node.ts'
import { filter } from '../ops/rowops.ts'
import { sum, avg } from '../ops/aggregate.ts'
import { between } from '../ops/between.ts'
import { intersect, union, except } from '../ops/setops.ts'
import { group, lengthBuckets } from '../ops/bucket.ts'
import { za } from '../ops/ordered.ts'
import { reduce, distinct } from '../ops/misc.ts'
import { conform, conformScalar, assertOracle } from './harness.ts'
import { deepEq } from './replay.ts'
import type { RowKey } from '../contract/delta.ts'

const same = assert.deepStrictEqual

type Row = { region: string; val: number; gx: number; nested: { hot: boolean } }

// Seeded LCG — deterministic churn, reproducible failures.
function lcg(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 2 ** 32)
}

const REGIONS = ['north', 'south', 'east', 'west']
function mkRow(r: () => number): Row {
  return {
    region: REGIONS[(r() * 4) | 0],
    val: (r() * 100) | 0,
    gx: (r() * 20) | 0,
    nested: { hot: r() > 0.5 },
  }
}

function sumOracle(rows: Map<RowKey, Row>, pred: (x: Row) => boolean, col: 'val' | 'gx'): number {
  let t = 0
  for (const x of rows.values()) if (pred(x)) t += x[col]
  return t
}

// The full crossfilter-shaped chain over one source; returns per-step checker.
function crossfilterChain(src: SourceNode<Row>, getBounds: () => [number, number]) {
  const inRange = between(src, 'val', [10, 80])
  const north = filter(src, (x) => x.region === 'north' || x.region === 'east')
  const both = intersect(inRange, north)
  const byRegion = lengthBuckets(both, (x) => x.region)
  const topGx = za(both, 'gx', 5)
  const total = sum(both, 'val')
  for (const n of [inRange, north, both, byRegion, topGx]) conform(n)
  conformScalar(total as any)

  return {
    setBounds: (lo: number, hi: number) => inRange.setBounds([lo, hi]),
    topOrder: () => topGx.currentOrder(),
    check() {
      const rows = src.snapshot()
      const [lo, hi] = getBounds()
      const inR = (x: Row) => x.val >= lo && x.val <= hi
      const isN = (x: Row) => x.region === 'north' || x.region === 'east'
      const inBoth = (x: Row) => inR(x) && isN(x)
      assertOracle(inRange, () => new Map([...rows].filter(([, x]) => inR(x))), 'between')
      assertOracle(both, () => new Map([...rows].filter(([, x]) => inBoth(x))), 'intersect')
      // buckets: counts per region among `both`, zero-persistence checked structurally
      const counts = new Map<string, number>()
      for (const x of rows.values()) if (inBoth(x)) counts.set(x.region, (counts.get(x.region) ?? 0) + 1)
      const bSnap = byRegion.snapshot()
      for (const [bk, bv] of bSnap) {
        const expected = counts.get(String(bk)) ?? 0
        if (!deepEq(bv, { value: expected }))
          throw new Error(`bucket ${String(bk)}: ${JSON.stringify(bv)} != {value:${expected}}`)
      }
      for (const [ck] of counts) if (!bSnap.has(ck)) throw new Error(`bucket ${ck} missing`)
      // Windowed sort: top-5 by gx desc among both. THE TIE SPEC: ties break
      // by view-arrival seq (deterministic; a re-entering key appends) — an
      // external oracle can't know arrival order, so it checks order up to
      // tie-equivalence; byte-exact determinism is pinned separately by the
      // double-run test below.
      const members = [...rows.keys()].filter((k) => inBoth(rows.get(k)!))
      const gxOf = (k: RowKey) => rows.get(k)!.gx
      const sortedGx = members.map(gxOf).sort((a, b) => b - a).slice(0, 5)
      const actualOrder = [...(topGx.currentOrder() ?? [])]
      same(actualOrder.map(gxOf), sortedGx, 'za window gx sequence')
      // every window member must be a legitimate top-5 candidate: its gx must
      // be ≥ the 5th-ranked gx, and all strictly-greater rows must be present
      const cutoff = sortedGx[sortedGx.length - 1] ?? -Infinity
      const winSet = new Set(actualOrder)
      for (const k of actualOrder) assert.ok(gxOf(k) >= cutoff, 'window member below cutoff')
      for (const k of members)
        if (gxOf(k) > cutoff) assert.ok(winSet.has(k), `strictly-greater row ${String(k)} missing from window`)
      same(total.value(), sumOracle(rows, inBoth, 'val'), 'sum over intersect')
    },
  }
}

function churn(sourceKind: 'object' | 'array', seed: number, steps: number, trace?: string[]) {
  const r = lcg(seed)
  const rt = new Runtime()
  const init: Row[] = []
  for (let i = 0; i < 40; i++) init.push(mkRow(r))
  const src =
    sourceKind === 'array'
      ? new SourceNode<Row>(rt, init)
      : new SourceNode<Row>(rt, Object.fromEntries(init.map((x, i) => ['k' + i, x])))
  conform(src)

  let bounds: [number, number] = [10, 80]
  const chain = crossfilterChain(src, () => bounds)
  chain.check()

  const liveKeys = (): RowKey[] => [...src.snapshot().keys()]

  for (let step = 0; step < steps; step++) {
    const dice = r()
    const keys = liveKeys()
    if (dice < 0.3 && keys.length > 0) {
      // field write (sometimes nested)
      const k = keys[(r() * keys.length) | 0]
      const which = r()
      if (which < 0.4) src.write(k, ['val'], (r() * 100) | 0)
      else if (which < 0.7) src.write(k, ['region'], REGIONS[(r() * 4) | 0])
      else if (which < 0.9) src.write(k, ['gx'], (r() * 20) | 0)
      else src.write(k, ['nested', 'hot'], r() > 0.5)
    } else if (dice < 0.45) {
      // insert (mid-insert for arrays)
      if (sourceKind === 'array') src.insert(mkRow(r), (r() * (keys.length + 1)) | 0)
      else src.write('n' + step, [], mkRow(r))
    } else if (dice < 0.6 && keys.length > 5) {
      src.remove(keys[(r() * keys.length) | 0])
    } else if (dice < 0.8) {
      // patch batch: several writes in one commit (incl. flips)
      rt.batch(() => {
        for (let j = 0; j < 5 && keys.length > 0; j++) {
          const k = keys[(r() * keys.length) | 0]
          src.write(k, ['val'], (r() * 100) | 0)
        }
      })
    } else {
      // brush move (the between walk)
      const lo = (r() * 60) | 0
      const hi = lo + 10 + ((r() * 40) | 0)
      bounds = [lo, hi]
      chain.setBounds(lo, hi)
    }
    chain.check()
    if (trace) trace.push((topOrderOf(chain) ?? []).join(','))
  }
}

// reach the za window's order through the chain (typed loosely on purpose)
function topOrderOf(chain: any): readonly RowKey[] | null {
  return chain.topOrder()
}

test('differential: crossfilter chain over an OBJECT source, 400-step seeded churn', () => {
  churn('object', 0xC0FFEE, 400)
})

test('differential: crossfilter chain over an ARRAY source (mid-inserts), 400-step seeded churn', () => {
  churn('array', 0xBADA55, 400)
})

test('differential: second seeds (fresh-seed discipline)', () => {
  churn('object', 12345, 250)
  churn('array', 67890, 250)
})

test('differential: union/except/group/distinct/reduce composition churn', () => {
  const r = lcg(0xFEED)
  const rt = new Runtime()
  const src = new SourceNode<Row>(
    rt,
    Object.fromEntries(Array.from({ length: 30 }, (_, i) => ['k' + i, mkRow(r)])),
  )
  conform(src)
  const hot = filter(src, (x) => x.nested.hot)
  const big = filter(src, (x) => x.val >= 50)
  const u = union(hot, big)
  const e = except(src, hot)
  const byGx = group(u, (x) => x.gx % 4)
  const vals = distinct(src, (x) => x.region)
  const folded = reduce(
    src,
    (acc: number, x: Row) => acc + x.val,
    (acc: number, x: Row) => acc - x.val,
    0,
  )
  for (const n of [hot, big, u, e, byGx, vals]) conform(n)
  conformScalar(folded as any)

  const check = () => {
    const rows = src.snapshot()
    const isHot = (x: Row) => x.nested.hot
    const isBig = (x: Row) => x.val >= 50
    assertOracle(u, () => new Map([...rows].filter(([, x]) => isHot(x) || isBig(x))), 'union')
    assertOracle(e, () => new Map([...rows].filter(([, x]) => !isHot(x))), 'except')
    same(folded.value(), sumOracle(rows, () => true, 'val'), '3-arg reduce total')
    const regions = new Set<string>()
    for (const x of rows.values()) regions.add(x.region)
    same(new Set([...vals.snapshot().keys()].map(String)), regions, 'distinct keyset')
  }
  check()
  for (let step = 0; step < 300; step++) {
    const keys = [...src.snapshot().keys()]
    const dice = r()
    if (dice < 0.35 && keys.length > 0) {
      const k = keys[(r() * keys.length) | 0]
      if (r() < 0.5) src.write(k, ['val'], (r() * 100) | 0)
      else src.write(k, ['nested', 'hot'], r() > 0.5)
    } else if (dice < 0.55) {
      src.write('n' + step, [], mkRow(r))
    } else if (dice < 0.7 && keys.length > 5) {
      src.remove(keys[(r() * keys.length) | 0])
    } else {
      rt.batch(() => {
        for (let j = 0; j < 4 && keys.length > 0; j++) {
          const k = keys[(r() * keys.length) | 0]
          src.write(k, ['region'], REGIONS[(r() * 4) | 0])
        }
      })
    }
    check()
  }
})

test('differential: identical runs are byte-identical (tie determinism pinned)', () => {
  const t1: string[] = []
  const t2: string[] = []
  churn('object', 0xD5EED, 150, t1)
  churn('object', 0xD5EED, 150, t2)
  same(t1, t2)
})
