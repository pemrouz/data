import { defineConfig } from 'tsup'
import path from 'node:path'

// THE FLIP (2026-07-12): v3 is the library. The bare `data` specifier — and
// dist/index.js — is the v3 bundle; v2 moved WHOLE to ./dist/v2/* (frozen but
// green: the v2 gallery examples, flow/multidim, and the landing page still
// run on it via pinned importmaps until each surface migrates).
//
//   data                  → ./dist/index.js               (v3: $, ops, render, builders, JSX, seam)
//   data/jsx-runtime      → ./dist/jsx-runtime.js         (v3 automatic runtime — thin re-export)
//   data/jsx-dev-runtime  → ./dist/jsx-runtime.js         (same file; it exports jsxDEV)
//   data/devtools         → ./dist/devtools.js            (v3 inspection layer + panel)
//   data/v3[...]          → transitional ALIASES of the three above (same files,
//                           same module instance) so pre-flip consumers keep working
//   data/v2               → ./dist/v2/index.js            (the frozen v2 default entry)
//   data/v2/lean|full|render|devtools|devtools/panel|jsx-runtime|jsx-dev-runtime
//                         → ./dist/v2/*                   (the whole old surface, shifted)
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
  // v2 — the whole pre-flip surface, shifted under dist/v2/. Entry KEYS carry
  // the v2/ prefix so relative structure (devtools → ./panel/index.js lazy
  // import) is preserved; the sources are untouched.
  {
    entry: {
      'v2/index': 'index.ts',
      'v2/lean': 'lean.ts',
      'v2/full': 'full.ts',
      'v2/render/index': 'render/index.ts',
      'v2/devtools/index': 'devtools/index.ts',
      'v2/devtools/panel/index': 'devtools/panel/index.ts',
      'v2/jsx-runtime': 'jsx-runtime.ts',
      'v2/jsx-dev-runtime': 'jsx-dev-runtime.ts',
    },
    format: ['esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    target: 'es2022',
    treeshake: true,
  },
  // v3 — THE main bundle at dist/index.js. Generated dts stays off; the
  // shipped types are the hand-maintained v3/types/public.d.ts (wired via
  // the exports map), gated by tsc -p v3/types/tsconfig.public.json.
  // clean: false so this config doesn't wipe the first config's output.
  {
    entry: { index: 'v3/api/index.ts' },
    format: ['esm'],
    dts: false,
    splitting: false,
    sourcemap: true,
    clean: false,
    target: 'es2022',
    treeshake: true,
  },
  // data/jsx-runtime — the automatic JSX runtime entry, emitted as a THIN
  // re-export over dist/index.js rather than a self-contained bundle. A
  // duplicate bundle would carry its own kernel classes (instanceof breaks
  // across the boundary — the v2 single-entry trap); the rewrite plugin
  // externalizes the jsx-layer import and points it at the sibling main
  // bundle, so both entries share one module instance. The main bundle
  // exports jsx/jsxs/jsxDEV/Fragment for exactly this reason (v3/api/index.ts).
  // data/devtools — the inspection layer + panel. Bundles v3/devtools/**
  // ONLY; every import that resolves OUTSIDE v3/devtools/ is externalized to
  // the sibling main bundle (single module instance — same rule as the
  // jsx-runtime entry; the api entry re-exports the value-level internals the
  // devtools layer needs: DataNode, Runtime, materialize, domLinks, liveLists).
  {
    entry: { devtools: 'v3/devtools/entry.ts' },
    format: ['esm'],
    dts: false,
    splitting: false,
    sourcemap: true,
    clean: false,
    target: 'es2022',
    esbuildPlugins: [
      {
        name: 'v3-devtools-shared-core',
        setup(build) {
          const dtDir = path.resolve('v3/devtools')
          build.onResolve({ filter: /^\./ }, (args: any) => {
            const p = path.resolve(args.resolveDir, args.path)
            if (p === dtDir || p.startsWith(dtDir + path.sep)) return null // stays in-bundle
            return { path: './index.js', external: true }
          })
        },
      },
    ],
  },
  {
    entry: { 'jsx-runtime': 'v3/api/jsx-runtime.ts' },
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
