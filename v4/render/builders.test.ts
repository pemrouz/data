// v3/render/builders.test.ts — the HTML.*/SVG.* builder DSL (M4.5b).
//
// The DSL is SUGAR: every test's ground truth is the equivalent el()/text()
// record (deepStrictEqual), and the end-to-end cases render through the real
// keyed sink over real SourceNodes with the mock DOM's op counters.
// Covers: record equivalence with el(); dot class/id/attr sugar incl.
// chaining + builder immutability; props-object vs first-child
// discrimination (plain object / VNode / $ handle / DataNode / bind());
// normChildren (flatten, drop, reactive coercion, the unsupported-child
// throw); an end-to-end render with a reactive attr + reactive text; the
// reactive-class dot merge; keyed list rows built with builders; and an SVG
// subtree via HTML.div(SVG.svg(...)) with namespace inheritance.

import { test } from 'node:test'
import assert from 'node:assert'
import { installMockDom, El } from './mock-dom.ts'

const dom = installMockDom() // must precede any render() call

import { Runtime } from '../kernel/runtime.ts'
import { SourceNode } from '../kernel/node.ts'
import { sum } from '../ops/aggregate.ts'
import { render, el, text, list, bind } from './index.ts'
import { HTML, SVG, normChildren } from './builders.ts'
import { handleFor } from '../api/index.ts'

const same = assert.deepStrictEqual
const eq = assert.strictEqual
const ok = assert.ok

type Row = { t: string; val: number }

function host(): El {
  return dom.document.createElement('host')
}

function scalar() {
  const rt = new Runtime()
  const src = new SourceNode<Row>(rt, { a: { t: 'A', val: 2 }, b: { t: 'B', val: 3 } })
  return { rt, src, s: sum(src, 'val') } // s starts at 5
}

// ── record equivalence: the builder output IS the el() record ────────────────

test('builder output deep-equals the equivalent el() calls', () => {
  same(HTML.div(), el('div'))
  same(HTML.div('hi', 42), el('div', null, 'hi', 42))
  same(
    HTML.ul(HTML.li('a'), HTML.li('b')),
    el('ul', null, el('li', null, 'a'), el('li', null, 'b')),
  )
  same(HTML.a({ href: 'x', target: '_blank' }, 'go'), el('a', { href: 'x', target: '_blank' }, 'go'))
  // null/undefined/boolean children drop, exactly as el() drops them
  same(HTML.div(null, undefined, false, true, 'x'), el('div', null, 'x'))
  // nested arrays flatten (el() itself does not take arrays — the DSL does)
  same(
    HTML.div(['a', ['b', HTML.span('c')]]),
    el('div', null, 'a', 'b', el('span', null, 'c')),
  )
  // SVG builders emit PLAIN el records — same kind, no marker
  same(SVG.path({ d: 'M0,0' }), el('path', { d: 'M0,0' }))
})

// ── dot sugar ────────────────────────────────────────────────────────────────

test('dot sugar: class, chained classes, #id, attr=value (split on FIRST =)', () => {
  same(HTML.div.chart(), el('div', { class: 'chart' }))
  same(HTML.div.chart.active(), el('div', { class: 'chart active' }))
  same(HTML.div['#charts'](), el('div', { id: 'charts' }))
  same(HTML.a['href=https://x']('go'), el('a', { href: 'https://x' }, 'go'))
  same(HTML.i['data-x=a=b'](), el('i', { 'data-x': 'a=b' })) // FIRST '=' splits, the rest is value
  same(
    HTML.div.chart['#main'].wide(),
    el('div', { class: 'chart wide', id: 'main' }),
  )
})

test('dot/props merge: explicit class APPENDS, explicit id and attrs OVERRIDE', () => {
  same(HTML.div.chart({ class: 'active' }), el('div', { class: 'chart active' }))
  same(HTML.div['#a']({ id: 'b' }), el('div', { id: 'b' }))
  same(HTML.a['href=x']({ href: 'y' }, 'go'), el('a', { href: 'y' }, 'go'))
  // class from props alone (no dot classes) passes straight through
  same(HTML.div({ class: 'solo' }), el('div', { class: 'solo' }))
  // a null/false class prop leaves the dot classes standing
  same(HTML.div.chart({ class: null }), el('div', { class: 'chart' }))
})

test('builders are immutable values: reuse and chaining never leak state', () => {
  const card = HTML.div.card
  const active = card.active
  same(card(), el('div', { class: 'card' })) // base unaffected by the derivation
  same(active(), el('div', { class: 'card active' }))
  same(active(), el('div', { class: 'card active' })) // second use — no accumulation
  same(card(), el('div', { class: 'card' })) // and the base is STILL clean
  same(card['#x'](), el('div', { class: 'card', id: 'x' }))
  same(card(), el('div', { class: 'card' })) // id derivation didn't stick either
})

// ── first-arg discrimination ─────────────────────────────────────────────────

test('first arg: plain object = props; VNode / $ handle / DataNode / bind() = child', () => {
  const { s } = scalar()
  const hnd = handleFor(s) // scalar $ handle — probing .kind on it would THROW
  // plain object → props, even with children after it
  same(HTML.div({ title: 't' }, 'x'), el('div', { title: 't' }, 'x'))
  // VNode first arg → child
  same(HTML.div(el('span', null, 'x')), el('div', null, el('span', null, 'x')))
  // $ handle first arg → reactive text child
  same(HTML.span(hnd), el('span', null, text(hnd)))
  // raw scalar DataNode first arg → reactive text child
  same(HTML.span(s), el('span', null, text(s)))
  // bind() first arg → FORMATTED reactive text child, not props
  const f = (v: number) => `#${v}`
  same(HTML.span(bind(s, f)), el('span', null, text(s, f)))
  // number first arg → static text child
  same(HTML.span(0), el('span', null, 0))
})

// ── normChildren (exported for the JSX layer) ────────────────────────────────

test('normChildren: flatten, drop, and coerce reactive children', () => {
  const { s } = scalar()
  const hnd = handleFor(s)
  const f = (v: number) => `#${v}`
  same(
    normChildren(['a', 1, null, undefined, true, false, [el('b'), ['c']], hnd, s, bind(s, f)]),
    [
      { kind: 'text', s: 'a' },
      { kind: 'text', s: '1' },
      el('b'),
      { kind: 'text', s: 'c' },
      text(hnd),
      text(s),
      text(s, f),
    ],
  )
  same(normChildren([]), [])
  // an unrecognized object child is an ERROR, not a silent drop
  assert.throws(() => normChildren([{ foo: 1 }]), /unsupported child/)
})

// ── end-to-end through render() ──────────────────────────────────────────────

test('end-to-end: a builder tree renders; reactive attr + reactive text update surgically', () => {
  const { src, s } = scalar()
  const h = host()
  render(h, HTML.div.card(
    HTML.span('total: ', s), // static + reactive text, IN ORDER
    HTML.i({ 'data-w': bind(s, (v: number) => `w${v}`) }),
  ))
  const card = h.children[0]
  eq(card.attrs.class, 'card')
  eq(h.text, 'total: 5')
  eq(card.children[1].attrs['data-w'], 'w5')

  dom.reset()
  src.write('a', ['val'], 7) // sum 5 → 10
  eq(h.text, 'total: 10')
  eq(card.children[1].attrs['data-w'], 'w10')
  eq(dom.ops.textWrites, 1) // ONE text write
  eq(dom.ops.attrWrites, 1) // ONE attr write
  eq(dom.ops.created, 0) // no rebuilds — identity preserved
  eq(dom.ops.removed, 0)

  dom.reset()
  src.write('a', ['t'], 'AA') // sum unchanged → both cutoffs suppress
  eq(dom.ops.textWrites, 0)
  eq(dom.ops.attrWrites, 0)
})

test('dot class merges with a REACTIVE class prop (composes through bind)', () => {
  const { src, s } = scalar()
  const h = host()
  render(h, HTML.div.chart({ class: bind(s, (v: number) => `n${v}`) }))
  eq(h.children[0].attrs.class, 'chart n5')
  src.write('a', ['val'], 7)
  eq(h.children[0].attrs.class, 'chart n10')
})

test('keyed list with builder rows: add / patch / remove behave exactly as el() rows', () => {
  const rt = new Runtime()
  const src = new SourceNode<{ t: string }>(rt, { a: { t: 'A' }, b: { t: 'B' } })
  const h = host()
  render(h, HTML.ul(list(src, (r: { t: string }) => HTML.li.row(r.t))))
  const ul = h.children[0]
  eq(h.text, 'AB')
  eq(ul.children[0].attrs.class, 'row')

  const liA = ul.children[0]
  dom.reset()
  src.write('a', ['t'], 'A2') // patch in place — identity kept
  eq(h.text, 'A2B')
  eq(ul.children[0], liA)
  eq(dom.ops.textWrites, 1)
  eq(dom.ops.created, 0)

  dom.reset()
  src.write('c', [], { t: 'C' })
  eq(h.text, 'A2BC')
  eq(dom.ops.created, 2) // only the new row's subtree

  dom.reset()
  src.remove('b')
  eq(h.text, 'A2C')
  eq(dom.ops.removed, 1)
})

test('SVG subtree via HTML.div(SVG.svg(...)): namespace inheritance, reactive attr inside', () => {
  const { src, s } = scalar()
  const h = host()
  render(h, HTML.div(
    SVG.svg({ viewBox: '0 0 10 10' },
      SVG.g(SVG.rect({ width: '4' })),
      SVG.path({ d: bind(s, (v: number) => `M0,${v}`) }),
    ),
    HTML.span('plain'),
  ))
  const div = h.children[0]
  const svg = div.children[0]
  const g = svg.children[0]
  const rect = g.children[0]
  const path = svg.children[1]
  const span = div.children[1]
  const NS = 'http://www.w3.org/2000/svg'
  eq(svg.ns, NS)
  eq(g.ns, NS) // inherited through the subtree
  eq(rect.ns, NS)
  eq(path.ns, NS)
  eq(svg.attrs.viewBox, '0 0 10 10') // attribute case preserved
  eq(span.ns, null) // the HTML sibling is untouched
  eq(path.attrs.d, 'M0,5')
  src.write('a', ['val'], 7)
  eq(path.attrs.d, 'M0,10') // reactive attr works through the SVG builder
  ok(rect.attrs.width === '4')
})

test('underscore → hyphen (v2 parity): dot classes and tag names', () => {
  const n = HTML.input.new_todo({ placeholder: 'x' })
  assert.deepStrictEqual(n, el('input', { class: 'new-todo', placeholder: 'x' }))
  const custom = HTML.my_widget('hi')
  assert.strictEqual(custom.tag, 'my-widget')
})
