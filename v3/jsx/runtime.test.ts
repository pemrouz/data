// v3/jsx/runtime.test.ts — the AUTOMATIC JSX runtime (jsx / jsxs / jsxDEV),
// M4.5b.
//
// The automatic runtime is the classic transform in a different calling
// convention — children arrive inside props.children — so the ground truth
// throughout is RECORD PARITY: every jsx()/jsxs() case is deepStrictEqual'd
// against the equivalent h() call AND the raw el()/text()/list() record (the
// jsx.test.ts discipline), and the end-to-end cases render through the real
// keyed sink over real SourceNodes with the mock DOM's op counters.
// Covers: jsx/jsxs ≡ h ≡ el for elements (props incl. bind() values pass
// through; single / array / nested children; drop + flatten rules); component
// parity (children arrive through h's ONE normComponentChildren path — static
// strings normalize identically classic vs automatic); For via the automatic
// shape jsx(For, { each, children: rowFn }) — add/update/remove reflect in
// DOM with element identity preserved; Fragment (the SAME instance as the
// classic export) flattening static + reactive text IN ORDER; the JSX key
// accepted and IGNORED (identical records, no 'key' prop leak, none reaches a
// component); jsxDEV ≡ jsx with all dev args ignored.

import { test } from 'node:test'
import assert from 'node:assert'
import { installMockDom, El } from './../render/mock-dom.ts'

const dom = installMockDom() // must precede any render() call

import { Runtime } from '../kernel/runtime.ts'
import { SourceNode } from '../kernel/node.ts'
import { sum } from '../ops/aggregate.ts'
import { render, el, text, list, bind } from '../render/index.ts'
import { h, Fragment as ClassicFragment, For } from './index.ts'
import { jsx, jsxs, jsxDEV, Fragment } from './runtime.ts'
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

// ── jsx/jsxs ≡ h ≡ el: identical element records ─────────────────────────────

test('jsx/jsxs produce the exact h()/el() records; props (incl. bind() values) pass through unchanged', () => {
  // no children, empty props → the classic h('div', null) record (props null)
  same(jsx('div', {}), h('div', null))
  same(jsx('div', {}), el('div'))
  // single child (the jsx shape: children is a bare value)
  same(jsx('div', { class: 'x', children: 'hi' }), h('div', { class: 'x' }, 'hi'))
  same(jsx('div', { class: 'x', children: 'hi' }), el('div', { class: 'x' }, 'hi'))
  // array children (the jsxs shape) + nesting
  same(
    jsxs('div', { children: [jsx('span', { children: 'a' }), 'b', 42] }),
    h('div', null, h('span', null, 'a'), 'b', 42),
  )
  same(
    jsxs('div', { children: [jsx('span', { children: 'a' }), 'b', 42] }),
    el('div', null, el('span', null, 'a'), 'b', 42),
  )
  same(jsx('input', { id: 'go', type: 'checkbox' }), el('input', { id: 'go', type: 'checkbox' }))
  // null/undefined/boolean children drop; nested arrays flatten (normChildren)
  same(
    jsxs('div', { children: [null, undefined, false, true, ['a', ['b']]] }),
    el('div', null, 'a', 'b'),
  )
  // reactive prop values pass through UNCHANGED — binding is the renderer's job
  const { s } = scalar()
  const f = (v: number) => `M0,${v}`
  same(jsx('path', { d: bind(s, f) }), el('path', { d: bind(s, f) }))
  same(jsx('span', { title: s }), h('span', { title: s })) // bare view prop, same record
})

// ── components ───────────────────────────────────────────────────────────────

test('component parity: jsx and h produce IDENTICAL deferred component records', () => {
  const Card = (p: { title: string; children: unknown[] }) =>
    h('div', { class: 'card', title: p.title }, p.children)
  const auto: any = jsxs(Card as any, { title: 't', children: ['x', jsx('i', { children: 'y' })] })
  same(auto, h(Card as any, { title: 't' }, 'x', h('i', null, 'y')))
  // the record is a DEFERRED component — fn untouched, children normalized
  eq(auto.kind, 'component')
  eq(auto.fn, Card)
  same(auto.props.children, [{ kind: 'text', s: 'x' }, el('i', null, 'y')])
  // a single (non-array) props.children arrives as the one child — same record
  same(jsx(Card as any, { title: 't', children: 'x' }), h(Card as any, { title: 't' }, 'x'))
  // a component with NO children gets children: [] (h's no-args default)
  same((jsx(Card as any, { title: 't' }) as any).props.children, [])
  // and at MOUNT the fn is invoked with those props and its output renders
  const hst = host()
  render(hst, auto)
  eq(hst.children[0].attrs['class'], 'card')
  eq(hst.children[0].attrs['title'], 't')
  eq(hst.text, 'xy')
})

test('static-string component children produce IDENTICAL records classic vs automatic (one normComponentChildren path)', () => {
  const Wrap = (p: { children: unknown[] }) => h('p', null, p.children)
  const auto: any = jsx(Wrap as any, { children: 'hello' })
  same(auto, h(Wrap as any, null, 'hello'))
  // the string is normalized BEFORE the component sees it — a text RECORD,
  // not a raw string, in the deferred record's props, on both routes
  same(auto.props.children, [{ kind: 'text', s: 'hello' }])
  // a children-echoing component mounts those normalized records
  const hst = host()
  render(hst, auto)
  eq(hst.children[0].tag, 'p')
  eq(hst.text, 'hello')
})

// ── For — the automatic shape ────────────────────────────────────────────────

test('For via jsx(For, { each, children: rowFn }): the record IS list(view, fn); add/update/remove via the DOM, identity preserved', () => {
  const rt = new Runtime()
  const src = new SourceNode<{ t: string }>(rt, { a: { t: 'A' }, b: { t: 'B' } })
  const hnd = handleFor(src)
  const rowFn = (r: { t: string }, k: unknown) =>
    jsx('li', { 'data-k': String(k), children: r.t }) as any
  // record level: the automatic For call IS list(view, fn)
  same(jsx(For as any, { each: src, children: rowFn }), list(src, rowFn))

  const hst = host()
  render(hst, jsx('ul', { children: jsx(For as any, { each: hnd, children: rowFn }) }) as any)
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

// ── fragments ────────────────────────────────────────────────────────────────

test('Fragment via jsx is the SAME instance as classic and flattens IN ORDER with static + reactive text interleaved', () => {
  eq(Fragment, ClassicFragment) // one instance — the transforms interoperate

  const { src, s } = scalar()
  // record level: the fragment disappears, children land flattened in order
  same(
    jsxs('div', { children: ['x', jsxs(Fragment as any, { children: ['a', jsx('b', {})] }), 'y'] }),
    el('div', null, 'x', 'a', el('b'), 'y'),
  )
  // static BEFORE the reactive value AND static after — three ordered children,
  // ≡ both the classic transform and the raw record
  same(
    jsx('span', { children: jsxs(Fragment as any, { children: ['total: ', s, ' items'] }) }),
    h('span', null, h(Fragment as any, null, 'total: ', s, ' items')),
  )
  same(
    jsx('span', { children: jsxs(Fragment as any, { children: ['total: ', s, ' items'] }) }),
    el('span', null, 'total: ', text(s), ' items'),
  )
  const hst = host()
  render(
    hst,
    jsx('span', { children: jsxs(Fragment as any, { children: ['total: ', s, ' items'] }) }) as any,
  )
  eq(hst.text, 'total: 5 items') // ORDER holds
  src.write('a', ['val'], 7) // sum 5 → 10
  eq(hst.text, 'total: 10 items') // reactive middle updates in place, order still holds
  // empty fragment via the automatic shape is []
  same(jsx(Fragment as any, {}), [])
})

// ── key: accepted and IGNORED ────────────────────────────────────────────────

test('key is ignored: identical records with/without, and no key prop leaks into the el record or a component', () => {
  same(jsx('div', { class: 'x', children: 'hi' }, 'k1'), jsx('div', { class: 'x', children: 'hi' }))
  same(jsx('div', { class: 'x', children: 'hi' }, 'k1'), el('div', { class: 'x' }, 'hi'))
  // no props left after children → props stays null even with a key
  eq((jsx('li', { children: 't' }, 42) as any).props, null)
  // and a nonempty props record never grows a 'key' entry
  ok(!('key' in ((jsx('div', { id: 'a', children: 'x' }, 'k') as any).props as object)))
  // component form: key does not reach the component's props either — on the
  // automatic route (separate arg, dropped) AND the classic route (stripped
  // from the props object before the deferred record is minted)
  const Probe = (_p: any) => el('b')
  const auto: any = jsx(Probe as any, { title: 't', children: 'c' }, 'k')
  same(Object.keys(auto.props).sort(), ['children', 'title'])
  const classic: any = h(Probe as any, { title: 't', key: 'k' }, 'c')
  same(Object.keys(classic.props).sort(), ['children', 'title'])
})

// ── jsxDEV ───────────────────────────────────────────────────────────────────

test('jsxDEV ≡ jsx: key / isStaticChildren / source / self are all ignored', () => {
  const { s } = scalar()
  same(
    jsxDEV(
      'div',
      { class: 'x', children: ['a', s] },
      'k',
      true,
      { fileName: 'x.tsx', lineNumber: 1, columnNumber: 1 },
      undefined,
    ),
    jsx('div', { class: 'x', children: ['a', s] }),
  )
  same(jsxDEV('div', { children: 'a' }, undefined, false), el('div', null, 'a'))
  const Pair = () => jsxs(Fragment as any, { children: [jsx('i', { children: 'a' }), 'b'] })
  same(jsxDEV(Pair as any, {}, 'k', false), jsx(Pair as any, {}))
})
