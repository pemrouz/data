// @ts-nocheck
import { test } from 'node:test'
import { strictEqual as eq } from 'node:assert'

// Deterministic render test for ARRAY-shaped lists (a sort()/az() view). node
// runs each test file in its own process, so stubbing global.document here is
// isolated from render.test.js's stub. We use a tiny fake DOM that records
// child order so we can assert the rendered list matches the data after
// insert / remove / reorder / in-place edit.
//
// Regression: a mid-list insert into an array source used to splice a node AT
// the insert position while the existing positional node kept its binding —
// both rendered data[k] (a duplicate) and the tail element lost its node
// (dropped). The DOMSink is index-keyed (content refreshes positionally, BR1
// pops the tail), so an insert must mirror that and append at the tail.
// Surfaced building the Kanban example (a sort() column with mid inserts).

class El {
  constructor(tag) {
    this.tag = tag; this.children = []; this.parentNode = null; this._text = ''
    this.isConnected = true
    this.classList = { add() {}, remove() {} }
    this.style = { setProperty() {}, removeProperty() {} }
  }
  append(...kids) { for (const k of kids) { k.parentNode = this; this.children.push(k) } }
  appendChild(k) { k.parentNode = this; this.children.push(k); return k }
  insertBefore(k, before) {
    k.parentNode = this
    if (!before) { this.children.push(k); return k }
    const i = this.children.indexOf(before)
    this.children.splice(i < 0 ? this.children.length : i, 0, k); return k
  }
  remove() {
    const p = this.parentNode
    if (p) { const i = p.children.indexOf(this); if (i >= 0) p.children.splice(i, 1) }
    this.parentNode = null
  }
  setAttribute() {} removeAttribute() {} addEventListener() {}
  set textContent(v) { this._text = v }
  get textContent() { return this._text }
  get text() { return (this.tag === '#text' ? this._text : '') + this.children.map(c => c.text).join('') }
}

global.document = {
  createElement: (t) => new El(t),
  createElementNS: (_ns, t) => new El(t),
  createTextNode: () => new El('#text'),
}

// imported after the document stub is installed
const { $, value, render, HTML } = await import('../full.ts')

test('render - array (sort) list stays consistent through insert/remove/reorder/edit', () => {
  const data = $({ a: { t: 'A', o: 0 }, b: { t: 'B', o: 1 }, c: { t: 'C', o: 2 } })
  const view = data.az('o')                 // array-shaped [A, B, C]
  const root = new El('root')
  render(root, HTML.ul(HTML.li(view, (n, r) => n.text(r.t))))

  const dom = () => root.children.map(li => li.text).join('')
  const dat = () => Object.values(view[value]).filter(Boolean).map(r => r.t).join('')
  const same = (label) => eq(dom(), dat(), `${label}: dom=[${dom()}] data=[${dat()}]`)

  same('init')
  data.insert({ t: 'M', o: 0.5 }, ['m']); same('insert mid')      // A M B C
  data.insert({ t: 'Z', o: 9 }, ['z']);   same('insert end')      // A M B C Z
  data.insert({ t: '!', o: -1 }, ['x']);  same('insert front')    // ! A M B C Z
  delete data.b;                          same('remove mid')      // ! A M C Z
  delete data.z;                          same('remove end')      // ! A M C
  data.a.o = 100;                         same('reorder to end')  // ! M C A
  data.m.t = 'm2';                        same('in-place edit')   // ! m2 C A
  eq(dom(), '!m2CA')
})
