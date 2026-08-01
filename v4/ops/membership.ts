// v3/ops/membership.ts — dual-mode membership view (M6 Phase 4).
//
// Replaces the `view: Map<RowKey, T>` in BetweenNode and SetOpNode. Those
// nodes already delegate ROW reads to their parents (M6 P1 / 09adf4a), so
// the Map's only real payload was membership — a full-size Set (or Map) even
// when the view excludes almost nothing. This helper stores membership in
// whichever polarity is smaller:
//
//   include mode: `set` holds the MEMBERS       (small selections)
//   exclude mode: `set` holds the NON-members   (near-full selections;
//                 membership = host.hasRow(k) && !set.has(k))
//
// The reset/full-range state — every crossfilter chart before its first
// brush, and after every brush-clear — is an EMPTY exclude set: ~0 bytes
// per view regardless of source size.
//
// The owner resolves rows (parents[0].rowAt / union's exposed()); this class
// never stores or returns a row. `host` (the membership universe — the
// primary parent) is consulted only in exclude mode. Union pins include mode
// (its universe spans several parents, so a single-host complement is not
// well-defined) — pass `canExclude: false`.
//
// FLIP with hysteresis: at settle end the owner calls maybeFlip(); the view
// flips include→exclude when members > 60% of the host, and exclude→include
// when members < 40% — the 20-point band prevents thrash when membership
// oscillates around N/2. A flip rebuilds the complement in O(host) — the
// dedicated flip-boundary churn test drives membership across the band and
// asserts oracle equality every commit.
//
// EXCLUDE-mode maintenance contract: when the HOST loses a key, the owner
// must call hostRemoved(k) — a stale entry for a key the host no longer has
// would silently corrupt memberCount() (both modes tolerate the call for
// member keys: it is a no-op set.delete in include mode too).

import type { RowKey } from '../contract/delta.ts'
import type { DataNode } from '../kernel/node.ts'

export class MembershipView {
  declare host: DataNode<any>
  declare exclude: boolean
  declare set: Set<RowKey>
  declare canExclude: boolean

  constructor(host: DataNode<any>, canExclude = true) {
    this.host = host
    this.exclude = false
    this.set = new Set()
    this.canExclude = canExclude
  }

  // Public-query membership: exclude mode must confirm the key is in the
  // universe at all (an arbitrary foreign key is not a member just because
  // it isn't excluded).
  has(key: RowKey): boolean {
    if (this.exclude) return !this.set.has(key) && this.host.hasRow(key)
    return this.set.has(key)
  }

  // Pre-state membership during delta processing — polarity only, NO host
  // consult. Needed because a host REMOVE has already left the host by the
  // time the owner processes its delta (writes apply before settle), so
  // has() would deny the key ever was a member. Valid for any key that was
  // in the universe at the pre-state (delta keys always were); between's
  // walk keys are host-live by the resort discipline, so it uses this
  // everywhere and skips the host hop.
  hasSansHost(key: RowKey): boolean {
    return this.exclude ? !this.set.has(key) : this.set.has(key)
  }

  // A key became a member (it IS live in the host).
  add(key: RowKey): void {
    if (this.exclude) this.set.delete(key)
    else this.set.add(key)
  }

  // A key left the membership but is STILL live in the host (an eviction —
  // e.g. a bounds narrow, a facet exclusion).
  removeMember(key: RowKey): void {
    if (this.exclude) this.set.add(key)
    else this.set.delete(key)
  }

  // The HOST lost this key (universe shrank). Same op in both modes: a
  // member key was never in an exclude set, an excluded key must be purged;
  // in include mode this drops the member entry if present.
  hostRemoved(key: RowKey): void {
    this.set.delete(key)
  }

  // The HOST gained this key and it is NOT a member (universe grew past the
  // membership). In exclude mode the new key must be recorded, or "not in
  // the exclude set" would silently admit it; include mode is a no-op.
  hostAddedExcluded(key: RowKey): void {
    if (this.exclude) this.set.add(key)
  }

  memberCount(): number {
    if (this.exclude) return this.host.rowCount() - this.set.size
    return this.set.size
  }

  // Map-compatible alias (tests and owners historically read view.size).
  get size(): number {
    return this.memberCount()
  }

  // Visit every member KEY (rows are the owner's business). Exclude mode
  // walks the host; include mode walks the set. Do not mutate inside fn.
  eachKey(fn: (key: RowKey) => void): void {
    if (this.exclude) {
      const set = this.set
      this.host.each((k) => {
        if (!set.has(k)) fn(k)
      })
      return
    }
    for (const k of this.set) fn(k)
  }

  // Re-polarize if the current set is on the wrong side of the hysteresis
  // band. O(host) when it fires; call once per settle, never per key.
  maybeFlip(): void {
    if (!this.canExclude) return
    const universe = this.host.rowCount()
    if (universe < 32) return // not worth the bookkeeping below this size
    const members = this.memberCount()
    if (!this.exclude && members > universe * 0.6) {
      const inv = new Set<RowKey>()
      const cur = this.set
      this.host.each((k) => {
        if (!cur.has(k)) inv.add(k)
      })
      this.set = inv
      this.exclude = true
    } else if (this.exclude && members < universe * 0.4) {
      const inv = new Set<RowKey>()
      const cur = this.set
      this.host.each((k) => {
        if (!cur.has(k)) inv.add(k)
      })
      this.set = inv
      this.exclude = false
    }
  }
}
