// @ts-nocheck
// Lean entry: core surface only — no operator dispatch is registered here.
// The default entry (`data`) registers every operator so chainable methods
// (`proxy.filter(...)`, `proxy.between(...)`, …) work out of the box; import
// THIS entry (`data/lean`) only when you're optimising bundle size and either
// call the function-style API exported by individual operator modules or
// register a hand-picked subset of operators onto `Operators` yourself.
// Keeping the registration out of this entry lets bundlers tree-shake the
// operator code a size-conscious consumer doesn't use.
export { $, value, reactive, view, Sink, Operators, createOperator } from './core.ts'
export { default } from './core.ts'
export { render, HTML, SVG } from './render/index.ts'
