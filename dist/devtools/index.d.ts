export { $ } from '../core-B_dKpJF4.js';

declare function classify(sink: any): "operator" | "dom" | "connect" | "sink";
declare function summarize(value: any): any;
declare function ancestorOf(child: any, root: any, maxDepth?: number): boolean;
declare function walk(view: any, opts: any): {
    key: any[];
    name: any;
    kind: string;
    value: any;
    children: never[];
    sinks: never[];
} | {
    key: any[];
    kind: string;
    children: never[];
    sinks: never[];
    name?: undefined;
    aliasOf?: undefined;
} | {
    key: any[];
    name: any;
    kind: string;
    aliasOf: any[];
    children: never[];
    sinks: never[];
};

export { ancestorOf, classify, summarize, walk };
