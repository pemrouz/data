// @ts-nocheck
// Lean entry: core surface only — no operator dispatch is registered here.
// Importers that want chainable operators (`proxy.filter(...)`, `proxy.between(...)`,
// etc.) should import `data/full` instead, which loads this module *and* registers
// every operator on the global Operators dispatch table. Keeping that registration
// out of the root entry lets bundlers tree-shake operator code consumers don't use.
export { $, value, reactive, view, Sink, Operators, createOperator } from './core.ts'
export { default } from './core.ts'
export { render, HTML, SVG } from './render/index.ts'
