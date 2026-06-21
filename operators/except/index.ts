import { isArray, iter } from '../../utils.ts'
import { Operator, view, createOperator } from '../../core.ts'

// `proxy.except(other)` is rows in the source but NOT in `other` — set
// difference. Mirrors intersect's bitmask machinery for the negative
// case: we keep p's rows that aren't in `other`, dropping rows the
// moment `other` admits them.
//
// Only one secondary source (intersection of "is in p AND is NOT in
// other"); for chained differences, just chain `.except(b).except(c)`.
export class ExceptValue extends Operator {
  declare otherView: any
  constructor(p: any, other: any) {
    super()
    this.p = p
    this.otherView = other[view]
    this.otherView.connect(this)
    if (typeof p.value !== 'object') { super.XU0(); return }
    const new_value: any = isArray(p.value) ? [] : {}
    iter(p.value, (i: any, v: any) => {
      if (v === undefined) return
      if (this.otherView.value?.[i] === undefined) new_value[i] = v
    })
    // Mirror source length for arrays: assigning only kept indices leaves the
    // array short whenever trailing rows are excluded, so a later positional
    // BI0A/BR1A splice (and the source↔view index correspondence) would be
    // misaligned. Same C13 pad as RowOperator.XU0 / between.XU0.
    if (isArray(p.value)) new_value.length = p.value.length
    this.view.XU0(this.view.value = new_value)
  }

  // Source XU0 (the primary swapped wholesale): rebuild from scratch,
  // filtering out keys that `other` has.
  XU0(value?: any, v?: any) {
    if (v === this.otherView) {
      // Other source replaced — re-evaluate every primary row.
      return this._rebuild()
    }
    // Primary swapped.
    if (typeof value !== 'object') return super.XU0()
    const new_value: any = isArray(value) ? [] : {}
    iter(value, (i: any, val: any) => {
      if (val === undefined) return
      if (this.otherView.value?.[i] === undefined) new_value[i] = val
    })
    if (isArray(value)) new_value.length = value.length   // C13 pad (see constructor)
    this.view.XU0(this.view.value = new_value)
  }

  XR0(_?: any, v?: any) {
    if (v === this.otherView) {
      // Other source emptied — every primary row now passes through.
      return this._rebuild()
    }
    // Primary emptied — output is empty too.
    this.view.XU0(this.view.value = isArray(this.view.value) ? [] : {})
  }

  _rebuild() {
    const new_value: any = isArray(this.p.value) ? [] : {}
    iter(this.p.value, (i: any, v: any) => {
      if (v === undefined) return
      if (this.otherView.value?.[i] === undefined) new_value[i] = v
    })
    if (isArray(this.p.value)) new_value.length = this.p.value.length   // C13 pad (see constructor)
    this.view.XU0(this.view.value = new_value)
  }

  // BR1 from primary: row left p → drop from output if it was there.
  // BR1 from other: row left other → row may now pass through; if p has
  // it, add it to output.
  BR1(R1: any, v?: any) { this._removeFrom(R1, v, false) }

  // BH1 (consumer): an upstream sparse producer (between/filter over an ARRAY)
  // holed a row in source v — positional-stable, no shift. Same logic as BR1;
  // emits holes (BF0 admit / BH1 drop) so a positional sink mirrors them in
  // place instead of splice-shifting. Mirrors between/intersect/union.
  BH1(R1: any, v?: any) { this._removeFrom(R1, v, true) }

  // ── Array structural remove / insert (C12) ────────────────────────────────
  // Core routes an ARRAY source's positional remove/insert through BR1A/BI0A
  // (object sources keep the BR1/BI0 _removeFrom/_insertFrom path, untouched). A
  // splice shifts every later index, so `view.value` MUST splice in lockstep or
  // the index space drifts from the (shifting) source and a later positional
  // event hits the wrong slot (the C12 array desync — removing an EXCLUDED row
  // deleted a drifted VISIBLE one). except has no bitmask — membership is just
  // "in p AND not in other". Like intersect, except's PRIMARY (`this.p`, the
  // canonical index identity) is the raw source `s` and echoes LAST; `other`
  // (the filter facet) echoes first.
  BR1A(R1: any, v?: any) {
    // Only the primary's removal shifts the index space. A removal echoed by
    // `other` is the SAME underlying delete (the row is gone from `s` too) — a
    // no-op; a row LEAVING `other` while staying in `s` is a membership re-admit
    // that arrives as BH1 (see _removeFrom), not BR1A.
    if (v !== this.p) return
    const NR1 = []
    for (let i = 0; i < R1.length; i += 2) {
      const at = R1[i]
      const oldVal = this.view.value[at]
      this.view.value.splice(at, 1)
      // ALWAYS emit the positional splice, even for a pre-holed slot
      // (oldVal === undefined): the primary remove shifts every survivor below
      // it, so a downstream POSITIONAL consumer (map/filter/sort, or a DOMSink
      // bound to this view) must splice the same index or its layout drifts one
      // slot per holed-row removal. Position-agnostic record sinks skip the
      // undefined-valued pair (no phantom remove). Matches between.BR1 /
      // RowOperator.BR1 array handling. (C12 closure: the splice was applied
      // internally but never communicated.)
      NR1.push(at, oldVal)
    }
    if (NR1.length) this.view.BR1(NR1)
  }

  // Array structural insert (tail). except shows the row iff it's in p AND NOT
  // in `other`. Decide visibility on `other`'s echo: it carries its membership
  // DIRECTLY (a filter `other` with trailing exclusions is index-misaligned, so
  // a positional re-read of `other.value[at]` can miss the row), and p (=s, raw)
  // is already settled, so that echo knows both halves. `other` always echoes a
  // tail insert (RowOperator.BI0A emits the positional insert even for an
  // excluded slot), so this is complete. The primary's echo is the index
  // authority — it just keeps `view.value` length-aligned with `s`, so an
  // excluded (holed) insert still extends the array. (Mid-array inserts
  // unsupported, as in intersect/union.)
  BI0A(I0: any, v?: any) {
    // Only the PRIMARY echo (`this.p`, the canonical index identity — it echoes
    // LAST, so `other` has already settled) reconciles an array insert; the
    // `other` echo is a structural no-op (the same underlying source grew, and
    // `other`'s membership is read positionally below). `view.value` is padded to
    // source length (constructor / XU0 / _rebuild), so `at` (a source index)
    // splices the cell at the right slot for BOTH a mid-array insert (interior
    // splice, shifting survivors) and a tail insert (append). The old code never
    // spliced — it only extended the tail and admitted at the absolute index — so
    // a mid-array insert drifted every later survivor (C15). Admission is read
    // positionally from the settled `other` (between/intersect `other`s may emit
    // nothing for an out-of-range insert, so we can't rely on an `other` echo).
    if (v !== this.p) return
    const me = this.view.value
    const otherVal = this.otherView?.value
    const NI0 = []
    for (let i = 0; i < I0.length; i += 2) {
      const at = I0[i]
      const ix = +at
      const pRow = this.p.value[ix]
      const admit = pRow !== undefined && otherVal?.[ix] === undefined
      me.splice(ix, 0, admit ? pRow : undefined)
      // Forward the positional insert for EVERY slot — the admitted row OR a hole
      // (undefined) for an excluded one — not just admitted rows. A downstream
      // positional consumer (a SORT) must shift its position map in lockstep with
      // our splice; emitting only admitted rows let an excluded mid-array insert
      // shift `me` silently, so the sort's `sorted` keys drifted and a row except
      // had dropped lingered as a ghost. Symmetric with between.BI0; the sort's
      // BI0 carried-undefined guard shifts-without-ranking the hole, and a
      // position-agnostic sink (aggregate) skips the undefined.
      NI0.push(at, admit ? pRow : undefined)
    }
    if (NI0.length) this.view.BI0(NI0)
  }

  _removeFrom(R1: any, v: any, hole: any) {
    if (!R1.length) return
    const arr = isArray(this.view.value)
    if (v === this.otherView) {
      // `other` lost rows. Each affected key may now be admissible (ENTER).
      const NI0 = []
      for (let i = 0; i < R1.length; i += 2) {
        const name = R1[i]
        const pVal = this.p.value?.[name]
        if (pVal !== undefined && this.view.value[name] === undefined) {
          this.view.value[name] = pVal
          NI0.push(name, pVal)
        }
      }
      if (NI0.length) hole && arr ? this.view.BF0(NI0) : this.view.BI0(NI0)
      return
    }
    // Primary lost rows (LEAVE).
    const NR1 = []
    for (let i = 0; i < R1.length; i += 2) {
      const name = R1[i]
      if (this.view.value?.[name] !== undefined) {
        NR1.push(name, this.view.value[name])
        delete this.view.value[name]
      }
    }
    if (NR1.length) hole && arr ? this.view.BH1(NR1) : this.view.BR1(NR1)
  }

  // BU1 from primary: value at key changed; if key passes the filter, emit.
  // BU1 from other: row updated in `other`; doesn't change membership in
  // `other`, so nothing changes in our output.
  BU1(U1: any, v?: any) {
    if (v === this.otherView) return
    if (!U1.length) return
    const NU1 = []
    for (let i = 0; i < U1.length; i += 2) {
      const name = U1[i]
      const val = U1[i + 1]
      if (this.otherView.value?.[name] !== undefined) continue
      if (this.view.value?.[name] === val) continue
      this.view.value[name] = val
      NU1.push(name, val)
    }
    if (NU1.length) this.view.BU1(NU1)
  }

  // BU2 (a nested in-place edit, `src[k].f = x`). From `other`: the row stays
  // excluded regardless of its value, so our output is unchanged — no-op. From
  // primary: the row's field changed in place. The membership decision belongs
  // to `other` (a facet emits BI0/BR1 when the edit flips its predicate); our
  // job is only to NOT clobber that. Without this, the base BU2 default
  // re-materialised the row into `view.value` — re-adding a row the facet's
  // BI0 had just correctly dropped (an in-place edit that pushed a row INTO the
  // exclusion left it stuck in the output). Forward the nested update only for
  // rows still in the output (not excluded); skip excluded ones so they stay
  // dropped. The row object is shared with the source, so the value is already
  // current — we only propagate the notification.
  BU2(U2: any, v?: any) {
    if (v === this.otherView) return
    if (!U2.length) return
    const NU2 = []
    for (let i = 0; i < U2.length; i += 2) {
      const key = U2[i]
      const name = key[0]
      if (this.otherView.value?.[name] !== undefined) continue   // excluded — don't re-add
      if (this.view.value?.[name] === undefined) continue         // not in output — nothing to forward
      NU2.push(key, U2[i + 1])
    }
    if (NU2.length) this.view.BU2(NU2)
  }

  // BI0 from primary: maybe admit. BI0 from other: row appeared in other,
  // so if we were showing it, drop it.
  BI0(I0: any, v?: any) { this._insertFrom(I0, v, false) }

  // BF0 (consumer): an upstream sparse producer filled a hole in source v —
  // positional-stable. Same logic as BI0; emits holes (BH1 drop / BF0 admit).
  BF0(I0: any, v?: any) { this._insertFrom(I0, v, true) }

  _insertFrom(I0: any, v: any, hole: any) {
    if (!I0.length) return
    const arr = isArray(this.view.value)
    if (v === this.otherView) {
      // `other` gained rows → drop any we were showing (LEAVE).
      const NR1 = []
      for (let i = 0; i < I0.length; i += 2) {
        const name = I0[i]
        if (this.view.value?.[name] !== undefined) {
          NR1.push(name, this.view.value[name])
          delete this.view.value[name]
        }
      }
      if (NR1.length) hole && arr ? this.view.BH1(NR1) : this.view.BR1(NR1)
      return
    }
    // Primary insert (ENTER).
    const NI0 = []
    const me = this.view.value ??= isArray(this.p.value) ? [] : {}
    for (let i = 0; i < I0.length; i += 2) {
      const name = I0[i]
      const val = I0[i + 1]
      if (this.otherView.value?.[name] !== undefined) continue
      me[name] = val
      NI0.push(name, val)
    }
    if (NI0.length) hole && arr ? this.view.BF0(NI0) : this.view.BI0(NI0)
  }
}

export const except = (source: any, other: any) => createOperator(source, ExceptValue, other)
