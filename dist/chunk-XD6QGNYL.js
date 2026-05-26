import { SVG, HTML } from './chunk-YWRD6QQ4.js';
import { view } from './chunk-VOTKTX55.js';

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
function applyProps(node, props) {
  if (!props) return node;
  for (const k in props) {
    const v = props[k];
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
function h(tag, props, ...children) {
  if (typeof tag === "function") return tag(props || {}, ...children);
  let node = (SVG_TAGS.has(tag) ? SVG : HTML)[tag];
  node = applyProps(node, props);
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
function _jsx(type, props, _key) {
  const { children, ...rest } = props || {};
  const arr = children == null ? [] : Array.isArray(children) ? children : [children];
  return h(type, rest, ...arr);
}
var jsx = _jsx;
var jsxs = _jsx;
var jsxDEV = _jsx;
function For({ each, tag = "div" }, fn) {
  return (SVG_TAGS.has(tag) ? SVG : HTML)[tag](each, (node, item, key) => {
    const r = fn(item, key);
    return Array.isArray(r) ? node(...r.flat(Infinity)) : r;
  });
}

export { For, Fragment, h, jsx, jsxDEV, jsxs };
//# sourceMappingURL=chunk-XD6QGNYL.js.map
//# sourceMappingURL=chunk-XD6QGNYL.js.map