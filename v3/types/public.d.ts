// v3/types/public.d.ts — the SHIPPED type declarations for the MAIN entry.
//
// package.json `exports["."].types` (and `"./v3"`) point HERE: this is what a
// consumer's editor/tsc resolves for `import { $ } from 'data'` (dist/index.js,
// built from v3/api/index.ts — tsup emits no dts for it). SELF-CONTAINED on
// purpose: this file ships to npm, so it may not import ANY other file in the
// repo — the contract types (contract/delta.ts, contract/index.ts), the typed
// surface (types/surface.ts), and the JSX facades (types/jsx-surface.ts,
// jsx/intrinsics.ts) are INLINED below, hand-maintained in LOCKSTEP with those
// gate files until registry-generated types land (STATUS.md known-gaps item 3).
// Gate: `npx tsc -p v3/types/tsconfig.public.json` compiles check.public.ts
// (positives + @ts-expect-error negatives) against this file, noCheck:false.
//
// Two deliberate divergences from surface.ts — both are places where
// surface.ts LAGS THE RUNTIME, and shipped types follow the runtime:
// - `between(col, bounds)` ALSO accepts a reactive bounds HANDLE (any View of
//   a numeric [lo, hi] tuple/array): installReactive() wraps 'between' with
//   betweenR (ops/reactive.ts), the crossfilter-v3 idiom
//   `flights.between('date', filters.get('date'))`. surface.ts still says
//   "STATIC numerics"; STATUS gap 3 marks the between(col, handle) fixture as
//   follow-up — this file is that follow-up's shipped half.
// - `length(fn)` — the v2 histogram: api/index.ts dispatches length(fn) to the
//   registered lengthBuckets op; buckets are `{ value: N }` wrappers
//   (Record<string, CountBucket>), never pruned (emptied buckets persist at
//   { value: 0 } — the v2 fixed-keyspace contract the swarm example rides).
//
// Everything else mirrors surface.ts / jsx-surface.ts verbatim (Data /
// ReadonlyData / OrderedData / Mirror / Scalar / View / Reactive / Ops /
// writes / children / RafWriter / SubscriptionHandle / ChangeRecordV2 / the
// value+node symbols). Where the runtime is loose — builder args, the
// devtools-support re-exports at the bottom — these types stay loose: no
// precision the runtime doesn't check.

// ── the handle symbols ───────────────────────────────────────────────────────
// Minted via Symbol.for against the SAME global registry keys the runtime uses
// ('data.v3.value' / 'data.v3.node'); declared `unique symbol` so interfaces
// can carry `readonly [value]: T`.

export declare const value: unique symbol
export declare const node: unique symbol

// ── the wire contract (inlined from v3/contract) ─────────────────────────────

export type RowKey = number | string
export type Path = readonly (string | number)[]

// Native profile (SCHEMA_VERSION 3): stable keys, prev, path, move-with-key.
export type WireRecord =
  | { t: 'add'; k: RowKey; v: unknown }
  | { t: 'update'; k: RowKey; v: unknown; prev?: unknown; path?: readonly (string | number)[] }
  | { t: 'remove'; k: RowKey; prev?: unknown }
  | { t: 'move'; k: RowKey; from: number; to: number }

// v2-compat profile — PERMANENT, not a shim (byte-parity with v2's
// ChangeRecord stream; what connect([]) / connect(anchor, fn) deliver).
export type ChangeRecordV2 =
  | { type: 'update' | 'insert' | 'remove'; key: string[]; value: unknown; at?: unknown }
  | { type: 'move'; from: number; to: number }

export interface SubscriptionHandle {
  dispose(): void
}

// ── reserved names ───────────────────────────────────────────────────────────
// Mirror of contract/index.ts RESERVED (frozen for all of v3). Property access
// on these resolves to methods/operators, never to data children — the
// Children mapped types exclude them; get() is the collision-free escape hatch.
export type Reserved =
  // built-ins
  | 'get' | 'set' | 'update' | 'insert' | 'remove' | 'patch' | 'ingest' | 'connect'
  | 'snapshot' | 'raf' | 'first' | 'last' | 'mirror' | 'dispose'
  // operators
  | 'filter' | 'between' | 'gt' | 'lt' | 'gte' | 'lte'
  | 'az' | 'za' | 'top' | 'limit' | 'page'
  | 'length' | 'sum' | 'avg' | 'max' | 'min' | 'some' | 'every'
  | 'intersect' | 'union' | 'except'
  | 'group' | 'distinct' | 'map' | 'to' | 'reduce' | 'tap'
  | 'keys' | 'values' | 'reverse' | 'join'
// NB: 'page' / 'reverse' / 'join' are RESERVED but UNIMPLEMENTED (the runtime
// throws) — deliberately ABSENT from Ops<T>, so calling them is a compile
// error now and gains a signature (not a breaking change) when they land.

// ── shape helpers ────────────────────────────────────────────────────────────

export type SnapshotOf<T> = T

export type RowOf<T> = T extends readonly (infer R)[]
  ? R
  : T extends object
    ? T[Extract<keyof T, string>]
    : never

export type ColOf<T> = RowOf<T> extends infer R
  ? [R] extends [object]
    ? Extract<keyof R, string>
    : string
  : never

export type ColVal<T, C extends string> = RowOf<T> extends infer R
  ? [R] extends [object]
    ? C extends keyof R
      ? R[C]
      : never
    : R
  : never

// What a KEYED (order-channel-free) derived view materializes over T.
export type KeyedOf<T> = T extends readonly (infer R)[] ? Record<string, R> : T

export type KeyOf<T> = T extends readonly unknown[] ? number : Extract<keyof T, string>

export type MemberOf<T, K extends PropertyKey> = T extends readonly (infer R)[]
  ? R
  : K extends keyof T
    ? T[K]
    : never

// ── the covariant read side + reactive value slots ───────────────────────────

export interface View<out T> {
  readonly [value]: T
  readonly [node]: object
}

// Every reactive value-slot arg: a plain value or any live view of one.
export type Reactive<T> = T | View<T>

// ── scalars (aggregate results) ──────────────────────────────────────────────

export interface Scalar<out V> extends View<V> {
  snapshot(): V
  connect(records: ChangeRecordV2[]): SubscriptionHandle
  connect(anchor: object, fn: (record: ChangeRecordV2) => void): SubscriptionHandle
  connect(anchor: object, prop: string): SubscriptionHandle
  dispose(): void
}

// ── raf writer (the coalescing writer a child handle's raf() returns) ────────

export interface RafWriter<in V> {
  (v: V): void
  flush(): void
  cancel(): void
}

// ── child handles (path addresses; no operators, no connect) ─────────────────

interface ChildRead<out V> {
  readonly [value]: V
  readonly [node]: object
  snapshot(): V
}

export type ReadonlyChild<V> = ChildRead<V> &
  ([V] extends [object]
    ? {
        get<K extends Extract<keyof V, string>>(k: K): ReadonlyChild<V[K]>
      } & ReadonlyChildren<V>
    : unknown)

export type DataChild<V> = ChildRead<V> & {
  update(v: V): void
  remove(): void // depth-1 children detach the row; deeper removal is a runtime gap
  raf(): RafWriter<V>
} & ([V] extends [object]
    ? {
        get<K extends Extract<keyof V, string>>(k: K): DataChild<V[K]>
        set<K extends Extract<keyof V, string>>(k: K, v: V[K]): void
      } & Children<V>
    : unknown)

// ── property sugar (minus RESERVED) ──────────────────────────────────────────

export type Children<T> = T extends readonly (infer R)[]
  ? { readonly [i: number]: DataChild<R> }
  : { readonly [K in Exclude<Extract<keyof T, string>, Reserved>]: DataChild<T[K]> }

export type ReadonlyChildren<T> = T extends readonly (infer R)[]
  ? { readonly [i: number]: ReadonlyChild<R> }
  : { readonly [K in Exclude<Extract<keyof T, string>, Reserved>]: ReadonlyChild<T[K]> }

// ── operators (generated-from-registry is the end state; hand-mirrored) ──────

export type CmpFn<T> = (a: RowOf<T>, b: RowOf<T>) => number

// A keyed-collection operand for the set operators.
export type KeyedView<R> = View<Record<string, R>> | View<readonly R[]>

// between's bounds: a static numeric tuple, or (runtime divergence — see the
// header) any View of one (a $ child handle holding [lo, hi], a tuple-typed
// or plain-numeric-array leaf) — betweenR binds it to setBounds, the O(Δ)
// brush walk. Half-open / empty bounds open to ±Infinity.
export type BetweenBounds = readonly [(number | undefined)?, (number | undefined)?]

// A length(fn) histogram bucket: counts are wrapped so each has its own
// subscribable identity; emptied buckets persist at { value: 0 }.
export interface CountBucket {
  readonly value: number
}

export interface Ops<T> {
  // row ops (keyed output — no order channel)
  filter(pred: (row: RowOf<T>, key: RowKey) => unknown): ReadonlyData<KeyedOf<T>>
  map<U>(fn: (row: RowOf<T>, key: RowKey) => U): ReadonlyData<Record<string, U>>
  gt<C extends ColOf<T>>(col: C, threshold: Reactive<ColVal<T, C>>): ReadonlyData<KeyedOf<T>>
  lt<C extends ColOf<T>>(col: C, threshold: Reactive<ColVal<T, C>>): ReadonlyData<KeyedOf<T>>
  gte<C extends ColOf<T>>(col: C, threshold: Reactive<ColVal<T, C>>): ReadonlyData<KeyedOf<T>>
  lte<C extends ColOf<T>>(col: C, threshold: Reactive<ColVal<T, C>>): ReadonlyData<KeyedOf<T>>
  between(
    col: ColOf<T>,
    bounds?: BetweenBounds | View<readonly (number | undefined)[]>,
  ): ReadonlyData<KeyedOf<T>>

  // ordered views — ARRAYS in rank order; window sizes are reactive slots
  az(by: ColOf<T> | CmpFn<T>, n?: Reactive<number>): OrderedData<T>
  za(by: ColOf<T> | CmpFn<T>, n?: Reactive<number>): OrderedData<T>
  top(n: Reactive<number>): OrderedData<T>
  limit(n: Reactive<number>): OrderedData<T>

  // aggregates — precisely-typed scalars
  length(): Scalar<number>
  // The v2 histogram (runtime divergence — see the header): length(fn)
  // dispatches to lengthBuckets; each bucket is a { value: N } wrapper.
  length(fn: (row: RowOf<T>, key: RowKey) => unknown): ReadonlyData<Record<string, CountBucket>>
  sum(col?: Reactive<ColOf<T>>): Scalar<number>
  avg(col?: Reactive<ColOf<T>>): Scalar<number | undefined>
  max(): Scalar<RowOf<T> | undefined>
  max<C extends ColOf<T>>(col: C): Scalar<ColVal<T, C> | undefined>
  min(): Scalar<RowOf<T> | undefined>
  min<C extends ColOf<T>>(col: C): Scalar<ColVal<T, C> | undefined>
  some(fn: (row: RowOf<T>) => unknown): Scalar<boolean>
  every(fn: (row: RowOf<T>) => unknown): Scalar<boolean>
  // reduce's init is the fold's identity ELEMENT — a plain value, never a view.
  reduce<A>(fn: (acc: A, row: RowOf<T>, key: RowKey) => A, init: A): Scalar<A>
  reduce<A>(
    add: (acc: A, row: RowOf<T>, key: RowKey) => A,
    remove: (acc: A, row: RowOf<T>, key: RowKey) => A,
    init: A,
  ): Scalar<A>
  to<U>(fn: (plain: SnapshotOf<T>, prev: U | undefined) => U): Scalar<U>

  // set algebra (operands are any keyed views of the same row type)
  intersect(...others: readonly KeyedView<RowOf<T>>[]): ReadonlyData<KeyedOf<T>>
  union(...others: readonly KeyedView<RowOf<T>>[]): ReadonlyData<KeyedOf<T>>
  except(...others: readonly KeyedView<RowOf<T>>[]): ReadonlyData<KeyedOf<T>>

  // buckets
  group(fn: (row: RowOf<T>, key: RowKey) => unknown): ReadonlyData<Record<string, Record<string, RowOf<T>>>>
  distinct(): ReadonlyData<Record<string, RowOf<T>>>
  distinct<U>(fn: (row: RowOf<T>) => U): ReadonlyData<Record<string, U>>

  // effect / iter
  tap(fn: ((change: ChangeRecordV2) => void) | (() => void)): ReadonlyData<T>
  keys(): ReadonlyData<Record<string, string>>
  values(): ReadonlyData<KeyedOf<T>>
}

// ── the read core shared by source + operator handles ────────────────────────

interface ReadCore<T> {
  readonly [value]: SnapshotOf<T>
  readonly [node]: object
  snapshot(): SnapshotOf<T>
  connect(records: ChangeRecordV2[]): SubscriptionHandle
  connect(anchor: object, fn: (record: ChangeRecordV2) => void): SubscriptionHandle
  connect(anchor: object, prop: string): SubscriptionHandle
  dispose(): void
  mirror(): Mirror<T>
  [Symbol.iterator](): IterableIterator<RowOf<T>>
}

// ── navigation ───────────────────────────────────────────────────────────────

interface ReadNav<T> {
  get(k: RowKey): ReadonlyChild<RowOf<T>>
  first(): ReadonlyChild<RowOf<T>>
  last(): ReadonlyChild<RowOf<T>>
}

interface Writes<T> {
  get<K extends KeyOf<T>>(k: K): DataChild<MemberOf<T, K>>
  set<K extends KeyOf<T>>(k: K, v: MemberOf<T, K>): void
  insert(v: RowOf<T>, at?: number): RowKey
  patch(pairs: readonly (readonly [KeyOf<T>, RowOf<T>])[]): void
  ingest(records: readonly (WireRecord | ChangeRecordV2)[], opts?: { readonly origin?: symbol }): void
  first(): DataChild<RowOf<T>>
  last(): DataChild<RowOf<T>>
  // NB deliberately ABSENT (the runtime THROWS on both at a source root):
  // update() and remove() — row removal is d.get(k).remove() / d.a.remove().
}

// ── the handles ──────────────────────────────────────────────────────────────

// A $() source handle: read + methods-only writes + child sugar.
export type Data<T> = ReadCore<T> & Ops<T> & Writes<T> & Children<T>

// An operator-view handle: read-only projection (writes live on the source).
export type ReadonlyData<T> = ReadCore<T> & Ops<T> & ReadNav<T> & ReadonlyChildren<T>

// An ordered view (az/za/top/limit): rows as an ARRAY in rank order.
export type OrderedData<T> = ReadonlyData<RowOf<T>[]>

// A mirror (the explicit $(view)-swap replacement): a read view plus the
// single repoint verb — set(view) repoints it as one consolidated diff.
export type Mirror<T> = ReadonlyData<T> & { set(view: View<T>): void }

// ── $ / batch / runtime ──────────────────────────────────────────────────────

export declare function $<T extends object>(v: T): Data<T>

// One consolidated commit: every write inside fn settles as a single batch.
export declare function batch<R>(fn: () => R): R

// The default Runtime instance (the devtools seam's entry into the graph;
// also what fromAsync / InMemoryBacking take).
export declare function runtime(): Runtime

// ── the render AST (structural stand-ins, per jsx/intrinsics.ts) ─────────────

// Any render AST record (el/text/rtext/list/component/boundary): a tagged kind.
export interface VNodeLike {
  readonly kind: string
}
// A reactive PROP value (render/index.ts BindProp, discriminated on 'bind').
export interface BindLike {
  readonly kind: 'bind'
}
// h() returns a VNode from a string tag and VNode[] from Fragment/components.
export type Element = VNodeLike | VNodeLike[]

// el()'s child vocabulary (render/index.ts Child) — el does NOT normalize
// views/arrays; those belong to the builders / JSX layer (normChildren).
export type ElChild = VNodeLike | string | number | boolean | null | undefined

// The normalized child vocabulary (normChildren / builder calls / JSX string
// tags): static text, VNodes, views (reactive text), bind() records, nested
// arrays. FUNCTIONS ARE EXCLUDED — a function child under a string tag throws
// at runtime; iteration is ONLY <For>/list().
export interface ViewLike {
  snapshot(): unknown
}
export type ChildLike =
  | string
  | number
  | boolean
  | null
  | undefined
  | VNodeLike
  | ViewLike
  | BindLike
  | readonly ChildLike[]

export declare function el(
  tag: string,
  props?: Record<string, unknown> | null,
  ...children: ElChild[]
): VNodeLike

// text — a reactive TEXT child; the format fn's param infers from the view.
export declare function text<V>(view: View<V>, fn?: (v: V) => unknown): VNodeLike

// bind — a reactive PROP value; same inference.
export declare function bind<V>(view: View<V>, fn?: (v: V) => unknown): BindLike

// list — the keyed list sink (the builder twin of <For>): the row fn's params
// infer from the bound collection view.
export declare function list<T>(
  view: View<T>,
  rowFn: (row: RowOf<T>, key: RowKey) => VNodeLike,
): VNodeLike

// component — fn is invoked ONCE at mount under its own child Scope.
export declare function component<P extends Record<string, unknown>>(
  fn: (props: P) => unknown,
  props?: P | null,
): VNodeLike

// boundary — the error-boundary record: an error swaps in fallback(err, reset).
export declare function boundary(
  child: unknown,
  fallback: (err: unknown, reset: () => void) => unknown,
): VNodeLike

export interface RenderHandle {
  readonly scope: object // the mount Scope (opaque here)
  dispose(): void
}

export declare function render(
  host: any,
  ast: VNodeLike | readonly VNodeLike[],
  runtime?: Runtime,
): RenderHandle

// ── the HTML.*/SVG.* builder DSL ─────────────────────────────────────────────
// Dot sugar accumulates on immutable builder values: HTML.div.chart → class
// "chart", div['#x'] → id, a['href=…'] → attr. Args are (props?, ...children)
// with the normalized child vocabulary — loosely typed, as at runtime.

export interface Builder {
  (...args: unknown[]): VNodeLike
  readonly [sugar: string]: Builder
}
export type BuilderNamespace = { readonly [tag: string]: Builder }
export declare const HTML: BuilderNamespace
export declare const SVG: BuilderNamespace

// Children normalization (shared by builders + JSX; exported by the entry).
export declare function normChildren(children: readonly unknown[]): VNodeLike[]

// ── JSX (classic h/Fragment + automatic runtime verbs) ───────────────────────

// A function component: called as tag({ ...props, children }).
export type Component<P = any> = (props: P) => Element

// h — the classic jsxFactory. STRING tags take the normalized child
// vocabulary (functions excluded — the compile-time mirror of the runtime's
// unsupported-child throw); COMPONENT tags take children RAW (the render-prop
// protocol For relies on).
export declare function h(
  tag: string,
  props: Record<string, unknown> | null,
  ...children: ChildLike[]
): Element
export declare function h<P>(tag: Component<P>, props: P | null, ...children: unknown[]): Element

// Fragment — returns its children array; flattens into any parent.
export declare function Fragment(props: { children?: unknown }): Element

// For — THE iteration form: <For each={view}>{(row, key) => vnode}</For>.
// `each` is REQUIRED and the single child MUST be the row fn.
export declare function For<T>(props: {
  each: View<T>
  children: (row: RowOf<T>, key: RowKey) => Element
}): Element

// ErrorBoundary — fallback is REQUIRED (the runtime throws eagerly without it).
export declare function ErrorBoundary(props: {
  fallback: (err: unknown, reset: () => void) => unknown
  children?: unknown
}): Element

// The automatic-runtime verbs (data/jsx-runtime re-exports this module's).
export declare function jsx(
  tag: string | Component,
  props: Record<string, unknown> | null | undefined,
  key?: unknown,
): Element
export declare function jsxs(
  tag: string | Component,
  props: Record<string, unknown> | null | undefined,
  key?: unknown,
): Element
export declare function jsxDEV(
  tag: string | Component,
  props: Record<string, unknown> | null | undefined,
  key?: unknown,
  isStaticChildren?: boolean,
  source?: unknown,
  self?: unknown,
): Element

// onCleanup — registers a cleanup on the AMBIENT scope (a component
// invocation, a render mount); throws outside one.
export declare function onCleanup(fn: () => void): void

// ── the seam (async sources / backings / the contract manifest) ──────────────

export type IngestRecord = WireRecord | ChangeRecordV2

export type AsyncStatus = 'pending' | 'ready' | 'error'

export interface FromAsyncOpts<T> {
  readonly key?: (row: T) => RowKey
  readonly coalesce?: 'sync' | 'microtask'
  readonly onStatus?: (s: AsyncStatus) => void
}

export interface AsyncSourceHandle<T> {
  readonly source: DataNode<T> // the raw SourceNode (wrap via handleFor)
  status(): AsyncStatus
  error(): unknown
  dispose(): void
}

export declare function fromAsync<T>(
  runtime: Runtime,
  input: Promise<readonly T[]> | AsyncIterable<readonly T[]>,
  opts?: FromAsyncOpts<T>,
): AsyncSourceHandle<T>

export type OpCategory = 'rowop' | 'aggregate-decomposable' | 'holistic' | 'iter'

export interface ContractManifest {
  readonly SCHEMA_VERSION: number
  readonly reserved: readonly string[]
  readonly operators: Readonly<Record<string, { category: OpCategory; declarative: boolean }>>
}

export declare function exportContract(): ContractManifest

// The default SourceBacking: SourceNode/Store behind the pluggable-source
// boundary shape (load/apply/subscribe). Loosely typed at the sink edge.
export declare class InMemoryBacking<T> {
  readonly source: DataNode<T>
  constructor(runtime: Runtime, value: Record<string, T> | readonly T[], name?: string)
  load(): { rows: Map<RowKey, T>; order: readonly RowKey[] | null }
  apply(records: readonly IngestRecord[], origin?: symbol): void
  subscribe(sink: {
    readonly wantsOrder?: boolean
    readonly origin?: symbol | null
    init(snapshot: ReadonlyMap<RowKey, T>, order?: readonly RowKey[]): void
    apply(batch: any): void
  }): SubscriptionHandle
}

// ── devtools-support seam (NOT consumer surface) ─────────────────────────────
// dist/devtools.js is emitted with its cross-boundary imports rewritten to the
// main bundle, so everything the devtools layer touches BY VALUE must be
// reachable from this entry. Typed OPAQUELY/loosely on purpose — reach for
// these only from inspection tooling, never application code.

// The raw graph node behind every handle (`handle[node]`). Opaque.
export declare class DataNode<T = unknown> {
  private constructor()
  private __v3DataNodeBrand: T
}

// The commit scheduler. runtime() returns the default instance.
export declare class Runtime {
  constructor()
  batch<R>(fn: () => R): R
  private __v3RuntimeBrand: unknown
}

// A $ handle over a raw node (tests / the devtools layer).
export declare function handleFor(n: DataNode<any>): any

// Keyed-snapshot → plain value projection (compat/v2-records.ts).
export declare function materialize(snapshot: any, order?: any): unknown

// The DOM ↔ data registry the devtools fromDOM()/highlight() build on.
export declare const domLinks: WeakMap<object, { readonly view: DataNode<any>; readonly key: RowKey }>
export declare const liveLists: Set<{
  readonly view: DataNode<any>
  readonly recs: Map<RowKey, { readonly el: any }>
}>
