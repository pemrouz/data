// Default entry (`data`): the lean core surface re-exported from `./lean.ts`,
// PLUS every operator registered on the global Operators dispatch table — so
// chainable methods (`proxy.filter(...)`, `proxy.between(...)`, …) work the
// moment you `import { $ } from 'data'`. This is the entry you want unless you
// are optimising bundle size, in which case import the registration-free core
// from `data/lean`. JSX authoring lives one level up in `data/full`.
//
// The operator registrations themselves live in `./register.ts` (a side-effect-
// only module). Keeping them there — rather than inline here — lets `data/full`
// import the same registrations via a direct bare side-effect import, so each
// compiled entry contains its own copy in dist. (If they lived inline here,
// tsup's `export * from './index.ts'` re-export semantics would dedupe them
// out of `dist/full.js`.)
import './register.ts'
export * from './lean.ts'
