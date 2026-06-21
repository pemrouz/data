// Automatic JSX runtime entry. A consumer enabling
// `"jsxImportSource": "data"` in tsconfig.json gets `import { jsx, jsxs,
// Fragment } from "data/jsx-runtime"` injected at every .tsx file with no
// manual import — same NodeProxy AST and DOMSink behavior as the classic
// `h` transform, see jsx/index.ts. The Fragment/jsx/jsxs symbols are the
// same instances re-exported from jsx/index.ts (and from data/full), so
// classic and automatic runtimes interoperate without symbol-identity
// surprises.
export { jsx, jsxs, Fragment } from './jsx/index.ts'

// The automatic runtime resolves `JSX.IntrinsicElements` from the EXPORTED `JSX`
// namespace of this module (TS 5.1+). Without it, every JSX element under
// `jsxImportSource: "data"` errored TS7026 ("no interface
// JSX.IntrinsicElements exists"), making the published entry unusable.
//
// It now aliases the SAME per-tag interfaces as the classic transform, from the
// shared ./jsx/intrinsics.ts — so the automatic runtime gains full per-tag
// narrowing (a bad `<input type>`, a wrong-typed prop, etc. are caught) instead
// of the all-`any` prop bag it used to expose, and classic/automatic can't
// drift. tsup's rollup-dts inlines the shared interfaces into the emitted
// dist/jsx-runtime.d.ts.
import type * as I from './jsx/intrinsics.ts'

export namespace JSX {
  export type Element = I.Element
  export type IntrinsicElements = I.IntrinsicElements
  export type ElementChildrenAttribute = I.ElementChildrenAttribute
  export type IntrinsicAttributes = I.IntrinsicAttributes
}
