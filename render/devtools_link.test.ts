// @ts-nocheck
// Locks in the __ripple_sink back-reference set in Node.render. $.fromDOM(el)
// in the devtools layer relies on this property existing on every DOM element
// that's been bound to a reactive view.
import { spec } from '../tests/spec.ts'
import { ok, strictEqual } from 'node:assert'
import { $, view } from '../core.ts'
import { render, HTML } from './index.ts'

function recordingDom() {
  let nextId = 0
  function make(tag) {
    return {
      _id: nextId++,
      tagName: tag,
      isConnected: true,
      classList: { add() {}, remove() {} },
      style: { setProperty() {}, removeProperty() {} },
      setAttribute() {}, removeAttribute() {},
      append() {}, insertBefore() {}, appendChild() {}, addEventListener() {},
      remove() {},
      get textContent() { return '' }, set textContent(_) {},
    }
  }
  globalThis.document = {
    createElement(t) { return make(t) },
    createElementNS(_, t) { return make(t) },
    createTextNode() { return make('#text') },
  }
}

// render() walks template.children looking for nodes with .data; for each it
// attaches a DOMSink to the parent (the dom passed into render). Outer-template
// data on the rendered template itself is invisible to render() — the data
// must live on a child. So tests use the canonical HTML.ul(HTML.li(data, fn))
// shape from the todo example.

spec({ op:'render', guarantee:'Identity', trigger:'construct', via:['__ripple_sink'], asserts:'a data-bound element carries a back-reference to its sink and view' }, () => {
  recordingDom()
  const items = $({})
  const root = document.createElement('div')
  render(root, HTML.ul(HTML.li(items, () => HTML.span())))
  ok(root.__ripple_sink, '__ripple_sink should be defined on the sink-bound element')
  strictEqual(root.__ripple_sink, root.sink)
  strictEqual(root.__ripple_sink.p, items[view])
})

spec({ op:'render', guarantee:'Robustness', trigger:'construct', via:['__ripple_sink'], asserts:'the back-reference is non-enumerable and configurable so it neither leaks nor blocks a re-render' }, () => {
  recordingDom()
  const items = $({})
  const root = document.createElement('div')
  render(root, HTML.ul(HTML.li(items, () => HTML.span())))
  const desc = Object.getOwnPropertyDescriptor(root, '__ripple_sink')
  ok(desc, '__ripple_sink descriptor should exist')
  ok(!desc.enumerable, '__ripple_sink should be non-enumerable (no leak via JSON.stringify or for-in)')
  ok(desc.configurable, '__ripple_sink should be configurable so a re-render can replace it')
})

spec({ op:'render', guarantee:'Identity', trigger:'construct', via:['__ripple_sink'], asserts:'a static-only element gets no back-reference' }, () => {
  recordingDom()
  const root = document.createElement('div')
  render(root, HTML.div('static text only'))
  ok(!('__ripple_sink' in root), 'static-only elements should not get __ripple_sink')
})
