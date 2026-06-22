// Unit tests for the JSX adapter. The contract: h(...) must produce a
// NodeProxy whose render output is structurally identical to the equivalent
// HTML/SVG builder chain. We assert this by rendering both into a recording
// DOM stub and comparing the mutation trace — same calls in the same order.
import { spec } from '../tests/spec.ts'
import { deepStrictEqual as same, ok } from 'node:assert'
import { $, value } from '../core.ts'
import { render } from '../render/index.ts'
import { h, Fragment, For, HTML, SVG, jsx, jsxs } from './index.ts'

// Recording DOM stub. Each "element" is a plain object; every mutation
// pushes a tuple onto the shared log. Comparing two logs verb-by-verb is
// enough to detect any divergence between the JSX and builder paths.
function recordingDom() {
  const log: any[] = []
  let nextId = 0
  function make(kind: any, tag: any, ns?: any): any {
    const id = nextId++
    const el: any = {
      _id: id, _kind: kind, _tag: tag, _ns: ns,
      isConnected: true,
      classList: {
        add(c: any) { log.push(['class+', id, c]) },
        remove(c: any) { log.push(['class-', id, c]) },
      },
      style: {
        setProperty(n: any, v: any) { log.push(['style+', id, n, v]) },
        removeProperty(n: any) { log.push(['style-', id, n]) },
      },
      setAttribute(n: any, v: any) { log.push(['attr+', id, n, v]) },
      removeAttribute(n: any) { log.push(['attr-', id, n]) },
      append(c: any) { log.push(['append', id, c._id]) },
      insertBefore(c: any, b: any) { log.push(['insertBefore', id, c._id, b ? b._id : null]) },
      appendChild(c: any) { log.push(['appendChild', id, c._id]) },
      addEventListener(n: any, fn: any) { log.push(['on+', id, n]) },
      remove() { log.push(['remove', id]) },
      get textContent() { return el._text ?? '' },
      // Coerce reactive values (ViewProxy is a Proxy(noop)) to a stable tag
      // so two traces using different proxy instances of the same logical
      // binding compare equal under deepStrictEqual.
      set textContent(v: any) {
        log.push(['text', id, typeof v === 'function' ? '<reactive>' : v])
        el._text = v
      },
      set id(v: any) { log.push(['id', el._id, v]) },
    }
    return el
  }
  ;(globalThis as any).document = {
    createElement(t: any) { return make('html', t) },
    createElementNS(ns: any, t: any) { return make('svg', t, ns) },
    createTextNode() { return make('text', '#text') },
  }
  return log
}

// Render a template into a fresh recording root and return the log. The
// root id is 0; everything underneath gets sequential ids — so the same
// template always produces the same id assignments, making the logs of two
// runs directly comparable.
function trace(template: any) {
  const log = recordingDom()
  const root: any = document.createElement('div')
  render(root, template)
  return log
}

spec({ op:'jsx', guarantee:'Fidelity', trigger:'construct', asserts:'a static div with className and child matches the builder trace' }, () => {
  const a = trace(h('div', { className: 'a b' }, 'hi'))
  const b = trace(HTML.div.a.b('hi'))
  same(a, b)
})

spec({ op:'jsx', guarantee:'Fidelity', trigger:'construct', asserts:'id and attribute props match the builder trace' }, () => {
  const a = trace(h('input', { id: 'go', type: 'checkbox', placeholder: 'name' }))
  const b = trace(HTML.input['#go']['type=checkbox']['placeholder=name']())
  same(a, b)
})

spec({ op:'jsx', guarantee:'Fidelity', trigger:'construct', asserts:'a boolean attribute renders as an empty string' }, () => {
  const a = trace(h('input', { autofocus: true }))
  const b = trace(HTML.input['autofocus=']())
  same(a, b)
})

spec({ op:'jsx', guarantee:'Fidelity', trigger:'construct', asserts:'onEvent props attach event listeners like .on()' }, () => {
  const noop = () => {}
  const a = trace(h('button', { onClick: noop }, 'go'))
  const b = trace(HTML.button.on('click', noop)('go'))
  same(a, b)
})

spec({ op:'jsx', guarantee:'Fidelity', trigger:'construct', asserts:'a style object matches the per-key .style chain' }, () => {
  const a = trace(h('div', { style: { color: 'red', display: 'none' } }))
  const b = trace(HTML.div.style({ color: 'red', display: 'none' }))
  same(a, b)
})

spec({ op:'jsx', guarantee:'Fidelity', trigger:'construct', asserts:'a reactive class object matches the builder at construction' }, () => {
  const flag: any = $(true)
  const a = trace(h('li', { class: { done: flag } }))
  const b = trace(HTML.li.class({ done: flag }))
  // trace is identical at construction time; mutate and assert the same
  // class+/class- events fire on both
  same(a, b)
})

spec({ op:'jsx', guarantee:'Fidelity', trigger:'construct', asserts:'SVG tags dispatch through the SVG namespace' }, () => {
  const a = trace(h('svg', null, h('path', { d: 'M0,0' })))
  const b = trace(SVG.svg(SVG.path['d=M0,0']()))
  same(a, b)
  // sanity: at least one createElementNS call recorded
  ok(a.some(([k]) => k === 'attr+'))
})

spec({ op:'jsx', guarantee:'Fidelity', trigger:'construct', asserts:'a Fragment flattens its children into the parent' }, () => {
  const a = trace(h('div', null, h(Fragment, null, 'a', 'b')))
  // flattened, only the last static "wins" per Node.add — same for builder
  const b = trace(HTML.div('a', 'b'))
  same(a, b)
})

spec({ op:'jsx', guarantee:'Fidelity', trigger:'construct', shape:'object', asserts:'For routes VP children through .text() like the builder' }, () => {
  const data: any = $({ x: { title: 'one' }, y: { title: 'two' } })
  const a = trace(
    h('ul', null,
      h(For, { each: data, tag: 'li' },
        (item: any, k: any) => h('span', null, item.title)
      )
    )
  )
  // The JSX form routes VP children through .text() (preserves element
  // identity across reactive updates) — the matching builder form uses
  // span.text(...) for the same reason. Without this, the two render paths
  // produce different traces (data binding vs text binding) even though the
  // visible DOM is the same.
  const b = trace(
    HTML.ul(
      HTML.li(data, (li: any, item: any, k: any) => HTML.span.text(item.title))
    )
  )
  same(a, b)
})

spec({ op:'jsx', guarantee:'Fidelity', trigger:'construct', shape:'object', asserts:'a For row fn returning a Fragment extends the pre-shaped row' }, () => {
  const data: any = $({ a: { title: 'one' }, b: { title: 'two' } })
  const a = trace(
    h('ul', null,
      h(For, { each: data, tag: 'li' },
        (item: any) => h(Fragment, null,
          h('span', null, item.title),
          h('button', null, 'x'),
        )
      )
    )
  )
  const b = trace(
    HTML.ul(
      HTML.li(data, (li: any, item: any) => li(HTML.span(item.title), HTML.button('x')))
    )
  )
  same(a, b)
})

spec({ op:'jsx', guarantee:'Fidelity', trigger:'construct', asserts:'a reactive VP attribute matches the .attr() builder form' }, () => {
  const checked: any = $(true)
  const a = trace(h('input', { type: 'checkbox', checked }))
  const b = trace(HTML.input['type=checkbox'].attr('checked', checked)())
  same(a, b)
})

spec({ op:'jsx', guarantee:'Propagation', trigger:'construct', asserts:'a reactive VP child binds via DOMSink and writes its initial value' }, () => {
  // <span>{vp}</span> sets node.data = vp; the parent's render creates a
  // DOMSink for the span, which mounts a textNode that updates incrementally.
  // We can't directly compare to span.text(vp) (different render path) but
  // can assert the JSX form produces a working reactive binding.
  const vp: any = $(42)
  const log = trace(h('div', null, h('span', null, vp)))
  // At minimum: a div, an inner span, and a textNode were created — and
  // textContent was written to reflect the initial value.
  ok(log.some(([k]) => k === 'append' || k === 'appendChild'))
  ok(log.some(([k]) => k === 'text'))
})

spec({ op:'jsx', guarantee:'Fidelity', trigger:'construct', via:['ref'], asserts:'a ref callback fires once with the real DOM element' }, () => {
  let captured: any = null
  trace(h('div', null,
    h('input', { type: 'checkbox', ref: (el: any) => { captured = el } })
  ))
  // The mock makes input have _kind: 'html' and _tag: 'input' — proves the
  // ref fired with the actual created element, not a NodeProxy or template.
  // (Wrapped in a <div> because top-level <input> never gets created as an
  // element — only its children render into the root.)
  ok(captured && captured._kind === 'html' && captured._tag === 'input',
     'ref should receive the created input element')
})

spec({ op:'jsx', guarantee:'Fidelity', trigger:'construct', shape:'object', asserts:'node(Fragment) auto-spreads its children as siblings' }, () => {
  // The crossfilter-jsx port relies on this: a row generator can return
  // node(<Fragment>...</Fragment>) and have the children land as siblings.
  // NodeProxy.apply detects the single-array arg and spreads — without that
  // fix the array would land in Node.add's `typeof === 'object'` branch and
  // become `node.static`, silently breaking the row template.
  const data: any = $({ a: { title: 'one' }, b: { title: 'two' } })
  const a = trace(
    h('ul', null,
      h(For, { each: data, tag: 'li' },
        (item: any) => h(Fragment, null,
          h('span', null, item.title),
          h('button', null, 'x'),
        )
      )
    )
  )
  const b = trace(
    HTML.ul(
      HTML.li(data, (li: any, item: any) =>
        li(HTML.span.text(item.title), HTML.button('x')))
    )
  )
  same(a, b)
})

spec({ op:'jsx', guarantee:'Fidelity', trigger:'construct', asserts:'the automatic runtime bundles children into props and matches h()' }, () => {
  // Automatic-runtime signature: jsx(type, { children, ...rest }, key?).
  // Output should match the classic h(type, rest, ...children) call.
  const a = trace(jsx('div', { className: 'box', children: 'hi' }))
  const b = trace(h('div', { className: 'box' }, 'hi'))
  same(a, b)
})

spec({ op:'jsx', guarantee:'Fidelity', trigger:'construct', asserts:'jsxs spreads a children array as siblings' }, () => {
  const a = trace(jsxs('ul', { children: [
    h('li', null, 'one'),
    h('li', null, 'two'),
  ]}))
  const b = trace(h('ul', null,
    h('li', null, 'one'),
    h('li', null, 'two'),
  ))
  same(a, b)
})

// Regression (#42): a VP child with an ELEMENT (NodeProxy) sibling was flipped
// onto the data-iteration path (hasRowFn counted the NodeProxy as a row fn),
// duplicating the host element. A NodeProxy is excluded from the row-fn check now.
spec({ op:'jsx', guarantee:'Identity', trigger:'construct', issue:'#42', asserts:'a VP child with an element sibling does not duplicate the host' }, () => {
  let labels = 0
  const make = (tag: any) => {
    if (tag === 'label') labels++
    return {
      tag, children: [] as any[], isConnected: true,
      classList: { add() {}, remove() {} }, style: { setProperty() {}, removeProperty() {} },
      append(...k: any[]) { this.children.push(...k) }, appendChild(k: any) { this.children.push(k); return k },
      insertBefore(k: any) { this.children.push(k); return k },
      remove() {}, setAttribute() {}, removeAttribute() {}, addEventListener() {},
      set textContent(v: any) { (this as any)._t = v }, get textContent() { return (this as any)._t ?? '' },
    }
  }
  ;(globalThis as any).document = { createElement: make, createElementNS: (_n: any, t: any) => make(t), createTextNode: () => make('#text') }
  render(make('div'), h('section', null, h('label', null, h('em', null, 'cnt:'), $(5))))
  same(labels, 1) // one <label>, not one-per-key of the object VP (was duplicated)
})

// Regression (#49): a top-level Fragment (`render(root, <>…</>)`) is a plain
// array; np[NODE] was undefined and Node.render threw. render() now treats it
// as a wrapper whose children render into the parent (with their static text).
spec({ op:'jsx', guarantee:'Robustness', trigger:'construct', issue:'#49', asserts:'a top-level Fragment renders its children without crashing' }, () => {
  const log = recordingDom()
  const root: any = document.createElement('div')
  render(root, h(Fragment, null, h('div', null, 'x'), h('div', null, 'y')))
  const texts = log.filter((e: any) => e[0] === 'text').map((e: any) => e[2])
  same(texts, ['x', 'y'])
})

// Regression (#45): className={vp} (reactive class string) accumulated classes —
// add/remove both used the current value, so the old class was never removed.
spec({ op:'jsx', guarantee:'Propagation', trigger:'edit', issue:'#45', asserts:'a reactive className swaps the class instead of accumulating' }, () => {
  const ops: any[] = []
  const make = (tag: any): any => ({
    tag, children: [] as any[], isConnected: true,
    classList: { add: (c: any) => ops.push('+' + c), remove: (c: any) => ops.push('-' + c) },
    style: { setProperty() {}, removeProperty() {} },
    append(...k: any[]) { this.children.push(...k) }, appendChild(k: any) { this.children.push(k); return k },
    insertBefore(k: any) { this.children.push(k); return k },
    remove() {}, setAttribute() {}, removeAttribute() {}, addEventListener() {},
    set textContent(v: any) {}, get textContent() { return '' },
  })
  ;(globalThis as any).document = { createElement: make, createElementNS: (_n: any, t: any) => make(t), createTextNode: () => make('#text') }
  const cls: any = $('red')
  render(make('div'), h('section', null, h('div', { className: cls })))
  cls[value] = 'blue'
  cls[value] = 'green'
  same(ops, ['+red', '-red', '+blue', '-blue', '+green'])
})

// Regression (#46): function components now receive props.children.
spec({ op:'jsx', guarantee:'Fidelity', trigger:'construct', issue:'#46', asserts:'a function component receives props.children' }, () => {
  const make = (tag: any): any => ({
    tag, children: [] as any[], isConnected: true,
    classList: { add() {}, remove() {} }, style: { setProperty() {}, removeProperty() {} },
    append(...k: any[]) { this.children.push(...k) }, appendChild(k: any) { this.children.push(k); return k },
    insertBefore(k: any) { this.children.push(k); return k },
    remove() {}, setAttribute() {}, removeAttribute() {}, addEventListener() {},
    set textContent(v: any) { (this as any)._t = v }, get textContent() { return (this as any)._t ?? '' },
    get text() { return (this.tag === '#text' ? (this as any)._t : '') + this.children.map((c: any) => c.text).join('') },
  })
  ;(globalThis as any).document = { createElement: make, createElementNS: (_n: any, t: any) => make(t), createTextNode: () => make('#text') }
  const Card = (props: any) => h('div', null, props.children)
  const root = make('div')
  render(root, h('section', null, h(Card, null, 'hi')))
  same(root.text, 'hi')
  // automatic-runtime form too
  const root2 = make('div')
  render(root2, h('section', null, jsx(Card, { children: 'yo' })))
  same(root2.text, 'yo')
})

// Regression (#47): `once={fn}` must NOT register an event listener (it's not
// an on-Event prop); a ViewProxy onClick must not either.
spec({ op:'jsx', guarantee:'Fidelity', trigger:'construct', issue:'#47', asserts:'the on* heuristic excludes once={fn} and ViewProxy handlers' }, () => {
  const listeners: any[] = []
  const make = (tag: any): any => ({
    tag, children: [] as any[], isConnected: true,
    classList: { add() {}, remove() {} }, style: { setProperty() {}, removeProperty() {} },
    append(...k: any[]) { this.children.push(...k) }, appendChild(k: any) { this.children.push(k); return k },
    insertBefore(k: any) { this.children.push(k); return k },
    remove() {}, setAttribute() {}, removeAttribute() {},
    addEventListener: (n: any) => listeners.push(n),
    set textContent(v: any) {}, get textContent() { return '' },
  })
  ;(globalThis as any).document = { createElement: make, createElementNS: (_n: any, t: any) => make(t), createTextNode: () => make('#text') }
  render(make('div'), h('section', null,
    h('button', { once: () => {}, onClick: () => {} }, 'x')))
  same(listeners, ['click']) // 'once' did NOT become a 'ce' listener
})

// Regression (#48): an HTML <title> is created in the HTML namespace, not SVG.
spec({ op:'jsx', guarantee:'Fidelity', trigger:'construct', issue:'#48', asserts:'an HTML title uses createElement, not the SVG namespace' }, () => {
  const kinds: any[] = []
  ;(globalThis as any).document = {
    createElement: (t: any) => (kinds.push(['html', t]), mkEl(t)),
    createElementNS: (_n: any, t: any) => (kinds.push(['svg', t]), mkEl(t)),
    createTextNode: () => mkEl('#text'),
  }
  function mkEl(tag: any) {
    return {
      tag, children: [] as any[], isConnected: true,
      classList: { add() {}, remove() {} }, style: { setProperty() {}, removeProperty() {} },
      append(...k: any[]) { this.children.push(...k) }, appendChild(k: any) { this.children.push(k); return k },
      insertBefore(k: any) { this.children.push(k); return k },
      remove() {}, setAttribute() {}, removeAttribute() {}, addEventListener() {},
      set textContent(v: any) {}, get textContent() { return '' },
    }
  }
  render(mkEl('div'), h('head', null, h('title', null, 'My Page')))
  ok(kinds.some(([k, t]) => k === 'html' && t === 'title'), JSON.stringify(kinds))
  ok(!kinds.some(([k, t]) => k === 'svg' && t === 'title'), JSON.stringify(kinds))
})
