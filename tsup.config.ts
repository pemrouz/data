import { defineConfig } from 'tsup'

// Seven entries that line up with the "exports" map in package.json:
//   data                  → ./dist/index.js              (lean core, no operator dispatch)
//   data/full             → ./dist/full.js               (registers every operator on import)
//   data/render           → ./dist/render/index.js
//   data/devtools         → ./dist/devtools/index.js     (opt-in inspection helpers)
//   data/devtools/panel   → ./dist/devtools/panel/index.js (overlay UI)
//   data/jsx-runtime      → ./dist/jsx-runtime.js         (automatic JSX runtime)
//   data/jsx-dev-runtime  → ./dist/jsx-dev-runtime.js     (dev-mode auto runtime)
// `splitting: true` so the panel module ships as its own chunk and the
// dynamic import() in devtools/index.ts can lazy-load it (and consumers
// who only want the console API don't pay the panel's bytes upfront).
// ESM-only for now. Add 'cjs' to `format` later if a real consumer asks.
export default defineConfig({
  entry: [
    'index.ts',
    'full.ts',
    'render/index.ts',
    'devtools/index.ts',
    'devtools/panel/index.ts',
    'jsx-runtime.ts',
    'jsx-dev-runtime.ts',
  ],
  format: ['esm'],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  treeshake: true,
})
