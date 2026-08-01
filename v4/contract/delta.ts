// v3/contract/delta.ts — the closed delta algebra. SCHEMA_VERSION = 3.
//
// This is the WHOLE protocol: three row verbs, three order verbs, one scalar
// shape, one batch envelope. There is no other verb surface. Every operator
// consumes and emits exactly this; every sink implements one exhaustive
// switch over RowDelta['op']. A missed verb is a compile error (TS
// exhaustiveness); an illegal emission is a runtime conformance failure
// (conformance/legality.ts).
//
// Design rulings this file encodes (plans/v3/PLAN.md §3.1, §4):
// - update is FIRST-CLASS and carries `prev` (oldValue). Never retract+insert.
// - Ordering is a separate channel consumed only by sinks that declare
//   `wantsOrder` — position-agnostic consumers never see moves.
// - Batches are consolidated: ≤1 row delta per key per batch. Sinks never
//   observe intra-batch intermediate states.
// - Absence = key not live. `undefined` and `null` are first-class VALUES;
//   there are no positional holes in the value domain.

export type RowKey = number | string
// number = synthetic key minted at ingress (array-born rows) — monotonic per
//          store, never reused.
// string = adopted key (object-born rows) — the property name.
// INVARIANT: kernel state is keyed ONLY via Map/Set (never plain-object
// property tables), so 1 and '1' can never collide.

export type Path = readonly (string | number)[]

export interface AddDelta<T> {
  readonly op: 'add'
  readonly key: RowKey
  readonly row: T
}

export interface RemoveDelta<T> {
  readonly op: 'remove'
  readonly key: RowKey
  readonly prev: T // the removed row — oldValue, always present
}

export interface UpdateDelta<T> {
  readonly op: 'update' // FIRST-CLASS. Never encoded as remove+add.
  readonly key: RowKey
  readonly row: T // post-write row (reference)
  readonly prev: T // pre-write row (reference; structurally shared with row)
  readonly path: Path // [] = whole-row overwrite; ['f'] = field edit; deeper = nested
}

export type RowDelta<T> = AddDelta<T> | RemoveDelta<T> | UpdateDelta<T>

// The SEPARATE order/rank channel. Emitted only by ordered nodes (array-born
// sources, OrderedView); consumed only by sinks with `wantsOrder: true`.
// Within a batch, order deltas apply AFTER row deltas, in array order.
export interface OrderDelta {
  readonly op: 'orderInsert' | 'orderRemove' | 'orderMove'
  readonly key: RowKey
  readonly index: number // position (for move: destination)
  readonly from?: number // move only
}

// Scalar nodes (aggregates, .to()) — emitted only when !Object.is(prev, next).
export interface ScalarDelta {
  readonly prev: unknown
  readonly next: unknown
}

// Write-origin token. Every batch carries the origin of the commit that
// produced it; a sink that writes marks its writes with its own origin, so
// echo suppression is `if (batch.origin === mine) return` — declarative.
export type OriginToken = symbol

export interface CommitBatch<T> {
  readonly seq: number // per-runtime monotonic commit id (causality/devtools)
  readonly origin: OriginToken
  readonly rows: readonly RowDelta<T>[] // consolidated: ≤1 delta per key
  // order/scalar are REQUIRED-but-undefined rather than optional: every batch
  // object has the same hidden class (monomorphic for every consumer IC).
  readonly order: readonly OrderDelta[] | undefined // only from ordered nodes
  readonly scalar: ScalarDelta | undefined // only from scalar nodes
}

// The sink contract — closed, exhaustive, typed. snapshot-then-deltas:
// init() delivers the current state once at connect time, then apply()
// delivers every subsequent commit exactly once.
export interface CollectionSink<T> {
  readonly wantsOrder?: boolean
  init(snapshot: ReadonlyMap<RowKey, T>, order?: readonly RowKey[]): void
  apply(batch: CommitBatch<T>): void
}

// Batch consolidation rules (the kernel implements these once; documented
// here because legality checking and replay both depend on them):
//   add     + update  → add (updated row)
//   add     + remove  → annihilate (no delta)
//   update  + update  → update (first prev, last row; path = common prefix or [])
//   update  + remove  → remove (first prev)
//   remove  + add     → update (removed prev, new row, path [])
// LWW within a batch; a key that existed before the batch can never surface
// as `add`, and a key that did not exist can never surface as `update`/`remove`.
export type ConsolidationRule = never // marker for doc-reference only
