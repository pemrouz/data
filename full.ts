// JSX-authoring superset of `data`: re-exports the entire default entry
// (`./index.ts` = core + render + every operator registered) and adds the JSX
// layer on top. Import this entry when you author views in JSX.
//
// JSX is re-exported here (rather than as its own dist entry) so the host
// element identity (NodeProxy class, NODE/view symbols) stays shared with
// `render`, `HTML`, `SVG`. With separate bundles, each entry gets its own
// NodeProxy class and `instanceof` checks across bundles fail — folding JSX
// into `data/full` keeps everything one bundle, one identity.
//
// The bare `import './register.ts'` is load-bearing under `splitting:false`:
// tsup dedupes the side effects of modules re-exported via `export *` (so the
// operator registrations would otherwise be "owned" by `dist/index.js` and
// elided from `dist/full.js`). A direct bare import of the side-effect-only
// `register.ts` is NOT subject to that dedup — tsup must include it in every
// entry that imports it. The result: `dist/full.js` is genuinely self-contained.
import './register.ts'
export * from './index.ts'
export { h, Fragment, For, jsx, jsxs, jsxDEV } from './jsx/index.ts'
