import { _devtoolsRoots, _devtoolsInternalRoots, Operator } from './chunk-VOTKTX55.js';

// devtools/walk.ts
function* iterRoots(opts) {
  const includeInternal = opts && opts.internal;
  for (const ref of _devtoolsRoots) {
    const v = ref.deref();
    if (!v) {
      _devtoolsRoots.delete(ref);
      continue;
    }
    if (!includeInternal && _devtoolsInternalRoots.has(v)) continue;
    yield v;
  }
}
function classify(sink) {
  if (sink instanceof Operator) return "operator";
  if (sink && typeof sink === "object") {
    if ("parent" in sink && sink.constructor?.name === "DOMSink") return "dom";
    const n = sink.constructor?.name;
    if (n === "ArrSink" || n === "PropSink" || n === "FunctionSink") return "connect";
  }
  return "sink";
}
function summarize(value) {
  if (value === null || value === void 0) return value;
  const t = typeof value;
  if (t === "string") return value.length > 80 ? value.slice(0, 77) + "..." : value;
  if (t === "number" || t === "boolean" || t === "bigint" || t === "symbol") return value;
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (t === "function") return `Function(${value.name || "anonymous"})`;
  if (t === "object") return `{ keys: ${Object.keys(value).length} }`;
  return String(value);
}
function ancestorOf(child, root, maxDepth = 32) {
  if (!child || !root) return false;
  if (child === root) return true;
  let n = child, d = 0;
  while (n && d < maxDepth) {
    if (n === root) return true;
    n = n.p;
    d++;
  }
  return false;
}
function walk(view2, opts) {
  opts = opts || {};
  return walkImpl(view2, opts.seen || /* @__PURE__ */ new WeakSet(), opts);
}
function walkImpl(view2, seen, opts) {
  if (seen.has(view2)) {
    return { key: [...view2.key], kind: "cycle", children: [], sinks: [] };
  }
  seen.add(view2);
  if ("src" in view2 && view2.src && view2.src !== view2) {
    return {
      key: [...view2.key],
      name: view2.name,
      kind: "linked-alias",
      aliasOf: view2.src.key ? [...view2.src.key] : [],
      children: [],
      sinks: []
    };
  }
  const node = {
    key: [...view2.key],
    name: view2.name,
    kind: view2.p ? "child" : "root",
    value: summarize(view2.value),
    children: [],
    sinks: []
  };
  view2.each?.((_name, child) => {
    const c = walkImpl(child, seen, opts);
    if (c.picked || c.pickedAncestor) node.pickedAncestor = true;
    node.children.push(c);
  });
  view2.sink?.((s) => {
    if (s instanceof Operator) {
      const opNode = walkImpl(s.view, seen, opts);
      opNode.kind = "operator";
      opNode.ctor = s.constructor.name;
      if (opts.pickedSink === s) opNode.picked = true;
      if (opNode.picked || opNode.pickedAncestor) node.pickedAncestor = true;
      node.sinks.push(opNode);
    } else {
      const sinkNode = {
        key: [...view2.key],
        kind: classify(s),
        ctor: s.constructor?.name || "anonymous",
        children: [],
        sinks: []
      };
      if (opts.pickedSink === s) {
        sinkNode.picked = true;
        node.pickedAncestor = true;
      }
      node.sinks.push(sinkNode);
    }
  });
  return node;
}

export { ancestorOf, classify, iterRoots, summarize, walk };
//# sourceMappingURL=chunk-CTNBR7TS.js.map
//# sourceMappingURL=chunk-CTNBR7TS.js.map