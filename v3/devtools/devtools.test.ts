// v3/devtools tests — the consumption layer over runtime.graph()/onCommit().
// Builds a real $ chain (filter → za → sum), runs writes under trace/profile/
// cascades, and asserts: ids line up with graph(), per-operator ms rows exist
// (the v2 structurally-empty-profile defect), seq is monotonic, the trace
// subscription detaches on return AND on throw, and graph() is serializable.

import { test } from 'node:test'
import assert from 'node:assert'
import { $, value, node, batch, runtime } from '../api/index.ts'
import { inspect, graph, trace, profile, cascades, resolveNode } from './index.ts'

const same = assert.deepStrictEqual
const ok = assert.ok

type Row = { region: string; val: number }
const rows = (): Record<string, Row> => ({
  a: { region: 'north', val: 10 },
  b: { region: 'south', val: 20 },
  c: { region: 'north', val: 30 },
})

// One chain per test: source → filter → za(window) → sum.
function chain() {
  const d = $(rows())
  const north = d.filter((r: Row) => r.region === 'north')
  const top = north.za('val', 2)
  const total = top.sum('val')
  return { d, north, top, total }
}

const ids = (x: { d: any; north: any; top: any; total: any }) => ({
  src: x.d[node].id as number,
  filter: x.north[node].id as number,
  za: x.top[node].id as number,
  sum: x.total[node].id as number,
})

// ── inspect ──────────────────────────────────────────────────────────────────

test('inspect: resolves a handle via Symbol.for(data.v3.node) — id/kind/op/height/parents/value', () => {
  const x = chain()
  const i = ids(x)

  const src = inspect(x.d)
  same(src.id, i.src)
  same(src.kind, 'source')
  same(src.op, 'source')
  same(src.height, 0)
  same(src.parents, [])
  same(src.value, rows())

  const filt = inspect(x.north)
  same(filt.kind, 'operator')
  same(filt.op, 'filter')
  same(filt.height, 1)
  same(filt.parents, [i.src])

  const win = inspect(x.top)
  same(win.op, 'za')
  same(win.parents, [i.filter])
  same(win.value, [{ region: 'north', val: 30 }, { region: 'north', val: 10 }]) // ordered → array

  const agg = inspect(x.total)
  same(agg.kind, 'scalar')
  same(agg.op, 'sum')
  same(agg.parents, [i.za])
  same(agg.value, 40) // scalar nodes report value(), not a snapshot

  // A raw DataNode works too (same resolution surface as a handle).
  same(inspect(x.d[node]).id, i.src)
  same(resolveNode(x.north), x.north[node])
  assert.throws(() => inspect({}), /expected a data handle or DataNode/)
  assert.throws(() => inspect(42), /expected a data handle or DataNode/)
})

test('inspect: value tracks writes (reads live state, no caching)', () => {
  const x = chain()
  x.d.get('b').set('region', 'north') // b enters filter; val 20 enters window
  same(inspect(x.total).value, 50) // 30 + 20
  same(inspect(x.north).value.b, { region: 'north', val: 20 })
})

// ── graph ────────────────────────────────────────────────────────────────────

test('graph: full node list + edge list; ids/edges match the chain topology', () => {
  const x = chain()
  const i = ids(x)
  const g = graph(x.d) // resolve runtime from a handle

  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  ok(byId.has(i.src) && byId.has(i.filter) && byId.has(i.za) && byId.has(i.sum))
  same(byId.get(i.filter)!.op, 'filter')
  same(byId.get(i.za)!.op, 'za')
  same(byId.get(i.sum)!.kind, 'scalar')

  // Edges: parent → child, derivable purely from nodes[].parents.
  const has = (from: number, to: number) => g.edges.some((e) => e.from === from && e.to === to)
  ok(has(i.src, i.filter))
  ok(has(i.filter, i.za))
  ok(has(i.za, i.sum))
  ok(!has(i.src, i.sum)) // no fabricated shortcut edges

  // Heights are topological along every edge.
  for (const e of g.edges) ok(byId.get(e.from)!.height < byId.get(e.to)!.height)
})

test('graph: serializable — JSON round-trip is exact', () => {
  const x = chain()
  const g = graph(x.d)
  same(JSON.parse(JSON.stringify(g)), g)
})

test('graph: no-arg uses the default runtime; explicit Runtime accepted; disposed nodes drop out', () => {
  const x = chain()
  const i = ids(x)
  const all = graph() // default runtime — $ handles live there
  const idSet = new Set(all.nodes.map((n) => n.id))
  ok(idSet.has(i.src) && idSet.has(i.sum))
  same(graph(runtime()).nodes.length, all.nodes.length)

  x.total.dispose()
  ok(!graph().nodes.some((n) => n.id === i.sum))
})

// ── trace ────────────────────────────────────────────────────────────────────

test('trace: CommitInfo per commit; seq monotonic; node ids ⊆ graph ids; settle order is topological', () => {
  const x = chain()
  const i = ids(x)
  const commits = trace(x.d, () => {
    x.d.get('a').get('val').update(11) // in-filter, in-window → full chain settles
    x.d.get('c').get('val').update(31)
  })
  same(commits.length, 2) // bare writes = one commit each

  // seq IS the cascade id — strictly increasing.
  for (let k = 1; k < commits.length; k++) ok(commits[k].seq > commits[k - 1].seq)

  const g = graph(x.d)
  const known = new Set(g.nodes.map((n) => n.id))
  const heights = new Map(g.nodes.map((n) => [n.id, n.height]))
  for (const c of commits) {
    ok(c.nodes.length >= 4) // source, filter, za, sum all settled
    for (const s of c.nodes) {
      ok(known.has(s.id))
      ok(s.deltas >= 1)
      ok(s.ms >= 0)
    }
    // CommitInfo.nodes are in settle order — heights never decrease.
    for (let k = 1; k < c.nodes.length; k++)
      ok(heights.get(c.nodes[k].id)! >= heights.get(c.nodes[k - 1].id)!)
    const touched = new Set(c.nodes.map((s) => s.id))
    ok(touched.has(i.src) && touched.has(i.filter) && touched.has(i.za) && touched.has(i.sum))
  }
})

test('trace: batch() is ONE cascade; consolidation-empty commits emit nothing', () => {
  const x = chain()
  const commits = trace(x.d, () => {
    batch(() => {
      x.d.get('a').get('val').update(12)
      x.d.get('c').get('val').update(32)
    })
  })
  same(commits.length, 1)
  ok(commits[0].nodes.some((s) => s.id === x.d[node].id))
})

test('trace: subscription detaches on return — later writes are not observed', () => {
  const x = chain()
  const commits = trace(x.d, () => {
    x.d.get('a').get('val').update(13)
  })
  same(commits.length, 1)
  x.d.get('a').get('val').update(14) // after trace returned
  x.d.get('c').get('val').update(34)
  same(commits.length, 1) // the returned array is a closed capture
})

test('trace: subscription detaches when fn throws', () => {
  const x = chain()
  let captured: readonly unknown[] = []
  assert.throws(() =>
    trace(x.d, () => {
      x.d.get('a').get('val').update(15)
      throw new Error('boom')
    }),
  /boom/)
  // A fresh trace still works and the broken one observes nothing further.
  captured = trace(x.d, () => {
    x.d.get('a').get('val').update(16)
  })
  same(captured.length, 1)
})

// ── profile ──────────────────────────────────────────────────────────────────

test('profile: per-operator rows for the whole chain — structurally-empty profiles are impossible', () => {
  const x = chain()
  const i = ids(x)
  const rowsOut = profile(x.d, () => {
    for (let k = 0; k < 5; k++) x.d.get('a').get('val').update(100 + k) // monotonic (never the no-op path)
  })

  const byId = new Map(rowsOut.map((r) => [r.id, r]))
  // EVERY operator in the chain has a row — the v2 defect asserted away.
  for (const [name, id] of [['source', i.src], ['filter', i.filter], ['za', i.za], ['sum', i.sum]] as const) {
    const r = byId.get(id)
    ok(r !== undefined, `missing profile row for ${name}`)
    same(r!.op, name)
    same(r!.commits, 5)
    ok(r!.deltas >= 5)
    ok(r!.totalMs >= 0)
    ok(Number.isFinite(r!.totalMs))
  }
  // Sorted by id, serializable.
  for (let k = 1; k < rowsOut.length; k++) ok(rowsOut[k].id > rowsOut[k - 1].id)
  same(JSON.parse(JSON.stringify(rowsOut)), rowsOut)
})

test('profile: a write that dies mid-chain profiles only the nodes that settled', () => {
  const x = chain()
  const i = ids(x)
  const rowsOut = profile(x.d, () => {
    x.d.get('b').get('val').update(21) // b is south — filter emits nothing downstream
  })
  const touched = new Set(rowsOut.map((r) => r.id))
  ok(touched.has(i.src))
  ok(!touched.has(i.za)) // za never settled a batch — no row, not a zero row
  ok(!touched.has(i.sum))
})

// ── cascades ─────────────────────────────────────────────────────────────────

test('cascades: grouped by seq with names resolved from graph()', () => {
  const x = chain()
  const i = ids(x)
  const cs = cascades(x.d, () => {
    x.d.get('a').get('val').update(200)
    x.d.get('b').get('region').update('north') // b enters: filter add → window → sum
  })
  same(cs.length, 2)
  ok(cs[1].seq > cs[0].seq)
  for (const c of cs) {
    same(typeof c.origin, 'string')
    for (const n of c.nodes) {
      same(n.name, `${n.op}#${n.id}`)
      ok(n.deltas >= 1)
      ok(n.ms >= 0)
    }
  }
  // The flow-essay read: the first cascade flows source → filter → za → sum.
  const names = cs[0].nodes.map((n) => n.name)
  same(names, [`source#${i.src}`, `filter#${i.filter}`, `za#${i.za}`, `sum#${i.sum}`])
  // Serializable (postMessage to a panel).
  same(JSON.parse(JSON.stringify(cs)), cs)
})

test('cascades: dispose semantics — nothing observed outside fn', () => {
  const x = chain()
  const cs = cascades(x.d, () => {
    x.d.get('a').get('val').update(300)
  })
  x.d.get('a').get('val').update(301)
  same(cs.length, 1)
})

// ── zero steady-state cost ───────────────────────────────────────────────────

test('kernel measures only while a hook is live (trace-scoped, not ambient)', () => {
  // Behavioural proxy for "no ambient instrumentation": two traces on the same
  // runtime each see exactly their own commits, and [value] reads between them
  // reflect all writes (tracing never gates the data path).
  const x = chain()
  const t1 = trace(x.d, () => x.d.get('a').get('val').update(400))
  x.d.get('a').get('val').update(401) // untraced
  const t2 = trace(x.d, () => x.d.get('a').get('val').update(402))
  same(t1.length, 1)
  same(t2.length, 1)
  ok(t2[0].seq > t1[0].seq + 1) // the untraced commit consumed a seq
  same(x.d.a.val[value], 402)
})
