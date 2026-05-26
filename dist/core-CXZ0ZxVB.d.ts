/**
 * Symbol key for reading/writing a proxy's raw underlying value.
 *
 * Use `proxy[value]` to read the snapshot and `proxy[value] = next` to replace
 * it. Read with the symbol, **not** `proxy.value` — any string-named access on a
 * ViewProxy creates a child view, so `proxy.value` would make a child named
 * "value" rather than returning the data.
 *
 * @example
 * import { $, value } from 'data'
 * const n = $(41)
 * n[value]        // 41
 * n[value] = 42   // now 42
 */
declare const value: unique symbol;
declare const reactive: unique symbol;
declare const view: unique symbol;
/**
 * Operator dispatch table: maps an operator name to a factory that picks the
 * implementation class by argument shape. Populated by the default `data`
 * entry (and `data/full`) on import; the `data/lean` entry leaves it empty.
 * Register onto it directly only if you import `data/lean` and want a
 * hand-picked subset of operators: `Operators['filter'] = () => FilterValue`.
 */
declare const Operators: Record<string, (...args: any[]) => any>;
/**
 * Wrap a value or collection in a reactive `ViewProxy`.
 *
 * Read the raw value with `proxy[value]` (the {@link value} symbol). Mutate by
 * assignment — `proxy.foo = 1`, `proxy[0].done = true`, `delete proxy[1]`,
 * `proxy[value] = next` — including nested paths; the right update cascade
 * fires automatically. Derive reactive views with chainable operators
 * (`filter`, `between`, `map`, `length`, `sum`, …), which are registered when
 * you import from `data` or `data/full`.
 *
 * @example
 * import { $, value } from 'data'
 * const rows = $([{ n: 1 }, { n: 5 }, { n: 9 }])
 * const big  = rows.filter(d => d.n > 3).length()
 * big[value]      // 2
 * rows[0].n = 10  // views update incrementally
 */
declare const $: {
    <T>(v: T): Data<T>;
    random(o: any): string | number;
};

/**
 * Low-level escape hatch for building a derived view from a custom `Operator`
 * subclass without going through the named dispatch table — `createOperator(src,
 * MyOperatorClass, ...args)`. Most code should use the chainable operators
 * (`src.filter(...)`) instead; reach for this only when authoring a new
 * operator or wiring one that isn't registered. See operators/README.md.
 */
declare function createOperator(source: any, OperatorClass: any, ...args: any[]): ViewProxy;
type RowOf<T> = T extends Record<any, infer R> ? R : never;
type Data<T = any> = {
    [k in keyof T]: Data<T[k]>;
} & {
    [value]?: T;
    connect([]: Iterable<any, void, undefined>): [];
    connect({}: {}): {};
    connect(Function: any): Function;
    raf(): ((value: T) => void) & {
        flush(): void;
    };
    first(): Data<RowOf<T>>;
    last(): Data<RowOf<T>>;
    update(value: T): undefined;
    update(value: any, key: string[]): undefined;
    insert(value: RowOf<T>): undefined;
    insert(value: any, key: string[]): undefined;
    remove(key?: string[]): undefined;
    filter(arg: object): Data<T>;
    filter(key: string, value: any): Data<T>;
    filter(fn: (row: RowOf<T>) => boolean): Data<T>;
    between(key: string, [lo, hi]: [number, number]): Data<T>;
    to<R>(fn: (value: T) => R): Data<R>;
    map<R>(fn: (row: RowOf<T>) => R): Data<Record<string, R>>;
    length(): Data<number>;
    length<R>(fn: (row: RowOf<T>) => R): Data<Record<R, number>>;
    sum(col?: string): Data<number>;
    avg(col?: string): Data<number>;
    max(col?: string): Data<any>;
    min(col?: string): Data<any>;
    some(fn: (row: RowOf<T>) => boolean): Data<boolean>;
    every(fn: (row: RowOf<T>) => boolean): Data<boolean>;
    tap(fn: (change: {
        type: 'update' | 'insert' | 'remove';
        key: string[];
        value: any;
        at?: any;
    }) => void): Data<T>;
    distinct<K = RowOf<T>>(fn?: (row: RowOf<T>) => K): Data<RowOf<T>[]>;
    reduce<R>(fn: (acc: R, row: RowOf<T>, key: string) => R, init: R): Data<R>;
    union(...sources: Data[]): Data<T>;
    except(other: Data): Data<T>;
    keys(): Data<string[]>;
    values(): Data<RowOf<T>[]>;
    reverse(): Data<RowOf<T>[]>;
    za(column: string, max?: number): Data<T>;
    za(max?: number): Data<T>;
    az(column: string, max?: number): Data<T>;
    az(max?: number): Data<T>;
    top(max?: number): Data<T>;
    limit(max: number): Data<T>;
    intersect(...sources: Data[]): Data<T>;
    group<R>(fn: (value: RowOf<T>) => R): Data<Record<R, RowOf<T>>>;
};
declare class Sink {
}
declare class ViewProxy {
    view: any;
    constructor(view: any);
    deleteProperty(target: any, name: any): boolean;
    set(t: any, name: any, value: any): boolean;
    get(t: any, name: any): any;
    apply(t: any, m: any, args: any): any;
    getPrototypeOf(target: any): ViewProxy;
    iterator(i?: number): Generator<any, void, unknown>;
}

export { $, Operators as O, Sink as S, view as a, createOperator as c, reactive as r, value as v };
