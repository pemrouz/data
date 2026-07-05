// v3/jsx/jsx.test.ts — the classic JSX transform (h / Fragment / For), M4.5b.
//
// The JSX layer is SUGAR: every structural test's ground truth is the
// equivalent el()/text()/list() record (deepStrictEqual — the builders.test.ts
// discipline), and the end-to-end cases render through the real keyed sink
// over real SourceNodes with the mock DOM's op counters.
// Covers: h ≡ el (props pass through unchanged, incl. bind() prop values);
// fragments flatten IN ORDER with static + reactive text interleaved (the v3
// kill of the v2 single-static-slot trap, asserted explicitly); function
// components (children received, arrays/fragments returned); For over a
// SourceNode — add/update/remove reflect in DOM with element identity
// preserved on update; For's error surface (each validation, exactly-one-fn
// child, the dead [vp, fn] shorthand); a bare handle child = reactive TEXT
// (no auto-iteration) updating in place; onClick wiring + dispose detach.

import { test } from 'node:test'
import assert from 'node:assert'
import { installMockDom, El } from './../render/mock-dom.ts'

const dom = installMockDom() // must precede any render() call

import { Runtime } from '../kernel/runtime.ts'
import { SourceNode } from '../kernel/node.ts'
import { sum } from '../ops/aggregate.ts'
import { render, el, text, list, bind } from '../render/index.ts'
import { h, Fragment, For } from './index.ts'
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

// ── h ≡ el: the records are identical ────────────────────────────────────────

test('h(tag, props, ...children) produces the exact el() record; props pass through unchanged', () => {
  same(h('div', null), el('div'))
  same(h('div', { class: 'x' }, 'hi'), el('div', { class: 'x' }, 'hi'))
  same(
    h('div', null, h('span', null, 'a'), 'b', 42),
    el('div', null, el('span', null, 'a'), 'b', 42),
  )
  same(h('input', { id: 'go', type: 'checkbox' }), el('input', { id: 'go', type: 'checkbox' }))
  // null/undefined/boolean children drop; nested arrays flatten (normChildren)
  same(h('div', null, null, undefined, false, true, ['a', ['b']]), el('div', null, 'a', 'b'))
  // reactive prop values pass through UNCHANGED — binding is the renderer's job
  const { s } = scalar()
  const f = (v: number) => `M0,${v}`
  same(h('path', { d: bind(s, f) }), el('path', { d: bind(s, f) }))
  same(h('span', { title: s }), el('span', { title: s })) // bare view prop, same record
})

// ── fragments ────────────────────────────────────────────────────────────────

test('fragments flatten IN ORDER: static + reactive text interleave stays ordered (the v2 single-static-slot trap is dead)', () => {
  const { src, s } = scalar()
  // record level: the fragment disappears, children land flattened in order
  same(
    h('div', null, 'x', h(Fragment, null, 'a', h('b', null)), 'y'),
    el('div', null, 'x', 'a', el('b'), 'y'),
  )
  // static BEFORE the reactive value AND static after — three ordered children.
  // In v2 this exact shape rendered "5total:  items" (last-wins static slot);
  // here a static string is just another ordered child.
  same(
    h('span', null, h(Fragment, null, 'total: ', s, ' items')),
    el('span', null, 'total: ', text(s), ' items'),
  )
  const hst = host()
  render(hst, h('span', null, h(Fragment, null, 'total: ', s, ' items')) as any)
  eq(hst.text, 'total: 5 items') // ORDER holds
  src.write('a', ['val'], 7) // sum 5 → 10
  eq(hst.text, 'total: 10 items') // reactive middle updates in place, order still holds
})

test('a fragment at the ROOT renders (render() accepts VNode[]); empty fragment is []', () => {
  const hst = host()
  const handle = render(hst, h(Fragment, null, h('i', null, 'a'), 'b') as any)
  eq(hst.text, 'ab')
  eq(hst.children.length, 2)
  handle.dispose()
  eq(hst.children.length, 0)
  same(h(Fragment, null), [])
})

// ── components ───────────────────────────────────────────────────────────────

test('function component: called with { ...props, children }, its output renders', () => {
  const Card = (p: { title: string; children: unknown[] }) =>
    h('div', { class: 'card', title: p.title }, p.children)
  // record level: the component call IS the el() record it delegates to
  same(
    h(Card as any, { title: 't' }, 'x', h('i', null, 'y')),
    el('div', { class: 'card', title: 't' }, 'x', el('i', null, 'y')),
  )
  // a component returning a FRAGMENT (VNode[]) flattens into its parent
  const Pair = () => h(Fragment, null, h('i', null, 'a'), h('i', null, 'b'))
  const hst = host()
  render(hst, h('div', null, h(Pair as any, null)) as any)
  eq(hst.text, 'ab')
  eq(hst.children[0].children.length, 2) // both <i> directly under the div
})

// ── For — the ONLY iteration form ────────────────────────────────────────────

test('For over a SourceNode via render(): add / update / remove reflect in DOM, identity preserved on update', () => {
  const rt = new Runtime()
  const src = new SourceNode<{ t: string }>(rt, { a: { t: 'A' }, b: { t: 'B' } })
  const hnd = handleFor(src)
  const hst = host()
  render(
    hst,
    h('ul', null,
      h(For as any, { each: hnd }, (r: { t: string }, k: unknown) =>
        h('li', { 'data-k': String(k) }, r.t),
      ),
    ) as any,
  )
  const ul = hst.children[0]
  eq(hst.text, 'AB')
  eq(ul.children[0].attrs['data-k'], 'a') // the row fn receives the KEY

  // add: exactly one new row subtree
  dom.reset()
  src.write('c', [], { t: 'C' })
  eq(hst.text, 'ABC')
  eq(dom.ops.created, 2) // li + its text node
  eq(dom.ops.removed, 0)

  // update: ONE text write, element identity preserved
  const liA = ul.children[0]
  dom.reset()
  src.write('a', ['t'], 'A2')
  eq(hst.text, 'A2BC')
  eq(ul.children[0], liA) // the SAME element, patched in place
  eq(dom.ops.textWrites, 1)
  eq(dom.ops.created, 0)
  eq(dom.ops.inserted, 0)
  eq(dom.ops.removed, 0)

  // remove: ONE removal, survivors untouched
  dom.reset()
  src.remove('b')
  eq(hst.text, 'A2C')
  eq(dom.ops.removed, 1)
  eq(dom.ops.created, 0)
  eq(ul.children[0], liA)
})

test('For accepts a raw DataNode as each; the For record IS list(view, fn)', () => {
  const rt = new Runtime()
  const src = new SourceNode<{ t: string }>(rt, { a: { t: 'A' } })
  const fn = (r: { t: string }) => h('li', null, r.t) as any
  same(h(For as any, { each: src }, fn), list(src, fn))
  const hst = host()
  render(hst, h(For as any, { each: src }, fn) as any) // a list at the root works
  eq(hst.text, 'A')
  src.write('b', [], { t: 'B' })
  eq(hst.text, 'AB')
})

test('For error surface: each validation, exactly-one-row-fn child, the v2 [vp, fn] shorthand is DEAD', () => {
  const rt = new Runtime()
  const src = new SourceNode<{ t: string; val?: number }>(rt, { a: { t: 'A', val: 1 } })
  const hnd = handleFor(src)
  const s = sum(src, 'val')
  const fn = (r: any) => h('li', null, r.t) as any

  assert.throws(() => h(For as any, null, fn), /each=/) // each missing
  assert.throws(() => h(For as any, { each: { not: 'a view' } }, fn), /each=/) // not a view
  assert.throws(() => h(For as any, { each: s }, fn), /COLLECTION/) // scalar node
  assert.throws(() => h(For as any, { each: handleFor(s) }, fn), /COLLECTION/) // scalar handle
  assert.throws(() => h(For as any, { each: src }), /ONE child/) // no child
  assert.throws(() => h(For as any, { each: src }, fn, fn), /ONE child/) // two children
  assert.throws(() => h(For as any, { each: src }, 'nope'), /ONE child/) // non-fn child

  // NO auto-iteration and NO [vp, fn] shorthand: a function child under a
  // string tag throws — a view child can never silently flip to iteration.
  assert.throws(() => h('div', null, hnd, fn), /unsupported child/)
})

// ── bare handle child = reactive TEXT ────────────────────────────────────────

test('a bare handle child is reactive TEXT (never iteration) and updates in place', () => {
  const { src, s } = scalar()
  const shnd = handleFor(s)
  same(h('span', null, shnd), el('span', null, text(shnd)))
  // even a COLLECTION handle child is text — iteration is ONLY <For>
  const chnd = handleFor(src)
  same(h('div', null, chnd), el('div', null, text(chnd)))

  const hst = host()
  render(hst, h('span', null, shnd) as any)
  eq(hst.text, '5')
  dom.reset()
  src.write('a', ['val'], 7) // sum 5 → 10
  eq(hst.text, '10')
  eq(dom.ops.textWrites, 1) // surgical: one text write, no rebuild
  eq(dom.ops.created, 0)
  dom.reset()
  src.write('a', ['t'], 'AA') // sum unchanged → string-equality cutoff
  eq(dom.ops.textWrites, 0)
})

// ── events ───────────────────────────────────────────────────────────────────

test('events wire: onClick attaches a listener, fires via the mock handlers list, detaches on dispose', () => {
  let clicks = 0
  const onClick = () => clicks++
  const hst = host()
  const handle = render(hst, h('button', { onClick }, 'go') as any)
  const btn = hst.children[0]
  eq(btn.handlers.length, 1)
  eq(btn.handlers[0].type, 'click') // on* → lowercase event name
  ;(btn.handlers[0].fn as () => void)()
  eq(clicks, 1)
  handle.dispose()
  eq(btn.handlers.length, 0) // removeEventListener ran with the mount scope
  ok(dom.ops.unlistened >= 1)
})
