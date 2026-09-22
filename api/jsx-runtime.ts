// The automatic-runtime ENTRY (data/jsx-runtime, data/jsx-dev-runtime): a thin
// re-export of the jsx layer, nothing else.
//
// WHY THIN: dist is the sources type-stripped file-for-file (build.mjs), so
// dist/api/jsx-runtime.js imports the SAME ../jsx/runtime.js — and through it
// the same kernel — as dist/api/index.js: one module instance. A self-contained
// duplicate would carry its own kernel classes and Symbol-keyed handles —
// `instanceof DataNode` across the boundary breaks, exactly the v2 "examples
// must import from a SINGLE entry" trap. Solved structurally: this entry has no
// code of its own to duplicate.
export { jsx, jsxs, jsxDEV, Fragment } from '../jsx/runtime.ts'
// The per-tag type surface rides along for source-path consumers pointing
// jsxImportSource here (TS reads the resolved module's exported JSX
// namespace); npm consumers get it from the shipped types/jsx-runtime.d.ts
// (exports["./jsx-runtime"].types), which aliases public.d.ts's surface.
export type { JSX } from '../jsx/runtime.ts'
