// ops/bucket.ts — the bucketing family: ONE BucketNode behind two verbs.
//
//   group(fn)         → { prune: true,  counts: false } — bucket value is the
//                       dense member object { [rowKey]: row }; empty buckets
//                       are REMOVED (enter/leave semantics).
//   lengthBuckets(fn) → { prune: false, counts: true } — v2's length(fn)
//                       histogram; bucket value is the { value: N } wrapper
//                       (the documented v2 trap, kept deliberately for wire
//                       compat), and an emptied bucket PERSISTS as
//                       { value: 0 } (v2's fixed-keyspace histogram contract:
//                       a known category keeps its stable zero-height bar).
//
// v2 algorithmic IP carried over (operators/group/index.ts,
// operators/length/index.ts), minus the verb machinery that no longer exists:
// - the per-row bucket membership map (v2 GroupValue.posMap / LengthFnValue
//   .mapping) → `bucketOf: Map<RowKey, string>`, so a cross-bucket move is
//   O(1) decrement-old / increment-new without re-iterating the source;
// - rebucket-on-update as decrement/remove-old + increment/add-new, and the
//   "collapse per-row leavers into one bucket-level remove when the bucket
//   empties" post-process (v2's `leaving` map) — here it falls out of the
//   touched-bucket reconcile;
// - counts mode republishes NOTHING when a row's bucket key didn't move
//   (v2 LengthFnValue's `changed`/`moved` guards — per-counter subscription
//   stays quiet on non-key edits);
// - group mode forwards a non-key member edit as a bucket update so bucket
//   consumers refresh (v2 GroupValue.BU2's same-group branch).
//
// What DISSOLVES in v3: the whole BU1/BU1A/BU2 × object/array matrix, the
// posMap idx/suffix-shift splice bookkeeping, the sparse-hole fn(undefined)
// guards, and the array-source O(N) rebuild fallbacks. Keys are stable
// (minted for array-born rows), membership changes are honest add/remove,
// and an update is ONE branch: oldKey (as our view knew it) vs
// newKey = String(fn(row)). There are no positional holes in the value
// domain — `undefined`/`null` rows are first-class values and get bucketed
// like any other (fn sees them; classify them in your fn if they occur).
//
// Emission discipline (SCHEDULE.md clause 8):
// - bucket-level deltas only, consolidated: a 100-row batch touching one
//   bucket emits ONE bucket delta (the `touched` map keys the reconcile);
// - `prev` is the exact object our view previously emitted — bucket value
//   objects are built FRESH on every change and never mutated afterwards;
// - no phantom updates: a batch whose net effect leaves a bucket's content
//   unchanged (e.g. two rows swapping buckets keeps both counts equal)
//   emits nothing for that bucket.

import type { CommitBatch, OriginToken, RowDelta, RowKey } from '../contract/delta.ts'
import { DataNode } from '../kernel/node.ts'
import type { Runtime } from '../kernel/runtime.ts'
import { defineOperator } from './registry.ts'

export interface BucketOptions {
  readonly prune: boolean // remove a bucket when its last member leaves
  readonly counts: boolean // bucket value is { value: N } instead of member rows
}

// Canonical bucket-key order = JS OWN-PROPERTY ENUMERATION order: array-index
// keys ascending numerically first, then the rest sorted lexicographically.
// Filling a plain object in this exact order matters twice over:
// (1) observable — Object.keys(bucket) equals the fill order, and JS reorders
//     integer-like keys numerically REGARDLESS of insertion order, so a
//     lexicographic fill produced the very same enumeration anyway (the
//     emitted objects are byte-identical to the old sort()-based build);
// (2) performance — numeric-like string keys inserted OUT of numeric order
//     push V8 into dictionary-mode elements, which made both the per-touch
//     object fill and Object.keys() the group/insert hotspot. Ascending fill
//     stays on the fast-elements path.
const IDX_RE = /^(0|[1-9][0-9]*)$/
const isIndexKey = (s: string) => IDX_RE.test(s) && Number(s) <= 4294967294 // 2^32 - 2

function cmpKeys(a: string, b: string): number {
  const ia = isIndexKey(a)
  const ib = isIndexKey(b)
  if (ia && ib) return Number(a) - Number(b)
  if (ia) return -1
  if (ib) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

function binaryInsert(arr: string[], s: string): void {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (cmpKeys(arr[mid], s) < 0) lo = mid + 1
    else hi = mid
  }
  arr.splice(lo, 0, s)
}

function binaryRemove(arr: string[], s: string): void {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (cmpKeys(arr[mid], s) < 0) lo = mid + 1
    else hi = mid
  }
  if (arr[lo] === s) arr.splice(lo, 1)
}

export type GroupBucket<T> = Record<string, T>
export interface CountBucket {
  readonly value: number
}

export class BucketNode<T, B> extends DataNode<B> {
  declare fn: (row: T, key: RowKey) => unknown
  declare prune: boolean
  declare counts: boolean
  // Per-bucket membership (kernel-keyed via Map — RowKey 1 and '1' never
  // collide). Never emitted; the emitted bucket objects are built from it.
  // GROUP mode only — counts mode (M6 P5) keeps no rows at all: bucketOf +
  // a per-bucket int count are the whole state.
  declare members: Map<string, Map<RowKey, T>> | null
  declare count: Map<string, number> | null // counts mode only
  // Which bucket each parent row currently belongs to — the v2 posMap/mapping
  // insight: cross-bucket moves are O(1), no source re-iteration.
  declare bucketOf: Map<RowKey, string>
  // Materialized output: bucket key → the exact object we last emitted.
  declare view: Map<RowKey, B>
  // group mode only (null in counts mode): per-bucket MAINTAINED sorted
  // String(rowKey) list + sk→row map, so rebuilding a touched bucket is one
  // O(B) object fill instead of a String() pass + sort + temp Map per touch
  // (the corpus group/insert hotspot, STATUS gap 8). emittedSize is the
  // sorted length at the last view write — an O(1) changed-detector (a size
  // change IS a content change, so the O(B) sameBucket compare only runs on
  // same-size batches, e.g. two rows swapping buckets). Assumes sk uniqueness
  // per bucket — a parent emitting BOTH 5 and '5' as live keys collapsed in
  // the emitted object before this too (String key space).
  declare skOf: Map<string, { sorted: string[]; bySk: Map<string, T>; emittedSize: number }> | null

  constructor(
    runtime: Runtime,
    parent: DataNode<T>,
    fn: (row: T, key: RowKey) => unknown,
    opts: BucketOptions,
    name: string,
  ) {
    super(runtime, 'operator', name, [parent])
    this.fn = fn
    this.prune = opts.prune
    this.counts = opts.counts
    this.members = opts.counts ? null : new Map()
    this.count = opts.counts ? new Map() : null
    this.bucketOf = new Map()
    this.view = new Map()
    this.skOf = opts.counts ? null : new Map()
    // Bulk load: enter() skips per-row binary insertion, then each bucket's
    // sorted list is built with ONE sort (same O(B log B) the old build paid).
    parent.each((k, row) => this.enter(k, row, true))
    if (this.skOf)
      for (const sk of this.skOf.values()) {
        sk.sorted = [...sk.bySk.keys()].sort(cmpKeys)
        sk.emittedSize = sk.sorted.length
      }
    for (const bk of this.count !== null ? this.count.keys() : this.members!.keys())
      this.view.set(bk, this.build(bk))
  }

  // ── membership bookkeeping ──────────────────────────────────────────────────

  private enter(key: RowKey, row: T, bulk = false): string {
    const bk = String(this.fn(row, key))
    if (this.count !== null) {
      // counts mode: an int per bucket — no rows retained
      this.count.set(bk, (this.count.get(bk) ?? 0) + 1)
      this.bucketOf.set(key, bk)
      return bk
    }
    let mem = this.members!.get(bk)
    if (mem === undefined) {
      mem = new Map()
      this.members!.set(bk, mem)
      if (this.skOf) this.skOf.set(bk, { sorted: [], bySk: new Map(), emittedSize: 0 })
    }
    mem.set(key, row)
    this.bucketOf.set(key, bk)
    if (this.skOf) {
      const sk = this.skOf.get(bk)!
      const s = String(key)
      if (!bulk && !sk.bySk.has(s)) binaryInsert(sk.sorted, s)
      sk.bySk.set(s, row)
    }
    return bk
  }

  private leave(key: RowKey): string {
    const bk = this.bucketOf.get(key) as string
    if (this.count !== null) {
      this.count.set(bk, (this.count.get(bk) as number) - 1)
      this.bucketOf.delete(key)
      return bk
    }
    this.members!.get(bk)!.delete(key)
    this.bucketOf.delete(key)
    if (this.skOf) {
      const sk = this.skOf.get(bk)!
      const s = String(key)
      sk.bySk.delete(s)
      binaryRemove(sk.sorted, s)
    }
    return bk
  }

  // Fresh bucket value — NEVER mutate a previously emitted object (prev must
  // remain the pre-change object for every downstream consumer). Group bucket
  // properties are emitted in CANONICAL order (own-property enumeration
  // order — see cmpKeys): deterministic and history-independent (v2's bucket
  // order depended on arrival history; a canonical order makes replay/oracle
  // comparison exact byte-for-byte).
  // Settle-path build: reads the bucket's MAINTAINED sorted list (skOf) —
  // one O(B) object fill, no String() pass, no sort, no temp Map.
  private build(bk: string): B {
    if (this.counts) return { value: this.count!.get(bk) ?? 0 } as unknown as B
    const sk = this.skOf!.get(bk)!
    const o: Record<string, T> = {}
    for (const s of sk.sorted) o[s] = sk.bySk.get(s) as T
    return o as unknown as B
  }

  // Pure build from an ARBITRARY membership map — the midBatch flush-on-read
  // path recomputes membership locally from the parent (skOf reflects settled
  // state, not mid-batch state), so it pays the String+sort here.
  private buildFresh(mem: Map<RowKey, T>): B {
    if (this.counts) return { value: mem.size } as unknown as B
    const keys: string[] = []
    const byKey = new Map<string, T>()
    for (const [k, v] of mem) {
      const sk = String(k)
      keys.push(sk)
      byKey.set(sk, v)
    }
    keys.sort(cmpKeys)
    const o: Record<string, T> = {}
    for (const sk of keys) o[sk] = byKey.get(sk) as T
    return o as unknown as B
  }

  private sameBucket(a: B, b: B): boolean {
    if (this.counts) return (a as unknown as CountBucket).value === (b as unknown as CountBucket).value
    const ao = a as unknown as Record<string, T>
    const bo = b as unknown as Record<string, T>
    const ka = Object.keys(ao)
    if (ka.length !== Object.keys(bo).length) return false
    for (const k of ka) {
      if (!Object.prototype.hasOwnProperty.call(bo, k) || !Object.is(ao[k], bo[k])) return false
    }
    return true
  }

  // ── reads ───────────────────────────────────────────────────────────────────

  snapshot(): Map<RowKey, B> {
    if (this.runtime.midBatch) {
      // Flush-on-read: recompute PURE from the parent (SCHEDULE clause 2b).
      const members = new Map<string, Map<RowKey, T>>()
      for (const [k, row] of this.parents[0].snapshot() as Map<RowKey, T>) {
        const bk = String(this.fn(row, k))
        let mem = members.get(bk)
        if (mem === undefined) {
          mem = new Map()
          members.set(bk, mem)
        }
        mem.set(k, row)
      }
      const out = new Map<RowKey, B>()
      for (const [bk, mem] of members) out.set(bk, this.buildFresh(mem))
      if (!this.prune) {
        // Persisted zero buckets are HISTORY, not derivable from the parent:
        // every bucket live before this batch stays live at { value: 0 }.
        // (Known corner: a bucket created AND emptied by writes inside the
        // still-open batch is invisible to this pure read; settle will emit
        // its add { value: 0 } when the batch closes.)
        for (const bk of this.view.keys()) if (!out.has(bk)) out.set(bk, this.buildFresh(new Map()))
      }
      return out
    }
    return new Map(this.view)
  }

  hasRow(key: RowKey): boolean {
    if (this.runtime.midBatch) return super.hasRow(key)
    return this.view.has(key)
  }

  rowAt(key: RowKey): B | undefined {
    if (this.runtime.midBatch) return super.rowAt(key)
    return this.view.get(key)
  }

  each(fn: (key: RowKey, row: B) => void): void {
    if (this.runtime.midBatch) return super.each(fn)
    for (const [k, v] of this.view) fn(k, v)
  }

  rowCount(): number {
    if (this.runtime.midBatch) return super.rowCount()
    return this.view.size
  }

  // ── settle ──────────────────────────────────────────────────────────────────

  settle(seq: number, origin: OriginToken): CommitBatch<B> | null {
    const input = this.in0
    if (input === null) return null
    // Pre-batch bucket value at FIRST touch (undefined = not live in our view
    // before this batch). view is only written in the reconcile below, so a
    // first-touch read is always the pre-batch object — `prev` exactly as our
    // view knew it, and consolidation (≤1 delta per bucket key) for free.
    const touched = new Map<string, B | undefined>()
    for (const d of input.rows as readonly RowDelta<T>[]) {
      switch (d.op) {
        case 'add': {
          const bk = this.enter(d.key, d.row)
          if (!touched.has(bk)) touched.set(bk, this.view.get(bk))
          break
        }
        case 'remove': {
          const bk = this.leave(d.key)
          if (!touched.has(bk)) touched.set(bk, this.view.get(bk))
          break
        }
        case 'update': {
          // THE rebucket branch — the whole v2 BU1/BU1A/BU2 saga, dissolved.
          // oldKey comes from our own membership map (what our view knew),
          // newKey from the post-write row.
          const oldBk = this.bucketOf.get(d.key) as string
          const newBk = String(this.fn(d.row, d.key))
          if (oldBk === newBk) {
            if (this.members !== null) this.members.get(oldBk)!.set(d.key, d.row)
            if (this.skOf) this.skOf.get(oldBk)!.bySk.set(String(d.key), d.row)
            // counts: same bucket ⇒ count unchanged ⇒ inert (v2's per-counter
            // quiet on non-key edits). group: bucket content changed ⇒ touch.
            if (!this.counts && !touched.has(oldBk)) touched.set(oldBk, this.view.get(oldBk))
          } else {
            const from = this.leave(d.key)
            const to = this.enter(d.key, d.row)
            if (!touched.has(from)) touched.set(from, this.view.get(from))
            if (!touched.has(to)) touched.set(to, this.view.get(to))
          }
          break
        }
      }
    }
    if (touched.size === 0) return null

    const out: RowDelta<B>[] = []
    for (const [bk, prev] of touched) {
      const emptied =
        this.count !== null ? (this.count.get(bk) ?? 0) === 0 : (this.members!.get(bk) as Map<RowKey, T>).size === 0
      if (this.prune && emptied) {
        this.members!.delete(bk) // counts buckets never prune (prune=false)
        if (this.skOf) this.skOf.delete(bk)
      }
      const liveNow = this.prune ? !emptied : true // counts buckets persist once created
      const wasLive = prev !== undefined
      if (!liveNow) {
        // wasLive && !liveNow → remove; !wasLive && !liveNow → created and
        // emptied within one batch: annihilate (nothing emitted).
        if (wasLive) {
          this.view.delete(bk)
          out.push({ op: 'remove', key: bk, prev: prev as B })
        }
        continue
      }
      const next = this.build(bk)
      const sk = this.skOf === null ? undefined : this.skOf.get(bk)
      if (!wasLive) {
        this.view.set(bk, next)
        if (sk !== undefined) sk.emittedSize = sk.sorted.length
        out.push({ op: 'add', key: bk, row: next })
      } else if (
        // group mode O(1) short-circuit first: a membership-size change IS a
        // content change — the O(B) sameBucket compare only runs same-size
        (sk !== undefined && sk.emittedSize !== sk.sorted.length) ||
        !this.sameBucket(prev as B, next)
      ) {
        this.view.set(bk, next)
        if (sk !== undefined) sk.emittedSize = sk.sorted.length
        out.push({ op: 'update', key: bk, row: next, prev: prev as B, path: [] })
      }
      // else: net no-op for this bucket (e.g. two rows swapped buckets) —
      // emitting would be a phantom update; keep the old object in view.
    }
    return out.length ? { seq, origin, rows: out, order: undefined, scalar: undefined } : null
  }
}

// ── factories + registry entries ─────────────────────────────────────────────

export function group<T>(src: DataNode<T>, fn: (row: T, key: RowKey) => unknown): BucketNode<T, GroupBucket<T>> {
  return new BucketNode<T, GroupBucket<T>>(src.runtime, src, fn, { prune: true, counts: false }, 'group')
}

export function lengthBuckets<T>(src: DataNode<T>, fn: (row: T, key: RowKey) => unknown): BucketNode<T, CountBucket> {
  return new BucketNode<T, CountBucket>(src.runtime, src, fn, { prune: false, counts: true }, 'lengthBuckets')
}

defineOperator({
  name: 'group', kind: 'bucket', category: 'aggregate-decomposable', declarative: false,
  create: (src, fn) => group(src, fn),
  // fn-arg rule: an opaque closure has no value identity, so bucket ops never
  // dedup (v2: group/length(fn) create a fresh operator per call; only
  // value-identity args — columns, thresholds, bounds — participate in dedup).
  dedupKey: () => null,
})
defineOperator({
  name: 'lengthBuckets', kind: 'bucket', category: 'aggregate-decomposable', declarative: false,
  create: (src, fn) => lengthBuckets(src, fn),
  dedupKey: () => null, // fn args — see the note on `group` above
})
