// Classic-transform JSX type declarations (jsxFactory "h", jsxFragmentFactory
// "Fragment"), configured at tsconfig.jsx.json. Picked up automatically by any
// .tsx in this repo because TypeScript merges the global JSX namespace across
// all loaded sources.
//
// The per-tag attribute interfaces and the `IntrinsicElements` map now live in
// the shared ./intrinsics.ts (the SINGLE SOURCE OF TRUTH), which the automatic
// runtime (jsx-runtime.ts) consumes too — so the classic and automatic
// transforms can never drift into different safety levels (they used to: the
// automatic runtime was an all-`any` bag). This file just re-exposes the shared
// surface on the GLOBAL `JSX` namespace that the classic transform reads.
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
