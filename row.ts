// @ts-nocheck
import { isArray } from './utils.ts'
import { Operator } from './core.ts'

// RowOperator is the base for any operator that processes rows independently
// — `filter`, `map`, and similar. Subclasses implement `process(value, name,
// old_val)` and the base handles all the bookkeeping: deciding whether each
// upstream event becomes a downstream BU1 (still in), BI0 (newly entering),
// or BR1 (leaving), and keeping `this.view.value` in sync as it goes.
//
// `process` returns the row's transformed value, or undefined to exclude it.
// That single return value drives the in/out classification — RowOperator
// users never have to emit verbs themselves.
export class RowOperator extends Operator {
  // Base signature widened to the (value, name, old_val) shape every subclass
  // overrides with — without it a 3-arg `process` override is a TS2416 arity
  // mismatch against a 0-arg base. Type-only (the body is unchanged); erases at
  // runtime. All params optional so a subclass may take fewer.
  process(value?: any, name?: any, old_val?: any): any { throw new Error('not implemented, process:', this.name) }

  // Generic loop body shared by every BU1/BU2/BI0/BI2/BR2 entrypoint. `inc`
  // is the stride (2 for flat name/value, 3 for keyed insert with `at`);
  // `inner` distinguishes nested-key arrays (BU2/BI2/BR2 carry [key, ...] as
  // the first slot) from flat ones. We classify each row as upsert/insert/
  // remove based on whether `process` returned a value before *and* now, then
  // batch the resulting deltas into a single set of downstream events.
  loop(C, inc, inner) {
    const NU1 = [], NI0 = [], NR1 = []
    // The source may have just been upgraded from a primitive/undefined (where
    // XU0 left view.value === undefined) to an object by this very write — lazily
    // mirror its shape so the per-row writes below don't deref undefined.
    if (typeof this.view.value !== 'object' || this.view.value === null)
      this.view.value = isArray(this.p.value) ? [] : {}
    for (let i = 0; i < C.length; i += inc) {
      const name = inner ? C[i][0] : C[i]
      const old_val = this.view.value?.[name]
      const row = this.p.value[name]
      // An undefined upstream row is a hole / a leave (`src.k = undefined`, or a
      // sparse producer's excluded slot) — never hand it to process(): an
      // unguarded user fn (`r => r.v`) would throw mid-cascade. Treat as excluded.
      const now_val = row === undefined ? undefined : this.process(row, name, old_val)
      const old = old_val !== undefined
      const now = now_val !== undefined
      if ( old &&  now) { NU1.push(name, now_val); this.view.value[name] = now_val }
      else if (!old &&  now) { NI0.push(name, now_val); this.view.value[name] = now_val }
      else if ( old && !now) { NR1.push(name, old_val); delete this.view.value[name] }
    }
    this.view.BU1(NU1)
    // A predicate flip over an ARRAY admits/excludes a row at its FIXED index
    // (`value[name] = …` / `delete value[name]`) — a hole fill / hole remove, NOT
    // a splice: siblings keep their positions. Emit BF0/BH1 so a positional sink
    // (notably a windowed sort) mirrors the hole instead of shift-splicing every
    // later row (the filter→windowed-sort desync, C1 family). Object sources have
    // no positions to shift, so they keep the plain BI0/BR1 enter/leave verbs.
    // Sinks without BF0/BH1 fall back to BI0/BR1 (View.BF0/BH1), so this is
    // backward-compatible for aggregates and the DOM sink.
    if (isArray(this.view.value)) { this.view.BF0(NI0); this.view.BH1(NR1) }
    else { this.view.BI0(NI0); this.view.BR1(NR1) }
  }

  // Whole-value reset: rebuild the snapshot from scratch. Non-object values
  // collapse the operator to undefined since per-row semantics don't apply
  // (e.g. setting the source to a primitive). Array-vs-object shape is
  // mirrored from the source so `for...in` iteration stays consistent.
  XU0(value){
    if (typeof value !== 'object' || value === null) return this.view.XU0(this.view.value = undefined)
    const arr = isArray(value)
    const n = arr ? [] : {}
    for (const i in value) {
      // Skip explicit-undefined holes: a FRESH between/intersect has true holes
      // (for-in skips them), but after a brush/membership-leave the excluded
      // slots hold enumerable `undefined`. Handing those to process() crashed an
      // operator CONSTRUCTED over an already-churned sparse producer (the
      // `$(view)` re-point idiom). between/sort already guard exactly here.
      if (value[i] === undefined) continue
      const v = this.process(value[i], i, this.view.value?.[i])
      if (v !== undefined) n[i] = v
    }
    // Mirror the source LENGTH for arrays, so trailing-excluded rows leave holes
    // rather than SHORTENING our array (`n.length` would otherwise stop at the
    // last passing index). A short array breaks the source<->operator index
    // correspondence the whole array protocol relies on: a later tail insert at
    // the source index lands past our end / at the wrong slot, and a downstream
    // positional op re-reads a hole and crashes or mis-sorts (the C13 root).
    if (arr) n.length = value.length
    this.view.XU0(this.view.value = n)
  }
  BU1(U1) { this.loop(U1, 2, false) }
  BU2(U2) { this.loop(U2, 2, true ) }
  BI0(I0) { this.loop(I0, 2, false) }
  BI2(I2) { this.loop(I2, 3, true) }
  BR2(R2) { this.loop(R2, 2, true) }
  XR0(){ super.XR0() }
  // Removes can't be derived from `process` (the row is already gone
  // upstream), so this branch is a straight propagation: drop from our
  // snapshot and forward the delta if the row was actually held.
  //
  // Array sources need extra care: by the time BR1 fires the source has
  // already spliced its array, so every surviving position shifted down by
  // one for each removed entry below it. Our `view.value` is the same
  // array shape; if we don't splice in lockstep the layouts diverge,
  // subsequent BU2 events misclassify (read a hole, insert "new"), and
  // any downstream operator keying off positions (sort/za, between) gets
  // stale indices. So we always splice for arrays — even if our predicate
  // had excluded the row — and propagate a `[name, undefined]` pair so
  // downstream array-aware operators can apply their own shift bookkeeping.
  // The `value !== undefined` guard is preserved for object sources where
  // there's no shift to track.
  BR1(R1) {
    const isArr = isArray(this.view.value)
    const NR1 = []
    for (let i = 0; i < R1.length; i++) {
      const name = R1[i++]
      const value = this.view.value?.[name]
      if (isArr) {
        this.view.value.splice(name, 1)
        NR1.push(name, value)
      } else if (value !== undefined) {
        delete this.view.value[name]
        NR1.push(name, value)
      }
    }
    this.view.BR1(NR1)
  }

  // Array-positional insert (the array-aware counterpart of BR1). By the time
  // this fires the upstream has already spliced the row in at `at` — a row
  // rotating into a windowed sort, or a mid-array `insert(row, at)`. Our
  // `view.value` is the parallel array; we MUST splice in lockstep. The plain
  // BI0 path (loop) would instead read `view.value[at]` — the occupant the
  // insert displaced — as the row's "old" value, classify the insert as an
  // *update* of that slot, overwrite the occupant, and never shift it down:
  // the displaced row vanishes (the windowed-sort drop, C2). So process the
  // row, splice the result in at `at` (a `delete` afterwards turns an excluded
  // row into a proper hole, matching the rest of RowOperator's array
  // convention so for-in skips it), and forward a positional BI0A so our own
  // array-aware sinks shift too. Object upstreams never reach here — core only
  // routes array inserts through BI0A — so the object path is untouched.
  BI0A(I0) {
    const NI0 = []
    for (let i = 0; i < I0.length; i += 2) {
      const at = I0[i]
      const row = this.p.value[at]
      // When the upstream excluded the inserted row it forwards BI0A with a TRUE
      // HOLE at `at` (carried-undefined). Honour that convention — don't call
      // process(undefined) (an unguarded fn throws, aborting the cascade
      // half-applied): the row is simply a hole here too.
      const now_val = row === undefined ? undefined : this.process(row, at, undefined)
      this.view.value.splice(at, 0, now_val)
      if (now_val === undefined) delete this.view.value[at]
      NI0.push(at, now_val)
    }
    this.view.BI0A(NI0)
  }

  // Hole remove (counterpart of BR1, for a sparse producer that marked a slot
  // undefined WITHOUT splicing). The row simply left our view too: clear our
  // slot to a hole, keeping length and positions aligned with the upstream — do
  // NOT splice (that would shift survivors the producer never moved). Forward a
  // BH1 so our own positional sinks mirror the hole rather than shifting.
  BH1(R1) {
    const NR1 = []
    for (let i = 0; i < R1.length; i++) {
      const name = R1[i++]
      const value = this.view.value?.[name]
      if (value !== undefined) { delete this.view.value[name]; NR1.push(name, value) }
    }
    this.view.BH1(NR1)
  }

  // Hole fill (counterpart of BI0A). The producer re-admitted a row into a
  // previously-holed position — length unchanged, no shift. Re-run `process`
  // and fill our slot in place if the row passes (otherwise leave it a hole).
  // Forward a BF0 so downstream fills in place too.
  BF0(I0) {
    const NF0 = []
    for (let i = 0; i < I0.length; i += 2) {
      const name = I0[i]
      const row = this.p.value[name]
      // honour a carried-undefined hole fill (see loop / BI0A) — no process()
      const now_val = row === undefined ? undefined : this.process(row, name, undefined)
      if (now_val !== undefined) { this.view.value[name] = now_val; NF0.push(name, now_val) }
    }
    this.view.BF0(NF0)
  }
}
