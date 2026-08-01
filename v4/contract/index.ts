// v3/contract — the engine-free package contract. No symbols, no proxies, no
// engine imports: this entry is consumable by fero, codegen, and guidance
// tooling without pulling in the kernel (the load-bearing property
// proto/dir/PLAN.md specified).

export * from './delta.ts'
import type { RowKey } from './delta.ts'

export const SCHEMA_VERSION = 3 as const

// ── Wire profiles ────────────────────────────────────────────────────────────
// Native profile (SCHEMA_VERSION 3): stable keys, prev, path, move-with-key.
// Keys serialize domain-tagged: {k: 5} (minted int) vs {k: "5"} (adopted
// string) — JSON distinguishes them; a batch header carries the store's
// keyDomain so a remote fold reconstructs identity exactly.
export type WireRecord =
  | { t: 'add'; k: RowKey; v: unknown }
  | { t: 'update'; k: RowKey; v: unknown; prev?: unknown; path?: readonly (string | number)[] }
  | { t: 'remove'; k: RowKey; prev?: unknown }
  | { t: 'move'; k: RowKey; from: number; to: number }

// v2-compat profile — PERMANENT, not a shim. Byte-parity with v2's
// ChangeRecord stream: positional keys for array-born sources (projected
// through the order channel), string key paths, cloned values, `at` for
// inserts. fero-v2 consumes this shape today.
export type ChangeRecordV2 =
  | { type: 'update' | 'insert' | 'remove'; key: string[]; value: unknown; at?: unknown }
  | { type: 'move'; from: number; to: number }

// ── Reserved names ───────────────────────────────────────────────────────────
// The versioned reserved-name set: property access on these names resolves to
// operators/built-ins, never to data children. `get(key)` is the total,
// collision-free child read. Frozen for all of v3 — new operators may only
// claim new names in a major.
export const RESERVED: ReadonlySet<string> = new Set([
  // built-ins
  'get', 'set', 'update', 'insert', 'remove', 'patch', 'ingest', 'connect',
  'snapshot', 'raf', 'first', 'last', 'mirror', 'dispose',
  // operators
  'filter', 'between', 'gt', 'lt', 'gte', 'lte',
  'az', 'za', 'top', 'limit', 'page',
  'length', 'sum', 'avg', 'max', 'min', 'some', 'every',
  'intersect', 'union', 'except',
  'group', 'distinct', 'map', 'to', 'reduce', 'tap',
  'keys', 'values', 'reverse', 'join',
])

// ── Capability descriptors ───────────────────────────────────────────────────
// Generated-from-registry in M1+ (a readonly projection of ops/registry.ts);
// seeded here so fero can consume the category vocabulary from day one.
export type OpCategory = 'rowop' | 'aggregate-decomposable' | 'holistic' | 'iter'
export interface OpDescriptor {
  readonly category: OpCategory
  readonly declarative: boolean // args expressible as data (Expr/values), no opaque closures required
}

// ── Snapshot fold ────────────────────────────────────────────────────────────
// Folds one native WireRecord into a plain snapshot representation — the
// proto/dir foldSnapshot, promoted. A viewing/replay aid: the engine itself
// only moves forward.
export interface FoldState {
  rows: Map<RowKey, unknown>
  order: RowKey[]
}

export function foldSnapshot(state: FoldState, r: WireRecord): FoldState {
  switch (r.t) {
    case 'add':
      state.rows.set(r.k, r.v)
      if (!state.order.includes(r.k)) state.order.push(r.k)
      return state
    case 'update':
      state.rows.set(r.k, r.v)
      return state
    case 'remove': {
      state.rows.delete(r.k)
      const i = state.order.indexOf(r.k)
      if (i >= 0) state.order.splice(i, 1)
      return state
    }
    case 'move': {
      const i = state.order.indexOf(r.k)
      if (i >= 0) {
        state.order.splice(i, 1)
        state.order.splice(r.to, 0, r.k)
      }
      return state
    }
  }
}
