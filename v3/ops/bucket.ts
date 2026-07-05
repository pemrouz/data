// v3/ops/bucket.ts — the bucketing family: ONE BucketNode behind two verbs.
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
  declare members: Map<string, Map<RowKey, T>>
  // Which bucket each parent row currently belongs to — the v2 posMap/mapping
  // insight: cross-bucket moves are O(1), no source re-iteration.
  declare bucketOf: Map<RowKey, string>
  // Materialized output: bucket key → the exact object we last emitted.
  declare view: Map<RowKey, B>

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
    this.members = new Map()
    this.bucketOf = new Map()
    this.view = new Map()
    for (const [k, row] of parent.snapshot()) this.enter(k, row)
    for (const [bk, mem] of this.members) this.view.set(bk, this.build(mem))
  }

  // ── membership bookkeeping ──────────────────────────────────────────────────

  private enter(key: RowKey, row: T): string {
    const bk = String(this.fn(row, key))
    let mem = this.members.get(bk)
    if (mem === undefined) {
      mem = new Map()
      this.members.set(bk, mem)
    }
    mem.set(key, row)
    this.bucketOf.set(key, bk)
    return bk
  }

  private leave(key: RowKey): string {
    const bk = this.bucketOf.get(key) as string
    this.members.get(bk)!.delete(key)
    this.bucketOf.delete(key)
    return bk
  }

  // Fresh bucket value — NEVER mutate a previously emitted object (prev must
  // remain the pre-change object for every downstream consumer). Group bucket
  // properties are emitted in SORTED key order: deterministic and
  // history-independent (v2's bucket order depended on arrival history; a
  // canonical order makes replay/oracle comparison exact byte-for-byte).
  private build(mem: Map<RowKey, T>): B {
    if (this.counts) return { value: mem.size } as unknown as B
    const keys: string[] = []
    const byKey = new Map<string, T>()
    for (const [k, v] of mem) {
      const sk = String(k)
      keys.push(sk)
      byKey.set(sk, v)
    }
    keys.sort()
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
      for (const [bk, mem] of members) out.set(bk, this.build(mem))
      if (!this.prune) {
        // Persisted zero buckets are HISTORY, not derivable from the parent:
        // every bucket live before this batch stays live at { value: 0 }.
        // (Known corner: a bucket created AND emptied by writes inside the
        // still-open batch is invisible to this pure read; settle will emit
        // its add { value: 0 } when the batch closes.)
        for (const bk of this.view.keys()) if (!out.has(bk)) out.set(bk, this.build(new Map()))
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
            this.members.get(oldBk)!.set(d.key, d.row)
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
      const mem = this.members.get(bk) as Map<RowKey, T>
      const emptied = mem.size === 0
      if (this.prune && emptied) this.members.delete(bk)
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
      const next = this.build(mem)
      if (!wasLive) {
        this.view.set(bk, next)
        out.push({ op: 'add', key: bk, row: next })
      } else if (!this.sameBucket(prev as B, next)) {
        this.view.set(bk, next)
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
