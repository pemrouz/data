// @ts-nocheck
import { isArray, iter } from '../../utils.ts'
import { Operator, view, createOperator } from '../../core.ts'

// `proxy.union(...sources)` keeps rows present in ANY source — bitmask
// counterpart to intersect. A row enters the output when at least one
// bit is set; the row's value is taken from the FIRST source (in argument
// order) that has the row. Rebuild on every change is O(rows × sources);
// the bitmask form below is O(1) per delta.
export class UnionValue extends Operator {
  constructor(p, ...sources) {
    super()
    this.p = p
    // Source bitmask map (source.view → { one, off }) — same layout as
    // intersect, since "any bit set" is just `bits !== 0` over the same
    // structure that intersect uses for `bits === all`.
    this.sources = new Map([[p, { one: 1, off: ~ 1 }]])
    this.allSources = [p]
    for (const src of sources) {
      const one = 1 << this.sources.size
      src.connect(this)
      this.sources.set(src[view], { one, off: ~one })
      this.allSources.push(src[view])
    }

    if (typeof p.value !== 'object') { super.XU0(); return }
    const new_value = isArray(p.value) ? [] : {}
    this.filters = isArray(p.value) ? [] : {}
    // Walk every source's value to seed bitmasks; for each row, pick the
    // value from the first source containing it.
    for (const src of this.allSources) {
      iter(src.value, (i, v) => {
        if (v === undefined) return
        this.filters[i] |= this.sources.get(src).one
      })
    }
    iter(this.filters, (i, b) => {
      if (b !== undefined && b !== 0) {
        new_value[i] = this._pick(i)
      }
    })
    this.view.XU0(this.view.value = new_value)
  }

  // Resolve a row's value: scan sources in argument order, take the first
  // that has the row defined.
  _pick(name) {
    for (const src of this.allSources) {
      const v = src.value?.[name]
      if (v !== undefined) return v
    }
    return undefined
  }

  XR0(_, v){
    const { off } = this.sources.get(v)
    const { all_off } = this
    iter(this.filters, (i, b) => {
      if (b !== undefined) this.filters[i] = b & off
    })
    // Recompute output: rows with bits === 0 leave; rows with bits !== 0 stay
    const new_value = isArray(this.view.value) ? [] : {}
    iter(this.filters, (i, b) => {
      if (b !== undefined && b !== 0) new_value[i] = this._pick(i)
    })
    this.view.XU0(this.view.value = new_value)
  }

  XU0(value, v) {
    const { one, off } = this.sources.get(v)
    if (typeof value !== 'object') return super.XU0()
    this.filters ??= isArray(this.p.value) ? [] : {}
    iter(this.filters, (i, b) => {
      if (b !== undefined) this.filters[i] = b & off
    })
    iter(value, (i, val) => {
      if (val === undefined) return
      this.filters[i] = (this.filters[i] || 0) | one
    })
    const new_value = isArray(this.p.value) ? [] : {}
    iter(this.filters, (i, b) => {
      if (b !== undefined && b !== 0) new_value[i] = this._pick(i)
    })
    this.view.XU0(this.view.value = new_value)
  }

  // ── Array structural insert / remove (C12) ───────────────────────────────
  // Core routes an ARRAY source's positional insert/remove through BI0A/BR1A;
  // object sources keep the BI0/BR1 _enter/_leave path (untouched). A splice
  // shifts every later index, so the per-index `filters` bitmask and the sparse
  // `view.value` must splice in lockstep or the index space drifts from the
  // (shifting) sources and every later positional event hits the wrong slot
  // (C12 array desync). See operators/intersect for the full rationale; union
  // differs only in the membership test ("any bit set" vs "all") and that its
  // value is `_pick`ed from the first source holding the row.
  //
  // NB union's PRIMARY (`this.p`) is itself a derived facet, so it echoes FIRST
  // (intersect/except's primary echoes last). That's why the structural splice
  // is keyed to the primary identity (order-independent) and a SECONDARY array
  // removal is a no-op: every facet derives from one underlying array, so a
  // structural delete is gone from ALL of them and the primary splice already
  // dropped it. (Two genuinely INDEPENDENT array sources — where a secondary
  // remove should re-pick rather than drop — aren't supported for arrays; no
  // such union is shipped. Object sources keep the full _leave re-pick.)
  BR1A(R1, v) {
    if (v !== this.p) return
    const NR1 = []
    for (let i = 0; i < R1.length; i += 2) {
      const at = R1[i]
      const oldVal = this.view.value[at]
      this.filters.splice(at, 1)
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

  // STRUCTURAL INSERT (tail). Each source self-reports its membership bit from
  // the carried value (a real row sets it, a hole `undefined` clears it),
  // accumulating order-independently; the row enters the union the moment ANY
  // bit is set. The new tail slot grows `filters`/`view.value` naturally
  // (mid-array inserts unsupported, as in intersect).
  //
  // The visible value is the row of the FIRST (highest-priority, earliest in
  // argument order) source holding it — taken from the echo's CARRIED value, NOT
  // re-read from the source array via `_pick`: a filter source whose trailing
  // rows are excluded has a `.length` shorter than the underlying array, so its
  // own internal positions are index-misaligned and a positional read can miss a
  // row it logically holds. `one` is `1 << priority`, so `one - 1` masks every
  // higher-priority source; this source supplies the value iff it has the row
  // and no higher-priority one does. A higher-priority source echoing later
  // overwrites to a BU1. (`_pick` stays correct for the OBJECT path, where keys
  // are stable and source reads align.)
  BI0A(I0, v) {
    const { one, off } = this.sources.get(v)
    const higher = one - 1
    const me = this.view.value
    const NI0 = [], NU1 = []
    // A MID-array insert shifts every later position, so `filters`/`view.value`
    // must splice a fresh cell in lockstep. `pendingShift` (the canonical source
    // grew, our parallel arrays haven't) flags it; `ix === filters.length` (a
    // TAIL insert) skips the splice and keeps the original C12 bit-fold path.
    // Union's PRIMARY (`this.p`) is itself a derived facet that echoes FIRST, so
    // the primary echo splices an EMPTY cell to realign structure, then this same
    // echo's bit-fold below sets its bit; later secondary echoes see the cell
    // already aligned (pendingShift now false) and fold their bits at the
    // correct shifted index.
    const pendingShift = this.p.value.length > this.filters.length
    for (let i = 0; i < I0.length; i += 2) {
      const at = I0[i]
      const ix = +at
      const val = I0[i + 1]
      if (pendingShift && ix < this.filters.length && v === this.p) {
        this.filters.splice(ix, 0, 0)
        me.splice(ix, 0, undefined)
      }
      const prev = this.filters[at] || 0
      const bits = this.filters[at] = val !== undefined ? (prev | one) : (prev & off)
      if (bits === 0 || val === undefined || (bits & higher)) continue
      if (me[at] === undefined) { me[at] = val; NI0.push(at, val) }
      else if (me[at] !== val) { me[at] = val; NU1.push(at, val) }
    }
    if (me.length < this.filters.length) me.length = this.filters.length
    if (NI0.length) this.view.BI0(NI0)
    if (NU1.length) this.view.BU1(NU1)
  }

  // BR1 from any source: clear that source's bit. If bits hit zero, the row
  // leaves the union. If still nonzero, the row stays — but its value may
  // need re-picking (the source we just lost might have been the source we
  // were getting the value from).
  BR1(R1, v) { this._leave(R1, v, false) }

  // BH1 (consumer): an upstream sparse producer (between/filter over an ARRAY)
  // holed a row in source v — positional-stable, no shift. Same logic as BR1;
  // emits BH1 for the rows that leave the union so a positional sink (a DOMSink
  // bound straight to this view) mirrors the hole instead of splice-shifting.
  // Mirrors between/intersect's consumer BH1.
  BH1(R1, v) { this._leave(R1, v, true) }

  _leave(R1, v, hole) {
    if (!R1.length) return
    const { off } = this.sources.get(v)
    const NR1 = []
    const NU1 = []
    this.view.value ??= isArray(this.p.value) ? [] : {}
    for (let i = 0; i < R1.length; i += 2) {
      const name = R1[i]
      const bits = this.filters[name]
      if (bits === undefined) continue
      const newBits = bits & off
      this.filters[name] = newBits
      if (newBits === 0) {
        NR1.push(name, this.view.value[name])
        delete this.view.value[name]
      } else {
        // Row still a member from another source: its DISPLAY source (and thus
        // its shown value) may have changed. Emit a BU1 unconditionally — do NOT
        // reference-compare: derived facets SHARE the row object, so an in-place
        // edit that moved the row between facets keeps the SAME reference, and the
        // old `newVal !== view.value[name]` compare always matched and dropped a
        // real display change (a downstream sort/sum/group then went stale).
        const newVal = this._pick(name)
        this.view.value[name] = newVal
        NU1.push(name, newVal)
      }
    }
    if (NU1.length) this.view.BU1(NU1)
    if (NR1.length) hole && isArray(this.view.value) ? this.view.BH1(NR1) : this.view.BR1(NR1)
  }

  BU1(U1, v) {
    if (!U1.length) return
    const NU1 = []
    for (let i = 0; i < U1.length; i += 2) {
      const name = U1[i]
      // Emit a BU1 for any row that is a current union MEMBER (some bit set), and
      // do NOT reference-compare. A facet only forwards a BU1 on a genuine change;
      // the old `newVal === view.value[name]` reference-skip wrongly swallowed an
      // IN-PLACE edit (S[k].v = x) — the facet forwards it as a same-reference
      // whole-row BU1, so the compare always matched and union emitted nothing,
      // leaving a downstream sort un-re-ranked / group un-rebucketed / sum/avg
      // un-re-tallied (value correct via _pick, change-stream empty). Emitting on
      // every member event over-notifies a lower-priority source's update with
      // the (unchanged) display value — harmless: downstream recomputes to the
      // same value. Correct for SHARED-reference overlapping facets too, which a
      // display-source gate would miss.
      if (!this.filters[name]) continue
      const newVal = this._pick(name)
      this.view.value[name] = newVal
      NU1.push(name, newVal)
    }
    if (NU1.length) this.view.BU1(NU1)
  }

  // Nested-key events (deep update / remove / insert on a member's row). Union
  // had NO BU2/BR2/BI2 handlers, so the default Operator forwarder swallowed a
  // member's nested edit: the union's OWN value stayed correct (`_pick` reads the
  // source live) but the change-stream was EMPTY, so a downstream sort never
  // re-ranked, group never rebucketed, and sum/avg never re-tallied on an
  // in-place edit. Mirror intersect/except's multi-source-aware handlers, but
  // gate on the DISPLAY source: union shows each row from the FIRST source
  // holding it (`_pick`), so only that source's nested edit changes the displayed
  // value — a lower-priority source's edit is invisible and must be dropped.
  _displaySrc(name) {
    for (const src of this.allSources) if (src.value?.[name] !== undefined) return src
    return undefined
  }
  BU2(U2, v) {
    if (!U2.length) return
    const N = []
    for (let i = 0; i < U2.length; i += 2)
      if (this._displaySrc(U2[i][0]) === v) N.push(U2[i], U2[i + 1])
    if (N.length) this.view.BU2(N)
  }
  BR2(R2, v) {
    if (!R2.length) return
    const N = []
    for (let i = 0; i < R2.length; i += 2)
      if (this._displaySrc(R2[i][0]) === v) N.push(R2[i], R2[i + 1])
    if (N.length) this.view.BR2(N)
  }
  BI2(I2, v) {
    if (!I2.length) return
    const N = []
    for (let i = 0; i < I2.length; i += 3)
      if (this._displaySrc(I2[i][0]) === v) N.push(I2[i], I2[i + 1], I2[i + 2])
    if (N.length) this.view.BI2(N)
  }

  BI0(I0, v){ this._enter(I0, v, false) }

  // BF0 (consumer): an upstream sparse producer filled a hole in source v —
  // positional-stable. Same logic as BI0; emits BF0 for rows that enter the
  // union so a positional sink fills in place rather than tail-appending.
  BF0(I0, v){ this._enter(I0, v, true) }

  _enter(I0, v, hole){
    if (!I0.length) return
    const { one } = this.sources.get(v)
    const me = this.view.value ??= isArray(this.p.value) ? [] : {}
    const NI0 = []
    const NU1 = []
    for (let i = 0; i < I0.length; i += 2) {
      const name = I0[i]
      const prev = this.filters[name] || 0
      const newBits = prev | one
      this.filters[name] = newBits
      const newVal = this._pick(name)
      if (prev === 0) {
        // First time this row appears in any source → insert.
        me[name] = newVal
        NI0.push(name, newVal)
      } else {
        // Already a member from another source. The display source (and thus the
        // shown value) may have changed — emit a BU1 unconditionally, NOT
        // reference-compared: facets share the row object, so an in-place edit
        // that moved the row into this (higher-priority) source keeps the SAME
        // reference and the old `newVal !== me[name]` compare dropped the real
        // change (a downstream sort/sum/group then went stale). See _leave/BU1.
        me[name] = newVal
        NU1.push(name, newVal)
      }
    }
    // UPDATES before INSERTS. A patch() that both MOVES a row between facets (an
    // NU1 re-rank) and admits another (an NI0 insert) in the same echo leaves
    // BOTH new values in `me`/the sources before we emit. A downstream SORT
    // bisects an insert against `p.value` at every position still in its index,
    // so if it sees the inserted row before the moved row's BU1 has re-ranked it,
    // it reads the moved row's NEW value at its OLD (stale) rank — a non-monotonic
    // array — and mis-places the insert. Emitting the re-ranks first keeps the
    // sort's order monotonic for the insert's bisect (the same discipline as
    // between's "removes before fills").
    if (NU1.length) this.view.BU1(NU1)
    if (NI0.length) hole && isArray(this.view.value) ? this.view.BF0(NI0) : this.view.BI0(NI0)
  }
}

export const union = (source, ...others) => createOperator(source, UnionValue, ...others)
