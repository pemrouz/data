// types/jsx-runtime.d.ts — the SHIPPED types for 'data/jsx-runtime' AND
// 'data/jsx-dev-runtime' (package.json points both subpaths' `types` here):
// what a consumer's tsc resolves for the automatic JSX transform under
// jsxImportSource: "data" (jsx "react-jsx" / "react-jsxdev"). The runtime
// behind it is dist/api/jsx-runtime.js — api/jsx-runtime.ts type-stripped, a
// thin re-export of the jsx layer — and this file is its declaration twin:
// keep the export names in LOCKSTEP with api/jsx-runtime.ts — jsx / jsxs /
// jsxDEV / Fragment (values) + the JSX namespace (types).
//
// SELF-CONTAINED for node_modules: only public.d.ts ships next to it, so the
// one import is './public.js' — the relative specifier every moduleResolution
// (nodenext / bundler / node10) substitutes to ./public.d.ts. NOTHING is
// declared here that public.d.ts could hold: the four verbs are RE-EXPORTED
// (one declaration each — the transform-injected Fragment and `import {
// Fragment } from 'data'` are the same symbol), and the JSX namespace only
// ALIASES public.d.ts's per-tag surface (its inlined jsx/intrinsics.ts
// mirror, itself pinned by check.public.lockstep.ts). That is the shipped
// form of the jsx-runtime-decl.d.ts design: the automatic transform gates
// against the SAME per-tag surface the classic h is typed over — it cannot
// drift, because there is one definition.
//
// TS 5.1+ reads the per-tag types from THIS module's EXPORTED JSX namespace,
// never a global one — public.d.ts declares no global JSX, so a consumer's
// React (or other) JSX types are untouched.
//
// Gate: types/tsconfig.public.json maps 'data/jsx-runtime' and
// 'data/jsx-dev-runtime' here via paths and compiles check.public.tsx under
// jsx "react-jsx" + jsxImportSource "data" (skipLibCheck off — this file is
// checked too).

import type * as P from './public.js'

export { jsx, jsxs, jsxDEV, Fragment } from './public.js'

export declare namespace JSX {
  type Element = P.Element
  type IntrinsicElements = P.IntrinsicElements
  type ElementChildrenAttribute = P.ElementChildrenAttribute
  type IntrinsicAttributes = P.IntrinsicAttributes
}
