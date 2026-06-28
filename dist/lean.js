// utils.ts
function iter(o, fn) {
  if (isArray(o)) {
    for (let i = 0; i < o.length; i++) fn(i, o[i]);
  } else {
    for (const i in o) fn(i, o[i]);
  }
}
var { isArray } = Array;
var noop = () => {
};

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
var core_default = $;
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
  // skip propagation on no-ops). Return typed `any`: the `false` is an internal
  // short-circuit sentinel, while most subclass overrides return void — typing
  // it `false | undefined` would make every void override a TS2416 mismatch.
  // The optional 2nd `src` param across these verb methods is the source-identity
  // a multi-source operator (intersect/union/except) receives when it acts as a
  // sink for a secondary source (`src.connect(this)` → the secondary's View fans
  // out `sink.<verb>(payload, this)`). The base single-source path ignores it;
  // typing it optional lets those overrides stay assignable to the base.
  XR0(_value, src) {
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
  BR1A(R1, src) {
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
  BR1(R1, src) {
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
  BR2(R2, src) {
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
  XU0(value2, src) {
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
  BU1(U1, src) {
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
  BU2(U2, src) {
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
  BI0(I0, src) {
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
  BI0A(I0, src) {
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
  BI2(I2, src) {
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
  XU0(value2) {
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
  // @ts-expect-error base data-field intentionally shadowed by a read-through accessor (perf: View.value must stay a field)
  get value() {
    return this.src.value;
  }
  set value(v) {
  }
  // @ts-expect-error base data-field intentionally shadowed by a read-through accessor (perf: View.value must stay a field)
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
    if (type === "get") return new _ViewProxy(p.get_or_create_named(`${args[0]}`));
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
  parent;
  node;
  p;
  nodes;
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
  ns;
  tag;
  children;
  static;
  data;
  fn;
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
  name;
  value;
  parent;
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
  _last;
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
  dom;
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
  node;
  prop;
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

export { $, HTML, Operators, SVG, Sink, createOperator, core_default as default, reactive, render, value, view };
//# sourceMappingURL=lean.js.map
//# sourceMappingURL=lean.js.map