// M3 API tests: the non-callable handle — chaining, child sugar, reserved
// names, methods-only writes, connect arities, deterministic dedup, and the
// traps that v2's callable/thenable proxy carried (killed here by design).

import { test } from 'node:test'
import assert from 'node:assert'
import { $, value, node, batch } from './index.ts'
import { conform } from '../conformance/harness.ts'

const same = assert.deepStrictEqual

type Row = { region: string; val: number; nested?: { deep: number } }
const rows = (): Record<string, Row> => ({
  a: { region: 'north', val: 10 },
  b: { region: 'south', val: 20 },
  c: { region: 'north', val: 30 },
})

test('$ + chaining: filter → za window → snapshot, conformant', () => {
  const d = $(rows())
  conform(d[node])
  const north = d.filter((r: Row) => r.region === 'north')
  conform(north[node])
  const top = north.za('val', 2)
  // ordered views materialize as ARRAYS in rank order (the v2 sort shape)
  same(top[value], [{ region: 'north', val: 30 }, { region: 'north', val: 10 }])
  d.get('b').set('region', 'north')
  d.get('b').get('val').update(99)
  same(top[value].length, 2)
  same(top[value][0].val, 99) // b entered and ranks first
})

test('child sugar: read via properties, write via methods only', () => {
  const d = $(rows())
  same(d.a[value], { region: 'north', val: 10 })
  same(d.a.val[value], 10)
  d.a.val.update(11)
  same(d.a.val[value], 11)
  d.a.set('val', 12)
  same(d.a.val[value], 12)
  assert.throws(() => {
    d.a.val = 13 // bare assignment is not the write surface
  }, /bare assignment/)
  assert.throws(() => {
    delete d.a // nor delete
  }, /delete is not/)
  d.a.remove()
  same(d.a[value], undefined)
})

test('nested writes compose; scalar aggregates read via [value]', () => {
  const d = $({ x: { region: 'north', val: 1, nested: { deep: 1 } } } as Record<string, Row>)
  d.x.nested.deep.update(7)
  same(d.x.nested.deep[value], 7)
  const s = d.sum('val')
  same(s[value], 1)
  d.x.val.update(5)
  same(s[value], 5)
})

test('reserved names are operators; get() is the total escape hatch', () => {
  const d = $({ filter: { region: 'north', val: 1 }, plain: { region: 'south', val: 2 } } as Record<string, Row>)
  // .filter is the OPERATOR (reserved), not the row named "filter"
  const f = d.filter((r: Row) => r.val > 0)
  same(typeof f.snapshot, 'function')
  // the row named "filter" is reachable via get()
  same(d.get('filter')[value], { region: 'north', val: 1 })
  d.get('filter').set('val', 42)
  same(d.get('filter').val[value], 42)
})

test('NOT thenable: a key named "then" is data; await does not snapshot', async () => {
  const d = $({ then: { region: 'north', val: 1 } } as Record<string, Row>)
  same(d.get('then')[value], { region: 'north', val: 1 })
  // the handle has no callable .then → await resolves to the handle itself
  const awaited = await Promise.resolve(d)
  same(awaited[node] !== undefined, true)
})

test('connect arities: array sink (v2 records), (anchor, fn), (obj, prop); bare fn throws', () => {
  const d = $(rows())
  const recs: any[] = []
  const h = d.connect(recs)
  same(recs[0].type, 'update')
  d.a.val.update(99)
  same(recs[1], { type: 'update', key: ['a', 'val'], value: 99 })
  h.dispose()
  d.a.val.update(100)
  same(recs.length, 2) // disposed — synchronous detach

  const seen: any[] = []
  const anchor = {}
  d.connect(anchor, (r: any) => seen.push(r))
  d.b.val.update(50)
  same(seen.length, 2) // initial snapshot record + the update

  const mirror: any = {}
  d.sum('val').connect(mirror, 'total')
  same(mirror.total, 100 + 50 + 30) // the post-dispose write still applied — dispose detaches the sink, not the data

  assert.throws(() => d.connect(() => {}), /connect\(fn\) is not a valid sink/)
})

test('dedup: value-identity args return the SAME view; closures never dedup', () => {
  const d = $(rows())
  const a = d.sum('val')
  const b = d.sum('val')
  assert.strictEqual(a, b) // deterministic — never a GC coincidence
  const f1 = d.filter((r: Row) => r.val > 0)
  const f2 = d.filter((r: Row) => r.val > 0)
  assert.notStrictEqual(f1, f2) // opaque closures: independent by design
  const g1 = d.gt('val', 15)
  const g2 = d.gt('val', 15)
  assert.strictEqual(g1, g2)
})

test('dedup: a DISPOSED cached view is evicted, not handed back', () => {
  // The pivot-v3 footgun: dispose a deduped aggregate, re-request it, and the
  // cache used to return the detached node — frozen at its pre-dispose value
  // forever. A cache hit whose node is disposed must mint fresh instead.
  const d = $({ a: { name: 'a', val: 1 } } as Record<string, { name: string; val: number }>)
  const s1 = d.sum('val')
  same(s1[value], 1)
  s1.dispose()
  const s2 = d.sum('val')
  assert.notStrictEqual(s2, s1) // fresh view, not the disposed one
  d.set('b', { name: 'b', val: 2 })
  same(s2[value], 3) // and it is LIVE
  assert.strictEqual(d.sum('val'), s2) // the fresh one dedups from here on
})

test('mirror repoint at a TALLER view re-heights descendants (no stale double-path settle)', () => {
  // library-v3 PROBE A (STATUS gap 5): a mirror over the source (h1) with a
  // downstream intersect built pre-repoint (h2) is repointed at a
  // filter→union chain (h2), bumping the mirror to h3. Without descendant
  // re-heighting the intersect keeps h2, settles BEFORE the mirror on the
  // next source write (one write reaches it along two paths), reads the
  // mirror's stale materialized view (same row reference → Object.is
  // suppresses the update), and the mirror's late batch lingers unfolded
  // until the next re-settling commit. reheight() pushes the growth through
  // descendants so the intersect follows the mirror in the agenda.
  const d = $({ a: { g: 'x', v: 1 }, b: { g: 'y', v: 2 } } as Record<string, { g: string; v: number }>)
  const fx = d.filter((r: { g: string }) => r.g === 'x')
  const fy = d.filter((r: { g: string }) => r.g === 'y')
  const u = fx.union(fy)
  const m = d.mirror() // h1, over the source
  const x = m.intersect(d) // h2, built BEFORE the repoint
  m.set(u) // u is h2 → mirror h3 → x must be re-heighted past it
  same((x[value] as any).a.v, 1)
  d.get('a').set('v', 9) // ONE write, two paths into x
  same((x[value] as any).a.v, 9) // pre-fix: stale 1 until a later re-settling commit
})

test('array sources: minted keys via sugar, insert/patch, iteration', () => {
  const d = $([10, 20, 30] as unknown as object)
  same(d[value], [10, 20, 30])
  same(d.get(1)[value], 20)
  const k = d.insert(15, 1)
  same(k, 3)
  same(d[value], [10, 15, 20, 30])
  same([...d], [10, 15, 20, 30]) // finite snapshot iterator
  // NATIVE SEMANTICS: patch/sugar/get address KEYS, not positions — key 3 is
  // the row minted by the insert (at position 1). Positional addressing is a
  // lens/compat concern (v2 profile, DOM sink), not the native surface.
  d.patch([[0, 11], [1, 21]])
  same(d[value], [11, 15, 21, 30])
  same(d.get(3)[value], 15)
})

test('batch(): one commit; effects once; read-your-writes inside', () => {
  const d = $(rows())
  let events = 0
  d.connect({}, () => events++)
  events = 0 // discard the initial snapshot record
  batch(() => {
    d.a.val.update(1)
    d.b.val.update(2)
    same(d.a.val[value], 1) // read-your-writes mid-batch
  })
  same(events, 2) // one commit → the record sink saw 2 row records
})

test('operator-view children are read-only projections', () => {
  const d = $(rows())
  const north = d.filter((r: Row) => r.region === 'north')
  same(north.a[value], { region: 'north', val: 10 })
  assert.throws(() => north.a.update({ region: 'x', val: 0 }), /derived projection/)
})

test('crossfilter chain through the API reads naturally', () => {
  const d = $(rows())
  const count = d.between('val', [15, 100]).length()
  same(count[value], 2)
  d.get('a').set('val', 50)
  same(count[value], 3)
})
