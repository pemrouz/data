// The automatic-runtime ENTRY (data/v3/jsx-runtime): a thin re-export of the
// jsx layer, nothing else.
//
// WHY THIN: in dist this compiles to `export … from './index.js'` (see the
// rewrite plugin in tsup.config.ts) so the jsx-runtime bundle and the main
// data/v3 bundle share ONE module instance. A self-contained duplicate bundle
// would carry its own kernel classes and Symbol-keyed handles — `instanceof
// DataNode` across the boundary breaks, exactly the v2 "examples must import
// from a SINGLE entry" trap. v3 solves it structurally: this entry has no
// code of its own to duplicate.
export { jsx, jsxs, jsxDEV, Fragment } from '../jsx/runtime.ts'
// The per-tag type surface rides along for source-path consumers pointing
// jsxImportSource here (TS reads the resolved module's exported JSX
// namespace); dist ships no v3 d.ts, so published consumers get types from
// the fixture-gated surface instead.
export type { JSX } from '../jsx/runtime.ts'
