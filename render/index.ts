// @ts-nocheck
import { view } from '../core.ts'
import { iter, isArray, noop } from '../utils.ts'
const NS = 'http://www.w3.org/2000/svg'
const NODE = Symbol('Node')
const { keys } = Object

export const render = (p, np) =>
  Node.render(p, np[NODE])

class DOMSink {
  constructor(parent, node) {
    this.parent = parent
    this.node = node
    this.p = node.data[view]
    node.data.connect(this)
    this.XU0(this.p.value)
  }

  create_node(k) {
    const node = this.node.generate(k, k === NODE ? this.node.data : this.node.data[k])
    if (isArray(this.nodes)) {
      const dom = node.create(this.parent, this.nodes[k + 1])
      this.nodes.splice(k, 0, dom)
    } else {
      this.nodes[k] = node.create(this.parent)
    }
  }
  
  remove_node(k){
    if (isArray(this.nodes)) {
      this.nodes.pop().remove()
    } else {
      this.nodes[k].remove()
      delete this.nodes[k]
    }
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

  XR0() {
    if (this._detached()) return
    for (const i in this.nodes)
      this.remove_node(i)
  }

  XU0(value) {
    if (this._detached()) return
    const prev_nodes = this.nodes ?? {}
    if (typeof value === 'undefined') {
      this.nodes = {}
      for (const i in prev_nodes) this.remove_node(i)
      return
    }

    if (typeof value !== 'object') {
      this.nodes = {}
      for (const i in prev_nodes) this.remove_node(i)
      this.create_node(NODE)
      return
    }

    this.nodes ??= isArray(value) ? [] : {}
    for (const i in value) 
      if (!prev_nodes[i])  
        this.create_node(i) // if (this.nodes[k]) maybe reorder
    for (const i in prev_nodes)
      if (!(i in value)) 
        this.remove_node(i)
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

  BR2(BR2){}

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

  static add(node, ...args) {
    // console.log({ args })
    for (const arg of args) {
      if (typeof arg === 'string' || typeof arg === 'number' || arg === true) {
        // Text.add(node, arg)
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
    let node = new Node(
      this.tag,
      this.ns,
      this.children.concat([])
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

const props = {
  attr: Attr,
  class: Class,
  on: Event,
  style: Style,
  id: ID,
  text: Text,
  nodes: Node,
}

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
    return props[this.prop ?? 'nodes'].add(this.node.new, ...args)
  }

  getPrototypeOf(targer){
    return NodeProxy.prototype
  }
}

export const HTML = new Proxy({}, {
  get(t, name) { return new NodeProxy(new Node(name)) },
})

export const SVG = new Proxy({}, {
  get(t, name){ return new NodeProxy(new Node(name, true)) },
})
