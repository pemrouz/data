// @ts-nocheck
import { isArray, iter, isEmpty } from '../../utils.ts'
import { Operator, createOperator } from '../../core.ts'

// GroupValue maintains, for each upstream key (object name or array position),
// a record of which group its row belongs to and where in that group's bucket
// it sits. The bucket shape mirrors the source shape: object source → object
// buckets keyed by source name; array source → array buckets in upstream order.
//
// For array sources, upstream-position events (BR1A/BI0A) carry implicit shift
// semantics: removing position p shifts every later position down by one. We
// translate those shifts into per-group bucket splices and emit array-aware
// BR2/BI2 against the per-group views, so downstream array-aware sinks (V1
// propagation in the View, the array branch of DOMSink) handle them
// efficiently without DOM teardown.

export class GroupValue extends Operator {
  constructor(p, fn) {
    super()
    this.p = p
    this.fn = fn
    this.XU0(this.p.value)
  }

  XR0() {
    this.posMap = new Map()
    this.view.XU0(this.view.value = {})
  }

  XU0(value) {
    this.isArr = isArray(value)
    this.posMap = new Map()
    const new_value = {}
    if (this.isArr) {
      // array source: posMap stores { group, idx } so we can splice the
      // per-group bucket array on incremental BR1A/BI0A events
      for (let i = 0; i < value.length; i++) {
        const v = value[i]
        // Skip explicit-undefined / hole slots (a sparse array from
        // between/intersect/union/except, or a RowOperator gone sparse) — calling
        // fn(undefined) would crash. Mirrors sort's XU0 guard.
        if (v === undefined) continue
        const g = this.fn(v)
        const bucket = (new_value[g] ??= [])
        this.posMap.set(i, { group: g, idx: bucket.length })
        bucket.push(v)
      }
    } else {
      // object source: posMap stores the group name directly; the inner
      // bucket is keyed by source name so no idx tracking is needed
      iter(value, (i, v) => {
        // Skip explicit-undefined slots: a sparse OBJECT source (between/
        // intersect/union/except leave excluded keys present with value
        // undefined) would otherwise hand fn(undefined) and crash at
        // construction. Mirrors the array branch's guard above.
        if (v === undefined) return
        const g = this.fn(v)
        ;(new_value[g] ??= {})[i] = v
        this.posMap.set(i, g)
      })
    }
    this.view.XU0(this.view.value = new_value)
  }

  // ─── Object-source paths ──────────────────────────────────────────────────

  // For each removed name we drop the row from its bucket and stash the old
  // value in `leaving` so we can choose later whether to emit BR1 (bucket
  // emptied — group disappears) or BR2 (bucket non-empty — only this row left).
  // Routed to BR1A when the source is an array because position-shift
  // semantics differ.
  BR1(R1) {
    if (this.isArr) return this.BR1A(R1)
    const leaving = new Map()
    for (let i = 0; i < R1.length; i++) {
      const name = R1[i++]
      // Use `has`, not `get(...) === undefined`: a row whose group key IS
      // undefined (fn returns undefined for unclassified rows → the "undefined"
      // bucket) is legitimately tracked. A genuinely untracked name is a no-op:
      // a sparse producer upstream (between/intersect/union/except) emits BR1
      // for a slot it only marked `undefined` — a row that never entered any
      // bucket here — so there is nothing to remove. Skip it rather than throw.
      if (!this.posMap.has(name)) continue
      const group = this.posMap.get(name)
      this.posMap.delete(name)
      const bucket = this.view.value[group]
      if (bucket !== undefined && name in bucket) {
        let leavers = leaving.get(group)
        if (!leavers) leaving.set(group, leavers = {})
        leavers[name] = bucket[name]
        delete bucket[name]
      }
    }
    this._emitObjectLeavers(leaving)
  }

  // BU1 has to handle two shapes of update: in-group (just refresh the value
  // under the existing bucket) and cross-group (remove from old bucket,
  // insert into new). The latter may also empty the old bucket entirely, in
  // which case we collapse the per-row BR2 events into a single BR1 for the
  // disappearing group — that's why we accumulate `leaving` and post-process.
  BU1(U1) {
    if (this.isArr) return this.BU1A(U1)
    const NU2 = []
    const NI2 = []
    const leaving = new Map()
    for (let i = 0; i < U1.length; i++) {
      const name = U1[i++]
      const value = U1[i]
      // `tracked` (posMap.has) distinguishes a row in the "undefined" group from
      // an untracked one — `old_group === undefined` would conflate them, leaving
      // an undefined-group row in its old bucket on a cross-group move (silent dup).
      const tracked = this.posMap.has(name)
      // value === undefined is a LEAVE (`src.k = undefined`): drop from the old
      // bucket (collapsing it via the leaving-map post-process), never fn(undefined).
      if (value === undefined) {
        if (tracked) {
          const old_group = this.posMap.get(name)
          this.posMap.delete(name)
          const oldVal = this.view.value[old_group]?.[name]
          if (oldVal !== undefined) {
            let leavers = leaving.get(old_group)
            if (!leavers) leaving.set(old_group, leavers = {})
            leavers[name] = oldVal
            delete this.view.value[old_group][name]
          }
        }
        continue
      }
      const old_group = this.posMap.get(name)
      const new_group = this.fn(value)
      if (tracked && old_group === new_group) {
        NU2.push([new_group, name], this.view.value[new_group][name] = value)
      } else {
        if (tracked) {
          const oldVal = this.view.value[old_group]?.[name]
          if (oldVal !== undefined) {
            let leavers = leaving.get(old_group)
            if (!leavers) leaving.set(old_group, leavers = {})
            leavers[name] = oldVal
            delete this.view.value[old_group][name]
          }
        }
        this.view.value[new_group] ??= {}
        NI2.push([new_group], this.view.value[new_group][name] = value, name)
        this.posMap.set(name, new_group)
      }
    }

    const NR1 = []
    const NR2 = []
    for (const [group, leavers] of leaving) {
      if (isEmpty(this.view.value[group])) {
        NR1.push(group, leavers)
        delete this.view.value[group]
      } else {
        for (const name in leavers) {
          NR2.push([group, name], leavers[name])
        }
      }
    }

    if (NR1.length) this.view.BR1(NR1)
    if (NR2.length) this.view.BR2(NR2)
    if (NU2.length) this.view.BU2(NU2)
    if (NI2.length) this.view.BI2(NI2)
  }

  BI0(I0) {
    if (this.isArr) return this.BI0A(I0)
    const NI2 = []
    for (let i = 0; i < I0.length; i++) {
      const name = I0[i++]
      const value = I0[i]
      const new_group = this.fn(value)
      this.view.value[new_group] ??= {}
      NI2.push([new_group], this.view.value[new_group][name] = value, name)
      this.posMap.set(name, new_group)
    }
    if (NI2.length) this.view.BI2(NI2)
  }

  _emitObjectLeavers(leaving) {
    const NR1 = []
    const NR2 = []
    for (const [group, leavers] of leaving) {
      if (isEmpty(this.view.value[group])) {
        NR1.push(group, leavers)
        delete this.view.value[group]
      } else {
        for (const name in leavers) {
          NR2.push([group, name], leavers[name])
        }
      }
    }
    if (NR1.length) this.view.BR1(NR1)
    if (NR2.length) this.view.BR2(NR2)
  }

  // ─── Array-source paths ───────────────────────────────────────────────────

  // Consumer-side hole/fill from an upstream sparse producer (between/…) over an
  // array: a row left/entered the upstream view WITHOUT a position shift. The
  // positional bucket bookkeeping (posMap idx, suffix shifts) assumes splices,
  // so a hole event can't be threaded through it cleanly — rebuild instead
  // (XU0 already skips the upstream's holes). Rare (array-source between→group),
  // so the O(N) rebuild is acceptable.
  BH1() { this.XU0(this.p.value) }
  BF0() { this.XU0(this.p.value) }

  BR1A(R1) {
    const leaving = new Map()           // group → [idx, val, idx, val, ...]
    const removed = []                  // upstream positions removed in this batch
    for (let i = 0; i < R1.length; i++) {
      const pos = +R1[i++]
      const info = this.posMap.get(pos)
      // Untracked position: an excluded/hole slot from a sparse-array upstream
      // (between/intersect/union/except, or a RowOperator gone sparse) that
      // XU0's skip-guard never bucketed. Still record it for the shift
      // bookkeeping below, but there's no bucket row to remove. (group over a
      // sparse array is the documented array-positional limitation — degrade to
      // no-crash rather than throw; use object-keyed sources for exact results.)
      if (!info) { removed.push(pos); continue }
      const { group, idx } = info
      this.posMap.delete(pos)
      removed.push(pos)

      const bucket = this.view.value[group]
      const removedVal = bucket.splice(idx, 1)[0]
      let leavers = leaving.get(group)
      if (!leavers) leaving.set(group, leavers = [])
      leavers.push(idx, removedVal)

      // siblings in the same group with idx > this one shift down
      for (const sibling of this.posMap.values()) {
        if (sibling.group === group && sibling.idx > idx) sibling.idx--
      }
    }

    // shift surviving upstream positions for the suffix-shift implied by BR1A
    if (removed.length) {
      removed.sort((a, b) => a - b)
      const next = new Map()
      for (const [k, v] of this.posMap) {
        let shift = 0
        for (const r of removed) { if (r < k) shift++; else break }
        next.set(k - shift, v)
      }
      this.posMap = next
    }

    const NR1 = []
    const NR2 = []
    for (const [group, leavers] of leaving) {
      const bucket = this.view.value[group]
      if (bucket.length === 0) {
        // group cleared — emit BR1 with the removed rows as the value (array form)
        const cleared = []
        for (let j = 1; j < leavers.length; j += 2) cleared.push(leavers[j])
        NR1.push(group, cleared)
        delete this.view.value[group]
      } else {
        // partial removal — emit per-row BR2 keyed by idx
        for (let j = 0; j < leavers.length; j += 2) {
          NR2.push([group, leavers[j]], leavers[j + 1])
        }
      }
    }

    if (NR1.length) this.view.BR1(NR1)
    if (NR2.length) this.view.BR2(NR2)
  }

  BI0A(I0) {
    const NI2 = []
    for (let i = 0; i < I0.length; i++) {
      const pos = +I0[i++]
      const value = I0[i]

      // shift upstream positions ≥ pos up by one (suffix-shift of BI0A)
      const next = new Map()
      for (const [k, v] of this.posMap) next.set(k >= pos ? k + 1 : k, v)
      this.posMap = next

      const new_group = this.fn(value)
      const bucket = (this.view.value[new_group] ??= [])
      const idx = this._insertIdx(new_group, pos)
      bucket.splice(idx, 0, value)

      // siblings in same group with idx ≥ this one shift up
      for (const sibling of this.posMap.values()) {
        if (sibling.group === new_group && sibling.idx >= idx) sibling.idx++
      }

      this.posMap.set(pos, { group: new_group, idx })
      NI2.push([new_group], value, idx)
    }
    if (NI2.length) this.view.BI2(NI2)
  }

  BU1A(U1) {
    const NU2 = []
    const NI2 = []
    const leaving = new Map()
    for (let i = 0; i < U1.length; i++) {
      const pos = +U1[i++]
      const value = U1[i]
      const info = this.posMap.get(pos)
      const old_group = info?.group
      const new_group = this.fn(value)

      if (old_group === new_group && info !== undefined) {
        // in-group update — same idx, just refresh value
        this.view.value[new_group][info.idx] = value
        NU2.push([new_group, info.idx], value)
      } else {
        // cross-group (or row appearing for the first time)
        if (info !== undefined) {
          const oldBucket = this.view.value[old_group]
          if (oldBucket !== undefined) {
            const oldVal = oldBucket[info.idx]
            oldBucket.splice(info.idx, 1)
            for (const sibling of this.posMap.values()) {
              if (sibling.group === old_group && sibling.idx > info.idx) sibling.idx--
            }
            let leavers = leaving.get(old_group)
            if (!leavers) leaving.set(old_group, leavers = [])
            leavers.push(info.idx, oldVal)
          }
        }
        const newBucket = (this.view.value[new_group] ??= [])
        const newIdx = this._insertIdx(new_group, pos)
        newBucket.splice(newIdx, 0, value)
        for (const sibling of this.posMap.values()) {
          if (sibling.group === new_group && sibling.idx >= newIdx && this.posMap.get(pos) !== sibling) sibling.idx++
        }
        this.posMap.set(pos, { group: new_group, idx: newIdx })
        NI2.push([new_group], value, newIdx)
      }
    }

    const NR1 = []
    const NR2 = []
    for (const [group, leavers] of leaving) {
      const bucket = this.view.value[group]
      if (bucket.length === 0) {
        const cleared = []
        for (let j = 1; j < leavers.length; j += 2) cleared.push(leavers[j])
        NR1.push(group, cleared)
        delete this.view.value[group]
      } else {
        for (let j = 0; j < leavers.length; j += 2) {
          NR2.push([group, leavers[j]], leavers[j + 1])
        }
      }
    }

    if (NR1.length) this.view.BR1(NR1)
    if (NR2.length) this.view.BR2(NR2)
    if (NU2.length) this.view.BU2(NU2)
    if (NI2.length) this.view.BI2(NI2)
  }

  // Find the bucket index for a row whose upstream position is `pos`, by
  // counting siblings in the same group that come before it. O(posMap.size)
  // per insert — fine because group only sees the small upstream batches
  // that LimitValue forwards, never a full source.
  _insertIdx(group, pos) {
    let idx = 0
    for (const [otherPos, other] of this.posMap) {
      if (other.group === group && otherPos < pos) idx++
    }
    return idx
  }

  // In-place field updates (BU2) on an object source. This used to be a no-op,
  // which froze `group` against any in-place mutation: a histogram/aggregate
  // built on `data.group(fn)` over a source whose rows *mutate* (rather than
  // only enter/leave via insert/remove) never saw the change, and a row whose
  // group key changed in place was never rebucketed. (The same gap `length(fn)`
  // had before its BU2 fix — surfaced again by the pivot example.)
  //
  // For each touched row we recompute its group from the FULL current row
  // (this.p.value[name], already updated by the time BU2 fires):
  //   • same group  → forward the deep update, prefixing the path with the
  //     bucket key, so bucket consumers (aggregates re-projecting a column,
  //     child views) refresh — the row reference in the bucket is unchanged.
  //   • changed group → relocate the whole row to its new bucket (remove from
  //     old as BR2/BR1-if-emptied, insert into new as BI2) — mirrors BU1's
  //     cross-group move. A subsequent path for an already-moved row is skipped
  //     because the relocated row already carries every updated field.
  BU2(U2) {
    if (this.isArr) {
      // Array buckets are positional (posMap holds {group, idx}); relocating a
      // row whose GROUP KEY changed would mean splicing two bucket arrays and
      // re-indexing — not a clean positional edit, so rebuild when any touched
      // row's key moved. A non-key edit needs nothing: the bucket arrays hold
      // the same row references the source mutated in place, so the new field
      // value is already visible.
      for (let i = 0; i < U2.length; i += 2) {
        const name = U2[i][0]
        const row = this.p.value[name]
        // posMap is keyed NUMERICALLY for array sources (XU0 / BR1A / BI0A / BU1A
        // all use `+index`), but `name` is a STRING path segment — coerce, or the
        // lookup always misses, `fn(row) !== undefined?.group` is always true, and
        // every non-key in-place edit triggers a full XU0 rebuild (the documented
        // O(0) non-key-edit path was dead).
        if (row !== undefined && this.fn(row) !== this.posMap.get(+name)?.group)
          return this.XU0(this.p.value)
      }
      return
    }
    const NU2 = []
    const NI2 = []
    const leaving = new Map()
    const moved = new Set()
    for (let i = 0; i < U2.length; i++) {
      const path = U2[i++]
      const value = U2[i]
      const name = path[0]
      if (moved.has(name)) continue
      const row = this.p.value[name]
      const tracked = this.posMap.has(name)   // see BU1: distinguishes the "undefined" group from untracked
      const old_group = this.posMap.get(name)
      const new_group = this.fn(row)
      if (tracked && old_group === new_group) {
        if (this.view.value[new_group]) this.view.value[new_group][name] = row
        NU2.push([new_group, ...path], value)
      } else {
        moved.add(name)
        if (tracked) {
          const oldVal = this.view.value[old_group]?.[name]
          if (oldVal !== undefined) {
            let leavers = leaving.get(old_group)
            if (!leavers) leaving.set(old_group, leavers = {})
            leavers[name] = oldVal
            delete this.view.value[old_group][name]
          }
        }
        this.view.value[new_group] ??= {}
        NI2.push([new_group], this.view.value[new_group][name] = row, name)
        this.posMap.set(name, new_group)
      }
    }

    const NR1 = []
    const NR2 = []
    for (const [group, leavers] of leaving) {
      if (isEmpty(this.view.value[group])) {
        NR1.push(group, leavers)
        delete this.view.value[group]
      } else {
        for (const name in leavers) NR2.push([group, name], leavers[name])
      }
    }

    if (NR1.length) this.view.BR1(NR1)
    if (NR2.length) this.view.BR2(NR2)
    if (NU2.length) this.view.BU2(NU2)
    if (NI2.length) this.view.BI2(NI2)
  }

  BR2() {}
  BI2() {}
}

export const group = (source, fn) => createOperator(source, GroupValue, fn)
