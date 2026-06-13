// utils.ts
function iter(o, fn) {
  if (isArray(o)) {
    for (let i = 0; i < o.length; i++) fn(i, o[i]);
  } else {
    for (const i in o) fn(i, o[i]);
  }
}
var { isArray } = Array;
var identity = (d) => d;
var noop = () => {
};
var left = (prop) => function bisect(a, v, lo = 0, hi = a.length) {
  while (lo < hi) {
    const mid = lo + hi >>> 1;
    if (prop(a[mid]) < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};
var right = (prop) => function bisect(a, v, lo = 0, hi = a.length) {
  while (lo < hi) {
    const mid = lo + hi >>> 1;
    if (prop(a[mid]) > v) hi = mid;
    else lo = mid + 1;
  }
  return lo;
};
function bisect_right(v, lo = 0, hi = this.sorted.length) {
  while (lo < hi) {
    const mid = lo + hi >>> 1;
    if (this.col(this.p.value[this.sorted[mid]]) < v) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
function bisect_left(v, lo = 0, hi = this.sorted.length) {
  while (lo < hi) {
    const mid = lo + hi >>> 1;
    if (this.col(this.p.value[this.sorted[mid]]) < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function isEmpty(obj) {
  for (const i in obj)
    return false;
  return true;
}

// core.ts
var value = /* @__PURE__ */ Symbol.for("data.value");
var reactive = /* @__PURE__ */ Symbol.for("reactive");
var view = /* @__PURE__ */ Symbol.for("data.view");
var Symbols = { value, view };
var sclone = (d) => d == null ? d : d[view] ? d[view].value : structuredClone(d);
var _cascading = false;
var _pending = [];
var _errors = null;
var _DRAIN_CAP = 1e5;
function transact(fn) {
  if (_cascading) {
    _pending.push(fn);
    return;
  }
  _cascading = true;
  try {
    fn();
    let n = 0;
    while (_pending.length) {
      if (++n > _DRAIN_CAP)
        throw new Error("reactive cycle: a sink keeps writing back to its source without converging");
      _pending.shift()();
    }
    if (_errors) throw _errors[0];
  } finally {
    _pending.length = 0;
    _cascading = false;
    _errors = null;
  }
}
function _notify(sink, fn) {
  try {
    fn(sink);
  } catch (e) {
    if (_cascading) (_errors ??= []).push(e);
    else throw e;
  }
}
var Operators = globalThis[/* @__PURE__ */ Symbol.for("data.operators")] ??= {};
function makeDollar() {
  const f = (v) => new ViewProxy(View.value(v));
  f.random = (o) => crypto.randomUUID();
  return f;
}
var $ = globalThis[/* @__PURE__ */ Symbol.for("data.$")] ??= makeDollar();
var _devtoolsRoots = globalThis[/* @__PURE__ */ Symbol.for("data.roots")] ??= /* @__PURE__ */ new Set();
globalThis[/* @__PURE__ */ Symbol.for("data.internalRoots")] ??= /* @__PURE__ */ new WeakSet();
var _rootFinalizer = typeof FinalizationRegistry !== "undefined" ? new FinalizationRegistry((ref) => _devtoolsRoots.delete(ref)) : void 0;
function createOperator(source, OperatorClass, ...args) {
  const p = source[view];
  let op = p.some_sink((sink) => sink instanceof OperatorClass && sink.matches?.(...args) ? sink : void 0);
  if (!op) {
    op = new OperatorClass(p, ...args);
    p.sinks.add(new WeakRef(op));
  }
  return new ViewProxy(op.view);
}
var Value = class {
  constructor() {
    this.view = new View(this);
  }
  // Entry points from ViewProxy.set / .insert(...) / deleteProperty. They
  // dispatch on key-path length to the correct depth-suffixed verb. Setting a
  // proxy to another proxy is forbidden here because the resulting cycle is
  // ambiguous (copy or link?) — the caller must use a linked value instead
  // (see LinkedView).
  update(value2, key) {
    if (value2 instanceof ViewProxy) throw new Error("cannot set value to another data, use a linked value instead");
    transact(() => key.length === 0 ? this.XU0(value2) : key.length === 1 ? this.BU1([key[0], value2]) : this.BU2([key, value2]));
  }
  insert(value2, key, at) {
    if (value2 instanceof ViewProxy) throw new Error("cannot set value to another data, use a linked value instead");
    at = at === void 0 ? at : `${at}`;
    transact(() => key.length === 0 ? this.BI0([at, value2]) : this.BI2([key, value2, at]));
  }
  remove(key) {
    transact(() => key.length === 0 ? this.XR0() : key.length === 1 ? this.BR1([key[0]]) : this.BR2([key]));
  }
  // Idempotent: a Value already at undefined emits nothing. Returns false so
  // callers can short-circuit when nothing happened (used by Sink chains that
  // skip propagation on no-ops).
  XR0() {
    if (this.view.value === void 0) return false;
    const value2 = this.view.value;
    this.view.value = void 0;
    this.view.XR0(value2);
  }
  // BR1A: array-aware remove-at-name. Each name is treated as a positional
  // index; surviving rows shift down. The downstream BR1 carries the original
  // (pre-shift) name so sinks can identify which element left, but the
  // underlying array is already spliced by the time the View dispatches.
  //
  // Splice only if this operator owns its view.value — when the value is a
  // reference shared with the upstream (the common case for pass-through
  // operators like tap, which point view.value at p.value via XU0),
  // upstream has already spliced the array and re-splicing here shifts
  // every survivor one position further than intended.
  BR1A(R1) {
    const owns = this.view.value !== this.p?.value;
    const NR1 = [];
    for (let i = 0; i < R1.length; i++) {
      const name = R1[i];
      const value2 = this.view.value?.[name];
      if (owns) this.view.value.splice(name, 1);
      NR1.push(name);
      NR1.push(value2);
    }
    this.view.BR1(NR1);
  }
  // BR1: object remove-at-name. Routes to BR1A when the underlying value is
  // an array so we get splice semantics and downstream V1 propagation. Skips
  // already-undefined slots so a remove is a true no-op rather than emitting
  // a phantom event.
  BR1(R1) {
    if (isArray(this.view.value)) return this.BR1A(R1);
    const NR1 = [];
    for (let i = 0; i < R1.length; i++) {
      const name = R1[i];
      const value2 = this.view.value?.[name];
      if (value2 === void 0) continue;
      delete this.view.value[name];
      NR1.push(name);
      NR1.push(value2);
    }
    this.view.BR1(NR1);
  }
  BR2(R2) {
    const NR2 = [];
    loop1: for (let i = 0; i < R2.length; i++) {
      const key = R2[i];
      const [last, ...path] = key.slice().reverse();
      let vo = this.view.value;
      if (typeof vo !== "object") return;
      while (path.length) {
        const n = path.pop();
        if (typeof vo !== "object") continue loop1;
        vo = vo[n];
      }
      if (vo[last] === void 0) continue loop1;
      const value2 = vo[last];
      if (isArray(vo)) {
        vo.splice(last, 1);
      } else {
        delete vo[last];
      }
      NR2.push(key, value2);
    }
    this.view.BR2(NR2);
  }
  // Reference-equality short-circuit: if the caller passed the same object we
  // already hold, skip the entire dispatch. Operators that mutate in place
  // and re-emit (e.g. between, sort) rely on this — they swap the live
  // reference for a copy first to avoid this guard suppressing real changes.
  XU0(value2) {
    if (this.view.value === value2) return;
    this.view.value = value2;
    this.view.XU0();
  }
  // BU1 doubles as an upsert: keys whose previous value was undefined become
  // BI0 events, keys with an existing value become BU1, and identical values
  // are dropped entirely. Splitting the two avoids forcing every BU1 sink to
  // re-derive whether the row is new or a refresh.
  //
  // One refinement for ARRAY sources: writing a value into a slot that is
  // currently `undefined` is only a genuine INSERT if the index is at/beyond
  // the current length (an append/sparse-extend). An IN-BOUNDS undefined slot
  // is a positional HOLE, and filling it is length-stable — survivors don't
  // shift — so it must route through BF0, not BI0/BI0A (which splice-shift and
  // would grow a phantom ghost row in every downstream positional operator).
  // This is the root-array counterpart of the BH1/BF0 protocol the sparse
  // producers already use. For OBJECT sources a previously-undefined key is
  // always a fresh insert (no positions to shift) — load-bearing for the
  // upsert-as-leave/re-enter idiom — so the BF0 routing is array-only.
  BU1(U1) {
    const NU1 = [];
    const NI0 = [];
    const NF0 = [];
    if (typeof this.view.value !== "object" || this.view.value === null) this.view.value = {};
    const arr = isArray(this.view.value);
    for (let i = 0; i < U1.length; i++) {
      const name = U1[i++];
      const value2 = U1[i];
      const old = this.view.value?.[name];
      if (old === value2) continue;
      if (old !== void 0) NU1.push(name, value2);
      else if (arr && +name < this.view.value.length) NF0.push(name, value2);
      else NI0.push(name, value2);
      this.view.value[name] = value2;
    }
    this.view.BU1(NU1);
    this.view.BI0(NI0);
    this.view.BF0(NF0);
  }
  // Deep update along a key path. We auto-create intermediate objects so a
  // user can write `proxy.a.b.c = 1` without first ensuring `a.b` exists; the
  // alternative would force callers to reproduce immutable-update boilerplate
  // for what's logically one assignment. `key.slice().reverse()` then `pop()`
  // is just a cheap way to walk the path forward without mutating the caller's
  // key array.
  BU2(U2) {
    if (typeof this.view.value !== "object" || this.view.value === null) this.view.value = {};
    const NU2 = [];
    for (let i = 0; i < U2.length; i++) {
      const key = U2[i++];
      const value2 = U2[i];
      const [last, ...path] = key.slice().reverse();
      let vo = this.view.value;
      while (path.length) {
        const n = path.pop();
        vo = typeof vo[n] === "object" ? vo[n] : vo[n] = {};
      }
      if (vo[last] === value2) continue;
      vo[last] = value2;
      NU2.push(key, value2);
    }
    this.view.BU2(NU2);
  }
  // BI0: object insert. If `at` is omitted we mint a random key — this lets
  // `arr.insert(row)` work without the caller managing IDs. Routes to BI0A
  // for arrays so insert-at-position carries shift semantics.
  BI0(I0) {
    if (isArray(this.view.value)) return this.BI0A(I0);
    if (typeof this.view.value !== "object" || this.view.value === null) this.view.value = {};
    const NI0 = [];
    const NU1 = [];
    for (let i = 0; i < I0.length; i++) {
      const at = I0[i++] ??= "" + $.random(this.view.value);
      const value2 = I0[i];
      const old = this.view.value?.[at];
      if (old === value2) continue;
      old === void 0 ? NI0.push(at, value2) : NU1.push(at, value2);
      this.view.value[at] = value2;
    }
    this.view.BU1(NU1);
    this.view.BI0(NI0);
  }
  // BI0A: array insert-at-position. Undefined `at` means "push to end" and
  // we record the resulting index back into I0 so downstream sinks know
  // where the row landed. Defined `at` means splice — surviving elements at
  // that position and beyond shift up.
  //
  // Splice only if this operator owns its view.value (same shared-ref
  // guard as BR1A / BMV1 — see comment on BR1A).
  BI0A(I0) {
    const owns = this.view.value !== this.p?.value;
    for (let i = 0; i < I0.length; i += 2) {
      const at = I0[i];
      const value2 = I0[i + 1];
      if (at === void 0) {
        if (owns) I0[i] = "" + (this.view.value.push(value2) - 1);
        else I0[i] = "" + (this.view.value.length - 1);
      } else if (owns) {
        this.view.value.splice(at, 0, value2);
      }
    }
    this.view.BI0(I0);
  }
  // Move-at-depth-1 verb. Each [from, to] pair moves the element at
  // index `from` to index `to`; rows in between rotate by one. Carried as a
  // single 'move' for change-stream consumers that want move semantics rather
  // than N value-update events. (DOMSink itself treats a move as a no-op: it
  // renders rows index-keyed, so Value.BMV1's positional child refresh below
  // already updates each slot's content — see render/index.ts BMV1.)
  //
  // Splice only if this operator owns its view.value (same shared-ref
  // guard as BR1A / BI0A — see comment on BR1A).
  BMV1(M1) {
    if (this.view.value !== this.p?.value) {
      for (let i = 0; i < M1.length; i += 2) {
        const from = +M1[i];
        const to = +M1[i + 1];
        const [v] = this.view.value.splice(from, 1);
        this.view.value.splice(to, 0, v);
      }
    }
    this.view.BMV1(M1);
  }
  BI2(I2) {
    if (typeof this.view.value !== "object" || this.view.value === null) this.view.value = {};
    for (let i = 0; i < I2.length; i++) {
      const key = I2[i++];
      const value2 = I2[i++];
      const path = key.slice().reverse();
      let vo = this.view.value;
      while (path.length) {
        const n = path.pop();
        vo = typeof vo[n] === "object" ? vo[n] : vo[n] = {};
      }
      if (isArray(vo)) {
        if (I2[i] === void 0)
          I2[i] ??= "" + (vo.push(value2) - 1);
        else
          vo.splice(I2[i], 0, value2);
      } else {
        const at = I2[i] ??= "" + $.random(vo);
        vo[at] = value2;
      }
    }
    this.view.BI2(I2);
  }
};
var Operator = class extends Value {
};
var View = class _View {
  constructor(res) {
    this.res = res;
    this.key = [];
    this.sinks = /* @__PURE__ */ new Set();
    this.views = /* @__PURE__ */ new Map();
    this.p = void 0;
    this.name = void 0;
    this.value = void 0;
  }
  // Child views are produced lazily when ViewProxy.get sees a property access.
  // A child stays attached to its parent's key (so writes route correctly) but
  // owns its own value snapshot — kept in sync by the parent's dispatch logic
  // calling child.XU0() / XR0() on every notification that crosses its key.
  static child(p, name) {
    const view2 = new _View(p.res);
    view2.p = p;
    view2.key = [...p.key, name];
    view2.name = name;
    view2.XU0(p.value?.[name]);
    return view2;
  }
  // Two distinct entry points unified behind one factory: $(plain) builds a
  // fresh Value-backed View; $(otherProxy) builds a LinkedView that forwards
  // every read/write to the linked source. The branch matters for set/get
  // semantics — see LinkedView below.
  static value(value2) {
    if (value2 instanceof ViewProxy) {
      return new LinkedView(value2);
    } else {
      const res = new Value();
      res.XU0(value2);
      const ref = new WeakRef(res.view);
      _devtoolsRoots.add(ref);
      _rootFinalizer?.register(res.view, ref);
      return res.view;
    }
  }
  // XR0 cascades a clear: every named child loses its value too, but only if
  // the corresponding key actually disappeared (the second half of the OR
  // covers the case where a child is currently undefined and stays that way —
  // we still want its sinks to know).
  XR0(value2) {
    if (this.p) this.value = void 0;
    this.each((name, child) => {
      if (child.value !== value2?.[name] || child.value !== void 0)
        child.XR0(value2?.[name]);
    });
    this.sink((sink) => sink.XR0(value2, this));
  }
  // Splice-aware fan-out for object removes. For object sources we route each
  // R1 to the named child as an XR0 (a single key disappeared, named children
  // at other keys are unaffected). For array sources we instead refresh every
  // child whose index ≥ the smallest removed index — those rows just got
  // shifted to a different value. Sinks then see either the array-aware
  // BR1A (with shift semantics) or BR1 (treat as named delete) depending on
  // what they implement; the prototype check stops a sink that inherits the
  // default Value.BR1A from masquerading as array-aware.
  BR1(R1) {
    if (!R1.length) return;
    const arr = isArray(this.value);
    if (!arr) {
      for (let i = 0; i < R1.length; i += 2)
        this.get_named(R1[i])?.XR0(R1[i + 1]);
    } else if (this.views.size) {
      let offset = Infinity;
      for (let i = 0; i < R1.length; i += 2) {
        const at = +R1[i];
        if (at < offset) offset = at;
        if (!offset) break;
      }
      this.V1(offset);
    }
    this.fanout(arr ? "BR1A" : void 0, "BR1", R1);
  }
  BR2(R2) {
    for (let i = 0; i < R2.length; i++) {
      const [name, ...rest] = R2[i++];
      const value2 = R2[i];
      rest.length === 1 ? this.get_named(name)?.BR1([rest[0], value2]) : this.get_named(name)?.BR2([rest, value2]);
    }
    this.sink((sink) => sink.BR2(R2, this));
  }
  // Whole-value replacement. For child views this means: any name still
  // present in the new value gets a refresh (XU0), any name that vanished
  // gets a clear (XR0). The `if (this.p)` re-reads our slice from the parent
  // because XU0 on the parent already mutated `p.value`; we just mirror it.
  XU0() {
    if (this.p) this.value = this.p.value?.[this.name];
    this.each((name, child) => {
      if (this.value?.[name] !== void 0)
        child.XU0();
      else {
        if (child.value !== void 0)
          child.XR0(child.value);
      }
    });
    this.sink((sink) => sink.XU0(this.value, this));
  }
  BU1(U1) {
    if (!U1.length) return;
    if (this.p) this.value = this.p.value?.[this.name];
    for (let i = 0; i < U1.length; i++) this.get_named(U1[i++])?.XU0();
    this.sink((sink) => sink.BU1(U1, this));
  }
  BU2(U2) {
    if (!U2.length) return;
    if (this.p) this.value = this.p.value?.[this.name];
    for (let i = 0; i < U2.length; i++) {
      const [name, ...rest] = U2[i++];
      const value2 = U2[i];
      rest.length === 1 ? this.get_named(name)?.BU1([rest[0], value2]) : this.get_named(name)?.BU2([rest, value2]);
    }
    this.sink((sink) => sink.BU2(U2, this));
  }
  BI0(I0) {
    if (!I0.length) return;
    if (this.p) this.value = this.p.value?.[this.name];
    if (isArray(this.value)) return this.BI0A(I0);
    for (let i = 0; i < I0.length; i++) this.get_named(I0[i++])?.XU0();
    this.sink((sink) => sink.BI0(I0, this));
  }
  // Array insert: every existing index ≥ the smallest insert position has
  // shifted up, so refresh those children once before fanning out to sinks.
  // The prototype check guards against a sink that only inherits the default
  // BI0A from Value being treated as array-aware.
  BI0A(I0) {
    if (this.views.size) {
      let offset = Infinity;
      for (let i = 0; i < I0.length; i += 2) {
        const at = +I0[i];
        if (at < offset) offset = at;
      }
      this.V1(offset);
    }
    this.fanout("BI0A", "BI0", I0);
  }
  // Hole remove / hole fill — the positional-stable counterparts of BR1A/BI0A.
  // A sparse producer (between/intersect/union/except over an ARRAY) marks an
  // excluded slot `undefined` WITHOUT splicing: the array length is unchanged
  // and survivors do NOT shift. BR1A/BI0A would wrongly splice downstream
  // (ghost rows / dropped survivors — the array-positional desync). Instead the
  // producer emits BH1/BF0: we refresh only the touched children (no V1 shift)
  // and route to a sink's BH1/BF0 if it has one. A sink WITHOUT them (an
  // aggregate, say — position-agnostic) falls back to BR1/BI0, which is correct:
  // it just drops/adds the row. Operator positional sinks (RowOperator, a
  // downstream sparse op, sort) implement BH1/BF0 to mirror the hole instead
  // of shifting. The DOMSink ALSO implements them (index-keyed _remove_at/
  // _create_at, see render/index.ts) so a sparse producer can be bound straight
  // to a row template without phantom holes — the V1 content refresh we fire
  // here (get_named(k).XU0()) sets the touched child's value BEFORE the sink's
  // BH1/BF0 runs, and because the DOMSink keys nodes by index that refresh is
  // not double-applied (closed ISSUES.md C4). BH1/BF0 live on View only — never
  // on Value — so a plain Value sink never inherits one and always takes the
  // BR1/BI0 fallback.
  BH1(R1) {
    if (!R1.length) return;
    for (let i = 0; i < R1.length; i += 2) this.get_named(R1[i])?.XU0();
    this.fanout("BH1", "BR1", R1);
  }
  BF0(I0) {
    if (!I0.length) return;
    for (let i = 0; i < I0.length; i += 2) this.get_named(I0[i])?.XU0();
    this.fanout("BF0", "BI0", I0);
  }
  BI2(I2) {
    if (this.p) this.value = this.p.value?.[this.name];
    for (let i = 0; i < I2.length; ) {
      const [name, ...rest] = I2[i++];
      const value2 = I2[i++];
      const at = I2[i++];
      rest.length ? this.get_named(name)?.BI2([rest, value2, at]) : this.get_named(name)?.BI0([at, value2]);
    }
    this.sink((sink) => sink.BI2(I2, this));
  }
  // Apply a batched [from, to] rotation to named children whose key falls
  // inside any affected range, refreshing each from the (already moved)
  // parent value. Sinks that don't implement BMV1 fall back to BU1 over the
  // affected positions so they refresh content reactively.
  BMV1(M1) {
    if (!M1.length) return;
    if (this.p) this.value = this.p.value?.[this.name];
    if (this.views.size) {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < M1.length; i += 2) {
        const a = +M1[i], b = +M1[i + 1];
        if (a < lo) lo = a;
        if (b < lo) lo = b;
        if (a > hi) hi = a;
        if (b > hi) hi = b;
      }
      for (let j = lo; j <= hi; j++) {
        const child = this.get_named(`${j}`);
        if (child && child.value !== this.value[j]) child.XU0();
      }
    }
    for (const x of [...this.sinks]) {
      const sink = x.deref();
      if (!sink) {
        this.sinks.delete(x);
        continue;
      }
      try {
        if (sink.BMV1 && sink.BMV1 !== Value.prototype.BMV1) {
          sink.BMV1(M1, this);
        } else {
          const NU1 = [];
          for (let i = 0; i < M1.length; i += 2) {
            const a = +M1[i], b = +M1[i + 1];
            const lo = a < b ? a : b;
            const hi = a < b ? b : a;
            for (let j = lo; j <= hi; j++) NU1.push("" + j, this.value[j]);
          }
          if (NU1.length) sink.BU1(NU1, this);
        }
      } catch (e) {
        if (_cascading) (_errors ??= []).push(e);
        else throw e;
      }
    }
  }
  // After an array splice every index from `offset` onward may now hold a
  // different element. Walk all named children in that range and refresh
  // those whose snapshot diverged. Off-by-one (`length+1`) intentional: a
  // child created at the now-empty tail needs an XU0 to clear itself.
  V1(offset) {
    for (let i = offset; i < this.value.length + 1; i++) {
      const child = this.get_named(`${i}`);
      if (child && child.value !== this.value[i]) child.XU0();
    }
  }
  // Iteration helpers all double as sweepers: a WeakRef whose target was GC'd
  // is removed from the collection on the fly, so dead subscribers don't
  // accumulate. `sink(fn)` is the standard fan-out; `some_sink(fn)` is the
  // operator-dedup helper used by createOperator and ViewProxy.apply.
  some_sink(fn) {
    let n;
    for (const x of this.sinks) {
      const sink = x.deref?.();
      if (!sink) {
        this.sinks.delete(x);
        continue;
      }
      if (n = fn(sink)) return n;
    }
  }
  // Snapshot the sink set before fanning out: a sink that SUBSCRIBES during this
  // emit (a connect() inside another sink's callback) is seeded with the
  // post-commit snapshot at subscription time and must NOT also receive the
  // in-flight delta — a live Set iterator visits entries added mid-loop, which
  // delivered the current change twice (duplicating it for fold consumers). The
  // dead-WeakRef sweep still mutates the live set. `sinks.size` fast-path avoids
  // the array alloc when there's nothing (or nothing yet) to notify.
  sink(fn) {
    if (!this.sinks.size) return;
    for (const x of [...this.sinks]) {
      const sink = x.deref?.();
      if (!sink) {
        this.sinks.delete(x);
        continue;
      }
      _notify(sink, fn);
    }
  }
  // Array-aware fan-out: dispatch `verb` to each sink that has its OWN
  // implementation, else fall back to `fallback`. The four array-positional
  // dispatch sites (BR1→BR1A, BI0A, BH1, BF0) collapse onto this. "Has its own"
  // means: for BR1A/BI0A — distinct from Value.prototype's default (Value
  // defines those, so a bare Value sink must NOT masquerade as array-aware);
  // for BH1/BF0 — merely present (Value defines neither, so `proto` is undefined
  // and any method counts). A sink without `verb` takes `fallback` (BR1/BI0),
  // which is correct for position-agnostic sinks (aggregates, length). Pass
  // `verb = undefined` to force the fallback (object BR1 — no array variant).
  // `verb`/`fallback` are constant string literals at each call site, so V8
  // specializes `sink[verb]` back to a fixed-offset access after inlining.
  fanout(verb, fallback, payload) {
    if (!this.sinks.size) return;
    const proto = verb && Value.prototype[verb];
    for (const x of [...this.sinks]) {
      const sink = x.deref?.();
      if (!sink) {
        this.sinks.delete(x);
        continue;
      }
      const m = verb && sink[verb];
      try {
        m && (proto === void 0 || m !== proto) ? m.call(sink, payload, this) : sink[fallback](payload, this);
      } catch (e) {
        if (_cascading) (_errors ??= []).push(e);
        else throw e;
      }
    }
  }
  each(fn) {
    for (const [name, ref] of this.views) {
      const res = ref.deref?.();
      if (!res) {
        this.views.delete(name);
        continue;
      }
      fn(name, res);
    }
  }
  get_or_create_named(name) {
    return this.views.get(name)?.deref?.() ?? create(
      this.views,
      name,
      _View.child(this, name)
    );
  }
  get_named(name) {
    const res = this.views.get(name)?.deref?.();
    if (!res) this.views.delete(name);
    return res;
  }
  disconnect(sink) {
    for (const x of this.sinks) {
      const s = x.deref?.();
      if (s === sink) {
        this.sinks.delete(x);
        break;
      }
      if (!s) {
        this.sinks.delete(x);
        continue;
      }
    }
  }
  connect(sink) {
    this.sinks.add(new WeakRef(sink));
  }
};
var Sink = class {
};
var LinkedView = class _LinkedView extends View {
  constructor(p) {
    super();
    this.src = p[Symbols.view];
    this.update(this.src);
  }
  update(value2, key = []) {
    if (key.length) {
      return this.src.res.update(value2, key);
    }
    if (value2 instanceof ViewProxy) value2 = value2[Symbols.view];
    if (!(value2 instanceof View))
      throw new Error("cannot set linked value to non-reactive source");
    for (let v = value2; v instanceof _LinkedView; v = v.src)
      if (v === this) throw new Error("cannot create a cyclic linked value");
    this.src.disconnect(this);
    this.src = value2;
    this.src.connect(this);
    this.XU0();
  }
  insert(...args) {
    return this.src.res.insert(...args);
  }
  remove(...args) {
    return this.src.res.remove(...args);
  }
  // `value` and `res` are read-through to the source — the LinkedView itself
  // never holds data, it's a transparent forwarder.
  get value() {
    return this.src.value;
  }
  set value(v) {
  }
  get res() {
    return this;
  }
  set res(v) {
  }
};
function iter22(arr, fn) {
  for (let i = 0; i < arr.length; i++) fn(arr[i++], arr[i]);
}
function iter3(arr, fn) {
  for (let i = 0; i < arr.length; i++) fn(arr[i++], arr[i++], arr[i]);
}
var ArrSink = class {
  constructor(p, arr) {
    this.p = p;
    this.arr = arr;
    const refs = lifetimes.get(arr) ?? /* @__PURE__ */ new Set();
    refs.add(this);
    lifetimes.set(arr, refs);
    this.update([], p.value);
  }
  update = (key, value2) => this.arr.push({ type: "update", key, value: sclone(value2) });
  remove = (key, value2) => this.arr.push({ type: "remove", key, value: sclone(value2) });
  insert = (key, value2, at) => this.arr.push({ type: "insert", key, value: sclone(value2), at });
  XU0(value2) {
    this.update([], value2);
  }
  BU1(U1) {
    iter22(U1, (name, value2) => this.update([name], value2));
  }
  BU2(U2) {
    iter22(U2, (key, value2) => this.update(key, value2));
  }
  BI0(I0) {
    iter22(I0, (at, value2) => this.insert([], value2, at));
  }
  BI2(I0) {
    iter3(I0, (key, value2, at) => this.insert(key, value2, at));
  }
  XR0(value2) {
    this.remove([], value2);
  }
  // Skip undefined-valued removes: a RowOperator over an array forwards
  // `[index, undefined]` when an EXCLUDED slot is spliced out — the positional
  // shift signal that array-aware sinks need, but no logical row left the view.
  // A position-agnostic record sink must not surface a `{type:'remove',
  // value:undefined}` for a row that was never present (a real remove always
  // carries the row value).
  BR1(R1) {
    iter22(R1, (name, value2) => {
      if (value2 !== void 0) this.remove([name], value2);
    });
  }
  BR2(R2) {
    iter22(R2, (key, value2) => this.remove(key, value2));
  }
  move = (from, to) => this.arr.push({ type: "move", from, to });
  BMV1(M1) {
    iter22(M1, (from, to) => this.move(+from, +to));
  }
  R0(value2) {
    this.arr.push({ type: "remove", key: [], value: sclone(value2) });
  }
  R1(name, value2) {
    this.arr.push({ type: "remove", key: [name], value: sclone(value2) });
  }
  R2(key, value2) {
    this.arr.push({ type: "remove", key, value: sclone(value2) });
  }
  U0(value2) {
    this.arr.push({ type: "update", key: [], value: sclone(value2) });
  }
  U1(name, value2) {
    this.arr.push({ type: "update", key: [name], value: sclone(value2) });
  }
  U2(key, value2) {
    this.arr.push({ type: "update", key, value: sclone(value2) });
  }
  I0(value2, at) {
    this.arr.push({ type: "insert", value: sclone(value2), at });
  }
  I1(name, value2, at) {
    this.arr.push({ type: "insert", key: [name], value: sclone(value2), at });
  }
  I2(key, value2, at) {
    this.arr.push({ type: "insert", key, value: sclone(value2), at });
  }
};
var lifetimes = /* @__PURE__ */ new WeakMap();
var PropSink = class extends Sink {
  p;
  obj;
  prop;
  constructor(p, obj, prop) {
    super();
    this.p = p;
    this.obj = obj;
    this.prop = prop;
    this.obj[prop] = p.value;
    const refs = lifetimes.get(obj) ?? /* @__PURE__ */ new Set();
    refs.add(this);
    lifetimes.set(obj, refs);
  }
  XU0(value2) {
    this.obj[this.prop] = value2;
  }
  XR0() {
    this.XU0(this.p.value);
  }
  BU1() {
    this.XU0(this.p.value);
  }
  BR1() {
    this.XU0(this.p.value);
  }
  BI0() {
    this.XU0(this.p.value);
  }
  BU2() {
    this.XU0(this.p.value);
  }
  BR2() {
    this.XU0(this.p.value);
  }
  BI2() {
    this.XU0(this.p.value);
  }
  BMV1() {
    this.XU0(this.p.value);
  }
};
var FunctionSink = class extends Sink {
  constructor(p, obj, fn) {
    super();
    this.fn = fn;
    const refs = lifetimes.get(obj) ?? /* @__PURE__ */ new Set();
    refs.add(this);
    lifetimes.set(obj, refs);
    fn({ type: "update", key: [], value: sclone(p.value) });
  }
  XU0(value2) {
    this.fn({ type: "update", key: [], value: sclone(value2) });
  }
  XR0(value2) {
    this.fn({ type: "remove", key: [], value: sclone(value2) });
  }
  BU1(U1) {
    iter22(U1, (name, value2) => this.fn({ type: "update", key: [name], value: sclone(value2) }));
  }
  BU2(U2) {
    iter22(U2, (key, value2) => this.fn({ type: "update", key, value: sclone(value2) }));
  }
  BI0(I0) {
    iter22(I0, (at, value2) => this.fn({ type: "insert", key: [], value: sclone(value2), at }));
  }
  BI2(I2) {
    iter3(I2, (key, value2, at) => this.fn({ type: "insert", key, value: sclone(value2), at }));
  }
  BR1(R1) {
    iter22(R1, (name, value2) => {
      if (value2 !== void 0) this.fn({ type: "remove", key: [name], value: sclone(value2) });
    });
  }
  BR2(R2) {
    iter22(R2, (key, value2) => this.fn({ type: "remove", key, value: sclone(value2) }));
  }
  BMV1(M1) {
    iter22(M1, (from, to) => this.fn({ type: "move", from: +from, to: +to }));
  }
};
var ViewProxy = class _ViewProxy {
  view;
  constructor(view2) {
    this.view = view2;
    return new Proxy(noop, this);
  }
  deleteProperty(target, name) {
    const { res, key } = this.view;
    const path = name === Symbols.value ? key : [...key, "" + name];
    res.remove(path);
    return true;
  }
  set(t, name, value2) {
    const { res, key } = this.view;
    const path = name === Symbols.value ? key : [...key, name];
    res.update(value2, path);
    return true;
  }
  // Special-cased property reads:
  //   Symbol.toPrimitive — used by template literals and arithmetic. `hint` is
  //     "string" | "number" | "default". The old `hint ? toString : +value`
  //     treated every hint as truthy, so the numeric branch was dead and
  //     `+$(aDate)` was NaN (string round-trip) instead of the timestamp. Now:
  //     "number" → numeric (`+value`, the unary `+`/`-` case); "string" →
  //     toString (`String()`/template); "default" (binary `+`) → the underlying
  //     primitive AS-IS so the proxy coerces like its value (string concat for a
  //     string row, numeric for a number, date-string for a Date) — an object
  //     value falls back to toString since toPrimitive must return a primitive.
  //   Symbol.iterator    — lets `for (const x of proxy)` walk numeric indices.
  //   Symbols.reactive   — branding so foreign code can detect ViewProxies.
  //   Symbols.view       — internal: the underlying View object.
  //   Symbols.value      — the raw snapshot. Reading proxy.value would create
  //                        a child view named "value" instead — that's the
  //                        canonical gotcha noted in CLAUDE.md.
  get(t, name) {
    if (name === Symbol.toPrimitive) return (hint) => {
      const v = this.view.value;
      if (hint === "number") return +v;
      if (hint === "string") return v?.toString();
      return v !== null && typeof v === "object" ? v.toString() : v;
    };
    if (name === Symbol.iterator) return this.iterator;
    if (name === Symbols.reactive) return true;
    if (name === Symbols.view) return this.view;
    if (name === Symbols.value) return this.view.value;
    return new _ViewProxy(this.view.get_or_create_named(name));
  }
  // `proxy.filter(fn)` arrives here as: get → child view named "filter" →
  // apply. The child view's `name` tells us which operator to construct.
  // `connect`, `update`, `insert`, `remove` are handled directly without
  // going through the operator dispatch table.
  apply(t, m, args) {
    const { p, name: type } = this.view;
    if (!p) throw new Error("cannot invoke a root value!");
    if (type === "then" && typeof args[0] === "function") {
      const [onFulfilled, onRejected] = args;
      try {
        onFulfilled(p.value);
      } catch (e) {
        if (typeof onRejected === "function") onRejected(e);
      }
      return;
    }
    if (type === "connect") return connect(p, ...args);
    if (type === "raf") return raf(p);
    if (type === "patch") {
      const { res, key } = p;
      const pairs = args[0];
      return transact(() => {
        if (!key.length) return res.BU1(pairs);
        const U2 = [];
        for (let i = 0; i < pairs.length; i += 2) U2.push([...key, pairs[i]], pairs[i + 1]);
        return res.BU2(U2);
      });
    }
    if (type === "first") return new _ViewProxy(p.get_or_create_named(firstKey(p.value)));
    if (type === "last") return new _ViewProxy(p.get_or_create_named(lastKey(p.value)));
    if (type === "toJSON") return p.value;
    const OperatorClass = Operators[type]?.(...args);
    if (OperatorClass) {
      let sink = p.some_sink((sink2) => sink2 instanceof OperatorClass && sink2.matches?.(...args) ? sink2 : void 0);
      if (!sink) {
        p.sinks.add(new WeakRef(sink = new OperatorClass(p, ...args)));
      }
      return new _ViewProxy(sink.view);
    }
    const [value2, at] = args;
    if (type === "remove") return this.view.res.remove(p.key);
    if (type === "update") return this.view.res.update(value2, p.key);
    if (type === "insert") return this.view.res.insert(value2, p.key, at);
    const registered = Object.keys(Operators);
    throw new Error(`Unknown operator '${type}'. ` + (registered.length === 0 ? `The dispatch table is empty \u2014 likely an import from 'data/lean' (the registration-free core). Chainable operators (.filter, .between, .length, etc.) register when you import from 'data' (the default entry) or 'data/full' (adds JSX). Switch to 'data', or register the operators you need onto the exported 'Operators' table yourself.` : `No operator with that name is registered (${registered.length} operators are: ${registered.sort().join(", ")}).`));
  }
  getPrototypeOf(target) {
    return _ViewProxy.prototype;
  }
  // Open-ended counter — relies on the consumer to break out (typically
  // `.slice()` or destructuring with a fixed length). The reactive view
  // doesn't know its own length without resolving `value` first.
  *iterator(i = 0) {
    while (true) {
      yield this[i++];
    }
  }
};
function create(views, name, res) {
  views.set(name, new WeakRef(res));
  return res;
}
function connect(p, a, b) {
  if (isArray(a)) {
    const sink = new ArrSink(p, a);
    p.sinks.add(new WeakRef(sink));
    return a;
  }
  if (typeof a === "object" && typeof b === "string") {
    const sink = new PropSink(p, a, b);
    p.sinks.add(new WeakRef(sink));
    return a;
  }
  if (typeof a === "object" && typeof b === "function") {
    const sink = new FunctionSink(p, a, b);
    p.sinks.add(new WeakRef(sink));
    return a;
  }
  if (typeof a === "function") throw new Error(
    "connect(fn) isn't supported: a bare function can't act as a sink. Use connect(anchor, fn) to receive change records (the anchor object keeps the subscription alive past GC), connect([]) to collect events into an array, or connect(obj, 'prop') to mirror the value onto a property."
  );
  p.sinks.add(new WeakRef(a));
  return a;
}
function firstKey(v) {
  if (v == null || typeof v !== "object") return "0";
  if (isArray(v)) return "0";
  for (const k in v) return k;
  return "0";
}
function lastKey(v) {
  if (v == null || typeof v !== "object") return "0";
  if (isArray(v)) return String(Math.max(0, v.length - 1));
  let last = "0";
  for (const k in v) last = k;
  return last;
}
function raf(p) {
  let pending;
  let scheduled = false;
  const schedule = (cb) => typeof globalThis.requestAnimationFrame === "function" ? globalThis.requestAnimationFrame(cb) : setTimeout(cb, 16);
  const writer = (v) => {
    pending = v;
    if (scheduled) return;
    scheduled = true;
    schedule(() => {
      if (!scheduled) return;
      scheduled = false;
      p.res.update(pending, p.key);
    });
  };
  writer.flush = () => {
    if (!scheduled) return;
    scheduled = false;
    p.res.update(pending, p.key);
  };
  return writer;
}

// row.ts
var RowOperator = class extends Operator {
  process() {
    throw new Error("not implemented, process:", this.name);
  }
  // Generic loop body shared by every BU1/BU2/BI0/BI2/BR2 entrypoint. `inc`
  // is the stride (2 for flat name/value, 3 for keyed insert with `at`);
  // `inner` distinguishes nested-key arrays (BU2/BI2/BR2 carry [key, ...] as
  // the first slot) from flat ones. We classify each row as upsert/insert/
  // remove based on whether `process` returned a value before *and* now, then
  // batch the resulting deltas into a single set of downstream events.
  loop(C, inc, inner) {
    const NU1 = [], NI0 = [], NR1 = [];
    if (typeof this.view.value !== "object" || this.view.value === null)
      this.view.value = isArray(this.p.value) ? [] : {};
    for (let i = 0; i < C.length; i += inc) {
      const name = inner ? C[i][0] : C[i];
      const old_val = this.view.value?.[name];
      const row = this.p.value[name];
      const now_val = row === void 0 ? void 0 : this.process(row, name, old_val);
      const old = old_val !== void 0;
      const now = now_val !== void 0;
      if (old && now) {
        NU1.push(name, now_val);
        this.view.value[name] = now_val;
      } else if (!old && now) {
        NI0.push(name, now_val);
        this.view.value[name] = now_val;
      } else if (old && !now) {
        NR1.push(name, old_val);
        delete this.view.value[name];
      }
    }
    this.view.BU1(NU1);
    if (isArray(this.view.value)) {
      this.view.BF0(NI0);
      this.view.BH1(NR1);
    } else {
      this.view.BI0(NI0);
      this.view.BR1(NR1);
    }
  }
  // Whole-value reset: rebuild the snapshot from scratch. Non-object values
  // collapse the operator to undefined since per-row semantics don't apply
  // (e.g. setting the source to a primitive). Array-vs-object shape is
  // mirrored from the source so `for...in` iteration stays consistent.
  XU0(value2) {
    if (typeof value2 !== "object" || value2 === null) return this.view.XU0(this.view.value = void 0);
    const arr = isArray(value2);
    const n = arr ? [] : {};
    for (const i in value2) {
      if (value2[i] === void 0) continue;
      const v = this.process(value2[i], i, this.view.value?.[i]);
      if (v !== void 0) n[i] = v;
    }
    if (arr) n.length = value2.length;
    this.view.XU0(this.view.value = n);
  }
  BU1(U1) {
    this.loop(U1, 2, false);
  }
  BU2(U2) {
    this.loop(U2, 2, true);
  }
  BI0(I0) {
    this.loop(I0, 2, false);
  }
  BI2(I2) {
    this.loop(I2, 3, true);
  }
  BR2(R2) {
    this.loop(R2, 2, true);
  }
  XR0() {
    super.XR0();
  }
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
    const isArr = isArray(this.view.value);
    const NR1 = [];
    for (let i = 0; i < R1.length; i++) {
      const name = R1[i++];
      const value2 = this.view.value?.[name];
      if (isArr) {
        this.view.value.splice(name, 1);
        NR1.push(name, value2);
      } else if (value2 !== void 0) {
        delete this.view.value[name];
        NR1.push(name, value2);
      }
    }
    this.view.BR1(NR1);
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
    const NI0 = [];
    for (let i = 0; i < I0.length; i += 2) {
      const at = I0[i];
      const row = this.p.value[at];
      const now_val = row === void 0 ? void 0 : this.process(row, at, void 0);
      this.view.value.splice(at, 0, now_val);
      if (now_val === void 0) delete this.view.value[at];
      NI0.push(at, now_val);
    }
    this.view.BI0A(NI0);
  }
  // Hole remove (counterpart of BR1, for a sparse producer that marked a slot
  // undefined WITHOUT splicing). The row simply left our view too: clear our
  // slot to a hole, keeping length and positions aligned with the upstream — do
  // NOT splice (that would shift survivors the producer never moved). Forward a
  // BH1 so our own positional sinks mirror the hole rather than shifting.
  BH1(R1) {
    const NR1 = [];
    for (let i = 0; i < R1.length; i++) {
      const name = R1[i++];
      const value2 = this.view.value?.[name];
      if (value2 !== void 0) {
        delete this.view.value[name];
        NR1.push(name, value2);
      }
    }
    this.view.BH1(NR1);
  }
  // Hole fill (counterpart of BI0A). The producer re-admitted a row into a
  // previously-holed position — length unchanged, no shift. Re-run `process`
  // and fill our slot in place if the row passes (otherwise leave it a hole).
  // Forward a BF0 so downstream fills in place too.
  BF0(I0) {
    const NF0 = [];
    for (let i = 0; i < I0.length; i += 2) {
      const name = I0[i];
      const row = this.p.value[name];
      const now_val = row === void 0 ? void 0 : this.process(row, name, void 0);
      if (now_val !== void 0) {
        this.view.value[name] = now_val;
        NF0.push(name, now_val);
      }
    }
    this.view.BF0(NF0);
  }
};

// operators/filter/index.ts
function get(k, r) {
  for (const seg of k) {
    if (r == null) return void 0;
    r = r[seg];
  }
  return r;
}
function match(actual, expected) {
  if (typeof expected !== "object")
    return actual === expected;
  else
    return Object.entries(expected).every(([k, v]) => match(actual?.[k], v));
}
var FilterValue = class extends RowOperator {
  constructor(p, fn) {
    super();
    this.p = p;
    this.fn = fn;
    this.XU0(this.p.value);
  }
  process(value2, name, old_val) {
    return this.fn(value2, name, old_val) ? value2 : void 0;
  }
};
var FilterObjectValue = class extends FilterValue {
  constructor(p, obj) {
    super(p, (r) => match(r, obj));
  }
};
var FilterStringValue = class extends FilterValue {
  constructor(p, name, value2) {
    super(
      p,
      value2 === void 0 ? (r) => !!r?.[name] : (r) => r?.[name] === value2
    );
  }
};
var FilterColumnValue = class extends FilterValue {
  constructor(p, name, value2) {
    const key = [].concat(name);
    super(
      p,
      value2 === void 0 ? (r) => !!get(key, r) : (r) => get(key, r) === value2
    );
  }
};

// operators/between/index.ts
var BetweenValue = class extends Operator {
  // Dedup helper — two charts brushing the same column with the same bound
  // SOURCE share a single Between sink. The dedup signal is the bound source
  // identity, not its current value: for the reactive single-ViewProxy extent
  // form (the crossfilter `between('delay', filters.delay)` pattern) we compare
  // the underlying View (stable across the fresh wrapper ViewProxy.get mints per
  // access) — the old `this.plo === lo` compared a stored child-proxy wrapper
  // against a freshly-minted one and NEVER matched, so identical calls piled up
  // live operators. Reactive tuple bounds compare each bound's View; plain
  // numeric bounds compare by value.
  matches(col, arg) {
    if (this.col !== col) return false;
    if (arg instanceof ViewProxy) return this._extentView === arg[view];
    if (this._extentView) return false;
    const id = (src, vp) => vp instanceof ViewProxy ? src === vp[view] : src === vp;
    return id(this._loId, arg[0]) && id(this._hiId, arg[1]);
  }
  constructor(p, col, arg) {
    super();
    this.p = p;
    this.col = col;
    this.plo = arg[0];
    this.phi = arg[1];
    this.sorted = [];
    this.find = left((d) => {
      return this.p.value[d][col];
    });
    this.findHi = right((d) => {
      return this.p.value[d][col];
    });
    if (arg instanceof ViewProxy) {
      this._extentView = arg[view];
      arg.connect(this, "extent");
    } else {
      this._loSrc = arg[0] instanceof ViewProxy ? arg[0] : $(arg[0]);
      this._hiSrc = arg[1] instanceof ViewProxy ? arg[1] : $(arg[1]);
      this._loId = arg[0] instanceof ViewProxy ? arg[0][view] : arg[0];
      this._hiId = arg[1] instanceof ViewProxy ? arg[1][view] : arg[1];
      this._loSrc.connect(this, "lo");
      this._hiSrc.connect(this, "hi");
    }
    this.XU0(p.value);
  }
  // Single-bound setters auto-sort so lo always ends up ≤ hi. This is what
  // keeps the resize handles working when the user drags one past the other.
  set lo(v) {
    this.extent = v > this.hi_val ? [this.hi_val, v] : [v, this.hi_val];
  }
  set hi(v) {
    this.extent = v < this.lo_val ? [v, this.lo_val] : [this.lo_val, v];
  }
  // Whole-extent setter — the hot path. Each branch handles one of the
  // common bound transitions:
  //   • full domain (-∞, ∞) → unfiltered, share the source array directly
  //   • collapsed (lo === hi) → empty result
  //   • shrink/expand → walk sorted from the old boundary to the new one and
  //     emit incremental BI0/BR1 events instead of resnapshotting.
  // The `value === p.value` check is the unfilter fast path: when we
  // previously aliased the source we have to fork it before mutating, or our
  // `value[ti] = undefined` writes would hit the user's data.
  set extent([a = -Infinity, b = Infinity]) {
    if (this.sortedDirty) this._resort();
    a = +a;
    b = +b;
    const new_lo = a < b ? a : b;
    const new_hi = a < b ? b : a;
    if (!this.view.value)
      return [this.lo_val, this.hi_val] = [new_lo, new_hi];
    if (new_lo === -Infinity && new_hi === Infinity) {
      this.hi_index = this.lo_index = void 0;
      [this.lo_val, this.hi_val] = [new_lo, new_hi];
      return this.view.XU0(this.view.value = this.p.value);
    }
    if (this.view.value === this.p.value) {
      this.view.value = isArray(this.p.value) ? [...this.p.value] : { ...this.p.value };
    }
    const I0 = [], R1 = [];
    this.lo_index ??= this.find(this.sorted, this.lo_val);
    this.hi_index ??= this.findHi(this.sorted, this.hi_val);
    let ti, tv;
    if (new_hi < this.hi_val) {
      while ((tv = this.p.value[ti = this.sorted[this.hi_index - 1]]) && tv[this.col] > new_hi) {
        this.hi_index--;
        if (this.view.value[ti] !== void 0) {
          R1.push(ti, tv);
          this.view.value[ti] = void 0;
        }
      }
      if (this.lo_index > this.hi_index) this.lo_index = this.hi_index;
    }
    if (new_lo > this.lo_val) {
      while ((tv = this.p.value[ti = this.sorted[this.lo_index]]) && tv[this.col] < new_lo) {
        this.lo_index++;
        if (this.view.value[ti] !== void 0) {
          R1.push(ti, tv);
          this.view.value[ti] = void 0;
        }
      }
      if (this.hi_index < this.lo_index) this.hi_index = this.lo_index;
    }
    if (new_hi > this.hi_val) {
      while ((tv = this.p.value[ti = this.sorted[this.hi_index]]) && tv[this.col] <= new_hi) {
        this.hi_index++;
        if (this.view.value[ti] === void 0) {
          I0.push(ti, tv);
          this.view.value[ti] = tv;
        }
      }
    }
    if (new_lo < this.lo_val) {
      while ((tv = this.p.value[ti = this.sorted[this.lo_index - 1]]) && tv[this.col] >= new_lo) {
        this.lo_index--;
        if (this.view.value[ti] === void 0) {
          I0.push(ti, tv);
          this.view.value[ti] = tv;
        }
      }
    }
    this.lo_val = new_lo;
    this.hi_val = new_hi;
    if (R1.length) this.isArr ? this.view.BH1(R1) : this.view.BR1(R1);
    if (I0.length) this.isArr ? this.view.BF0(I0) : this.view.BI0(I0);
  }
  // Whole-source replacement: rebuild `sorted` and seed `new_value` with
  // rows already inside the bounds. The bound indexes are wiped so the next
  // `extent` setter recomputes them from scratch (cheaper than tracking
  // them through this rebuild).
  XU0(value2) {
    const { col } = this;
    this.lo_index = void 0;
    this.hi_index = void 0;
    if (typeof value2 !== "object") return super.XU0();
    this.isArr = isArray(value2);
    const new_value = this.isArr ? [] : {};
    this.sorted = [];
    iter(value2, (i, v) => {
      if (v === void 0) return;
      this.sorted.push("" + i);
      if (v[col] >= this.lo_val && v[col] <= this.hi_val)
        new_value[i] = value2[i];
    });
    this.sorted.sort((a, b) => {
      const va = value2[a]?.[col];
      const vb = value2[b]?.[col];
      return va > vb ? 1 : va < vb ? -1 : 0;
    });
    if (this.isArr) new_value.length = value2.length;
    super.XU0(new_value);
  }
  // ─── Source-mutation handlers ─────────────────────────────────────────────
  // The bound-walk in `set extent` relies on `sorted` being current and on
  // `lo_index`/`hi_index` matching the bounds. These handlers keep `sorted`
  // synced with source mutations and invalidate the cached indexes — the
  // next bound change recomputes them lazily via the `??=` in `set extent`.
  //
  // Unfilter mode (view.value aliases source) is a fast path: every row is
  // trivially in range, so we don't need to fork or maintain membership —
  // we just relay the upstream verb to our sinks.
  _inRange(v) {
    return v >= this.lo_val && v <= this.hi_val;
  }
  // Membership transition for a single row whose row-value or col-value
  // changed. `name` may or may not currently be in `sorted`/view; we emit
  // BU1/BI0/BR1 based on the before/after membership and mark the sorted
  // index dirty. The dirty flag is honoured the next time `set extent`
  // runs (which is rare relative to BU2 ticks — bounds change on user
  // brush, attribute updates happen on every data tick) so each BU2 stays
  // O(1) instead of paying O(N) splice + indexOf to maintain `sorted`.
  _replaceRow(name, row, newCol) {
    const wasIn = this.view.value[name] !== void 0;
    const isIn = this._inRange(newCol);
    if (wasIn && isIn) {
      this.view.value[name] = row;
      this.view.BU1([name, row]);
    } else if (!wasIn && isIn) {
      this.view.value[name] = row;
      this.isArr ? this.view.BF0([name, row]) : this.view.BI0([name, row]);
    } else if (wasIn && !isIn) {
      const oldVal = this.view.value[name];
      if (this.isArr) {
        this.view.value[name] = void 0;
        this.view.BH1([name, oldVal]);
      } else {
        delete this.view.value[name];
        this.view.BR1([name, oldVal]);
      }
    }
    this.sortedDirty = true;
    this.lo_index = void 0;
    this.hi_index = void 0;
  }
  // Rebuild `sorted` from the current `p.value`. Called lazily by
  // `set extent` when `sortedDirty` is set — amortizes the cost of many
  // BU2/BU1 attribute updates into a single O(N log N) sort that fires
  // only when the user actually brushes new bounds.
  _resort() {
    const v = this.p.value;
    if (!v || typeof v !== "object") return;
    this.sorted = [];
    iter(v, (i, row) => {
      if (row !== void 0) this.sorted.push("" + i);
    });
    const col = this.col;
    this.sorted.sort((a, b) => {
      const va = v[a]?.[col];
      const vb = v[b]?.[col];
      return va > vb ? 1 : va < vb ? -1 : 0;
    });
    this.sortedDirty = false;
  }
  BU1(U1) {
    if (this.view.value === this.p.value) {
      this.sortedDirty = true;
      return this.view.BU1(U1);
    }
    for (let i = 0; i < U1.length; i += 2) {
      const name = U1[i];
      const row = U1[i + 1];
      this._replaceRow(name, row, row?.[this.col]);
    }
  }
  BU2(U2) {
    if (this.view.value === this.p.value) {
      this.sortedDirty = true;
      return this.view.BU2(U2);
    }
    for (let i = 0; i < U2.length; i += 2) {
      const key = U2[i];
      const value2 = U2[i + 1];
      const [name, ...rest] = key;
      if (rest.length && rest[0] === this.col) {
        const row = this.p.value?.[name];
        if (row !== void 0) this._replaceRow(name, row, value2);
      } else if (this.view.value[name] !== void 0) {
        this.view.BU2([key, value2]);
      }
    }
  }
  // Insert/remove DEFER `sorted` maintenance via the same dirty-flag
  // amortization `_replaceRow` (BU2/BU1) already uses. `sorted` is read ONLY by
  // `set extent`, which calls `_resort()` when `sortedDirty` is set — so an
  // insert/remove only needs the membership decision (lo_val/hi_val, not
  // `sorted`) plus the view.value write, then marks `sorted` dirty. A stream of
  // inserts/removes between two brushes is therefore O(1) each (object:
  // dropping the O(N) indexOf+splice; array: dropping the O(N) key-shift loop
  // and the O(N²) batch-remove key-shift recompute) instead of O(N) per row.
  // The next brush pays one O(N log N) `_resort` — the births/deaths workload
  // (object-keyed population, frequent inserts/removes, occasional brush). For
  // arrays the view.value splice that mirrors the source's positional shift is
  // inherent to arrays and remains O(N); only the redundant sorted bookkeeping
  // is shed. (Dropping the old `sortedDirty → coarse XU0` bailout is safe NOW:
  // it had existed to stop the incremental sorted maintenance from
  // double-counting against a stale `sorted`, but it was ALSO load-bearing as a
  // self-heal masking the C8 spurious-BR1 bug in `set extent` — re-emitting a
  // remove for an already-excluded row, which a downstream length/sum/avg sink
  // turned into a negative count. C8 is now fixed at its root [c3130ba], so the
  // heal is no longer needed: insert/remove after an in-place edit emit
  // incremental BI0/BR1 rather than a coarse resnapshot. Guarded by the
  // between→length/sum/avg differential scenarios.)
  BI0(I0) {
    if (this.view.value === this.p.value) {
      this.sortedDirty = true;
      return this.view.BI0(I0);
    }
    const NI0 = [];
    for (let i = 0; i < I0.length; i += 2) {
      const at = I0[i];
      const row = I0[i + 1];
      const inRange = this._inRange(row?.[this.col]);
      if (this.isArr) {
        this.view.value.splice(+at, 0, inRange ? row : void 0);
        NI0.push(at, inRange ? row : void 0);
      } else if (inRange) {
        this.view.value[at] = row;
        NI0.push(at, row);
      }
    }
    this.sortedDirty = true;
    this.lo_index = void 0;
    this.hi_index = void 0;
    if (NI0.length) this.view.BI0(NI0);
  }
  BR1(R1) {
    if (this.view.value === this.p.value) {
      this.sortedDirty = true;
      return this.view.BR1(R1);
    }
    const NR1 = [];
    for (let i = 0; i < R1.length; i += 2) {
      const name = R1[i];
      const oldVal = this.view.value[name];
      if (this.isArr) {
        this.view.value.splice(name, 1);
        NR1.push(name, oldVal);
      } else if (oldVal !== void 0) {
        delete this.view.value[name];
        NR1.push(name, oldVal);
      }
    }
    this.sortedDirty = true;
    this.lo_index = void 0;
    this.hi_index = void 0;
    if (NR1.length) this.view.BR1(NR1);
  }
  // Consumer-side hole/fill: when between sits downstream of another sparse
  // producer (filter/map/between/…), a row entering/leaving the UPSTREAM view
  // arrives as BF0/BH1 (hole fill / hole remove — no array shift). Treat them
  // as membership transitions WITHOUT splicing: the position is stable, only
  // its occupancy changed. Mark `sorted` dirty so the next bound move rebuilds
  // it (skipping holes), and forward BH1/BF0 so our own positional sinks mirror.
  BH1(R1) {
    if (this.view.value === this.p.value) {
      this.sortedDirty = true;
      return this.view.BH1(R1);
    }
    const NR1 = [];
    for (let i = 0; i < R1.length; i += 2) {
      const name = R1[i];
      const oldVal = this.view.value[name];
      if (oldVal !== void 0) {
        this.view.value[name] = void 0;
        NR1.push(name, oldVal);
      }
    }
    this.sortedDirty = true;
    this.lo_index = void 0;
    this.hi_index = void 0;
    if (NR1.length) this.view.BH1(NR1);
  }
  BF0(I0) {
    if (this.view.value === this.p.value) {
      this.sortedDirty = true;
      return this.view.BF0(I0);
    }
    const NF0 = [];
    for (let i = 0; i < I0.length; i += 2) {
      const name = I0[i];
      const row = this.p.value[name];
      if (row !== void 0 && this._inRange(row[this.col])) {
        this.view.value[name] = row;
        NF0.push(name, row);
      }
    }
    this.sortedDirty = true;
    this.lo_index = void 0;
    this.hi_index = void 0;
    if (NF0.length) this.view.BF0(NF0);
  }
  BR2(R2) {
    if (this.view.value === this.p.value) return this.view.BR2(R2);
    for (let i = 0; i < R2.length; i += 2) {
      const key = R2[i];
      const value2 = R2[i + 1];
      const [name] = key;
      if (this.view.value[name] !== void 0) this.view.BR2([key, value2]);
    }
  }
  BI2(I2) {
    if (this.view.value === this.p.value) return this.view.BI2(I2);
    for (let i = 0; i < I2.length; i += 3) {
      const key = I2[i];
      const value2 = I2[i + 1];
      const at = I2[i + 2];
      const [name] = key;
      if (this.view.value[name] !== void 0) this.view.BI2([key, value2, at]);
    }
  }
};

// operators/compare/index.ts
var CompareValue = class extends RowOperator {
  constructor(p, col, val) {
    super();
    this.p = p;
    this.col = col;
    this.val = val;
    this.XU0(this.p.value);
  }
  // Repeated `proxy.gt('col', v)` with identical args returns the cached view.
  matches(col, val) {
    return this.col === col && this.val === val;
  }
  // Subclasses implement `_cmp(x)`. `value?.[col]` short-circuits on missing
  // rows / non-object rows — any such row fails every comparison (matches
  // JS's `undefined > 5 === false`, `undefined >= 5 === false`, etc.).
  process(value2) {
    return this._cmp(value2?.[this.col]) ? value2 : void 0;
  }
};
var GtValue = class extends CompareValue {
  _cmp(x) {
    return x > this.val;
  }
};
var LtValue = class extends CompareValue {
  _cmp(x) {
    return x < this.val;
  }
};
var GteValue = class extends CompareValue {
  _cmp(x) {
    return x >= this.val;
  }
};
var LteValue = class extends CompareValue {
  _cmp(x) {
    return x <= this.val;
  }
};

// operators/sort/index.ts
var ZAValue = class extends Operator {
  // Dedup for the COLUMN forms (za/az('col') and za/az('col', n)). matches()
  // receives the RAW call args, so n must default to Infinity exactly like the
  // ZAColumnValue/AZColumnValue constructor — otherwise `za('col')` (raw n
  // undefined) never matched this.n (Infinity) and every call built a fresh
  // operator. The numeric forms (top(n)/za(n)) take a different arg shape and
  // override this on ZANumberValue/AZNumberValue. (=== not ==: the col_name of
  // the numeric forms is the `value` Symbol, and Symbol == n is always false.)
  matches(col, n = Infinity) {
    return this.col_name === col && this.n === n;
  }
  constructor(p, col, col_name, n) {
    super();
    this.p = p;
    this.n = n;
    this.col = col;
    this.col_name = col_name;
    this.XU0(p.value);
  }
  XR0() {
    this.sorted = [];
    this.view.XU0(this.view.value = []);
  }
  XU0(value2) {
    if (typeof value2 !== "object" || value2 === null) return this.XR0();
    this.isArr = isArray(value2);
    this.sorted = Object.keys(value2).filter((k) => value2[k] !== void 0).sort((a, b) => {
      const va = this.col(value2[a]);
      const vb = this.col(value2[b]);
      const na = va !== va, nb = vb !== vb;
      if (na || nb) return (na ? 1 : 0) - (nb ? 1 : 0);
      return va > vb ? -1 : va < vb ? 1 : 0;
    });
    this.view.XU0(
      this.view.value = this.sorted.slice(0, this.n).map((i) => value2[i])
    );
  }
  // Row removed upstream. Object sources keep stable keys, so we just
  // splice the deleted name out of `sorted` (and refill the visible window
  // from the next-ranked row if the removal was in-window). Array sources
  // require additional shift bookkeeping — see BR1A.
  BR1(R1) {
    if (this.isArr) return this.BR1A(R1);
    if (this.n !== Infinity && R1.length > 2) return this._batchRemove(R1);
    for (let i = 0; i < R1.length; i += 2) {
      const oidx = this.get_index(R1[i]);
      if (oidx === -1) continue;
      this.sorted.splice(oidx, 1);
      if (this.n === Infinity) {
        super.BR1A([oidx]);
        continue;
      }
      if (oidx >= this.n) continue;
      this._window();
    }
  }
  // Drop a batch of keys from `sorted` in one pass, then reconcile the
  // materialized window against the new order with minimal positional deltas.
  // Removal can only shrink or hold the window (never grow it), so the only
  // verbs are tail BR1A (when survivors no longer fill n) and per-slot BU1.
  _batchRemove(R1) {
    const removed = /* @__PURE__ */ new Set();
    for (let i = 0; i < R1.length; i += 2) removed.add("" + R1[i]);
    const sorted = this.sorted;
    let w = 0;
    for (let r = 0; r < sorted.length; r++)
      if (!removed.has(sorted[r])) sorted[w++] = sorted[r];
    sorted.length = w;
    const newLen = this.n < sorted.length ? this.n : sorted.length;
    while (this.view.value.length > newLen) super.BR1A([this.view.value.length - 1]);
    const NU1 = [];
    for (let i = 0; i < newLen; i++) {
      const row = this.p.value[sorted[i]];
      if (this.view.value[i] !== row) {
        this.view.value[i] = row;
        NU1.push("" + i, row);
      }
    }
    if (NU1.length) this.view.BU1(NU1);
  }
  // Array source: each removal at upstream index `name` shifts all later
  // indices down by one. Sorted holds upstream keys (numeric strings); after
  // the source splice, every entry in `sorted` whose key is greater than
  // any removed index needs to decrement to match. We also re-emit an
  // in-window evict per removal that fell inside the visible window, then
  // refill the tail from whatever rows now sit at the boundary.
  BR1A(R1) {
    const inWindow = [];
    const removedKeys = [];
    for (let i = 0; i < R1.length; i += 2) {
      const name = R1[i];
      removedKeys.push(+name);
      const oidx = this.sorted.indexOf("" + name);
      if (oidx === -1) continue;
      this.sorted.splice(oidx, 1);
      if (oidx < this.n) inWindow.push(oidx);
    }
    if (removedKeys.length) {
      removedKeys.sort((a, b) => a - b);
      for (let i = 0; i < this.sorted.length; i++) {
        const k = +this.sorted[i];
        let shift = 0;
        for (const r of removedKeys) {
          if (r < k) shift++;
          else break;
        }
        if (shift) this.sorted[i] = "" + (k - shift);
      }
    }
    if (this.n !== Infinity) {
      if (inWindow.length) this._window();
      return;
    }
    inWindow.sort((a, b) => a - b);
    for (let j = 0; j < inWindow.length; j++) super.BR1A([inWindow[j] - j]);
    const target = this.sorted.length < this.n ? this.sorted.length : this.n;
    while (this.view.value.length < target) {
      const idx = this.view.value.length;
      super.BI0A([idx, this.p.value[this.sorted[idx]]]);
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
  BU1(U1) {
    if (U1.length > 2) return this._batchUpdate(U1);
    for (let i = 0; i < U1.length; i++) {
      const name = U1[i++];
      const value2 = U1[i];
      const { n, p, sorted } = this;
      let oidx = this.get_index(name);
      if (oidx === -1) {
        if (value2 === void 0) continue;
        this.BI0([name, value2]);
        continue;
      }
      sorted.splice(oidx, 1);
      if (value2 === void 0) {
        if (n === Infinity) super.BR1A([oidx]);
        else if (oidx < n) this._window();
        continue;
      }
      let nidx = this.find(this.col(this.p.value[name]));
      sorted.splice(nidx, 0, "" + name);
      if (oidx === nidx) {
        if (oidx < n) {
          this.view.value[oidx] = value2;
          this.view.BU1(["" + oidx, value2]);
        }
        continue;
      }
      if (oidx >= n && nidx >= n) ; else if (oidx >= n !== nidx >= n) {
        this._window();
      } else if (oidx < n && nidx < n) {
        super.BU1(["" + oidx, value2]);
        super.BMV1([oidx, nidx]);
      }
    }
  }
  // New row enters. If its rank is past the window we only need to record
  // it in `sorted`; otherwise, evict the bottom of the visible window (if
  // we're already at capacity) and splice the newcomer into its rank.
  // Array sources additionally require sliding existing keys >= `at` up by
  // one to match the source's post-splice indexing — `push` (at === length)
  // collapses to a no-op shift since nothing needs moving.
  BI0(I0) {
    if (!this.isArr && this.n !== Infinity && I0.length > 2) return this._batchInsert(I0);
    let touched = false;
    for (let i = 0; i < I0.length; i += 2) {
      const at = I0[i];
      const value2 = I0[i + 1];
      if (this.isArr) {
        const atNum = +at;
        for (let j = 0; j < this.sorted.length; j++) {
          const k = +this.sorted[j];
          if (k >= atNum) this.sorted[j] = "" + (k + 1);
        }
      }
      if (value2 === void 0) continue;
      const new_idx = this.find(this.col(this.p.value[at]));
      this.sorted.splice(new_idx, 0, "" + at);
      if (this.n === Infinity) {
        super.BI0A([new_idx, value2]);
        continue;
      }
      if (new_idx < this.n) touched = true;
    }
    if (touched) this._window();
  }
  // Splice a batch of new keys into `sorted` at their ranks, then reconcile the
  // window. Insertion can only grow or hold the window: grow via tail BI0A when
  // it was underfilled, then per-slot BU1 for the rows the inserts pushed down.
  _batchInsert(I0) {
    for (let i = 0; i < I0.length; i += 2) {
      const at = I0[i];
      const nidx = this.find(this.col(this.p.value[at]));
      this.sorted.splice(nidx, 0, "" + at);
    }
    const sorted = this.sorted;
    const newLen = this.n < sorted.length ? this.n : sorted.length;
    while (this.view.value.length < newLen) {
      const i = this.view.value.length;
      super.BI0A([i, this.p.value[sorted[i]]]);
    }
    const NU1 = [];
    for (let i = 0; i < newLen; i++) {
      const row = this.p.value[sorted[i]];
      if (this.view.value[i] !== row) {
        this.view.value[i] = row;
        NU1.push("" + i, row);
      }
    }
    if (NU1.length) this.view.BU1(NU1);
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
  _batchUpdate(U1) {
    for (let i = 0; i < U1.length; i += 2) {
      const oidx = this.get_index(U1[i]);
      if (oidx !== -1) this.sorted.splice(oidx, 1);
    }
    for (let i = 0; i < U1.length; i += 2) {
      const name = "" + U1[i];
      const val = U1[i + 1];
      if (val === void 0) continue;
      const nidx = this.find(this.col(this.p.value[name]));
      this.sorted.splice(nidx, 0, name);
    }
    this._window();
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
  _window() {
    const { sorted, n, p } = this;
    const newLen = n < sorted.length ? n : sorted.length;
    while (this.view.value.length > newLen) super.BR1A([this.view.value.length - 1]);
    while (this.view.value.length < newLen) {
      const i = this.view.value.length;
      super.BI0A([i, p.value[sorted[i]]]);
    }
    const NU1 = [];
    for (let i = 0; i < newLen; i++) {
      const row = p.value[sorted[i]];
      if (this.view.value[i] !== row) {
        this.view.value[i] = row;
        NU1.push("" + i, row);
      }
    }
    if (NU1.length) this.view.BU1(NU1);
  }
  // Nested-key changes (`row.col` mutated). If the change touches the sort
  // column we have to recompute the row's rank — funnel into BU1. Otherwise
  // it's just a deep update on a row that may or may not be visible: only
  // forward the BR2/BU2 if the row is in-window, with the key prefix
  // rewritten from upstream-name to in-window-position.
  BR2(R2) {
    for (let i = 0; i < R2.length; i++) {
      const [name, col, ...rest] = R2[i++];
      const value2 = R2[i];
      if (col === this.col_name) {
        this.BU1([name, this.p.value[name]]);
      } else {
        const oidx = this.get_index(name);
        if (oidx >= 0 && oidx < this.n)
          this.view.BR2([[`${oidx}`, col, ...rest], value2]);
      }
    }
  }
  BU2(U2) {
    for (let i = 0; i < U2.length; i++) {
      const [name, col, ...rest] = U2[i++];
      const value2 = U2[i];
      if (col === this.col_name) {
        this.BU1([name, this.p.value[name]]);
      } else {
        const oidx = this.get_index(name);
        if (oidx >= 0 && oidx < this.n) {
          this.view.BU2([[`${oidx}`, col, ...rest], value2]);
        }
      }
    }
  }
  BI2(I2) {
    for (let i = 0; i < I2.length; i++) {
      const [name, ...rest] = I2[i++];
      const value2 = I2[i++];
      const at = I2[i];
      if (!this.has(name)) {
        this.BI0([name, this.p.value[name]]);
        continue;
      }
      const nidx = this.get_index(name);
      if (nidx >= this.n) continue;
      this.view.BI2([[`${nidx}`, ...rest], value2, at]);
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
  BF0(I0) {
    let touched = false;
    for (let i = 0; i < I0.length; i += 2) {
      const at = I0[i];
      const new_idx = this.find(this.col(this.p.value[at]));
      this.sorted.splice(new_idx, 0, "" + at);
      if (this.n === Infinity) {
        super.BI0A([new_idx, I0[i + 1]]);
        continue;
      }
      if (new_idx < this.n) touched = true;
    }
    if (touched) this._window();
  }
  BH1(R1) {
    let touched = false;
    for (let i = 0; i < R1.length; i += 2) {
      const oidx = this.get_index(R1[i]);
      if (oidx === -1) continue;
      this.sorted.splice(oidx, 1);
      if (this.n === Infinity) {
        super.BR1A([oidx]);
        continue;
      }
      if (oidx < this.n) touched = true;
    }
    if (touched) this._window();
  }
  get_index(id) {
    return this.sorted.indexOf("" + id);
  }
  has(id) {
    return !!~this.get_index(id);
  }
};
ZAValue.prototype.find = bisect_right;
var ZAColumnValue = class extends ZAValue {
  constructor(p, col, n = Infinity) {
    super(p, (d) => d?.[col], col, n);
  }
};
var ZANumberValue = class extends ZAValue {
  // Numeric form: the only arg is `n` (top(n) / za(n)); col is implicitly the
  // whole row. Default to Infinity like the constructor so top(2) dedups with
  // a second top(2) (and with za(2) — the same operation).
  matches(n = Infinity) {
    return this.n === n;
  }
  constructor(p, n = Infinity) {
    super(p, (d) => d, value, n);
  }
};
var AZValue = class extends ZAValue {
  XU0(value2) {
    if (typeof value2 !== "object" || value2 === null) return this.XR0();
    this.isArr = isArray(value2);
    this.sorted = Object.keys(value2).filter((k) => value2[k] !== void 0).sort((a, b) => {
      const va = this.col(value2[a]);
      const vb = this.col(value2[b]);
      const na = va !== va, nb = vb !== vb;
      if (na || nb) return (na ? 1 : 0) - (nb ? 1 : 0);
      return va > vb ? 1 : va < vb ? -1 : 0;
    });
    this.view.XU0(
      this.view.value = this.sorted.slice(0, this.n).map((i) => value2[i])
    );
  }
};
AZValue.prototype.find = bisect_left;
var AZColumnValue = class extends AZValue {
  constructor(p, col, n = Infinity) {
    super(p, (d) => d?.[col], col, n);
  }
};
var AZNumberValue = class extends AZValue {
  matches(n = Infinity) {
    return this.n === n;
  }
  // see ZANumberValue
  constructor(p, n = Infinity) {
    super(p, (d) => d, value, n);
  }
};
var LimitValue = class extends Operator {
  constructor(p, n) {
    super();
    this.p = p;
    this.n = n;
    this.XU0(this.p.value);
  }
  XR0() {
    this.XU0(this.p.value);
  }
  XU0(value2) {
    this.view.value = [];
    this.keys = [];
    this.isArr = isArray(value2);
    if (typeof value2 === "object" && value2 !== null) {
      if (this.isArr) {
        for (let i = 0; i < value2.length; i++) {
          if (value2[i] !== void 0) {
            this.view.value.push(value2[i]);
            this.keys.push(i);
            if (this.view.value.length === this.n) break;
          }
        }
      } else {
        for (const i in value2) {
          if (value2[i] !== void 0) {
            this.view.value.push(value2[i]);
            this.keys.push(i);
            if (this.view.value.length === this.n) break;
          }
        }
      }
    }
    this.last = this.isArr && this.keys.length ? this.keys[this.keys.length - 1] : void 0;
    this.view.XU0(this.view.value);
  }
  findPos(numKey) {
    let lo = 0, hi = this.keys.length;
    while (lo < hi) {
      const mid = lo + hi >>> 1;
      const m = this.keys[mid];
      if (m < numKey) lo = mid + 1;
      else if (m > numKey) hi = mid;
      else return mid;
    }
    return -1;
  }
  insertPos(numKey) {
    let lo = 0, hi = this.keys.length;
    while (lo < hi) {
      const mid = lo + hi >>> 1;
      if (this.keys[mid] < numKey) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  nextAfter(numKey) {
    const src = this.p.value;
    if (!src) return void 0;
    for (let i = numKey + 1; i < src.length; i++) {
      if (src[i] !== void 0) return i;
    }
    return void 0;
  }
  // Object-source refill helper: first key in p.value's iteration order
  // that isn't already in the window and has a defined value. Bounded by
  // `n + (source size)` per call, but typically returns on the first hit
  // past the window — fine for small to moderate sources.
  nextObjectKey() {
    const src = this.p.value;
    if (!src) return void 0;
    for (const k in src) {
      if (src[k] === void 0) continue;
      if (this.keys.indexOf(k) !== -1) continue;
      return k;
    }
    return void 0;
  }
  BU1(U1) {
    if (this.isArr) {
      const NU12 = [];
      for (let i = 0; i < U1.length; i++) {
        const key = U1[i++];
        const val = U1[i];
        const pos = this.findPos(+key);
        if (pos === -1) continue;
        if (val === void 0) {
          this.keys.splice(pos, 1);
          super.BR1A([pos]);
          const next = this.nextAfter(this.last ?? -1);
          if (next !== void 0) {
            this.keys.push(next);
            this.last = next;
            super.BI0A([this.view.value.length, this.p.value[next]]);
          } else {
            this.last = this.keys.length ? this.keys[this.keys.length - 1] : void 0;
          }
          continue;
        }
        this.view.value[pos] = val;
        NU12.push("" + pos, val);
      }
      if (NU12.length) this.view.BU1(NU12);
      return;
    }
    const NU1 = [];
    for (let i = 0; i < U1.length; i += 2) {
      const key = "" + U1[i];
      const val = U1[i + 1];
      const pos = this.keys.indexOf(key);
      if (pos !== -1) {
        if (val === void 0) {
          this.keys.splice(pos, 1);
          super.BR1A([pos]);
          const next = this.nextObjectKey();
          if (next !== void 0) {
            this.keys.push(next);
            super.BI0A([this.view.value.length, this.p.value[next]]);
          }
        } else {
          this.view.value[pos] = val;
          NU1.push("" + pos, val);
        }
      } else if (val !== void 0 && this.keys.length < this.n) {
        this.keys.push(key);
        super.BI0A([this.view.value.length, val]);
      }
    }
    if (NU1.length) this.view.BU1(NU1);
  }
  BR1(R1) {
    if (this.isArr) {
      if (R1.length > this.n * 2) {
        this.XU0(this.p.value);
        return;
      }
      for (let i = 0; i < R1.length; i += 2) {
        const numKey = +R1[i];
        const pos = this.findPos(numKey);
        if (pos === -1) continue;
        this.keys.splice(pos, 1);
        super.BR1A([pos]);
        const next = this.nextAfter(this.last ?? -1);
        if (next !== void 0) {
          this.keys.push(next);
          this.last = next;
          super.BI0A([this.view.value.length, this.p.value[next]]);
        } else {
          this.last = this.keys.length ? this.keys[this.keys.length - 1] : void 0;
        }
      }
      return;
    }
    if (R1.length > this.n * 2) {
      this.XU0(this.p.value);
      return;
    }
    for (let i = 0; i < R1.length; i += 2) {
      const pos = this.keys.indexOf("" + R1[i]);
      if (pos === -1) continue;
      this.keys.splice(pos, 1);
      super.BR1A([pos]);
    }
    this._refillObject();
  }
  // Refill the window up to `n` in a single iteration pass over the source,
  // skipping holes and keys already in the window (O(1) Set membership). Used
  // after a batch of object-source removals instead of nextObjectKey()'s
  // per-leave full re-scan. Preserves the same result (first keys in iteration
  // order not already in the window).
  _refillObject() {
    if (this.keys.length >= this.n) return;
    const inWindow = new Set(this.keys);
    const src = this.p.value;
    for (const k in src) {
      if (this.keys.length >= this.n) break;
      if (src[k] === void 0 || inWindow.has(k)) continue;
      this.keys.push(k);
      inWindow.add(k);
      super.BI0A([this.view.value.length, src[k]]);
    }
  }
  BI0(I0) {
    if (this.isArr) {
      if (I0.length > this.n * 2) {
        this.XU0(this.p.value);
        return;
      }
      for (let i = 0; i < I0.length; i += 2) {
        const numKey = +I0[i];
        const val = I0[i + 1];
        if (this.findPos(numKey) !== -1) continue;
        if (this.keys.length < this.n) {
          const pos = this.insertPos(numKey);
          this.keys.splice(pos, 0, numKey);
          if (this.last === void 0 || numKey > this.last) this.last = numKey;
          super.BI0A([pos, val]);
        } else if (numKey < this.last) {
          const pos = this.insertPos(numKey);
          this.keys.pop();
          super.BR1A([this.n - 1]);
          this.keys.splice(pos, 0, numKey);
          this.last = this.keys[this.keys.length - 1];
          super.BI0A([pos, val]);
        }
      }
      return;
    }
    for (let i = 0; i < I0.length; i += 2) {
      const key = "" + I0[i];
      const val = I0[i + 1];
      if (val === void 0) continue;
      if (this.keys.indexOf(key) !== -1) continue;
      if (this.keys.length < this.n) {
        this.keys.push(key);
        super.BI0A([this.view.value.length, val]);
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
  BR1A() {
    this.XU0(this.p.value);
  }
  BI0A() {
    this.XU0(this.p.value);
  }
  BMV1() {
    this.XU0(this.p.value);
  }
  BR2() {
  }
  BU2() {
  }
  BI2() {
  }
};

// operators/to/index.ts
var ToValue = class extends Operator {
  constructor(p, fn) {
    super();
    this.p = p;
    this.fn = fn;
    this.XU0(this.p.value);
  }
  XU0(value2) {
    const new_value = this.fn(value2, this.view.value);
    if (new_value === this.view.value) return;
    this.view.XU0(this.view.value = new_value);
  }
  XR0() {
    this.XU0(this.p.value);
  }
  BR1() {
    this.XU0(this.p.value);
  }
  BU1() {
    this.XU0(this.p.value);
  }
  BI0() {
    this.XU0(this.p.value);
  }
  BR2() {
    this.XU0(this.p.value);
  }
  BU2() {
    this.XU0(this.p.value);
  }
  BI2() {
    this.XU0(this.p.value);
  }
};

// operators/map/index.ts
var MapValue = class extends RowOperator {
  constructor(p, fn) {
    super();
    this.p = p;
    this.fn = fn;
    this.XU0(this.p.value);
  }
  process(value2, name, old_val) {
    return this.fn(value2, name, old_val);
  }
};

// operators/group/index.ts
var GroupValue = class extends Operator {
  constructor(p, fn) {
    super();
    this.p = p;
    this.fn = fn;
    this.XU0(this.p.value);
  }
  XR0() {
    this.posMap = /* @__PURE__ */ new Map();
    this.view.XU0(this.view.value = {});
  }
  XU0(value2) {
    this.isArr = isArray(value2);
    this.posMap = /* @__PURE__ */ new Map();
    const new_value = {};
    if (this.isArr) {
      for (let i = 0; i < value2.length; i++) {
        const v = value2[i];
        if (v === void 0) continue;
        const g = this.fn(v);
        const bucket = new_value[g] ??= [];
        this.posMap.set(i, { group: g, idx: bucket.length });
        bucket.push(v);
      }
    } else {
      iter(value2, (i, v) => {
        if (v === void 0) return;
        const g = this.fn(v);
        (new_value[g] ??= {})[i] = v;
        this.posMap.set(i, g);
      });
    }
    this.view.XU0(this.view.value = new_value);
  }
  // ─── Object-source paths ──────────────────────────────────────────────────
  // For each removed name we drop the row from its bucket and stash the old
  // value in `leaving` so we can choose later whether to emit BR1 (bucket
  // emptied — group disappears) or BR2 (bucket non-empty — only this row left).
  // Routed to BR1A when the source is an array because position-shift
  // semantics differ.
  BR1(R1) {
    if (this.isArr) return this.BR1A(R1);
    const leaving = /* @__PURE__ */ new Map();
    for (let i = 0; i < R1.length; i++) {
      const name = R1[i++];
      if (!this.posMap.has(name)) continue;
      const group = this.posMap.get(name);
      this.posMap.delete(name);
      const bucket = this.view.value[group];
      if (bucket !== void 0 && name in bucket) {
        let leavers = leaving.get(group);
        if (!leavers) leaving.set(group, leavers = {});
        leavers[name] = bucket[name];
        delete bucket[name];
      }
    }
    this._emitObjectLeavers(leaving);
  }
  // BU1 has to handle two shapes of update: in-group (just refresh the value
  // under the existing bucket) and cross-group (remove from old bucket,
  // insert into new). The latter may also empty the old bucket entirely, in
  // which case we collapse the per-row BR2 events into a single BR1 for the
  // disappearing group — that's why we accumulate `leaving` and post-process.
  BU1(U1) {
    if (this.isArr) return this.BU1A(U1);
    const NU2 = [];
    const NI2 = [];
    const leaving = /* @__PURE__ */ new Map();
    for (let i = 0; i < U1.length; i++) {
      const name = U1[i++];
      const value2 = U1[i];
      const tracked = this.posMap.has(name);
      if (value2 === void 0) {
        if (tracked) {
          const old_group2 = this.posMap.get(name);
          this.posMap.delete(name);
          const oldVal = this.view.value[old_group2]?.[name];
          if (oldVal !== void 0) {
            let leavers = leaving.get(old_group2);
            if (!leavers) leaving.set(old_group2, leavers = {});
            leavers[name] = oldVal;
            delete this.view.value[old_group2][name];
          }
        }
        continue;
      }
      const old_group = this.posMap.get(name);
      const new_group = this.fn(value2);
      if (tracked && old_group === new_group) {
        NU2.push([new_group, name], this.view.value[new_group][name] = value2);
      } else {
        if (tracked) {
          const oldVal = this.view.value[old_group]?.[name];
          if (oldVal !== void 0) {
            let leavers = leaving.get(old_group);
            if (!leavers) leaving.set(old_group, leavers = {});
            leavers[name] = oldVal;
            delete this.view.value[old_group][name];
          }
        }
        this.view.value[new_group] ??= {};
        NI2.push([new_group], this.view.value[new_group][name] = value2, name);
        this.posMap.set(name, new_group);
      }
    }
    const NR1 = [];
    const NR2 = [];
    for (const [group, leavers] of leaving) {
      if (isEmpty(this.view.value[group])) {
        NR1.push(group, leavers);
        delete this.view.value[group];
      } else {
        for (const name in leavers) {
          NR2.push([group, name], leavers[name]);
        }
      }
    }
    if (NR1.length) this.view.BR1(NR1);
    if (NR2.length) this.view.BR2(NR2);
    if (NU2.length) this.view.BU2(NU2);
    if (NI2.length) this.view.BI2(NI2);
  }
  BI0(I0) {
    if (this.isArr) return this.BI0A(I0);
    const NI2 = [];
    for (let i = 0; i < I0.length; i++) {
      const name = I0[i++];
      const value2 = I0[i];
      const new_group = this.fn(value2);
      this.view.value[new_group] ??= {};
      NI2.push([new_group], this.view.value[new_group][name] = value2, name);
      this.posMap.set(name, new_group);
    }
    if (NI2.length) this.view.BI2(NI2);
  }
  _emitObjectLeavers(leaving) {
    const NR1 = [];
    const NR2 = [];
    for (const [group, leavers] of leaving) {
      if (isEmpty(this.view.value[group])) {
        NR1.push(group, leavers);
        delete this.view.value[group];
      } else {
        for (const name in leavers) {
          NR2.push([group, name], leavers[name]);
        }
      }
    }
    if (NR1.length) this.view.BR1(NR1);
    if (NR2.length) this.view.BR2(NR2);
  }
  // ─── Array-source paths ───────────────────────────────────────────────────
  // Consumer-side hole/fill from an upstream sparse producer (between/…) over an
  // array: a row left/entered the upstream view WITHOUT a position shift. The
  // positional bucket bookkeeping (posMap idx, suffix shifts) assumes splices,
  // so a hole event can't be threaded through it cleanly — rebuild instead
  // (XU0 already skips the upstream's holes). Rare (array-source between→group),
  // so the O(N) rebuild is acceptable.
  BH1() {
    this.XU0(this.p.value);
  }
  BF0() {
    this.XU0(this.p.value);
  }
  BR1A(R1) {
    const leaving = /* @__PURE__ */ new Map();
    const removed = [];
    for (let i = 0; i < R1.length; i++) {
      const pos = +R1[i++];
      const info = this.posMap.get(pos);
      if (!info) {
        removed.push(pos);
        continue;
      }
      const { group, idx } = info;
      this.posMap.delete(pos);
      removed.push(pos);
      const bucket = this.view.value[group];
      const removedVal = bucket.splice(idx, 1)[0];
      let leavers = leaving.get(group);
      if (!leavers) leaving.set(group, leavers = []);
      leavers.push(idx, removedVal);
      for (const sibling of this.posMap.values()) {
        if (sibling.group === group && sibling.idx > idx) sibling.idx--;
      }
    }
    if (removed.length) {
      removed.sort((a, b) => a - b);
      const next = /* @__PURE__ */ new Map();
      for (const [k, v] of this.posMap) {
        let shift = 0;
        for (const r of removed) {
          if (r < k) shift++;
          else break;
        }
        next.set(k - shift, v);
      }
      this.posMap = next;
    }
    const NR1 = [];
    const NR2 = [];
    for (const [group, leavers] of leaving) {
      const bucket = this.view.value[group];
      if (bucket.length === 0) {
        const cleared = [];
        for (let j = 1; j < leavers.length; j += 2) cleared.push(leavers[j]);
        NR1.push(group, cleared);
        delete this.view.value[group];
      } else {
        for (let j = 0; j < leavers.length; j += 2) {
          NR2.push([group, leavers[j]], leavers[j + 1]);
        }
      }
    }
    if (NR1.length) this.view.BR1(NR1);
    if (NR2.length) this.view.BR2(NR2);
  }
  BI0A(I0) {
    const NI2 = [];
    for (let i = 0; i < I0.length; i++) {
      const pos = +I0[i++];
      const value2 = I0[i];
      const next = /* @__PURE__ */ new Map();
      for (const [k, v] of this.posMap) next.set(k >= pos ? k + 1 : k, v);
      this.posMap = next;
      if (value2 === void 0) continue;
      const new_group = this.fn(value2);
      const bucket = this.view.value[new_group] ??= [];
      const idx = this._insertIdx(new_group, pos);
      bucket.splice(idx, 0, value2);
      for (const sibling of this.posMap.values()) {
        if (sibling.group === new_group && sibling.idx >= idx) sibling.idx++;
      }
      this.posMap.set(pos, { group: new_group, idx });
      NI2.push([new_group], value2, idx);
    }
    if (NI2.length) this.view.BI2(NI2);
  }
  BU1A(U1) {
    const NU2 = [];
    const NI2 = [];
    const leaving = /* @__PURE__ */ new Map();
    for (let i = 0; i < U1.length; i++) {
      const pos = +U1[i++];
      const value2 = U1[i];
      const info = this.posMap.get(pos);
      if (value2 === void 0) {
        if (info !== void 0) {
          const oldBucket = this.view.value[info.group];
          if (oldBucket !== void 0) {
            const oldVal = oldBucket[info.idx];
            oldBucket.splice(info.idx, 1);
            for (const sibling of this.posMap.values()) {
              if (sibling.group === info.group && sibling.idx > info.idx) sibling.idx--;
            }
            let leavers = leaving.get(info.group);
            if (!leavers) leaving.set(info.group, leavers = []);
            leavers.push(info.idx, oldVal);
          }
          this.posMap.delete(pos);
        }
        continue;
      }
      const old_group = info?.group;
      const new_group = this.fn(value2);
      if (old_group === new_group && info !== void 0) {
        this.view.value[new_group][info.idx] = value2;
        NU2.push([new_group, info.idx], value2);
      } else {
        if (info !== void 0) {
          const oldBucket = this.view.value[old_group];
          if (oldBucket !== void 0) {
            const oldVal = oldBucket[info.idx];
            oldBucket.splice(info.idx, 1);
            for (const sibling of this.posMap.values()) {
              if (sibling.group === old_group && sibling.idx > info.idx) sibling.idx--;
            }
            let leavers = leaving.get(old_group);
            if (!leavers) leaving.set(old_group, leavers = []);
            leavers.push(info.idx, oldVal);
          }
        }
        const newBucket = this.view.value[new_group] ??= [];
        const newIdx = this._insertIdx(new_group, pos);
        newBucket.splice(newIdx, 0, value2);
        for (const sibling of this.posMap.values()) {
          if (sibling.group === new_group && sibling.idx >= newIdx && this.posMap.get(pos) !== sibling) sibling.idx++;
        }
        this.posMap.set(pos, { group: new_group, idx: newIdx });
        NI2.push([new_group], value2, newIdx);
      }
    }
    const NR1 = [];
    const NR2 = [];
    for (const [group, leavers] of leaving) {
      const bucket = this.view.value[group];
      if (bucket.length === 0) {
        const cleared = [];
        for (let j = 1; j < leavers.length; j += 2) cleared.push(leavers[j]);
        NR1.push(group, cleared);
        delete this.view.value[group];
      } else {
        for (let j = 0; j < leavers.length; j += 2) {
          NR2.push([group, leavers[j]], leavers[j + 1]);
        }
      }
    }
    if (NR1.length) this.view.BR1(NR1);
    if (NR2.length) this.view.BR2(NR2);
    if (NU2.length) this.view.BU2(NU2);
    if (NI2.length) this.view.BI2(NI2);
  }
  // Find the bucket index for a row whose upstream position is `pos`, by
  // counting siblings in the same group that come before it. O(posMap.size)
  // per insert — fine because group only sees the small upstream batches
  // that LimitValue forwards, never a full source.
  _insertIdx(group, pos) {
    let idx = 0;
    for (const [otherPos, other] of this.posMap) {
      if (other.group === group && otherPos < pos) idx++;
    }
    return idx;
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
      for (let i = 0; i < U2.length; i += 2) {
        const name = U2[i][0];
        const row = this.p.value[name];
        if (row !== void 0 && this.fn(row) !== this.posMap.get(+name)?.group)
          return this.XU0(this.p.value);
      }
      return;
    }
    const NU2 = [];
    const NI2 = [];
    const leaving = /* @__PURE__ */ new Map();
    const moved = /* @__PURE__ */ new Set();
    for (let i = 0; i < U2.length; i++) {
      const path = U2[i++];
      const value2 = U2[i];
      const name = path[0];
      if (moved.has(name)) continue;
      const row = this.p.value[name];
      const tracked = this.posMap.has(name);
      const old_group = this.posMap.get(name);
      const new_group = this.fn(row);
      if (tracked && old_group === new_group) {
        if (this.view.value[new_group]) this.view.value[new_group][name] = row;
        NU2.push([new_group, ...path], value2);
      } else {
        moved.add(name);
        if (tracked) {
          const oldVal = this.view.value[old_group]?.[name];
          if (oldVal !== void 0) {
            let leavers = leaving.get(old_group);
            if (!leavers) leaving.set(old_group, leavers = {});
            leavers[name] = oldVal;
            delete this.view.value[old_group][name];
          }
        }
        this.view.value[new_group] ??= {};
        NI2.push([new_group], this.view.value[new_group][name] = row, name);
        this.posMap.set(name, new_group);
      }
    }
    const NR1 = [];
    const NR2 = [];
    for (const [group, leavers] of leaving) {
      if (isEmpty(this.view.value[group])) {
        NR1.push(group, leavers);
        delete this.view.value[group];
      } else {
        for (const name in leavers) NR2.push([group, name], leavers[name]);
      }
    }
    if (NR1.length) this.view.BR1(NR1);
    if (NR2.length) this.view.BR2(NR2);
    if (NU2.length) this.view.BU2(NU2);
    if (NI2.length) this.view.BI2(NI2);
  }
  BR2() {
  }
  BI2() {
  }
};

// operators/length/index.ts
var LengthValue = class extends Operator {
  constructor(p) {
    super();
    this.p = p;
    this.view.value = 0;
    this.XU0(p.value);
  }
  XR0() {
    this.view.XU0(this.view.value = 0);
  }
  XU0(value2) {
    this.view.value = 0;
    iter(value2, (_, v) => {
      if (v !== void 0) this.view.value++;
    });
    this.view.XU0(this.view.value);
  }
  BR1(R1) {
    if (!R1.length) return;
    let n = 0;
    for (let i = 1; i < R1.length; i += 2) if (R1[i] !== void 0) n++;
    if (n) this.view.XU0(this.view.value -= n);
  }
  // A BU1 pair carrying `undefined` is a LEAVE (`src.k = undefined` — core's
  // upsert split routes a previously-DEFINED key set to undefined here, not to
  // BR1). Decrement once per such pair; a defined new value is a genuine update
  // of a still-counted row (no count change). Was a blanket no-op, so the count
  // went permanently stale on assignment-to-undefined.
  BU1(U1) {
    if (!U1.length) return;
    let n = 0;
    for (let i = 1; i < U1.length; i += 2) if (U1[i] === void 0) n++;
    if (n) this.view.XU0(this.view.value -= n);
  }
  BI0(I0) {
    if (!I0.length) return;
    let n = 0;
    for (let i = 1; i < I0.length; i += 2) if (I0[i] !== void 0) n++;
    if (n) this.view.XU0(this.view.value += n);
  }
  BR2() {
  }
  BU2() {
  }
  BI2() {
  }
};
var LengthFnValue = class extends Operator {
  constructor(p, fn) {
    super();
    this.p = p;
    this.fn = fn;
    this.XU0(this.p.value);
  }
  XR0() {
    this.mapping = {};
    this.view.XU0(this.view.value = {});
  }
  XU0(value2) {
    const new_value = {};
    this.mapping = {};
    this.isArr = isArray(value2);
    iter(value2, (i, v) => {
      if (v === void 0) return;
      (this.mapping[i] = new_value[this.fn(v)] ??= { value: 0 }).value++;
    });
    this.view.XU0(this.view.value = new_value);
  }
  BR1(R1) {
    if (!R1.length) return;
    if (this.isArr) return this.XU0(this.p.value);
    const { mapping } = this;
    let changed = false;
    for (let i = 0; i < R1.length; i++) {
      const n = R1[i++];
      const m = mapping[n];
      if (!m) continue;
      m.value--;
      mapping[n] = void 0;
      changed = true;
    }
    if (changed) this.view.XU0(this.view.value);
  }
  BU1(U1) {
    if (!U1.length) return;
    const { mapping, view: view2, fn } = this;
    let changed = false;
    for (let i = 0; i < U1.length; i++) {
      const n = U1[i++];
      const v = U1[i];
      const og = mapping[n];
      if (v === void 0) {
        if (og) {
          og.value--;
          mapping[n] = void 0;
          changed = true;
        }
        continue;
      }
      const ng = view2.value[fn(v)] ??= { value: 0 };
      if (og !== ng) {
        mapping[n] = ng;
        if (og) og.value--;
        ng.value++;
        changed = true;
      }
    }
    if (changed) this.view.XU0(this.view.value);
  }
  BI0(I0) {
    if (!I0.length) return;
    if (this.isArr) return this.XU0(this.p.value);
    const { mapping, view: view2, fn } = this;
    let changed = false;
    for (let i = 0; i < I0.length; i++) {
      const n = I0[i++];
      const v = I0[i];
      if (v === void 0) continue;
      (mapping[n] = view2.value[fn(v)] ??= { value: 0 }).value++;
      changed = true;
    }
    if (changed) this.view.XU0(this.view.value);
  }
  // In-place field mutation (e.g. `data[id].status = 'x'`). The framework
  // delivers this as a BU2 carrying the changed path, not the whole row, so we
  // re-read the current row from `p.value` and recompute its bucket key. If the
  // key moved, decrement the old bucket and increment the new one — exactly the
  // BU1 rebucket, just sourced by path. A no-op key change (a different field
  // changed, or the same bucket) republishes nothing, so subscribers only wake
  // on an actual count change. Without this, `length(fn)` was blind to in-place
  // mutations — a histogram over a source that mutates rows (rather than only
  // inserting/removing them) silently froze at its construction-time buckets.
  BU2(U2) {
    if (!U2.length) return;
    const { mapping, view: view2, fn, p } = this;
    let moved = false;
    for (let i = 0; i < U2.length; i += 2) {
      const n = U2[i][0];
      const v = p.value[n];
      if (v === void 0) continue;
      const og = mapping[n];
      const ng = view2.value[fn(v)] ??= { value: 0 };
      if (og !== ng) {
        mapping[n] = ng;
        if (og) og.value--;
        ng.value++;
        moved = true;
      }
    }
    if (moved) this.view.XU0(this.view.value);
  }
  // NB: no BH1/BF0 — a sparse producer's membership flip falls back to BR1/BI0,
  // which rebuilds over an array source. Incremental BH1/BF0 here desynced the
  // same way the aggregate one did (see ISSUES.md P7); the rebuild is correct.
  BR2() {
  }
  BI2() {
  }
};

// operators/intersect/index.ts
var isDims = (v) => v != null && typeof v === "object" && !v[reactive] && !isArray(v);
var IntersectValue = class extends Operator {
  constructor(p, ...args) {
    super();
    this._args = args;
    let sources;
    if (args.length === 1 && isDims(args[0])) {
      sources = Object.values(args[0]);
    } else if (args.length === 2 && isDims(args[0]) && typeof args[1] === "string") {
      const [dims, except] = args;
      sources = Object.entries(dims).filter(([k]) => k !== except).map(([, v]) => v);
    } else {
      sources = args;
    }
    this.vp = sources[0];
    this.p = p;
    this.sources = /* @__PURE__ */ new Map([[p, { one: 1, off: -2 }]]);
    this.all = 1;
    for (const src of sources) {
      const v = src[view];
      if (this.sources.has(v)) continue;
      const one = 1 << this.sources.size;
      src.connect(this);
      this.sources.set(v, { one, off: ~one });
      this.all |= one;
    }
    if (typeof p.value !== "object") {
      super.XU0();
      return;
    }
    const new_value = isArray(this.p.value) ? [] : {};
    this.filters = isArray(this.p.value) ? [] : {};
    iter(p.value, (i, v) => {
      for (const [res, src] of this.sources) {
        if (res.value[i] !== void 0) this.filters[i] |= src.one;
      }
      if (this.filters[i] === this.all) new_value[i] = v;
    });
    this.view.XU0(this.view.value = new_value);
  }
  // ── Array structural insert / remove (C12) ───────────────────────────────
  // Core routes an ARRAY source's positional insert/remove through BI0A/BR1A
  // (object sources keep the BI0/BR1 _enter/_leave path above, untouched). A
  // splice shifts every later index, so the per-index `filters` bitmask and the
  // sparse `view.value` MUST splice in lockstep or our index space drifts from
  // the (shifting) sources and every later positional event hits the wrong slot
  // — the C12 array desync. The object _leave/_enter path's `delete`/named-set
  // never shifts, which is correct for stable object keys but wrong for array
  // positions.
  // STRUCTURAL REMOVE. `this.p` is the canonical index space ("`this.p.value[name]`
  // stays the canonical row identity"). Only a removal from the PRIMARY shifts
  // that space, so only the primary echo splices `filters`/`view.value`. A
  // removal reported by a SECONDARY source is a membership change at a stable
  // position — the row left THAT source but the primary's index space didn't
  // move — so it routes to the by-name `_leave` (clear the bit, hole the slot if
  // it drops below `all`), exactly the object path. This split is what keeps two
  // INDEPENDENT arrays' intersect correct (only one shifts) while a DERIVED
  // crossfilter-style removal (every source echoes; the primary splices last —
  // see below) reconciles to one clean delete.
  //
  // Echo order in the DERIVED case: the secondaries hole their slot first
  // (emitting the real remove), then the primary splices the now-holed slot out
  // (oldVal === undefined → no phantom second remove) and the survivor below it
  // slides up. (`union`/`except` have their own primary ordering — handled in
  // their files.)
  BR1A(R1, v) {
    if (v !== this.p) return this._leave(R1, v, true);
    const NR1 = [];
    for (let i = 0; i < R1.length; i += 2) {
      const at = R1[i];
      const oldVal = this.view.value[at];
      this.filters.splice(at, 1);
      this.view.value.splice(at, 1);
      NR1.push(at, oldVal);
    }
    if (NR1.length) this.view.BR1(NR1);
  }
  // STRUCTURAL INSERT (tail). Each source self-reports ITS membership bit for the
  // new position from the carried value: a real row sets the bit, a hole
  // (`undefined` — the positional insert an array RowOperator emits for a slot
  // its predicate excluded) CLEARS it. The bug this fixes (C12 intersect2) was
  // the object _enter path setting the bit unconditionally for that hole. Bits
  // accumulate across echoes order-independently (we never read other sources —
  // mid-cascade they may not have shifted); the new tail slot grows `filters`
  // and `view.value` naturally. Mid-array inserts into an array set-algebra
  // source are not supported (not shipped-reachable: the underlying mutation is
  // always a tail append or a delete).
  BI0A(I0, v) {
    const { one, off } = this.sources.get(v);
    const NI0 = [];
    const pendingShift = this.p.value.length > this.filters.length;
    for (let i = 0; i < I0.length; i += 2) {
      const at = I0[i];
      const ix = +at;
      const val = I0[i + 1];
      if (pendingShift && ix < this.filters.length) {
        if (v !== this.p) continue;
        let bits2 = 0;
        for (const [src_view, { one: src_one }] of this.sources)
          if (src_view.value?.[ix] !== void 0) bits2 |= src_one;
        this.filters.splice(ix, 0, bits2);
        this.view.value.splice(ix, 0, bits2 === this.all ? this.p.value[ix] : void 0);
        NI0.push(at, this.view.value[ix]);
        continue;
      }
      const bits = this.filters[at] || 0;
      this.filters[at] = val !== void 0 ? bits | one : bits & off;
      if (this.filters[at] === this.all && this.view.value[at] === void 0) {
        NI0.push(at, this.view.value[at] = this.p.value[at]);
      }
    }
    if (this.view.value.length < this.filters.length) this.view.value.length = this.filters.length;
    if (NI0.length) this.view.BI0(NI0);
  }
  // One source emptied: clear its bit on every tracked row. We never look
  // at the primary source for row identity here, just iterate the bitmask
  // table. The view itself collapses to empty because at least one source
  // now has nothing — no row can satisfy `bits === all`.
  XR0(_, v) {
    const { off } = this.sources.get(v);
    iter(this.filters, (i, b) => {
      if (b !== void 0) this.filters[i] = b & off;
    });
    this.view.XU0(this.view.value = isArray(this.view.value) ? [] : {});
  }
  XU0(value2, v) {
    const { one, off } = this.sources.get(v);
    this.view.value ??= isArray(this.p.value) ? [] : {};
    if (typeof value2 !== "object") return super.XU0();
    this.filters ??= isArray(this.p.value) ? [] : {};
    const new_value = isArray(this.p.value) ? [] : {};
    iter(this.filters, (i, b) => {
      if (b !== void 0) this.filters[i] = b & off;
    });
    iter(value2, (i, val) => {
      if (val === void 0) return;
      let bits = this.filters[i];
      if (bits === void 0) {
        bits = 0;
        for (const [src_view, { one: src_one }] of this.sources) {
          if (src_one !== one && src_view.value?.[i] !== void 0) bits |= src_one;
        }
      }
      bits |= one;
      this.filters[i] = bits;
      if (bits === this.all) new_value[i] = this.p.value[i];
    });
    this.view.XU0(this.view.value = new_value);
  }
  // One row left one source. If clearing this source's bit drops the row
  // below "all bits set" (and it was at "all" before — i.e. visible), emit a
  // BR1. The `(bits & off) === zero` check tests "after clearing, only this
  // source's bit was set" which is equivalent to "the row was previously at
  // all-bits-set"; `zero` is precomputed once per call.
  BR1(R1, v) {
    this._leave(R1, v, false);
  }
  // BH1 (consumer): an upstream sparse producer (between/filter over an ARRAY)
  // holed a row in source v — positional-stable, no shift. Same membership
  // logic as BR1; emits BH1 downstream (a hole, not a splice) so a positional
  // sink (the DOMSink bound straight to this view) mirrors the hole instead of
  // popping its tail. Without this, core falls the upstream BH1 back to BR1,
  // which over an array routes to BR1A (splice-shift) and corrupts an
  // index-keyed sink. Mirrors between's consumer BH1.
  BH1(R1, v) {
    this._leave(R1, v, true);
  }
  _leave(R1, v, hole) {
    if (!R1.length) return;
    const { off } = this.sources.get(v);
    const NR1 = [];
    const zero = this.all & off;
    this.view.value ??= isArray(this.p.value) ? [] : {};
    for (let i = 0; i < R1.length; i += 2) {
      const name = R1[i];
      const bits = this.filters[name];
      if (bits === void 0) continue;
      if ((bits & off) === zero) {
        NR1.push(name, this.view.value[name]);
        this.view.value[name] = void 0;
      }
      this.filters[name] = bits & off;
    }
    if (NR1.length) hole && isArray(this.view.value) ? this.view.BH1(NR1) : this.view.BR1(NR1);
  }
  BU1(U1) {
    if (!U1.length) return;
    const { all, filters } = this;
    const NU1 = [];
    for (let i = 0; i < U1.length; i++) {
      const name = U1[i++];
      if (filters[name] === all) {
        const value2 = this.p.value[name];
        if (value2 === this.view.value[name]) continue;
        this.view.value[name] = value2;
        NU1.push(name, value2);
      }
    }
    if (NU1.length) this.view.BU1(NU1);
  }
  BI0(I0, v) {
    this._enter(I0, v, false);
  }
  // BF0 (consumer): an upstream sparse producer filled a hole in source v —
  // positional-stable. Same membership logic as BI0; emits BF0 downstream so a
  // positional sink fills the slot in place rather than tail-appending. Mirrors
  // between's consumer BF0. (The "first time seen" bitmask-init branch is inert
  // here — a hole-fill is for a row that was already tracked.)
  BF0(I0, v) {
    this._enter(I0, v, true);
  }
  _enter(I0, v, hole) {
    if (!I0.length) return;
    const { all, sources, filters } = this;
    const { one } = sources.get(v);
    const me = this.view.value ??= isArray(this.p.value) ? [] : {};
    const NI0 = [];
    for (let i = 0; i < I0.length; i++) {
      const name = I0[i++];
      let bits = filters[name];
      if (bits === void 0) {
        bits = 0;
        for (const [src_view, { one: src_one }] of sources) {
          if (src_one !== one && src_view.value?.[name] !== void 0) bits |= src_one;
        }
      }
      bits |= one;
      filters[name] = bits;
      if (bits === all && me[name] === void 0) {
        NI0.push(name, me[name] = this.p.value[name]);
      }
    }
    if (NI0.length) hole && isArray(this.view.value) ? this.view.BF0(NI0) : this.view.BI0(NI0);
  }
  // Nested-key events (deep updates on rows). Two gates:
  //   1. The event must come from `this.p` (the primary source). A
  //      secondary source's nested change to row[name] doesn't affect what
  //      intersect emits for that row — downstream sees `this.p.value[name]`,
  //      not the secondary's data — so dropping is the right answer.
  //   2. The row must be in the intersection (`filters[name] === all`).
  //      Otherwise the row isn't visible downstream and we'd be leaking
  //      events for excluded rows.
  // Previously these methods were misnamed `R2`/`U2`/`I2` — never called
  // by the framework (which dispatches `BR2`/`BU2`/`BI2`) — so deep updates
  // on excluded rows fell through to Operator's default forwarder and leaked
  // downstream silently.
  BR2(R2, v) {
    if (v !== this.p || !R2.length) return;
    const NR2 = [];
    for (let i = 0; i < R2.length; i += 2) {
      const path = R2[i];
      if (this.filters[path[0]] === this.all) NR2.push(path, R2[i + 1]);
    }
    if (NR2.length) this.view.BR2(NR2);
  }
  BU2(U2, v) {
    if (v !== this.p || !U2.length) return;
    const NU2 = [];
    for (let i = 0; i < U2.length; i += 2) {
      const path = U2[i];
      if (this.filters[path[0]] === this.all) NU2.push(path, U2[i + 1]);
    }
    if (NU2.length) this.view.BU2(NU2);
  }
  BI2(I2, v) {
    if (v !== this.p || !I2.length) return;
    const NI2 = [];
    for (let i = 0; i < I2.length; i += 3) {
      const path = I2[i];
      if (this.filters[path[0]] === this.all) NI2.push(path, I2[i + 1], I2[i + 2]);
    }
    if (NI2.length) this.view.BI2(NI2);
  }
  // Identity-based dedup over the original args. Used by createOperator and
  // ViewProxy.apply to reuse an existing intersect view when the same call
  // shape is repeated. Crossfilter benefit: each chart in a dashboard calls
  // `flights.intersect(dims, 'thisChart')` on every render and gets the
  // same operator view back, so the bitmask state is shared.
  matches(...args) {
    if (args.length !== this._args.length) return false;
    for (let i = 0; i < args.length; i++) if (args[i] !== this._args[i]) return false;
    return true;
  }
};

// operators/aggregate/index.ts
var AggregateValue = class extends Operator {
  // `col` is the dedup key (string column name, fn reference, etc.). `read`
  // is the per-row projector, defaulting to row[col] when col is a string,
  // identity when col is undefined; subclasses with a custom projection
  // (some/every — `r => !!fn(r)`) pass an explicit read function.
  constructor(p, col, read) {
    super();
    this.p = p;
    this.col = col;
    this.read = read || (typeof col === "string" ? ((r) => r?.[col]) : ((r) => r));
    this.tracked = /* @__PURE__ */ new Map();
    this.XU0(p.value);
  }
  matches(col) {
    return this.col === col;
  }
  _project(v) {
    if (v === void 0) return void 0;
    const x = this.read(v);
    return x === void 0 || x === null ? void 0 : x;
  }
  XR0() {
    this.tracked.clear();
    this._afterReset();
  }
  XU0(value2) {
    this.tracked.clear();
    if (value2 && typeof value2 === "object") {
      iter(value2, (n, v) => {
        const x = this._project(v);
        if (x !== void 0) this.tracked.set("" + n, x);
      });
    }
    this._afterReset();
  }
  BU1(U1) {
    if (!U1.length) return;
    let dirty = false;
    for (let i = 0; i < U1.length; i += 2) {
      const n = "" + U1[i];
      const old = this.tracked.get(n);
      const x = this._project(U1[i + 1]);
      if (x === void 0) this.tracked.delete(n);
      else this.tracked.set(n, x);
      if (x !== old) {
        this._delta(old, x, n);
        dirty = true;
      }
    }
    if (dirty) this._publish();
  }
  BR1(R1) {
    if (!R1.length) return;
    if (isArray(this.p.value)) return this.XU0(this.p.value);
    let dirty = false;
    for (let i = 0; i < R1.length; i += 2) {
      const n = "" + R1[i];
      const old = this.tracked.get(n);
      if (old === void 0) continue;
      this.tracked.delete(n);
      this._delta(old, void 0, n);
      dirty = true;
    }
    if (dirty) this._publish();
  }
  BI0(I0) {
    if (!I0.length) return;
    if (isArray(this.p.value)) return this.XU0(this.p.value);
    let dirty = false;
    for (let i = 0; i < I0.length; i += 2) {
      const n = "" + I0[i];
      const x = this._project(I0[i + 1]);
      if (x === void 0) continue;
      this.tracked.set(n, x);
      this._delta(void 0, x, n);
      dirty = true;
    }
    if (dirty) this._publish();
  }
  // NB: AggregateValue deliberately does NOT implement BH1/BF0. A sparse
  // producer's length-stable membership flip therefore falls back to BR1/BI0,
  // which over an array source REBUILDS (the position-keyed `tracked` can't be
  // trusted incremental against between's hole-flip emission — an incremental
  // BH1/BF0 here desynced the running total on a brush, see ISSUES.md P7). The
  // rebuild is O(N) per flip but correct; the shipped crossfilter brush is
  // rAF-coalesced so it pays it at most once per frame.
  // Nested-key changes: re-project the affected row from p.value, then run
  // the same delta/publish pipe. Saves the subclass from caring about depth.
  BU2(U2) {
    this._reprojectFromKeys(U2, 2);
  }
  BR2(R2) {
    this._reprojectFromKeys(R2, 2);
  }
  BI2(I2) {
    this._reprojectFromKeys(I2, 3);
  }
  _reprojectFromKeys(arr, stride) {
    if (!arr.length) return;
    let dirty = false;
    for (let i = 0; i < arr.length; i += stride) {
      const path = arr[i];
      const n = "" + path[0];
      const old = this.tracked.get(n);
      const x = this._project(this.p.value[n]);
      if (x === void 0) this.tracked.delete(n);
      else this.tracked.set(n, x);
      if (x !== old) {
        this._delta(old, x, n);
        dirty = true;
      }
    }
    if (dirty) this._publish();
  }
  _afterReset() {
  }
  _delta() {
  }
  _publish() {
  }
};
var SumValue = class extends AggregateValue {
  // Note: `total` is intentionally not a class field — class fields
  // initialize *after* super() returns, which would overwrite the value
  // computed by _afterReset during construction.
  _afterReset() {
    this.total = 0;
    for (const v of this.tracked.values()) this.total += +v;
    this._publish();
  }
  _delta(o, n) {
    if (o !== void 0) this.total -= +o;
    if (n !== void 0) this.total += +n;
  }
  _publish() {
    if (this.total !== this.view.value) this.view.XU0(this.view.value = this.total);
  }
};
var AvgValue = class extends AggregateValue {
  _afterReset() {
    this.total = 0;
    this.count = 0;
    for (const v of this.tracked.values()) {
      this.total += +v;
      this.count++;
    }
    this._publish();
  }
  _delta(o, n) {
    if (o !== void 0) {
      this.total -= +o;
      this.count--;
    }
    if (n !== void 0) {
      this.total += +n;
      this.count++;
    }
  }
  _publish() {
    const v = this.count === 0 ? void 0 : this.total / this.count;
    if (v !== this.view.value) this.view.XU0(this.view.value = v);
  }
};
var FastNumericAggregate = class extends AggregateValue {
  _afterReset() {
    this._buildFast();
    this._publish();
  }
  _buildFast() {
    this.numericMode = true;
    this.slotMap = /* @__PURE__ */ new Map();
    this.freeSlots = [];
    this.nextSlot = 0;
    let cap = 64;
    while (cap < this.tracked.size) cap *= 2;
    this.fast = new Float64Array(cap);
    for (const [k, v] of this.tracked) {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        this._abandonFast();
        return;
      }
      const slot = this.nextSlot++;
      this.fast[slot] = v;
      this.slotMap.set(k, slot);
    }
  }
  _abandonFast() {
    this.numericMode = false;
    this.fast = null;
    this.slotMap = null;
    this.freeSlots = null;
    this.nextSlot = 0;
  }
  _delta(_old, x, key) {
    if (!this.numericMode) return;
    if (x !== void 0 && (typeof x !== "number" || !Number.isFinite(x))) {
      this._abandonFast();
      return;
    }
    if (x === void 0) {
      const slot2 = this.slotMap.get(key);
      if (slot2 === void 0) return;
      this.slotMap.delete(key);
      this.fast[slot2] = this._sentinel;
      this.freeSlots.push(slot2);
      return;
    }
    let slot = this.slotMap.get(key);
    if (slot === void 0) {
      slot = this.freeSlots.length ? this.freeSlots.pop() : this.nextSlot++;
      if (slot >= this.fast.length) {
        let cap = this.fast.length;
        while (cap < slot + 1) cap *= 2;
        const next = new Float64Array(cap);
        next.set(this.fast);
        this.fast = next;
      }
      this.slotMap.set(key, slot);
    }
    this.fast[slot] = x;
  }
};
var MaxValue = class extends FastNumericAggregate {
  get _sentinel() {
    return -Infinity;
  }
  _publish() {
    if (this.tracked.size === 0) {
      if (this.view.value !== void 0) this.view.XU0(this.view.value = void 0);
      return;
    }
    let m;
    if (this.numericMode) {
      const arr = this.fast;
      m = arr[0];
      for (let i = 1; i < this.nextSlot; i++) {
        const v = arr[i];
        if (v > m) m = v;
      }
    } else {
      for (const v of this.tracked.values()) if (m === void 0 || v > m) m = v;
    }
    if (m !== this.view.value) this.view.XU0(this.view.value = m);
  }
};
var MinValue = class extends FastNumericAggregate {
  get _sentinel() {
    return Infinity;
  }
  _publish() {
    if (this.tracked.size === 0) {
      if (this.view.value !== void 0) this.view.XU0(this.view.value = void 0);
      return;
    }
    let m;
    if (this.numericMode) {
      const arr = this.fast;
      m = arr[0];
      for (let i = 1; i < this.nextSlot; i++) {
        const v = arr[i];
        if (v < m) m = v;
      }
    } else {
      for (const v of this.tracked.values()) if (m === void 0 || v < m) m = v;
    }
    if (m !== this.view.value) this.view.XU0(this.view.value = m);
  }
};
var SomeValue = class extends AggregateValue {
  constructor(p, fn) {
    super(p, fn, (r) => !!fn(r));
  }
  _afterReset() {
    this.trueCount = 0;
    for (const v of this.tracked.values()) if (v) this.trueCount++;
    this._publish();
  }
  _delta(o, n) {
    if (o === true) this.trueCount--;
    if (n === true) this.trueCount++;
  }
  _publish() {
    const v = this.trueCount > 0;
    if (v !== this.view.value) this.view.XU0(this.view.value = v);
  }
};
var EveryValue = class extends AggregateValue {
  constructor(p, fn) {
    super(p, fn, (r) => !!fn(r));
  }
  _afterReset() {
    this.totalCount = 0;
    this.trueCount = 0;
    for (const v of this.tracked.values()) {
      this.totalCount++;
      if (v) this.trueCount++;
    }
    this._publish();
  }
  _delta(o, n) {
    if (o !== void 0) {
      this.totalCount--;
      if (o === true) this.trueCount--;
    }
    if (n !== void 0) {
      this.totalCount++;
      if (n === true) this.trueCount++;
    }
  }
  _publish() {
    const v = this.trueCount === this.totalCount;
    if (v !== this.view.value) this.view.XU0(this.view.value = v);
  }
};

// operators/tap/index.ts
function tapHasParam(fn) {
  if (typeof fn !== "function") return false;
  if (fn.length > 0) return true;
  const s = Function.prototype.toString.call(fn);
  if (/^\s*(?:async\s+)?[A-Za-z_$][\w$]*\s*=>/.test(s)) return true;
  const m = s.match(/\(([^)]*)\)/);
  return !!(m && m[1].trim() !== "");
}
var sclone2 = (d) => structuredClone(d);
var TapValue = class extends Operator {
  constructor(p, fn) {
    super();
    this.p = p;
    this.fn = fn;
    this.XU0(p.value);
  }
  XU0(value2) {
    super.XU0(value2);
    this.fn({ type: "update", key: [], value: sclone2(value2) });
  }
  XR0() {
    if (this.view.value === void 0) return false;
    const value2 = this.view.value;
    super.XR0();
    this.fn({ type: "remove", key: [], value: sclone2(value2) });
  }
  BU1(U1) {
    this.view.BU1(U1);
    for (let i = 0; i < U1.length; i += 2)
      this.fn({ type: "update", key: [U1[i]], value: sclone2(U1[i + 1]) });
  }
  BR1(R1) {
    for (let i = 0; i < R1.length; i += 2)
      this.fn({ type: "remove", key: [R1[i]], value: sclone2(R1[i + 1]) });
    this.view.BR1(R1);
  }
  BI0(I0) {
    this.view.BI0(I0);
    for (let i = 0; i < I0.length; i += 2)
      this.fn({ type: "insert", key: [], value: sclone2(I0[i + 1]), at: I0[i] });
  }
  BU2(U2) {
    this.view.BU2(U2);
    for (let i = 0; i < U2.length; i += 2)
      this.fn({ type: "update", key: U2[i], value: sclone2(U2[i + 1]) });
  }
  BR2(R2) {
    for (let i = 0; i < R2.length; i += 2)
      this.fn({ type: "remove", key: R2[i], value: sclone2(R2[i + 1]) });
    this.view.BR2(R2);
  }
  BI2(I2) {
    this.view.BI2(I2);
    for (let i = 0; i < I2.length; i += 3)
      this.fn({ type: "insert", key: I2[i], value: sclone2(I2[i + 1]), at: I2[i + 2] });
  }
  // Move events: in-window rank rotations from sort/za/limit. The
  // `connect(obj, fn)` sink (FunctionSink) reports these as
  // `{ type: 'move', from, to }`; tap mirrors the convention so consumers
  // see the same vocabulary regardless of which sink they use.
  BMV1(M1) {
    this.view.BMV1(M1);
    for (let i = 0; i < M1.length; i += 2)
      this.fn({ type: "move", from: +M1[i], to: +M1[i + 1] });
  }
};
var TapBareValue = class extends Operator {
  constructor(p, fn) {
    super();
    this.p = p;
    this.fn = fn;
    this.XU0(p.value);
  }
  XU0(value2) {
    super.XU0(value2);
    this.fn();
  }
  XR0() {
    if (this.view.value === void 0) return false;
    super.XR0();
    this.fn();
  }
  BU1(U1) {
    this.view.BU1(U1);
    this.fn();
  }
  BR1(R1) {
    this.view.BR1(R1);
    this.fn();
  }
  BI0(I0) {
    this.view.BI0(I0);
    this.fn();
  }
  BU2(U2) {
    this.view.BU2(U2);
    this.fn();
  }
  BR2(R2) {
    this.view.BR2(R2);
    this.fn();
  }
  BI2(I2) {
    this.view.BI2(I2);
    this.fn();
  }
  BMV1(M1) {
    this.view.BMV1(M1);
    this.fn();
  }
};

// operators/distinct/index.ts
var REBUILD = /* @__PURE__ */ Symbol("distinct.rebuild");
var DistinctValue = class extends Operator {
  constructor(p, fn) {
    super();
    this.p = p;
    this.fn = fn || identity;
    this._reset();
    this._rebuild();
  }
  matches(fn) {
    return this.fn === (fn || identity);
  }
  _reset() {
    this.counts = /* @__PURE__ */ new Map();
    this.firstRow = /* @__PURE__ */ new Map();
    this.namesProj = /* @__PURE__ */ new Map();
    this.output = [];
  }
  _rebuild() {
    this._reset();
    const v = this.p.value;
    const { fn, counts, firstRow, namesProj, output } = this;
    if (v && typeof v === "object") {
      iter(v, (name, row) => {
        if (row === void 0) return;
        const k = fn(row);
        const c = counts.get(k);
        if (c === void 0) {
          counts.set(k, 1);
          firstRow.set(k, row);
          output.push(row);
        } else {
          counts.set(k, c + 1);
        }
        namesProj.set(name, k);
      });
    }
    this.view.value = output;
    this.view.XU0(output);
  }
  // Single-row insert at a fresh name. Either bumps an existing bucket's
  // count or admits a new projection to the output.
  _insert(name, row) {
    if (row === void 0) return false;
    const k = this.fn(row);
    const c = this.counts.get(k);
    let changed = false;
    if (c === void 0) {
      this.counts.set(k, 1);
      this.firstRow.set(k, row);
      this.output.push(row);
      changed = true;
    } else {
      this.counts.set(k, c + 1);
    }
    this.namesProj.set(name, k);
    return changed;
  }
  // Single-row update at a known name. Returns true if the output array
  // changed shape (bucket added or removed). Order-shift case (the removed
  // bucket's row appeared earlier than a still-present row that now becomes
  // the first instance of some OTHER bucket) doesn't happen for BU2 — the
  // row at `name` stays at `name`, just with a new projection.
  _update(name, row) {
    if (row === void 0) return false;
    const newK = this.fn(row);
    const oldK = this.namesProj.get(name);
    if (oldK === newK) return false;
    let changed = false;
    if (oldK !== void 0) {
      const c2 = this.counts.get(oldK) - 1;
      if (c2 === 0) {
        this.counts.delete(oldK);
        const oldFirst = this.firstRow.get(oldK);
        this.firstRow.delete(oldK);
        const idx = this.output.indexOf(oldFirst);
        if (idx >= 0) this.output.splice(idx, 1);
        changed = true;
      } else {
        if (this.firstRow.get(oldK) === row) return REBUILD;
        this.counts.set(oldK, c2);
      }
    }
    const c = this.counts.get(newK);
    if (c === void 0) {
      this.counts.set(newK, 1);
      this.firstRow.set(newK, row);
      this.output.push(row);
      changed = true;
    } else {
      this.counts.set(newK, c + 1);
    }
    this.namesProj.set(name, newK);
    return changed;
  }
  BI0(I0) {
    if (!I0.length) return;
    if (isArray(this.p.value)) return this._rebuild();
    let changed = false;
    for (let i = 0; i < I0.length; i += 2) {
      if (this._insert(I0[i], I0[i + 1])) changed = true;
    }
    if (changed) this.view.XU0(this.view.value = this.output);
  }
  BU2(U2) {
    if (!U2.length) return;
    const v = this.p.value;
    if (isArray(v)) return this._rebuild();
    let changed = false;
    for (let i = 0; i < U2.length; i += 2) {
      const path = U2[i];
      const name = path[0];
      const r = this._update(name, v?.[name]);
      if (r === REBUILD) return this._rebuild();
      if (r) changed = true;
    }
    if (changed) this.view.XU0(this.view.value = this.output);
  }
  XR0() {
    this._rebuild();
  }
  XU0() {
    this._rebuild();
  }
  BU1() {
    this._rebuild();
  }
  BR1() {
    this._rebuild();
  }
  BR2() {
    this._rebuild();
  }
  BI2() {
    this._rebuild();
  }
};

// operators/reduce/index.ts
var _approxEqual = (a, b) => a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
var _deepEqual = (a, b) => {
  if (a === b) return true;
  const ta = typeof a;
  if (ta !== typeof b) return false;
  if (ta === "number") return _approxEqual(a, b) || Number.isNaN(a) && Number.isNaN(b);
  if (a && b && ta === "object") {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (let i = 0; i < ka.length; i++) {
      const k = ka[i];
      if (!Object.prototype.hasOwnProperty.call(b, k) || !_deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
};
var ReduceValue = class extends Operator {
  constructor(p, fn, init) {
    super();
    this.p = p;
    this.fn = fn;
    this.init = init;
    this._rebuild();
  }
  matches(fn, init) {
    return this.fn === fn && this.init === init;
  }
  _rebuild() {
    let acc = this.init && typeof this.init === "object" ? structuredClone(this.init) : this.init;
    const v = this.p.value;
    if (v && typeof v === "object") {
      iter(v, (k, row) => {
        if (row === void 0) return;
        acc = this.fn(acc, row, k);
      });
    }
    if (acc !== this.view.value) this.view.XU0(this.view.value = acc);
  }
  XR0() {
    this._rebuild();
  }
  XU0() {
    this._rebuild();
  }
  BU1() {
    this._rebuild();
  }
  BR1() {
    this._rebuild();
  }
  BI0() {
    this._rebuild();
  }
  BU2() {
    this._rebuild();
  }
  BR2() {
    this._rebuild();
  }
  BI2() {
    this._rebuild();
  }
};
var ReduceIncrementalValue = class extends Operator {
  constructor(p, add, remove, init) {
    super();
    this.p = p;
    this.add = add;
    this.remove = remove;
    this.init = init;
    this._cache = /* @__PURE__ */ new Map();
    this._rebuild();
  }
  matches(add, remove, init) {
    return this.add === add && this.remove === remove && this.init === init;
  }
  _seed() {
    return typeof this.init === "function" ? this.init() : this.init;
  }
  // Dev-only symmetry check (see the class comment): re-fold from scratch and
  // compare to the incremental accumulator. A mismatch means `remove` didn't
  // invert `add` for some row. Gated behind `$.debug` because the re-fold is
  // O(N) per delta — it exists to make the silent-desync trap catchable.
  _verify(where) {
    if (!$.debug) return;
    let truth = this._seed();
    const v = this.p.value;
    if (v && typeof v === "object") iter(v, (k, row) => {
      if (row === void 0) return;
      truth = this.add(truth, row, k);
    });
    if (!_deepEqual(truth, this.view.value) && typeof console !== "undefined")
      console.warn(
        `[data] reduce(add, remove, init): the incremental accumulator drifted from a fresh fold after ${where}. The usual cause is a \`remove\` that doesn't exactly invert \`add\` for a row (the symmetry contract).`,
        "\n  incremental =",
        this.view.value,
        "\n  fresh fold  =",
        truth
      );
  }
  _rebuild() {
    let acc = this._seed();
    this._cache.clear();
    const v = this.p.value;
    if (v && typeof v === "object") {
      iter(v, (k, row) => {
        if (row === void 0) return;
        acc = this.add(acc, row, k);
        this._cache.set("" + k, row);
      });
    }
    this.view.XU0(this.view.value = acc);
  }
  XR0() {
    this._rebuild();
  }
  XU0() {
    this._rebuild();
  }
  BI0(I0) {
    if (!I0.length) return;
    if (isArray(this.p.value)) return this._rebuild();
    let acc = this.view.value;
    for (let i = 0; i < I0.length; i += 2) {
      const v = I0[i + 1];
      if (v === void 0) continue;
      acc = this.add(acc, v, I0[i]);
      this._cache.set("" + I0[i], v);
    }
    this.view.XU0(this.view.value = acc);
    this._verify("BI0");
  }
  BR1(R1) {
    if (!R1.length) return;
    if (isArray(this.p.value)) return this._rebuild();
    let acc = this.view.value;
    for (let i = 0; i < R1.length; i += 2) {
      const v = R1[i + 1];
      if (v === void 0) continue;
      acc = this.remove(acc, v, R1[i]);
      this._cache.delete("" + R1[i]);
    }
    this.view.XU0(this.view.value = acc);
    this._verify("BR1");
  }
  // BU1: a slot was overwritten in place (`data[k] = newRow`). The
  // notification carries only the new value, but the per-key cache holds the
  // OLD row (a whole-slot overwrite changes the reference, so cached ≠ new),
  // so subtract its contribution then add the new one — O(Δ), no rebuild.
  // Value.BU1 routes brand-new keys to BI0, so BU1 only ever sees keys that
  // were already present; the cache hit is guaranteed for any row that
  // contributed (a fresh fold + every BI0 seeds it). The `!== undefined`
  // guard is against the *cache miss*, so a present-but-falsy row (value `0`)
  // is still correctly subtracted.
  BU1(U1) {
    if (!U1.length) return;
    let acc = this.view.value;
    for (let i = 0; i < U1.length; i += 2) {
      const key = "" + U1[i];
      const next = U1[i + 1];
      const prev = this._cache.get(key);
      if (prev !== void 0) acc = this.remove(acc, prev, U1[i]);
      if (next !== void 0) {
        acc = this.add(acc, next, U1[i]);
        this._cache.set(key, next);
      } else this._cache.delete(key);
    }
    this.view.XU0(this.view.value = acc);
    this._verify("BU1");
  }
  // BU2: a NESTED field of an existing row was edited in place
  // (`data[k].f = x`). The row reference is unchanged, so the cache already
  // holds the mutated row — there's no pre-edit value to subtract. Rebuild
  // (which also re-seeds the cache, keeping BU1 consistent afterwards).
  BU2() {
    this._rebuild();
  }
  BR2() {
    this._rebuild();
  }
  BI2() {
    this._rebuild();
  }
};

// operators/union/index.ts
var UnionValue = class extends Operator {
  constructor(p, ...sources) {
    super();
    this.p = p;
    this.sources = /* @__PURE__ */ new Map([[p, { one: 1, off: -2 }]]);
    this.allSources = [p];
    for (const src of sources) {
      const one = 1 << this.sources.size;
      src.connect(this);
      this.sources.set(src[view], { one, off: ~one });
      this.allSources.push(src[view]);
    }
    if (typeof p.value !== "object") {
      super.XU0();
      return;
    }
    const new_value = isArray(p.value) ? [] : {};
    this.filters = isArray(p.value) ? [] : {};
    for (const src of this.allSources) {
      iter(src.value, (i, v) => {
        if (v === void 0) return;
        this.filters[i] |= this.sources.get(src).one;
      });
    }
    iter(this.filters, (i, b) => {
      if (b !== void 0 && b !== 0) {
        new_value[i] = this._pick(i);
      }
    });
    this.view.XU0(this.view.value = new_value);
  }
  // Resolve a row's value: scan sources in argument order, take the first
  // that has the row defined.
  _pick(name) {
    for (const src of this.allSources) {
      const v = src.value?.[name];
      if (v !== void 0) return v;
    }
    return void 0;
  }
  XR0(_, v) {
    const { off } = this.sources.get(v);
    const { all_off } = this;
    iter(this.filters, (i, b) => {
      if (b !== void 0) this.filters[i] = b & off;
    });
    const new_value = isArray(this.view.value) ? [] : {};
    iter(this.filters, (i, b) => {
      if (b !== void 0 && b !== 0) new_value[i] = this._pick(i);
    });
    this.view.XU0(this.view.value = new_value);
  }
  XU0(value2, v) {
    const { one, off } = this.sources.get(v);
    if (typeof value2 !== "object") return super.XU0();
    this.filters ??= isArray(this.p.value) ? [] : {};
    iter(this.filters, (i, b) => {
      if (b !== void 0) this.filters[i] = b & off;
    });
    iter(value2, (i, val) => {
      if (val === void 0) return;
      this.filters[i] = (this.filters[i] || 0) | one;
    });
    const new_value = isArray(this.p.value) ? [] : {};
    iter(this.filters, (i, b) => {
      if (b !== void 0 && b !== 0) new_value[i] = this._pick(i);
    });
    this.view.XU0(this.view.value = new_value);
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
    if (v !== this.p) return;
    const NR1 = [];
    for (let i = 0; i < R1.length; i += 2) {
      const at = R1[i];
      const oldVal = this.view.value[at];
      this.filters.splice(at, 1);
      this.view.value.splice(at, 1);
      NR1.push(at, oldVal);
    }
    if (NR1.length) this.view.BR1(NR1);
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
    const { one, off } = this.sources.get(v);
    const higher = one - 1;
    const me = this.view.value;
    const NI0 = [], NU1 = [];
    const pendingShift = this.p.value.length > this.filters.length;
    for (let i = 0; i < I0.length; i += 2) {
      const at = I0[i];
      const ix = +at;
      const val = I0[i + 1];
      if (pendingShift && ix < this.filters.length && v === this.p) {
        this.filters.splice(ix, 0, 0);
        me.splice(ix, 0, void 0);
      }
      const prev = this.filters[at] || 0;
      const bits = this.filters[at] = val !== void 0 ? prev | one : prev & off;
      if (bits === 0 || val === void 0 || bits & higher) continue;
      if (me[at] === void 0) {
        me[at] = val;
        NI0.push(at, val);
      } else if (me[at] !== val) {
        me[at] = val;
        NU1.push(at, val);
      }
    }
    if (me.length < this.filters.length) me.length = this.filters.length;
    if (NI0.length) this.view.BI0(NI0);
    if (NU1.length) this.view.BU1(NU1);
  }
  // BR1 from any source: clear that source's bit. If bits hit zero, the row
  // leaves the union. If still nonzero, the row stays — but its value may
  // need re-picking (the source we just lost might have been the source we
  // were getting the value from).
  BR1(R1, v) {
    this._leave(R1, v, false);
  }
  // BH1 (consumer): an upstream sparse producer (between/filter over an ARRAY)
  // holed a row in source v — positional-stable, no shift. Same logic as BR1;
  // emits BH1 for the rows that leave the union so a positional sink (a DOMSink
  // bound straight to this view) mirrors the hole instead of splice-shifting.
  // Mirrors between/intersect's consumer BH1.
  BH1(R1, v) {
    this._leave(R1, v, true);
  }
  _leave(R1, v, hole) {
    if (!R1.length) return;
    const { off } = this.sources.get(v);
    const NR1 = [];
    const NU1 = [];
    this.view.value ??= isArray(this.p.value) ? [] : {};
    for (let i = 0; i < R1.length; i += 2) {
      const name = R1[i];
      const bits = this.filters[name];
      if (bits === void 0) continue;
      const newBits = bits & off;
      this.filters[name] = newBits;
      if (newBits === 0) {
        NR1.push(name, this.view.value[name]);
        delete this.view.value[name];
      } else {
        const newVal = this._pick(name);
        this.view.value[name] = newVal;
        NU1.push(name, newVal);
      }
    }
    if (NU1.length) this.view.BU1(NU1);
    if (NR1.length) hole && isArray(this.view.value) ? this.view.BH1(NR1) : this.view.BR1(NR1);
  }
  BU1(U1, v) {
    if (!U1.length) return;
    const NU1 = [];
    for (let i = 0; i < U1.length; i += 2) {
      const name = U1[i];
      if (!this.filters[name]) continue;
      const newVal = this._pick(name);
      this.view.value[name] = newVal;
      NU1.push(name, newVal);
    }
    if (NU1.length) this.view.BU1(NU1);
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
    for (const src of this.allSources) if (src.value?.[name] !== void 0) return src;
    return void 0;
  }
  BU2(U2, v) {
    if (!U2.length) return;
    const N = [];
    for (let i = 0; i < U2.length; i += 2)
      if (this._displaySrc(U2[i][0]) === v) N.push(U2[i], U2[i + 1]);
    if (N.length) this.view.BU2(N);
  }
  BR2(R2, v) {
    if (!R2.length) return;
    const N = [];
    for (let i = 0; i < R2.length; i += 2)
      if (this._displaySrc(R2[i][0]) === v) N.push(R2[i], R2[i + 1]);
    if (N.length) this.view.BR2(N);
  }
  BI2(I2, v) {
    if (!I2.length) return;
    const N = [];
    for (let i = 0; i < I2.length; i += 3)
      if (this._displaySrc(I2[i][0]) === v) N.push(I2[i], I2[i + 1], I2[i + 2]);
    if (N.length) this.view.BI2(N);
  }
  BI0(I0, v) {
    this._enter(I0, v, false);
  }
  // BF0 (consumer): an upstream sparse producer filled a hole in source v —
  // positional-stable. Same logic as BI0; emits BF0 for rows that enter the
  // union so a positional sink fills in place rather than tail-appending.
  BF0(I0, v) {
    this._enter(I0, v, true);
  }
  _enter(I0, v, hole) {
    if (!I0.length) return;
    const { one } = this.sources.get(v);
    const me = this.view.value ??= isArray(this.p.value) ? [] : {};
    const NI0 = [];
    const NU1 = [];
    for (let i = 0; i < I0.length; i += 2) {
      const name = I0[i];
      const prev = this.filters[name] || 0;
      const newBits = prev | one;
      this.filters[name] = newBits;
      const newVal = this._pick(name);
      if (prev === 0) {
        me[name] = newVal;
        NI0.push(name, newVal);
      } else {
        me[name] = newVal;
        NU1.push(name, newVal);
      }
    }
    if (NI0.length) hole && isArray(this.view.value) ? this.view.BF0(NI0) : this.view.BI0(NI0);
    if (NU1.length) this.view.BU1(NU1);
  }
};

// operators/except/index.ts
var ExceptValue = class extends Operator {
  constructor(p, other) {
    super();
    this.p = p;
    this.otherView = other[view];
    this.otherView.connect(this);
    if (typeof p.value !== "object") {
      super.XU0();
      return;
    }
    const new_value = isArray(p.value) ? [] : {};
    iter(p.value, (i, v) => {
      if (v === void 0) return;
      if (this.otherView.value?.[i] === void 0) new_value[i] = v;
    });
    if (isArray(p.value)) new_value.length = p.value.length;
    this.view.XU0(this.view.value = new_value);
  }
  // Source XU0 (the primary swapped wholesale): rebuild from scratch,
  // filtering out keys that `other` has.
  XU0(value2, v) {
    if (v === this.otherView) {
      return this._rebuild();
    }
    if (typeof value2 !== "object") return super.XU0();
    const new_value = isArray(value2) ? [] : {};
    iter(value2, (i, val) => {
      if (val === void 0) return;
      if (this.otherView.value?.[i] === void 0) new_value[i] = val;
    });
    if (isArray(value2)) new_value.length = value2.length;
    this.view.XU0(this.view.value = new_value);
  }
  XR0(_, v) {
    if (v === this.otherView) {
      return this._rebuild();
    }
    this.view.XU0(this.view.value = isArray(this.view.value) ? [] : {});
  }
  _rebuild() {
    const new_value = isArray(this.p.value) ? [] : {};
    iter(this.p.value, (i, v) => {
      if (v === void 0) return;
      if (this.otherView.value?.[i] === void 0) new_value[i] = v;
    });
    if (isArray(this.p.value)) new_value.length = this.p.value.length;
    this.view.XU0(this.view.value = new_value);
  }
  // BR1 from primary: row left p → drop from output if it was there.
  // BR1 from other: row left other → row may now pass through; if p has
  // it, add it to output.
  BR1(R1, v) {
    this._removeFrom(R1, v, false);
  }
  // BH1 (consumer): an upstream sparse producer (between/filter over an ARRAY)
  // holed a row in source v — positional-stable, no shift. Same logic as BR1;
  // emits holes (BF0 admit / BH1 drop) so a positional sink mirrors them in
  // place instead of splice-shifting. Mirrors between/intersect/union.
  BH1(R1, v) {
    this._removeFrom(R1, v, true);
  }
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
  BR1A(R1, v) {
    if (v !== this.p) return;
    const NR1 = [];
    for (let i = 0; i < R1.length; i += 2) {
      const at = R1[i];
      const oldVal = this.view.value[at];
      this.view.value.splice(at, 1);
      NR1.push(at, oldVal);
    }
    if (NR1.length) this.view.BR1(NR1);
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
  BI0A(I0, v) {
    if (v !== this.p) return;
    const me = this.view.value;
    const otherVal = this.otherView?.value;
    const NI0 = [];
    for (let i = 0; i < I0.length; i += 2) {
      const at = I0[i];
      const ix = +at;
      const pRow = this.p.value[ix];
      const admit = pRow !== void 0 && otherVal?.[ix] === void 0;
      me.splice(ix, 0, admit ? pRow : void 0);
      NI0.push(at, admit ? pRow : void 0);
    }
    if (NI0.length) this.view.BI0(NI0);
  }
  _removeFrom(R1, v, hole) {
    if (!R1.length) return;
    const arr = isArray(this.view.value);
    if (v === this.otherView) {
      const NI0 = [];
      for (let i = 0; i < R1.length; i += 2) {
        const name = R1[i];
        const pVal = this.p.value?.[name];
        if (pVal !== void 0 && this.view.value[name] === void 0) {
          this.view.value[name] = pVal;
          NI0.push(name, pVal);
        }
      }
      if (NI0.length) hole && arr ? this.view.BF0(NI0) : this.view.BI0(NI0);
      return;
    }
    const NR1 = [];
    for (let i = 0; i < R1.length; i += 2) {
      const name = R1[i];
      if (this.view.value?.[name] !== void 0) {
        NR1.push(name, this.view.value[name]);
        delete this.view.value[name];
      }
    }
    if (NR1.length) hole && arr ? this.view.BH1(NR1) : this.view.BR1(NR1);
  }
  // BU1 from primary: value at key changed; if key passes the filter, emit.
  // BU1 from other: row updated in `other`; doesn't change membership in
  // `other`, so nothing changes in our output.
  BU1(U1, v) {
    if (v === this.otherView) return;
    if (!U1.length) return;
    const NU1 = [];
    for (let i = 0; i < U1.length; i += 2) {
      const name = U1[i];
      const val = U1[i + 1];
      if (this.otherView.value?.[name] !== void 0) continue;
      if (this.view.value?.[name] === val) continue;
      this.view.value[name] = val;
      NU1.push(name, val);
    }
    if (NU1.length) this.view.BU1(NU1);
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
  BU2(U2, v) {
    if (v === this.otherView) return;
    if (!U2.length) return;
    const NU2 = [];
    for (let i = 0; i < U2.length; i += 2) {
      const key = U2[i];
      const name = key[0];
      if (this.otherView.value?.[name] !== void 0) continue;
      if (this.view.value?.[name] === void 0) continue;
      NU2.push(key, U2[i + 1]);
    }
    if (NU2.length) this.view.BU2(NU2);
  }
  // BI0 from primary: maybe admit. BI0 from other: row appeared in other,
  // so if we were showing it, drop it.
  BI0(I0, v) {
    this._insertFrom(I0, v, false);
  }
  // BF0 (consumer): an upstream sparse producer filled a hole in source v —
  // positional-stable. Same logic as BI0; emits holes (BH1 drop / BF0 admit).
  BF0(I0, v) {
    this._insertFrom(I0, v, true);
  }
  _insertFrom(I0, v, hole) {
    if (!I0.length) return;
    const arr = isArray(this.view.value);
    if (v === this.otherView) {
      const NR1 = [];
      for (let i = 0; i < I0.length; i += 2) {
        const name = I0[i];
        if (this.view.value?.[name] !== void 0) {
          NR1.push(name, this.view.value[name]);
          delete this.view.value[name];
        }
      }
      if (NR1.length) hole && arr ? this.view.BH1(NR1) : this.view.BR1(NR1);
      return;
    }
    const NI0 = [];
    const me = this.view.value ??= isArray(this.p.value) ? [] : {};
    for (let i = 0; i < I0.length; i += 2) {
      const name = I0[i];
      const val = I0[i + 1];
      if (this.otherView.value?.[name] !== void 0) continue;
      me[name] = val;
      NI0.push(name, val);
    }
    if (NI0.length) hole && arr ? this.view.BF0(NI0) : this.view.BI0(NI0);
  }
};

// operators/keys/index.ts
var CollectionView = class extends Operator {
  constructor(p, isKeys) {
    super();
    this.p = p;
    this.isKeys = isKeys;
    this.output = [];
    this._rebuild();
  }
  _rebuild() {
    const v = this.p.value;
    let next = [];
    if (v && typeof v === "object") {
      for (const k in v) if (v[k] !== void 0) next.push(this.isKeys ? k : v[k]);
    }
    this.output = next;
    this.view.value = next;
    this.view.XU0(next);
  }
  BI0(I0) {
    if (!I0.length) return;
    if (isArray(this.p.value)) return this._rebuild();
    const out = this.output;
    if (this.isKeys) {
      for (let i = 0; i < I0.length; i += 2) {
        if (I0[i + 1] !== void 0) out.push(I0[i]);
      }
    } else {
      for (let i = 0; i < I0.length; i += 2) {
        const val = I0[i + 1];
        if (val !== void 0) out.push(val);
      }
    }
    this.view.value = out;
    this.view.XU0(out);
  }
  XR0() {
    this._rebuild();
  }
  XU0() {
    this._rebuild();
  }
  BU1() {
    this._rebuild();
  }
  BR1() {
    this._rebuild();
  }
  BU2() {
    this._rebuild();
  }
  BR2() {
    this._rebuild();
  }
  BI2() {
    this._rebuild();
  }
};
var KeysValue = class extends CollectionView {
  constructor(p) {
    super(p, true);
  }
};
var ValuesValue = class extends CollectionView {
  constructor(p) {
    super(p, false);
  }
};

// operators/reverse/index.ts
var ReverseValue = class extends Operator {
  constructor(p) {
    super();
    this.p = p;
    this.output = [];
    this._rebuild();
  }
  _rebuild() {
    const v = this.p.value;
    const out = this.output;
    out.length = 0;
    if (v && typeof v === "object") {
      if (isArray(v)) {
        for (let i = v.length - 1; i >= 0; i--) {
          const val = v[i];
          if (val !== void 0) out.push(val);
        }
      } else {
        const ks = Object.keys(v);
        for (let i = ks.length - 1; i >= 0; i--) {
          const val = v[ks[i]];
          if (val !== void 0) out.push(val);
        }
      }
    }
    this.view.value = out;
    this.view.XU0(out);
  }
  // BI0: each [name, value] pair in I0 was just inserted into the source.
  // In source iteration order they sit at the END; in the reversed output
  // they sit at the FRONT. Process I0 in reverse so the last-inserted in
  // source becomes output[0].
  BI0(I0) {
    if (!I0.length) return;
    if (isArray(this.p.value)) return this._rebuild();
    const out = this.output;
    for (let i = I0.length - 2; i >= 0; i -= 2) {
      const val = I0[i + 1];
      if (val !== void 0) out.unshift(val);
    }
    this.view.value = out;
    this.view.XU0(out);
  }
  XR0() {
    this._rebuild();
  }
  XU0() {
    this._rebuild();
  }
  BU1() {
    this._rebuild();
  }
  BR1() {
    this._rebuild();
  }
  BU2() {
    this._rebuild();
  }
  BR2() {
    this._rebuild();
  }
  BI2() {
    this._rebuild();
  }
};

// register.ts
Operators["filter"] = (a, b) => typeof a === "function" ? FilterValue : typeof a === "string" ? FilterStringValue : isArray(a) ? FilterColumnValue : FilterObjectValue;
Operators["between"] = () => BetweenValue;
Operators["gt"] = () => GtValue;
Operators["lt"] = () => LtValue;
Operators["gte"] = () => GteValue;
Operators["lte"] = () => LteValue;
Operators["to"] = () => ToValue;
Operators["map"] = () => MapValue;
Operators["length"] = (fn) => typeof fn === "function" ? LengthFnValue : LengthValue;
Operators["intersect"] = () => IntersectValue;
Operators["group"] = () => GroupValue;
Operators["za"] = (a, b) => typeof a === "string" ? ZAColumnValue : ZANumberValue;
Operators["top"] = () => ZANumberValue;
Operators["az"] = (a, b) => typeof a === "string" ? AZColumnValue : AZNumberValue;
Operators["limit"] = () => LimitValue;
Operators["sum"] = () => SumValue;
Operators["avg"] = () => AvgValue;
Operators["max"] = () => MaxValue;
Operators["min"] = () => MinValue;
Operators["some"] = () => SomeValue;
Operators["every"] = () => EveryValue;
Operators["tap"] = (fn) => tapHasParam(fn) ? TapValue : TapBareValue;
Operators["distinct"] = () => DistinctValue;
Operators["reduce"] = (_, b) => typeof b === "function" ? ReduceIncrementalValue : ReduceValue;
Operators["union"] = () => UnionValue;
Operators["except"] = () => ExceptValue;
Operators["keys"] = () => KeysValue;
Operators["values"] = () => ValuesValue;
Operators["reverse"] = () => ReverseValue;

// render/index.ts
var NS = "http://www.w3.org/2000/svg";
var NODE = /* @__PURE__ */ Symbol.for("data.node");
var { keys } = Object;
var render = (p, np) => (
  // A top-level Fragment is a plain array of NodeProxy children (it only works
  // nested because an enclosing h() flattens it). Passed straight to render(),
  // `np[NODE]` is undefined and Node.render threw a bare "reading 'children'"
  // TypeError. Treat it like a wrapper whose children render into `p` — the same
  // semantics a single wrapper template gets.
  isArray(np) ? Node.render(p, Node.add(new Node("", null), ...np.filter((c) => c != null && c !== false))[NODE]) : Node.render(p, np[NODE])
);
var DOMSink = class {
  constructor(parent, node) {
    this.parent = parent;
    this.node = node;
    this.p = node.data[view];
    node.data.connect(this);
    this.XU0(this.p.value);
  }
  // Array sources are index-keyed: each DOM slot is bound to the positional
  // child view `node.data[i]`, and every shift refreshes slot content
  // positionally (the V1 propagation), with `remove_node` popping the *tail*.
  // So an insert must MIRROR that — append exactly one node at the new tail
  // index (bound to `data[tail]`) and let the positional refresh place the
  // data. Splicing a node *at* position k (the old behaviour) gave that node
  // a binding to slot k while the existing slot-k node kept its slot-k binding
  // too: both rendered `data[k]` (a duplicate) and the real tail element was
  // left with no node (dropped). Surfaced rendering a sort() view — an
  // array-shaped list with mid-list inserts, which no object-keyed example
  // (group / object-limit) exercised. During the initial XU0 build `tail`
  // already equals the iteration index, so this is identical to the old append
  // for that path; only post-init mid-inserts change.
  // Object branch is positional-agnostic and keyed directly.
  create_node(k) {
    if (isArray(this.nodes)) {
      const tail = this.nodes.length;
      const node = this.node.generate(tail, this.node.data[tail]);
      this.nodes.push(node.create(this.parent));
    } else {
      const node = this.node.generate(k, k === NODE ? this.node.data : this.node.data[k]);
      this.nodes[k] = node.create(this.parent);
    }
  }
  // Array remove always pops the tail because the upstream BR1A protocol
  // already shifted the data array, so the live DOM array's last slot is
  // the one that should disappear (the V1 propagation will rewrite the
  // others' content). Object remove just deletes the named node directly.
  remove_node(k) {
    if (isArray(this.nodes)) {
      this.nodes.pop().remove();
    } else {
      this.nodes[k].remove();
      delete this.nodes[k];
    }
  }
  // ── Index-keyed array path (sparse producers: between/intersect/union/except
  // bound straight to the DOM) ──────────────────────────────────────────────
  // Distinct from create_node/remove_node (which are TAIL-relative — correct
  // for dense splice arrays where tail == index). These bind node[k] ↔ data[k]
  // at a fixed position so a hole can be removed/filled without shifting
  // survivors, mirroring the BH1/BF0 protocol. Used only when the array is
  // sparse (XU0) or for BH1/BF0 events (which dense arrays never emit).
  // A true if any in-bounds slot is a hole (empty or explicit-undefined).
  _sparse(v) {
    for (let i = 0; i < v.length; i++) if (v[i] === void 0) return true;
    return false;
  }
  // Create the node for present index `k`, inserted before the node at the
  // smallest present index > k (or appended if none) so DOM order tracks index
  // order. Idempotent: a BF0 for an already-present slot is a no-op (its content
  // was already refreshed by core's V1 pre-fire).
  _create_at(k) {
    if (this.nodes[k]) return;
    const node = this.node.generate(k, this.node.data[k]);
    let next = Infinity;
    for (const j in this.nodes) {
      const jn = +j;
      if (jn > k && jn < next) next = jn;
    }
    this.nodes[k] = node.create(this.parent, next !== Infinity ? this.nodes[next] : void 0);
  }
  // Append the node for present index `k` to the tail (no positional scan).
  // Only safe when every later present index is created after this one — i.e.
  // the in-increasing-order build from an empty node set in `_reconcile_sparse`.
  _append_at(k) {
    const node = this.node.generate(k, this.node.data[k]);
    this.nodes[k] = node.create(this.parent, void 0);
  }
  _remove_at(k) {
    this.nodes[k]?.remove();
    delete this.nodes[k];
  }
  // Reconcile the live DOM with a sparse array value: drop nodes whose slot
  // became a hole, create nodes for newly-present slots (positioned by index).
  // Handles the dense→sparse transition too (a between whose bounds were full
  // domain, then narrowed): the prior dense nodes are already node[i] ↔ data[i],
  // so index-keyed removal/creation composes cleanly.
  _reconcile_sparse(value2) {
    this.nodes ??= [];
    const gone = [];
    for (const i in this.nodes) if (value2[+i] === void 0) gone.push(+i);
    for (let j = 0; j < gone.length; j++) this._remove_at(gone[j]);
    let survivors = false;
    for (const _ in this.nodes) {
      survivors = true;
      break;
    }
    for (let i = 0; i < value2.length; i++)
      if (value2[i] !== void 0 && !this.nodes[i])
        survivors ? this._create_at(i) : this._append_at(i);
  }
  // Once the parent DOM is detached from the document the binding can never
  // produce a visible mutation again. We could keep applying changes to the
  // detached subtree but it just wastes work and corrupts our nodes/buckets
  // counts (per-group sinks under a removed group container kept getting
  // BR1/BI0 events while their parent was orphaned, eventually popping past
  // the end of nodes). Bail out early instead.
  _detached() {
    return this.parent?.isConnected === false;
  }
  // Remove EVERY present node from `this.nodes`, regardless of shape: array
  // entries (skipping holes a sparse remove left — `?.remove()`), object string
  // keys, AND the NODE-symbol slot (a scalar binding — for-in never enumerates a
  // Symbol key, so it would otherwise be orphaned and duplicated on the next
  // update). Operates directly on `this.nodes` so it must run BEFORE any reset.
  _teardownAll() {
    const ns = this.nodes;
    if (!ns) return;
    if (isArray(ns)) {
      for (let i = 0; i < ns.length; i++) ns[i]?.remove();
    } else {
      for (const k in ns) ns[k]?.remove();
    }
    ns[NODE]?.remove();
  }
  XR0() {
    if (this._detached()) return;
    this._teardownAll();
    this.nodes = isArray(this.nodes) ? [] : {};
  }
  XU0(value2) {
    if (this._detached()) return;
    if (value2 === void 0 || typeof value2 !== "object") {
      this._teardownAll();
      this.nodes = {};
      if (value2 !== void 0) this.create_node(NODE);
      return;
    }
    const prev_nodes = this.nodes ?? {};
    const arr = isArray(value2);
    if (arr) return this._reconcile_sparse(value2);
    this.nodes ??= arr ? [] : {};
    for (const i in value2)
      if (!prev_nodes[i] && (arr || value2[i] !== void 0))
        this.create_node(i);
    const gone = [];
    for (const i in prev_nodes)
      if (!(i in value2))
        gone.push(i);
    for (let j = 0; j < gone.length; j++)
      this.remove_node(gone[j]);
  }
  BR1(R1) {
    if (this._detached()) return;
    for (let i = 0; i < R1.length; i++)
      this.remove_node(R1[i++]);
  }
  // Array-positional structural splice (a STRUCTURAL source insert/remove
  // reaching a list, not a length-stable membership flip). For a SPARSE-bound
  // list (a between/intersect/union/except view bound straight to the DOM) the
  // splice shifts source indices, so the index-keyed nodes must re-sync against
  // the post-splice value — the tail-relative BR1/BI0 fallback removed/added the
  // wrong node and blanked the list. A DENSE list (sort/group/limit) only ever
  // receives TAIL BR1A/BI0A (its _window reconcile emits tail-only splices plus
  // content-stable BU1s), so it keeps the cheap tail path — identical to the old
  // BR1/BI0 fallback, no regression. Detected by whether the current source
  // value is sparse.
  BR1A(R1) {
    if (this._detached()) return;
    if (this._sparse(this.p.value)) return this._reconcile_sparse(this.p.value);
    for (let i = 0; i < R1.length; i++) this.remove_node(R1[i++]);
  }
  BI0A(I0) {
    if (this._detached()) return;
    if (this._sparse(this.p.value)) return this._reconcile_sparse(this.p.value);
    for (let i = 0; i < I0.length; i++) this.create_node(I0[i++]);
  }
  BU1(U1) {
    if (this._detached()) return;
    for (let i = 0; i < U1.length; i++) {
      const name = U1[i++];
      U1[i];
      if (!this.nodes[name]) this.create_node(name);
    }
  }
  BI0(I0) {
    if (this._detached()) return;
    for (let i = 0; i < I0.length; i++) {
      const name = I0[i++];
      I0[i];
      this.create_node(name);
    }
  }
  // Hole remove / hole fill from a sparse producer over an ARRAY. Positional-
  // stable (no shift): drop/create the node AT index k, leaving survivors put.
  // Core's View.BH1/BF0 pre-fires the touched child's XU0 (so a fill's content
  // is already set on the child view _create_at binds, and a remove's child
  // goes undefined just before its node is dropped) — index-keyed, so no
  // double-apply. Dense arrays never emit these; they only reach a DOMSink
  // bound directly to a between/intersect/union/except view.
  BH1(R1) {
    if (this._detached()) return;
    for (let i = 0; i < R1.length; i += 2) this._remove_at(+R1[i]);
  }
  BF0(I0) {
    if (this._detached()) return;
    for (let i = 0; i < I0.length; i += 2) this._create_at(+I0[i]);
  }
  BR2(BR2) {
  }
  // Move-at-depth-1. Rows here are *index-keyed*: each DOM node is bound to
  // the positional child view `node.data[k]`, and a rank rotation reaches us
  // as core's Value.BMV1 refreshing the content of every slot in the affected
  // range (child.XU0, see core.ts) *before* this method runs. So by now each
  // fixed slot already shows its new row's data — the DOM is correct without
  // touching node order. Physically relocating the element on top of that
  // would double-apply the rotation and scramble the list (the regression in
  // tests/render-reorder.spec.ts). We intentionally do nothing: keep `nodes`
  // aligned with positions and let the positional content refresh stand.
  // (True element-identity preservation across reorders would require a
  // data-keyed row model, which this index-keyed renderer doesn't have.)
  BMV1() {
  }
  BU2(U2) {
    if (this._detached()) return;
    for (let i = 0; i < U2.length; i++) {
      const [name] = U2[i++];
      U2[i];
      if (!this.nodes[name]) this.create_node(name);
    }
  }
  BI2(I2) {
    if (this._detached()) return;
    for (let i = 0; i < I2.length; i += 3) {
      const [name] = I2[i];
      if (!this.nodes[name]) this.create_node(name);
    }
  }
};
var Child = class {
};
var Node = class _Node extends Child {
  constructor(tag, ns, children = []) {
    super();
    this.ns = ns;
    this.tag = tag.replaceAll("_", "-");
    this.children = children;
  }
  static render(dom, node) {
    for (const child of node.children) {
      if (child.data) {
        const sink = new DOMSink(dom, child);
        (dom.sinks ??= []).push(dom.sink = sink);
        Object.defineProperty(dom, "__ripple_sink", { value: sink, configurable: true });
      } else {
        child.create(dom);
      }
    }
    return dom;
  }
  get new() {
    const node = new _Node(this.tag, this.ns, this.children.concat([]));
    node.static = this.static;
    node.data = this.data;
    node.fn = this.fn;
    return node;
  }
  get hasdata() {
    return this.data !== void 0 || this.static !== void 0;
  }
  // The grand dispatch on what `HTML.div(...)` was called with. The same
  // method handles every shape because the proxy can't know in advance:
  //   string/number/true   → text content
  //   NodeProxy            → child template
  //   undefined/false      → empty (often used by ternaries)
  //   reactive (has [view]) → bind data to this node's children
  //   function             → row generator (composes with prior fn)
  //   object               → static attribute bag
  static add(node, ...args) {
    for (const arg of args) {
      if (typeof arg === "string" || typeof arg === "number" || arg === true) {
        node.static = [arg];
      } else if (arg instanceof NodeProxy) {
        const child = arg[NODE];
        if (child.static) {
          iter(
            child.static,
            (k, v) => node.children.push(child.generate(k, v))
          );
        } else if (child.fn && !child.hasdata) {
          node.children.push(child.generate());
        } else node.children.push(arg[NODE]);
      } else if (typeof arg === "undefined" || arg === false) {
        node.static = [];
      } else if (arg[view]) {
        node.data = arg;
      } else if (typeof arg === "function") {
        const fn1 = node.fn;
        node.fn = fn1 ? (n, ...args2) => arg(fn1(n, ...args2), ...args2) : arg;
      } else if (typeof arg === "object") {
        node.static = arg;
      } else {
        throw new Error("unexpted arg", arg);
      }
    }
    return new NodeProxy(node);
  }
  create(parent, before) {
    const dom = this.ns ? document.createElementNS(NS, this.tag) : document.createElement(this.tag);
    before ? parent.insertBefore(dom, before) : parent.append(dom);
    return _Node.render(dom, this);
  }
  generate(k, v) {
    let node = new _Node(
      this.tag,
      this.ns,
      this.children.map((c) => c instanceof _Node ? c.new : c instanceof Prop ? new c.constructor(c.name, c.value) : c)
    );
    const content = this.fn ? this.fn(new NodeProxy(node), v, k) : v;
    if (content instanceof NodeProxy) {
      node = content[NODE];
    } else {
      Text.add(node, content);
    }
    return node;
  }
};
var Prop = class extends Child {
  constructor(name, value2) {
    super();
    this.name = name;
    this.value = value2;
  }
  static add(node, n, v) {
    if (arguments.length == 2) v = true;
    typeof n === "object" ? node.children.push(...keys(n).map((k) => new this(k, n[k]))) : node.children.push(new this(n, v));
    return new NodeProxy(node);
  }
  create(parent) {
    this.parent = parent;
    if (this.value?.[view]) {
      parent.nrefs ??= {};
      parent.nrefs[this.name] = this.value.connect(this, "set");
    } else if (this.name?.[view]) {
      parent.arefs ??= [];
      parent.arefs.push(this.name.connect(this, "set"));
    } else
      this.set = this.value;
  }
  set set(value2) {
    value2 === false || value2 === void 0 ? this.remove() : this.add(value2);
  }
};
var Attr = class extends Prop {
  add(value2) {
    this.parent.setAttribute(this.name, value2);
  }
  remove() {
    this.parent.removeAttribute(this.name);
  }
};
var Class = class extends Prop {
  // Two reactive shapes reach here:
  //   .class('hot', flag)   — STATIC name, reactive PRESENCE (this.value is a VP):
  //                           add/remove toggle the fixed class `this.name`.
  //   className={vp}         — REACTIVE name (this.name is a VP yielding the class
  //                           string): each change passes the NEW class as `value`,
  //                           and we must remove the PREVIOUS class first or they
  //                           accumulate forever (the documented Reactive<string>
  //                           className never dropping the old class).
  add(value2) {
    const reactiveName = this.name?.[view];
    const cls = reactiveName ? value2 : this.name;
    if (reactiveName && this._last !== void 0 && this._last !== cls)
      this.parent.classList.remove(this._last);
    if (cls != null && cls !== "") this.parent.classList.add(this._last = cls);
  }
  remove() {
    const cls = this.name?.[view] ? this._last : this.name;
    if (cls != null && cls !== "") this.parent.classList.remove(cls);
    this._last = void 0;
  }
};
var ID = class extends Prop {
  add() {
    this.parent.id = this.name;
  }
  remove() {
    this.parent.removeAttribute("id");
  }
};
var Style = class extends Prop {
  add(value2) {
    this.parent.style.setProperty(this.name, value2);
  }
  remove() {
    this.parent.style.removeProperty(this.name);
  }
};
var Text = class extends Prop {
  create(parent) {
    parent.appendChild(this.dom = document.createTextNode(""));
    super.create(parent);
  }
  add() {
    this.dom.textContent = this.name;
  }
  remove() {
    this.dom.textContent = "";
  }
};
var Event = class extends Prop {
  create(parent) {
    parent.addEventListener(this.name.toLowerCase(), this.value);
  }
};
var Ref = class extends Prop {
  create(parent) {
    this.name(parent);
  }
};
var props = {
  attr: Attr,
  class: Class,
  on: Event,
  style: Style,
  id: ID,
  text: Text,
  ref: Ref,
  nodes: Node
};
var NodeProxy = class _NodeProxy {
  constructor(node, prop) {
    this.node = node;
    this.prop = prop;
    return new Proxy(noop, this);
  }
  set() {
    throw "cannot set properties";
  }
  deleteProperty() {
    throw "cannot delete properties";
  }
  get(t, name) {
    const n = this.node;
    if (name === NODE) return n;
    else if (typeof name === "symbol") return;
    else if (name in props) return new _NodeProxy(n, name);
    else if (name.startsWith("#")) return ID.add(n.new, name.slice(1), true);
    else if (name.startsWith(".")) return Class.add(n.new, name.slice(1), true);
    else if (name.includes("=")) return Attr.add(n.new, ...name.split("="));
    else return Class.add(n.new, name.replaceAll("_", "-"), true);
  }
  apply(t, m, args) {
    if (args.length === 1 && isArray(args[0])) args = args[0];
    return props[this.prop ?? "nodes"].add(this.node.new, ...args);
  }
  getPrototypeOf(targer) {
    return _NodeProxy.prototype;
  }
};
var HTML = new Proxy({}, {
  get(t, name) {
    return new NodeProxy(new Node(name));
  }
});
var SVG = new Proxy({}, {
  get(t, name) {
    return new NodeProxy(new Node(name, true));
  }
});

export { $, HTML, Operators, SVG, Sink, createOperator, reactive, render, value, view };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map