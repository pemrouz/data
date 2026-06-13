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
declare const $: <T>(v: T) => Data<T>;

/**
 * Low-level escape hatch for building a derived view from a custom `Operator`
 * subclass without going through the named dispatch table — `createOperator(src,
 * MyOperatorClass, ...args)`. Most code should use the chainable operators
 * (`src.filter(...)`) instead; reach for this only when authoring a new
 * operator or wiring one that isn't registered. See operators/README.md.
 */
declare function createOperator(source: any, OperatorClass: any, ...args: any[]): ViewProxy;
type RowOf<T> = T extends readonly (infer E)[] ? E : T extends Record<any, infer R> ? R : never;
type ChangeRecord = {
    type: 'update' | 'insert' | 'remove';
    key: string[];
    value: any;
    at?: any;
};
type Reactive<T> = Data<T> | T;
type Data<T = any> = [
    T
] extends [readonly (infer E)[]] ? DataOps<T> & {
    [index: number]: Data<E>;
} : [T] extends [object] ? DataOps<T> & {
    [K in keyof T]: Data<T[K]> | T[K];
} : DataOps<T>;
type DataOps<T = any> = {
    [value]?: T;
    /**
     * Subscribe to this view. Three forms:
     *
     * - `connect([])` — pushes each change record `{ type, key, value, at? }` into
     *   the array and returns it. Best for tests and seeing what flows through.
     * - `connect(anchor, 'prop')` — mirrors the current value onto `anchor.prop`
     *   (e.g. `connect(el, 'textContent')`); returns `anchor`.
     * - `connect(anchor, fn)` — calls `fn(change)` on every event. `anchor` is the
     *   lifetime handle: sinks are held weakly, so the subscription lives only as
     *   long as `anchor` is reachable.
     *
     * There is **no single-argument `connect(fn)` form** — a lone function is
     * attached as a raw sink with no initial emit and throws on the first insert.
     * Use the two-argument `connect(anchor, fn)`.
     *
     * @example
     * const events = rows.filter('done', false).length().connect([])
     * count.connect(document.body, 'textContent')
     * rows.connect(controller, change => redraw())
     */
    connect<A extends any[]>(events: A): A;
    connect<O extends object>(anchor: O, prop: string): O;
    connect<O extends object>(anchor: O, fn: (change: ChangeRecord) => void): O;
    /**
     * @deprecated `connect(fn)` (a lone function) is **not** a supported form — it
     * attaches with no initial emit and throws on the first insert. Use the
     * two-argument `connect(anchor, fn)` instead.
     */
    connect(fn: (change: ChangeRecord) => void): never;
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
    /**
     * Rows matching a predicate. Four shapes: a `(row, key) => boolean` function,
     * a `key, value` pair, a `string[]` path + value, or a partial-shape object.
     * The predicate is captured once — it re-runs when a row mutates, not when
     * outside state changes; for a reactive predicate derive a view and chain
     * `between`/`intersect`.
     * @example rows.filter(d => d.active)   //  rows.filter('done', false)   //  rows.filter({ done: false })
     */
    filter(fn: (row: RowOf<T>) => boolean): Data<T>;
    filter(key: string, value: any): Data<T>;
    filter(arg: object): Data<T>;
    /**
     * Rows whose `key` column falls within `[lo, hi]` (sort-indexed). Pass
     * ViewProxy bounds for a reactive range (a moving brush); plain numbers are
     * static. For a single moving threshold prefer `gt`/`lt`/`gte`/`lte`.
     * @example trades.between('pnl', [-1e6, 1e6])
     */
    between(key: string, bounds: [Reactive<number>, Reactive<number>] | Data<[number, number]>): Data<T>;
    /**
     * Single-threshold row filters (RowOperator-based, O(1) per change — prefer
     * over `between(col, [T, Infinity])` for a moving threshold).
     * @example trades.gt('pnl', 0)   //  trades.lte('age', 65)
     */
    gt(key: string, value: number): Data<T>;
    lt(key: string, value: number): Data<T>;
    gte(key: string, value: number): Data<T>;
    lte(key: string, value: number): Data<T>;
    /**
     * Apply many child updates as ONE batched cascade (sinks see a single BU1).
     * Pairs are `[name, value, name, value, …]`.
     * @example pop.patch(['a', { x: 1 }, 'b', { x: 2 }])
     */
    patch(pairs: any[]): undefined;
    /**
     * Whole-value transform — maps the entire snapshot, rebuilding on change.
     * @example count.to(n => n * 2)
     */
    to<R>(fn: (value: T) => R): Data<R>;
    /**
     * Per-row transform; each row maps independently (only the changed row re-runs).
     * @example rows.map(r => r.qty * r.price)
     */
    map<R>(fn: (row: RowOf<T>) => R): Data<Record<string, R>>;
    /**
     * Row count (`length()`), or grouped counts (`length(fn)`). Grouped counts
     * store each bucket as `{ value: count }` — read a count via
     * `counts[key].value`, **not** `counts[key]`. Emptied buckets persist at
     * `{ value: 0 }` (fixed-keyspace histograms); use `group` for enter/leave.
     * @example rows.length()   //  rows.length(r => r.region) → { east: { value: 4 }, … }
     */
    length(): Data<number>;
    length<R extends PropertyKey>(fn: (row: RowOf<T>) => R): Data<Record<R, number>>;
    /**
     * Scalar aggregate over a column (or row values if `col` omitted). `sum`/`avg`
     * are O(1) per change; `max`/`min` recompute O(n). Empty set → `undefined`.
     * @example orders.sum('amount')   //  orders.avg('amount')
     */
    sum(col?: string): Data<number>;
    avg(col?: string): Data<number>;
    max(col?: string): Data<any>;
    min(col?: string): Data<any>;
    /**
     * Scalar boolean — does any (`some`) / every (`every`) row match the predicate.
     * @example alerts.some(a => a.level >= 3)
     */
    some(fn: (row: RowOf<T>) => boolean): Data<boolean>;
    every(fn: (row: RowOf<T>) => boolean): Data<boolean>;
    /**
     * Passthrough side effect. A 1+-arg `fn(change)` fires once per row with a
     * cloned change record; a 0-arg `fn()` fires once per emit (no clone) — for
     * cheap "re-read and redraw" callbacks.
     * @example view.tap(() => redraw())
     */
    tap(fn: (change: ChangeRecord) => void): Data<T>;
    /**
     * First-seen unique rows, by an optional projection.
     * @example trades.distinct(t => t.symbol)
     */
    distinct<K = RowOf<T>>(fn?: (row: RowOf<T>) => K): Data<RowOf<T>[]>;
    /**
     * Fold. `reduce(fn, init)` is the general (rebuild-on-change) form; the 3-arg
     * `reduce(add, remove, init)` threads inserts/removes through in O(Δ).
     * @example rows.reduce((acc, r) => acc + r.n, 0)
     */
    reduce<R>(fn: (acc: R, row: RowOf<T>, key: string) => R, init: R): Data<R>;
    reduce<R>(add: (acc: R, row: RowOf<T>, key: string) => R, remove: (acc: R, row: RowOf<T>, key: string) => R, init: R | (() => R)): Data<R>;
    /**
     * Rows present in ANY source (value taken from the first source containing it).
     * @example a.union(b, c)
     */
    union(...sources: Data[]): Data<T>;
    /**
     * Rows in this view but not in `other`.
     * @example all.except(archived)
     */
    except(other: Data): Data<T>;
    /** Current `Object.keys` as a reactive array. */
    keys(): Data<string[]>;
    /** Current `Object.values` as a reactive array. */
    values(): Data<RowOf<T>[]>;
    /** Array order flipped. */
    reverse(): Data<RowOf<T>[]>;
    /**
     * Descending sort (`za`) by `column`, optionally windowed to the top `max` —
     * a bounded top-K, cheaper than `za(col).limit(n)`. `az` is ascending;
     * `top`/`limit` window without re-sorting.
     * @example trades.za('pnl', 50)   //  rows.az('name')
     */
    za(column: string, max?: number): Data<T>;
    za(max?: number): Data<T>;
    az(column: string, max?: number): Data<T>;
    az(max?: number): Data<T>;
    top(max?: number): Data<T>;
    limit(max: number): Data<T>;
    /**
     * Rows present in ALL source views — set intersection (one bitmask bit per row,
     * O(1) per membership flip). Tracks reactive sources live.
     * @example a.intersect(b, c)
     */
    intersect(...sources: Data[]): Data<T>;
    /**
     * Rows nested under a computed key. Prunes emptied groups (enter/leave
     * semantics) — use `length(fn)` when you want zero-count buckets to persist.
     * @example sales.group(s => s.region)
     */
    group<R extends PropertyKey>(fn: (value: RowOf<T>) => R): Data<Record<R, RowOf<T>>>;
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
