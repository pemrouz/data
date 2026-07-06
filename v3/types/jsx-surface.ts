// v3/types/jsx-surface.ts — DECLARATION-LEVEL typed facades for the classic
// JSX authoring surface (h / Fragment / For, plus the two render entry points
// fixtures reach for in props/children: bind / text). ZERO runtime code —
// every export is `declare`d, so nothing executes and nothing imports the
// implementation: the real v3/jsx/index.ts + render/index.ts statically pull
// kernel/runtime.ts (and the seam), which carry known FROZEN type errors —
// see surface.ts's typedDollar note — so a static import would fail this
// gate's program on files it doesn't own. These signatures are the CONTRACT
// the fixtures check; the runtime modules carry the real bodies.
//
// Tied to the typed surface on purpose: For is generic over surface.ts's
// View<T>/RowOf<T>, so a fixture proves ROW TYPE INFERENCE — the children
// fn's row param flows from each={aTypedView} with no annotation (the same
// inference the v2 For gate asserts). bind/text are generic over View<V> so
// the format fn's param infers from the bound view's value type. Return
// types are the STRUCTURAL stand-ins from ../jsx/intrinsics.ts (BindLike /
// VNodeLike / Element) — intrinsics.ts is a pure type module with zero
// imports, so aliasing it leaks no implementation either.

import type * as I from '../jsx/intrinsics.ts'
import type { View, RowOf, RowKey } from './surface.ts'

// A function component: called as tag({ ...props, children }).
export type Component<P = any> = (props: P) => I.Element

// h — the classic jsxFactory. STRING tags take normChildren's child
// vocabulary (ChildLike excludes functions — the compile-time mirror of the
// runtime's unsupported-child throw); COMPONENT tags take children RAW (the
// render-prop protocol For itself relies on).
export declare function h(
  tag: string,
  props: Record<string, unknown> | null,
  ...children: I.ChildLike[]
): I.Element
export declare function h<P>(
  tag: Component<P>,
  props: P | null,
  ...children: unknown[]
): I.Element

// Fragment — returns its children array; flattens into any parent.
export declare function Fragment(props: { children?: unknown }): I.Element

// For — THE iteration form: <For each={view}>{(row, key) => vnode}</For>.
// `each` is REQUIRED and the single child MUST be the row fn — both encoded
// here so the fixture negatives mirror the runtime's two <For> throws. T
// infers from each's View, so the row param is RowOf<T> with no annotation
// (an OrderedData<T> = View<RowOf<T>[]> lands on the same row type).
export declare function For<T>(props: {
  each: View<T>
  children: (row: RowOf<T>, key: RowKey) => I.Element
}): I.Element

// bind — a reactive PROP value (render/index.ts's BindProp, discriminated on
// kind:'bind'); the format fn's param infers from the bound view.
export declare function bind<V>(view: View<V>, fn?: (v: V) => unknown): I.BindLike

// text — a reactive TEXT child (render/index.ts's RTextNode); same inference.
export declare function text<V>(view: View<V>, fn?: (v: V) => unknown): I.VNodeLike
