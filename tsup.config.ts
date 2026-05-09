import { defineConfig } from 'tsup'

// Three entries that line up with the "exports" map in package.json:
//   data        → ./dist/index.js   (lean core, no operator dispatch)
//   data/full   → ./dist/full.js    (registers every operator on import)
//   data/render → ./dist/render/index.js
// ESM-only for now. Add 'cjs' to `format` later if a real consumer asks.
export default defineConfig({
  entry: ['index.ts', 'full.ts', 'render/index.ts'],
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  treeshake: true,
})
