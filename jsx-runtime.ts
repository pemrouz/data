// Automatic JSX runtime entry. A consumer enabling
// `"jsxImportSource": "data"` in tsconfig.json gets `import { jsx, jsxs,
// Fragment } from "data/jsx-runtime"` injected at every .tsx file with no
// manual import — same NodeProxy AST and DOMSink behavior as the classic
// `h` transform, see jsx/index.ts. The Fragment/jsx/jsxs symbols are the
// same instances re-exported from jsx/index.ts (and from data/full), so
// classic and automatic runtimes interoperate without symbol-identity
// surprises.
export { jsx, jsxs, Fragment } from './jsx/index.ts'
