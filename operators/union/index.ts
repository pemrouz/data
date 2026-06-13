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
    for (let i = 0; i < I0.length; i += 2) {
      const at = I0[i]
      const val = I0[i + 1]
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
        const newVal = this._pick(name)
        if (newVal !== this.view.value[name]) {
          this.view.value[name] = newVal
          NU1.push(name, newVal)
        }
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
      // Only emit if the new value would change what we're showing — pick
      // recomputes from the first source containing the row.
      const newVal = this._pick(name)
      if (newVal === this.view.value?.[name]) continue
      this.view.value[name] = newVal
      NU1.push(name, newVal)
    }
    if (NU1.length) this.view.BU1(NU1)
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
      } else if (newVal !== me[name]) {
        // Already showed; value may have shifted because a higher-priority
        // source now has this row (we always take from the first source).
        me[name] = newVal
        NU1.push(name, newVal)
      }
    }
    if (NI0.length) hole && isArray(this.view.value) ? this.view.BF0(NI0) : this.view.BI0(NI0)
    if (NU1.length) this.view.BU1(NU1)
  }
}

export const union = (source, ...others) => createOperator(source, UnionValue, ...others)
