// Dev-mode automatic JSX runtime. TypeScript / esbuild with
// `"jsx": "react-jsxdev"` (or development mode) emits
// `import { jsxDEV, Fragment } from "data/jsx-dev-runtime"` at every .tsx
// file. Same body as the production runtime — `jsxDEV` is aliased to the
// shared `_jsx` shim in jsx/index.ts because we don't surface dev-only
// debugging metadata (source location, key checks). If a consumer wants
// those, the production runtime is identical and equally functional.
export { jsxDEV, Fragment } from './jsx/index.ts'
