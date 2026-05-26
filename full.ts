// @ts-nocheck
// JSX-authoring superset of `data`: re-exports the entire default entry
// (`./index.ts` = core + render + every operator registered) and adds the JSX
// layer on top. Import this entry when you author views in JSX.
//
// JSX is re-exported here (rather than as its own dist entry) so the host
// element identity (NodeProxy class, NODE/view symbols) stays shared with
// `render`, `HTML`, `SVG`. With separate bundles, each entry gets its own
// NodeProxy class and `instanceof` checks across bundles fail — folding JSX
// into `data/full` keeps everything one bundle, one identity.
export * from './index.ts'
export { h, Fragment, For, jsx, jsxs, jsxDEV } from './jsx/index.ts'
