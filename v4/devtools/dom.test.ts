// v3/devtools/dom.test.ts — the DOM ↔ data seam (fromDOM / rowElements /
// highlight) over the render layer's domLinks/liveLists registry.
//
// Mock DOM (render/mock-dom.ts) installed before any render() call — imports
// are hoisted but render() reads globalThis.document at CALL time. Covers:
// fromDOM from the row root AND a descendant (parentNode walk-up), unlinked →
// null; rowElements mirroring a binding's recs, concatenating across two
// mounts over one view, and tracking membership; highlight saving/restoring
// EXACT prior inline outline values, skipping styleless rows, and a stale
// restore fn refusing to clobber a later highlight; a disposed mount dropping
// out of the enumerable registry.

import { test } from 'node:test'
import assert from 'node:assert'
import { installMockDom, El } from '../render/mock-dom.ts'

const dom = installMockDom() // must precede any render() call

import { $, node, render, list, el } from '../api/index.ts'
import { fromDOM, rowElements, highlight } from './dom.ts'

const same = assert.deepStrictEqual
const eq = assert.strictEqual
const ok = assert.ok

type Row = { t: string }

function mount(rows: Record<string, Row>) {
  const d = $(rows)
  const h: El = dom.document.createElement('host')
  const handle = render(h, list(d, (r: Row) => el('li', null, r.t)))
  return { d, h, handle }
}

test('fromDOM: row root or any descendant resolves { node, key }; unlinked → null', () => {
  const { d, h } = mount({ a: { t: 'A' }, b: { t: 'B' } })
  const liA = h.children[0]

  const hit = fromDOM(liA)
  ok(hit !== null)
  eq(hit!.node, d[node])
  eq(hit!.key, 'a')

  // a DESCENDANT (the text node inside the li) walks up to the same link
  const inner = fromDOM(liA.children[0])
  eq(inner!.node, d[node])
  eq(inner!.key, 'a')
  eq(fromDOM(h.children[1])!.key, 'b')

  // unlinked: the host (ABOVE the rows), a fresh element, null/undefined
  eq(fromDOM(h), null)
  eq(fromDOM(dom.document.createElement('div')), null)
  eq(fromDOM(null), null)
  eq(fromDOM(undefined), null)
})

test('rowElements: mirrors the binding recs; two mounts over ONE view concatenate; membership tracks', () => {
  const { d, h } = mount({ a: { t: 'A' }, b: { t: 'B' }, c: { t: 'C' } })

  const rows = rowElements(d)
  same(rows.map((r) => r.key).sort(), ['a', 'b', 'c'])
  for (const r of rows) ok(h.children.includes(r.el)) // the LIVE elements, not copies

  // second binding over the same view — entries concatenate (3 + 3)
  const h2: El = dom.document.createElement('host2')
  const handle2 = render(h2, list(d, (r: Row) => el('p', null, r.t)))
  eq(rowElements(d).length, 6)

  // membership tracks the view: a removed row leaves BOTH bindings
  d.get('b').remove()
  same(rowElements(d).map((r) => r.key).sort(), ['a', 'a', 'c', 'c'])

  handle2.dispose()
  same(rowElements(d).map((r) => r.key).sort(), ['a', 'c'])

  // a never-rendered view has no rows; a non-target throws via resolveNode
  eq(rowElements($({ x: { t: 'X' } })).length, 0)
  assert.throws(() => rowElements({}), /expected a data handle or DataNode/)
})

test('highlight: outlines every bound row; restore returns EXACT prior inline values, once', () => {
  const { d, h } = mount({ a: { t: 'A' }, b: { t: 'B' } })
  const liA = h.children[0] as any
  const liB = h.children[1] as any
  liA.style = { outline: 'thin dotted red', outlineOffset: '1px' } // pre-existing inline values
  liB.style = { outline: '', outlineOffset: '' }

  const restore = highlight(d)
  eq(liA.style.outline, '2px solid #e3b341')
  eq(liA.style.outlineOffset, '2px')
  eq(liB.style.outline, '2px solid #e3b341')
  eq(liB.style.outlineOffset, '2px')

  restore()
  eq(liA.style.outline, 'thin dotted red')
  eq(liA.style.outlineOffset, '1px')
  eq(liB.style.outline, '')
  eq(liB.style.outlineOffset, '')

  // restore is once-only: after a SECOND highlight, the stale restore must
  // not clobber the new outline (the overlapping-highlight lesson)
  const restore2 = highlight(d)
  restore()
  eq(liA.style.outline, '2px solid #e3b341')
  restore2()
  eq(liA.style.outline, 'thin dotted red')
  restore2() // idempotent — second call is a no-op
  eq(liA.style.outline, 'thin dotted red')
})

test('highlight: rows without an inline style object are skipped, not thrown on', () => {
  const { d } = mount({ a: { t: 'A' } }) // mock El has no .style by default
  const restore = highlight(d)
  restore() // nothing saved, nothing restored — both calls are safe no-ops
  eq(rowElements(d).length, 1)
})

test('a disposed mount drops out of the enumerable registry', () => {
  const { d, h, handle } = mount({ a: { t: 'A' } })
  eq(rowElements(d).length, 1)
  const liA = h.children[0]
  handle.dispose()
  eq(rowElements(d).length, 0)
  eq(highlight(d).call(null), undefined) // no rows → restore fn still callable
  // the WeakMap link dies WITH the element — while the detached element is
  // still referenced, fromDOM (a console bridge) keeps resolving it
  eq(fromDOM(liA)!.key, 'a')
})
