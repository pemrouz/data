// JSX type declarations for the classic transform configured at
// jsx/tsconfig.json (jsxFactory: "h", jsxFragmentFactory: "Fragment").
// Picked up automatically by any .tsx in this repo because TypeScript
// merges the global JSX namespace across all loaded sources.
//
// IntrinsicElements is open: any tag is allowed and any attribute is
// permitted on it. We don't enumerate the per-tag attribute list because
// the runtime accepts arbitrary attrs (className/class/style/on*Event/
// data-*/aria-*/SVG presentation attrs) — typing them strictly here would
// fight the runtime's permissiveness without preventing a real bug class.
// Element is `any` for the same reason: NodeProxy is a Proxy so static
// shape doesn't help.
//
// To opt into stricter per-tag types later: replace the index signature
// with named interfaces (e.g. `div: { className?: string; ... }`) and
// drop @ts-nocheck from the .tsx file you want type-checked.

export {}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      [tag: string]: any
    }
    type Element = any
    interface ElementChildrenAttribute {
      children: {}
    }
  }
}
