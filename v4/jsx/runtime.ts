// v3/jsx/runtime.ts — the AUTOMATIC JSX runtime (jsxImportSource form),
// completing the classic h/Fragment/For layer (M4.5b).
//
// A consumer pointing `jsxImportSource` at this module gets `import { jsx,
// jsxs } from '…/jsx/runtime'` injected per .tsx file (TS 5.1+ also resolves
// the per-tag types from this module's exported JSX namespace, below). The
// ONLY difference from the classic transform is the calling convention:
// children arrive INSIDE props.children (a single value or an array) instead
// of as variadic args. So jsx/jsxs/jsxDEV normalize UNIFORMLY through h —
// `h(tag, rest, ...toChildren(children))` for string tags AND components —
// and the two transforms can NEVER produce different records: component
// children (static strings included) go through h's one normComponentChildren
// path, element children through normChildren, exactly as the classic factory.
// jsx vs jsxs is a transform-side static/dynamic-children hint with no
// semantic weight here; both share one body.
//
// THE JSX `key` IS ACCEPTED AND IGNORED — loudly, on purpose. v3 keys list
// rows by DATA identity: the RowKey the kernel's delta stream carries through
// <For each={view}>{(row, key) => …}</For> / list(view, fn). A JSX key (the
// transforms strip a `key` prop into the third argument) has nothing to
// attach to — there is no sibling-diffing reconciler to hint. Passing one is
// legal (the standard transforms always may) and does nothing: the produced
// record is identical with or without it, and it never lands in props.
//
// Fragment is re-exported AS THE SAME INSTANCE from ./index.ts, so classic
// and automatic transforms interoperate without symbol-identity surprises —
// a Fragment-tagged jsx() call hits h's component branch exactly like the
// classic h(Fragment, …) does.

import { h, Fragment } from './index.ts'
import type { Component } from './index.ts'
import type { VNode } from '../render/index.ts'

export { Fragment }

// undefined → [] (h's no-children call — components get the children: []
// default); an array passes through; anything else wraps as the one child.
function toChildren(children: unknown): unknown[] {
  if (children === undefined) return []
  return Array.isArray(children) ? children : [children]
}

// The one body: peel children off props, route through h. Empty leftover
// props collapse to null so the record matches the classic transform's
// `h(tag, null, …)` byte-for-byte (el() keeps the props object it's given).
function transform(
  tag: string | Component,
  props: Record<string, unknown> | null | undefined,
): VNode | VNode[] {
  const { children, ...rest } = props ?? {}
  return h(tag, Object.keys(rest).length > 0 ? rest : null, ...toChildren(children))
}

export function jsx(
  tag: string | Component,
  props: Record<string, unknown> | null | undefined,
  _key?: unknown,
): VNode | VNode[] {
  return transform(tag, props)
}

export function jsxs(
  tag: string | Component,
  props: Record<string, unknown> | null | undefined,
  _key?: unknown,
): VNode | VNode[] {
  return transform(tag, props)
}

export function jsxDEV(
  tag: string | Component,
  props: Record<string, unknown> | null | undefined,
  _key?: unknown,
  _isStaticChildren?: boolean,
  _source?: unknown,
  _self?: unknown,
): VNode | VNode[] {
  return transform(tag, props)
}

// ── JSX types ────────────────────────────────────────────────────────────────
//
// The automatic runtime resolves JSX.IntrinsicElements from the EXPORTED JSX
// namespace of this module (TS 5.1+). It aliases the SAME per-tag interfaces
// as the classic transform, from the shared ./intrinsics.ts, so classic and
// automatic narrow identically and can't drift. Type-only (declare namespace
// + import type) — erased under --experimental-strip-types.
import type * as I from './intrinsics.ts'

export declare namespace JSX {
  export type Element = I.Element
  export type IntrinsicElements = I.IntrinsicElements
  export type ElementChildrenAttribute = I.ElementChildrenAttribute
  export type IntrinsicAttributes = I.IntrinsicAttributes
}
