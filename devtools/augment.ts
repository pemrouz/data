// Type augmentation for the opt-in `data/devtools` entry. The inspection helpers
// are ATTACHED to the canonical `$` at runtime in ./index.ts; this `declare
// module` merge teaches the type system about them, so `$.inspect(...)`,
// `$.graph()`, etc. are typed when (and only when) a program imports
// `data/devtools`. Kept in its own module (NOT @ts-nocheck) so the augmentation
// is actually processed; ./index.ts imports it for the side effect.
import type {} from '../core.ts'

declare module '../core.ts' {
  interface Dollar {
    /** Print + return a single-view snapshot (immediate children + sinks). */
    inspect(proxy: any): any
    /** DFS the View graph from `proxy`, or from every root if omitted. */
    graph(proxy?: any, opts?: any): any
    /** Resolve the ViewProxy bound to a DOM element (e.g. the console's `$0`). */
    fromDOM(el: any): any
    /** Flash the DOM sinks whose source view matches `proxy`. */
    highlight(proxy: any, ms?: number): void
    /** Install a trace listener over the subtree rooted at `proxy`. */
    trace(proxy: any, opts?: any): any
    /** Start collecting per-operator counts/timings; returns a controller. */
    profile(proxy?: any, opts?: any): any
    /** Start recording propagation cascades; returns a controller. */
    cascades(proxy?: any, opts?: any): any
    /** Lazy-mounted overlay panel control surface. */
    devtools?: any
  }
}
