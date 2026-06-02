import { defineConfig } from 'tsup'

// Eight entries that line up with the "exports" map in package.json:
//   data                  → ./dist/index.js              (default: core + render + all operators registered)
//   data/lean             → ./dist/lean.js               (registration-free core, for tree-shaking)
//   data/full             → ./dist/full.js               (data + JSX authoring layer)
//   data/render           → ./dist/render/index.js
//   data/devtools         → ./dist/devtools/index.js     (opt-in inspection helpers)
//   data/devtools/panel   → ./dist/devtools/panel/index.js (overlay UI)
//   data/jsx-runtime      → ./dist/jsx-runtime.js         (automatic JSX runtime)
//   data/jsx-dev-runtime  → ./dist/jsx-dev-runtime.js     (dev-mode auto runtime)
// `splitting: false`: each entry is a self-contained bundle, no shared chunks.
//
// The previous chunked layout (`splitting: true`) emitted `import './chunk-*.js'`
// bare-import statements in `dist/index.js` and `dist/full.js` to thread shared
// code (including the operator registrations) across entries. That worked under
// Node but was fragile under downstream bundlers like esbuild: they tree-shake
// `chunk-*.js` bare-imports unless told otherwise via `pkg.sideEffects`, and
// esbuild silently ignores glob/explicit chunk paths added to `sideEffects` —
// so browser bundles ended up with an empty `Operators` table and "Unknown
// operator 'filter'" runtime errors. The fix on the ripple side was
// `ignoreAnnotations: true` in its esbuild config; with this layout that hack
// becomes unnecessary.
//
// The operator registrations now live in a dedicated side-effect-only
// `./register.ts` that `index.ts` and `full.ts` both bare-import directly.
// tsup dedupes the top-level side effects of modules consumed via `export *`
// (so registering inline in `index.ts` would still elide them from `full.js`);
// a direct bare import is NOT subject to that dedup, so each entry's compiled
// dist gets its own copy of `register.ts`'s content.
//
// Trade-off: shared code (core, the operator class definitions) is duplicated
// across entries on disk. Downstream consumers are unaffected — they import one
// entry — but the package install size grows by ~the size of the largest
// shared chunk × the number of entries that use it. The ergonomic + downstream-
// correctness wins outweigh the disk cost.
//
// ESM-only for now. Add 'cjs' to `format` later if a real consumer asks.
export default defineConfig({
  entry: [
    'index.ts',
    'lean.ts',
    'full.ts',
    'render/index.ts',
    'devtools/index.ts',
    'devtools/panel/index.ts',
    'jsx-runtime.ts',
    'jsx-dev-runtime.ts',
  ],
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  treeshake: true,
})
