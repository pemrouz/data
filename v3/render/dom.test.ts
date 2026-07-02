// v3/render/dom.test.ts — the keyed render layer (M4, plan §3.4).
//
// Mock DOM (mock-dom.ts, the v2 list.test.ts El pattern) installed BEFORE the
// render module is exercised; every structural/text/listener DOM operation is
// counted so the tests assert MINIMAL work per delta, not just final shape.
// Covers: keyed list over an object source (add/update/remove op counts);
// ordered list over za(col, n) — orderMove is ONE insertBefore of the
// EXISTING element (object identity asserted); array-born mid-insert through
// the source order channel; filter enter/leave; per-row scope disposal
// (listeners + rtext subscriptions detach); mount dispose; mirror() repoint
// (conformance-wrapped + surgical DOM catch-up, overlap keeps elements); raf
// coalescing (flush + timer fallback).

import { test } from 'node:test'
import assert from 'node:assert'
import { installMockDom, El } from './mock-dom.ts'

const dom = installMockDom() // must precede any render() call

import { Runtime } from '../kernel/runtime.ts'
import { SourceNode } from '../kernel/node.ts'
import type { CommitBatch, RowDelta } from '../contract/delta.ts'
import { filter } from '../ops/rowops.ts'
import { za } from '../ops/ordered.ts'
import { sum } from '../ops/aggregate.ts'
import { conform } from '../conformance/harness.ts'
import { render, el, text, list, bind, mirror, raf, MirrorNode } from './index.ts'
import { handleFor } from '../api/index.ts'

const same = assert.deepStrictEqual
const eq = assert.strictEqual
const ok = assert.ok

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Row = { t: string; val?: number; on?: boolean }

function host(): El {
  return dom.document.createElement('host')
}

// rows before the trailing list anchor, as rendered text
const listText = (h: El) => h.text

test('keyed list over an object source: add / update / remove are minimal DOM ops', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { t: 'A' }, b: { t: 'B' } })
  const h = host()
  render(h, list(src, (r: Row) => el('li', null, r.t)))
  eq(listText(h), 'AB')
  eq(h.children.length, 3) // 2 rows + anchor

  // add: exactly one new row subtree (li + its text node), nothing else touched
  dom.reset()
  src.write('c', [], { t: 'C' })
  eq(listText(h), 'ABC')
  eq(dom.ops.created, 2) // li + text node
  eq(dom.ops.inserted, 2) // text into li, li into host
  eq(dom.ops.removed, 0)

  // update: ONE text write; no create/insert/remove — element identity kept
  const liA = h.children[0]
  dom.reset()
  src.write('a', ['t'], 'A2')
  eq(listText(h), 'A2BC')
  eq(dom.ops.textWrites, 1)
  eq(dom.ops.created, 0)
  eq(dom.ops.inserted, 0)
  eq(dom.ops.removed, 0)
  eq(h.children[0], liA) // same element, re-bound in place

  // remove: ONE removal, survivors untouched
  dom.reset()
  src.remove('b')
  eq(listText(h), 'A2C')
  eq(dom.ops.removed, 1)
  eq(dom.ops.created, 0)
  eq(dom.ops.inserted, 0)
})

test('ordered children AST: static + reactive text render IN ORDER (the v2 single-static-slot trap dies)', () => {
  const rt = new Runtime()
  const src = new SourceNode<{ v: number }>(rt, { m: { v: 5 } })
  const s = sum(src, 'v')
  const h = host()
  render(h, el('span', null, '# ', text(s)))
  eq(h.text, '# 5') // static BEFORE reactive — ordered children, not last-wins slots
  src.write('m', ['v'], 7)
  eq(h.text, '# 7')
})

test('rtext over a child-path $ handle: surgical text update, string-equality cut-off', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { t: 'hi' }, b: { t: 'yo' } })
  const hnd = handleFor(src)
  const h = host()
  render(h, el('div', null, text(hnd.get('a').get('t'))))
  eq(h.text, 'hi')
  dom.reset()
  src.write('a', ['t'], 'hey')
  eq(h.text, 'hey')
  eq(dom.ops.textWrites, 1)
  dom.reset()
  src.write('b', ['t'], 'other') // unrelated key — the cut-off suppresses the write
  eq(h.text, 'hey')
  eq(dom.ops.textWrites, 0)
})

test('ordered list over za(col, n): window init, orderMove = ONE insertBefore of the EXISTING element', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, {
    a: { t: 'A', val: 10 },
    b: { t: 'B', val: 20 },
    c: { t: 'C', val: 30 },
    d: { t: 'D', val: 5 },
  })
  const v = za(src, 'val', 3)
  conform(v)
  const h = host()
  render(h, list(v, (r: Row) => el('li', null, r.t)))
  eq(listText(h), 'CBA') // 30, 20, 10 — d (5) outside the window

  const liC = h.children[0]
  const liB = h.children[1]
  const liA = h.children[2]

  // in-window rank rotation: a (10 → 25) moves between c and b
  dom.reset()
  src.write('a', ['val'], 25)
  eq(listText(h), 'CAB')
  eq(dom.ops.inserted, 1) // the move IS one insertBefore
  eq(dom.ops.created, 0)
  eq(dom.ops.removed, 0)
  eq(h.children[0], liC) // identity survives the reorder —
  eq(h.children[1], liA) // the SAME elements, repositioned
  eq(h.children[2], liB)

  // window rotation: d (5 → 40) enters at rank 0, b falls out
  dom.reset()
  src.write('d', ['val'], 40)
  eq(listText(h), 'DCA')
  eq(dom.ops.created, 2) // only the entrant's subtree
  eq(dom.ops.inserted, 2)
  eq(dom.ops.removed, 1) // only the evictee
  eq(h.children[1], liC) // survivors keep their elements
  eq(h.children[2], liA)

  // update on an in-window row flows through the ordered view as a patch
  dom.reset()
  src.write('c', ['t'], 'c2')
  eq(listText(h), 'Dc2A')
  eq(dom.ops.textWrites, 1)
  eq(dom.ops.inserted, 0)
  eq(dom.ops.removed, 0)
})

test('array-born source: the order channel places a mid-insert at its position', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, [{ t: 'A' }, { t: 'B' }, { t: 'C' }])
  const h = host()
  render(h, list(src, (r: Row) => el('li', null, r.t)))
  eq(listText(h), 'ABC')

  const k = src.insert({ t: 'M' }, 1) // mid-array insert
  eq(listText(h), 'AMBC')
  ok(typeof k === 'number')

  src.remove(1) // key 1 = 'B'
  eq(listText(h), 'AMC')

  src.write(k, ['t'], 'M2') // in-place edit patches, keeps position
  eq(listText(h), 'AM2C')
})

test('filter list: enter / leave through predicate flips', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { t: 'A', on: true }, b: { t: 'B', on: false } })
  const flt = filter(src, (r) => !!r.on)
  const h = host()
  render(h, list(flt, (r: Row) => el('li', null, r.t)))
  eq(listText(h), 'A')

  src.write('b', ['on'], true) // enters
  eq(listText(h), 'AB')
  src.write('a', ['on'], false) // leaves
  eq(listText(h), 'B')
  src.write('a', ['on'], true) // re-enters (appends — unordered view)
  eq(listText(h), 'BA')
})

test('per-row scopes: listeners and rtext subscriptions detach on row removal', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { t: 'A' }, b: { t: 'B' } })
  const meta = new SourceNode<{ v: number }>(rt, { m: { v: 1 } })
  const s = sum(meta, 'v')
  const h = host()
  const onClick = () => {}
  render(h, list(src, (r: Row) => el('li', { onclick: onClick }, r.t, text(s))))
  eq(listText(h), 'A1B1')
  eq(s.effects.length, 2) // one rtext subscription per row
  eq(dom.ops.listeners - dom.ops.unlistened, 2)

  meta.write('m', ['v'], 4) // every row's binding updates
  eq(listText(h), 'A4B4')

  dom.reset()
  src.remove('a')
  eq(listText(h), 'B4')
  eq(s.effects.length, 1) // the removed row's subscription is GONE
  eq(dom.ops.unlistened, 1) // and its listener detached

  // update does NOT leak subscriptions (patch re-runs bindings, not scopes)
  src.write('b', ['t'], 'B2')
  eq(s.effects.length, 1)
  eq(listText(h), 'B24')
})

test('mount dispose tears everything down: DOM cleared, every subscription detached', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { t: 'A' }, b: { t: 'B' } })
  const meta = new SourceNode<{ v: number }>(rt, { m: { v: 1 } })
  const s = sum(meta, 'v')
  const h = host()
  const handle = render(h, el('ul', null, list(src, (r: Row) => el('li', null, r.t, text(s)))))
  eq(h.text, 'A1B1')
  eq(src.effects.length, 1)
  eq(s.effects.length, 2)

  handle.dispose()
  eq(h.children.length, 0) // top-level element removed
  eq(src.effects.length, 0) // list sink detached
  eq(s.effects.length, 0) // every row's rtext detached

  src.write('c', [], { t: 'C' }) // further writes are inert for this mount
  meta.write('m', ['v'], 9)
  eq(h.children.length, 0)
})

test('mirror(): conformance-wrapped repoint emits ONE consolidated diff (removes/adds/updates only for changed keys)', () => {
  const rt = new Runtime()
  const src = new SourceNode<{ g: string; v: number }>(rt, {
    a: { g: 'a', v: 1 },
    b: { g: 'b', v: 2 },
    c: { g: 'a', v: 3 },
  })
  const va = filter(src, (r) => r.g === 'a') // {a, c}
  const vb = filter(src, (r) => r.g === 'b') // {b}
  const vall = filter(src, (r) => r.v >= 0) // {a, b, c}
  const m = mirror<{ g: string; v: number }>(va)
  ok(m instanceof MirrorNode)
  conform(m) // legality + replay on every commit, incl. every repoint
  const batches: CommitBatch<any>[] = []
  m.connect({ wantsOrder: true, origin: null, apply: (b: CommitBatch<any>) => batches.push(b) })
  same([...m.snapshot().keys()].sort(), ['a', 'c'])

  // repoint to a DISJOINT view: removes then adds, one batch
  m.set(vb)
  eq(batches.length, 1)
  const ops1 = new Map(batches[0].rows.map((d: RowDelta<any>) => [d.key, d.op]))
  same(ops1, new Map([['a', 'remove'], ['c', 'remove'], ['b', 'add']]))
  same([...m.snapshot().keys()], ['b'])

  // repoint to an OVERLAPPING view: b is in both and shares its row reference
  // — NO delta for it (no full rebuild for overlapping keys)
  m.set(vall)
  eq(batches.length, 2)
  same(
    batches[1].rows.map((d: RowDelta<any>) => [d.key, d.op]).sort(),
    [['a', 'add'], ['c', 'add']],
  )
  same([...m.snapshot().keys()].sort(), ['a', 'b', 'c'])

  // data flows through the CURRENT parent after a repoint
  src.write('b', ['v'], 9)
  eq(batches.length, 3)
  eq(batches[2].rows[0].op, 'update')
  eq((m.snapshot().get('b') as any).v, 9)

  // a batch() mixing writes and the swap consolidates into ONE batch
  m.set(vb)
  batches.length = 0
  rt.batch(() => {
    src.write('d', [], { g: 'a', v: 4 })
    m.set(va) // → {a, c, d}
  })
  eq(batches.length, 1)
  const ops2 = new Map(batches[0].rows.map((d: RowDelta<any>) => [d.key, d.op]))
  same(ops2, new Map([['b', 'remove'], ['a', 'add'], ['c', 'add'], ['d', 'add']]))

  // no-op repoint emits nothing
  const n = batches.length
  m.set(va)
  eq(batches.length, n)

  // cycle check: a view derived from the mirror can never become its parent
  const derived = filter(m, () => true)
  assert.throws(() => m.set(derived), /cycl/)
  assert.throws(() => m.set(m), /cycl/)
})

test('mirror() through the DOM: repoint catches up surgically, overlapping keys keep their elements', () => {
  const rt = new Runtime()
  const src = new SourceNode<{ t: string; g: string }>(rt, {
    a: { t: 'A', g: 'x' },
    b: { t: 'B', g: 'y' },
    c: { t: 'C', g: 'x' },
  })
  const vx = filter(src, (r) => r.g === 'x') // {a, c}
  const vy = filter(src, (r) => r.g === 'y') // {b}
  const vall = filter(src, (r) => true) // {a, b, c}
  const m = mirror<{ t: string; g: string }>(vx)
  conform(m)
  const h = host()
  render(h, list(m, (r: any) => el('li', null, r.t)))
  eq(listText(h), 'AC')
  const liA = h.children[0]
  const liC = h.children[1]

  // widen to the superset: a and c are UNTOUCHED (same elements), b appended
  dom.reset()
  m.set(vall)
  eq(listText(h), 'ACB')
  eq(dom.ops.created, 2) // only b's subtree
  eq(dom.ops.inserted, 2)
  eq(dom.ops.removed, 0)
  eq(h.children[0], liA) // identity preserved across the swap
  eq(h.children[1], liC)
  const liB = h.children[2]

  // narrow to the disjoint view: only removals, b's element survives
  dom.reset()
  m.set(vy)
  eq(listText(h), 'B')
  eq(dom.ops.removed, 2)
  eq(dom.ops.created, 0)
  eq(dom.ops.inserted, 0)
  eq(h.children[0], liB)

  // writes through the new parent keep rendering
  src.write('b', ['t'], 'B2')
  eq(listText(h), 'B2')
})

test('mirror() between ORDERED views: the repoint order script is pure moves — identity preserved, zero create/remove', () => {
  const rt = new Runtime()
  const src = new SourceNode<{ t: string; val: number; rank: number }>(rt, {
    a: { t: 'A', val: 1, rank: 4 },
    b: { t: 'B', val: 2, rank: 3 },
    c: { t: 'C', val: 3, rank: 2 },
    d: { t: 'D', val: 4, rank: 1 },
  })
  const byVal = za(src, 'val') // [d, c, b, a] (descending val)
  const byRank = za(src, 'rank') // [a, b, c, d] (descending rank)
  const m = mirror<{ t: string; val: number; rank: number }>(byVal)
  conform(m) // legality checks the order script (desc removes → moves → asc inserts)
  const h = host()
  render(h, list(m, (r: any) => el('li', null, r.t)))
  eq(listText(h), 'DCBA')
  const els = [h.children[0], h.children[1], h.children[2], h.children[3]]

  dom.reset()
  m.set(byRank) // same membership, opposite order → pure orderMoves
  eq(listText(h), 'ABCD')
  eq(dom.ops.created, 0) // no rebuild —
  eq(dom.ops.removed, 0) // every element is REUSED,
  ok(dom.ops.inserted <= 3) // just moved (≤ n-1 insertBefores)
  eq(h.children[0], els[3]) // A is the SAME element that rendered last before
  eq(h.children[3], els[0])
  same(m.currentOrder(), ['a', 'b', 'c', 'd'])

  // and the new ordered parent keeps driving moves after the swap
  src.write('a', ['rank'], 0) // a falls to the bottom of the descending order
  eq(listText(h), 'BCDA')
  eq(h.children[3], els[3]) // still the same element
})

test('raf(): coalesces many writes into one commit per frame; flush() lands immediately', async () => {
  const rt = new Runtime()
  const src = new SourceNode<{ v: number }>(rt, { k: { v: 0 } })
  let commits = 0
  src.connect({ wantsOrder: false, origin: null, apply: () => commits++ })

  const w = raf<number>((v) => src.write('k', ['v'], v))
  w(1)
  w(2)
  w(3)
  eq(src.get('k')!.v, 0) // nothing committed yet — coalescing
  eq(commits, 0)
  w.flush()
  eq(src.get('k')!.v, 3) // ONLY the latest value, ONE commit
  eq(commits, 1)
  w.flush() // idempotent — no pending value
  eq(commits, 1)

  // the timer path (setTimeout(cb, 16) fallback outside browsers)
  w(7)
  w(8)
  eq(commits, 1)
  await sleep(40)
  eq(src.get('k')!.v, 8)
  eq(commits, 2)

  // cancel drops the pending value
  w(99)
  w.cancel()
  await sleep(40)
  eq(src.get('k')!.v, 8)
  eq(commits, 2)
})

test('raf(): accepts a $ child handle (.update target) — the v2 bounds-writer idiom', () => {
  const rt = new Runtime()
  const src = new SourceNode<{ v: number }>(rt, { k: { v: 0 } })
  const hnd = handleFor(src)
  const w = raf<number>(hnd.get('k').get('v'))
  w(41)
  w(42)
  eq(src.get('k')!.v, 0)
  w.flush()
  eq(src.get('k')!.v, 42)
})

// ── the M4.5 slice: SVG namespace, bind() props, text fn, structural rebuild ──

test('svg namespace: <svg> switches to createElementNS and children inherit; HTML siblings do not', () => {
  const h = host()
  render(h, el('div', null,
    el('svg', { viewBox: '0 0 10 10' },
      el('g', null, el('rect', { width: '4' })),
    ),
    el('span', null, 'plain'),
  ))
  const div = h.children[0]
  const svg = div.children[0]
  const g = svg.children[0]
  const rect = g.children[0]
  const span = div.children[1]
  eq(svg.ns, 'http://www.w3.org/2000/svg')
  eq(g.ns, 'http://www.w3.org/2000/svg') // inherited
  eq(rect.ns, 'http://www.w3.org/2000/svg')
  eq(svg.attrs.viewBox, '0 0 10 10') // attribute case preserved
  eq(span.ns, null) // HTML sibling untouched
})

test('bind(): reactive attribute — recompute per commit, normalized-string cutoff, remove on null', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { t: 'A', val: 10 }, b: { t: 'B', val: 10 } })
  const s = sum(src, 'val')
  const h = host()
  render(h, el('path', {
    d: bind(s, (v: number) => `M0,${v}`),
    display: bind(s, (v: number) => (v > 25 ? null : '')),
  }))
  const path = h.children[0]
  eq(path.attrs.d, 'M0,20')
  eq(path.attrs.display, '')
  dom.reset()
  src.write('a', ['val'], 15)
  eq(path.attrs.d, 'M0,25')
  eq(dom.ops.attrWrites, 1) // d changed; display recomputed to '' — cutoff, no write
  src.write('b', ['val'], 30) // sum 45 → display removes
  eq(path.attrs.d, 'M0,45')
  eq('display' in path.attrs, false)
  dom.reset()
  src.write('a', ['t'], 'AA') // sum unchanged → BOTH bindings cut off
  eq(dom.ops.attrWrites, 0)
})

test('bind() subscriptions are row-scoped: removing the row detaches its attr binding', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { t: 'A', val: 1 } })
  const s = sum(src, 'val')
  const h = host()
  render(h, list(src, (r: Row, k) => el('li', { 'data-v': bind(s, (v: number) => `${k}:${v}`) }, r.t)))
  const li = h.children[0]
  eq(li.attrs['data-v'], 'a:1')
  src.remove('a') // row leaves — its bind subscription must die with the row scope
  src.write('z', [], { t: 'Z', val: 9 }) // sum recomputes; the dead binding must not fire
  eq(li.attrs['data-v'], 'a:1') // untouched after disposal
})

test('text(view, fn): formatted reactive text', () => {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { t: 'A', val: 2 } })
  const s = sum(src, 'val')
  const h = host()
  render(h, el('span', null, text(s, (v: number) => `total: ${v}`)))
  eq(h.text, 'total: 2')
  src.write('a', ['val'], 7)
  eq(h.text, 'total: 7')
})

test('structural row rebuild: a shape-changing update rebuilds IN PLACE; shape-stable rows still patch', () => {
  const rt = new Runtime()
  type Bucket = { items: string[] }
  const src = new SourceNode<Bucket>(rt, {
    a: { items: ['x'] },
    b: { items: ['y', 'z'] },
    c: { items: ['w'] },
  })
  const h = host()
  render(h, list(src, (r: Bucket) =>
    el('div', null, ...r.items.map((s) => el('i', null, s))),
  ))
  eq(h.text, 'xyzw')
  const elA = h.children[0]
  const elB = h.children[1]

  // shape-stable update (same child count) → PATCH, identity preserved
  dom.reset()
  src.write('a', [], { items: ['X'] })
  eq(h.text, 'Xyzw')
  ok(h.children[0] === elA) // patched in place
  eq(dom.ops.removed, 0)

  // shape-CHANGING update (child count grows) → REBUILD in place
  dom.reset()
  src.write('b', [], { items: ['y', 'z', 'q'] })
  eq(h.text, 'Xyzqw') // rebuilt at the SAME list position (before c)
  ok(h.children[1] !== elB) // fresh element
  eq(h.children[1].children.length, 3)
  eq(dom.ops.removed, 1) // exactly the one replaced row element
})
