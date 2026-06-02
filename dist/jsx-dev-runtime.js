// utils.ts
function iter(o, fn) {
  if (isArray(o)) {
    for (let i = 0; i < o.length; i++) fn(i, o[i]);
  } else {
    for (const i in o) fn(i, o[i]);
  }
}
var { isArray } = Array;
var noop = () => {
};
var view = /* @__PURE__ */ Symbol("view");

// render/index.ts
var NS = "http://www.w3.org/2000/svg";
var NODE = /* @__PURE__ */ Symbol("Node");
var { keys } = Object;
var DOMSink = class {
  constructor(parent, node) {
    this.parent = parent;
    this.node = node;
    this.p = node.data[view];
    node.data.connect(this);
    this.XU0(this.p.value);
  }
  // Array branch passes `nodes[k + 1]` as the insertBefore anchor so the new
  // element lands at position k; object branch is positional-agnostic and
  // appends. `node.generate(k, ...)` builds the per-row template with the
  // user's data passed in — this is what materializes the row's content.
  create_node(k) {
    const node = this.node.generate(k, k === NODE ? this.node.data : this.node.data[k]);
    if (isArray(this.nodes)) {
      const dom = node.create(this.parent, this.nodes[k + 1]);
      this.nodes.splice(k, 0, dom);
    } else {
      this.nodes[k] = node.create(this.parent);
    }
  }
  // Array remove always pops the tail because the upstream BR1A protocol
  // already shifted the data array, so the live DOM array's last slot is
  // the one that should disappear (the V1 propagation will rewrite the
  // others' content). Object remove just deletes the named node directly.
  remove_node(k) {
    if (isArray(this.nodes)) {
      this.nodes.pop().remove();
    } else {
      this.nodes[k].remove();
      delete this.nodes[k];
    }
  }
  // Once the parent DOM is detached from the document the binding can never
  // produce a visible mutation again. We could keep applying changes to the
  // detached subtree but it just wastes work and corrupts our nodes/buckets
  // counts (per-group sinks under a removed group container kept getting
  // BR1/BI0 events while their parent was orphaned, eventually popping past
  // the end of nodes). Bail out early instead.
  _detached() {
    return this.parent?.isConnected === false;
  }
  XR0() {
    if (this._detached()) return;
    const gone = [];
    for (const i in this.nodes) gone.push(i);
    for (let j = 0; j < gone.length; j++) this.remove_node(gone[j]);
  }
  XU0(value2) {
    if (this._detached()) return;
    const prev_nodes = this.nodes ?? {};
    if (typeof value2 === "undefined") {
      this.nodes = {};
      const gone2 = [];
      for (const i in prev_nodes) gone2.push(i);
      for (let j = 0; j < gone2.length; j++) this.remove_node(gone2[j]);
      return;
    }
    if (typeof value2 !== "object") {
      this.nodes = {};
      const gone2 = [];
      for (const i in prev_nodes) gone2.push(i);
      for (let j = 0; j < gone2.length; j++) this.remove_node(gone2[j]);
      this.create_node(NODE);
      return;
    }
    this.nodes ??= isArray(value2) ? [] : {};
    for (const i in value2)
      if (!prev_nodes[i])
        this.create_node(i);
    const gone = [];
    for (const i in prev_nodes)
      if (!(i in value2))
        gone.push(i);
    for (let j = 0; j < gone.length; j++)
      this.remove_node(gone[j]);
  }
  BR1(R1) {
    if (this._detached()) return;
    for (let i = 0; i < R1.length; i++)
      this.remove_node(R1[i++]);
  }
  BU1(U1) {
    if (this._detached()) return;
    for (let i = 0; i < U1.length; i++) {
      const name = U1[i++];
      U1[i];
      if (!this.nodes[name]) this.create_node(name);
    }
  }
  BI0(I0) {
    if (this._detached()) return;
    for (let i = 0; i < I0.length; i++) {
      const name = I0[i++];
      I0[i];
      this.create_node(name);
    }
  }
  BR2(BR2) {
  }
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
  BMV1() {
  }
  BU2(U2) {
    if (this._detached()) return;
    for (let i = 0; i < U2.length; i++) {
      const [name] = U2[i++];
      U2[i];
      if (!this.nodes[name]) this.create_node(name);
    }
  }
  BI2(I2) {
    if (this._detached()) return;
    for (let i = 0; i < I2.length; i += 3) {
      const [name] = I2[i];
      if (!this.nodes[name]) this.create_node(name);
    }
  }
};
var Child = class {
};
var Node = class _Node extends Child {
  constructor(tag, ns, children = []) {
    super();
    this.ns = ns;
    this.tag = tag.replaceAll("_", "-");
    this.children = children;
  }
  static render(dom, node) {
    for (const child of node.children) {
      if (child.data) {
        dom.sink = new DOMSink(dom, child);
        Object.defineProperty(dom, "__ripple_sink", { value: dom.sink, configurable: true });
      } else {
        child.create(dom);
      }
    }
    return dom;
  }
  get new() {
    const node = new _Node(this.tag, this.ns, this.children.concat([]));
    node.static = this.static;
    node.data = this.data;
    node.fn = this.fn;
    return node;
  }
  get hasdata() {
    return this.data !== void 0 || this.static !== void 0;
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
      if (typeof arg === "string" || typeof arg === "number" || arg === true) {
        node.static = [arg];
      } else if (arg instanceof NodeProxy) {
        const child = arg[NODE];
        if (child.static) {
          iter(
            child.static,
            (k, v) => node.children.push(child.generate(k, v))
          );
        } else if (child.fn && !child.hasdata) {
          node.children.push(child.generate());
        } else node.children.push(arg[NODE]);
      } else if (typeof arg === "undefined" || arg === false) {
        node.static = [];
      } else if (arg[view]) {
        node.data = arg;
      } else if (typeof arg === "function") {
        const fn1 = node.fn;
        node.fn = fn1 ? (n, ...args2) => arg(fn1(n, ...args2), ...args2) : arg;
      } else if (typeof arg === "object") {
        node.static = arg;
      } else {
        throw new Error("unexpted arg", arg);
      }
    }
    return new NodeProxy(node);
  }
  create(parent, before) {
    const dom = this.ns ? document.createElementNS(NS, this.tag) : document.createElement(this.tag);
    before ? parent.insertBefore(dom, before) : parent.append(dom);
    return _Node.render(dom, this);
  }
  generate(k, v) {
    let node = new _Node(
      this.tag,
      this.ns,
      this.children.concat([])
    );
    const content = this.fn ? this.fn(new NodeProxy(node), v, k) : v;
    if (content instanceof NodeProxy) {
      node = content[NODE];
    } else {
      Text.add(node, content);
    }
    return node;
  }
};
var Prop = class extends Child {
  constructor(name, value2) {
    super();
    this.name = name;
    this.value = value2;
  }
  static add(node, n, v) {
    if (arguments.length == 2) v = true;
    typeof n === "object" ? node.children.push(...keys(n).map((k) => new this(k, n[k]))) : node.children.push(new this(n, v));
    return new NodeProxy(node);
  }
  create(parent) {
    this.parent = parent;
    if (this.value?.[view]) {
      parent.nrefs ??= {};
      parent.nrefs[this.name] = this.value.connect(this, "set");
    } else if (this.name?.[view]) {
      parent.arefs ??= [];
      parent.arefs.push(this.name.connect(this, "set"));
    } else
      this.set = this.value;
  }
  set set(value2) {
    value2 === false || value2 === void 0 ? this.remove() : this.add(value2);
  }
};
var Attr = class extends Prop {
  add(value2) {
    this.parent.setAttribute(this.name, value2);
  }
  remove() {
    this.parent.removeAttribute(this.name);
  }
};
var Class = class extends Prop {
  add() {
    this.parent.classList.add(this.name);
  }
  remove() {
    this.parent.classList.remove(this.name);
  }
};
var ID = class extends Prop {
  add() {
    this.parent.id = this.name;
  }
  remove() {
    this.parent.removeAttribute("id");
  }
};
var Style = class extends Prop {
  add(value2) {
    this.parent.style.setProperty(this.name, value2);
  }
  remove() {
    this.parent.style.removeProperty(this.name);
  }
};
var Text = class extends Prop {
  create(parent) {
    parent.appendChild(this.dom = document.createTextNode(""));
    super.create(parent);
  }
  add() {
    this.dom.textContent = this.name;
  }
  remove() {
    this.dom.textContent = "";
  }
};
var Event = class extends Prop {
  create(parent) {
    parent.addEventListener(this.name.toLowerCase(), this.value);
  }
};
var Ref = class extends Prop {
  create(parent) {
    this.name(parent);
  }
};
var props = {
  attr: Attr,
  class: Class,
  on: Event,
  style: Style,
  id: ID,
  text: Text,
  ref: Ref,
  nodes: Node
};
var NodeProxy = class _NodeProxy {
  constructor(node, prop) {
    this.node = node;
    this.prop = prop;
    return new Proxy(noop, this);
  }
  set() {
    throw "cannot set properties";
  }
  deleteProperty() {
    throw "cannot delete properties";
  }
  get(t, name) {
    const n = this.node;
    if (name === NODE) return n;
    else if (typeof name === "symbol") return;
    else if (name in props) return new _NodeProxy(n, name);
    else if (name.startsWith("#")) return ID.add(n.new, name.slice(1), true);
    else if (name.startsWith(".")) return Class.add(n.new, name.slice(1), true);
    else if (name.includes("=")) return Attr.add(n.new, ...name.split("="));
    else return Class.add(n.new, name.replaceAll("_", "-"), true);
  }
  apply(t, m, args) {
    if (args.length === 1 && isArray(args[0])) args = args[0];
    return props[this.prop ?? "nodes"].add(this.node.new, ...args);
  }
  getPrototypeOf(targer) {
    return _NodeProxy.prototype;
  }
};
var HTML = new Proxy({}, {
  get(t, name) {
    return new NodeProxy(new Node(name));
  }
});
var SVG = new Proxy({}, {
  get(t, name) {
    return new NodeProxy(new Node(name, true));
  }
});

// jsx/index.ts
var SVG_TAGS = /* @__PURE__ */ new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "textPath",
  "defs",
  "clipPath",
  "mask",
  "pattern",
  "image",
  "use",
  "symbol",
  "marker",
  "linearGradient",
  "radialGradient",
  "stop",
  "foreignObject",
  "filter",
  "feGaussianBlur",
  "feOffset",
  "feMerge",
  "feMergeNode",
  "feColorMatrix",
  "feFlood",
  "feComposite",
  "title",
  "desc"
]);
function applyProps(node, props2) {
  if (!props2) return node;
  for (const k in props2) {
    const v = props2[k];
    if (v === void 0 || v === null || v === false) continue;
    if (k === "className" || k === "class") {
      if (typeof v === "string") {
        for (const c of v.split(/\s+/)) if (c) node = node.class(c, true);
      } else {
        node = node.class(v);
      }
    } else if (k === "style" && typeof v === "object") {
      node = node.style(v);
    } else if (k === "id" && typeof v === "string") {
      node = node.id(v, true);
    } else if (k.length > 2 && k[0] === "o" && k[1] === "n" && typeof v === "function") {
      node = node.on(k.slice(2).toLowerCase(), v);
    } else if (k === "ref" && typeof v === "function") {
      node = node.ref(v);
    } else if (k === "children" || k === "key") ; else {
      node = node.attr(k, v === true ? "" : v);
    }
  }
  return node;
}
function h(tag, props2, ...children) {
  if (typeof tag === "function") return tag(props2 || {}, ...children);
  let node = (SVG_TAGS.has(tag) ? SVG : HTML)[tag];
  node = applyProps(node, props2);
  const flat = children.flat(Infinity);
  let hasRowFn = false;
  for (const c of flat) {
    if (typeof c === "function" && !c[view]) {
      hasRowFn = true;
      break;
    }
  }
  for (const c of flat) {
    if (c == null || c === false) continue;
    const isVP = typeof c === "function" && c[view];
    node = isVP && !hasRowFn ? node.text(c) : node(c);
  }
  return node;
}
function Fragment(_, ...children) {
  return children;
}
function _jsx(type, props2, _key) {
  const { children, ...rest } = props2 || {};
  const arr = children == null ? [] : Array.isArray(children) ? children : [children];
  return h(type, rest, ...arr);
}
var jsxDEV = _jsx;

export { Fragment, jsxDEV };
//# sourceMappingURL=jsx-dev-runtime.js.map
//# sourceMappingURL=jsx-dev-runtime.js.map