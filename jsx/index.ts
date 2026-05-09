// @ts-nocheck
// Thin JSX adapter over the HTML/SVG builders. Goal: let templates be
// authored in JSX syntax without giving up the per-key surgical DOM updates
// that DOMSink does. The trick is that JSX is purely a syntactic transform —
// `<div className="x">{c}</div>` desugars to `h("div", {className:"x"}, c)`,
// and if `h` returns the same NodeProxy AST that `HTML.div.x(c)` returns,
// `render()` walks an identical tree and DOMSink handles updates exactly as
// it does today. No virtual DOM, no scheduler, no new sink type.
import { HTML, SVG } from '../render/index.ts'
import { view } from '../core.ts'

// SVG-namespaced tags. `h` uses this set to dispatch to SVG instead of HTML;
// anything not listed is HTML. Capitalized JSX identifiers (function
// components) bypass this entirely and are invoked directly.
const SVG_TAGS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline',
  'polygon', 'text', 'tspan', 'textPath', 'defs', 'clipPath', 'mask',
  'pattern', 'image', 'use', 'symbol', 'marker', 'linearGradient',
  'radialGradient', 'stop', 'foreignObject', 'filter', 'feGaussianBlur',
  'feOffset', 'feMerge', 'feMergeNode', 'feColorMatrix', 'feFlood',
  'feComposite', 'title', 'desc',
])

// Translate a JSX props bag onto an existing NodeProxy by chaining the
// equivalent builder calls. Centralized here so `h` and `For` use the same
// rules. Returns the new proxy (each builder call returns a fresh proxy).
//
//   className / class string → .class('name', true) per token
//   class object             → .class({name: cond}) — Prop.add's object form,
//                              the natural mirror of .class('a', va).class('b', vb)
//   style object             → .style({name: value})
//   id string                → .id(value, true)
//   on{Event}                → .on(event.toLowerCase(), fn)
//   children/key/ref         → reserved JSX names, ignored here
//   anything else            → .attr(key, value), boolean true → '' so
//                              setAttribute produces the standard empty-string
//                              boolean attribute (matches existing 'autofocus='
//                              shorthand, not the literal string "true")
export function applyProps(node, props) {
  if (!props) return node
  for (const k in props) {
    const v = props[k]
    if (v === undefined || v === null || v === false) continue
    if (k === 'className' || k === 'class') {
      if (typeof v === 'string') {
        for (const c of v.split(/\s+/)) if (c) node = node.class(c, true)
      } else {
        node = node.class(v)
      }
    } else if (k === 'style' && typeof v === 'object') {
      node = node.style(v)
    } else if (k === 'id' && typeof v === 'string') {
      node = node.id(v, true)
    } else if (k.length > 2 && k[0] === 'o' && k[1] === 'n' && typeof v === 'function') {
      node = node.on(k.slice(2).toLowerCase(), v)
    } else if (k === 'ref' || k === 'children' || k === 'key') {
      // ignored — children come positionally; ref/key not implemented
    } else {
      node = node.attr(k, v === true ? '' : v)
    }
  }
  return node
}

// JSX classic factory. tsconfig.jsxFactory: "h" maps `<div className="x">{c}</div>`
// to `h("div", {className: "x"}, c)`. We forward to the existing builders so
// the produced NodeProxy AST is byte-identical to `HTML.div.x(c)` — DOMSink
// then delivers the same surgical updates with no behavior change.
//
// Capitalized tags are component functions: `<For each={d}>{fn}</For>` →
// `h(For, {each: d}, fn)` → `For({each: d}, fn)`.
//
// Per-child dispatch has one nuance: when a ViewProxy child has no function
// sibling, route it through .text() (Prop name-reactive binding — preserves
// the host element across updates). When there *is* a function sibling, the
// pair is the builder's data-iteration shape `(VP, fn)` — keep both on the
// default Node.add path so VP becomes node.data and fn becomes the row
// generator. Without this distinction `<label>{item.title}</label>` would
// recreate the label on every update (lost focus/markers), and the
// `[data, fn]` data-binding shorthand would silently lose its data link.
export function h(tag, props, ...children) {
  if (typeof tag === 'function') return tag(props || {}, ...children)
  let node = (SVG_TAGS.has(tag) ? SVG : HTML)[tag]
  node = applyProps(node, props)
  const flat = children.flat(Infinity)
  // Has a non-VP function child? That marks the data-iteration shape; in
  // that case VPs should stay on the data path, not the text path.
  let hasRowFn = false
  for (const c of flat) {
    if (typeof c === 'function' && !c[view]) { hasRowFn = true; break }
  }
  for (const c of flat) {
    if (c == null || c === false) continue
    const isVP = typeof c === 'function' && c[view]
    node = (isVP && !hasRowFn) ? node.text(c) : node(c)
  }
  return node
}

// `<>{a}{b}</>` → `Fragment(null, a, b)` → `[a, b]`. The enclosing h()'s
// .flat() pass spreads them as positional siblings.
export function Fragment(_, ...children) {
  return children
}

// Keyed-list component over a ViewProxy data source. Forwards to the existing
// data-binding shape `HTML[tag](each, (node, item, key) => …)` from render —
// DOMSink keeps DOM identity across updates and reorders. Per-row props go
// on the element the row fn returns (Node.generate swaps that in for the
// pre-shaped row template).
//
//   <For each={items} tag="li">
//     {(item) => <li class={{done: item.done}}>{item.title}</li>}
//   </For>
//
// `tag` defaults to 'div' but is replaced when the row fn returns a
// NodeProxy — Solid-style. Use the matching tag if you want JSX <li>, or
// omit the inner element and return a Fragment to extend the row template.
export function For({ each, tag = 'div' }, fn) {
  return (SVG_TAGS.has(tag) ? SVG : HTML)[tag](each, (node, item, key) => {
    const r = fn(item, key)
    return Array.isArray(r) ? node(...r.flat(Infinity)) : r
  })
}

export { HTML, SVG } from '../render/index.ts'
