// v3/jsx — the classic JSX transform (jsxFactory: h, jsxFragmentFactory:
// Fragment) — M4.5b sugar layer.
//
// A THIN layer over the frozen render AST, sharing normChildren with the
// builder DSL: `<div class="x">{total}</div>` produces the EXACT record
// `el('div', { class: 'x' }, text(total))` produces — same renderer, same
// keyed sink, same surgical updates. Props pass through UNCHANGED (the
// renderer already dispatches on* events / handle / DataNode / bind() /
// static values), so reactive attrs need no JSX-side work.
//
// THE v2 CHILD AMBIGUITY IS DEAD (deliberate kill, do not resurrect):
// - a bare $ handle / view child is reactive TEXT, always — it never
//   auto-iterates, whatever its siblings are.
// - iteration is ONLY <For each={view}>{(row, key) => vnode}</For>, which is
//   list(view, fn). There is NO [vp, fn] children shorthand: a FUNCTION child
//   under a string tag THROWS (normChildren's unsupported-child error), so a
//   view child can never silently pair with a sibling function and flip from
//   text to iteration (the v2 hasRowFn discriminator and its whole bug family
//   — text-vs-data path flips, element-sibling exclusions — do not exist here).
//
// Components: a FUNCTION tag becomes component(tag, { ...props, children }) —
// DEFERRED to mount, where the render layer invokes it ONCE under its own
// child Scope (onCleanup(), transient views, and raf() writers inside it die
// with its DOM). Component children are normalized with the SAME vocabulary
// as element children EXCEPT a function child passes through raw — the
// render-prop protocol For itself relies on. The STRUCTURAL builtins stay
// EAGER (identity-checked): Fragment returns its children array (normChildren
// flattening makes it disappear into any parent), For validates and returns a
// ListNode at construction, ErrorBoundary returns a boundary() record.
//
// The automatic runtime (jsx / jsxs / jsxDEV) lives in ./runtime.ts — a thin
// normalizer onto this module's h, so classic and automatic transforms can
// never produce different records. Per-tag intrinsic types live in
// ./intrinsics.ts (shared by ./jsx.d.ts's global namespace for the classic
// transform and runtime.ts's exported namespace for the automatic one).

import { el, list, component, boundary } from '../render/index.ts'
import type { VNode, ListNode } from '../render/index.ts'
import { normChildren } from '../render/builders.ts'
import { DataNode } from '../kernel/node.ts'
import type { RowKey } from '../contract/delta.ts'

// The versioned handle symbol (Symbol.for — shared with api/index.ts without
// importing it; a symbol read is safe on the handle proxy, string reads are
// child-path dispatch and may throw).
const NODE = Symbol.for('data.v3.node')

// A component may return the full child vocabulary (a VNode, an array,
// reactive-text sources, null) — the mount normalizes it via normChildren.
export type Component = (props: any) => unknown

function isViewLike(x: unknown): boolean {
  if (x instanceof DataNode) return true
  return x !== null && typeof x === 'object' && (x as any)[NODE] instanceof DataNode
}

function viewNodeOf(x: unknown): DataNode<any> {
  return x instanceof DataNode ? x : ((x as any)[NODE] as DataNode<any>)
}

// Component-children normalization: normChildren's vocabulary, EXCEPT a
// FUNCTION child passes through raw (the render-prop protocol — For's row
// fn). String tags use normChildren directly, so a function child of an
// ELEMENT still throws.
function normComponentChildren(children: unknown[]): unknown[] {
  const out: unknown[] = []
  const push = (c: unknown): void => {
    if (typeof c === 'function') {
      out.push(c)
      return
    }
    if (Array.isArray(c)) {
      for (const k of c) push(k)
      return
    }
    for (const v of normChildren([c])) out.push(v)
  }
  for (const c of children) push(c)
  return out
}

// ── h — the classic jsxFactory ───────────────────────────────────────────────

export function h(
  tag: string | Component,
  props: Record<string, unknown> | null,
  ...children: unknown[]
): VNode | VNode[] {
  if (typeof tag === 'function') {
    // JSX children args win over a props.children entry; with no args a
    // props-passed children (e.g. <For children={fn}/>) survives the default.
    const p: Record<string, unknown> =
      children.length > 0
        ? { ...(props ?? {}), children: normComponentChildren(children) }
        : { children: [], ...(props ?? {}) }
    // key never reaches a component (v3 keys rows by DATA identity) — the
    // automatic runtime already drops it (separate arg); strip the classic
    // path's props entry so both routes hand the component identical props.
    delete p.key
    // Structural builtins stay EAGER (Fragment flattens; For/ErrorBoundary
    // validate at construction). Any OTHER function tag is a component —
    // deferred to mount, invoked once under its own scope.
    if (tag === Fragment || tag === For || tag === ErrorBoundary)
      return tag(p as any) as VNode | VNode[]
    return component(tag, p)
  }
  // `key` is accepted-and-IGNORED (v3 keys rows by DATA identity) — strip it
  // here or the renderer would forward it as a literal key="…" DOM attribute.
  // Empty-after-strip collapses to null (byte-parity with a keyless call).
  if (props !== null && props !== undefined && 'key' in props) {
    const { key: _key, ...rest } = props
    props = Object.keys(rest).length > 0 ? rest : null
  }
  return el(tag, props ?? null, ...normChildren(children))
}

// ── Fragment — flattened children, no host element ───────────────────────────

export function Fragment(props: { children?: unknown }): VNode[] {
  const c = props?.children
  return (Array.isArray(c) ? c : c == null ? [] : [c]) as VNode[]
}

// ── ErrorBoundary — <ErrorBoundary fallback={(err, reset) => vnode}>…</ErrorBoundary>
// Eager (structural): returns the boundary() record at construction, so a
// missing fallback throws where the JSX is written, not at mount.

export function ErrorBoundary(props: {
  fallback?: unknown
  children?: unknown
}): VNode {
  const fb = props?.fallback
  if (typeof fb !== 'function')
    throw new Error(
      'data/jsx: <ErrorBoundary> requires fallback={(err, reset) => vnode} — the child to show when the subtree errors',
    )
  const c = props?.children
  return boundary(c ?? [], fb as (err: unknown, reset: () => void) => unknown)
}

// ── For — THE iteration form: <For each={view}>{(row, key) => vnode}</For> ──

export function For(props: { each?: unknown; children?: unknown }): ListNode {
  const each = props?.each
  if (!isViewLike(each))
    throw new Error('data/jsx: <For> requires each={view} — a collection $ handle or DataNode')
  if (viewNodeOf(each).kind === 'scalar')
    throw new Error('data/jsx: <For each={…}> expects a COLLECTION view, got a scalar')
  const c = props?.children
  const kids = Array.isArray(c) ? c : c == null ? [] : [c]
  if (kids.length !== 1 || typeof kids[0] !== 'function')
    throw new Error(
      'data/jsx: <For each={view}> takes exactly ONE child — the row function (row, key) => vnode. ' +
        'Iteration is ONLY For/list(); a bare view child is reactive text, and the v2 [vp, fn] shorthand is gone.',
    )
  return list(each, kids[0] as (row: any, key: RowKey) => VNode)
}
