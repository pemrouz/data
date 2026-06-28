export { $ } from '../core-B6UvChJ_.js';

declare module '../core.ts' {
    interface Dollar {
        /** Print + return a single-view snapshot (immediate children + sinks). */
        inspect(proxy: any): any;
        /** DFS the View graph from `proxy`, or from every root if omitted. */
        graph(proxy?: any, opts?: any): any;
        /** Resolve the ViewProxy bound to a DOM element (e.g. the console's `$0`). */
        fromDOM(el: any): any;
        /** Flash the DOM sinks whose source view matches `proxy`. */
        highlight(proxy: any, ms?: number): void;
        /** Install a trace listener over the subtree rooted at `proxy`. */
        trace(proxy: any, opts?: any): any;
        /** Start collecting per-operator counts/timings; returns a controller. */
        profile(proxy?: any, opts?: any): any;
        /** Start recording propagation cascades; returns a controller. */
        cascades(proxy?: any, opts?: any): any;
        /** Lazy-mounted overlay panel control surface. */
        devtools?: any;
    }
}

declare function classify(sink: any): "operator" | "dom" | "connect" | "sink";
declare function summarize(value: any): any;
declare function ancestorOf(child: any, root: any, maxDepth?: number): boolean;
declare function walk(view: any, opts?: any): any;

export { ancestorOf, classify, summarize, walk };
