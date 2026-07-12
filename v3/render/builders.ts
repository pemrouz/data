// v3/render/builders.ts — the HTML.*/SVG.* builder DSL (M4.5b, sugar layer).
//
// A THIN sugar layer over the render AST: every builder call produces the
// EXACT VNode record the equivalent el()/text()/list() calls produce — no new
// AST kinds, no new render capabilities. `HTML.div.chart('#total: ', total)`
// is just `el('div', { class: 'chart' }, '#total: ', text(total))`.
//
// - HTML.div is a CALLABLE builder for tag 'div'; SVG.* builders are the same
//   thing (the renderer namespaces via the 'svg' tag and children inherit, so
//   SVG.path inside an svg subtree lands in the SVG namespace — the builders
//   emit plain el records).
// - Dot sugar accumulates on IMMUTABLE builder values (property access returns
//   a NEW builder — reusing `div.chart` can never leak state):
//     div.chart          → class "chart"      (chains: div.chart.active)
//     div['#charts']     → id "charts"
//     a['href=https://x'] → attr href="https://x" (split on the FIRST '=')
//   Merge with the call's explicit props: class APPENDS, id/attrs OVERRIDE.
// - Children normalization is normChildren() — exported because the JSX layer
//   reuses it: string/number → static text; null/undefined/boolean dropped;
//   VNodes pass through; a $ handle / scalar DataNode → text(view); a
//   bind(view, fn) child → text(view, fn); nested arrays flatten.
// - Props flow straight through to el() — the renderer already dispatches
//   on*/reactive (handle/DataNode/bind())/static values, so reactive style or
//   class values just work as prop values.

import { el, text, bind } from './index.ts'
import type { VNode, ElNode, BindProp } from './index.ts'
import { DataNode } from '../kernel/node.ts'

// The versioned handle symbol (Symbol.for — shared with api/index.ts without
// importing it, keeping this module render-layer-only).
const NODE = Symbol.for('data.v3.node')

// ── discriminators ───────────────────────────────────────────────────────────
//
// ORDER MATTERS in all of these: a $ handle is a proxy whose STRING property
// reads route through child-path dispatch (a scalar handle THROWS on a child
// read — the crossfilter-v3 `.kind`-probe bug), so the handle check ([NODE],
// a safe symbol read) must come BEFORE any `.kind` probe.

function isViewLike(x: unknown): boolean {
  if (x instanceof DataNode) return true
  return x !== null && typeof x === 'object' && (x as any)[NODE] instanceof DataNode
}

const VNODE_KINDS = new Set(['el', 'text', 'rtext', 'list', 'component', 'boundary'])

function isVNode(x: unknown): x is VNode {
  return x !== null && typeof x === 'object' && VNODE_KINDS.has((x as any).kind)
}

function isBindShape(x: unknown): x is BindProp {
  return x !== null && typeof x === 'object' && (x as any).kind === 'bind' && 'view' in (x as any)
}

// First-call-arg discrimination: props iff a PLAIN object that is not a
// VNode / BindProp / $ handle / DataNode (strings, numbers, arrays are
// children by construction).
function isPropsObject(x: unknown): boolean {
  if (x === null || typeof x !== 'object') return false
  if (Array.isArray(x)) return false
  if (x instanceof DataNode) return false
  if ((x as any)[NODE] instanceof DataNode) return false // $ handle — checked before any .kind probe
  if (isBindShape(x) || isVNode(x)) return false
  const proto = Object.getPrototypeOf(x)
  return proto === Object.prototype || proto === null
}

// ── children normalization (shared with the JSX layer) ──────────────────────

export function normChildren(children: unknown[]): VNode[] {
  const out: VNode[] = []
  const push = (c: unknown): void => {
    if (c == null || typeof c === 'boolean') return
    if (typeof c === 'string' || typeof c === 'number') {
      out.push({ kind: 'text', s: String(c) })
      return
    }
    if (Array.isArray(c)) {
      for (const k of c) push(k)
      return
    }
    if (isViewLike(c)) {
      out.push(text(c)) // reactive text over the handle / scalar node
      return
    }
    if (isBindShape(c)) {
      out.push(text(c.view, c.fn ?? undefined)) // bind() child = formatted reactive text
      return
    }
    if (isVNode(c)) {
      out.push(c)
      return
    }
    throw new Error(
      'data/render: unsupported child — expected a VNode, string/number, view/$ handle, bind(), or a nested array of those',
    )
  }
  for (const c of children) push(c)
  return out
}

// ── dot-sugar accumulation ───────────────────────────────────────────────────

export interface DotProps {
  readonly classes: readonly string[]
  readonly id: string | null
  readonly attrs: Readonly<Record<string, string>>
}

const EMPTY_DOT: DotProps = { classes: [], id: null, attrs: {} }

function addDot(dot: DotProps, prop: string): DotProps {
  if (prop.startsWith('#')) return { classes: dot.classes, id: prop.slice(1), attrs: dot.attrs }
  const eq = prop.indexOf('=')
  if (eq > 0)
    return {
      classes: dot.classes,
      id: dot.id,
      attrs: { ...dot.attrs, [prop.slice(0, eq)]: prop.slice(eq + 1) }, // FIRST '=' splits
    }
  // v2 parity: JS identifiers can't carry '-', so `input.new_todo` means the
  // CSS class "new-todo" (same for tag names below).
  return { classes: [...dot.classes, prop.replaceAll('_', '-')], id: dot.id, attrs: dot.attrs }
}

// ── el construction: dot sugar merged with the call's explicit props ─────────
//
// class APPENDS (dot classes first, the explicit value after — a reactive
// class value composes through a wrapping bind()); id and attrs OVERRIDE.

const toS = (x: unknown): string => (x == null ? '' : String(x))

export function elFrom(
  tag: string,
  dot: DotProps,
  callProps: Record<string, unknown> | null,
  children: unknown[],
): ElNode {
  const dotClass = dot.classes.length > 0 ? dot.classes.join(' ') : null
  let props: Record<string, unknown> | null = null
  const hasDot = dotClass !== null || dot.id !== null || Object.keys(dot.attrs).length > 0
  const hasCall = callProps !== null && Object.keys(callProps).length > 0
  if (hasDot || hasCall) {
    props = { ...dot.attrs }
    if (dotClass !== null) props.class = dotClass
    if (dot.id !== null) props.id = dot.id
    if (callProps !== null) {
      for (const k of Object.keys(callProps)) {
        const v = callProps[k]
        if (k === 'class' && dotClass !== null) {
          // explicit class APPENDS to the dot-sugar classes
          if (isViewLike(v)) props.class = bind(v, (x: unknown) => dotClass + ' ' + toS(x))
          else if (isBindShape(v)) {
            const f = v.fn
            props.class = bind(v.view, (x: unknown) => dotClass + ' ' + toS(f === null ? x : f(x)))
          } else if (v != null && v !== false) props.class = dotClass + ' ' + String(v)
          // null/undefined/false → the dot classes stand alone
        } else {
          props[k] = v // id / attrs / everything else: the explicit prop OVERRIDES
        }
      }
    }
  }
  return el(tag, props, ...normChildren(children))
}

// ── the builders ─────────────────────────────────────────────────────────────

export interface Builder {
  (...args: unknown[]): ElNode
  [sugar: string]: Builder
}

function makeBuilder(tag: string, dot: DotProps): Builder {
  const call = (...args: unknown[]): ElNode => {
    if (args.length > 0 && isPropsObject(args[0]))
      return elFrom(tag, dot, args[0] as Record<string, unknown>, args.slice(1))
    return elFrom(tag, dot, null, args)
  }
  return new Proxy(call, {
    get(t, prop) {
      // symbols (inspect, toPrimitive, the NODE probe…) read the bare fn —
      // a builder must never be mistaken for a handle or a vnode
      if (typeof prop !== 'string') return (t as any)[prop]
      return makeBuilder(tag, addDot(dot, prop)) // immutable accumulation
    },
  }) as Builder
}

export type BuilderNamespace = { readonly [tag: string]: Builder }

function namespaceProxy(): BuilderNamespace {
  return new Proxy(Object.create(null), {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined
      return makeBuilder(prop.replaceAll('_', '-'), EMPTY_DOT)
    },
  }) as BuilderNamespace
}

// HTML.div(...) / SVG.path(...) — identical machinery; SVG elements pick up
// their namespace from the enclosing <svg> subtree in the renderer.
export const HTML: BuilderNamespace = namespaceProxy()
export const SVG: BuilderNamespace = namespaceProxy()
