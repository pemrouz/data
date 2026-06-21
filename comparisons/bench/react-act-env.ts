// Side-effect-only module: declares to React that we're in an act() environment
// so it doesn't print the warning on every render. Imported FIRST in
// react.bench.ts so this assignment evaluates before `react` is loaded —
// ESM hoists `import` statements but evaluates side-effect-only imports in
// source order, so this is the reliable way to set the flag pre-React.
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
export {}
