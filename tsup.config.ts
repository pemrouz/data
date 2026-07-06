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
export default defineConfig([
  {
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
  },
  // The v3 rewrite (branch v3): one self-contained browser bundle so the
  // migrated examples can import it via their importmaps ("data/v3" →
  // ../../dist/v3/index.js). dts deliberately off — v3's typed surface is the
  // fixture-gated v3/types (npx tsc -p v3/types), not generated declarations.
  // clean: false so this config doesn't wipe the first config's output.
  {
    entry: { 'v3/index': 'v3/api/index.ts' },
    format: ['esm'],
    dts: false,
    splitting: false,
    sourcemap: true,
    clean: false,
    target: 'es2022',
    treeshake: true,
  },
  // data/v3/jsx-runtime — the automatic JSX runtime entry, emitted as a THIN
  // re-export over dist/v3/index.js rather than a self-contained bundle. A
  // duplicate bundle would carry its own kernel classes (instanceof breaks
  // across the boundary — the v2 single-entry trap); the rewrite plugin
  // externalizes the jsx-layer import and points it at the sibling main
  // bundle, so both entries share one module instance. The main bundle
  // exports jsx/jsxs/jsxDEV/Fragment for exactly this reason (v3/api/index.ts).
  {
    entry: { 'v3/jsx-runtime': 'v3/api/jsx-runtime.ts' },
    format: ['esm'],
    dts: false,
    splitting: false,
    sourcemap: true,
    clean: false,
    target: 'es2022',
    esbuildPlugins: [
      {
        name: 'v3-jsx-runtime-thin',
        setup(build) {
          build.onResolve({ filter: /^\.\.\/jsx\/runtime\.ts$/ }, () => ({
            path: './index.js',
            external: true,
          }))
        },
      },
    ],
  },
])
