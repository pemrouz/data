// seam — the data ↔ outside-world boundary (plan §3.6, proto/dir/PLAN.md).
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
// node symbol is the versioned registry key Symbol.for('data.v4.node'), so the
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
import '../ops/quantile.ts'

import { SourceNode, DataNode, attachSettled, leafAt } from '../kernel/node.ts'
import type { SubscriptionHandle } from '../kernel/node.ts'
import type { Runtime } from '../kernel/runtime.ts'
import { currentScope } from '../kernel/scope.ts'
import { SCHEMA_VERSION, RESERVED } from '../contract/index.ts'
import type { ChangeRecordV2, WireRecord, WireBatch, OpCategory } from '../contract/index.ts'
import type {
  AddDelta, CollectionSink, CommitBatch, OriginToken, Path, RowKey,
} from '../contract/delta.ts'
import { registry } from '../ops/registry.ts'

// The api handle's node symbol (Symbol.for — shared registry, no api import).
const NODE = Symbol.for('data.v4.node')

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
// `move` records (both profiles) route through SourceNode.move(): a pure
// order-channel reposition settled as an order diff (array-born sources
// only; the v2 profile resolves its positional `from` to a key first).

export type IngestRecord = WireRecord | ChangeRecordV2

// One rejected record (W3d). Delivery: rejects are COLLECTED during the batch
// and surfaced AFTER it closes — sibling records commit and emit first, so a
// poison record can never abort or starve the rest of its frame (the v3
// failure mode was worse than atomic: the prefix committed, the suffix was
// silently lost, and the error propagated — seed-13's frozen-union class).
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
  readonly origin?: OriginToken
  // Consume rejects without throwing (fero: count/journal and move on). When
  // absent, any reject throws ONE AggregateError after the batch has
  // committed — loud by default, never poisoning.
  readonly onReject?: (reject: IngestReject) => void
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

function resolveNode(target: unknown): DataNode<any> {
  if (target instanceof DataNode) return target
  const n =
    target !== null && (typeof target === 'object' || typeof target === 'function')
      ? (target as any)[NODE]
      : undefined
  if (n instanceof DataNode) return n
  throw new Error('data: wireSink() target must be a view — pass an api handle or a raw node')
}

// Reject/flush-error delivery shared by ingest() and lane(). Clause 10d
// promises rejects are surfaced AFTER the flush — including when an effect
// SINK throws during that flush (clause 4's AggregateError): the reject
// report must never be swallowed by a failing subscriber. With onReject the
// rejects are delivered first and the flush error rethrows; without it, both
// classes surface as ONE AggregateError (rejects + the effect failure).
const NO_FLUSH_ERROR = Symbol('no-flush-error')

function finishIngest(
  verb: 'ingest' | 'lane',
  total: number,
  rejects: IngestReject[] | null,
  onReject: ((r: IngestReject) => void) | undefined,
  flushError: unknown,
): void {
  if (rejects !== null) {
    if (onReject) for (const rj of rejects) onReject(rj)
    else if (flushError === NO_FLUSH_ERROR)
      throw new AggregateError(
        rejects.map((rj) => rj.error),
        `data: ${verb}() rejected ${rejects.length} of ${total} record(s) — the rest committed; pass opts.onReject to consume rejects without throwing`,
      )
    else
      throw new AggregateError(
        [...rejects.map((rj) => rj.error), flushError],
        `data: ${verb}() rejected ${rejects.length} of ${total} record(s) AND effect sink(s) failed during the commit — the rest committed; pass opts.onReject to consume rejects without throwing`,
      )
  }
  if (flushError !== NO_FLUSH_ERROR) throw flushError
}

export function ingest(
  target: IngestTarget,
  records: readonly IngestRecord[],
  opts: IngestOpts = {},
): IngestReport {
  const src = resolveSource(target)
  let applied = 0
  let rejects: IngestReject[] | null = null
  const run = () => {
    for (let i = 0; i < records.length; i++) {
      const r = records[i]
      try {
        if (r !== null && typeof r === 'object' && 't' in r) applyWire(src, r as WireRecord)
        else if (r !== null && typeof r === 'object' && 'type' in r) applyV2(src, r as ChangeRecordV2)
        else throw new Error(`data: ingest() cannot detect record profile: ${JSON.stringify(r)}`)
        applied++
      } catch (e) {
        // Per-record isolation (W3d, SCHEDULE clause 10): collect — never let
        // one record's throw unwind the loop. Delivery happens after the
        // batch closes, so user reject-handlers can never write mid-apply.
        ;(rejects ??= []).push({ index: i, record: r, error: e })
      }
    }
  }
  // NB: withOrigin(origin, () => batch(run)) rather than batch(run, origin) —
  // Runtime.batch restores currentOrigin in its finally BEFORE flushing, so
  // its own origin param never reaches the commit stamp (kernel gap, reported
  // in the M4 seam notes). withOrigin stays installed across the flush.
  let flushError: unknown = NO_FLUSH_ERROR
  try {
    if (opts.origin) src.runtime.withOrigin(opts.origin, () => src.runtime.batch(run))
    else src.runtime.batch(run)
  } catch (e) {
    flushError = e
  }
  finishIngest('ingest', records.length, rejects, opts.onReject, flushError)
  return { applied, rejected: rejects?.length ?? 0 }
}

function applyWire(src: SourceNode<any>, r: WireRecord): void {
  switch (r.t) {
    case 'add':
      // Live key → whole-row update (LWW tolerance); missing key → add.
      // SourceNode.write handles both at the single chokepoint. `at` (W1)
      // carries the order position for array-born mid-inserts.
      src.write(r.k, [], r.v, r.at)
      return
    case 'update':
      src.write(r.k, (r.path ?? []) as Path, r.v)
      return
    case 'remove':
      // Whole row, or nested FIELD deletion when `path` rides the record
      // (W3a). Both idempotent — non-live key / absent path are silent no-ops.
      src.remove(r.k, r.path as Path | undefined)
      return
    case 'move':
      // Positional reposition — SourceNode.move validates (array-born only)
      // and settles the change as an order diff; `from` is advisory (the
      // key addresses the row; redelivery after a drift stays correct).
      src.move(r.k, r.to)
      return
    default:
      // Any other verb is a malformed record: throw, so the ingest loop's
      // per-record isolation REJECTS it (counted, delivered to onReject or the
      // AggregateError). Silently returning here counted a typo'd verb as
      // applied — a replica desync with no signal (2026-09-22).
      throw new Error(`data: wire record verb ${JSON.stringify((r as any).t)} is not one of add | update | remove | move`)
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
  if (r.type === 'move') {
    // v2 BMV1 wire shape: { type:'move', from, to } — positional both ends.
    // Resolve `from` through the current order to the row KEY, then move it.
    const ord = src.currentOrder()
    if (ord === null)
      throw new Error('data: ingest() v2 move record targets an object-born (unordered) source')
    const k = ord[(r as any).from as number]
    if (k !== undefined) src.move(k, (r as any).to as number)
    return
  }
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
  // remove — whole row (key.length 1) or nested field deletion (deeper: the
  // v2 deep-delete record, W3a). Idempotent in every direction by clause 10.
  const key = v2RowKey(src, r.key[0])
  if (key === undefined) return // out-of-range positional remove — idempotent no-op
  src.remove(key, r.key.length > 1 ? r.key.slice(1) : undefined)
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

// ── the hot ingest lane (W7a): fero's frame-run shape, zero reshape ──────────
//
// ingest() sniffs the wire profile per record and routes v2 records through
// order resolution — correct for the general boundary, waste for a
// replication hot path whose frames are HOMOGENEOUS and pre-validated.
// lane(target, opts) pre-resolves everything resolvable (source, origin,
// profile) and returns a closure that applies one frame-run per call:
//
//   - records are fero's native Rec shape VERBATIM — numeric type tags
//     (HOT.update/insert/remove = fero kernel REC's 0/1/2), key as a PATH
//     ([rowKey, ...fieldPath]) — so a decoded frame is handed over with ZERO
//     per-record reshape and no profile detection;
//   - getter-backed lazy records work by construction: the lane reads
//     `type` (dispatch), `key` (routing), and `value`/`at` exactly once
//     each, and the value installs BY REFERENCE — a relayed record's value
//     bytes are never forced beyond state-install;
//   - one batch() commit per call (a frame-run is one consistent cut);
//   - the same clause-10 tolerances and per-record isolation as ingest():
//     add-vs-update resolves at the write chokepoint, removes are idempotent
//     everywhere, a poison record rejects alone.
//
// Object-born (keyed) sources only — fero's resources are keyed; array-born
// positional frames go through ingest()'s v2 profile.

export const HOT = { update: 0, insert: 1, remove: 2 } as const // ≡ fero kernel/env.ts REC

export interface HotRecord {
  readonly type: number // HOT.*
  readonly key: readonly (string | number)[] // PATH: [rowKey, ...fieldPath]
  readonly value?: unknown
  readonly at?: string | number // root-insert minted key (v2 BI0 / fero partitionOf)
}

export type HotLane = (records: readonly HotRecord[]) => IngestReport

const EMPTY_PATH: Path = Object.freeze([]) as unknown as Path

function applyHot(src: SourceNode<any>, r: HotRecord): void {
  const k = r.key
  if (r.type === HOT.update) {
    if (k.length === 0)
      throw new Error('data: lane() whole-source update (key []) — apply a keyed record or use ingest()')
    src.write(k[0], k.length === 1 ? EMPTY_PATH : (k.slice(1) as Path), r.value)
    return
  }
  if (r.type === HOT.remove) {
    if (k.length === 0) throw new Error('data: lane() remove with empty key')
    src.remove(k[0], k.length > 1 ? (k.slice(1) as Path) : undefined)
    return
  }
  if (r.type === HOT.insert) {
    // Root insert: the minted key rides `at` when key is [] (v2's BI0 shape,
    // fero's partitionOf contract) or key[0] directly. Upsert at the write
    // chokepoint (LWW redelivery tolerance). Deeper insert paths are not a
    // lane shape (nested arrays are opaque leaf VALUES — write the array).
    if (k.length > 1) throw new Error('data: lane() nested insert — write the containing array/object instead')
    const key = k.length === 1 ? k[0] : r.at
    if (key === undefined || key === null || key === '')
      throw new Error('data: lane() root insert without a key (key [] and no at)')
    src.write(key as RowKey, EMPTY_PATH, r.value)
    return
  }
  throw new Error(`data: lane() unknown record type ${r.type}`)
}

export function lane(target: IngestTarget, opts: IngestOpts = {}): HotLane {
  const src = resolveSource(target)
  if (src.ordered)
    throw new Error('data: lane() serves object-born (keyed) sources — positional frames go through ingest()')
  const origin = opts.origin
  const onReject = opts.onReject
  return (records: readonly HotRecord[]): IngestReport => {
    let applied = 0
    let rejects: IngestReject[] | null = null
    const run = () => {
      for (let i = 0; i < records.length; i++) {
        try {
          applyHot(src, records[i])
          applied++
        } catch (e) {
          ;(rejects ??= []).push({ index: i, record: records[i] as unknown as IngestRecord, error: e })
        }
      }
    }
    let flushError: unknown = NO_FLUSH_ERROR
    try {
      if (origin) src.runtime.withOrigin(origin, () => src.runtime.batch(run))
      else src.runtime.batch(run)
    } catch (e) {
      flushError = e
    }
    finishIngest('lane', records.length, rejects, onReject, flushError)
    return { applied, rejected: rejects?.length ?? 0 }
  }
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

// ── the wire egress (W1): CommitBatch → WireBatch, symmetric with ingest ─────
//
// The missing half of the native profile: ingest() consumed WireRecords from
// day one, but nothing EMITTED them — a replicator had to hand-write the
// CommitBatch translation against kernel internals. wireSink(node, out,
// opts) is that translation as a stability-guaranteed export: one WireBatch
// per commit, keyDomain-tagged (the envelope contract/index.ts promised),
// with `emit → wire → ingest` round-tripping by construction:
//
//   add        → {t:'add', k, v, at?}   (at = order position, array-born)
//   update     → {t:'update', k, v: row, prev, path}
//   deleted    → {t:'remove', k, path, prev: leaf}  (clause 10a — a field
//                deletion round-trips as a remove, never update-to-undefined)
//   remove     → {t:'remove', k, prev}
//   orderMove  → {t:'move', k, from, to}
//
// Record ORDER within a batch is the application script (diffOrder's law):
// whole-row removes, then survivor moves, then adds at ascending final
// indices, then field/row updates — a WireBatch replays sequentially, so a
// compound array-born batch (mid-insert + remove/move in one commit) only
// round-trips if positional records are emitted in application order, not
// first-touch rows order.
//
// Values ride BY REFERENCE (shared-immutable, like sink()); origin declares
// echo suppression; initial:false skips the opening snapshot batch (seq 0,
// one add per row in order).

export interface WireSinkOpts {
  readonly origin?: OriginToken | null
  readonly initial?: boolean
}

// The envelope's keyDomain reflects the node's EMITTED KEY IDENTITY ('int' =
// minted integer keys, 'string' = adopted keys — contract/index.ts), NOT
// orderedness: az(objectBorn) emits adopted string keys (→ 'string') and
// filter(arrayBorn) emits minted int keys (→ 'int'). Key identity flows down
// the primary-parent chain: bucket-kind views (group / lengthBuckets /
// distinct) RE-KEY to minted string bucket keys; every other view preserves
// its primary parent's keys down to the root source's mint mode.
function keyDomainOf(node: DataNode<any>): WireBatch['keyDomain'] {
  let n: DataNode<any> = node
  while (!(n instanceof SourceNode)) {
    if (registry.get(n.opName)?.kind === 'bucket') return 'string'
    const p = n.parents[0]
    if (p === undefined) return 'string' // detached — no row keys ride anyway
    n = p
  }
  return n.ordered ? 'int' : 'string'
}

export function wireSink(
  target: IngestTarget | { readonly [k: symbol]: unknown },
  out: (batch: WireBatch) => void,
  opts: WireSinkOpts = {},
): SubscriptionHandle {
  const node = resolveNode(target)
  const keyDomain = keyDomainOf(node)
  // attachSettled: a mid-batch wireSink defers the seq-0 snapshot emission +
  // connect to the batch's commit (clause 7 — the snapshot batch reflects the
  // settled state and the batch's own deltas are not re-emitted).
  return attachSettled(node.runtime, () => {
  if (opts.initial !== false) {
    const records: WireRecord[] = []
    const order = node.currentOrder()
    if (order !== null) {
      const snap = node.snapshot()
      for (let i = 0; i < order.length; i++) records.push({ t: 'add', k: order[i], v: snap.get(order[i]), at: i })
    } else {
      node.each((k, row) => records.push({ t: 'add', k, v: row }))
    }
    out({ keyDomain, seq: 0, records })
  }
  return node.connect({
    wantsOrder: true,
    origin: opts.origin ?? null,
    apply(batch: CommitBatch<any>) {
      // A WireBatch is a sequential program — applyWire replays records in
      // array order — so emission follows the delta contract's application
      // script (diffOrder's law): whole-row removes first (key-addressed),
      // then survivor moves in channel order, then adds at ASCENDING final
      // indices, then position-agnostic field/row updates. Emitting in
      // batch.rows (first-touch) order desynced replicas on compound
      // array-born batches: a mid-insert's final-index `at` was applied
      // BEFORE the removes/moves that precede it positionally.
      const records: WireRecord[] = []
      let addOf: Map<RowKey, AddDelta<any>> | null = null
      const updates: WireRecord[] = []
      for (const d of batch.rows) {
        if (d.op === 'add') {
          ;(addOf ??= new Map()).set(d.key, d)
        } else if (d.op === 'remove') {
          records.push({ t: 'remove', k: d.key, prev: d.prev })
        } else if (d.deleted === true && d.path.length > 0) {
          updates.push({ t: 'remove', k: d.key, path: d.path, prev: leafAt(d.prev, d.path) })
        } else if (d.path.length > 0) {
          // Field edit: v/prev are the LEAF at path — compact on the wire,
          // symmetric with applyWire's leaf-at-path apply.
          updates.push({ t: 'update', k: d.key, v: leafAt(d.row, d.path), prev: leafAt(d.prev, d.path), path: d.path })
        } else {
          updates.push({ t: 'update', k: d.key, v: d.row, prev: d.prev, path: d.path })
        }
      }
      if (batch.order) {
        for (const od of batch.order) {
          if (od.op === 'orderMove') records.push({ t: 'move', k: od.key, from: od.from!, to: od.index })
        }
        // orderInserts ride the channel at ascending final indices; emitting
        // adds in that sequence makes sequential re-insertion land each row
        // at its final position.
        for (const od of batch.order) {
          if (od.op === 'orderInsert') {
            const d = addOf?.get(od.key)
            if (d !== undefined) {
              records.push({ t: 'add', k: d.key, v: d.row, at: od.index })
              addOf!.delete(od.key)
            }
          }
        }
      }
      // Adds with no order position (object-born, or no channel this batch).
      if (addOf !== null) for (const d of addOf.values()) records.push({ t: 'add', k: d.key, v: d.row })
      for (const u of updates) records.push(u)
      if (records.length > 0) out({ keyDomain, seq: batch.seq, records })
    },
  })
  })
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

// ── mount: a SourceBacking behind a live source (W5) ─────────────────────────
//
// The boundary was a shape + one proof (InMemoryBacking) with NO way to put
// a $()-consumable source ON a backing. mount(runtime, backing) closes that:
// the returned source is a LIVE MIRROR of the backing — seeded from
// subscribe's init snapshot, kept current by translating every backing
// CommitBatch into local writes (one batch per upstream commit; nested
// paths, clause-10a deletes, and order moves all ride). Reads and operators
// hang off the mirror like any source.
//
// The write contract is deliberate: the BACKING is the authority — route
// writes through handle.apply(records, origin?) (→ backing.apply), and the
// mirror follows via subscribe. Writing the mirror source directly is local
// divergence (unsupported, like out-of-band container mutation). A stack
// that owns the full write path (fero: assignment → its kernel → ingest)
// wants DESIGN-DATA3 §4.1, not mount(); this is the boundary proof and the
// fero-L3 door (read(key) remote resolution stays parked there).

export interface MountHandle<T> {
  readonly source: SourceNode<T>
  apply(records: readonly IngestRecord[], origin?: OriginToken): void
  dispose(): void
}

export function mount<T>(runtime: Runtime, backing: SourceBacking<T>): MountHandle<T> {
  let src: SourceNode<T> | null = null
  const sub = backing.subscribe({
    wantsOrder: true,
    init(snapshot, order) {
      // Seed the mirror in ONE batch. Array-born backings mirror as an
      // object-keyed source carrying the SAME minted keys (positional
      // identity is the backing's concern; the mirror is keyed).
      src = new SourceNode<T>(runtime, {} as any, 'mounted')
      runtime.batch(() => {
        if (order) for (const k of order) src!.write(k, [], snapshot.get(k))
        else for (const [k, row] of snapshot) src!.write(k, [], row)
      })
    },
    apply(batch: CommitBatch<T>) {
      const s = src!
      runtime.batch(() => {
        for (const d of batch.rows) {
          if (d.op === 'add') s.write(d.key, [], d.row)
          else if (d.op === 'remove') s.remove(d.key)
          else if (d.deleted === true && d.path.length > 0) s.remove(d.key, d.path)
          else if (d.path.length > 0) s.write(d.key, d.path, leafAt(d.row, d.path))
          else s.write(d.key, [], d.row)
        }
      })
    },
  })
  if (src === null)
    throw new Error('data: mount() — the backing must deliver init(snapshot) synchronously at subscribe (clause 7)')
  return {
    source: src,
    apply: (records, origin) => backing.apply(records, origin),
    dispose: () => sub.dispose(),
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
