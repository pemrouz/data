// @ts-nocheck
import { view } from '../core.ts'
import { iter, isArray, noop } from '../utils.ts'
const NS = 'http://www.w3.org/2000/svg'
// NODE is a sentinel used as the key for the root-level slot when a sink
// represents a single primitive child rather than a keyed list — DOMSink can
// then treat "scalar" and "one-element list" uniformly through nodes[NODE].
const NODE = Symbol('Node')
const { keys } = Object

// Top-level entry point: turn a NodeProxy template into actual DOM children
// of `p`. Returns `p` so `render(parent, …).whatever` chaining works.
/**
 * Mount a template (built with {@link HTML}/{@link SVG}) into a parent DOM
 * element, wiring any reactive `ViewProxy` data so the DOM updates surgically
 * — only the nodes whose bound value changed are touched, no virtual-DOM diff.
 *
 * The template's ROOT node is a wrapper: its CHILDREN are created into `p`
 * (the root tag itself is not created — `p` is the container). A data-bound
 * child — `HTML.li(items, (li, item) => …)` — becomes one row per item, so a
 * list is `render(container, HTML.ul(HTML.li(items, rowFn)))`: the `ul` wrapper
 * is decorative and the `li` rows are created inside `container`. Putting the
 * data on the wrapper itself (`HTML.ul(items, fn)`) renders nothing — a
 * wrapper's own data/fn are ignored; only its children are scanned.
 *
 * @param p  parent DOM element to render into (the row container)
 * @param np a NodeProxy template whose data-bound children become rows
 * @returns the parent element `p`
 * @example
 * import { $, render, HTML } from 'data'
 * const items = $([{ name: 'a' }, { name: 'b' }])
 * // each item becomes an <li> inside document.body:
 * render(document.body, HTML.ul(HTML.li(items, (li, item) => li.text(item.name))))
 */
export const render = (p, np) =>
  Node.render(p, np[NODE])

// DOMSink is the bridge between the reactive protocol and live DOM. One
// sink per data-bound region in the template; it holds the parent element,
// the per-key DOM nodes (`this.nodes`), and translates BU1/BR1/BI0/BMV1
// events into createElement/insertBefore/remove calls. Array sources keep
// `nodes` as an array so order matches the source; object sources use a
// keyed object.
class DOMSink {
  constructor(parent, node) {
    this.parent = parent
    this.node = node
    this.p = node.data[view]
    node.data.connect(this)
    this.XU0(this.p.value)
  }

  // Array sources are index-keyed: each DOM slot is bound to the positional
  // child view `node.data[i]`, and every shift refreshes slot content
  // positionally (the V1 propagation), with `remove_node` popping the *tail*.
  // So an insert must MIRROR that — append exactly one node at the new tail
  // index (bound to `data[tail]`) and let the positional refresh place the
  // data. Splicing a node *at* position k (the old behaviour) gave that node
  // a binding to slot k while the existing slot-k node kept its slot-k binding
  // too: both rendered `data[k]` (a duplicate) and the real tail element was
  // left with no node (dropped). Surfaced rendering a sort() view — an
  // array-shaped list with mid-list inserts, which no object-keyed example
  // (group / object-limit) exercised. During the initial XU0 build `tail`
  // already equals the iteration index, so this is identical to the old append
  // for that path; only post-init mid-inserts change.
  // Object branch is positional-agnostic and keyed directly.
  create_node(k) {
    if (isArray(this.nodes)) {
      const tail = this.nodes.length
      const node = this.node.generate(tail, this.node.data[tail])
      this.nodes.push(node.create(this.parent))
    } else {
      const node = this.node.generate(k, k === NODE ? this.node.data : this.node.data[k])
      this.nodes[k] = node.create(this.parent)
    }
  }

  // Array remove always pops the tail because the upstream BR1A protocol
  // already shifted the data array, so the live DOM array's last slot is
  // the one that should disappear (the V1 propagation will rewrite the
  // others' content). Object remove just deletes the named node directly.
  remove_node(k){
    if (isArray(this.nodes)) {
      this.nodes.pop().remove()
    } else {
      this.nodes[k].remove()
      delete this.nodes[k]
    }
  }

  // ── Index-keyed array path (sparse producers: between/intersect/union/except
  // bound straight to the DOM) ──────────────────────────────────────────────
  // Distinct from create_node/remove_node (which are TAIL-relative — correct
  // for dense splice arrays where tail == index). These bind node[k] ↔ data[k]
  // at a fixed position so a hole can be removed/filled without shifting
  // survivors, mirroring the BH1/BF0 protocol. Used only when the array is
  // sparse (XU0) or for BH1/BF0 events (which dense arrays never emit).

  // A true if any in-bounds slot is a hole (empty or explicit-undefined).
  _sparse(v) {
    for (let i = 0; i < v.length; i++) if (v[i] === undefined) return true
    return false
  }

  // Create the node for present index `k`, inserted before the node at the
  // smallest present index > k (or appended if none) so DOM order tracks index
  // order. Idempotent: a BF0 for an already-present slot is a no-op (its content
  // was already refreshed by core's V1 pre-fire).
  _create_at(k) {
    if (this.nodes[k]) return
    const node = this.node.generate(k, this.node.data[k])
    let next = Infinity
    for (const j in this.nodes) { const jn = +j; if (jn > k && jn < next) next = jn }
    this.nodes[k] = node.create(this.parent, next !== Infinity ? this.nodes[next] : undefined)
  }

  // Append the node for present index `k` to the tail (no positional scan).
  // Only safe when every later present index is created after this one — i.e.
  // the in-increasing-order build from an empty node set in `_reconcile_sparse`.
  _append_at(k) {
    const node = this.node.generate(k, this.node.data[k])
    this.nodes[k] = node.create(this.parent, undefined)
  }

  _remove_at(k) {
    this.nodes[k]?.remove()
    delete this.nodes[k]
  }

  // Reconcile the live DOM with a sparse array value: drop nodes whose slot
  // became a hole, create nodes for newly-present slots (positioned by index).
  // Handles the dense→sparse transition too (a between whose bounds were full
  // domain, then narrowed): the prior dense nodes are already node[i] ↔ data[i],
  // so index-keyed removal/creation composes cleanly.
  _reconcile_sparse(value) {
    this.nodes ??= []
    const gone = []
    for (const i in this.nodes) if (value[+i] === undefined) gone.push(+i)
    for (let j = 0; j < gone.length; j++) this._remove_at(gone[j])
    // If no node survives the holing pass, the present slots below are visited
    // in increasing index order from an empty set, so each is a pure tail
    // append — skip `_create_at`'s O(present) next-scan (which makes a fresh
    // sparse build O(P²)). When survivors remain (a re-snapshot that fills a
    // gap between existing nodes) we must position by index via `_create_at`.
    let survivors = false
    for (const _ in this.nodes) { survivors = true; break }
    for (let i = 0; i < value.length; i++)
      if (value[i] !== undefined && !this.nodes[i])
        survivors ? this._create_at(i) : this._append_at(i)
  }

  // Once the parent DOM is detached from the document the binding can never
  // produce a visible mutation again. We could keep applying changes to the
  // detached subtree but it just wastes work and corrupts our nodes/buckets
  // counts (per-group sinks under a removed group container kept getting
  // BR1/BI0 events while their parent was orphaned, eventually popping past
  // the end of nodes). Bail out early instead.
  _detached() {
    return this.parent?.isConnected === false
  }

  // Remove EVERY present node from `this.nodes`, regardless of shape: array
  // entries (skipping holes a sparse remove left — `?.remove()`), object string
  // keys, AND the NODE-symbol slot (a scalar binding — for-in never enumerates a
  // Symbol key, so it would otherwise be orphaned and duplicated on the next
  // update). Operates directly on `this.nodes` so it must run BEFORE any reset.
  _teardownAll() {
    const ns = this.nodes
    if (!ns) return
    if (isArray(ns)) {
      for (let i = 0; i < ns.length; i++) ns[i]?.remove()
    } else {
      for (const k in ns) ns[k]?.remove()
    }
    ns[NODE]?.remove()
  }

  XR0() {
    if (this._detached()) return
    this._teardownAll()
    this.nodes = isArray(this.nodes) ? [] : {}
  }

  XU0(value) {
    if (this._detached()) return
    // undefined or any primitive: tear down all current nodes (incl. a holey
    // array tail and the NODE-symbol scalar slot — both of which the old
    // for-in + tail-pop teardown mishandled, crashing on a hole or duplicating
    // a scalar), reset, then for a primitive mint the single scalar node.
    if (value === undefined || typeof value !== 'object') {
      this._teardownAll()
      this.nodes = {}
      if (value !== undefined) this.create_node(NODE)
      return
    }
    const prev_nodes = this.nodes ?? {}

    const arr = isArray(value)
    // ALL array XU0 re-snapshots reconcile index-keyed (node[i] ↔ data[i]),
    // sparse or dense. A sparse value (a between/intersect/union/except view
    // bound straight to a row template) has present rows scattered among holes.
    // A DENSE value is the simple case — but a dense RE-SNAPSHOT over a
    // previously-HOLEY nodes array (a brushed `between` whose bounds widened so
    // every row is now in range) can't take the tail-relative build below: it
    // would bind node-j to `data[j]` against a holey nodes array, dropping rows
    // (the v:4 between [3,4,5] → "35" bug). _reconcile_sparse handles both —
    // it's index-keyed and a no-hole value just creates every slot by index. The
    // incremental BU1/BI0/BR1 ops stay tail-relative (index == tail for a dense
    // array), so this only changes the full-resnapshot path.
    if (arr) return this._reconcile_sparse(value)
    this.nodes ??= arr ? [] : {}
    for (const i in value)
      // Object (keyed) sinks: skip explicit-`undefined` slots that sparse
      // producers leave at excluded keys. Here create_node is index-relative
      // (`nodes[k]` bound to `data[k]`), so skipping a hole can't misalign
      // survivors — it just avoids a phantom row bound to `undefined`.
      if (!prev_nodes[i] && (arr || value[i] !== undefined))
        this.create_node(i) // if (this.nodes[k]) maybe reorder
    // Same V8 quirk: snapshot the keys to drop before mutating, otherwise
    // remove_node's tail-pop on dense arrays cuts the for-in short and
    // leaves stale DOM rows behind (visible as empty rows in the
    // crossfilter flight list when a brush narrows enough to trigger
    // limit's XU0 fallback).
    const gone = []
    for (const i in prev_nodes)
      if (!(i in value))
        gone.push(i)
    for (let j = 0; j < gone.length; j++)
      this.remove_node(gone[j])
  }

  BR1(R1){
    if (this._detached()) return
    for (let i = 0; i < R1.length; i++)
      this.remove_node(R1[i++])
  }

  BU1(U1){
    if (this._detached()) return
    for (let i = 0; i < U1.length; i++) {
      const name = U1[i++]
      const value = U1[i]
      if (!this.nodes[name]) this.create_node(name)
    }
  }

  BI0(I0) {
    if (this._detached()) return
    for (let i = 0; i < I0.length; i++) {
      const name = I0[i++]
      const value = I0[i]
      this.create_node(name)
    }
  }

  // Hole remove / hole fill from a sparse producer over an ARRAY. Positional-
  // stable (no shift): drop/create the node AT index k, leaving survivors put.
  // Core's View.BH1/BF0 pre-fires the touched child's XU0 (so a fill's content
  // is already set on the child view _create_at binds, and a remove's child
  // goes undefined just before its node is dropped) — index-keyed, so no
  // double-apply. Dense arrays never emit these; they only reach a DOMSink
  // bound directly to a between/intersect/union/except view.
  BH1(R1) {
    if (this._detached()) return
    for (let i = 0; i < R1.length; i += 2) this._remove_at(+R1[i])
  }

  BF0(I0) {
    if (this._detached()) return
    for (let i = 0; i < I0.length; i += 2) this._create_at(+I0[i])
  }

  BR2(BR2){}

  // Move-at-depth-1. Rows here are *index-keyed*: each DOM node is bound to
  // the positional child view `node.data[k]`, and a rank rotation reaches us
  // as core's Value.BMV1 refreshing the content of every slot in the affected
  // range (child.XU0, see core.ts) *before* this method runs. So by now each
  // fixed slot already shows its new row's data — the DOM is correct without
  // touching node order. Physically relocating the element on top of that
  // would double-apply the rotation and scramble the list (the regression in
  // tests/render-reorder.spec.ts). We intentionally do nothing: keep `nodes`
  // aligned with positions and let the positional content refresh stand.
  // (True element-identity preservation across reorders would require a
  // data-keyed row model, which this index-keyed renderer doesn't have.)
  BMV1(){}

  BU2(U2){
    if (this._detached()) return
    for (let i = 0; i < U2.length; i++) {
      const [name] = U2[i++]
      const value = U2[i]
      if (!this.nodes[name]) this.create_node(name)
    }
  }

  BI2(I2){
    if (this._detached()) return
    for (let i = 0; i < I2.length; i+=3) {
      const [name] = I2[i]
      if (!this.nodes[name]) this.create_node(name)
    }
  }
}

// true - [true]
// false - [false]
// undefined - [undefined]
// null - [null]
// '0 - [0]
// '1 - [1]

class Child {}

// Node is the template AST built up by HTML.div(...).foo(...) chains. It
// stays declarative until create() runs against a real parent — that's when
// it becomes a live element. `_` → `-` lets `HTML.foo_bar()` produce the
// hyphenated `<foo-bar>` custom-element tag without escaping.
class Node extends Child {
  constructor(tag, ns, children = []) {
    super()
    this.ns = ns;
    this.tag = tag.replaceAll('_', '-');
    this.children = children;
  }

  static render(dom, node) {
    for (const child of node.children) {
      if (child.data) {
        dom.sink = new DOMSink(dom, child)
        // Non-enumerable so it never shows up in JSON.stringify or
        // for-in inspection of the element; configurable so a later
        // bind can replace it. Used by $.fromDOM to walk a clicked
        // element back to its owning view.
        Object.defineProperty(dom, '__ripple_sink', { value: dom.sink, configurable: true })
      } else {
        child.create(dom)
      }
    }
    return dom
  }

  get new(){ 
    const node = new Node(this.tag, this.ns, this.children.concat([]))
    node.static = this.static
    node.data = this.data
    node.fn = this.fn
    return node 
  }

  get hasdata(){
    return this.data !== undefined || this.static !== undefined
  }

  // The grand dispatch on what `HTML.div(...)` was called with. The same
  // method handles every shape because the proxy can't know in advance:
  //   string/number/true   → text content
  //   NodeProxy            → child template
  //   undefined/false      → empty (often used by ternaries)
  //   reactive (has [view]) → bind data to this node's children
  //   function             → row generator (composes with prior fn)
  //   object               → static attribute bag
  static add(node, ...args) {
    for (const arg of args) {
      if (typeof arg === 'string' || typeof arg === 'number' || arg === true) {
        node.static = [arg]
      } else if (arg instanceof NodeProxy) {
        const child = arg[NODE]
        if (child.static) {
          iter(child.static, (k, v) => 
            node.children.push(child.generate(k, v))
          )
        } 
        else if (child.fn && !child.hasdata){
          node.children.push(child.generate())
        } 
        else node.children.push(arg[NODE])
      } else if (typeof arg === 'undefined' || arg === false) {
        node.static = []
      } else if (arg[view]) {
        node.data = arg
      } else if (typeof arg === 'function') { 
        const fn1 = node.fn
        node.fn = fn1 ? (n, ...args) => arg(fn1(n, ...args), ...args) : arg 
      } else if (typeof arg === 'object') {
        node.static = arg
      } else {
        throw new Error('unexpted arg', arg)
      }
    }
    return new NodeProxy(node)
  }

  create(parent, before) {
    const dom = this.ns
      ? document.createElementNS(NS, this.tag)
      : document.createElement(this.tag)

    before
      ? parent.insertBefore(dom, before)
      : parent.append(dom)

    return Node.render(dom, this)
  }

  generate(k, v) {
    // CLONE each template child, don't share it. `this.children.concat([])` was
    // a shallow copy — every generated row shared the SAME Prop instances, so a
    // reactive prop attached to the row TEMPLATE (outside the row fn, e.g.
    // `HTML.li.class('hot', flag)(items, fn)`) connected a PropSink per row that
    // all mutated the one Prop, whose `parent` ended up pointing only at the LAST
    // row — so a reactive class/style/attr update landed on one row instead of
    // all. A fresh Prop/Node per row gives each its own `parent`.
    let node = new Node(
      this.tag,
      this.ns,
      this.children.map(c =>
        c instanceof Node ? c.new
      : c instanceof Prop ? new c.constructor(c.name, c.value)
      : c)
    )
    
    const content = this.fn 
      ? this.fn(new NodeProxy(node), v, k) 
      : v
    
    // console.log('generate', {v, k, node, fn: this.fn, content })

    if (content instanceof NodeProxy) {
// console.log('******************************************')      
    node = content[NODE]
      // node = Node.add(node, content)[NODE]
// console.log('******************************************')      
// node = content[NODE]
    }
    else {
      Text.add(node, content)
    }
    
    return node
  }
}

class Prop extends Child {
  constructor(name, value) {
    super()
    this.name = name
    this.value = value
  }

  static add(node, n, v) {
    if (arguments.length == 2) v = true
    typeof n === 'object' 
      ? node.children.push(...keys(n).map(k => new this(k, n[k])))
      : node.children.push(new this(n, v))
    return new NodeProxy(node)
  }

  create(parent){
    this.parent = parent
    if (this.value?.[view]) {
      parent.nrefs ??= {}
      parent.nrefs[this.name] = this.value.connect(this, 'set')
    } else if (this.name?.[view]) {
      parent.arefs ??= []
      parent.arefs.push(this.name.connect(this, 'set'))
    } else 
      this.set = this.value
  }

  set set(value) {
    value === false || value === undefined
      ? this.remove()
      : this.add(value)
  }
}

class Attr extends Prop {
  add(value) { this.parent.setAttribute(this.name, value) }
  remove() { this.parent.removeAttribute(this.name) }
}

class Class extends Prop {
  add() { this.parent.classList.add(this.name) }
  remove() { this.parent.classList.remove(this.name) }
}

class ID extends Prop {
  add() { this.parent.id = this.name }
  remove() { this.parent.removeAttribute('id') }
}

class Style extends Prop {
  add(value) { this.parent.style.setProperty(this.name, value) }
  remove() { this.parent.style.removeProperty(this.name) }
}

class Text extends Prop {
  create(parent) {
    parent.appendChild(this.dom = document.createTextNode(''))
    super.create(parent)
  }
  add(){ this.dom.textContent = this.name }
  remove(){ this.dom.textContent = '' }
}

class Event extends Prop {
  create(parent){
    parent.addEventListener(this.name.toLowerCase(), this.value)
  }
}

// Ref runs a one-shot callback with the parent element after creation —
// the equivalent of React/Solid's `ref={el => …}`. Used for imperative
// hooks (focus, measure, attach a third-party library) where we need the
// real DOM node, not a reactive binding. `node.ref(fn)` adds it.
class Ref extends Prop {
  create(parent) { this.name(parent) }
}

const props = {
  attr: Attr,
  class: Class,
  on: Event,
  style: Style,
  id: ID,
  text: Text,
  ref: Ref,
  nodes: Node,
}

// NodeProxy is the chainable template handle the user sees. Property reads
// dispatch on the name:
//   `prop` (attr/class/on/style/id/text/nodes) → switch into prop-builder mode
//   `'#foo'`   → shorthand for id="foo"
//   `'.foo'`   → shorthand for class="foo"
//   `'k=v'`    → shorthand for attr k="v"
//   anything else → class shorthand (so `HTML.div.active(...)` adds class
//                  "active"). Underscores become hyphens.
// The Proxy wraps `noop` so the result is callable, which is what makes
// `HTML.div(child1, child2)` work as a method invocation.
class NodeProxy {
  constructor(node, prop) {
    this.node = node;
    this.prop = prop;
    return new Proxy(noop, this)
  }

  set(){ throw 'cannot set properties' }

  deleteProperty(){ throw 'cannot delete properties' }

  get(t, name){
    const n = this.node
    if (name === NODE) return n
    else if (typeof name === 'symbol') return
    else if (name in props) return new NodeProxy(n, name)
    else if (name.startsWith('#')) return ID.add(n.new, name.slice(1), true)
    else if (name.startsWith('.')) return Class.add(n.new, name.slice(1), true)
    else if (name.includes('=')) return Attr.add(n.new, ...name.split('='))
    else return Class.add(n.new, name.replaceAll('_', '-'), true)
  }

  apply(t, m, args) {
    // Auto-spread a single array argument so `node(<Fragment>…</Fragment>)`
    // works equivalently to `node(...children)`. JSX Fragment evaluates to
    // an array of children; without this, the whole array would land in
    // Node.add's `typeof === 'object'` branch and become `static`, silently
    // breaking row templates. Passing a bare array as the only positional
    // arg wasn't a documented builder pattern, so this is purely additive.
    if (args.length === 1 && isArray(args[0])) args = args[0]
    return props[this.prop ?? 'nodes'].add(this.node.new, ...args)
  }

  getPrototypeOf(targer){
    return NodeProxy.prototype
  }
}

/**
 * Builder for HTML element templates. Any property is an element tag:
 * `HTML.div(...)`, `HTML.li(...)`, `HTML.button(...)`. Pass props/children as
 * arguments and a `(data, rowFn)` pair to bind reactive collections. Compose
 * with {@link render} to mount. `HTML.div.foo.bar(...)` adds classes.
 * @example HTML.ul(items, item => HTML.li(item.name))
 */
export const HTML = new Proxy({}, {
  get(t, name) { return new NodeProxy(new Node(name)) },
})

/**
 * Builder for SVG element templates — the {@link HTML} counterpart that creates
 * nodes in the SVG namespace: `SVG.svg(...)`, `SVG.path(...)`, `SVG.rect(...)`.
 */
export const SVG = new Proxy({}, {
  get(t, name){ return new NodeProxy(new Node(name, true)) },
})
