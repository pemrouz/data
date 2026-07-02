// v3/seam — the data ↔ outside-world boundary (plan §3.6, proto/dir/PLAN.md).
//
// Four capabilities, all engine-adjacent but kernel-untouched:
//
//   ingest(target, records, opts?)  — the PUBLIC record-apply ingress: one
//     batch() commit per call, both wire profiles auto-detected, origin-token
//     threading for declarative echo suppression (SCHEDULE.md clause 6).
//   fromAsync(runtime, input, opts?) — async/streaming sources: a SourceNode
//     that starts empty and fills as data arrives (each drain = one commit),
//     with observable status transitions and scope-tied cancellation.
//   SourceBacking + InMemoryBacking — the pluggable-source boundary shape
//     (load/apply/subscribe), proven over the existing SourceNode/Store.
//   exportContract() — the machine-readable manifest fero consumes instead of
//     hand-copying RESERVED / operator classifications.
//
// Emission legality is untouched by design: every ingress routes through
// SourceNode's normal write/insert/remove entry points, so consolidation,
// no-op dropping, and clause-8 legality hold by construction (the seam adds
// no second write path). Tests conform()-wrap everything anyway.
//
// NB: this module deliberately does NOT import v3/api (which stubs ingest and
// will re-export from here — importing it back would be a cycle). The handle's
// node symbol is the versioned registry key Symbol.for('data.v3.node'), so the
// seam can unwrap api handles without the import.

// Static operator installs so exportContract() sees the full registry even
// when the seam is imported before/without the api entry.
import '../ops/rowops.ts'
import '../ops/aggregate.ts'
import '../ops/between.ts'
import '../ops/setops.ts'
import '../ops/bucket.ts'
import '../ops/ordered.ts'
import '../ops/misc.ts'

import { SourceNode } from '../kernel/node.ts'
import type { SubscriptionHandle } from '../kernel/node.ts'
import type { Runtime } from '../kernel/runtime.ts'
import { currentScope } from '../kernel/scope.ts'
import { SCHEMA_VERSION, RESERVED } from '../contract/index.ts'
import type { ChangeRecordV2, WireRecord, OpCategory } from '../contract/index.ts'
import type {
  CollectionSink, CommitBatch, OriginToken, Path, RowKey,
} from '../contract/delta.ts'
import { registry } from '../ops/registry.ts'

// The api handle's node symbol (Symbol.for — shared registry, no api import).
const NODE = Symbol.for('data.v3.node')

// ── ingest: the public record-apply ingress ──────────────────────────────────
//
// Applies a batch of wire records to a SourceNode as ONE batch() commit.
// Profile auto-detection is per-record: {t: ...} = native WireRecord
// (SCHEMA_VERSION 3, stable keys), {type: ...} = ChangeRecordV2 (positional
// keys for array-born sources resolve through currentOrder() at application
// time — mid-batch records see the order as already mutated by earlier
// records in the same call, matching v2's application-time index semantics).
//
// Idempotence / LWW tolerance (fero's at-least-once delivery needs this):
//   - an `add` for an already-live key routes as a whole-row update
//     (path []), NOT an error — last-writer-wins on redelivery/races;
//   - an `update` with path [] for a non-live key routes as an add
//     (the same tolerance in the other direction);
//   - a `remove` for a non-live key is a silent no-op (SourceNode.remove
//     already is);
//   - an `update` with a NON-empty path for a non-live key stays LOUD
//     (SourceNode.write throws — a deep write cannot invent a row).
//
// Deferred: `move` records (both profiles) throw — the order-splice ingress
// lands with the render/ordered seam work.

export type IngestRecord = WireRecord | ChangeRecordV2

export interface IngestOpts {
  readonly origin?: OriginToken
}

export type IngestTarget = SourceNode<any> | { readonly [k: symbol]: unknown }

function resolveSource(target: unknown): SourceNode<any> {
  if (target instanceof SourceNode) return target
  const n =
    target !== null && (typeof target === 'object' || typeof target === 'function')
      ? (target as any)[NODE]
      : undefined
  if (n instanceof SourceNode) return n
  throw new Error(
    'data: ingest() target must be a source — pass the api handle of a $() source or a raw SourceNode (operator views are read-only projections)',
  )
}

export function ingest(target: IngestTarget, records: readonly IngestRecord[], opts: IngestOpts = {}): void {
  const src = resolveSource(target)
  const run = () => {
    for (const r of records) {
      if (r !== null && typeof r === 'object' && 't' in r) applyWire(src, r as WireRecord)
      else if (r !== null && typeof r === 'object' && 'type' in r) applyV2(src, r as ChangeRecordV2)
      else throw new Error(`data: ingest() cannot detect record profile: ${JSON.stringify(r)}`)
    }
  }
  // NB: withOrigin(origin, () => batch(run)) rather than batch(run, origin) —
  // Runtime.batch restores currentOrigin in its finally BEFORE flushing, so
  // its own origin param never reaches the commit stamp (kernel gap, reported
  // in the M4 seam notes). withOrigin stays installed across the flush.
  if (opts.origin) src.runtime.withOrigin(opts.origin, () => src.runtime.batch(run))
  else src.runtime.batch(run)
}

function applyWire(src: SourceNode<any>, r: WireRecord): void {
  switch (r.t) {
    case 'add':
      // Live key → whole-row update (LWW tolerance); missing key → add.
      // SourceNode.write handles both at the single chokepoint.
      src.write(r.k, [], r.v)
      return
    case 'update':
      src.write(r.k, (r.path ?? []) as Path, r.v)
      return
    case 'remove':
      src.remove(r.k) // silent for non-live keys — idempotent redelivery
      return
    case 'move':
      throw new Error(
        'data: ingest() does not support move records yet — order splice ingress lands with the render/ordered seam (deferred)',
      )
  }
}

// v2 profile key resolution: array-born sources address rows POSITIONALLY
// (the record's key[0] is an index string, resolved through currentOrder()
// at application time); object-born sources address by property name.
// Returns undefined for an out-of-range positional index (caller decides
// loud vs silent per verb).
function v2RowKey(src: SourceNode<any>, name: string): RowKey | undefined {
  const ord = src.currentOrder()
  if (ord !== null) {
    if (!/^\d+$/.test(name))
      throw new Error(`data: ingest() v2 record addresses array-born source with non-positional key ${JSON.stringify(name)}`)
    const i = Number(name)
    return i < ord.length ? ord[i] : undefined
  }
  return name
}

function applyV2(src: SourceNode<any>, r: ChangeRecordV2): void {
  if (r.type === 'move')
    throw new Error(
      'data: ingest() does not support move records yet — order splice ingress lands with the render/ordered seam (deferred)',
    )
  if (r.type === 'insert') {
    if (src.currentOrder() !== null) {
      src.insert(r.value, typeof r.at === 'number' ? r.at : undefined)
      return
    }
    // object-born: v2 encodes the key in `at` (V2RecordSink emits at: d.key);
    // a live `at` key routes as a whole-row update (the add tolerance).
    if (r.at === undefined || r.at === null) src.insert(r.value)
    else src.write(r.at as RowKey, [], r.value)
    return
  }
  if (r.type === 'update') {
    if (r.key.length === 0) {
      applyV2WholeValue(src, r.value)
      return
    }
    const key = v2RowKey(src, r.key[0])
    if (key === undefined)
      throw new Error(`data: ingest() v2 update at positional key ${r.key[0]} — out of range (order has ${src.currentOrder()!.length} rows)`)
    src.write(key, r.key.slice(1), r.value)
    return
  }
  // remove
  const key = v2RowKey(src, r.key[0])
  if (key === undefined) return // out-of-range positional remove — idempotent no-op
  if (r.key.length > 1)
    throw new Error('data: ingest() nested-field removal is not supported (v2 deep delete) — write undefined/null instead')
  src.remove(key)
}

// v2 whole-value update ({key: [], value: snapshot}) — the record every v2
// connect() opens with. Applied as a diff against current state so replaying
// a captured v2 stream into a fresh source reconstructs it exactly, and
// re-ingesting into an already-synced source is a no-op (central Object.is
// dropping absorbs the unchanged rows).
function applyV2WholeValue(src: SourceNode<any>, value: unknown): void {
  const ord = src.currentOrder()
  if (ord !== null) {
    const next = Array.isArray(value) ? value : []
    const pre = [...ord] // snapshot — writes below mutate the live order
    const n = Math.min(pre.length, next.length)
    for (let i = 0; i < n; i++) src.write(pre[i], [], next[i])
    for (let i = pre.length - 1; i >= next.length; i--) src.remove(pre[i])
    for (let i = pre.length; i < next.length; i++) src.insert(next[i])
    return
  }
  const next = (value ?? {}) as Record<string, unknown>
  if (typeof next !== 'object')
    throw new Error('data: ingest() whole-value v2 update for an object-born source must carry an object')
  for (const k of [...src.snapshot().keys()]) {
    if (!Object.prototype.hasOwnProperty.call(next, String(k))) src.remove(k)
  }
  for (const k of Object.keys(next)) src.write(k, [], next[k])
}

// ── fromAsync: async / streaming sources ─────────────────────────────────────
//
// A source that starts empty and fills as data arrives. Each drain is ONE
// batch commit (SCHEDULE.md clause 1/3 — sinks see chunk-consistent states,
// never a half-applied chunk). Status transitions pending → ready | error are
// observable via status() and the plain opts.onStatus callback (a reactive
// status VIEW layers later — see the module's deferred list). dispose()
// cancels consumption (and is scope-owned, so disposing an enclosing scope
// cancels too); rows already committed stay live on the source.
//
// Keying: opts.key adopts a stable per-row key (object-born store; a
// redelivered key LWW-overwrites — the same ingest tolerance); without it the
// source is array-born and rows append with minted keys in arrival order.
//
// Coalescing (opts.coalesce, default 'sync'): 'sync' commits each drained
// chunk immediately; 'microtask' buffers chunks and flushes once per
// microtask window (the flush is scheduled two hops out so chunks already
// settled in the current tick merge into one commit) — clause 9's opt-in
// sugar, never a semantic change.

export type AsyncStatus = 'pending' | 'ready' | 'error'

export interface FromAsyncOpts<T> {
  readonly key?: (row: T) => RowKey
  readonly coalesce?: 'sync' | 'microtask'
  readonly onStatus?: (s: AsyncStatus) => void
}

export interface AsyncSourceHandle<T> {
  readonly source: SourceNode<T>
  status(): AsyncStatus
  error(): unknown
  dispose(): void
}

function isAsyncIterable<T>(v: unknown): v is AsyncIterable<T[]> {
  return v !== null && typeof v === 'object' && typeof (v as any)[Symbol.asyncIterator] === 'function'
}

export function fromAsync<T>(
  runtime: Runtime,
  input: Promise<readonly T[]> | AsyncIterable<readonly T[]>,
  opts: FromAsyncOpts<T> = {},
): AsyncSourceHandle<T> {
  const keyFn = opts.key
  const source = new SourceNode<T>(runtime, (keyFn ? {} : []) as any, 'fromAsync')
  let status: AsyncStatus = 'pending'
  let error: unknown
  let cancelled = false
  let buffer: T[] | null = null
  let iterator: AsyncIterator<readonly T[]> | null = null

  const setStatus = (s: AsyncStatus) => {
    if (status !== 'pending') return // terminal states never regress
    status = s
    opts.onStatus?.(s)
  }

  const commitRows = (rows: readonly T[]) => {
    if (cancelled || source.disposed || rows.length === 0) return
    runtime.batch(() => {
      for (const row of rows) {
        if (keyFn) source.write(keyFn(row), [], row) // add, or LWW update on redelivery
        else source.insert(row)
      }
    })
  }

  const flush = () => {
    if (buffer === null) return
    const b = buffer
    buffer = null
    commitRows(b)
  }

  const drain = (rows: readonly T[]) => {
    if (opts.coalesce === 'microtask') {
      if (buffer === null) {
        buffer = []
        // Two hops: chunks whose awaits settle in the current tick land in
        // the buffer BEFORE the flush runs, merging into one commit.
        queueMicrotask(() => queueMicrotask(flush))
      }
      for (const row of rows) buffer.push(row)
    } else {
      commitRows(rows)
    }
  }

  const run = async () => {
    try {
      if (isAsyncIterable<T>(input)) {
        iterator = input[Symbol.asyncIterator]()
        while (true) {
          const r = await iterator.next()
          if (cancelled) return
          if (r.done) break
          drain(r.value)
        }
      } else {
        const rows = await (input as Promise<readonly unknown[]> | readonly unknown[])
        if (cancelled) return
        drain(rows as any)
      }
      flush() // commit any coalesce buffer before declaring ready
      setStatus('ready')
    } catch (e) {
      if (cancelled) return
      error = e
      setStatus('error')
    }
  }
  void run()

  const handle: AsyncSourceHandle<T> = {
    source,
    status: () => status,
    error: () => error,
    dispose() {
      if (cancelled) return
      cancelled = true
      buffer = null
      // Release the producer (generators run their finally blocks).
      if (iterator?.return) void iterator.return(undefined as any).catch(() => {})
    },
  }
  // Scope-tied cancellation: disposing the enclosing scope stops consumption
  // (the source node registered itself with the same scope in its ctor).
  currentScope()?.add({ dispose: () => handle.dispose() })
  return handle
}

// ── SourceBacking: the pluggable-source boundary (plan §3.6) ─────────────────
//
// The kernel boundary a distributed/persistent source implements. Shape per
// plans/v3/PLAN.md §3.6 (load/apply/subscribe); proto/dir/PLAN.md's sketch
// (snapshot/read/write/subscribe) maps onto it as load ⊇ snapshot, apply ⊇
// write (records are the write vocabulary — routing/DHT/LWW is the backing's
// choice), subscribe unchanged. `read(key)` (local-vs-remote-handle
// resolution) is deliberately NOT here yet: it changes how the api resolves
// child reads and belongs to the fero-L3 workstream (see PLAN.md §Seam 2
// sequencing).
//
//   load()      — current state, once, at attach time (late-join / connect).
//   apply()     — route a record batch in (ONE commit; origin threads through
//                 for echo suppression).
//   subscribe() — snapshot-then-deltas per SCHEDULE.md clause 7: init() with
//                 settled state, then apply(batch) per commit, exactly once.

export interface SourceBacking<T> {
  load(): { rows: Map<RowKey, T>; order: readonly RowKey[] | null }
  apply(records: readonly IngestRecord[], origin?: OriginToken): void
  subscribe(sink: CollectionSink<T> & { readonly origin?: OriginToken | null }): SubscriptionHandle
}

// The default backing: SourceNode/Store behind the interface — proves the
// boundary shape (a fero distributed backing implements the same three
// methods over its log/DHT instead).
export class InMemoryBacking<T> implements SourceBacking<T> {
  declare readonly source: SourceNode<T>

  constructor(runtime: Runtime, value: Record<string, T> | T[], name = 'backed-source') {
    ;(this as { source: SourceNode<T> }).source = new SourceNode<T>(runtime, value, name)
  }

  load(): { rows: Map<RowKey, T>; order: readonly RowKey[] | null } {
    return { rows: this.source.snapshot(), order: this.source.currentOrder() }
  }

  apply(records: readonly IngestRecord[], origin?: OriginToken): void {
    ingest(this.source, records, origin ? { origin } : {})
  }

  subscribe(sink: CollectionSink<T> & { readonly origin?: OriginToken | null }): SubscriptionHandle {
    sink.init(this.source.snapshot(), this.source.currentOrder() ?? undefined)
    return this.source.connect({
      wantsOrder: sink.wantsOrder ?? false,
      origin: sink.origin ?? null,
      apply: (b: CommitBatch<T>) => sink.apply(b),
    })
  }
}

// ── exportContract: the machine-readable manifest ────────────────────────────
//
// Everything a layered consumer (fero, codegen, guidance tooling) needs to
// classify the surface without hand-copying: schema version, the frozen
// RESERVED name set, and per-operator capability descriptors projected from
// the live registry (single source of truth — drift is impossible). fero
// deletes its BUILTIN/DECOMPOSABLE/HOLISTIC hand-copies against this.

export interface ContractManifest {
  readonly SCHEMA_VERSION: number
  readonly reserved: readonly string[]
  readonly operators: Readonly<Record<string, { category: OpCategory; declarative: boolean }>>
}

export function exportContract(): ContractManifest {
  const operators: Record<string, { category: OpCategory; declarative: boolean }> = {}
  for (const [name, def] of registry) {
    operators[name] = { category: def.category, declarative: def.declarative }
  }
  return { SCHEMA_VERSION, reserved: [...RESERVED], operators }
}
