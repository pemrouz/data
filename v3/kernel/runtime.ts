// v3/kernel/runtime.ts — the commit machinery. SCHEDULE.md made executable.
//
// Two-phase batch commit; a bare write is a synchronous batch of one. All
// cascade state lives on this instance (no module globals) — multiple
// independent graphs per page, per-test isolated runtimes, worker-hosted
// graphs by construction.

import type { CommitBatch, OriginToken } from '../contract/delta.ts'
import type { DataNode, EffectEntry, SourceNode } from './node.ts'

export interface CommitInfo {
  readonly seq: number
  readonly origin: OriginToken
  readonly nodes: readonly { id: number; deltas: number; ms: number }[]
}

export interface GraphNodeInfo {
  readonly id: number
  readonly kind: 'source' | 'operator' | 'scalar'
  readonly op: string
  readonly parents: readonly number[]
  readonly height: number
}

const REENTRANCY_CAP = 1000

const byHeight = (a: DataNode<any>, b: DataNode<any>) => a.height - b.height

export class Runtime {
  seq = 0
  private batchDepth = 0
  private flushing = false
  private draining = false // executing ONE queued re-entrant write (apply directly)
  private dirty: SourceNode<any>[] = [] // array + per-source inDirty flag: no Set hashing/iterator on the hot path
  private queue: { origin: OriginToken | null; w: () => void }[] = [] // re-entrant writes → next commit(s), FIFO (origin captured at issue time)
  private currentOrigin: OriginToken | null = null
  private defaultOrigin: OriginToken = Symbol('user')
  private hooks = new Set<(c: CommitInfo) => void>()
  private registry = new Set<WeakRef<DataNode<any>>>()

  // True during the apply phase of an open batch() — derived reads must
  // recompute pure (flush-on-read) rather than trust materialized state.
  get midBatch(): boolean {
    return this.batchDepth > 0
  }

  // The seq to stamp on a subscription born NOW (DataNode.connect). During a
  // commit's effect phase the subscriber's init snapshot ALREADY contains
  // that commit (clause 4), so its entry must skip batch.seq === bornSeq —
  // without this, a sink connected from inside an effect (a row built during
  // an add whose template nests a list over another view that also changed
  // this commit) double-applied the current batch. During a drain (a queued
  // re-entrant write between commits) the snapshot predates the NEXT commit,
  // so 0 (never matches — seq starts at 1) is correct.
  connectSeq(): number {
    return this.flushing && !this.draining ? this.seq : 0
  }

  register(node: DataNode<any>): void {
    this.registry.add(new WeakRef(node))
  }

  graph(): GraphNodeInfo[] {
    const out: GraphNodeInfo[] = []
    for (const ref of this.registry) {
      const n = ref.deref()
      if (n === undefined || n.disposed) {
        this.registry.delete(ref)
        continue
      }
      out.push({
        id: n.id, kind: n.kind, op: n.opName,
        parents: n.parents.map((p) => p.id), height: n.height,
      })
    }
    return out
  }

  onCommit(hook: (c: CommitInfo) => void): { dispose(): void } {
    this.hooks.add(hook)
    return { dispose: () => this.hooks.delete(hook) }
  }

  // ── the write protocol (hot path, zero closure allocation) ────────────────
  // A source checks canWriteNow(); if true it applies its mutation inline and
  // calls written(). If false (a write inside an effect), it queues a thunk —
  // the closure allocation is confined to the rare re-entrant path (clause 5).
  canWriteNow(): boolean {
    return !this.flushing || this.draining
  }

  queueWrite(w: () => void): void {
    this.queue.push({ origin: this.currentOrigin, w })
  }

  written(source: SourceNode<any>): void {
    if (!source.inDirty) {
      source.inDirty = true
      this.dirty.push(source)
    }
    if (this.batchDepth === 0 && !this.flushing) this.flush()
  }

  batch<R>(fn: () => R, origin?: OriginToken): R {
    if (this.flushing && !this.draining) {
      // batch() inside an effect: defer the whole batch as the next commit.
      // queue-shape regression (found by the types gate): this pushed a bare
      // closure into the {origin, w} queue — the drain's q.w() then crashed.
      this.queue.push({ origin: this.currentOrigin, w: () => this.batch(fn, origin) })
      return undefined as R
    }
    this.batchDepth++
    const prevOrigin = this.currentOrigin
    if (origin) this.currentOrigin = origin
    try {
      return fn()
    } finally {
      this.batchDepth--
      // Flush BEFORE restoring the origin — restoring first meant batch-level
      // origin tokens never stamped the commit (echo suppression silently
      // dead; found by the seam agent's round-trip test).
      try {
        if (this.batchDepth === 0 && this.dirty.length > 0 && !this.flushing) this.flush()
      } finally {
        this.currentOrigin = prevOrigin
      }
    }
  }

  withOrigin<R>(origin: OriginToken, fn: () => R): R {
    const prev = this.currentOrigin
    this.currentOrigin = origin
    try {
      return fn()
    } finally {
      this.currentOrigin = prev
    }
  }

  private flush(): void {
    this.flushing = true
    const errors: unknown[] = []
    try {
      let rounds = 0
      while (this.dirty.length > 0 || this.queue.length > 0) {
        if (++rounds > REENTRANCY_CAP)
          throw new Error(`data: re-entrant write cascade exceeded ${REENTRANCY_CAP} commits — cycle?`)
        if (this.dirty.length === 0) {
          // Drain ONE queued re-entrant write per commit, FIFO (v2's transact
          // discipline: each queued write runs its own cascade).
          const q = this.queue.shift()!
          this.draining = true
          const prevO = this.currentOrigin
          this.currentOrigin = q.origin
          try {
            q.w()
          } finally {
            this.currentOrigin = prevO
            this.draining = false
          }
          continue
        }
        this.commitOnce(errors)
      }
    } finally {
      this.flushing = false
    }
    if (errors.length > 0)
      throw new AggregateError(errors, `data: ${errors.length} effect(s) failed during commit`)
  }

  // Reused per-commit scratch (cleared after each commit; commits never nest).
  private _emitN: DataNode<any>[] = []
  private _emitB: CommitBatch<any>[] = []
  private _agenda: DataNode<any>[] = []
  private _fx: EffectEntry<any>[] = []

  private commitOnce(errors: unknown[]): void {
    const seq = ++this.seq
    const origin = this.currentOrigin ?? this.defaultOrigin

    const measure = this.hooks.size > 0
    const stats: { id: number; deltas: number; ms: number }[] | null = measure ? [] : null
    // Parallel arrays of (node, batch) in settle order — the effect phase.
    const emitN = this._emitN
    const emitB = this._emitB
    const agenda = this._agenda

    // Settle sources first (height 0), seeding the agenda with children.
    // (settledSeq doubles as the enqueued-marker: enqueue sets it to -seq.)
    const dirty = this.dirty
    for (let di = 0; di < dirty.length; di++) {
      const s = dirty[di]
      s.inDirty = false
      const t0 = measure ? performance.now() : 0
      const batch = s.settle(seq, origin)
      if (batch === null) continue
      if (stats) stats.push({ id: s.id, deltas: countDeltas(batch), ms: performance.now() - t0 })
      emitN.push(s)
      emitB.push(batch)
      const kids = s.children
      for (let ki = 0; ki < kids.length; ki++) {
        const c = kids[ki]
        c.ingest(s, batch)
        if (c.settledSeq !== seq && c.settledSeq !== -seq) {
          c.settledSeq = -seq
          agenda.push(c)
        }
      }
    }
    dirty.length = 0

    // Propagate in topological order by height (stable for equal heights).
    agenda.sort(byHeight)
    for (let i = 0; i < agenda.length; i++) {
      const n = agenda[i]
      if (n.settledSeq === seq) continue
      n.settledSeq = seq
      const t0 = measure ? performance.now() : 0
      const out = n.settle(seq, origin)
      n.clearInputs()
      if (out === null) continue
      if (stats) stats.push({ id: n.id, deltas: countDeltas(out), ms: performance.now() - t0 })
      emitN.push(n)
      emitB.push(out)
      const kids = n.children
      for (let ki = 0; ki < kids.length; ki++) {
        const c = kids[ki]
        c.ingest(n, out)
        if (c.settledSeq !== seq && c.settledSeq !== -seq) {
          c.settledSeq = -seq
          // Insert maintaining height order beyond the current cursor.
          let j = agenda.length
          while (j > i + 1 && agenda[j - 1].height > c.height) j--
          agenda.splice(j, 0, c)
        }
      }
    }

    // Effect phase: after ALL operator state is settled (clause 4), in
    // topological order, exception-isolated. Each node's effects run off a
    // SNAPSHOT (reused scratch): an effect that disposes a sibling
    // subscription splices the live array, and pre-snapshot that shifted the
    // cursor so the next sink silently skipped the commit. Tombstoned
    // (dead) entries are skipped; entries born THIS commit (bornSeq === seq)
    // are skipped too — their init snapshot already contains it.
    const fx = this._fx
    for (let i = 0; i < emitN.length; i++) {
      const effects = emitN[i].effects
      if (effects.length === 0) continue
      const batch = emitB[i]
      fx.length = 0
      for (let ei = 0; ei < effects.length; ei++) fx.push(effects[ei])
      for (let ei = 0; ei < fx.length; ei++) {
        const entry = fx[ei]
        if (entry.dead === true || entry.bornSeq === seq) continue
        if (entry.origin !== null && entry.origin === batch.origin) continue // echo suppression
        try {
          entry.apply(batch)
        } catch (e) {
          errors.push(e)
        }
      }
    }
    fx.length = 0
    emitN.length = 0
    emitB.length = 0
    agenda.length = 0

    if (stats) {
      const info: CommitInfo = { seq, origin, nodes: stats }
      for (const h of this.hooks) {
        try {
          h(info)
        } catch (e) {
          errors.push(e)
        }
      }
    }
  }
}

function countDeltas(b: CommitBatch<any>): number {
  return b.rows.length + (b.order?.length ?? 0) + (b.scalar ? 1 : 0)
}
