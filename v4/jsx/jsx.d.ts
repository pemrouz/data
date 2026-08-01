// v3/jsx/jsx.d.ts — classic-transform JSX declarations for the v3 layer
// (jsxFactory "h", jsxFragmentFactory "Fragment" — v3/jsx/index.ts).
//
// This file only re-exposes the shared ./intrinsics.ts surface (the SINGLE
// SOURCE OF TRUTH the automatic runtime will alias too, so the two transforms
// can never drift) on the GLOBAL `JSX` namespace the classic transform reads.
// The `import type` is fine in a .d.ts — declaration files never execute.
//
// SCOPE WARNING — this file is picked up ONLY by programs that explicitly
// `include` it (the v3 classic JSX fixture gate and v3 JSX example
// tsconfigs). It must NEVER enter a v2 gate program: the v2 classic transform
// declares its OWN global JSX in /jsx/jsx.d.ts, and TypeScript merges global
// namespaces across every loaded source — loading both puts two conflicting
// Element/IntrinsicElements aliases in one program (duplicate-identifier
// errors, or worse, the wrong surface winning silently via skipLibCheck).
import type * as I from './intrinsics.ts'

export {}

declare global {
  namespace JSX {
    type Element = I.Element
    type IntrinsicElements = I.IntrinsicElements
    type ElementChildrenAttribute = I.ElementChildrenAttribute
    type IntrinsicAttributes = I.IntrinsicAttributes
  }
}
