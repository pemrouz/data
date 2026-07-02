// v3/ops/bucket.test.ts — the bucketing family (group / lengthBuckets) under
// the conformance kit: every collection node wrapped in conform() (legality +
// replay on every commit), plus an independent plain-JS oracle asserted after
// every mutation step. Covers the v2 regressions by name:
// - swarm/pivot: a nested field edit MOVING a row between buckets (the v2
//   BU2-gap), and a non-key field edit updating a group bucket's content
//   while never touching lengthBuckets counts;
// - crossfilter: lengthBuckets downstream of filter() under churn;
// - the v2 fixed-keyspace histogram contract: an emptied count bucket
//   persists as { value: 0 }, while group prunes.

import { test } from 'node:test'
import assert from 'node:assert'
import { Runtime } from '../kernel/runtime.ts'
import { SourceNode, DataNode } from '../kernel/node.ts'
import { filter } from './rowops.ts'
import { group, lengthBuckets } from './bucket.ts'
import { conform, assertOracle } from '../conformance/harness.ts'
import type { CommitBatch, RowDelta, RowKey } from '../contract/delta.ts'

const same = assert.deepStrictEqual

type Row = { region: string; val: number; nested?: { deep: number } }
const rows = (): Record<string, Row> => ({
  a: { region: 'north', val: 10 },
  b: { region: 'south', val: 20 },
  c: { region: 'north', val: 30 },
})
const byRegion = (r: Row) => r.region

// ── oracles (independent plain-JS recompute) ─────────────────────────────────

function groupOracle<T>(snap: Map<RowKey, T>, fn: (row: T, key: RowKey) => unknown): Map<RowKey, Record<string, T>> {
  const buckets = new Map<string, Map<string, T>>()
  for (const [k, row] of snap) {
    const bk = String(fn(row, k))
    let b = buckets.get(bk)
    if (b === undefined) buckets.set(bk, (b = new Map()))
    b.set(String(k), row)
  }
  // Canonical (sorted) property order — matches the node's deterministic
  // bucket-object shape, so the harness's JSON comparison is exact.
  const m = new Map<RowKey, Record<string, T>>()
  for (const [bk, b] of buckets) {
    const o: Record<string, T> = {}
    for (const sk of [...b.keys()].sort()) o[sk] = b.get(sk) as T
    m.set(bk, o)
  }
  return m
}

// lengthBuckets is HISTORY-dependent (zero buckets persist), so the oracle
// takes the set of bucket keys ever seen by the node and seeds them at 0.
function countsOracle<T>(
  snap: Map<RowKey, T>,
  fn: (row: T, key: RowKey) => unknown,
  everSeen: ReadonlySet<string>,
): Map<RowKey, { value: number }> {
  const m = new Map<RowKey, { value: number }>()
  for (const bk of everSeen) m.set(bk, { value: 0 })
  for (const [k, row] of snap) {
    const bk = String(fn(row, k))
    const cur = m.get(bk)
    if (cur === undefined) m.set(bk, { value: 1 })
    else m.set(bk, { value: cur.value + 1 })
  }
  return m
}

function capture<B>(node: DataNode<B>): CommitBatch<B>[] {
  const out: CommitBatch<B>[] = []
  node.connect({ wantsOrder: false, origin: null, apply: (b: CommitBatch<B>) => out.push(b) })
  return out
}

// ── group: object-born ───────────────────────────────────────────────────────

test('group: object-born — dense buckets, cross-bucket move, prune on empty, prev is the exact prior object', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  conform(src)
  const g = group(src, byRegion)
  conform(g)
  same(
    g.snapshot(),
    new Map<RowKey, Record<string, Row>>([
      ['north', { a: { region: 'north', val: 10 }, c: { region: 'north', val: 30 } }],
      ['south', { b: { region: 'south', val: 20 } }],
    ]),
  )

  const batches = capture(g)
  const prevNorth = g.snapshot().get('north')!
  src.write('b', ['region'], 'north') // south empties → pruned
  same(g.snapshot().size, 1)
  same(g.snapshot().get('north'), {
    a: { region: 'north', val: 10 },
    b: { region: 'north', val: 20 },
    c: { region: 'north', val: 30 },
  })
  same(batches.length, 1)
  const byKey = new Map(batches[0].rows.map((d) => [d.key, d]))
  same(byKey.size, 2)
  const north = byKey.get('north')!
  assert.ok(north.op === 'update')
  assert.strictEqual((north as Extract<RowDelta<any>, { op: 'update' }>).prev, prevNorth) // prev as OUR view knew it
  same((north as any).path, [])
  const south = byKey.get('south')!
  assert.ok(south.op === 'remove')
  same((south as any).prev, { b: { region: 'south', val: 20 } })

  src.remove('a')
  src.remove('b')
  src.remove('c')
  same(g.snapshot().size, 0) // all buckets pruned
  assertOracle(g, () => groupOracle(src.snapshot(), byRegion))
})

// ── lengthBuckets: object-born ───────────────────────────────────────────────

test('lengthBuckets: {value:N} wire shape, zero-bucket persistence, re-fill is an update not an add', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const lb = lengthBuckets(src, byRegion)
  conform(lb) // legality would reject a re-fill emitted as `add`
  same(
    lb.snapshot(),
    new Map<RowKey, { value: number }>([
      ['north', { value: 2 }],
      ['south', { value: 1 }],
    ]),
  )

  const batches = capture(lb)
  src.write('b', ['region'], 'north')
  same(lb.snapshot().get('south'), { value: 0 }) // v2 fixed-keyspace contract: bucket persists
  same(lb.snapshot().get('north'), { value: 3 })
  same(batches.length, 1)
  same(batches[0].rows.length, 2) // one delta per touched bucket

  src.write('b', ['region'], 'south') // back in: update {value:0}→{value:1}
  const refill = batches[batches.length - 1].rows.find((d) => d.key === 'south')!
  assert.ok(refill.op === 'update')
  same((refill as any).prev, { value: 0 })
  same((refill as any).row, { value: 1 })

  src.remove('a')
  src.remove('b')
  src.remove('c')
  same(
    lb.snapshot(),
    new Map<RowKey, { value: number }>([
      ['north', { value: 0 }],
      ['south', { value: 0 }],
    ]),
  )
})

// ── nested path updates: the v2 swarm/pivot regressions ─────────────────────

test('nested path update: key edit rebuckets both flavours; non-key edit updates the group bucket but is SILENT on lengthBuckets', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, {
    a: { region: 'x', val: 1, nested: { deep: 5 } },
    b: { region: 'x', val: 2, nested: { deep: 15 } },
  })
  const band = (r: Row) => Math.floor((r.nested ? r.nested.deep : 0) / 10)
  const g = group(src, band)
  const lb = lengthBuckets(src, band)
  conform(g)
  conform(lb)
  same(
    lb.snapshot(),
    new Map<RowKey, { value: number }>([
      ['0', { value: 1 }],
      ['1', { value: 1 }],
    ]),
  )

  const gb = capture(g)
  const lbb = capture(lb)

  // Field edit MOVES the row between buckets (v2's length(fn)/group BU2 gap —
  // a histogram over a mutating source must not freeze).
  src.write('a', ['nested', 'deep'], 17) // band 0 → 1
  same(
    lb.snapshot(),
    new Map<RowKey, { value: number }>([
      ['0', { value: 0 }],
      ['1', { value: 2 }],
    ]),
  )
  same(g.snapshot().size, 1) // group pruned band 0
  same(g.snapshot().get('1'), {
    a: { region: 'x', val: 1, nested: { deep: 17 } },
    b: { region: 'x', val: 2, nested: { deep: 15 } },
  })
  same(gb.length, 1)
  same(lbb.length, 1)

  // Non-key field edit: group forwards the bucket's new content; lengthBuckets
  // republishes NOTHING (count unchanged — the per-counter quiet contract).
  src.write('a', ['val'], 99)
  same(gb.length, 2)
  const d = gb[1].rows[0]
  assert.ok(d.op === 'update' && d.key === '1')
  same((d as any).row.a.val, 99)
  same((d as any).prev.a.val, 1) // prev is the pre-change bucket object
  same(lbb.length, 1) // no batch emitted for the count histogram

  assertOracle(g, () => groupOracle(src.snapshot(), band))
})

// ── batch() consolidation ────────────────────────────────────────────────────

test('batch(): many rows into few buckets consolidate to one delta per bucket; a bucket swap is silent on lengthBuckets', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const g = group(src, byRegion)
  const lb = lengthBuckets(src, byRegion)
  conform(g)
  conform(lb)
  const gb = capture(g)
  const lbb = capture(lb)

  rt.batch(() => {
    for (let i = 0; i < 10; i++) src.write(`e${i}`, [], { region: 'east', val: i })
    for (let i = 0; i < 2; i++) src.write(`w${i}`, [], { region: 'west', val: i })
    src.write('a', ['val'], 11) // in-bucket edit (north)
  })
  same(gb.length, 1)
  same(lbb.length, 1)
  // group: east add + west add + north update (a.val changed) = 3 bucket deltas
  same(new Set(gb[0].rows.map((d) => `${d.op}:${String(d.key)}`)), new Set(['add:east', 'add:west', 'update:north']))
  // lengthBuckets: counts — east add {10}, west add {2}; north count unchanged
  same(new Set(lbb[0].rows.map((d) => `${d.op}:${String(d.key)}`)), new Set(['add:east', 'add:west']))
  same((lbb[0].rows.find((d) => d.key === 'east') as any).row, { value: 10 })

  // Two rows SWAP buckets in one batch: counts net-unchanged → lengthBuckets
  // must emit nothing (a fresh-object update here would be a phantom).
  rt.batch(() => {
    src.write('a', ['region'], 'south')
    src.write('b', ['region'], 'north')
  })
  same(lbb.length, 1) // still just the first batch
  same(gb.length, 2) // group content DID change: two bucket updates
  same(new Set(gb[1].rows.map((d) => `${d.op}:${String(d.key)}`)), new Set(['update:north', 'update:south']))

  assertOracle(g, () => groupOracle(src.snapshot(), byRegion))
})

test('batch(): remove + re-add of a key arrives as one update and rebuckets; add + remove annihilates before reaching the buckets', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const g = group(src, byRegion)
  const lb = lengthBuckets(src, byRegion)
  conform(g)
  conform(lb)
  const gb = capture(g)

  rt.batch(() => {
    src.remove('a')
    src.write('a', [], { region: 'east', val: 7 }) // source consolidates: remove+add → update
    src.write('ghost', [], { region: 'limbo', val: 0 })
    src.remove('ghost') // add+remove annihilate — never reaches us
  })
  same(g.snapshot().get('east'), { a: { region: 'east', val: 7 } })
  same(g.snapshot().get('north'), { c: { region: 'north', val: 30 } })
  assert.ok(!g.snapshot().has('limbo'))
  assert.ok(!lb.snapshot().has('limbo')) // never created → no persisted zero
  same(lb.snapshot().get('east'), { value: 1 })
  same(lb.snapshot().get('north'), { value: 1 })
  same(gb.length, 1)
  assertOracle(g, () => groupOracle(src.snapshot(), byRegion))
})

// ── array-born sources ───────────────────────────────────────────────────────

test('array-born: minted stable keys — mid-insert, remove, path update; both flavours stay oracle-true', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, [
    { region: 'north', val: 1 },
    { region: 'south', val: 2 },
    { region: 'north', val: 3 },
  ]) // keys 0, 1, 2
  conform(src)
  const g = group(src, byRegion)
  const lb = lengthBuckets(src, byRegion)
  conform(g)
  conform(lb)
  const everSeen = new Set<string>(['north', 'south'])
  const check = () => {
    assertOracle(g, () => groupOracle(src.snapshot(), byRegion), 'group/array')
    assertOracle(lb, () => countsOracle(src.snapshot(), byRegion, everSeen), 'lengthBuckets/array')
  }

  same(g.snapshot().get('north'), { '0': { region: 'north', val: 1 }, '2': { region: 'north', val: 3 } })
  same(lb.snapshot().get('north'), { value: 2 })

  const k = src.insert({ region: 'east', val: 4 }, 1) // MID-insert: no survivor is touched
  same(k, 3)
  everSeen.add('east')
  check()
  same(lb.snapshot().get('east'), { value: 1 })

  src.remove(1) // the southern row — key 1, whatever its index now is
  check()
  same(lb.snapshot().get('south'), { value: 0 }) // persists
  same(g.snapshot().has('south'), false) // pruned

  src.write(0, ['region'], 'east') // rebucket via path update on a minted key
  check()
  same(lb.snapshot().get('east'), { value: 2 })
  same(g.snapshot().get('north'), { '2': { region: 'north', val: 3 } })

  rt.batch(() => {
    src.insert({ region: 'south', val: 9 }) // tail insert, key 4
    src.write(2, ['region'], 'south')
    src.remove(0)
  })
  check()
  same(lb.snapshot().get('south'), { value: 2 })
  same(lb.snapshot().get('north'), { value: 0 })
  same(lb.snapshot().get('east'), { value: 1 })
})

// ── composition: filter → lengthBuckets (the crossfilter histogram) ─────────

test('chain: filter → lengthBuckets — enter/leave/rebucket through the filter, zero persistence downstream', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const pred = (r: Row) => r.val >= 15
  const f = filter(src, pred)
  const hist = lengthBuckets(f, byRegion)
  conform(f)
  conform(hist)
  same(
    hist.snapshot(),
    new Map<RowKey, { value: number }>([
      ['south', { value: 1 }], // b(20)
      ['north', { value: 1 }], // c(30)
    ]),
  )

  src.write('a', ['val'], 50) // a enters the filter → north count up
  same(hist.snapshot().get('north'), { value: 2 })
  src.write('c', ['val'], 5) // c leaves the filter → north count down
  same(hist.snapshot().get('north'), { value: 1 })
  src.write('b', ['region'], 'north') // in-filter rebucket: south empties but persists
  same(hist.snapshot().get('south'), { value: 0 })
  same(hist.snapshot().get('north'), { value: 2 })
  src.remove('b')
  same(hist.snapshot().get('north'), { value: 1 })

  rt.batch(() => {
    src.write('c', ['val'], 100) // re-enters
    src.write('a', ['region'], 'south') // moves buckets inside the filter
    src.write('x', [], { region: 'west', val: 3 }) // below threshold — invisible
  })
  same(
    hist.snapshot(),
    new Map<RowKey, { value: number }>([
      ['south', { value: 1 }],
      ['north', { value: 1 }],
    ]),
  )
})

// ── seeded pseudo-random churn (LCG, no Math.random) ─────────────────────────

test('churn: 340 seeded steps over group + lengthBuckets + filter→lengthBuckets, conform + oracle at every step', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const model = new Map<RowKey, Row>(Object.entries(rows()))
  const pred = (r: Row) => r.val >= 40
  const f = filter(src, pred)
  const g = group(src, byRegion)
  const lb = lengthBuckets(src, byRegion)
  const flb = lengthBuckets(f, byRegion)
  conform(src)
  conform(f)
  conform(g)
  conform(lb)
  conform(flb)

  // History for the two count histograms: the plain model is advanced ONE
  // MUTATION AT A TIME (matching the node's sequential semantics), noting
  // every bucket a row ever occupies — including buckets created and emptied
  // inside a single batch (they must surface as persisted { value: 0 }).
  const seenAll = new Set<string>()
  const seenF = new Set<string>()
  const note = (row: Row) => {
    seenAll.add(byRegion(row))
    if (pred(row)) seenF.add(byRegion(row))
  }
  for (const r of model.values()) note(r)

  // LCG (numerical recipes constants) — deterministic, no Math.random.
  let s = 20260702
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
  const pick = <X>(xs: readonly X[]): X => xs[Math.floor(rnd() * xs.length)]
  const regions = ['north', 'south', 'east', 'west', 'centre'] as const
  let nextId = 0

  const mutateOnce = () => {
    const roll = rnd()
    const keys = [...model.keys()]
    if (roll < 0.28 || keys.length === 0) {
      // insert a fresh row
      const row: Row = { region: pick(regions), val: Math.floor(rnd() * 100) }
      const k = `k${nextId++}`
      src.write(k, [], row)
      model.set(k, row)
      note(row)
    } else if (roll < 0.48) {
      // remove a random live row
      const k = pick(keys)
      src.remove(k)
      model.delete(k)
    } else if (roll < 0.68) {
      // path update: bucket-key field (may rebucket, may no-op)
      const k = pick(keys)
      const region = pick(regions)
      src.write(k, ['region'], region)
      const next = { ...model.get(k)!, region }
      model.set(k, next)
      note(next)
    } else if (roll < 0.86) {
      // path update: non-key field (group content / filter membership churn)
      const k = pick(keys)
      const val = Math.floor(rnd() * 100)
      src.write(k, ['val'], val)
      const next = { ...model.get(k)!, val }
      model.set(k, next)
      note(next)
    } else {
      // whole-row overwrite (path [])
      const k = pick(keys)
      const row: Row = { region: pick(regions), val: Math.floor(rnd() * 100) }
      src.write(k, [], row)
      model.set(k, row)
      note(row)
    }
  }

  const filteredModel = () => {
    const m = new Map<RowKey, Row>()
    for (const [k, r] of model) if (pred(r)) m.set(k, r)
    return m
  }

  for (let step = 0; step < 340; step++) {
    if (rnd() < 0.25) {
      const n = 2 + Math.floor(rnd() * 4)
      rt.batch(() => {
        for (let i = 0; i < n; i++) mutateOnce()
      })
    } else {
      mutateOnce()
    }
    // model ≡ source (sanity for the oracle itself)
    same(src.snapshot(), model, `model desync at step ${step}`)
    assertOracle(g, () => groupOracle(model, byRegion), `group @ step ${step}`)
    assertOracle(lb, () => countsOracle(model, byRegion, seenAll), `lengthBuckets @ step ${step}`)
    assertOracle(flb, () => countsOracle(filteredModel(), byRegion, seenF), `filter→lengthBuckets @ step ${step}`)
  }
  assert.ok(model.size >= 0) // churn completed with every per-step assertion green
})

// ── mid-batch flush-on-read ──────────────────────────────────────────────────

test('SCHEDULE 2b: mid-batch snapshot() recomputes pure from the parent; no effect fires until flush', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, rows())
  const g = group(src, byRegion)
  const lb = lengthBuckets(src, byRegion)
  conform(g)
  conform(lb)
  let effects = 0
  lb.connect({ wantsOrder: false, origin: null, apply: () => effects++ })

  rt.batch(() => {
    src.write('b', ['region'], 'north')
    src.write('d', [], { region: 'west', val: 1 })
    same(g.snapshot().get('north'), {
      a: { region: 'north', val: 10 },
      b: { region: 'north', val: 20 },
      c: { region: 'north', val: 30 },
    })
    same(g.snapshot().has('south'), false) // pruned in the pure read too
    same(lb.snapshot().get('south'), { value: 0 }) // persisted zero visible mid-batch
    same(lb.snapshot().get('west'), { value: 1 })
    same(effects, 0) // no effect fires mid-batch
  })
  same(effects, 1)
  same(lb.snapshot().get('north'), { value: 3 })
})
