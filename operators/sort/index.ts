// @ts-nocheck
import { isArray, bisect_right, bisect_left } from '../../utils.ts'
import { Operator, value, createOperator } from '../../core.ts'

// ZAValue is the descending sort + top-n. State:
//   sorted   — every source key in descending order (kept fully so we can
//              rebuild the visible window incrementally on rank changes)
//   view.value — the first `n` entries materialized as an array
// The class also serves as the base for ascending sort (column accessor
// negated by the subclass) and for un-keyed numeric sort. Most updates only
// need to touch the n-element window: bisect to find the new rank, splice
// `sorted`, then translate the rank shift into BU1/BR1A/BI0A (or BMV1 when
// both ranks fall inside the window).
export class ZAValue extends Operator {
  // Dedup for the COLUMN forms (za/az('col') and za/az('col', n)). matches()
  // receives the RAW call args, so n must default to Infinity exactly like the
  // ZAColumnValue/AZColumnValue constructor — otherwise `za('col')` (raw n
  // undefined) never matched this.n (Infinity) and every call built a fresh
  // operator. The numeric forms (top(n)/za(n)) take a different arg shape and
  // override this on ZANumberValue/AZNumberValue. (=== not ==: the col_name of
  // the numeric forms is the `value` Symbol, and Symbol == n is always false.)
  matches(col, n = Infinity) { return this.col_name === col && this.n === n }

  constructor(p, col, col_name, n) {
    super()
    this.p = p
    this.n = n
    this.col = col
    this.col_name = col_name
    this.XU0(p.value)
  }

  XR0(){
    this.sorted = []
    this.view.XU0(this.view.value = [])
  }

  XU0(value){
    // `value === null`: typeof null === 'object', so without this guard
    // Object.keys(null) throws — crashing a sort over a null root, or mid-cascade
    // when an upstream value becomes null. (LimitValue.XU0 already guards null.)
    if (typeof value !== 'object' || value === null) return this.XR0()
    // Source shape is captured here (not at call time of BR1/BI0) because
    // those notifications fire *after* the source has already mutated, and
    // for arrays a removal will have shifted indices we still need to
    // translate against the pre-shift `sorted`.
    this.isArr = isArray(value)
    // Skip explicit-undefined slots: between/intersect/union/except leave the
    // key present with value `undefined` for excluded rows (the documented
    // sparse-array shape). Those aren't sortable members — including them would
    // crash `col` (`undefined[col]`) and leak undefined rows into the output.
    this.sorted = Object
      .keys(value)
      .filter(k => value[k] !== undefined)
      .sort((a, b) => {
        const va = this.col(value[a])
        const vb = this.col(value[b])
        // NaN keys sort LAST (and consistently): an inconsistent comparator
        // (returning 0 for every NaN comparison) makes Array.sort's result
        // arbitrary for the WHOLE array, scrambling unrelated rows. `na - nb`
        // orders a NaN after a non-NaN; `v !== v` is the NaN test.
        const na = va !== va, nb = vb !== vb
        if (na || nb) return (na ? 1 : 0) - (nb ? 1 : 0)
        return va > vb ? -1
             : va < vb ?  1
                       :  0
      })

    this.view.XU0(this.view.value = this.sorted
      .slice(0, this.n)
      .map(i => value[i])
    )
  }

  // Row removed upstream. Object sources keep stable keys, so we just
  // splice the deleted name out of `sorted` (and refill the visible window
  // from the next-ranked row if the removal was in-window). Array sources
  // require additional shift bookkeeping — see BR1A.
  BR1(R1){
    if (this.isArr) return this.BR1A(R1)
    // Bounded-window batch fast path. The per-row loop below refills the window
    // from the next-ranked row after every in-window eviction — but on a
    // top-of-order batch removal (a range brush narrowing past the visible
    // window) that refill row is itself in the doomed batch, so it's inserted
    // then immediately re-evicted: O(Δ) churn, where each churned slot costs an
    // O(n) V1 content shift + a node create/destroy in the DOM, instead of
    // O(window). Recompute the window once and emit one positional BU1 per slot
    // whose occupant actually changed (the same verb za already uses for the
    // no-rank-change case), plus tail removals when the window can no longer be
    // filled. Identical final state, far fewer events. Gated on a finite window
    // (an unbounded sort has no window to churn — every row is materialized, so
    // a removal is a genuine BR1A, not a turnover) and a multi-row batch (a
    // single removal can't churn). See sort.perf.ts `bounded batch brush`.
    if (this.n !== Infinity && R1.length > 2) return this._batchRemove(R1)
    for (let i = 0; i < R1.length; i += 2) {
      const oidx = this.get_index(R1[i])
      if (oidx === -1) continue
      this.sorted.splice(oidx, 1)
      if (this.n === Infinity) { super.BR1A([oidx]); continue }  // unbounded: genuine splice
      if (oidx >= this.n) continue                              // bounded out-of-window: no change
      // bounded in-window removal: a refill row slides up from below — a content
      // rotation, not a mid-window splice (see _window / C3).
      this._window()
    }
  }

  // Drop a batch of keys from `sorted` in one pass, then reconcile the
  // materialized window against the new order with minimal positional deltas.
  // Removal can only shrink or hold the window (never grow it), so the only
  // verbs are tail BR1A (when survivors no longer fill n) and per-slot BU1.
  _batchRemove(R1){
    const removed = new Set()
    for (let i = 0; i < R1.length; i += 2) removed.add('' + R1[i])
    const sorted = this.sorted
    let w = 0
    for (let r = 0; r < sorted.length; r++)
      if (!removed.has(sorted[r])) sorted[w++] = sorted[r]
    sorted.length = w
    const newLen = this.n < sorted.length ? this.n : sorted.length
    while (this.view.value.length > newLen) super.BR1A([this.view.value.length - 1])
    const NU1 = []
    for (let i = 0; i < newLen; i++) {
      const row = this.p.value[sorted[i]]
      if (this.view.value[i] !== row) { this.view.value[i] = row; NU1.push('' + i, row) }
    }
    if (NU1.length) this.view.BU1(NU1)
  }

  // Array source: each removal at upstream index `name` shifts all later
  // indices down by one. Sorted holds upstream keys (numeric strings); after
  // the source splice, every entry in `sorted` whose key is greater than
  // any removed index needs to decrement to match. We also re-emit an
  // in-window evict per removal that fell inside the visible window, then
  // refill the tail from whatever rows now sit at the boundary.
  BR1A(R1){
    const inWindow = []
    const removedKeys = []
    for (let i = 0; i < R1.length; i += 2) {
      const name = R1[i]
      // Always track the position for shift bookkeeping — upstream array
      // operators may forward shift-only notifications for rows that were
      // never in our `sorted` (because they were filtered out earlier in
      // the chain). We must still re-key everything else.
      removedKeys.push(+name)
      const oidx = this.sorted.indexOf('' + name)   // sorted holds strings; name may be numeric (chained sort)
      if (oidx === -1) continue
      this.sorted.splice(oidx, 1)
      if (oidx < this.n) inWindow.push(oidx)
    }

    // Shift remaining `sorted` keys to match the source's post-splice layout.
    if (removedKeys.length) {
      removedKeys.sort((a, b) => a - b)
      for (let i = 0; i < this.sorted.length; i++) {
        const k = +this.sorted[i]
        let shift = 0
        for (const r of removedKeys) { if (r < k) shift++; else break }
        if (shift) this.sorted[i] = '' + (k - shift)
      }
    }

    // Bounded window: each in-window removal slides a refill row up from below —
    // a content rotation. Reconcile once with content-stable BU1s (+ a tail
    // shrink when survivors no longer fill n) rather than mid-window splices,
    // so a downstream positional sort stays consistent (C3). An out-of-window
    // removal can't change ranks 0..n-1, so skip the scan (preserves O(1)).
    if (this.n !== Infinity) { if (inWindow.length) this._window(); return }

    // Unbounded: every in-window eviction is a genuine mid-array splice; shrink
    // `view.value` by one per removal, remapping by prior j.
    inWindow.sort((a, b) => a - b)
    for (let j = 0; j < inWindow.length; j++) super.BR1A([inWindow[j] - j])

    // Refill the window up to min(n, sorted.length) — reading p.value with
    // the post-shift keys we just wrote into `sorted`.
    const target = this.sorted.length < this.n ? this.sorted.length : this.n
    while (this.view.value.length < target) {
      const idx = this.view.value.length
      super.BI0A([idx, this.p.value[this.sorted[idx]]])
    }
  }

  // The four cases of a row's rank change, governed by where the old and
  // new ranks fall relative to the visible window of size n:
  //   • out → out: nothing observable, just update `sorted`
  //   • out → in : evict the row pushed off the tail, insert this one
  //   • in  → out: evict this one from its position, refill the tail
  //   • in  → in : in-window rotation — emitted as a single BMV1 'move'
  //                rather than N per-position updates (cheaper for change-
  //                stream consumers; index-keyed DOM sinks refresh content
  //                positionally and treat the move itself as a no-op).
  BU1(U1){
    // Multi-pair batch (a patch() of whole-row overwrites): the per-pair path
    // below splices ONE key out of `sorted` then bisects against the rest — but
    // p.value already holds the NEW value of EVERY pair, so the other not-yet-
    // processed batch keys sit in `sorted` at their OLD ranks reading their NEW
    // values: a non-monotonic array, and the bisect returns a wrong rank
    // (silent, permanent mis-order). Reconcile the whole batch at once instead.
    if (U1.length > 2) return this._batchUpdate(U1)
    for (let i = 0; i < U1.length; i++) {
      const name = U1[i++]
      const value = U1[i]
      const { n, p, sorted } = this
      let oidx = this.get_index(name)
      if (oidx === -1) {
        if (value === undefined) continue   // leave of an already-absent row: nothing
        this.BI0([name, value]); continue
      }

      // Splice out *before* bisecting: by the time BU1 fires, p.value[name]
      // already holds the new sort value, so leaving `name` in `sorted`
      // would feed the bisect a non-monotonic array (its old slot now reads
      // as the new value). Binary search on a non-sorted array can skip past
      // the correct insertion point — the failure mode we hit is value
      // increases that get classified as "no change" (oidx === nidx) and
      // leave the row at its old rank.
      sorted.splice(oidx, 1)
      // value === undefined is a LEAVE (`src.k = undefined` — the documented
      // leave idiom): the row is no longer a sortable member, so drop it from
      // `sorted` and reconcile WITHOUT re-ranking (bisecting col(undefined)
      // would re-insert a ghost — at the tail for za, at rank 0 for az, where
      // it evicts a real windowed row).
      if (value === undefined) {
        if (n === Infinity) super.BR1A([oidx])
        else if (oidx < n) this._window()
        continue
      }
      let nidx = this.find(this.col(this.p.value[name]))
      sorted.splice(nidx, 0, '' + name)   // keep sorted string-keyed (chained sort sends numbers)
      // No rank change: only forward the value update if the row is in the
      // visible window. Otherwise we'd write `view.value[oidx] = value` past
      // `n`, growing the materialized window past its limit.
      //
      // Emit through View.BU1 (not super.BU1 / Value.BU1) deliberately:
      // Value.BU1 dedups by reference (`view.value[oidx] === value → skip`),
      // which is correct for a source setter but WRONG here. An in-place row
      // mutation that reaches us as a whole-row BU1 — e.g. `filter` collapsing
      // an upstream BU2 into a same-reference whole-row BU1 — carries the
      // unchanged object reference, so Value.BU1 would silently drop a real
      // content change. The upstream already decided the row changed; honour
      // that and refresh the in-window slot's child view + sinks unconditionally.
      if (oidx === nidx) {
        // Stringify the index: child views are keyed by stringified name, so a
        // numeric index would miss get_named() and skip the child-view refresh
        // (the working no-rank-change BU2 path emits the string key '0' too).
        if (oidx < n) { this.view.value[oidx] = value; this.view.BU1(['' + oidx, value]) }
        continue
      }
      if (oidx >= n && nidx >= n) {}
      else if ((oidx >= n) !== (nidx >= n)) {
        // Boundary crossing (out→in or in→out): the window's content rotates
        // but its SIZE stays n. Reconcile as content-stable BU1s rather than a
        // mid-window evict+insert pair, whose interior splice + inconsistent
        // intermediate window corrupts a downstream positional sort (C3).
        this._window()
      } else if (oidx < n && nidx < n) {
        // Both ranks fall inside the visible window: this is a rotation
        // of the element from oidx to nidx. Refresh the value at oidx
        // first — whole-row replacement (`p.value[name] = newObj` rather
        // than nested mutation of an existing row) leaves view.value at
        // the old reference, which would then ride the BMV1 splice to
        // the new rank. The nested-mutation case (`row.col = …`) is
        // unaffected: value === p.value[name] is the same reference
        // that's already in view.value, the BU1 is a no-op shuffle. Then
        // emit the move event for change-stream consumers that want move
        // semantics; sinks without BMV1 (and index-keyed DOM sinks) fall
        // back to a positional content refresh over the affected range.
        // Stringify oidx: the change-record contract is `key: string[]`, and a
        // numeric key here surfaced as `{ key: [2] }` (number) to connect([])
        // consumers and missed the string-keyed child-view refresh (the
        // no-rank-change path two branches up stringifies for the same reason).
        super.BU1(['' + oidx, value])
        super.BMV1([oidx, nidx])
      }
    }
  }

  // New row enters. If its rank is past the window we only need to record
  // it in `sorted`; otherwise, evict the bottom of the visible window (if
  // we're already at capacity) and splice the newcomer into its rank.
  // Array sources additionally require sliding existing keys >= `at` up by
  // one to match the source's post-splice indexing — `push` (at === length)
  // collapses to a no-op shift since nothing needs moving.
  BI0(I0){
    // Bounded-window batch fast path — the insert mirror of _batchRemove. A
    // range brush widening past the visible window re-inserts a block of
    // top-of-order rows; the per-row loop evicts and re-inserts the window tail
    // once per newcomer (O(Δ) churn). Recompute the window once instead. Object
    // source only — the array branch needs its per-insert `sorted` index shift.
    if (!this.isArr && this.n !== Infinity && I0.length > 2) return this._batchInsert(I0)
    let touched = false
    for (let i = 0; i < I0.length; i += 2) {
      const at = I0[i]
      const value = I0[i + 1]
      if (this.isArr) {
        const atNum = +at
        for (let j = 0; j < this.sorted.length; j++) {
          const k = +this.sorted[j]
          if (k >= atNum) this.sorted[j] = '' + (k + 1)
        }
      }
      // A carried-undefined hole insert — a sparse producer (between/intersect
      // over an array) splices in an excluded slot to keep its array
      // index-aligned, and forwards it as BI0([at, undefined]). The position
      // shift above keeps `sorted` aligned with the parent's now-longer array,
      // but the hole is NOT a ranked row: bisecting `col(undefined)` and splicing
      // the hole's index into `sorted` corrupts it, so a later BF0/BH1 bisect
      // reads `p.value[holeIndex] === undefined` and mis-ranks (the between→sort
      // desync). Shift only; never rank the hole. Mirrors group.BI0A /
      // RowOperator.BI0A's carried-undefined guard.
      if (value === undefined) continue
      const new_idx = this.find(this.col(this.p.value[at]))
      this.sorted.splice(new_idx, 0, '' + at)   // keep sorted string-keyed
      if (this.n === Infinity) { super.BI0A([new_idx, value]); continue }  // unbounded: genuine insert
      if (new_idx < this.n) touched = true                                // bounded in-window newcomer
    }
    // Bounded: one content-stable reconcile after all `sorted` splices — a
    // newcomer entering the window rotates content (evicts the tail), which a
    // downstream positional sort must see as BU1s, not a mid-window splice (C3).
    if (touched) this._window()
  }

  // Splice a batch of new keys into `sorted` at their ranks, then reconcile the
  // window. Insertion can only grow or hold the window: grow via tail BI0A when
  // it was underfilled, then per-slot BU1 for the rows the inserts pushed down.
  _batchInsert(I0){
    for (let i = 0; i < I0.length; i += 2) {
      const at = I0[i]
      const nidx = this.find(this.col(this.p.value[at]))
      this.sorted.splice(nidx, 0, '' + at)   // keep sorted string-keyed
    }
    const sorted = this.sorted
    const newLen = this.n < sorted.length ? this.n : sorted.length
    while (this.view.value.length < newLen) {
      const i = this.view.value.length
      super.BI0A([i, this.p.value[sorted[i]]])
    }
    const NU1 = []
    for (let i = 0; i < newLen; i++) {
      const row = this.p.value[sorted[i]]
      if (this.view.value[i] !== row) { this.view.value[i] = row; NU1.push('' + i, row) }
    }
    if (NU1.length) this.view.BU1(NU1)
  }

  // Re-rank a multi-pair BU1 batch (a patch of whole-row overwrites) soundly.
  // Removing EVERY updated key from `sorted` up front leaves only unchanged
  // keys, which are still monotonic, so each subsequent bisect against the
  // remainder is correct (and stays correct as we splice each batch key back in
  // at its rank — incremental insertion into a sorted array preserves order).
  // Doing it pair-by-pair instead bisects against the other batch keys' stale
  // ranks (their p.value is already updated) — the non-monotonic mis-order.
  // Handles new keys (not yet in `sorted` -> just inserted at rank) and leaves
  // (value === undefined -> removed, never re-inserted) uniformly. Array sources
  // need no index shift here: a batch BU1 only ever carries existing-index value
  // changes (core routes new/refilled array slots through BI0A/BF0, not BU1).
  _batchUpdate(U1){
    for (let i = 0; i < U1.length; i += 2) {
      const oidx = this.get_index(U1[i])
      if (oidx !== -1) this.sorted.splice(oidx, 1)   // monotonic remainder
    }
    for (let i = 0; i < U1.length; i += 2) {
      const name = '' + U1[i]
      const val = U1[i + 1]
      if (val === undefined) continue                // leave: stays out of `sorted`
      const nidx = this.find(this.col(this.p.value[name]))
      this.sorted.splice(nidx, 0, name)
    }
    this._window()
  }

  // Reconcile the materialized window against the current `sorted` order with
  // the minimal CONTENT-STABLE deltas: a TAIL-ONLY BR1A/BI0A for a genuine
  // size change, then BU1 for each slot whose occupant rotated. This is the
  // single-row generalisation of _batchRemove/_batchInsert, used for every
  // bounded-window rotation (a row crossing the window boundary keeps the
  // window size n and only rotates content at fixed positions).
  //
  // Why not the old mid-window evict-BR1A + insert-BI0A pair: those splice at an
  // INTERIOR index, and a downstream positional consumer that itself maintains
  // order — another (windowed) sort — reads each splice as "a row left/entered
  // at position k, everything shifts", corrupting its position->rank map; worse,
  // the window is in an inconsistent intermediate state BETWEEN the evict and
  // the insert, so a sort reading p.value mid-pair re-ranks against a transient.
  // A tail splice shifts nothing, and a BU1 carries "position k's content
  // changed" — both compose correctly through a downstream sort. This closes the
  // chained-windowed-sort desync (C3). Bounded windows only: an unbounded sort
  // has no steady tail (every row is materialized), so its removes/inserts stay
  // genuine mid-array splices.
  _window(){
    const { sorted, n, p } = this
    const newLen = n < sorted.length ? n : sorted.length
    while (this.view.value.length > newLen) super.BR1A([this.view.value.length - 1])
    while (this.view.value.length < newLen) {
      const i = this.view.value.length
      super.BI0A([i, p.value[sorted[i]]])
    }
    const NU1 = []
    for (let i = 0; i < newLen; i++) {
      const row = p.value[sorted[i]]
      if (this.view.value[i] !== row) { this.view.value[i] = row; NU1.push('' + i, row) }
    }
    if (NU1.length) this.view.BU1(NU1)
  }

  // Nested-key changes (`row.col` mutated). If the change touches the sort
  // column we have to recompute the row's rank — funnel into BU1. Otherwise
  // it's just a deep update on a row that may or may not be visible: only
  // forward the BR2/BU2 if the row is in-window, with the key prefix
  // rewritten from upstream-name to in-window-position.
  BR2(R2) {
    for (let i = 0; i < R2.length; i++) {
      const [name, col, ...rest] = R2[i++]
      const value = R2[i]
      if (col === this.col_name) {
        this.BU1([name, this.p.value[name]])
      } else {
        const oidx = this.get_index(name)
        // `oidx >= 0`: a get_index miss returns -1, and -1 < n would forward a
        // bogus key[0]="-1" deep update. That happens when this sort feeds off
        // another windowed sort whose position-keys it rotates without re-keying
        // us — our `sorted` is then stale for that name. A "-1" key makes an
        // index-keyed DOM sink create a phantom node it never removes. The row
        // isn't tracked here, so there's nothing valid to forward — drop it.
        if (oidx >= 0 && oidx < this.n)
          this.view.BR2([[`${oidx}`, col, ...rest], value])
      }
    }
  }

  BU2(U2) {
    for (let i = 0; i < U2.length; i++) {
      const [name, col, ...rest] = U2[i++]
      const value = U2[i]
      if (col === this.col_name) {
        this.BU1([name, this.p.value[name]])
      } else {
        const oidx = this.get_index(name)
        // See BR2: drop get_index misses (-1) instead of forwarding a "-1" key.
        if (oidx >= 0 && oidx < this.n) {
          this.view.BU2([[`${oidx}`, col, ...rest], value])
        }
      }
    }
  }

  BI2(I2){
    for (let i = 0; i < I2.length; i++) {
      const [name, ...rest] = I2[i++]
      const value = I2[i++]
      const at = I2[i]
      if (!this.has(name)) { this.BI0([name, this.p.value[name]]); continue }
      const nidx = this.get_index(name)
      if (nidx >= this.n) continue
      this.view.BI2([[`${nidx}`, ...rest], value, at])
    }
  }

  // Positional-stable hole fill / hole remove. A sparse producer over an ARRAY
  // (between/intersect/union/except, or filter's predicate-flip path) admits/
  // excludes a row at a FIXED position WITHOUT splicing — siblings don't shift.
  // So rank the row in/out of `sorted` WITHOUT the array index-shift that
  // BI0/BR1A apply for a real splice. Without these, View.BF0/BH1 falls back to
  // BI0/BR1, whose shift bookkeeping would slide every `sorted` key on a hole
  // fill — the filter→windowed-sort desync. Bounded windows reconcile via
  // _window; an unbounded sort splices its (dense) materialized output directly.
  BF0(I0){
    let touched = false
    for (let i = 0; i < I0.length; i += 2) {
      const at = I0[i]
      const new_idx = this.find(this.col(this.p.value[at]))
      this.sorted.splice(new_idx, 0, '' + at)
      if (this.n === Infinity) { super.BI0A([new_idx, I0[i + 1]]); continue }
      if (new_idx < this.n) touched = true
    }
    if (touched) this._window()
  }

  BH1(R1){
    let touched = false
    for (let i = 0; i < R1.length; i += 2) {
      const oidx = this.get_index(R1[i])
      if (oidx === -1) continue
      this.sorted.splice(oidx, 1)
      if (this.n === Infinity) { super.BR1A([oidx]); continue }
      if (oidx < this.n) touched = true
    }
    if (touched) this._window()
  }

  get_index(id){
    // `sorted` holds upstream keys as strings (XU0 builds them via Object.keys
    // / `''+i`). A chained windowed sort upstream (za→az) forwards its internal
    // BR1A/BI0 positions as NUMBERS, so coerce before the lookup — otherwise
    // indexOf(2) misses "2" and the rank change is silently dropped (stale
    // content in the outer window).
    return this.sorted.indexOf('' + id)
  }

  has(id){ return !!~this.get_index(id) }
}
ZAValue.prototype.find = bisect_right

export class ZAColumnValue extends ZAValue {
  constructor(p, col, n = Infinity){
    super(p, d => d?.[col], col, n)
  }
}

export class ZANumberValue extends ZAValue {
  // Numeric form: the only arg is `n` (top(n) / za(n)); col is implicitly the
  // whole row. Default to Infinity like the constructor so top(2) dedups with
  // a second top(2) (and with za(2) — the same operation).
  matches(n = Infinity) { return this.n === n }
  constructor(p, n = Infinity){
    super(p, d => d, value, n)
  }
}

// AZValue mirrors ZAValue but sorts ascending. Same state shape, same
// rank-tracking machinery — only the initial sort comparator and the
// bisect direction flip. All BU1/BR1/BI0/BR2/BU2/BI2 logic in ZAValue is
// inherited unchanged because it only ever consults `this.find` and
// `this.sorted`, both of which now follow ascending order.
//
// Why a subclass instead of a `dir` flag on ZAValue: keeping the two
// orderings as distinct classes lets `instanceof` separate them in the
// dedup check, so `proxy.za('col')` and `proxy.az('col')` never collide
// in the matches() lookup even though they share `col_name` and `n`.
export class AZValue extends ZAValue {
  XU0(value) {
    if (typeof value !== 'object' || value === null) return this.XR0()  // see ZAValue.XU0
    // Capture source shape — ZAValue.XU0 sets this.isArr and the BU1/BI0/BR1A
    // index-shift bookkeeping depends on it. AZValue overrides XU0 entirely, so
    // it MUST set isArr too; without it, an ascending sort over an array source
    // (or an array-emitting parent like an unbounded za) skipped the shift and
    // mis-tracked positions on a mid-array insert/remove (it only worked when
    // every insert landed at the tail). See utils.bisect_left / BI0 / BR1A.
    this.isArr = isArray(value)
    // Skip explicit-undefined slots (see ZAValue.XU0).
    this.sorted = Object
      .keys(value)
      .filter(k => value[k] !== undefined)
      .sort((a, b) => {
        const va = this.col(value[a])
        const vb = this.col(value[b])
        const na = va !== va, nb = vb !== vb   // NaN keys last (see ZAValue.XU0)
        if (na || nb) return (na ? 1 : 0) - (nb ? 1 : 0)
        return va > vb ?  1
             : va < vb ? -1
                       :  0
      })
    this.view.XU0(this.view.value = this.sorted
      .slice(0, this.n)
      .map(i => value[i])
    )
  }
}
AZValue.prototype.find = bisect_left

export class AZColumnValue extends AZValue {
  constructor(p, col, n = Infinity){
    super(p, d => d?.[col], col, n)
  }
}

export class AZNumberValue extends AZValue {
  matches(n = Infinity) { return this.n === n }   // see ZANumberValue
  constructor(p, n = Infinity){
    super(p, d => d, value, n)
  }
}

// LimitValue keeps the first `n` non-undefined entries of an upstream collection
// in source iteration order. Both array and object sources are incremental:
// BR1/BI0/BU1 produce position-keyed deltas instead of triggering a full
// rescan, so downstream `group`/DOM doesn't tear down the window every time
// a brush removes a row that happened to fall inside it.
//
// State:
//   keys  — source keys currently inside the window. For arrays they're
//           numeric and stay sorted ascending so findPos/insertPos can
//           bisect; for objects they're stored as strings and looked up
//           with indexOf (linear scan, bounded by `n` so it stays cheap).
//   last  — only used for the array branch: largest key in the window;
//           refill scans source[last+1..]. For objects the refill walks
//           p.value's iteration order looking for the first key not in
//           the window.
export class LimitValue extends Operator {
  constructor(p, n) {
    super()
    this.p = p
    this.n = n
    this.XU0(this.p.value)
  }

  XR0(){ this.XU0(this.p.value) }

  XU0(value) {
    this.view.value = []
    this.keys = []
    this.isArr = isArray(value)
    if (typeof value === 'object' && value !== null) {
      if (this.isArr) {
        for (let i = 0; i < value.length; i++) {
          if (value[i] !== undefined) {
            this.view.value.push(value[i])
            this.keys.push(i)
            if (this.view.value.length === this.n) break
          }
        }
      } else {
        for (const i in value) {
          if (value[i] !== undefined) {
            this.view.value.push(value[i])
            this.keys.push(i)   // keep as string — object keys aren't always numeric
            if (this.view.value.length === this.n) break
          }
        }
      }
    }
    this.last = this.isArr && this.keys.length ? this.keys[this.keys.length - 1] : undefined
    this.view.XU0(this.view.value)
  }

  findPos(numKey) {
    let lo = 0, hi = this.keys.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      const m = this.keys[mid]
      if (m < numKey) lo = mid + 1
      else if (m > numKey) hi = mid
      else return mid
    }
    return -1
  }

  insertPos(numKey) {
    let lo = 0, hi = this.keys.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.keys[mid] < numKey) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  nextAfter(numKey) {
    const src = this.p.value
    if (!src) return undefined
    for (let i = numKey + 1; i < src.length; i++) {
      if (src[i] !== undefined) return i
    }
    return undefined
  }

  // Object-source refill helper: first key in p.value's iteration order
  // that isn't already in the window and has a defined value. Bounded by
  // `n + (source size)` per call, but typically returns on the first hit
  // past the window — fine for small to moderate sources.
  nextObjectKey() {
    const src = this.p.value
    if (!src) return undefined
    for (const k in src) {
      if (src[k] === undefined) continue
      if (this.keys.indexOf(k) !== -1) continue
      return k
    }
    return undefined
  }

  BU1(U1) {
    if (this.isArr) {
      const NU1 = []
      for (let i = 0; i < U1.length; i++) {
        const key = U1[i++]
        const val = U1[i]
        const pos = this.findPos(+key)
        if (pos === -1) continue
        if (val === undefined) {
          // `src[i] = undefined` is a LEAVE (the documented idiom the object
          // branch below already handles): the window must drop the dead slot
          // and refill from the next defined source row, not retain undefined —
          // the class keeps "the first n NON-undefined entries". Mirror the
          // array BR1 removal: splice the key, let super.BR1A own the view.value
          // splice + remove emit, then refill via nextAfter.
          this.keys.splice(pos, 1)
          super.BR1A([pos])
          const next = this.nextAfter(this.last ?? -1)
          if (next !== undefined) {
            this.keys.push(next)
            this.last = next
            super.BI0A([this.view.value.length, this.p.value[next]])
          } else {
            this.last = this.keys.length ? this.keys[this.keys.length - 1] : undefined
          }
          continue
        }
        this.view.value[pos] = val
        NU1.push(''+pos, val)
      }
      if (NU1.length) this.view.BU1(NU1)
      return
    }
    // Object branch: existing key in window → update at its position; brand-new
    // key (BU1 on a property not in the source before) → append if window has
    // headroom, otherwise drop (objects' iteration order puts new keys at the
    // end, past the window).
    const NU1 = []
    for (let i = 0; i < U1.length; i += 2) {
      const key = '' + U1[i]
      const val = U1[i + 1]
      const pos = this.keys.indexOf(key)
      if (pos !== -1) {
        if (val === undefined) {
          // The row left the source — same as a BR1 in effect. Splice the key
          // out of our index and let super.BR1A do the view.value splice + emit
          // the remove (reading the still-present pre-splice element). Splicing
          // view.value here too would double-remove — BR1A owns view.value, so
          // it splices again, collapsing the window by an extra slot per leave
          // (the delete-via-`src.key = undefined` undercount bug). The sibling
          // BR1 object branch never manual-splices for the same reason.
          this.keys.splice(pos, 1)
          super.BR1A([pos])
          const next = this.nextObjectKey()
          if (next !== undefined) {
            this.keys.push(next)
            super.BI0A([this.view.value.length, this.p.value[next]])
          }
        } else {
          this.view.value[pos] = val
          NU1.push(''+pos, val)
        }
      } else if (val !== undefined && this.keys.length < this.n) {
        this.keys.push(key)
        super.BI0A([this.view.value.length, val])
      }
    }
    if (NU1.length) this.view.BU1(NU1)
  }

  BR1(R1) {
    if (this.isArr) {
      // Large batches: each refill may scan far into a sparse source, so a
      // single XU0 walk is cheaper than n × (scan to end). Threshold matches
      // the scale where the refill cost dominates the per-item bookkeeping.
      if (R1.length > this.n * 2) { this.XU0(this.p.value); return }
      for (let i = 0; i < R1.length; i += 2) {
        const numKey = +R1[i]
        const pos = this.findPos(numKey)
        if (pos === -1) continue
        this.keys.splice(pos, 1)
        super.BR1A([pos])
        const next = this.nextAfter(this.last ?? -1)
        if (next !== undefined) {
          this.keys.push(next)
          this.last = next
          super.BI0A([this.view.value.length, this.p.value[next]])
        } else {
          this.last = this.keys.length ? this.keys[this.keys.length - 1] : undefined
        }
      }
      return
    }
    // Object branch: linear lookup; refill the whole deficit in ONE source pass.
    // The old per-pair nextObjectKey() re-walked the entire source for EACH
    // removed row (O(K·source)); splicing out all removals first and refilling
    // once is O(source) for the batch (#55).
    if (R1.length > this.n * 2) { this.XU0(this.p.value); return }
    for (let i = 0; i < R1.length; i += 2) {
      const pos = this.keys.indexOf('' + R1[i])
      if (pos === -1) continue
      this.keys.splice(pos, 1)
      super.BR1A([pos])
    }
    this._refillObject()
  }

  // Refill the window up to `n` in a single iteration pass over the source,
  // skipping holes and keys already in the window (O(1) Set membership). Used
  // after a batch of object-source removals instead of nextObjectKey()'s
  // per-leave full re-scan. Preserves the same result (first keys in iteration
  // order not already in the window).
  _refillObject(){
    if (this.keys.length >= this.n) return
    const inWindow = new Set(this.keys)
    const src = this.p.value
    for (const k in src) {
      if (this.keys.length >= this.n) break
      if (src[k] === undefined || inWindow.has(k)) continue
      this.keys.push(k)
      inWindow.add(k)
      super.BI0A([this.view.value.length, src[k]])
    }
  }

  BI0(I0) {
    if (this.isArr) {
      if (I0.length > this.n * 2) { this.XU0(this.p.value); return }
      for (let i = 0; i < I0.length; i += 2) {
        const numKey = +I0[i]
        const val = I0[i + 1]
        // Over an array, View.BI0 routes to BI0A — so this plain-BI0 branch is
        // reached ONLY as the BF0 (hole-fill) fallback from a sparse producer
        // (between/intersect/…). A hole fill carries NO shift, and the position
        // may ALREADY be in the window: a sibling BH1→BR1 (hole-remove) batch in
        // the same cascade refills from the parent's already-updated value
        // (`nextAfter`), which can pull in a slot this BF0 batch then re-reports.
        // Without this dedup that double-adds the row (a duplicate + an evicted
        // survivor — `between→az`-shaped grids never hit it because they don't
        // limit, but `between→limit` brushed sideways did: [44,55,55]).
        if (this.findPos(numKey) !== -1) continue
        if (this.keys.length < this.n) {
          const pos = this.insertPos(numKey)
          this.keys.splice(pos, 0, numKey)
          if (this.last === undefined || numKey > this.last) this.last = numKey
          super.BI0A([pos, val])
        } else if (numKey < this.last) {
          const pos = this.insertPos(numKey)
          this.keys.pop()
          super.BR1A([this.n - 1])
          this.keys.splice(pos, 0, numKey)
          this.last = this.keys[this.keys.length - 1]
          super.BI0A([pos, val])
        }
      }
      return
    }
    // Object insert is rare (BU1 covers most "new key" paths). Treat as an
    // append-if-room — object iteration puts inserted keys at the end, past
    // the window if the window is full.
    for (let i = 0; i < I0.length; i += 2) {
      const key = '' + I0[i]
      const val = I0[i + 1]
      if (val === undefined) continue
      if (this.keys.indexOf(key) !== -1) continue
      if (this.keys.length < this.n) {
        this.keys.push(key)
        super.BI0A([this.view.value.length, val])
      }
    }
  }

  // A SORT parent (az/za) re-orders its output: a removal, a window rotation, or
  // a rank shuffle reaches us as the array-positional verbs BR1A / BI0A / BMV1,
  // each of which carries a SHIFT (every rank after the touched one slides). We
  // track `keys` as stable source positions and refill via a forward scan, so we
  // can't cheaply follow a re-ranking parent — `keys` would point at the wrong
  // post-shift rows. Recompute the window from the parent's (already-updated)
  // value instead. This path fires ONLY for a sort→limit chain: sparse producers
  // (between/intersect/union/except) signal membership with BR1/BF0/BH1, never
  // these, so the incremental brush path stays untouched. O(n) per event with
  // n = the (small) limit size. Without this, `az('v').limit(k)` dropped/duped
  // rows whenever a row left the sort or crossed a rank boundary.
  BR1A(){ this.XU0(this.p.value) }
  BI0A(){ this.XU0(this.p.value) }
  BMV1(){ this.XU0(this.p.value) }

  BR2(){}
  BU2(){}
  BI2(){}
}

export const sort = (source, a, b) => {
  const Class = typeof a === 'string' ? ZAColumnValue : ZANumberValue
  return createOperator(source, Class, a, b)
}

export const limit = (source, n) => createOperator(source, LimitValue, n)
