// v3/types/jsx-runtime-decl.d.ts — the AUTOMATIC gate's `paths` target: what
// `jsxImportSource: "data/v3"` resolves for `data/v3/jsx-runtime` in
// tsconfig.auto.json. A DECLARATION-ONLY twin of v3/jsx/runtime.ts: the real
// runtime statically imports the implementation (kernel/runtime.ts et al —
// strip-types-only, with known frozen type errors; see surface.ts's
// typedDollar note), so resolving the real module would fail the gate on
// files it doesn't own. This shim declares the SAME contract — jsx / jsxs /
// jsxDEV / Fragment plus the exported JSX namespace — aliasing the SAME
// shared ../jsx/intrinsics.ts (a pure type module with zero imports, so
// nothing leaks in), which is what makes the automatic surface literally
// unable to drift from the classic gate's. Keep the export names in
// lockstep with v3/jsx/runtime.ts.

import type * as I from '../jsx/intrinsics.ts'

export declare function jsx(
  tag: string | ((props: any) => I.Element),
  props: Record<string, unknown> | null | undefined,
  key?: unknown,
): I.Element

export declare function jsxs(
  tag: string | ((props: any) => I.Element),
  props: Record<string, unknown> | null | undefined,
  key?: unknown,
): I.Element

export declare function jsxDEV(
  tag: string | ((props: any) => I.Element),
  props: Record<string, unknown> | null | undefined,
  key?: unknown,
  isStaticChildren?: boolean,
  source?: unknown,
  self?: unknown,
): I.Element

export declare function Fragment(props: { children?: unknown }): I.Element

// TS 5.1+ reads the per-tag types from the runtime module's EXPORTED JSX
// namespace (not the global one — the classic ../jsx/jsx.d.ts never enters
// the automatic program).
export declare namespace JSX {
  type Element = I.Element
  type IntrinsicElements = I.IntrinsicElements
  type ElementChildrenAttribute = I.ElementChildrenAttribute
  type IntrinsicAttributes = I.IntrinsicAttributes
}
