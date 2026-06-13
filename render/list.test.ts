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

test('render - object sparse producer renders no phantom row for an excluded key (C4 object-half)', () => {
  // A between/intersect/union/except over an OBJECT source marks an excluded
  // key with EXPLICIT `undefined` (not delete) when a row leaves via a bound
  // move. If a DOMSink connects to such a view AFTER a row has left (the
  // render-after-brush shape), its initial XU0 for-in walks the `undefined`
  // slot and used to mint a phantom <li> bound to undefined (a NaN/empty row).
  // The object-sink guard skips explicit-undefined slots — create_node is
  // index-keyed for objects (`nodes[k]` bound to `data[k]`), so skipping a hole
  // can't misalign survivors (unlike the tail-relative ARRAY path).
  const data = $({ a: { v: 10 }, b: { v: 50 }, c: { v: 90 } })
  const bound = $([40, 60])
  const view = data.between('v', bound)        // in range: {b:{v:50}}
  bound[value] = [40, 45]                       // b leaves -> view.value.b = undefined (explicit hole)
  const root = new El('root')
  render(root, HTML.ul(HTML.li(view, (n, r) => n.text(r.v))))
  eq(root.children.length, 0, `expected no rows, got [${root.children.map(li => li.text).join(',')}]`)

  bound[value] = [40, 60]                       // b re-enters -> BI0 -> exactly one real row
  eq(root.children.length, 1)
  eq(root.children[0].text, '50')
})

test('render - array sparse producer (between) renders only in-range rows in index order, no phantom holes (C4 array-half)', () => {
  // A between over an ARRAY source bound straight to a row template. Excluded
  // slots are holes (empty at construction, explicit-undefined after a bound
  // move); the array length is stable and survivors keep their index. The DOM
  // must show exactly the present (in-range) rows in index order — no phantom
  // <li> for a hole, no drifted binding, no wrong row removed when a bound
  // moves. Driven by BF0 (hole fill) / BH1 (hole remove) on the DOMSink, plus
  // an index-keyed sparse XU0 build.
  const data = $([{ v: 10 }, { v: 50 }, { v: 90 }, { v: 55 }, { v: 30 }])
  const bound = $([40, 60])
  const view = data.between('v', bound)         // in range: idx 1 (50), idx 3 (55)
  const root = new El('root')
  render(root, HTML.ul(HTML.li(view, (n, r) => n.text(r.v))))
  const dom = () => root.children.map(li => li.text).join(',')
  const dat = () => view[value].filter(x => x !== undefined).map(r => r.v).join(',')
  const same = (label) => eq(dom(), dat(), `${label}: dom=[${dom()}] data=[${dat()}]`)

  same('init'); eq(dom(), '50,55')
  bound[value] = [0, 100];  same('widen-all'); eq(dom(), '10,50,90,55,30')   // holes 0,2,4 fill in order
  bound[value] = [20, 35];  same('narrow');    eq(dom(), '30')               // 0,1,2,3 hole out; 4 stays
  bound[value] = [40, 60];  same('re-widen');  eq(dom(), '50,55')            // 1,3 fill, 4 holes out
})

test('render - intersect/union/except over an ARRAY bound to the DOM track an incremental bound move (C4 array-half, all sparse producers)', () => {
  // The C4 array-half fix wired DOMSink's index-keyed sparse path, but only
  // `between` emitted BH1/BF0 at first — intersect/union/except emitted plain
  // BR1/BI0 which core routes to the splice-shift BR1A/BI0A, corrupting the
  // index-keyed `nodes` (wrong rows + phantom trailing <li>). Now all three
  // emit BH1/BF0 over arrays, so a sparse producer of any kind composes with a
  // row template bound straight to the DOM — init AND incremental update.
  const mk = () => $([{ v: 10 }, { v: 50 }, { v: 90 }, { v: 55 }, { v: 30 }])
  const mount = (viewOf) => {
    const src = mk()
    const ctl = viewOf(src)            // returns { view, move }
    const root = new El('root')
    render(root, HTML.ul(HTML.li(ctl.view, (n, r) => n.text(r.v))))
    const dom = () => root.children.map(li => li.text).join(',')
    const dat = () => ctl.view[value].filter(x => x !== undefined).map(r => r.v).join(',')
    return { dom, dat, move: ctl.move }
  }

  // intersect: rows in [0,100] AND [40,60] -> {50,55}; widen the second to all
  {
    let bound
    const t = mount((src) => {
      bound = $([40, 60])
      return { view: src.between('v', $([0, 100])).intersect(src.between('v', bound)) }
    })
    eq(t.dom(), t.dat(), `intersect init: [${t.dom()}] vs [${t.dat()}]`); eq(t.dom(), '50,55')
    bound[value] = [0, 100]
    eq(t.dom(), t.dat(), `intersect update: [${t.dom()}] vs [${t.dat()}]`); eq(t.dom(), '10,50,90,55,30')
  }
  // union: rows in [40,60] OR [80,100] -> {50,90,55}; move second band to [0,20]
  {
    let bound
    const t = mount((src) => {
      bound = $([80, 100])
      return { view: src.between('v', $([40, 60])).union(src.between('v', bound)) }
    })
    eq(t.dom(), t.dat(), `union init: [${t.dom()}] vs [${t.dat()}]`); eq(t.dom(), '50,90,55')
    bound[value] = [0, 20]   // 10 enters
    eq(t.dom(), t.dat(), `union update: [${t.dom()}] vs [${t.dat()}]`); eq(t.dom(), '10,50,55')
  }
  // except: rows NOT in [0,60] -> {90}; narrow exclusion to [0,40] so 50,55 re-enter
  {
    let ex
    const t = mount((src) => {
      ex = $([0, 60])
      return { view: src.except(src.between('v', ex)) }
    })
    eq(t.dom(), t.dat(), `except init: [${t.dom()}] vs [${t.dat()}]`); eq(t.dom(), '90')
    ex[value] = [0, 40]   // 50,55 leave exclusion -> enter output
    eq(t.dom(), t.dat(), `except update: [${t.dom()}] vs [${t.dat()}]`); eq(t.dom(), '50,90,55')
  }
})

// Regression (H1 / #36,#37,#39): DOMSink teardown mishandled three node shapes.
// (#36) a list source going undefined/primitive reset this.nodes to {} BEFORE
// remove_node read it -> undefined.remove() crash. (#37) a scalar VP is stored
// under the NODE symbol, which for-in never enumerates, so the old node wasn't
// removed and every update appended a duplicate. (#39) clearing a sparse-bound
// list after a tail-hole popped the hole (undefined.remove()). One _teardownAll
// that walks holey arrays / object keys / the NODE slot fixes all three.
test('render - list source -> undefined tears down cleanly and restores', () => {
  const root = document.createElement('div')
  const data = $({ a: { t: 'A' }, b: { t: 'B' } })
  render(root, HTML.ul(HTML.li(data, (n, r) => n.text(r?.t))))
  eq(root.children.length, 2)
  data[value] = undefined
  eq(root.children.length, 0)            // was a TypeError mid-cascade
  data[value] = { c: { t: 'C' } }
  eq(root.children.length, 1)            // restores, no leftover/duplicate
})

test('render - scalar VP binding does not duplicate its element on update', () => {
  const root = document.createElement('div')
  const n = $(1)
  render(root, HTML.div(HTML.span(n)))
  n[value] = 2
  n[value] = 3
  eq(root.children.length, 1)            // one span, not three (NODE-slot teardown)
  eq(root.text, '3')
})

test('render - clearing a sparse-bound list after a tail hole does not crash', () => {
  const root = document.createElement('div')
  const d = $([{ v: 50 }, { v: 90 }])
  const ext = $([40, 100])
  render(root, HTML.ul(HTML.li(d.between('v', ext), (n, r) => n.text(r?.v))))
  ext[value] = [40, 60]                  // 90 leaves -> trailing hole in nodes
  delete d[value]                        // clear -> must not pop the hole
  eq(root.children.length, 0)
})

// Regression (H2 / #40): Node.generate shallow-copied row children
// (this.children.concat([])), so every row shared the SAME Prop instances. A
// reactive prop on the row TEMPLATE (outside the row fn) connected a PropSink
// per row that all mutated the one Prop, whose `parent` ended up the LAST row —
// so a reactive class update landed on one row, not all. generate now clones
// each Prop/Node child.
test('render - reactive prop on the row template applies to every row', () => {
  const root = document.createElement('div')
  const items = $({ a: { t: 'A' }, b: { t: 'B' }, c: { t: 'C' } })
  const flag = $(false)
  render(root, HTML.ul(HTML.li.class('hot', flag)(items, (n, r) => n.text(r.t))))
  const seen = root.children.map((li) => {
    const set = new Set()
    li.classList = { add: (c) => set.add(c), remove: (c) => set.delete(c) }
    li._cls = set
    return set
  })
  flag[value] = true
  eq(seen.every((s) => s.has('hot')), true) // all rows, not just the last
})

// Regression (H3 / #41): the documented list pattern must render. The template
// root is a wrapper whose data-bound children render into the parent; a row is
// `HTML.ul(HTML.li(items, rowFn))`. (The old docs put data on the wrapper —
// `HTML.ul(items, fn)` — which renders nothing; corrected in the JSDoc/README.)
test('render - documented list pattern renders rows and updates on insert', () => {
  const root = document.createElement('div')
  const items = $([{ name: 'a' }, { name: 'b' }])
  render(root, HTML.ul(HTML.li(items, (li, item) => li.text(item.name))))
  eq(root.children.length, 2)
  eq(root.text, 'ab')
  items.insert({ name: 'c' })
  eq(root.children.length, 3)
  eq(root.text, 'abc')
})

// Regression (H4 / #38): a dense XU0 re-snapshot over a previously-SPARSE
// (holey) nodes array took the tail-relative dense build, binding node-j to
// data[j] against the holey array — dropping rows (a between widened so every
// row is in range gave "35" for [3,4,5]). All array XU0 now reconciles
// index-keyed via _reconcile_sparse.
test('render - sparse-bound list re-snapshotting dense keeps every row', () => {
  const root = document.createElement('div')
  const data = $([{ v: 3 }, { v: 1 }, { v: 4 }])
  const ext = $([3, 5])
  render(root, HTML.ul(HTML.li(data.between('v', ext), (n, r) => n.text(r?.v))))
  eq(root.text, '34')                      // sparse: v:1 out of range
  data[value] = [{ v: 3 }, { v: 4 }, { v: 5 }] // all in range -> dense re-snapshot
  eq(root.text, '345')                     // was "35" (v:4 dropped)
  eq(root.children.length, 3)
})

// Regression (H5 / #35): with two+ data-bound siblings under one parent,
// Node.render overwrote `dom.sink` per child, so only the LAST sink kept a
// strong ref — earlier sinks (held only by WeakRef in their view) could be
// GC'd and silently stop rendering structural changes. `dom.sinks` now retains
// all of them.
test('render - multiple data-bound siblings all keep rendering', () => {
  const root = document.createElement('div')
  const a = $({ x: { t: 'a1' } })
  const b = $({ y: { t: 'b1' } })
  render(root, HTML.div(HTML.li(a, (n, r) => n.text(r.t)), HTML.em(b, (n, r) => n.text(r.t))))
  eq(root.sinks.length, 2)               // both retained
  a.z = { t: 'a2' }                       // first list's insert still renders
  eq(root.children.filter((c) => c.tag === 'li').length, 2)
  b.w = { t: 'b2' }
  eq(root.children.filter((c) => c.tag === 'em').length, 2)
})
