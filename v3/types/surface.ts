// v3/types/surface.ts — the TYPES-FIRST public surface (plan §3.2; STATUS
// "known gaps" item 4). DECLARATION LEVEL: this module types the EXISTING v3
// runtime — it adds one typed facade (`typedDollar`, a cast over the runtime
// `$`) and zero runtime behavior. Gate: `npx tsc -p v3/types` compiles
// check.ts (positives) + check.negative.ts (@ts-expect-error negatives)
// against these types with noCheck:false.
//
// The vocabulary mirrors api/index.ts's ACTUAL runtime dispatch:
//
// - `Data<T>` — a `$()` SOURCE handle: reads + METHODS-ONLY writes. Only the
//   writes the runtime actually accepts on a source root are present
//   (set/insert/patch/ingest — root `update()`/`remove()` THROW at runtime,
//   so they are absent here too). Bare assignment / `delete` are
//   structurally impossible: every child property is `readonly`.
// - `ReadonlyData<T>` — an OPERATOR-VIEW handle. DECISION (the brief's
//   either/or): operator returns are a DISTINCT read-only handle WITHOUT the
//   write methods, rather than `update(): never` — misuse then fails at the
//   METHOD NAME ("Property 'update' does not exist"), pointing at the same
//   fact the runtime error does ("derived projection — write through its
//   source"), and autocomplete never offers a write on a derived view.
// - `DataChild<V>` / `ReadonlyChild<V>` — child handles reached by property
//   sugar / `get()`. They are PATH ADDRESSES into the owning node, not
//   views: they deliberately carry NO operator methods and NO connect()
//   (the runtime dispatches reserved names against the OWNING node, so
//   `d.a.filter(...)` would filter the WHOLE source, and `connect()` on a
//   child path throws "not yet supported" — the types forbid both).
// - `View<out T>` — the covariant read side: anything holding a current
//   value ([value] + the [node] brand). `Reactive<T> = T | View<T>` types
//   every reactive value-slot arg (the ops/reactive.ts uniform binder:
//   gt/lt/gte/lte thresholds, za/az/top/limit window sizes, sum/avg
//   columns). Child handles and scalars both satisfy `View` structurally,
//   so `d.za('val', controls.page)` and `d.gt('val', other.sum('x'))` bind.
// - `Scalar<V>` — an aggregate result: View + snapshot/connect/dispose.
//   sum → number (0 on empty); avg → number|undefined; length → number;
//   max/min → column-element-typed |undefined; some/every → boolean.
// - Ordered views MATERIALIZE AS ARRAYS in rank order (STATUS decision):
//   az/za/top/limit return `OrderedData<T> = ReadonlyData<RowOf<T>[]>`.
// - Keyed materialization: row/set/bucket ops have NO order channel, so
//   over an ARRAY-born source their [value] is the keyed object
//   `Record<string, Row>` (minted integer keys, stringified) — `KeyedOf<T>`
//   encodes exactly what `materialize()` produces.
// - `Children<T>` — property sugar minus the RESERVED names (a mapped type
//   excluding the `Reserved` literal union; for array sources a numeric
//   index signature, matching the runtime's coerceKey).
//
// NB the `Reserved` union below is a hand-mirror of contract/index.ts's
// runtime `RESERVED` Set (which has no literal types to derive from). The
// planned registry-generated surface replaces both; until then keep them in
// lockstep — RESERVED is frozen for all of v3, so drift risk is one-way
// (a new major).

import type { ChangeRecordV2, WireRecord, RowKey } from '../contract/index.ts'

export type { ChangeRecordV2, WireRecord, RowKey }

// The handle's symbols. Minted via Symbol.for against the SAME global
// registry keys api/index.ts uses, so these are the identical runtime
// symbols WITHOUT importing the api module (see the typedDollar note below
// for why the api must not enter this gate's program as a static import) —
// and unlike the api's `symbol`-typed consts, these are `unique symbol`s,
// which is what lets an interface declare `readonly [value]: T`.
export const value: unique symbol = Symbol.for('data.v3.value')
export const node: unique symbol = Symbol.for('data.v3.node')

// Structural mirror of kernel/node.ts's SubscriptionHandle (declared here
// rather than imported: kernel/node.ts transitively pulls kernel/runtime.ts,
// which carries a known type error — see the typedDollar note).
export interface SubscriptionHandle {
  dispose(): void
}

// ── reserved names ───────────────────────────────────────────────────────────
// Mirror of contract/index.ts RESERVED (frozen for all of v3). Property
// access on these resolves to methods/operators, never to data children —
// so the Children mapped type excludes them and get() is the escape hatch.
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
// NB: 'page' / 'reverse' / 'join' are RESERVED but UNIMPLEMENTED (the
// runtime throws "reserved name … has no implementation yet") — they are
// deliberately ABSENT from Ops<T>, so calling them is a compile error now
// and gains a signature (not a breaking change) when they land.

// ── shape helpers ────────────────────────────────────────────────────────────

// What [value] / snapshot() materialize for a handle over T (identity today;
// named so the materialization contract has a nameable home).
export type SnapshotOf<T> = T

// The row (member) type of a collection T.
export type RowOf<T> = T extends readonly (infer R)[]
  ? R
  : T extends object
    ? T[Extract<keyof T, string>]
    : never

// Column names, key-checked against the row shape. Object rows key-check;
// scalar rows (and any row type without a static keyset) fall back to
// string — the v2 fallback rule.
export type ColOf<T> = RowOf<T> extends infer R
  ? [R] extends [object]
    ? Extract<keyof R, string>
    : string
  : never

// The element type of column C on T's rows (threshold / max / min typing).
export type ColVal<T, C extends string> = RowOf<T> extends infer R
  ? [R] extends [object]
    ? C extends keyof R
      ? R[C]
      : never
    : R
  : never

// What a KEYED (order-channel-free) derived view materializes over T:
// object sources keep their shape; array-born sources become the keyed
// object of minted keys (row/set/bucket operators do not forward order).
export type KeyedOf<T> = T extends readonly (infer R)[] ? Record<string, R> : T

// Addressable member keys of a source (set/get/patch): minted integer keys
// for array-born sources, string keys otherwise.
export type KeyOf<T> = T extends readonly unknown[] ? number : Extract<keyof T, string>

// The member value at key K.
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

// Every reactive value-slot arg (ops/reactive.ts): a plain value or any
// live view of one — a scalar aggregate, a child handle, a whole handle.
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

// ── child handles (path addresses; no operators, no connect — see header) ────

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

// A row comparator for az/za's function form.
export type CmpFn<T> = (a: RowOf<T>, b: RowOf<T>) => number

// A keyed-collection operand for the set operators (any view whose rows are
// R — a source handle, a derived view, an ordered view).
export type KeyedView<R> = View<Record<string, R>> | View<readonly R[]>

export interface Ops<T> {
  // row ops (keyed output — no order channel)
  filter(pred: (row: RowOf<T>, key: RowKey) => unknown): ReadonlyData<KeyedOf<T>>
  map<U>(fn: (row: RowOf<T>, key: RowKey) => U): ReadonlyData<Record<string, U>>
  gt<C extends ColOf<T>>(col: C, threshold: Reactive<ColVal<T, C>>): ReadonlyData<KeyedOf<T>>
  lt<C extends ColOf<T>>(col: C, threshold: Reactive<ColVal<T, C>>): ReadonlyData<KeyedOf<T>>
  gte<C extends ColOf<T>>(col: C, threshold: Reactive<ColVal<T, C>>): ReadonlyData<KeyedOf<T>>
  lte<C extends ColOf<T>>(col: C, threshold: Reactive<ColVal<T, C>>): ReadonlyData<KeyedOf<T>>
  // between's bounds are STATIC numerics on this surface: the runtime's
  // reactive path is the node-level setBounds/hidden bounds source, which
  // the handle does not yet expose (kernel gap — see the layer notes).
  between(col: ColOf<T>, bounds?: readonly [(number | undefined)?, (number | undefined)?]): ReadonlyData<KeyedOf<T>>

  // ordered views — ARRAYS in rank order; window sizes are reactive slots
  az(by: ColOf<T> | CmpFn<T>, n?: Reactive<number>): OrderedData<T>
  za(by: ColOf<T> | CmpFn<T>, n?: Reactive<number>): OrderedData<T>
  top(n: Reactive<number>): OrderedData<T>
  limit(n: Reactive<number>): OrderedData<T>

  // aggregates — precisely-typed scalars
  length(): Scalar<number> // NB no length(fn) histogram: v3's lengthBuckets is not handle-dispatchable yet
  sum(col?: Reactive<ColOf<T>>): Scalar<number>
  avg(col?: Reactive<ColOf<T>>): Scalar<number | undefined>
  max(): Scalar<RowOf<T> | undefined>
  max<C extends ColOf<T>>(col: C): Scalar<ColVal<T, C> | undefined>
  min(): Scalar<RowOf<T> | undefined>
  min<C extends ColOf<T>>(col: C): Scalar<ColVal<T, C> | undefined>
  some(fn: (row: RowOf<T>) => unknown): Scalar<boolean>
  every(fn: (row: RowOf<T>) => unknown): Scalar<boolean>
  // reduce's init is the fold's identity ELEMENT — a plain value, never a
  // view (the runtime's assertPlainInit throws on a reactive init; here a
  // handle simply isn't assignable to A once acc pins it).
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
  // update() ("whole-source update not yet supported") and remove()
  // (row removal is d.get(k).remove() / d.a.remove()).
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

// ── the typed facade over the runtime $ ──────────────────────────────────────
//
// WHY A NON-LITERAL DYNAMIC IMPORT: v3's implementation is strip-types-only
// (STATUS: "v3 files are outside all typecheck gates") and today carries two
// known type errors in FROZEN files (kernel/runtime.ts:95 — batch()'s
// re-entrant defer pushes a bare closure where the write queue element is
// {origin, w}; seam/index.ts:307 — fromAsync awaits a T[]|AsyncIterable
// union into the T[] arm). A static `import { $ } from '../api/index.ts'`
// would pull the whole implementation into THIS gate's program and fail it
// on frozen files. tsc only follows literal import specifiers, so the
// runtime binding is loaded through a variable — node resolves it exactly
// the same at runtime; the types above are the contract this gate checks.
// Once those two fixes land (listed in the layer's integration notes), flip
// this to the static import.
const API: string = '../api/index.ts'
const { $: runtime$ } = (await import(API)) as { $: (v: unknown) => unknown }

export function typedDollar<T extends object>(v: T): Data<T> {
  return runtime$(v) as Data<T>
}
