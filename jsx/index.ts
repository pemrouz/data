// Thin JSX adapter over the HTML/SVG builders. Goal: let templates be
// authored in JSX syntax without giving up the per-key surgical DOM updates
// that DOMSink does. The trick is that JSX is purely a syntactic transform —
// `<div className="x">{c}</div>` desugars to `h("div", {className:"x"}, c)`,
// and if `h` returns the same NodeProxy AST that `HTML.div.x(c)` returns,
// `render()` walks an identical tree and DOMSink handles updates exactly as
// it does today. No virtual DOM, no scheduler, no new sink type.
import { HTML, SVG, NODE } from '../render/index.ts'
import { view } from '../core.ts'
import type { Data, RowOf } from '../core.ts'

// SVG-namespaced tags. `h` uses this set to dispatch to SVG instead of HTML;
// anything not listed is HTML. Capitalized JSX identifiers (function
// components) bypass this entirely and are invoked directly.
const SVG_TAGS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline',
  'polygon', 'text', 'tspan', 'textPath', 'defs', 'clipPath', 'mask',
  'pattern', 'image', 'use', 'symbol', 'marker', 'linearGradient',
  'radialGradient', 'stop', 'foreignObject', 'filter', 'feGaussianBlur',
  'feOffset', 'feMerge', 'feMergeNode', 'feColorMatrix', 'feFlood',
  'feComposite', 'desc',
  // NB: `title` is intentionally NOT here. It exists in both namespaces (HTML
  // document <title> and SVG tooltip <title>), and h() picks the namespace from
  // this set with no parent context — so a `title` here forced every <title>
  // into the SVG namespace, breaking HTML <title> (which jsx.d.ts types as
  // HTML). Defaulting it to HTML matches the d.ts; for an SVG tooltip use the
  // explicit `SVG.title` builder. (Other dual-namespace tags — a/script/style —
  // were never in the set, so they already default to HTML.)
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
export function applyProps(node: any, props: any): any {
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
    } else if (/^on[A-Z]/.test(k) && typeof v === 'function' && !(v as any)[view]) {
      // Require an UPPERCASE char after `on` (onClick, onInput) so a legitimate
      // non-event prop that merely starts with "on" and holds a function —
      // `once={fn}` — isn't swallowed as addEventListener('ce', fn). Also exclude
      // a ViewProxy value (it's `typeof 'function'`): `onClick={vp}` would
      // otherwise install a listener that throws on the first click.
      node = node.on(k.slice(2).toLowerCase(), v)
    } else if (k === 'ref' && typeof v === 'function') {
      // One-shot callback fired with the real DOM element after create().
      // See the Ref class in render/index.ts.
      node = node.ref(v)
    } else if (k === 'children' || k === 'key') {
      // children come positionally (classic) or via the runtime's children
      // extraction (automatic, see jsx()). key is reserved for future
      // keyed-list semantics; currently unused.
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
export function h(tag: any, props: any, ...children: any[]): any {
  if (typeof tag === 'function') {
    // Deliver children to a function component BOTH via props.children (the
    // standard JSX contract jsx.d.ts's ElementChildrenAttribute advertises —
    // `({ children }) => …`) AND positionally (so the builder-style components
    // like `For`, which read the row fn as the 2nd positional arg, keep
    // working). Don't clobber an explicit props.children (the automatic runtime
    // already put it there).
    const norm = children.length === 0 ? undefined
      : children.length === 1 ? children[0]
      : children
    const merged = props ? { ...props, children: props.children ?? norm } : { children: norm }
    return tag(merged, ...children)
  }
  let node = ((SVG_TAGS.has(tag) ? SVG : HTML) as any)[tag]
  node = applyProps(node, props)
  const flat = children.flat(Infinity)
  // Has a real ROW FN child? That marks the data-iteration shape, in which case
  // VPs stay on the data path, not the text path. A row fn is a PLAIN function
  // — NOT a ViewProxy (`[view]`) and NOT a NodeProxy element (`[NODE]`, also a
  // callable Proxy with no `[view]`). Excluding NodeProxy elements is the fix:
  // a VP child with an element sibling (e.g. `<label><em/>{count}</label>`) was
  // wrongly flipped to the data-iteration path, duplicating the host element.
  let hasRowFn = false
  for (const c of flat) {
    if (typeof c === 'function' && !(c as any)[view] && !(c as any)[NODE]) { hasRowFn = true; break }
  }
  for (const c of flat) {
    if (c == null || c === false) continue
    const isVP = typeof c === 'function' && (c as any)[view]
    node = (isVP && !hasRowFn) ? node.text(c) : node(c)
  }
  return node
}

// `<>{a}{b}</>` → `Fragment(null, a, b)` → `[a, b]`. The enclosing h()'s
// .flat() pass spreads them as positional siblings.
export function Fragment(_: any, ...children: any[]): any {
  return children
}

// Automatic JSX runtime entry points. Picked up when a project sets
// `jsxImportSource: "data"` (or any path that resolves to this module via
// jsx-runtime). Same NodeProxy/identity guarantees as the classic `h` —
// these are tiny shims that extract `props.children` and forward to h().
//
//   jsx(type, props, key?)   — single static child
//   jsxs(type, props, key?)  — array of static children
//   jsxDEV(...)              — dev-mode signature, same body
//
// Children arrive bundled in props for the automatic runtime, in contrast
// to the classic transform where they're variadic positional args.
function _jsx(type: any, props: any, _key?: any): any {
  const { children, ...rest } = props || {}
  const arr = children == null ? []
    : Array.isArray(children) ? children
    : [children]
  return h(type, rest, ...arr)
}
export const jsx = _jsx
export const jsxs = _jsx
export const jsxDEV = _jsx

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
//
// Props type accepts `children` so `<For>{fn}</For>` (classic transform
// passes the row fn as a positional arg, but JSX type resolution still
// wants `children` in the props shape) type-checks under the per-tag
// JSX types in jsx.d.ts.
export function For<T>(
  // `children` is typed as the row fn so the JSX classic transform (which routes
  // `<For>{arrow}</For>` through the `children` prop) contextually types `item`
  // to `RowOf<T>`, inferred from `each`. The positional `fn` is the same arrow
  // for the runtime / builder-style direct call.
  { each, tag = 'div' }: { each: Data<T>; tag?: string; children?: (item: RowOf<T>, key: string) => any },
  fn: (item: RowOf<T>, key: any) => any,
): any {
  return ((SVG_TAGS.has(tag) ? SVG : HTML) as any)[tag](each, (node: any, item: any, key: any) => {
    const r = fn(item, key)
    return Array.isArray(r) ? node(...r.flat(Infinity)) : r
  })
}

export { HTML, SVG } from '../render/index.ts'
