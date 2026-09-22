// types/public.d.ts — the SHIPPED type declarations for the MAIN entry.
//
// package.json `exports["."].types` points HERE: this is what a consumer's
// editor/tsc resolves for `import { $ } from 'data'` (dist/api/index.js — the
// type-stripped source; build.mjs emits no d.ts). SELF-CONTAINED on purpose:
// this file ships to npm, so it may not import ANY other file in the repo —
// the contract types (contract/delta.ts, contract/index.ts), the typed
// surface (types/surface.ts), the JSX facades (types/jsx-surface.ts) and the
// per-tag JSX surface (jsx/intrinsics.ts) are INLINED below, hand-maintained
// in LOCKSTEP with those gate files until registry-generated types land
// (STATUS.md known-gaps item 3). The two shipped SUBPATH twins —
// jsx-runtime.d.ts ('data/jsx-runtime' + 'data/jsx-dev-runtime') and
// devtools.d.ts ('data/devtools') — import THIS file by the relative
// specifier './public.js' and declare nothing this file could: every type
// they need (Element, IntrinsicElements, DataNode, Runtime, CommitInfo, …)
// lives here, once.
// Gate: `npx tsc -p types/tsconfig.public.json` compiles check.public.ts /
// check.public.tsx / check.public.classic.tsx / check.public.devtools.ts
// (positives + @ts-expect-error negatives, resolved through the REAL bare
// specifiers via paths; .classic.tsx switches itself to the classic
// transform with the @jsxRuntime/@jsx pragmas) plus check.public.lockstep.ts
// (the inlined per-tag surface ≡ jsx/intrinsics.ts) against these three
// files, noCheck:false, skipLibCheck:false.
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
// ('data.v4.value' / 'data.v4.node'); declared `unique symbol` so interfaces
// can carry `readonly [value]: T`.

export declare const value: unique symbol
export declare const node: unique symbol

// ── the wire contract (inlined from v3/contract) ─────────────────────────────

export type RowKey = number | string
export type Path = readonly (string | number)[]

// Native profile (SCHEMA_VERSION 3): stable keys, prev, path, move-with-key.
export interface WireBatch {
  readonly keyDomain: 'int' | 'string'
  readonly seq: number
  readonly records: readonly WireRecord[]
}
export type WireRecord =
  // add.at = order position (array-born mid-inserts); update v/prev = the
  // LEAF at path ([]/absent = whole row) — the W1-settled profile.
  | { t: 'add'; k: RowKey; v: unknown; at?: number }
  | { t: 'update'; k: RowKey; v: unknown; prev?: unknown; path?: readonly (string | number)[] }
  | { t: 'remove'; k: RowKey; prev?: unknown; path?: readonly (string | number)[] } // path = nested FIELD deletion (clause 10a)
  | { t: 'move'; k: RowKey; from: number; to: number }

// v2-compat profile — PERMANENT, not a shim (byte-parity with v2's
// ChangeRecord stream; what connect([]) / connect(anchor, fn) deliver).
export type ChangeRecordV2 =
  | { type: 'update' | 'insert' | 'remove'; key: string[]; value: unknown; at?: unknown }
  | { type: 'move'; from: number; to: number }

// W2: sink() makes the delta algebra part of the SHIPPED surface — the
// self-contained mirror of contract/delta.ts (consumers get CommitBatch
// without importing engine internals).
export type OriginToken = symbol
export interface AddDelta<T = unknown> { readonly op: 'add'; readonly key: RowKey; readonly row: T }
export interface RemoveDelta<T = unknown> { readonly op: 'remove'; readonly key: RowKey; readonly prev: T }
export interface UpdateDelta<T = unknown> {
  readonly op: 'update'
  readonly key: RowKey
  readonly row: T
  readonly prev: T
  readonly path: readonly (string | number)[]
  readonly deleted?: boolean // clause 10a: the leaf at `path` was DELETED, not written
}
export type RowDelta<T = unknown> = AddDelta<T> | RemoveDelta<T> | UpdateDelta<T>
export interface OrderDelta {
  readonly op: 'orderInsert' | 'orderRemove' | 'orderMove'
  readonly key: RowKey
  readonly index: number
  readonly from?: number
}
export interface ScalarDelta { readonly prev: unknown; readonly next: unknown }
export interface CommitBatch<T = unknown> {
  readonly seq: number
  readonly origin: OriginToken
  readonly rows: readonly RowDelta<T>[]
  readonly order: readonly OrderDelta[] | undefined
  readonly scalar: ScalarDelta | undefined
}

// W2: options for the record-profile connect forms — origin-token echo
// suppression, clone-free by-ref values, initial-snapshot opt-out.
export interface SinkOpts {
  readonly origin?: symbol | null
  readonly clone?: boolean
  readonly initial?: boolean
}

// W2: the native batch subscription (d.sink(...)) — CommitBatch by reference.
export interface NativeSink<T = unknown> {
  readonly wantsOrder?: boolean
  readonly origin?: symbol | null
  init?(snapshot: Map<RowKey, T>, order?: readonly RowKey[]): void
  apply(batch: CommitBatch<T>): void
}

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
  | 'sink' // v4 (a major): the native batch subscription (W2)
  | 'promote' // v4: pre-pay the container-adoption spike (W11)
  | 'each' | 'rowCount' // v4: the no-copy read protocol (W9)
  // operators
  | 'filter' | 'between' | 'gt' | 'lt' | 'gte' | 'lte'
  | 'az' | 'za' | 'top' | 'limit' | 'page'
  | 'length' | 'sum' | 'avg' | 'max' | 'min' | 'some' | 'every'
  | 'intersect' | 'union' | 'except'
  | 'group' | 'distinct' | 'map' | 'to' | 'reduce' | 'tap'
  | 'median' | 'percentile' | 'quantile' // v4: the quantile family (W13)
  | 'keys' | 'values' | 'reverse' | 'join'
// NB: 'page' / 'join' are RESERVED but UNIMPLEMENTED (the runtime throws) —
// deliberately ABSENT from Ops<T>, so calling them is a compile error now and
// gains a signature (not a breaking change) when they land. 'reverse' landed
// (reversed ARRIVAL order — newest first; see Ops<T>).

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
  connect(records: ChangeRecordV2[], opts?: SinkOpts): SubscriptionHandle
  connect(anchor: object, fn: (record: ChangeRecordV2) => void, opts?: SinkOpts): SubscriptionHandle
  connect(anchor: object, prop: string): SubscriptionHandle
  // NB deliberately ABSENT (runtime throws on scalars): sink() / each() /
  // rowCount() / promote() — collection-view surface only (W2/W9/W11).
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
  remove(): void // depth-1 children detach the row; deeper paths DELETE the field (clause 10a; absent targets no-op)
  raf(): RafWriter<V>
  // W14: subtree-scoped records — relative keys; depth 1 = partition-scoped,
  // deeper = the deep-scalar emission mode.
  connect(records: ChangeRecordV2[], opts?: SinkOpts): SubscriptionHandle
  connect(anchor: object, fn: (record: ChangeRecordV2) => void, opts?: SinkOpts): SubscriptionHandle
  connect(anchor: object, prop: string): SubscriptionHandle
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
  // W10: dep = the explicit re-scope subscription — its commits re-evaluate
  // the predicate over every row (O(moved) deltas, no teardown/rebuild).
  filter(pred: (row: RowOf<T>, key: RowKey) => unknown, dep: object): ReadonlyData<KeyedOf<T>>
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
  // reversed ARRIVAL order (newest first) — an append surfaces at index 0;
  // reverse a SORTED view by using the opposite operator (az ↔ za)
  reverse(): OrderedData<T>

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
  // W12: the column overloads — some('col')/every('col') test row[col]
  // truthiness (the fero R=∞ facade shape); dedup by column name.
  some<C extends ColOf<T>>(col: C): Scalar<boolean>
  every<C extends ColOf<T>>(col: C): Scalar<boolean>
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
  connect(records: ChangeRecordV2[], opts?: SinkOpts): SubscriptionHandle
  connect(anchor: object, fn: (record: ChangeRecordV2) => void, opts?: SinkOpts): SubscriptionHandle
  connect(anchor: object, prop: string): SubscriptionHandle
  sink(s: NativeSink): SubscriptionHandle
  each(fn: (key: RowKey, row: RowOf<T>) => void): void // W9: no-copy one-pass read
  rowCount(): number // W9: live count, no snapshot
  snapshot(opts?: { freeze?: boolean }): unknown // W9 freeze: deep-frozen rows — safe hand-out, no clone
  median(col?: string): Scalar<number | undefined> // W13
  percentile(col: string, p: number): Scalar<number | undefined> // W13
  percentile(p: number): Scalar<number | undefined>
  quantile(col: string, q: number): Scalar<number | undefined> // W13
  quantile(q: number): Scalar<number | undefined>
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
  ingest(
    records: readonly (WireRecord | ChangeRecordV2)[],
    opts?: {
      readonly origin?: symbol
      // consume per-record rejects (clause 10d) — absent: one AggregateError after the batch
      readonly onReject?: (reject: { readonly index: number; readonly record: WireRecord | ChangeRecordV2; readonly error: unknown }) => void
    },
  ): { readonly applied: number; readonly rejected: number }
  first(): DataChild<RowOf<T>>
  last(): DataChild<RowOf<T>>
  // W11: pre-pay the container-adoption spike (seed-then-serve boots).
  // SOURCE-ONLY like ingest() — the runtime throws on operator views.
  promote(): void
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

// ── the per-tag JSX attribute surface (inlined from jsx/intrinsics.ts) ───────
// The ONE shipped definition of the intrinsic-element types: jsx-runtime.d.ts
// (what a consumer's `jsxImportSource: "data"` resolves) aliases these through
// its exported JSX namespace, and the classic factory's merged `h.JSX`
// namespace (below, next to h) aliases the same four, so BOTH transforms gate
// against exactly this surface. A VERBATIM mirror of jsx/intrinsics.ts (the internal gates'
// single source of truth) with ONE rename — its attribute widening
// `Reactive<T>` is `Attr<T>` here, because `Reactive<T>` above is the
// value-slot type (`T | View<T>`). check.public.lockstep.ts pins every
// interface below to its jsx/intrinsics.ts twin by mutual assignability under
// Required<> (so a dropped/added/retyped attribute or tag fails the gate);
// edit intrinsics.ts first, then mirror the edit here.
//
// Typed to what the renderer ACTUALLY accepts (render/index.ts prop
// dispatch), not to React's vocabulary: on* FUNCTION props →
// addEventListener; handle / bind() prop values → per-binding attr
// subscriptions; static values through normAttr (null/undefined/false REMOVE
// the attribute, true → '' presence, everything else stringifies); 'checked'
// / 'value' write the DOM PROPERTY when the element carries it. Attributes
// are LITERAL: no className / style objects / class maps / htmlFor / ref.

// Every attribute value widens with Attr<T>: a static value, a live view
// (handle / scalar / child handle / DataNode — anything with snapshot()), or
// a bind(view, fn) record.
export type Attr<T> = T | ViewLike | BindLike

// The renderer forwards on{Anything} → addEventListener, so handlers are
// loosely typed; E defaults to any because this module can't name DOM types
// (zero imports, no lib assumption).
export type EventHandler<E = any> = (event: E) => void

// ── shared attribute surface ─────────────────────────────────────────────────

export interface DOMAttributes {
  // Accepted for JSX-idiom compatibility and IGNORED by any reconciler
  // (there is none to inform: row identity comes from the DATA layer's
  // RowKey, never from markup) — a static key just passes through the
  // renderer like any other attribute.
  key?: string | number

  // The literal global attributes the v3 renderer writes as-is.
  class?: Attr<string>
  id?: Attr<string>
  for?: Attr<string>
  title?: Attr<string>
  style?: Attr<string> // a plain attr STRING — v3 has no style objects
  hidden?: Attr<boolean> // normAttr: true → present-empty, false → removed
  tabindex?: Attr<number | string>

  children?: ChildLike

  // Event handlers — enumerated only for AUTOCOMPLETE. The renderer forwards
  // any on* function prop to addEventListener(name lowercased), so the open
  // index signature below catches every event not listed here.
  onClick?: EventHandler
  onDblClick?: EventHandler
  onChange?: EventHandler
  onInput?: EventHandler
  onBlur?: EventHandler
  onFocus?: EventHandler
  onKeyDown?: EventHandler
  onKeyUp?: EventHandler
  onKeyPress?: EventHandler
  onMouseDown?: EventHandler
  onMouseUp?: EventHandler
  onMouseMove?: EventHandler
  onMouseEnter?: EventHandler
  onMouseLeave?: EventHandler
  onMouseOver?: EventHandler
  onMouseOut?: EventHandler
  onPointerDown?: EventHandler
  onPointerUp?: EventHandler
  onPointerMove?: EventHandler
  onPointerEnter?: EventHandler
  onPointerLeave?: EventHandler
  onPointerCancel?: EventHandler
  onPointerOver?: EventHandler
  onPointerOut?: EventHandler
  onSubmit?: EventHandler
  onScroll?: EventHandler
  onWheel?: EventHandler
  onContextMenu?: EventHandler
  onDrag?: EventHandler
  onDragEnd?: EventHandler
  onDragEnter?: EventHandler
  onDragLeave?: EventHandler
  onDragOver?: EventHandler
  onDragStart?: EventHandler
  onDrop?: EventHandler
  onTouchStart?: EventHandler
  onTouchMove?: EventHandler
  onTouchEnd?: EventHandler
  onTouchCancel?: EventHandler
  onLoad?: EventHandler
  onError?: EventHandler

  // Open catch-all: the renderer forwards ANY attribute (data-*, aria-*,
  // future/unknown attrs, uncommon events), so unknown names must still
  // type-check. Known names declared above stay strictly checked — declared
  // members take precedence over the index signature.
  [attr: string]: any
}

// aria-* would pass through the index signature anyway; declared here for
// autocomplete + value narrowing on the common ones (ported from v2).
export interface AriaAttributes {
  'aria-label'?: Attr<string>
  'aria-labelledby'?: Attr<string>
  'aria-describedby'?: Attr<string>
  'aria-hidden'?: Attr<boolean | 'true' | 'false'>
  'aria-live'?: Attr<'off' | 'polite' | 'assertive'>
  'aria-checked'?: Attr<boolean | 'true' | 'false' | 'mixed'>
  'aria-disabled'?: Attr<boolean | 'true' | 'false'>
  'aria-expanded'?: Attr<boolean | 'true' | 'false'>
  'aria-selected'?: Attr<boolean | 'true' | 'false'>
  'aria-pressed'?: Attr<boolean | 'true' | 'false' | 'mixed'>
  'aria-current'?: Attr<boolean | 'page' | 'step' | 'location' | 'date' | 'time'>
  'aria-controls'?: Attr<string>
  'aria-haspopup'?: Attr<boolean | 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog'>
  role?: Attr<string>
}

// ── per-tag attribute interfaces (the v2 tag list, values adapted to v3) ─────

export interface HTMLAttributes extends DOMAttributes, AriaAttributes {
  accesskey?: Attr<string>
  autofocus?: Attr<boolean>
  contenteditable?: Attr<boolean | 'true' | 'false' | 'inherit'>
  contextmenu?: Attr<string>
  dir?: Attr<'ltr' | 'rtl' | 'auto'>
  draggable?: Attr<boolean | 'true' | 'false'>
  lang?: Attr<string>
  slot?: Attr<string>
  spellcheck?: Attr<boolean | 'true' | 'false'>
  translate?: Attr<'yes' | 'no'>
}

export interface AnchorHTMLAttributes extends HTMLAttributes {
  href?: Attr<string>
  target?: Attr<'_self' | '_blank' | '_parent' | '_top' | string>
  rel?: Attr<string>
  download?: Attr<string | boolean>
  hreflang?: Attr<string>
  type?: Attr<string>
  referrerpolicy?: Attr<string>
}

export interface ButtonHTMLAttributes extends HTMLAttributes {
  type?: Attr<'button' | 'submit' | 'reset'>
  disabled?: Attr<boolean>
  form?: Attr<string>
  formaction?: Attr<string>
  formmethod?: Attr<string>
  formnovalidate?: Attr<boolean>
  formtarget?: Attr<string>
  name?: Attr<string>
  value?: Attr<string | number>
}

export interface InputHTMLAttributes extends HTMLAttributes {
  type?: Attr<
    | 'button' | 'checkbox' | 'color' | 'date' | 'datetime-local' | 'email'
    | 'file' | 'hidden' | 'image' | 'month' | 'number' | 'password' | 'radio'
    | 'range' | 'reset' | 'search' | 'submit' | 'tel' | 'text' | 'time'
    | 'url' | 'week'
  >
  accept?: Attr<string>
  alt?: Attr<string>
  autocomplete?: Attr<string>
  capture?: Attr<boolean | 'user' | 'environment'>
  // Live form prop: written to the PROPERTY when the element carries it, so
  // a reactive binding keeps working after user interaction.
  checked?: Attr<boolean>
  disabled?: Attr<boolean>
  form?: Attr<string>
  list?: Attr<string>
  max?: Attr<number | string>
  maxlength?: Attr<number>
  min?: Attr<number | string>
  minlength?: Attr<number>
  multiple?: Attr<boolean>
  name?: Attr<string>
  pattern?: Attr<string>
  placeholder?: Attr<string>
  readonly?: Attr<boolean>
  required?: Attr<boolean>
  size?: Attr<number>
  src?: Attr<string>
  step?: Attr<number | string>
  // Live form prop, like checked.
  value?: Attr<string | number>
}

export interface TextareaHTMLAttributes extends HTMLAttributes {
  autocomplete?: Attr<string>
  cols?: Attr<number>
  dirname?: Attr<string>
  disabled?: Attr<boolean>
  form?: Attr<string>
  maxlength?: Attr<number>
  minlength?: Attr<number>
  name?: Attr<string>
  placeholder?: Attr<string>
  readonly?: Attr<boolean>
  required?: Attr<boolean>
  rows?: Attr<number>
  value?: Attr<string> // live form prop
  wrap?: Attr<'soft' | 'hard'>
}

export interface SelectHTMLAttributes extends HTMLAttributes {
  autocomplete?: Attr<string>
  disabled?: Attr<boolean>
  form?: Attr<string>
  multiple?: Attr<boolean>
  name?: Attr<string>
  required?: Attr<boolean>
  size?: Attr<number>
  value?: Attr<string | number> // live form prop
}

export interface OptionHTMLAttributes extends HTMLAttributes {
  disabled?: Attr<boolean>
  label?: Attr<string>
  selected?: Attr<boolean>
  value?: Attr<string | number>
}

export interface FormHTMLAttributes extends HTMLAttributes {
  action?: Attr<string>
  method?: Attr<'get' | 'post' | 'dialog'>
  enctype?: Attr<string>
  'accept-charset'?: Attr<string> // literal attr (v2 had the camel alias)
  autocomplete?: Attr<string>
  name?: Attr<string>
  novalidate?: Attr<boolean>
  target?: Attr<string>
}

export interface ImgHTMLAttributes extends HTMLAttributes {
  alt?: Attr<string>
  crossorigin?: Attr<'anonymous' | 'use-credentials' | ''>
  decoding?: Attr<'async' | 'auto' | 'sync'>
  height?: Attr<number | string>
  loading?: Attr<'eager' | 'lazy'>
  referrerpolicy?: Attr<string>
  sizes?: Attr<string>
  src?: Attr<string>
  srcset?: Attr<string>
  usemap?: Attr<string>
  width?: Attr<number | string>
}

export interface LabelHTMLAttributes extends HTMLAttributes {
  for?: Attr<string> // the literal attribute — v3 has no htmlFor alias
  form?: Attr<string>
}

export interface MetaHTMLAttributes extends HTMLAttributes {
  charset?: Attr<string>
  content?: Attr<string>
  'http-equiv'?: Attr<string> // literal attr (v2 had the camel alias)
  name?: Attr<string>
}

export interface ScriptHTMLAttributes extends HTMLAttributes {
  async?: Attr<boolean>
  crossorigin?: Attr<string>
  defer?: Attr<boolean>
  integrity?: Attr<string>
  nomodule?: Attr<boolean>
  nonce?: Attr<string>
  referrerpolicy?: Attr<string>
  src?: Attr<string>
  type?: Attr<string>
}

export interface IframeHTMLAttributes extends HTMLAttributes {
  allow?: Attr<string>
  allowfullscreen?: Attr<boolean>
  height?: Attr<number | string>
  loading?: Attr<'eager' | 'lazy'>
  name?: Attr<string>
  referrerpolicy?: Attr<string>
  sandbox?: Attr<string>
  src?: Attr<string>
  srcdoc?: Attr<string>
  width?: Attr<number | string>
}

export interface VideoHTMLAttributes extends HTMLAttributes {
  autoplay?: Attr<boolean>
  controls?: Attr<boolean>
  crossorigin?: Attr<string>
  height?: Attr<number | string>
  loop?: Attr<boolean>
  muted?: Attr<boolean>
  playsinline?: Attr<boolean>
  poster?: Attr<string>
  preload?: Attr<'none' | 'metadata' | 'auto'>
  src?: Attr<string>
  width?: Attr<number | string>
}

export interface AudioHTMLAttributes extends HTMLAttributes {
  autoplay?: Attr<boolean>
  controls?: Attr<boolean>
  crossorigin?: Attr<string>
  loop?: Attr<boolean>
  muted?: Attr<boolean>
  preload?: Attr<'none' | 'metadata' | 'auto'>
  src?: Attr<string>
}

export interface CanvasHTMLAttributes extends HTMLAttributes {
  height?: Attr<number | string>
  width?: Attr<number | string>
}

export interface SVGAttributes extends DOMAttributes, AriaAttributes {
  // Subset of the SVG presentation/geometry attribute surface (the set the
  // crossfilter charts exercise); the index signature catches the rest. The
  // renderer namespaces via the <svg> TAG (children inherit createElementNS),
  // so these are ordinary el records — no per-attr namespace handling.
  x?: Attr<number | string>
  y?: Attr<number | string>
  x1?: Attr<number | string>
  y1?: Attr<number | string>
  x2?: Attr<number | string>
  y2?: Attr<number | string>
  cx?: Attr<number | string>
  cy?: Attr<number | string>
  r?: Attr<number | string>
  rx?: Attr<number | string>
  ry?: Attr<number | string>
  width?: Attr<number | string>
  height?: Attr<number | string>
  d?: Attr<string>
  points?: Attr<string>
  fill?: Attr<string>
  stroke?: Attr<string>
  'stroke-width'?: Attr<number | string>
  'stroke-linecap'?: Attr<'butt' | 'round' | 'square'>
  'stroke-linejoin'?: Attr<'miter' | 'round' | 'bevel'>
  'stroke-dasharray'?: Attr<string>
  'stroke-dashoffset'?: Attr<number | string>
  opacity?: Attr<number | string>
  'fill-opacity'?: Attr<number | string>
  'stroke-opacity'?: Attr<number | string>
  transform?: Attr<string>
  'clip-path'?: Attr<string>
  'text-anchor'?: Attr<'start' | 'middle' | 'end'>
  dy?: Attr<number | string>
  dx?: Attr<number | string>
  viewBox?: Attr<string>
  preserveAspectRatio?: Attr<string>
  xmlns?: Attr<string>
  href?: Attr<string>
  'xlink:href'?: Attr<string>
  offset?: Attr<number | string>
  'stop-color'?: Attr<string>
  'stop-opacity'?: Attr<string>
}

// ── the JSX namespace surface (aliased by both transforms) ───────────────────

export interface ElementChildrenAttribute { children: {} }
export interface IntrinsicAttributes { key?: string | number }

export interface IntrinsicElements {
  // Document structure
  html: HTMLAttributes
  head: HTMLAttributes
  body: HTMLAttributes
  title: HTMLAttributes

  // Sections
  section: HTMLAttributes
  header: HTMLAttributes
  footer: HTMLAttributes
  main: HTMLAttributes
  nav: HTMLAttributes
  article: HTMLAttributes
  aside: HTMLAttributes
  h1: HTMLAttributes
  h2: HTMLAttributes
  h3: HTMLAttributes
  h4: HTMLAttributes
  h5: HTMLAttributes
  h6: HTMLAttributes
  hgroup: HTMLAttributes
  address: HTMLAttributes

  // Text content
  div: HTMLAttributes
  p: HTMLAttributes
  hr: HTMLAttributes
  pre: HTMLAttributes
  blockquote: HTMLAttributes
  ol: HTMLAttributes
  ul: HTMLAttributes
  li: HTMLAttributes
  dl: HTMLAttributes
  dt: HTMLAttributes
  dd: HTMLAttributes
  figure: HTMLAttributes
  figcaption: HTMLAttributes

  // Inline text
  a: AnchorHTMLAttributes
  em: HTMLAttributes
  strong: HTMLAttributes
  small: HTMLAttributes
  s: HTMLAttributes
  cite: HTMLAttributes
  q: HTMLAttributes
  dfn: HTMLAttributes
  abbr: HTMLAttributes
  time: HTMLAttributes
  code: HTMLAttributes
  var: HTMLAttributes
  samp: HTMLAttributes
  kbd: HTMLAttributes
  sub: HTMLAttributes
  sup: HTMLAttributes
  i: HTMLAttributes
  b: HTMLAttributes
  u: HTMLAttributes
  mark: HTMLAttributes
  ruby: HTMLAttributes
  rt: HTMLAttributes
  rp: HTMLAttributes
  bdi: HTMLAttributes
  bdo: HTMLAttributes
  span: HTMLAttributes
  br: HTMLAttributes
  wbr: HTMLAttributes

  // Embedded content
  img: ImgHTMLAttributes
  iframe: IframeHTMLAttributes
  embed: HTMLAttributes
  object: HTMLAttributes
  param: HTMLAttributes
  video: VideoHTMLAttributes
  audio: AudioHTMLAttributes
  source: HTMLAttributes
  track: HTMLAttributes
  map: HTMLAttributes
  area: HTMLAttributes
  picture: HTMLAttributes
  canvas: CanvasHTMLAttributes

  // Tabular data
  table: HTMLAttributes
  caption: HTMLAttributes
  colgroup: HTMLAttributes
  col: HTMLAttributes
  tbody: HTMLAttributes
  thead: HTMLAttributes
  tfoot: HTMLAttributes
  tr: HTMLAttributes
  td: HTMLAttributes
  th: HTMLAttributes

  // Forms
  form: FormHTMLAttributes
  label: LabelHTMLAttributes
  input: InputHTMLAttributes
  button: ButtonHTMLAttributes
  select: SelectHTMLAttributes
  datalist: HTMLAttributes
  optgroup: HTMLAttributes
  option: OptionHTMLAttributes
  textarea: TextareaHTMLAttributes
  output: HTMLAttributes
  progress: HTMLAttributes
  meter: HTMLAttributes
  fieldset: HTMLAttributes
  legend: HTMLAttributes

  // Interactive
  details: HTMLAttributes
  summary: HTMLAttributes
  dialog: HTMLAttributes
  menu: HTMLAttributes

  // Scripting / metadata
  script: ScriptHTMLAttributes
  noscript: HTMLAttributes
  template: HTMLAttributes
  slot: HTMLAttributes
  style: HTMLAttributes
  link: HTMLAttributes
  meta: MetaHTMLAttributes
  base: HTMLAttributes

  // SVG (namespaced by the renderer via the enclosing <svg> tag)
  svg: SVGAttributes
  g: SVGAttributes
  path: SVGAttributes
  rect: SVGAttributes
  circle: SVGAttributes
  ellipse: SVGAttributes
  line: SVGAttributes
  polyline: SVGAttributes
  polygon: SVGAttributes
  text: SVGAttributes
  tspan: SVGAttributes
  textPath: SVGAttributes
  defs: SVGAttributes
  clipPath: SVGAttributes
  mask: SVGAttributes
  pattern: SVGAttributes
  image: SVGAttributes
  use: SVGAttributes
  symbol: SVGAttributes
  marker: SVGAttributes
  linearGradient: SVGAttributes
  radialGradient: SVGAttributes
  stop: SVGAttributes
  foreignObject: SVGAttributes
  filter: SVGAttributes
  feGaussianBlur: SVGAttributes
  feOffset: SVGAttributes
  feMerge: SVGAttributes
  feMergeNode: SVGAttributes
  feColorMatrix: SVGAttributes
  feFlood: SVGAttributes
  feComposite: SVGAttributes
  desc: SVGAttributes

  // Forward-compat — unknown / custom-element tags still type-check.
  [tag: string]: any
}

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

// h.JSX — the CLASSIC transform's type lookup. Under jsx "react" + jsxFactory
// "h" (or the per-file `/** @jsxRuntime classic */ /** @jsx h */` pragmas)
// tsc reads the per-tag surface from the factory's OWN `JSX` namespace before
// falling back to a global one. public.d.ts declares no global JSX (a
// consumer's React types stay untouched), so without this merged namespace a
// classic consumer got TS7026 ("no interface JSX.IntrinsicElements") on every
// tag under strict — the 4.0.0 pre-publish audit's finding. The four members
// alias the SAME surface jsx-runtime.d.ts's JSX namespace aliases, so the two
// transforms cannot drift. (Module-private aliases, because a namespace
// member cannot name the outer declaration it shadows.) Gate:
// check.public.classic.tsx.
type ClassicElement = Element
type ClassicIntrinsicElements = IntrinsicElements
type ClassicElementChildrenAttribute = ElementChildrenAttribute
type ClassicIntrinsicAttributes = IntrinsicAttributes
export declare namespace h {
  namespace JSX {
    type Element = ClassicElement
    type IntrinsicElements = ClassicIntrinsicElements
    type ElementChildrenAttribute = ClassicElementChildrenAttribute
    type IntrinsicAttributes = ClassicIntrinsicAttributes
  }
}

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

// The automatic-runtime verbs. jsx-runtime.d.ts (the 'data/jsx-runtime' +
// 'data/jsx-dev-runtime' types) RE-EXPORTS these four — same declarations as
// api/jsx-runtime.ts re-exports the runtime's, so the injected Fragment and
// `import { Fragment } from 'data'` are one symbol.
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

// W1: the native wire egress (module export) — one keyDomain-tagged
// WireBatch per commit, values by reference, origin-capable; emit → wire →
// ingest round-trips by construction (incl. clause-10a nested deletes and
// array-born positions).
export function wireSink(
  target: object,
  out: (batch: WireBatch) => void,
  opts?: { readonly origin?: symbol | null; readonly initial?: boolean },
): SubscriptionHandle

// W3d/clause 10d: the ingest vocabulary shared by the module-level ingress
// forms (ingest(), lane()) and the instance verb d.ingest().
export interface IngestReject {
  readonly index: number
  readonly record: IngestRecord
  readonly error: unknown
}
export interface IngestReport {
  readonly applied: number
  readonly rejected: number
}
export interface IngestOpts {
  readonly origin?: symbol
  // consume per-record rejects — absent: one AggregateError after the batch
  readonly onReject?: (reject: IngestReject) => void
}

// The module-level record-apply ingress: one batch() commit per call, both
// wire profiles auto-detected, per-record isolation (clause 10d). Target is
// a $() source handle or a raw SourceNode.
export declare function ingest(
  target: object,
  records: readonly IngestRecord[],
  opts?: IngestOpts,
): IngestReport

// W7: the hot ingest lane — fero's frame-run Rec shape applied VERBATIM
// (numeric type tags, [rowKey, ...fieldPath] key paths, lazy-record safe,
// values installed by reference). Object-born (keyed) sources only.
export declare const HOT: { readonly update: 0; readonly insert: 1; readonly remove: 2 }
export interface HotRecord {
  readonly type: number // HOT.*
  readonly key: readonly (string | number)[] // PATH: [rowKey, ...fieldPath]
  readonly value?: unknown
  readonly at?: string | number // root-insert minted key when key is []
}
export type HotLane = (records: readonly HotRecord[]) => IngestReport
export declare function lane(target: object, opts?: IngestOpts): HotLane

// The pluggable-source boundary (plan §3.6): load/apply/subscribe.
export interface SourceBacking<T> {
  load(): { rows: Map<RowKey, T>; order: readonly RowKey[] | null }
  apply(records: readonly IngestRecord[], origin?: symbol): void
  subscribe(sink: {
    readonly wantsOrder?: boolean
    readonly origin?: symbol | null
    init(snapshot: ReadonlyMap<RowKey, T>, order?: readonly RowKey[]): void
    apply(batch: any): void
  }): SubscriptionHandle
}

// W5: mount(backing) — a live mirror source over a SourceBacking. The
// BACKING is the write authority (route writes through handle.apply);
// the mirror follows via subscribe. source is the raw node (handleFor).
export interface MountHandle<T> {
  readonly source: DataNode<T>
  apply(records: readonly IngestRecord[], origin?: symbol): void
  dispose(): void
}
export declare function mount<T>(runtime: Runtime, backing: SourceBacking<T>): MountHandle<T>

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

// The commit scheduler. runtime() returns the default instance. Beyond
// batch(): the observability trio kernel/runtime.ts exposes and the devtools
// layer (and the landing page's live sections) read — seq (the last settled
// commit's number: +1 per commit, the cascade id CommitInfo.seq carries),
// graph() (the live registry projection, GraphNodeInfo[]), onCommit(hook)
// (one CommitInfo per settled commit, per-node ms measured only while a hook
// is subscribed; dispose() the handle to stop — devtools.d.ts's trace() wraps
// exactly this). The write protocol (register / written / queueWrite / …) is
// kernel-internal and stays out. seq is read-only from outside: the kernel
// advances it.
export declare class Runtime {
  constructor()
  readonly seq: number
  batch<R>(fn: () => R): R
  graph(): GraphNodeInfo[]
  onCommit(hook: (c: CommitInfo) => void): { dispose(): void }
  private __v3RuntimeBrand: unknown
}

// The kernel's two native observability records — what the devtools layer
// ('data/devtools', typed by devtools.d.ts) derives everything from. Mirrors
// kernel/runtime.ts verbatim.
//
// One settled commit as Runtime.onCommit() reports it: seq IS the cascade
// id, origin the batch's OriginToken, nodes the per-node settle stats in
// settle (topological) order — measured only while a hook is subscribed.
export interface CommitInfo {
  readonly seq: number
  readonly origin: OriginToken
  readonly nodes: readonly { id: number; deltas: number; ms: number }[]
}

// One node of Runtime.graph()'s live registry projection.
export interface GraphNodeInfo {
  readonly id: number
  readonly kind: 'source' | 'operator' | 'scalar'
  readonly op: string
  readonly parents: readonly number[]
  readonly height: number
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
