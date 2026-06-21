// Ambient module declarations for the peer libraries the comparison bench
// imports but which ship no types in this setup (no @types/* installed, or a
// deep .js subpath with no declarations). Declaring them `any` here is cleaner
// than a `// @ts-ignore` on each of the ~50 dynamic `await import(...)` sites.
// Bench code is report-only and loosely typed against each peer's API anyway.
declare module 'react'
declare module 'react-test-renderer'
declare module 'solid-js/dist/solid.js'
